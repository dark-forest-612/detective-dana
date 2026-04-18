// Read-mode tap-to-select ProseMirror plugin.
//
// On the mobile /note/[id] route, while the editor is read-only, tapping a
// word selects it; tapping adjacent words extends the selection; tapping a
// selected word deselects it; tapping a word outside the current block or
// non-adjacent within the block replaces the selection with just that word.
//
// Adjacency is whitespace-only: two word ranges are adjacent when the text
// between them in their shared block contains no non-whitespace characters.
// This lets a user tap across a multi-space gap and still extend.
//
// Selection state lives in plugin state and renders as inline decorations
// (no doc mutation — the note is read-only). Any docChanged transaction
// (e.g. the editor becoming editable and the user typing, or a remote
// snapshot arriving) clears the selection so positions can't drift.

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface WordRange {
	from: number;
	to: number;
}

export interface TapSelectState {
	blockStart: number | null;
	blockEnd: number | null;
	words: WordRange[];
}

type Meta =
	| { type: 'set'; blockStart: number; blockEnd: number; words: WordRange[] }
	| { type: 'clear' };

export const tapSelectPluginKey = new PluginKey<TapSelectState>('tomboyTapSelect');

const EMPTY_STATE: TapSelectState = { blockStart: null, blockEnd: null, words: [] };

export interface TapSelectPluginOptions {
	onSelectionChange?: (text: string | null) => void;
}

// PM's textBetween substitutes this for non-text nodes (images, etc.) when
// given as a `leafText`. We treat it as a word separator so images break
// the selectable run.
const LEAF_MARKER = '\ufffc';

function isWordChar(ch: string): boolean {
	return ch.length > 0 && ch !== LEAF_MARKER && !/\s/.test(ch);
}

function blockTextOf(block: PMNode): string {
	return block.textBetween(0, block.content.size, LEAF_MARKER, LEAF_MARKER);
}

/**
 * Resolve a document position into the word at that position, plus the
 * enclosing textblock's bounds. Returns null when the position doesn't
 * land inside a textblock, or lands on whitespace / a leaf node.
 */
export function findWordAt(
	doc: PMNode,
	pos: number,
): { word: WordRange; blockStart: number; blockEnd: number } | null {
	const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
	// Walk up to the nearest textblock.
	let depth = $pos.depth;
	while (depth > 0 && !$pos.node(depth).isTextblock) depth--;
	const block = $pos.node(depth);
	if (!block.isTextblock) return null;
	const blockStart = $pos.start(depth);
	const blockEnd = $pos.end(depth);

	const text = blockTextOf(block);
	// Position within the block's text. $pos.parentOffset gives the offset
	// in *content size* which, for a textblock, matches the textBetween
	// offset we used (LEAF_MARKER is a single char just like the leaf node's
	// size of 1).
	let offset = pos - blockStart;
	if (offset < 0) offset = 0;
	if (offset > text.length) offset = text.length;

	// If the offset lands between characters, try the character at offset
	// first, then the one before — so a tap at the trailing edge of a word
	// still selects it.
	let cursor = -1;
	if (offset < text.length && isWordChar(text[offset])) cursor = offset;
	else if (offset > 0 && isWordChar(text[offset - 1])) cursor = offset - 1;
	if (cursor < 0) return null;

	let from = cursor;
	while (from > 0 && isWordChar(text[from - 1])) from--;
	let to = cursor + 1;
	while (to < text.length && isWordChar(text[to])) to++;

	return {
		word: { from: blockStart + from, to: blockStart + to },
		blockStart,
		blockEnd,
	};
}

function rangesEqual(a: WordRange, b: WordRange): boolean {
	return a.from === b.from && a.to === b.to;
}

function hasOnlyWhitespace(block: PMNode, blockStart: number, from: number, to: number): boolean {
	if (to <= from) return true;
	const slice = block.textBetween(from - blockStart, to - blockStart, LEAF_MARKER, LEAF_MARKER);
	return !/\S/.test(slice) && !slice.includes(LEAF_MARKER);
}

/**
 * Given the current selection and a newly tapped word in the same block,
 * compute the next selection according to the tap rules.
 */
export function applyTap(
	prev: TapSelectState,
	block: PMNode,
	hit: { word: WordRange; blockStart: number; blockEnd: number },
): TapSelectState {
	const { word, blockStart, blockEnd } = hit;

	// Different block → replace selection.
	if (prev.blockStart !== blockStart) {
		return { blockStart, blockEnd, words: [word] };
	}

	// Deselect if the word is already in the set.
	const existingIdx = prev.words.findIndex((w) => rangesEqual(w, word));
	if (existingIdx >= 0) {
		const next = prev.words.slice();
		next.splice(existingIdx, 1);
		if (next.length === 0) return EMPTY_STATE;
		return { blockStart, blockEnd, words: next };
	}

	// Adjacent to any existing word? (whitespace-only gap in shared block)
	const adjacent = prev.words.some((w) => {
		if (word.to <= w.from) {
			return hasOnlyWhitespace(block, blockStart, word.to, w.from);
		}
		if (w.to <= word.from) {
			return hasOnlyWhitespace(block, blockStart, w.to, word.from);
		}
		// Overlap shouldn't happen (word boundaries are fixed), but treat
		// as adjacent to be safe.
		return true;
	});

	if (adjacent) {
		const next = [...prev.words, word].sort((a, b) => a.from - b.from);
		return { blockStart, blockEnd, words: next };
	}

	return { blockStart, blockEnd, words: [word] };
}

