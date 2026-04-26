// Read-mode tap selection, module-scoped.
//
// The mobile /note/[id] page lets the user tap (or drag) words in a
// read-only note to build up a selection within a single block. The
// selected text and the selection's viewport rect are exposed here so
// that:
//   * TopNav's 새 노트 button can use the text as the new note's title, and
//   * The page can render a small floating menu (복사 / 새 노트) anchored
//     to the selection.
//
// The route also registers a handler (see registerCreateLinkedNote) that
// knows how to create the target note AND apply internal-link marks on the
// source — the route owns the editor + lockController, which are both
// needed for that flow, so we proxy through this store instead of leaking
// those into TopNav.
//
// Only one editor-with-tap-select is ever mounted on the mobile route at a
// time, so a single module-level slot is sufficient.

import type { TapSelectionInfo } from './tapSelectPlugin.js';

let _text = $state<string | null>(null);
let _rect = $state<TapSelectionInfo['rect']>(null);

type CreateLinkedNoteHandler = () => Promise<void>;
let _createLinkedNote: CreateLinkedNoteHandler | null = null;

export const tapSelection = {
	get text() {
		return _text;
	},
	get rect() {
		return _rect;
	},
	set(info: TapSelectionInfo | null) {
		if (!info || !info.text) {
			_text = null;
			_rect = null;
			return;
		}
		_text = info.text;
		_rect = info.rect;
	},
	clear() {
		_text = null;
		_rect = null;
	},
	registerCreateLinkedNote(handler: CreateLinkedNoteHandler | null) {
		_createLinkedNote = handler;
	},
	async invokeCreateLinkedNote(): Promise<boolean> {
		if (!_createLinkedNote) return false;
		await _createLinkedNote();
		return true;
	},
};
