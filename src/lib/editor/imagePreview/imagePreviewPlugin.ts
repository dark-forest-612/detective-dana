/**
 * ProseMirror plugin that renders inline image previews for image URLs
 * found in text, and makes each preview behave like a single atomic
 * character from the user's perspective.
 *
 * UX:
 *   - While the <img> is still loading, the URL text stays visible so the
 *     user sees what address is being fetched. Once the image's `load`
 *     event fires we hide the URL and reveal the image in its place.
 *   - A widget decoration shows the actual <img> at the URL's end.
 *   - Backspace / Delete at a URL boundary deletes the WHOLE URL text.
 *   - ArrowLeft / ArrowRight at a URL boundary skips past the hidden text.
 *   - Clicking the image dispatches `onImageClick(href)` so the consumer
 *     can open a viewer modal. (Deletion remains via Backspace at the URL
 *     end — see `handleAtomicKey`.)
 *
 * Invariant: the document itself is NEVER modified by rendering. The URL
 * stays in the doc (and in any surrounding `tomboyUrlLink` mark) verbatim
 * so the Tomboy `.note` XML round-trip is stable. Only *user-driven* key
 * actions mutate the doc, and when they do, they delete the WHOLE URL —
 * keeping "image acts like a character" semantics.
 */

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { isImageUrl } from './isImageUrl.js';

export const imagePreviewPluginKey = new PluginKey<PluginState>('tomboyImagePreview');

export interface ImagePreviewOptions {
	/** Called when the user clicks an inline image preview. */
	onImageClick?: (href: string) => void;
}

export interface ImageUrlRange {
	/** Absolute doc position of the URL's first character. */
	from: number;
	/** Absolute doc position immediately after the URL's last character. */
	to: number;
	/** The image URL. */
	href: string;
}

interface PluginState {
	decorations: DecorationSet;
	ranges: ImageUrlRange[];
	/** Hrefs whose <img> has fired `load` at least once. Persists across doc
	 *  changes so a URL re-typed after deletion stays "loaded" (the browser
	 *  cache will satisfy the new <img> immediately, but we don't need to
	 *  flicker the URL text in/out while we wait for the synthetic load). */
	loaded: Set<string>;
}

/** Meta payload to mark a URL as fully loaded; the widget's onload handler
 *  dispatches this so the plugin can hide the URL text on the next pass. */
interface ImagePreviewMeta {
	loadedHref?: string;
}

// Match http(s) URLs up to the next whitespace / quote / angle bracket.
// Deliberately permissive on URL contents — the caller trims trailing
// punctuation and validates the result via `isImageUrl`.
const URL_RE = /https?:\/\/[^\s<>"']+/g;

// Trailing characters that are almost always sentence/prose punctuation
// rather than part of a URL. Trimmed off before validating.
const TRAILING_PUNCT_RE = /[.,;:!?)\]\}>]+$/;

/**
 * Scan the doc for image-URL substrings in any text node and return their
 * absolute `[from, to)` positions plus the cleaned href. Exported for testing.
 */
export function findImageUrlRanges(doc: PMNode): ImageUrlRange[] {
	const out: ImageUrlRange[] = [];

	doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return;
		const text = node.text;
		URL_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = URL_RE.exec(text)) !== null) {
			let url = m[0];
			while (true) {
				const trimmed = url.replace(TRAILING_PUNCT_RE, '');
				if (trimmed === url) break;
				url = trimmed;
			}
			if (!url || !isImageUrl(url)) continue;

			const startInText = m.index;
			const endInText = startInText + url.length;
			out.push({
				from: pos + startInText,
				to: pos + endInText,
				href: url
			});
		}
	});

	return out;
}

function buildState(
	doc: PMNode,
	opts: ImagePreviewOptions,
	loaded: Set<string>
): PluginState {
	const ranges = findImageUrlRanges(doc);
	if (ranges.length === 0) {
		return { decorations: DecorationSet.empty, ranges, loaded };
	}

	const decos: Decoration[] = [];
	for (const r of ranges) {
		const isLoaded = loaded.has(r.href);
		// Only hide the URL once the image is on screen — until then the
		// user keeps seeing what URL is being fetched. inclusiveStart/End:
		// false so that user-typed chars at either boundary don't get
		// absorbed into the hidden range.
		if (isLoaded) {
			decos.push(
				Decoration.inline(
					r.from,
					r.to,
					{ class: 'tomboy-image-url-hidden' },
					{ inclusiveStart: false, inclusiveEnd: false }
				)
			);
		}
		// Image widget at the URL end. The key includes the load state so
		// PM tears down the loading-state widget and rebuilds with the
		// loaded styling — the browser cache satisfies the new <img>
		// immediately, so this isn't a re-fetch.
		//
		// `side: -1` associates the widget with the character before its
		// position (the URL's last char). That makes a caret at `to` render
		// AFTER the image, while a caret at `from` renders before — the
		// "image acts like a character with positions on either side"
		// semantics from the spec. The atomic-key handler swaps `from` ↔
		// `to` on ArrowLeft/ArrowRight, so both sides are reachable.
		decos.push(
			Decoration.widget(r.to, (view) => renderImagePreview(r, opts, view, isLoaded), {
				side: -1,
				key: `img:${r.from}:${r.to}:${r.href}:${isLoaded ? 'loaded' : 'loading'}`
			})
		);
	}
	return { decorations: DecorationSet.create(doc, decos), ranges, loaded };
}

