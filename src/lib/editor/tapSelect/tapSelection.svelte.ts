// Read-mode tap selection, module-scoped.
//
// The mobile /note/[id] page lets the user tap words in a read-only note to
// build up a selection within a single block. The selected text is exposed
// here so that TopNav's 새 노트 button can use it as the new note's title.
//
// The route also registers a handler (see registerCreateLinkedNote) that
// knows how to create the target note AND apply internal-link marks on the
// source — the route owns the editor + lockController, which are both
// needed for that flow, so we proxy through this store instead of leaking
// those into TopNav.
//
// Only one editor-with-tap-select is ever mounted on the mobile route at a
// time, so a single module-level slot is sufficient.

let _text = $state<string | null>(null);

type CreateLinkedNoteHandler = () => Promise<void>;
let _createLinkedNote: CreateLinkedNoteHandler | null = null;

export const tapSelection = {
	get text() {
		return _text;
	},
	set(value: string | null) {
		_text = value && value.length > 0 ? value : null;
	},
	clear() {
		_text = null;
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
