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
// In addition to single taps, a drag gesture (mouse drag, or touch
// long-press + drag) selects a contiguous range of words within the block
// the drag started in — so users can sweep over a phrase instead of tapping
// each word. Touch needs the long-press gate so plain vertical drags still
// scroll the page.
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

export interface TapSelectionInfo {
	text: string;
	rect: { left: number; top: number; right: number; bottom: number } | null;
}

export interface TapSelectPluginOptions {
	onSelectionChange?: (info: TapSelectionInfo | null) => void;
}

// PM's textBetween substitutes this for non-text nodes (images, etc.) when
// given as a `leafText`. We treat it as a word separator so images break
// the selectable run.
const LEAF_MARKER = '\ufffc';

// Minimum pointer movement (in CSS pixels) before we treat a press as a
// drag rather than a tap. Mouse uses the smaller threshold; touch uses a
// larger one because finger jitter is normal during a "stationary" press.
const MOUSE_DRAG_THRESHOLD_PX = 4;
const TOUCH_DRAG_THRESHOLD_PX = 10;
// Touch needs to hold still this long before a drag-select can begin —
// otherwise a normal vertical scroll would steal text.
const TOUCH_LONG_PRESS_MS = 280;

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

/**
 * Find every word range in a block that overlaps the [from, to] character
 * range (positions in document space). Used by drag-select to expand a
 * pointer-defined range into the set of words it covers.
 */
export function findWordsInRange(
	block: PMNode,
	blockStart: number,
	from: number,
	to: number,
): WordRange[] {
	if (to < from) [from, to] = [to, from];
	const text = blockTextOf(block);
	const lo = Math.max(0, from - blockStart);
	const hi = Math.min(text.length, to - blockStart);
	const words: WordRange[] = [];
	let i = 0;
	while (i < text.length) {
		if (!isWordChar(text[i])) {
			i++;
			continue;
		}
		let j = i;
		while (j < text.length && isWordChar(text[j])) j++;
		// Overlap test against [lo, hi]. A zero-width range (lo === hi) still
		// counts as touching the word it lands inside, so we include words
		// that strictly contain the cursor.
		const overlaps = i < hi && j > lo;
		const touches = lo === hi && i <= lo && lo <= j;
		if (overlaps || touches) {
			words.push({ from: blockStart + i, to: blockStart + j });
		}
		i = j;
	}
	return words;
}

function rangesEqual(a: WordRange, b: WordRange): boolean {
	return a.from === b.from && a.to === b.to;
}

// Tomboy convention: the first block of the doc IS the note title. Tapping
// anywhere on it selects the whole title in one shot — usually the user is
// about to link the title from elsewhere, so single-word taps are awkward.
function isTitleBlockStart(doc: PMNode, blockStart: number): boolean {
	if (doc.childCount === 0) return false;
	return blockStart === 1;
}

function wordsEqual(a: WordRange[], b: WordRange[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!rangesEqual(a[i], b[i])) return false;
	return true;
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

/**
 * Bounding box of the rendered selection decorations in viewport
 * coordinates. Returns null when no decoration is currently mounted (e.g.
 * the selection just cleared, or the view detached).
 */
function selectionRect(view: EditorView): TapSelectionInfo['rect'] {
	const nodes = view.dom.querySelectorAll('.tomboy-tap-select');
	if (nodes.length === 0) return null;
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const n of nodes) {
		const r = (n as HTMLElement).getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		if (r.left < left) left = r.left;
		if (r.top < top) top = r.top;
		if (r.right > right) right = r.right;
		if (r.bottom > bottom) bottom = r.bottom;
	}
	if (!isFinite(left)) return null;
	return { left, top, right, bottom };
}

interface DragState {
	pointerId: number;
	pointerType: string;
	startX: number;
	startY: number;
	startPos: number;
	startWord: WordRange;
	blockStart: number;
	blockEnd: number;
	armed: boolean;
	armTimer: ReturnType<typeof setTimeout> | null;
}