function renderImagePreview(
	range: ImageUrlRange,
	opts: ImagePreviewOptions,
	view: EditorView,
	isLoaded: boolean
): HTMLElement {
	const img = document.createElement('img');
	img.src = range.href;
	img.alt = '';
	img.className = isLoaded ? 'tomboy-image-preview' : 'tomboy-image-preview tomboy-image-loading';
	// Decode synchronously when possible so the widget swap happens in the
	// same paint that hides the URL — avoids a one-frame flash of empty.
	img.decoding = 'async';
	img.setAttribute('contenteditable', 'false');
	img.draggable = false;

	if (!isLoaded) {
		const onLoad = () => {
			img.removeEventListener('load', onLoad);
			img.removeEventListener('error', onLoad);
			view.dispatch(
				view.state.tr.setMeta(imagePreviewPluginKey, {
					loadedHref: range.href
				} satisfies ImagePreviewMeta)
			);
		};
		img.addEventListener('load', onLoad);
		// On error we still flip to "loaded" so the user isn't stuck staring
		// at the URL forever; the broken-image glyph will appear in place.
		img.addEventListener('error', onLoad);
		// Cached images may have already completed by the time we attach
		// the listener — handle that synchronously.
		if (img.complete && img.naturalWidth > 0) {
			queueMicrotask(onLoad);
		}
	}

	// Click on the image → open the viewer modal. Deletion still works via
	// Backspace immediately after the (hidden) URL — see `handleAtomicKey`.
	img.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		opts.onImageClick?.(range.href);
	});

	return img;
}

export type AtomicKey = 'Backspace' | 'Delete' | 'ArrowLeft' | 'ArrowRight';

/**
 * Pure helper: given the current editor state, the plugin's known ranges
 * and a pressed key, return a transaction that applies atomic-character
 * behavior to the key — or `null` if the key should be handled normally.
 *
 * Exported for direct testing. The plugin's handleKeyDown just wires this
 * up to view.dispatch.
 */
export function handleAtomicKey(
	state: EditorState,
	ranges: ImageUrlRange[],
	key: AtomicKey
): Transaction | null {
	const { selection } = state;
	if (!selection.empty) return null;
	const pos = selection.from;

	switch (key) {
		case 'Backspace': {
			const r = ranges.find((r) => r.to === pos);
			if (!r) return null;
			return state.tr.delete(r.from, r.to);
		}
		case 'Delete': {
			const r = ranges.find((r) => r.from === pos);
			if (!r) return null;
			return state.tr.delete(r.from, r.to);
		}
		case 'ArrowLeft': {
			const r = ranges.find((r) => r.to === pos);
			if (!r) return null;
			return state.tr.setSelection(TextSelection.create(state.doc, r.from));
		}
		case 'ArrowRight': {
			const r = ranges.find((r) => r.from === pos);
			if (!r) return null;
			return state.tr.setSelection(TextSelection.create(state.doc, r.to));
		}
	}
}

function keyFromEvent(e: KeyboardEvent): AtomicKey | null {
	// Any modifier that changes the semantic action (ctrl/meta for word-skip /
	// select-to, alt for word, shift for selection extend) falls through to the
	// browser / other handlers. We only intercept the pure character-nav keys.
	if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
	if (e.key === 'Backspace' || e.key === 'Delete') return e.key;
	if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return e.key;
	return null;
}

export function createImagePreviewPlugin(opts: ImagePreviewOptions = {}): Plugin<PluginState> {
	return new Plugin<PluginState>({
		key: imagePreviewPluginKey,
		state: {
			init: (_, s) => buildState(s.doc, opts, new Set<string>()),
			apply(tr, old) {
				const meta = tr.getMeta(imagePreviewPluginKey) as ImagePreviewMeta | undefined;
				let loaded = old.loaded;
				if (meta?.loadedHref && !loaded.has(meta.loadedHref)) {
					loaded = new Set(loaded);
					loaded.add(meta.loadedHref);
				}
				if (!tr.docChanged && loaded === old.loaded) return old;
				return buildState(tr.doc, opts, loaded);
			}
		},
		props: {
			decorations(state) {
				return imagePreviewPluginKey.getState(state)?.decorations;
			},
			handleKeyDown(view, event) {
				const k = keyFromEvent(event);
				if (!k) return false;
				const st = imagePreviewPluginKey.getState(view.state);
				if (!st || st.ranges.length === 0) return false;
				const tr = handleAtomicKey(view.state, st.ranges, k);
				if (!tr) return false;
				view.dispatch(tr);
				return true;
			}
		}
	});
}
