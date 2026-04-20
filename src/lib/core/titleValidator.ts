/**
 * Note-title validation rules.
 *
 * Rules (Task 3):
 *   - After trimming, a title must be at least 5 characters long.
 *   - Titles must be unique across the note collection, case-sensitively
 *     (matching the Task 1 rule: "Apple" and "apple" are distinct notes).
 *
 * These functions are pure (given a repo) and have no UI side effects.
 * The editor wires them to a ProseMirror plugin that fires only when the
 * caret leaves the title block (see `titleBlurValidatorPlugin.ts`), and
 * `updateNoteFromEditor` calls them on the save path as a defense-in-depth
 * gate so no invalid title ever reaches storage.
 */

import type { NoteRepository } from '$lib/repository/NoteRepository.js';

/** Minimum trimmed length a note title must have to be considered valid. */
export const MIN_TITLE_LENGTH = 5;

export type TitleValidationError =
	| { kind: 'tooShort'; minLength: number; actual: number }
	| { kind: 'duplicate'; conflictGuid: string };

/**
 * Pure length check. Whitespace on either side of the title is ignored so
 * "   ab   " is rejected even though the raw string has 8 characters.
 */
export function validateTitleLength(title: string): TitleValidationError | null {
	const trimmed = title.trim();
	if (trimmed.length < MIN_TITLE_LENGTH) {
		return { kind: 'tooShort', minLength: MIN_TITLE_LENGTH, actual: trimmed.length };
	}
	return null;
}

/**
 * Uniqueness check across the full note collection. The caller's own guid
 * is ignored so renaming a note to its current title is not treated as a
 * duplicate. Comparison is case-sensitive on trimmed titles — the same
 * rule as `findByTitle`/`findTitleMatches`.
 */
export async function validateTitleUnique(
	title: string,
	selfGuid: string,
	repo: NoteRepository
): Promise<TitleValidationError | null> {
	const needle = title.trim();
	if (!needle) return null; // length check handles empties
	const all = await repo.getAll();
	for (const other of all) {
		if (other.guid === selfGuid) continue;
		if (other.title.trim() === needle) {
			return { kind: 'duplicate', conflictGuid: other.guid };
		}
	}
	return null;
}

/** Compose length + uniqueness. Length is cheap, so it runs first. */
export async function validateTitle(
	title: string,
	selfGuid: string,
	repo: NoteRepository
): Promise<TitleValidationError | null> {
	const lengthErr = validateTitleLength(title);
	if (lengthErr) return lengthErr;
	return validateTitleUnique(title, selfGuid, repo);
}
