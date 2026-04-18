<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		getNote,
		updateNoteFromEditor,
		deleteNoteById,
		getNoteEditorContent,
		createNote,
		findNoteByTitle,
		listNotes
	} from '$lib/core/noteManager.js';
	import { toggleFavorite, isFavorite } from '$lib/core/favorites.js';
	import type { NoteData } from '$lib/core/note.js';
	import TomboyEditor from '$lib/editor/TomboyEditor.svelte';
	import Toolbar from '$lib/editor/Toolbar.svelte';
	import NoteActionSheet, { type ActionKind } from '$lib/editor/NoteActionSheet.svelte';
	import NotebookPicker from '$lib/components/NotebookPicker.svelte';
	import type { JSONContent, Editor } from '@tiptap/core';
	import { pushToast } from '$lib/stores/toast.js';
	import { assignNotebook, getNotebook } from '$lib/core/notebooks.js';
	import { setHomeNote, clearHomeNote, getHomeNoteGuid } from '$lib/core/home.js';
	import { isScrollBottomNote, setScrollBottomNote } from '$lib/core/scrollBottom.js';
	import { NoteLockController } from '$lib/collab/noteLockController.svelte.js';
	import { markAutoEdit, consumeAutoEdit } from '$lib/collab/autoEdit.js';
	import { tapSelection } from '$lib/editor/tapSelect/tapSelection.svelte.js';
	import { getTapSelectRanges } from '$lib/editor/tapSelect/tapSelectPlugin.js';

	// `$state.raw` for the large-content holders. Svelte's default deep
	// proxy traps every property read, and TipTap's Editor walks the full
	// content tree on construction (and on setContent for note switches)
	// — a 10k-node doc pays O(n) proxy allocations each time. These vars
	// are only ever reassigned (never mutated in place), so raw state is
	// both safe and significantly faster for big notes.
	let note: NoteData | undefined = $state.raw(undefined);
	let loading = $state(true);
	let saving = $state(false);
	let editorComponent: TomboyEditor | undefined = $state(undefined);
	let editorContent: JSONContent | undefined = $state.raw(undefined);
	let actionSheetOpen = $state(false);
	let pickerOpen = $state(false);
	let isHomeNoteState = $state(false);
	let isScrollBottomState = $state(false);
	let editorAreaEl: HTMLDivElement | undefined = $state(undefined);
	// Meta-bar dims once the user scrolls past the top so the buttons
	// don't obscure body text. Always fully opaque at scrollTop=0.
	let scrolled = $state(false);
	function handleEditorAreaScroll() {
		const el = editorAreaEl;
		if (!el) return;
		scrolled = el.scrollTop > 24;
	}

	let loadedGuid: string | null = null;
	let pendingDoc: JSONContent | null = $state.raw(null);
	// Fingerprint of the last successfully-flushed doc. flushSave() skips
	// calling updateNoteFromEditor() when the new doc stringifies to the
	// same value — this catches the type-and-undo case without paying for
	// a repository read + serializeContent() XML pass on every tick.
	let lastSavedDocFingerprint: string | null = null;

	// Content saves are debounced: each edit rearms a timer and flushSave
	// runs SAVE_DEBOUNCE_MS after the user stops typing. Idle tabs send
	// nothing beyond the lock heartbeat (30s) owned by the controller.
	const SAVE_DEBOUNCE_MS = 3000;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			if (!canEdit) return;
			void flushSave();
		}, SAVE_DEBOUNCE_MS);
	}
	function cancelScheduledSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
	}

	// Phase 4: the lock controller owns the 10s heartbeat + save ticker and
	// drives `editable` on the TipTap instance. One controller per opened
	// note; destroyed (releasing the lock) on navigation or unmount.
	let lockController = $state.raw<NoteLockController | undefined>(undefined);
	const lockState = $derived(lockController?.state ?? { kind: 'loading' as const });
	const canEdit = $derived(lockState.kind === 'held-by-me');

	// Sync content from remote snapshots when we're not the live editor.
	// While held-by-me TipTap is the source of truth — stomping it with
	// whatever Firestore just echoed back would jump the cursor.
	$effect(() => {
		const ctrl = lockController;
		if (!ctrl) return;
		const remote = ctrl.note;
		if (!remote) return;
		if (lockState.kind === 'held-by-me') {
			// Still mirror metadata (title/tags/dates) so the action sheet
			// reflects whatever just landed, but leave editor alone.
			note = remote;
			return;
		}
		if (note && remote.xmlContent === note.xmlContent) return;
		note = remote;
		editorContent = getNoteEditorContent(remote);
	});

	async function toggleLock() {
		const ctrl = lockController;
		if (!ctrl) return;
		if (lockState.kind === 'held-by-me') await ctrl.release();
		else if (lockState.kind === 'available') await ctrl.acquire();
	}

	const noteId = $derived(page.params.id);
	const isFromHome = $derived(page.url.searchParams.get('from') === 'home');
	const currentNotebook = $derived(note ? getNotebook(note) : null);
	const isFavoriteNote = $derived.by(() => {
		const n = note;
		return n ? isFavorite(n.guid) : false;
	});

	// Route 변경 시 에디터 콘텐츠 교체
	//
	// The TomboyEditor instance is created on first load and kept alive
	// for every subsequent note navigation — only its `content` /
	// `currentGuid` props change, which the editor reacts to internally
	// via setContent(). We deliberately do NOT clear `editorContent` /
	// `note` / `loading` here: those fields drive the conditional that
	// mounts the editor, and toggling them would force a remount (the
	// old pattern that this K-optimization undoes).
	$effect(() => {
		const id = noteId;
		if (!id || id === loadedGuid) return;
		loadedGuid = id;
		// New note → previous fingerprint doesn't apply anymore.
		lastSavedDocFingerprint = null;

		(async () => {
			// Navigating away from the previous note: flush any queued edits
			// and release that note's lock before we start listening on the
			// new one. Awaiting destroy makes the release reliable.
			if (lockController) {
				await flushSave();
				await lockController.destroy();
				lockController = undefined;
			}

			const loaded = await getNote(id);
			if (id !== noteId) return;
			if (!loaded) {
				goto('/');
				return;
			}
			note = loaded;
			editorContent = getNoteEditorContent(loaded);
			loading = false;

			lockController = new NoteLockController(id, flushSave);
			if (consumeAutoEdit(id)) {
				// Newly created note — the creator implicitly wants to edit it.
				void lockController.acquire();
			}

			const homeGuid = await getHomeNoteGuid();
			isHomeNoteState = homeGuid === id;

			isScrollBottomState = await isScrollBottomNote(id);
			if (isScrollBottomState) {
				// Wait for the editor to apply the new doc + layout before
				// scrolling. Two rAFs is enough with the reused-editor
				// model (setContent is synchronous but layout needs a
				// frame).
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						if (id !== noteId) return;
						scrollEditorToBottom();
					});
				});
			}
		})();
	});

	function scrollEditorToBottom() {
		const el = editorAreaEl;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}

	onMount(() => {
		// Best-effort save + release when the tab closes or navigates away.
		// `beforeunload` can't await async work, so we kick the write off
		// and let the browser drain it; a missed release expires via TTL.
		const handleBeforeUnload = () => {
			void flushSave();
			void lockController?.destroy();
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		tapSelection.registerCreateLinkedNote(handleCreateFromTapSelection);
		return () => {
			tapSelection.registerCreateLinkedNote(null);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			void flushSave();
			void lockController?.destroy();
		};
	});

	function handleEditorChange(doc: JSONContent) {
		// The editor fires onchange even while non-editable (e.g. plugin
		// metadata transactions), so gate on canEdit to avoid staging a
		// save that we'd immediately refuse to send.
		if (!canEdit) return;
		pendingDoc = doc;
		scheduleSave();
	}

	/**
	 * Flush pending editor content to the repository. Returns true when a
	 * write actually hit the backend (so the lock controller can
	 * distinguish "I saved" from "nothing to save" — both still heartbeat).
	 */
	async function flushSave(): Promise<boolean> {
		cancelScheduledSave();
		if (!pendingDoc || !note) return false;
		const fingerprint = JSON.stringify(pendingDoc);
		if (fingerprint === lastSavedDocFingerprint) {
			pendingDoc = null;
			return false;
		}
		saving = true;
		const updated = await updateNoteFromEditor(note.guid, pendingDoc);
		if (updated) note = updated;
		lastSavedDocFingerprint = fingerprint;
		pendingDoc = null;
		saving = false;
		return true;
	}

	async function handleInternalLink(target: string) {
		const title = target.trim();
		if (!title) return;

		await flushSave();

		const linked = await findNoteByTitle(title);
		if (!linked) {
			pushToast(`'${title}' 노트를 찾을 수 없습니다.`, { kind: 'error' });
			return;
		}
		if (linked.guid === noteId) return;
		goto(`/note/${linked.guid}`);
	}

	function getEditor(): Editor | null {
		return editorComponent?.getEditor() ?? null;
	}

	/**
	 * Mobile "새 노트" with an active tap selection. Mirrors handleExtractNote
	 * but reads the ranges out of the tap-select plugin instead of the
	 * editor's PM selection, since the editor is read-only during tap mode
	 * (no native selection to pull from). Acquires the lock on the fly so
	 * the link-mark write on the source note respects Phase 4 lock invariants
	 * — if another user is editing, we still create the target but skip the
	 * source mark and surface a toast.
	 */
	async function handleCreateFromTapSelection() {
		const raw = tapSelection.text;
		tapSelection.clear();
		const proposedTitle = raw ? raw.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
		if (!proposedTitle) {
			const n = await createNote();
			markAutoEdit(n.guid);
			goto(`/note/${n.guid}`);
			return;
		}

		const editor = getEditor();
		const ctrl = lockController;
		const ranges = editor ? getTapSelectRanges(editor.state) : [];

		let target = await findNoteByTitle(proposedTitle);
		if (!target) {
			target = await createNote(proposedTitle);
			markAutoEdit(target.guid);
		}

		const shouldLinkSource = editor && ctrl && ranges.length > 0 && target.guid !== noteId;
		if (shouldLinkSource) {
			if (ctrl.state.kind !== 'held-by-me') {
				await ctrl.acquire();
			}
			if (ctrl.state.kind === 'held-by-me') {
				const markType = editor.schema.marks.tomboyInternalLink;
				if (markType) {
					const tr = editor.state.tr;
					for (const r of ranges) {
						tr.addMark(r.from, r.to, markType.create({ target: proposedTitle }));
					}
					editor.view.dispatch(tr);
					pendingDoc = editor.getJSON();
					await flushSave();
				}
			} else {
				pushToast('편집 중인 사용자가 있어 링크를 걸 수 없습니다.', { kind: 'error' });
			}
		}

		editor?.commands.clearTapSelection();
		goto(`/note/${target.guid}`);
	}

	async function handleExtractNote() {
		const editor = getEditor();
		if (!editor) return;

		const { from, to, empty } = editor.state.selection;
		if (empty || from === to) return;

		const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
		if (!selectedText) return;

		const title = selectedText.length > 120 ? selectedText.slice(0, 120) : selectedText;
		const existing = await findNoteByTitle(title);
		let target = existing;
		if (!target) {
			target = await createNote(title);
			markAutoEdit(target.guid);
		}

		editor
			.chain()
			.focus()
			.setTextSelection({ from, to })
			.setTomboyInternalLink({ target: title })
			.run();

		pendingDoc = editor.getJSON();
		await flushSave();

		goto(`/note/${target.guid}`);
	}

	async function handleAction(kind: ActionKind) {
		actionSheetOpen = false;

		if (kind === 'delete') {
			pendingDoc = null;
			await lockController?.destroy();
			lockController = undefined;
			await deleteNoteById(note!.guid);
			pushToast('삭제되었습니다.');
			goto('/');
			return;
		}

		if (kind === 'toggleFavorite') {
			const added = await toggleFavorite(note!.guid);
			pushToast(added ? '즐겨찾기에 추가되었습니다.' : '즐겨찾기에서 제거되었습니다.');
			return;
		}

		if (kind === 'setHome') {
			await setHomeNote(note!.guid);
			isHomeNoteState = true;
			pushToast('홈 노트로 지정되었습니다.');
			return;
		}

		if (kind === 'unsetHome') {
			await clearHomeNote();
			isHomeNoteState = false;
			pushToast('홈 노트 지정이 해제되었습니다.');
			return;
		}

		if (kind === 'pickNotebook') {
			pickerOpen = true;
			return;
		}

		if (kind === 'toggleScrollBottom') {
			const next = !isScrollBottomState;
			await setScrollBottomNote(note!.guid, next);
			isScrollBottomState = next;
			pushToast(next ? '이 노트는 열 때 항상 맨 아래로 이동합니다.' : '맨 아래 이동이 해제되었습니다.');
			if (next) scrollEditorToBottom();
			return;
		}
	}

	async function gotoRandom() {
		const all = (await listNotes()).filter((n) => n.guid !== noteId);
		if (all.length === 0) return;
		const picked = all[Math.floor(Math.random() * all.length)];
		goto(`/note/${picked.guid}?from=home`);
	}

	function todayTitle(): string {
		const d = new Date();
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	async function gotoToday() {
		const title = todayTitle();
		const existing = await findNoteByTitle(title);
		if (existing) {
			if (existing.guid === noteId) return;
			goto(`/note/${existing.guid}?from=home`);
			return;
		}
		const created = await createNote(title);
		markAutoEdit(created.guid);
		goto(`/note/${created.guid}?from=home`);
	}

	async function handleNotebookSelect(name: string | null) {
		if (!note) return;
		await flushSave();
		await assignNotebook(note.guid, name);
		const updated = await getNote(note.guid);
		if (updated) note = updated;
		pickerOpen = false;
		pushToast('노트북이 변경되었습니다.');
	}
</script>

<div class="editor-page">
	{#if lockState.kind === 'held-by-other'}
		<div class="lock-banner" role="status">
			<span class="lock-icon">🔒</span>
			<span class="lock-msg">
				{lockState.holderName ?? '다른 사용자'}님이 편집 중입니다.
				읽기 전용 모드입니다.
			</span>
		</div>
	{/if}

	<!-- 저장 상태 + 노트북/액션 버튼을 에디터 위 간결한 바로 -->
	<div class="editor-meta-bar" class:scrolled>
		<span class="save-indicator" class:visible={saving}>저장 중...</span>
		{#if note}
			<button
				class="lock-toggle"
				class:active={lockState.kind === 'held-by-me'}
				class:readonly={lockState.kind === 'held-by-other'}
				onclick={toggleLock}
				disabled={lockState.kind === 'held-by-other' || lockState.kind === 'loading'}
				title={
					lockState.kind === 'held-by-me' ? '편집 종료' :
					lockState.kind === 'held-by-other' ? `${lockState.holderName ?? '다른 사용자'}님이 편집 중` :
					lockState.kind === 'available' ? '편집 시작' :
					lockState.kind === 'loading' ? '로딩 중' : '오류'
				}
			>
				{#if lockState.kind === 'held-by-me'}✏️ 편집 중
				{:else if lockState.kind === 'held-by-other'}👀 읽기 전용
				{:else if lockState.kind === 'available'}✎ 편집
				{:else if lockState.kind === 'loading'}…
				{:else}!
				{/if}
			</button>
			<button
				class="notebook-chip"
				onclick={() => (pickerOpen = true)}
				title="노트북"
			>
				{#if currentNotebook}
					🗂 {currentNotebook}
				{:else}
					🗂
				{/if}
			</button>
			<button
				class="action-btn"
				onclick={() => (actionSheetOpen = true)}
				title="더 보기"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
				</svg>
			</button>
		{/if}
	</div>

	<div class="editor-area" bind:this={editorAreaEl} onscroll={handleEditorAreaScroll}>
		{#if loading}
			<div class="loading">로딩 중...</div>
		{:else if editorContent}
			<!--
				No {#key noteId} — TomboyEditor stays mounted across note
				navigations and reacts to `content` / `currentGuid` prop
				changes internally via setContent(). Destroying and
				recreating the editor on every transition rebuilt the PM
				schema + all extensions + DOM and was the dominant cost
				in "open a new note" lag.
			-->
			<TomboyEditor
				bind:this={editorComponent}
				content={editorContent}
				onchange={handleEditorChange}
				oninternallink={handleInternalLink}
				currentGuid={noteId}
				createDate={note?.createDate ?? null}
				editable={canEdit}
				enableTapSelect
			/>
		{/if}
	</div>

	<div class="toolbar-area">
		<Toolbar
			editor={getEditor()}
			onextractnote={handleExtractNote}
			onuploadimage={(file) => editorComponent?.uploadAndInsertImage(file)}
		/>
	</div>

	{#if isFromHome}
		<button class="fab-today" onclick={gotoToday} aria-label="오늘 날짜 노트">📅</button>
		<button class="fab-random" onclick={gotoRandom} aria-label="랜덤 노트">🎲</button>
	{/if}
</div>

{#if actionSheetOpen && note}
	<NoteActionSheet
		{note}
		isFavoriteNote={isFavoriteNote}
		isHomeNote={isHomeNoteState}
		isScrollBottomNote={isScrollBottomState}
		onaction={handleAction}
		onclose={() => (actionSheetOpen = false)}
		ongoto={(guid) => { actionSheetOpen = false; goto(`/note/${guid}`); }}
	/>
{/if}

{#if pickerOpen && note}
	<NotebookPicker
		current={currentNotebook}
		onselect={handleNotebookSelect}
		onclose={() => (pickerOpen = false)}
	/>
{/if}

<style>
	.editor-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		position: relative;
	}

	.lock-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		background: #fff7e6;
		color: #7a4a00;
		border-bottom: 1px solid #f5cf86;
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.lock-icon {
		flex-shrink: 0;
	}

	.lock-msg {
		flex: 1;
	}

	.editor-meta-bar {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		padding: 4px;
		z-index: 5;
		pointer-events: none;
		opacity: 1;
		transition: opacity 0.2s;
	}

	/* While scrolled past the top, fade the bar so it doesn't obscure the
	   body text behind it. Pointing at it restores full opacity. */
	.editor-meta-bar.scrolled {
		opacity: 0.35;
	}

	.editor-meta-bar.scrolled:hover,
	.editor-meta-bar.scrolled:has(:focus-visible) {
		opacity: 1;
	}

	.save-indicator,
	.notebook-chip,
	.action-btn,
	.lock-toggle {
		pointer-events: auto;
	}

	.lock-toggle {
		flex-shrink: 0;
		padding: 4px 10px;
		border: none;
		border-radius: 12px;
		font-size: 0.8rem;
		cursor: pointer;
		background: rgba(240, 240, 240, 0.92);
		color: #444;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.lock-toggle.active {
		background: rgba(199, 237, 199, 0.95);
		color: #14532d;
	}

	.lock-toggle.readonly {
		background: rgba(238, 224, 196, 0.92);
		color: #7a4a00;
	}

	.lock-toggle:disabled {
		cursor: default;
	}

	.save-indicator {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		margin-right: auto;
		opacity: 0;
		transition: opacity 0.2s;
	}

	.save-indicator.visible {
		opacity: 1;
	}

	.notebook-chip {
		flex-shrink: 0;
		background: rgba(232, 240, 254, 0.92);
		backdrop-filter: blur(6px);
		color: #1a73e8;
		border: none;
		border-radius: 12px;
		padding: 4px 10px;
		font-size: 0.8rem;
		cursor: pointer;
		max-width: 120px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(6px);
		border-radius: 50%;
		color: var(--color-text-secondary);
		flex-shrink: 0;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.action-btn:active {
		background: var(--color-bg-secondary);
	}

	.editor-area {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		/* Size container for image previews (max-height: 100cqh inside
		   TomboyEditor). Safe here: .editor-area has a definite height
		   via flex:1 in the .editor-page flex column. */
		container-type: size;
	}

	.toolbar-area {
		flex-shrink: 0;
		background: #f8f9fa;
	}

	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-secondary);
	}

	.fab-random {
		position: absolute;
		bottom: 88px;
		right: 20px;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: none;
		background: var(--color-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		font-size: 1.4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 10;
	}

	.fab-random:active {
		transform: scale(0.93);
	}

	.fab-today {
		position: absolute;
		bottom: calc(88px + 56px);
		right: 20px;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: none;
		background: var(--color-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		font-size: 1.4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 10;
	}

	.fab-today:active {
		transform: scale(0.93);
	}
</style>
