// Read-mode tap selection, module-scoped.
//
// The mobile /note/[id] page lets the user tap (or drag) words in a
// read-only note to build up a range selection. The selected text, the
// selection's viewport rect, and whether the action menu is currently
// open are exposed here so that:
//   * TopNav's 새 노트 button can use the text as the new note's title,
//   * The page can render the floating menu (복사 / 새 노트) anchored to
//     the selection — but only when `menuOpen` is true (the plugin opens
//     it when the user taps inside the existing range).
//
// The route also registers a handler (see registerCreateLinkedNote) that
// knows how to create the target note AND apply internal-link marks on
// the source — the route owns the editor + lockController, which are both
// needed for that flow, so we proxy through this store instead of leaking
// those into TopNav.
//
// Only one editor-with-tap-select is ever mounted on the mobile route at
// a time, so a single module-level slot is sufficient.

import type { TapSelectionInfo } from './tapSelectPlugin.js';

let _text = $state<string | null>(null);
let _rect = $state<TapSelectionInfo['rect']>(null);
let _menuOpen = $state(false);

type CreateLinkedNoteHandler = () => Promise<void>;
let _createLinkedNote: CreateLinkedNoteHandler | null = null;

export const tapSelection = {
	get text() {
		return _text;
	},
	get rect() {
		return _rect;
	},
	get menuOpen() {
		return _menuOpen;
	},
	set(info: TapSelectionInfo | null) {
		if (!info || !info.text) {
			_text = null;
			_rect = null;
			_menuOpen = false;
			return;
		}
		_text = info.text;
		_rect = info.rect;
		_menuOpen = info.menuOpen;
	},
	clear() {
		_text = null;
		_rect = null;
		_menuOpen = false;
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
