/**
 * ProseMirror plugin that fires a validation callback when the caret
 * leaves the first block of the document (the "title" block, per the
 * Tomboy convention where the first paragraph IS the note title).
 *
 * Rationale: the user spec (Task 3) asks for validation to run ONLY when
 * the cursor moves out of the title, not on every keystroke. Watching
 * `view.hasFocus()` is too coarse (it also fires on window blur / tab
 * switches), and ProseMirror doesn't emit a dedicated blur event for
 * individual blocks. Instead we compare the selection's anchor position
 * before and after each transaction: a transition from "inside block 0"
 * to "outside block 0" is the leave event we want.
 *
 * The plugin is intentionally side-effect-free on the doc: it only reads
 * `newState.selection.anchor` and calls `opts.onLeaveTitle` when the
 * transition occurs. The caller is responsible for running any validators
 * and pulling the caret back on failure via `editor.commands.focus(...)`.
 */

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

export const titleBlurValidatorPluginKey = new PluginKey('tomboyTitleBlurValidator');

export interface TitleBlurValidatorOptions {
	/**
	 * Called whenever the caret transitions from inside the first block
	 * to outside it. Receives the plain text of the first block (already
	 * extracted to match what `extractTitleFromDoc` would see on save).
	 *
	 * The handler is invoked synchronously from within `appendTransaction`
	 * — it MUST NOT dispatch a transaction itself (doing so would recurse
	 * and / or confuse ProseMirror's transaction pipeline). Callers that
	 * need to move the caret should schedule that work asynchronously
	 * (microtask / setTimeout) so it runs after the current transaction
	 * has been applied.
	 */
	onLeaveTitle: (titleText: string) => void;
}

/**
 * True if the given absolute document position is inside the first top-level
 * block of the doc. The doc's first child covers positions
 * `[1, 1 + firstChild.nodeSize - 1]` inclusive in TipTap/ProseMirror's
 * coordinate system (opening token at pos 0, text starts at 1).
 */
function isInsideFirstBlock(doc: PMNode, pos: number): boolean {
	if (doc.childCount === 0) return false;
	const first = doc.child(0);
	// `1` is the position just inside the first block's opening token; the
	// block's closing token sits at `first.nodeSize`. A caret between 1 and
	// `first.nodeSize - 1` (inclusive on the left) is inside that block.
	// We include the end edge (`nodeSize`) as well because a caret at the
	// very end of the title block before a block boundary is still visually
	// "in the title" for UX purposes.
	return pos >= 1 && pos <= first.nodeSize;
}

function firstBlockText(doc: PMNode): string {
	if (doc.childCount === 0) return '';
	return doc.child(0).textContent;
}

function anchorIsInsideFirstBlock(state: EditorState): boolean {
	return isInsideFirstBlock(state.doc, state.selection.anchor);
}

export function createTitleBlurValidatorPlugin(
	opts: TitleBlurValidatorOptions
): Plugin {
	return new Plugin({
		key: titleBlurValidatorPluginKey,
		appendTransaction(_transactions, oldState, newState) {
			const wasInside = anchorIsInsideFirstBlock(oldState);
			const isInside = anchorIsInsideFirstBlock(newState);
			// Fire only on the leave transition. Enter / stay / move-within
			// are all silent.
			if (wasInside && !isInside) {
				const text = firstBlockText(newState.doc);
				try {
					opts.onLeaveTitle(text);
				} catch (err) {
					console.error('[titleBlurValidator] onLeaveTitle threw:', err);
				}
			}
			return null;
		}
	});
}