/**
 * Merge whitespace-adjacent words into a single range for rendering, so the
 * highlight doesn't have gaps between consecutive selected words.
 */
function mergeForDecoration(
	state: TapSelectState,
	doc: PMNode,
): WordRange[] {
	if (state.words.length === 0 || state.blockStart === null) return [];
	const block = doc.resolve(state.blockStart).parent;
	const merged: WordRange[] = [];
	for (const w of state.words) {
		const last = merged[merged.length - 1];
		if (last && hasOnlyWhitespace(block, state.blockStart, last.to, w.from)) {
			last.to = w.to;
		} else {
			merged.push({ ...w });
		}
	}
	return merged;
}

/**
 * Public helper for callers that want to apply a mark to whatever the user
 * has tapped (e.g. the "새 노트 from selection" flow, which needs to mark
 * the source text as an internal link — same positions the decorations
 * are rendered at). Returns merged, contiguous ranges; empty when nothing
 * is currently selected.
 */
export function getTapSelectRanges(state: EditorState): WordRange[] {
	const s = tapSelectPluginKey.getState(state);
	if (!s || s.words.length === 0 || s.blockStart === null) return [];
	return mergeForDecoration(s, state.doc);
}

function selectionText(state: TapSelectState, doc: PMNode): string {
	if (state.words.length === 0) return '';
	const parts = state.words.map((w) => doc.textBetween(w.from, w.to, ' ', ' '));
	return parts.join(' ').trim();
}

export function createTapSelectPlugin(options: TapSelectPluginOptions = {}): Plugin<TapSelectState> {
	return new Plugin<TapSelectState>({
		key: tapSelectPluginKey,
		state: {
			init: () => EMPTY_STATE,
			apply(tr, value) {
				const meta = tr.getMeta(tapSelectPluginKey) as Meta | undefined;
				if (meta) {
					if (meta.type === 'clear') return EMPTY_STATE;
					return { blockStart: meta.blockStart, blockEnd: meta.blockEnd, words: meta.words };
				}
				// Any real doc change invalidates our positions — the plugin is
				// meant for a read-only doc, so this is mostly a safety net for
				// the editable→read-only→editable transition.
				if (tr.docChanged) return EMPTY_STATE;
				return value;
			},
		},
		props: {
			decorations(state: EditorState) {
				const s = tapSelectPluginKey.getState(state);
				if (!s || s.words.length === 0) return DecorationSet.empty;
				const ranges = mergeForDecoration(s, state.doc);
				const decos = ranges.map((r) =>
					Decoration.inline(r.from, r.to, { class: 'tomboy-tap-select' }),
				);
				return DecorationSet.create(state.doc, decos);
			},
			handleClick(view: EditorView, pos: number, event: MouseEvent) {
				if (view.editable) return false;
				// Let link-target elements through so other handlers (internal
				// link navigation, native URL navigation) still fire.
				const target = event.target as HTMLElement | null;
				if (target?.closest('a[data-link-target], a[href]')) return false;
				const hit = findWordAt(view.state.doc, pos);
				if (!hit) return false;
				const prev = tapSelectPluginKey.getState(view.state) ?? EMPTY_STATE;
				const block = view.state.doc.resolve(hit.blockStart).parent;
				const next = applyTap(prev, block, hit);
				view.dispatch(
					view.state.tr.setMeta(tapSelectPluginKey, {
						type: 'set',
						blockStart: next.blockStart ?? hit.blockStart,
						blockEnd: next.blockEnd ?? hit.blockEnd,
						words: next.words,
					}),
				);
				return true;
			},
		},
		view() {
			let lastText: string | null = null;
			return {
				update(view, prevState) {
					const cur = tapSelectPluginKey.getState(view.state);
					const old = tapSelectPluginKey.getState(prevState);
					if (cur === old) return;
					const text = cur && cur.words.length > 0 ? selectionText(cur, view.state.doc) : '';
					const normalized = text.length > 0 ? text : null;
					if (normalized === lastText) return;
					lastText = normalized;
					options.onSelectionChange?.(normalized);
				},
				destroy() {
					if (lastText !== null) options.onSelectionChange?.(null);
				},
			};
		},
	});
}