function dispatchSelection(
	view: EditorView,
	blockStart: number,
	blockEnd: number,
	words: WordRange[],
): void {
	view.dispatch(
		view.state.tr.setMeta(tapSelectPluginKey, {
			type: 'set',
			blockStart,
			blockEnd,
			words,
		}),
	);
}

export function createTapSelectPlugin(options: TapSelectPluginOptions = {}): Plugin<TapSelectState> {
	let drag: DragState | null = null;
	// Set true the moment a pointerdown turns into a drag — used to
	// suppress the browser's synthetic click that follows mouseup, so the
	// drag selection isn't immediately replaced by a tap on whichever
	// word the pointer happened to release over.
	let suppressNextClick = false;

	function clearArmTimer(): void {
		if (drag?.armTimer) {
			clearTimeout(drag.armTimer);
			drag.armTimer = null;
		}
	}

	function endDrag(): void {
		clearArmTimer();
		drag = null;
	}

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
				if (suppressNextClick) {
					suppressNextClick = false;
					return true;
				}
				// Let link-target elements through so other handlers (internal
				// link navigation, native URL navigation) still fire.
				const target = event.target as HTMLElement | null;
				if (target?.closest('a[data-link-target], a[href]')) return false;
				const hit = findWordAt(view.state.doc, pos);
				if (!hit) return false;
				const prev = tapSelectPluginKey.getState(view.state) ?? EMPTY_STATE;
				const block = view.state.doc.resolve(hit.blockStart).parent;

				if (isTitleBlockStart(view.state.doc, hit.blockStart)) {
					const allWords = findWordsInRange(
						block,
						hit.blockStart,
						hit.blockStart,
						hit.blockEnd,
					);
					const fullySelected =
						prev.blockStart === hit.blockStart && wordsEqual(prev.words, allWords);
					if (fullySelected) {
						view.dispatch(view.state.tr.setMeta(tapSelectPluginKey, { type: 'clear' }));
					} else {
						dispatchSelection(view, hit.blockStart, hit.blockEnd, allWords);
					}
					return true;
				}

				const next = applyTap(prev, block, hit);
				dispatchSelection(
					view,
					next.blockStart ?? hit.blockStart,
					next.blockEnd ?? hit.blockEnd,
					next.words,
				);
				return true;
			},
			handleDOMEvents: {
				pointerdown(view, event) {
					if (view.editable) return false;
					// Only primary-button presses initiate a drag (mouse middle/right
					// stay reserved for browser-native context menu, etc.).
					if (event.button !== undefined && event.button !== 0) return false;
					const target = event.target as HTMLElement | null;
					if (target?.closest('a[data-link-target], a[href]')) return false;

					const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
					if (!coords) return false;
					const hit = findWordAt(view.state.doc, coords.pos);
					if (!hit) return false;

					endDrag();
					drag = {
						pointerId: event.pointerId,
						pointerType: event.pointerType ?? 'mouse',
						startX: event.clientX,
						startY: event.clientY,
						startPos: coords.pos,
						startWord: hit.word,
						blockStart: hit.blockStart,
						blockEnd: hit.blockEnd,
						armed: false,
						armTimer: null,
					};
					if (drag.pointerType === 'touch') {
						// Wait for a long-press before claiming the gesture. If
						// the user starts moving before the timer fires, we
						// treat it as a scroll and abandon drag selection.
						drag.armTimer = setTimeout(() => {
							if (!drag) return;
							drag.armTimer = null;
							drag.armed = true;
						}, TOUCH_LONG_PRESS_MS);
					} else {
						drag.armed = true;
					}
					return false;
				},
				pointermove(view, event) {
					const d = drag;
					if (!d || event.pointerId !== d.pointerId) return false;
					const dx = event.clientX - d.startX;
					const dy = event.clientY - d.startY;
					const dist2 = dx * dx + dy * dy;

					if (!d.armed) {
						// Touch: any movement before the long-press fires aborts
						// the gesture so the page can scroll instead.
						if (d.pointerType === 'touch' && dist2 > 16) {
							endDrag();
						}
						return false;
					}

					const threshold =
						d.pointerType === 'touch'
							? TOUCH_DRAG_THRESHOLD_PX
							: MOUSE_DRAG_THRESHOLD_PX;
					if (!suppressNextClick && dist2 < threshold * threshold) return false;

					const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
					if (!coords) return false;
					// Constrain the drag to the block it started in. Pointer
					// excursions outside that block clamp to its bounds so the
					// selection stays single-block (matches the tap model).
					const clamped = Math.max(d.blockStart, Math.min(d.blockEnd, coords.pos));
					const block = view.state.doc.resolve(d.blockStart).parent;
					const lo = Math.min(d.startPos, clamped);
					const hi = Math.max(d.startPos, clamped);
					let words = findWordsInRange(block, d.blockStart, lo, hi);
					if (words.length === 0) {
						// Drag landed entirely on whitespace; keep at least the
						// origin word so the user has feedback.
						words = [d.startWord];
					}
					dispatchSelection(view, d.blockStart, d.blockEnd, words);

					suppressNextClick = true;
					// Block native selection / scroll while the drag is live.
					event.preventDefault();
					return true;
				},
				pointerup(_view, event) {
					if (!drag || event.pointerId !== drag.pointerId) return false;
					endDrag();
					return false;
				},
				pointercancel(_view, event) {
					if (!drag || event.pointerId !== drag.pointerId) return false;
					endDrag();
					return false;
				},
				contextmenu(_view, _event) {
					// Long-press on touch can synthesize a contextmenu event
					// mid-drag. Suppress it so it doesn't cancel the selection.
					if (drag?.armed && drag.pointerType === 'touch') {
						_event.preventDefault();
						return true;
					}
					return false;
				},
			},
		},
		view() {
			let lastText: string | null = null;
			let lastRectKey: string | null = null;
			let pendingFrame: number | null = null;

			function notify(view: EditorView): void {
				const cur = tapSelectPluginKey.getState(view.state);
				if (!cur || cur.words.length === 0) {
					if (lastText !== null || lastRectKey !== null) {
						lastText = null;
						lastRectKey = null;
						options.onSelectionChange?.(null);
					}
					return;
				}
				const text = selectionText(cur, view.state.doc);
				if (text.length === 0) {
					if (lastText !== null || lastRectKey !== null) {
						lastText = null;
						lastRectKey = null;
						options.onSelectionChange?.(null);
					}
					return;
				}
				const rect = selectionRect(view);
				const rectKey = rect
					? `${rect.left}|${rect.top}|${rect.right}|${rect.bottom}`
					: '';
				if (text === lastText && rectKey === lastRectKey) return;
				lastText = text;
				lastRectKey = rectKey;
				options.onSelectionChange?.({ text, rect });
			}

			function schedule(view: EditorView): void {
				if (pendingFrame !== null) return;
				const win =
					view.dom.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
				if (!win) {
					notify(view);
					return;
				}
				pendingFrame = win.requestAnimationFrame(() => {
					pendingFrame = null;
					if (!view.isDestroyed) notify(view);
				});
			}

			return {
				update(view) {
					// Decorations are applied on the next paint — defer the rect
					// read so getBoundingClientRect sees the rendered span,
					// not the previous frame.
					schedule(view);
				},
				destroy() {
					endDrag();
					if (pendingFrame !== null && typeof window !== 'undefined') {
						window.cancelAnimationFrame(pendingFrame);
						pendingFrame = null;
					}
					if (lastText !== null || lastRectKey !== null) {
						lastText = null;
						lastRectKey = null;
						options.onSelectionChange?.(null);
					}
				},
			};
		},
	});
}
