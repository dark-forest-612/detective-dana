<script lang="ts">
	import { onMount } from "svelte";
	import { Editor } from "@tiptap/core";
	import StarterKit from "@tiptap/starter-kit";
	import Highlight from "@tiptap/extension-highlight";
	import Placeholder from "@tiptap/extension-placeholder";
	import { TomboySize } from "./extensions/TomboySize.js";
	import { TomboyMonospace } from "./extensions/TomboyMonospace.js";
	import { TomboyInternalLink } from "./extensions/TomboyInternalLink.js";
	import { TomboyUrlLink } from "./extensions/TomboyUrlLink.js";
	import { TomboyDatetime } from "./extensions/TomboyDatetime.js";
	import { TomboyListItem } from "./extensions/TomboyListItem.js";
	import { TomboyParagraph } from "./extensions/TomboyParagraph.js";
	import { TomboySubtitlePlaceholder } from "./extensions/TomboySubtitlePlaceholder.js";
	import { createTitleProvider } from "./autoLink/titleProvider.js";
	import { autoLinkPluginKey } from "./autoLink/autoLinkPlugin.js";
	import { createImagePreviewPlugin } from "./imagePreview/imagePreviewPlugin.js";
	import { createTitleBlurValidatorPlugin } from "./titleValidation/titleBlurValidatorPlugin.js";
	import { TomboyTapSelect } from "./tapSelect/TomboyTapSelect.js";
	import { tapSelection } from "./tapSelect/tapSelection.svelte.js";
	import { extractImageFile } from "./imagePreview/extractImageFile.js";
	import { uploadImage } from "$lib/upload/blobUpload.js";
	import { insertImageUrl } from "$lib/upload/insertImageUrl.js";
	import ImageViewer from "$lib/components/ImageViewer.svelte";
	import { pushToast, dismissToast } from "$lib/stores/toast.js";
	import { noteRepository } from "$lib/repository/index.js";
	import {
		validateTitle,
		MIN_TITLE_LENGTH,
		type TitleValidationError,
	} from "$lib/core/titleValidator.js";
	import { Extension } from "@tiptap/core";
	import { insertTodayDate } from "./insertDate.js";
	import { sinkListItemOnly, liftListItemOnly, isInList } from "./listItemDepth.js";
	import { moveListItemUp, moveListItemDown } from "./listItemReorder.js";
	import type { JSONContent } from "@tiptap/core";
	import EditorContextMenu from "./EditorContextMenu.svelte";

	interface Props {
		content?: JSONContent;
		onchange?: (doc: JSONContent) => void;
		oninternallink?: (target: string) => void;
		currentGuid?: string | null;
		enableContextMenu?: boolean;
		/** Tomboy ISO creation date of the current note — used to render the
		 *  "yyyy-mm-dd" placeholder on the empty second line. */
		createDate?: string | null;
		/** When false, the editor becomes read-only (Phase 4 lock banner). */
		editable?: boolean;
		/** Enable read-mode tap-to-select words (mobile /note/[id]). */
		enableTapSelect?: boolean;
	}

	let {
		content,
		onchange,
		oninternallink,
		currentGuid = null,
		enableContextMenu = false,
		createDate = null,
		editable = true,
		enableTapSelect = false,
	}: Props = $props();

	let ctxMenu = $state<{ x: number; y: number } | null>(null);
	let viewerSrc = $state<string | null>(null);

	function openImageViewer(href: string): void {
		viewerSrc = href;
	}

	function closeImageViewer(): void {
		viewerSrc = null;
	}

	function handleContextMenu(e: MouseEvent) {
		if (!enableContextMenu) return;
		e.preventDefault();
		ctxMenu = { x: e.clientX, y: e.clientY };
	}

	let editorElement: HTMLDivElement;
	let editor: Editor | null = $state(null);

	// Track the last content/guid we pushed into the editor. The $effect
	// below only swaps the editor's doc when the parent actually navigates
	// to a different note — not on every reactive pass where `content` is
	// re-read but unchanged. Left undefined/null until the first $effect
	// run after mount seeds them, so we don't accidentally capture stale
	// initial prop values at component-construction time.
	let lastAppliedContent: JSONContent | undefined = undefined;
	let lastAppliedGuid: string | null = null;
	let contentSyncSeeded = false;

	// Debounced dispatcher for the auto-link plugin's rescan. The plugin
	// runs in "deferred" mode (only scans on {refresh:true} meta), which
	// keeps the typing hot path cheap. We fire a single refresh after the
	// user has paused typing. Idle fallback via requestIdleCallback when
	// available so the scan doesn't steal a frame from active input.
	//
	// `full:true` is used when the title list changes out from under us
	// (another note created / renamed / deleted). That case requires a
	// whole-document rescan because any text might now match, unlike the
	// ordinary typing path where the plugin's own dirty-range tracking
	// lets us scan only around the edit.
	const AUTO_LINK_DEBOUNCE_MS = 1000;
	let autoLinkTimer: ReturnType<typeof setTimeout> | null = null;
	let autoLinkIdleHandle: number | null = null;
	let autoLinkPendingFull = false;

	function cancelAutoLinkScan(): void {
		if (autoLinkTimer !== null) {
			clearTimeout(autoLinkTimer);
			autoLinkTimer = null;
		}
		if (autoLinkIdleHandle !== null) {
			const anyWin = window as unknown as {
				cancelIdleCallback?: (h: number) => void;
			};
			anyWin.cancelIdleCallback?.(autoLinkIdleHandle);
			autoLinkIdleHandle = null;
		}
	}

	function runAutoLinkScan(): void {
		const ed = editor;
		if (!ed || ed.isDestroyed) return;
		const meta: { refresh: true; full?: true } = { refresh: true };
		if (autoLinkPendingFull) meta.full = true;
		autoLinkPendingFull = false;
		ed.view.dispatch(ed.state.tr.setMeta(autoLinkPluginKey, meta));
	}

	// Format a Tomboy ISO date (yyyy-MM-ddTHH:mm:ss.fffffff±HH:MM) as
	// yyyy-mm-dd for the subtitle placeholder. Returns null for missing /
	// unparseable inputs so the placeholder is simply skipped.
	function subtitlePlaceholderText(): string | null {
		if (!createDate) return null;
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(createDate);
		if (!m) return null;
		return `${m[1]}-${m[2]}-${m[3]}`;
	}

	function scheduleAutoLinkScan(opts?: { full?: boolean }): void {
		if (opts?.full) autoLinkPendingFull = true;
		cancelAutoLinkScan();
		autoLinkTimer = setTimeout(() => {
			autoLinkTimer = null;
			const anyWin = window as unknown as {
				requestIdleCallback?: (
					cb: () => void,
					opts?: { timeout: number },
				) => number;
			};
			if (typeof anyWin.requestIdleCallback === "function") {
				autoLinkIdleHandle = anyWin.requestIdleCallback(
					() => {
						autoLinkIdleHandle = null;
						runAutoLinkScan();
					},
					{ timeout: 500 },
				);
			} else {
				runAutoLinkScan();
			}
		}, AUTO_LINK_DEBOUNCE_MS);
	}

	onMount(() => {
		// Use a dynamic excludeGuid callback so the provider follows note
		// transitions without needing dispose + recreate. The editor
		// instance is reused across notes (see $effect below), and the
		// plugin also reads getCurrentGuid() on every scan, so the filter
		// stays correct for the active note.
		const titleProvider = createTitleProvider({
			getExcludeGuid: () => currentGuid,
		});
		// Populate titles asynchronously; the plugin reads via getTitles() so
		// late arrivals still auto-link pre-existing content via the refresh meta.
		// refresh() is a fast-path no-op when sharedEntries is already warm
		// (common case: a workspace that already has other editors open), so
		// this doesn't trigger a redundant listNotes() IDB read on every
		// new window.
		void titleProvider.refresh();

		const tapSelectExtension = enableTapSelect
			? [
				TomboyTapSelect.configure({
					onSelectionChange: (info) => {
						tapSelection.set(info);
					},
				}),
			]
			: [];

		editor = new Editor({
			element: editorElement,
			editable,
			extensions: [
				StarterKit.configure({
					// Disable code (we use tomboyMonospace instead)
					code: false,
					codeBlock: false,
					// We substitute extended versions that carry Tomboy round-trip attrs.
					paragraph: false,
					listItem: false,
				}),
				TomboyParagraph,
				TomboyListItem,
				// Underline is bundled by StarterKit v3 — importing it again
				// produces a "Duplicate extension names" warning.
				Highlight.configure({ multicolor: false }),
				Placeholder.configure({ placeholder: "Start typing..." }),
				TomboySubtitlePlaceholder.configure({
					getPlaceholderText: subtitlePlaceholderText,
				}),
				TomboySize,
				TomboyMonospace,
				// TomboyDatetime registered before link extensions so PM ranks
				// it as the outer mark (preserves `<datetime><link>X</link></datetime>`
				// nesting instead of flipping to `<link><datetime>X</datetime></link>`).
				TomboyDatetime,
				TomboyInternalLink.configure({
					onLinkClick: (target: string) => {
						oninternallink?.(target);
					},
					getTitles: () => titleProvider.getTitles(),
					getCurrentGuid: () => currentGuid,
					// Scan only at idle — scheduleAutoLinkScan() below fires
					// a single {refresh:true} after typing pauses. This keeps
					// the keystroke path out of the O(doc * titles) scan.
					deferred: true,
				}),
				TomboyUrlLink,
				Extension.create({
					name: "tomboyImagePreview",
					addProseMirrorPlugins() {
						return [
							createImagePreviewPlugin({
								onImageClick: openImageViewer,
							}),
						];
					},
				}),
				Extension.create({
					name: "tomboyTitleBlurValidator",
					addProseMirrorPlugins() {
						return [
							createTitleBlurValidatorPlugin({
								onLeaveTitle: (titleText) => {
									void handleTitleBlur(titleText);
								},
							}),
						];
					},
				}),
				...tapSelectExtension,
			],
			content: content ?? {
				type: "doc",
				content: [{ type: "paragraph" }],
			},
			onUpdate: ({ editor: ed }) => {
				// TipTap's onUpdate only fires on docChanged transactions,
				// so the previous JSON.stringify dirty-check was redundant.
				// Auto-link mark mutations appended by the plugin also need
				// to be persisted, so we always forward to onchange and let
				// updateNoteFromEditor's XML-equality check absorb no-ops.
				onchange?.(ed.getJSON());
				scheduleAutoLinkScan();
			},
			editorProps: {
				handleKeyDown: (_view, event) => {
					const ed = editor;
					if (!ed) return false;

					// --- Ctrl/Cmd shortcuts (no Alt, no Shift) ---
					if (
						(event.ctrlKey || event.metaKey) &&
						!event.altKey &&
						!event.shiftKey
					) {
						switch (event.key) {
							case "d":
								event.preventDefault();
								insertTodayDate(ed);
								return true;
							case "s":
								event.preventDefault();
								ed.chain().focus().toggleStrike().run();
								return true;
							case "h":
								event.preventDefault();
								ed.chain().focus().toggleHighlight().run();
								return true;
							case "m":
								event.preventDefault();
								ed.chain()
									.focus()
									.toggleTomboyMonospace()
									.run();
								return true;
						}
					}

					// --- Alt+Arrow shortcuts (no Ctrl, no Shift) ---
					if (
						event.altKey &&
						!event.ctrlKey &&
						!event.metaKey &&
						!event.shiftKey
					) {
						if (event.key === "ArrowRight") {
							event.preventDefault();
							try {
								const sunk = sinkListItemOnly(ed);
								if (!sunk && !isInList(ed)) {
									ed.chain().focus().toggleBulletList().run();
								}
							} catch (err) {
								console.error(
									"[listItemDepth] operation failed:",
									err,
								);
							}
							return true;
						}
						if (event.key === "ArrowLeft") {
							event.preventDefault();
							try {
								const lifted = liftListItemOnly(ed);
								if (!lifted && isInList(ed)) {
									ed.commands.liftListItem("listItem");
								}
							} catch (err) {
								console.error(
									"[listItemDepth] operation failed:",
									err,
								);
							}
							return true;
						}
						if (event.key === "ArrowUp") {
							event.preventDefault();
							try {
								moveListItemUp(ed);
							} catch (err) {
								console.error(
									"[listItemReorder] operation failed:",
									err,
								);
							}
							return true;
						}
						if (event.key === "ArrowDown") {
							event.preventDefault();
							try {
								moveListItemDown(ed);
							} catch (err) {
								console.error(
									"[listItemReorder] operation failed:",
									err,
								);
							}
							return true;
						}
					}

					return false;
				},
				handleClick: (view, pos, event) => {
					const target = (event.target as HTMLElement).closest(
						"a[data-link-target]",
					);
					if (target) {
						event.preventDefault();
						const linkTarget =
							target.getAttribute("data-link-target");
						if (linkTarget) {
							oninternallink?.(linkTarget);
						}
						return true;
					}
					return false;
				},
				handlePaste: (_view, event) => {
					const file = extractImageFile(event.clipboardData);
					if (!file) return false;
					event.preventDefault();
					void uploadAndInsertImage(file);
					return true;
				},
				handleDrop: (_view, event) => {
					const file = extractImageFile(event.dataTransfer);
					if (!file) return false;
					event.preventDefault();
					void uploadAndInsertImage(file);
					return true;
				},
			},
		});

		// Note: no initial scan on mount. The note's stored XML already
		// carries the `<link:internal>` marks from its last save, so the
		// deserialized doc shows links immediately. Any staleness (e.g.
		// another note renamed while this one was closed) self-heals on
		// the next edit via the plugin's dirty-range tracking, or
		// immediately via the titleProvider.onChange hook below.

		// When the note list changes (another note created / renamed / deleted),
		// any text in this note might newly match / stop matching a title —
		// ask the plugin for a full-document rescan. Routed through the
		// same debouncer so a burst of cache invalidations collapses into
		// one scan.
		const offChange = titleProvider.onChange(() => {
			scheduleAutoLinkScan({ full: true });
		});

		return () => {
			cancelAutoLinkScan();
			offChange();
			titleProvider.dispose();
			editor?.destroy();
		};
	});

	// Reactive editability: the lock controller flips this to `false` when
	// another user is editing the note.
	$effect(() => {
		const ed = editor;
		const e = editable;
		if (!ed || ed.isDestroyed) return;
		if (ed.isEditable !== e) ed.setEditable(e);
		// Tap-select is only meaningful in read-only mode. Drop any lingering
		// selection the moment the user acquires the edit lock so the
		// decoration doesn't bleed into active editing.
		if (e && enableTapSelect) {
			ed.commands.clearTapSelection();
		}
	});

	// Reactively swap the editor's document when the parent navigates to a
	// different note (or otherwise hands us new content). Reusing the same
	// TipTap instance across notes avoids the full
	// destroy→PM-schema-rebuild→extension-init→DOM-mount churn that the
	// previous `{#key noteId}` pattern paid on every transition.
	$effect(() => {
		const c = content;
		const g = currentGuid;
		const ed = editor;
		if (!ed || ed.isDestroyed) return;

		if (!contentSyncSeeded) {
			// First run after onMount created the editor: the editor was
			// initialised with the current `content` already, so just
			// record the applied state — no setContent, no clearDirty.
			contentSyncSeeded = true;
			lastAppliedContent = c;
			lastAppliedGuid = g;
			return;
		}

		if (c === lastAppliedContent && g === lastAppliedGuid) return;
		lastAppliedContent = c;
		lastAppliedGuid = g;

		const docContent = c ?? {
			type: "doc",
			content: [{ type: "paragraph" }],
		};
		// emitUpdate:false so the parent's onchange doesn't interpret this
		// as a user edit (no spurious save triggered for just loading a
		// note). The plugin still sees the underlying PM transaction and
		// would otherwise accumulate the whole new doc as a dirty range,
		// so we clear that explicitly below — the stored XML already
		// carries `<link:internal>` marks and a rescan on load is neither
		// needed nor cheap for large notes.
		ed.commands.setContent(docContent, { emitUpdate: false });
		ed.view.dispatch(
			ed.state.tr.setMeta(autoLinkPluginKey, {
				clearDirty: true,
				skip: true,
			}),
		);
		// Any pending scan timer was for the previous note; drop it.
		cancelAutoLinkScan();
	});

	export function getEditor(): Editor | null {
		return editor;
	}

	/**
	 * Called by the title-blur plugin when the caret leaves the first
	 * block. Runs the full validator (length + uniqueness against the
	 * repo), and on failure:
	 *   1) surfaces a warning toast, and
	 *   2) pulls the caret back into the title block so the user can fix
	 *      it before navigating further.
	 *
	 * `currentGuid` is null for brand-new notes that haven't been
	 * persisted yet — in that case we skip uniqueness (the note isn't in
	 * the repo anyway) and only enforce the length rule. The save path
	 * (`updateNoteFromEditor`) performs the full validation as a
	 * defense-in-depth gate.
	 *
	 * Fires asynchronously: the plugin calls us from inside an
	 * `appendTransaction`, so we cannot dispatch another transaction
	 * synchronously (it'd recurse into the same txn pipeline). A
	 * microtask-delayed focus command avoids that.
	 */
	async function handleTitleBlur(titleText: string): Promise<void> {
		const ed = editor;
		if (!ed || ed.isDestroyed) return;
		if (!ed.isEditable) return;

		let error: TitleValidationError | null;
		if (currentGuid) {
			error = await validateTitle(titleText, currentGuid, noteRepository);
		} else {
			// Length-only fallback for unsaved notes.
			const trimmed = titleText.trim();
			error =
				trimmed.length < MIN_TITLE_LENGTH
					? {
							kind: "tooShort",
							minLength: MIN_TITLE_LENGTH,
							actual: trimmed.length,
						}
					: null;
		}

		if (!error) return;

		if (error.kind === "tooShort") {
			pushToast(
				`제목은 최소 ${error.minLength}글자 이상이어야 합니다.`,
				{ kind: "error" },
			);
		} else if (error.kind === "duplicate") {
			pushToast("같은 제목의 노트가 이미 있습니다.", { kind: "error" });
		}

		// Defer the focus command so it doesn't race with the current
		// transaction (ProseMirror disallows dispatching another tr from
		// within appendTransaction).
		queueMicrotask(() => {
			const e = editor;
			if (!e || e.isDestroyed) return;
			// Move the caret to the end of the title block so the user
			// can append / edit without losing their spot.
			const firstBlockSize = e.state.doc.child(0).nodeSize;
			const endOfTitle = Math.max(1, firstBlockSize - 1);
			e.chain().focus().setTextSelection(endOfTitle).run();
		});
	}

	// Maximum upload size (8 MB). Beyond this we refuse client-side rather
	// than burn bandwidth + Vercel quota on a request that may also fail
	// silently mid-stream on flaky mobile networks.
	const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

	export async function uploadAndInsertImage(file: File): Promise<void> {
		if (!file.type.startsWith("image/")) {
			pushToast("이미지 파일만 업로드할 수 있습니다.", { kind: "error" });
			return;
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			pushToast(
				`이미지가 너무 큽니다 (최대 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB).`,
				{ kind: "error" },
			);
			return;
		}
		const ed = editor;
		if (!ed || ed.isDestroyed) return;

		const progressId = pushToast("이미지 업로드 중...", { timeoutMs: 0 });
		try {
			const url = await uploadImage(file);
			insertImageUrl(ed, url);
			dismissToast(progressId);
		} catch (err) {
			dismissToast(progressId);
			console.error("[uploadAndInsertImage]", err);
			pushToast("이미지 업로드에 실패했습니다.", { kind: "error" });
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={editorElement}
	class="tomboy-editor"
	oncontextmenu={handleContextMenu}
></div>

{#if ctxMenu && editor}
	<EditorContextMenu
		{editor}
		x={ctxMenu.x}
		y={ctxMenu.y}
		onclose={() => (ctxMenu = null)}
		{oninternallink}
	/>
{/if}

<ImageViewer
	src={viewerSrc ?? ""}
	open={viewerSrc !== null}
	onclose={closeImageViewer}
/>

<style>
	.tomboy-editor {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
		font-size: 16px;
		line-height: 1.4;
		/* NOTE: we deliberately do NOT set `container-type: size` here.
		   That would imply `contain: size`, which prevents the element
		   from being sized by its contents. It works on the desktop
		   NoteWindow (where .body is a flex column giving .tomboy-editor
		   a definite height via flex:1), but collapses the editor to 0
		   on the mobile /note/[id] page where .editor-area is a plain
		   block scroller — .tomboy-editor there is content-sized, so
		   size containment zeroes it out and the note appears blank.
		   Instead, the outer scroll container in each consumer sets
		   `container-type: size` (see .editor-area and .body). Image
		   previews reference that container via `100cqh` below. */
	}

	.tomboy-editor :global(.tiptap) {
		outline: none;
		min-height: 100%;
	}

	.tomboy-editor :global(.tiptap p) {
		margin: 0;
	}

	/* First paragraph = title */
	.tomboy-editor :global(.tiptap > p:first-child) {
		font-size: 1.4em;
		font-weight: bold;
		margin-bottom: -0.4em;
	}

	/* Second paragraph (body top) = subtitle slot: smaller, muted */
	.tomboy-editor :global(.tiptap > p:nth-child(2)) {
		font-size: 0.8em;
		line-height: 2.4;
		color: #666;
		vertical-align: top;
		padding-left: 0.1em;
	}

	/* Tomboy size marks */
	.tomboy-editor :global(.tomboy-size-huge) {
		font-size: 1.6em;
		font-weight: bold;
	}

	.tomboy-editor :global(.tomboy-size-large) {
		font-size: 1.3em;
	}

	.tomboy-editor :global(.tomboy-size-small) {
		font-size: 0.85em;
	}

	/* Monospace */
	.tomboy-editor :global(.tomboy-monospace) {
		font-family: monospace;
		background: rgba(0, 0, 0, 0.06);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}

	/* Internal link */
	.tomboy-editor :global(.tomboy-link-internal) {
		color: #204a87;
		text-decoration: underline;
		cursor: pointer;
	}

	/* Broken link */
	.tomboy-editor :global(.tomboy-link-broken) {
		color: #888;
		text-decoration: line-through;
		cursor: default;
	}

	/* URL link */
	.tomboy-editor :global(.tomboy-link-url) {
		color: #3465a4;
		text-decoration: underline;
	}

	/* Inline image preview widget (decoration; not part of the doc). The
	   underlying text (including any <link:url> mark) is preserved verbatim
	   for round-trip compatibility with Tomboy desktop.

	   Sizing: default to the image's natural size, but cap to the note's
	   visible width (max-width: 100%) and height (max-height: 100cqh, the
	   size-container set on .tomboy-editor). Aspect ratio is preserved.

	   `display: block` enforces the spec rule that the image owns its line —
	   any text that shares the paragraph wraps before/after the image, so
	   the user effectively can't share a line with it. */
	.tomboy-editor :global(img.tomboy-image-preview) {
		display: block;
		max-width: 100%;
		max-height: 100cqh;
		width: auto;
		height: auto;
		margin: 0.4em 0;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.04);
		cursor: pointer;
	}

	/* While the image fetch is in flight, keep the widget out of layout so
	   the URL text remains visible in its place. The plugin flips the class
	   off (and adds the URL-hidden inline deco) once `load` fires. */
	.tomboy-editor :global(img.tomboy-image-preview.tomboy-image-loading) {
		display: none;
	}

	/* Image-URL text is hidden (only after the image has loaded) so the
	   image alone represents the link. Delete / ArrowLeft / ArrowRight are
	   intercepted in the plugin so the hidden URL behaves atomically — i.e.
	   Backspace at the end of the URL removes the whole URL, arrow keys
	   skip across it. */
	.tomboy-editor :global(.tomboy-image-url-hidden) {
		display: none;
	}

	/* Highlight */
	.tomboy-editor :global(mark) {
		background-color: #fff176;
	}

	/* Read-mode tap-to-select word highlight (mobile /note/[id]). Adjacent
	   selected words are merged into a single decoration span by the plugin,
	   so the visual selection is contiguous even though internal state
	   tracks each tapped word individually. */
	.tomboy-editor :global(.tomboy-tap-select) {
		background-color: #bfdbfe;
		border-radius: 2px;
		box-shadow: 0 0 0 1px #60a5fa;
	}

	/* List items */
	.tomboy-editor :global(ul) {
		padding-left: 1.5em;
	}

	/* Placeholder */
	.tomboy-editor :global(.tiptap p.is-editor-empty:first-child::before) {
		color: #adb5bd;
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}

	/* Subtitle (second line) creation-date placeholder. Applied only when
	   the second paragraph is empty and the cursor is not on it — see
	   TomboySubtitlePlaceholder. */
	.tomboy-editor :global(.tiptap p.tomboy-subtitle-placeholder::before) {
		color: #909090;
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
		font-size: 0.8em;
	}
</style>
