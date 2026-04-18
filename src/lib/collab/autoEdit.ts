/**
 * "Auto-edit" hint for freshly created notes.
 *
 * When the user clicks "새 노트" we want them to land in edit mode without
 * having to click the lock toggle — but we don't want `createNote` itself
 * to know about lock plumbing. Creators call `markAutoEdit(guid)` right
 * before navigating/openWindowing, and the note route / NoteWindow calls
 * `consumeAutoEdit(guid)` on mount. Matching consume triggers an
 * `acquire()` on the freshly-constructed NoteLockController.
 *
 * The marker is one-shot: consuming removes it, so a later reopen of the
 * same note (navigation, refresh, reopen window) stays read-only until
 * the user explicitly clicks the toggle.
 */

const pending = new Set<string>();

export function markAutoEdit(guid: string): void {
	pending.add(guid);
}

export function consumeAutoEdit(guid: string): boolean {
	if (!pending.has(guid)) return false;
	pending.delete(guid);
	return true;
}

export function _resetAutoEditForTest(): void {
	pending.clear();
}
