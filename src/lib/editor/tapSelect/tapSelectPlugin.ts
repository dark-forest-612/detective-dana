// Read-mode tap-to-select ProseMirror plugin (range model).
//
// On the mobile /note/[id] route, while the editor is read-only, the user
// builds up a selection by tapping word endpoints — the first tap anchors
// the range on a word, every subsequent tap on a word OUTSIDE the current
// range moves the head, so the selection grows (or shrinks) to span all
// the text between the anchor and the new head. This works across blocks:
// you can tap the first word of a paragraph and then a word several lines
// down, and everything between is selected at once.
//
// Tapping a word INSIDE the current range opens the action menu (anchored
// to the selection) — this is how the user reaches 복사 / 새 노트 만들기.
// While the menu is open, any subsequent tap (in or out of the editor)
// closes the menu but leaves the text selection untouched, so the user can
// re-aim and tap again to extend the range.
//
// Drag (mouse or touch long-press + drag) sweeps a range from the press
// word to the word under the pointer in real time. Drag is a single
// gesture and replaces the selection — it doesn't open the menu.
//
// First-block ("title") tap is a special case: the user almost always
// wants to link the entire title from elsewhere, so a single tap on any
// word in the title selects the whole first block.
//
// Selection state lives in plugin state and renders as a single inline
// decoration. Any docChanged transaction (e.g. the editor becoming
// editable and the user typing, or a remote snapshot arriving) clears the
// selection so positions can't drift.

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface WordRange {
	from: number;
	to: number;
}

export interface TapSelectState {
	// Two endpoints of a range selection. `anchor` is the word the user
	// first tapped (or the press word for a drag); `head` is the word at
	// the most recent tap / drag position. The actual selected span is
	// [min(anchor.from, head.from), max(anchor.to, head.to)].
	anchor: WordRange | null;
	head: WordRange | null;
	// Whether the action menu should be visible. Tracked here (instead of
	// in the UI store) so plugin handlers can drive the open/close
	// transitions atomically with selection changes.
	menuOpen: boolean;
}

type Meta =
	| { type: 'set'; anchor: WordRange; head: WordRange; menuOpen: boolean }
	| { type: 'openMenu' }
	| { type: 'closeMenu' }
	| { type: 'clear' };

export const tapSelectPluginKey = new PluginKey<TapSelectState>('tomboyTapSelect');

const EMPTY_STATE: TapSelectState = { anchor: null, head: null, menuOpen: false };

export interface TapSelectionInfo {
	text: string;
	rect: { left: number; top: number; right: number; bottom: number } | null;
	menuOpen: boolean;
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
	let depth = $pos.depth;
	while (depth > 0 && !$pos.node(depth).isTextblock) depth--;
	const block = $pos.node(depth);
	if (!block.isTextblock) return null;
	const blockStart = $pos.start(depth);
	const blockEnd = $pos.end(depth);

	const text = blockTextOf(block);
	let offset = pos - blockStart;
	if (offset < 0) offset = 0;
	if (offset > text.length) offset = text.length;

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
 * Find every word range in a block. Used when a tap on the title block
 * needs to expand to the full title.
 */
function findAllWordsInBlock(block: PMNode, blockStart: number): WordRange[] {
	const text = blockTextOf(block);
	const words: WordRange[] = [];
	let i = 0;
	while (i < text.length) {
		if (!isWordChar(text[i])) {
			i++;
			continue;
		}
		let j = i;
		while (j < text.length && isWordChar(text[j])) j++;
		words.push({ from: blockStart + i, to: blockStart + j });
		i = j;
	}
	return words;
}

// Tomboy convention: the first block of the doc IS the note title. Tapping
// anywhere on it selects the whole title in one shot — usually the user is
// about to link the title from elsewhere, so single-word taps are awkward.
function isTitleBlockStart(doc: PMNode, blockStart: number): boolean {
	if (doc.childCount === 0) return false;
	return blockStart === 1;
}

function spanOf(state: TapSelectState): WordRange | null {
	if (!state.anchor || !state.head) return null;
	const from = Math.min(state.anchor.from, state.head.from);
	const to = Math.max(state.anchor.to, state.head.to);
	return { from, to };
}

/**
 * Public helper for callers that want to apply a mark to whatever the user
 * has tapped (e.g. the "새 노트 from selection" flow, which marks the
 * source text as an internal link). Returns the contiguous range covering
 * the selection; empty when nothing is selected.
 */
export function getTapSelectRanges(state: EditorState): WordRange[] {
	const s = tapSelectPluginKey.getState(state);
	if (!s) return [];
	const span = spanOf(s);
	return span ? [span] : [];
}

function selectionText(state: TapSelectState, doc: PMNode): string {
	const span = spanOf(state);
	if (!span) return '';
	return doc.textBetween(span.from, span.to, ' ', ' ').trim();
}

/**
 * Bounding box of the rendered selection decoration in viewport
 * coordinates. Returns null when no decoration is currently mounted.
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
	startWord: WordRange;
	armed: boolean;
	armTimer: ReturnType<typeof setTimeout> | null;
}

function dispatchSet(
	view: EditorView,
	anchor: WordRange,
	head: WordRange,
	menuOpen: boolean,
): void {
	view.dispatch(
		view.state.tr.setMeta(tapSelectPluginKey, {
			type: 'set',
			anchor,
			head,
			menuOpen,
		}),
	);
}

function dispatchOpenMenu(view: EditorView): void {
	view.dispatch(view.state.tr.setMeta(tapSelectPluginKey, { type: 'openMenu' }));
}

function dispatchCloseMenu(view: EditorView): void {
	view.dispatch(view.state.tr.setMeta(tapSelectPluginKey, { type: 'closeMenu' }));
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
					if (meta.type === 'openMenu') {
						if (!value.anchor || !value.head) return value;
						return { ...value, menuOpen: true };
					}
					if (meta.type === 'closeMenu') {
						if (!value.menuOpen) return value;
						return { ...value, menuOpen: false };
					}
					return { anchor: meta.anchor, head: meta.head, menuOpen: meta.menuOpen };
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
				if (!s) return DecorationSet.empty;
				const span = spanOf(s);
				if (!span) return DecorationSet.empty;
				return DecorationSet.create(state.doc, [
					Decoration.inline(span.from, span.to, { class: 'tomboy-tap-select' }),
				]);
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

				const prev = tapSelectPluginKey.getState(view.state) ?? EMPTY_STATE;

				// While the menu is open, any tap closes it and leaves the
				// selection alone — the user can re-aim before extending.
				if (prev.menuOpen) {
					dispatchCloseMenu(view);
					return true;
				}

				// Tap inside the current selection (word OR whitespace within
				// the highlighted span) → open menu. Position-based check so
				// a tap on the inter-word gap of "abc def" still triggers.
				const prevSpan = spanOf(prev);
				if (prevSpan && pos >= prevSpan.from && pos <= prevSpan.to) {
					dispatchOpenMenu(view);
					return true;
				}

				const hit = findWordAt(view.state.doc, pos);
				if (!hit) return false;

				// Title-block tap: select the entire title regardless of any
				// existing selection — the typical use is linking the title
				// from elsewhere, and a single-word tap is awkward there.
				if (isTitleBlockStart(view.state.doc, hit.blockStart)) {
					const block = view.state.doc.resolve(hit.blockStart).parent;
					const allWords = findAllWordsInBlock(block, hit.blockStart);
					if (allWords.length === 0) return true;
					const titleAnchor = allWords[0];
					const titleHead = allWords[allWords.length - 1];
					dispatchSet(view, titleAnchor, titleHead, false);
					return true;
				}

				// First tap: anchor the selection on the tapped word.
				if (!prev.anchor || !prev.head) {
					dispatchSet(view, hit.word, hit.word, false);
					return true;
				}

				// Tap outside the current span → keep anchor, move head. The
				// rendered range snaps to whichever side of the anchor the
				// head landed on.
				dispatchSet(view, prev.anchor, hit.word, false);
				return true;
			},
			handleDOMEvents: {
				pointerdown(view, event) {
					if (view.editable) return false;
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
						startWord: hit.word,
						armed: false,
						armTimer: null,
					};
					if (drag.pointerType === 'touch') {
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
					const hit = findWordAt(view.state.doc, coords.pos);
					const head = hit ? hit.word : d.startWord;
					dispatchSet(view, d.startWord, head, false);

					suppressNextClick = true;
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
			let lastMenuOpen = false;
			let pendingFrame: number | null = null;

			function notify(view: EditorView): void {
				const cur = tapSelectPluginKey.getState(view.state);
				if (!cur || !cur.anchor || !cur.head) {
					if (lastText !== null || lastRectKey !== null || lastMenuOpen) {
						lastText = null;
						lastRectKey = null;
						lastMenuOpen = false;
						options.onSelectionChange?.(null);
					}
					return;
				}
				const text = selectionText(cur, view.state.doc);
				if (text.length === 0) {
					if (lastText !== null || lastRectKey !== null || lastMenuOpen) {
						lastText = null;
						lastRectKey = null;
						lastMenuOpen = false;
						options.onSelectionChange?.(null);
					}
					return;
				}
				const rect = selectionRect(view);
				const rectKey = rect
					? `${rect.left}|${rect.top}|${rect.right}|${rect.bottom}`
					: '';
				if (text === lastText && rectKey === lastRectKey && cur.menuOpen === lastMenuOpen) {
					return;
				}
				lastText = text;
				lastRectKey = rectKey;
				lastMenuOpen = cur.menuOpen;
				options.onSelectionChange?.({ text, rect, menuOpen: cur.menuOpen });
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
					schedule(view);
				},
				destroy() {
					endDrag();
					if (pendingFrame !== null && typeof window !== 'undefined') {
						window.cancelAnimationFrame(pendingFrame);
						pendingFrame = null;
					}
					if (lastText !== null || lastRectKey !== null || lastMenuOpen) {
						lastText = null;
						lastRectKey = null;
						lastMenuOpen = false;
						options.onSelectionChange?.(null);
					}
				},
			};
		},
	});
}

/**
 * Imperative helper for callers that need to close the menu from outside
 * the editor (e.g. the page's pointerdown listener handling clicks that
 * happened in the surrounding chrome).
 */
export function closeTapSelectMenu(view: EditorView): void {
	const s = tapSelectPluginKey.getState(view.state);
	if (!s || !s.menuOpen) return;
	dispatchCloseMenu(view);
}
