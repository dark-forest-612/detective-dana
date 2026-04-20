import { createEmptyNote, formatTomboyDate, type NoteData } from './note.js';
import { serializeContent, extractTitleFromDoc, deserializeContent } from './noteContentArchiver.js';
import { parseNote, serializeNote } from './noteArchiver.js';
import { noteRepository } from '$lib/repository/index.js';
import { generateGuid } from '$lib/utils/guid.js';
import { invalidateCache } from '$lib/stores/noteListCache.js';
import { isFavorite, removeFavorite } from './favorites.js';
import { validateTitle, type TitleValidationError } from './titleValidator.js';
import type { JSONContent } from '@tiptap/core';

export { isFavorite, toggleFavorite } from './favorites.js';

/** Create a new note and persist it to IndexedDB */
export async function createNote(initialTitle?: string): Promise<NoteData> {
	const guid = generateGuid();
	const note = createEmptyNote(guid);
	if (initialTitle) {
		note.title = initialTitle;
		// When the title looks like yyyy-mm-dd, seed the subtitle slot (second
		// line) with the year so date-titled notes have an auto-filled header.
		const dateMatch = /^(\d{4})-\d{2}-\d{2}$/.exec(initialTitle);
		const suffix = dateMatch ? `\n${dateMatch[1]}년\n` : `\n\n`;
		note.xmlContent = `<note-content version="0.1">${initialTitle}${suffix}</note-content>`;
	}
	await noteRepository.put(note);
	invalidateCache();
	return note;
}

/**
 * Result of `updateNoteFromEditor`. The `ok:false` branch carries a
 * validation error so the caller can surface a message without re-running
 * the validator; `ok:true` carries the freshly persisted note plus a flag
 * indicating whether the title changed on this save (useful for lock /
 * list-cache consumers that only care about rename events).
 *
 * `notFound` is returned when the target guid no longer exists — this is
 * distinct from a validation failure and callers should treat it as "the
 * note was deleted under us".
 */
export type UpdateNoteResult =
	| { ok: true; note: NoteData; titleChanged: boolean }
	| { ok: false; error: TitleValidationError }
	| { ok: false; error: { kind: 'notFound' } };

/** Update a note from the editor's JSON document */
export async function updateNoteFromEditor(
	guid: string,
	doc: JSONContent
): Promise<UpdateNoteResult> {
	const note = await noteRepository.get(guid);
	if (!note) return { ok: false, error: { kind: 'notFound' } };

	const newXmlContent = serializeContent(doc);
	const newTitle = extractTitleFromDoc(doc);

	// No-op skip: if the serialized doc is byte-identical to what's already
	// in storage, don't touch the note. This prevents spurious "dirty" state
	// when a user types a character and then deletes it — the final doc
	// equals the stored one, so there's nothing to save. Without this check
	// the date fields would tick forward on every transient edit cycle and
	// the note would re-appear on the upload list.
	if (newXmlContent === note.xmlContent && newTitle === note.title) {
		return { ok: true, note, titleChanged: false };
	}

	const oldTitle = note.title;
	const titleChanged = newTitle !== oldTitle;

	// Validate the proposed title BEFORE persisting anything. Rule scope
	// (Task 3): non-empty stored titles only. An empty `newTitle` on a
	// fresh empty note is allowed by this gate — creation flows already
	// mint placeholder titles and the UI forbids clearing the title via
	// the cursor-leaves-title plugin. This keeps the save path from
	// blocking the initial "blank note" round-trip that happens during
	// `createNote()` while still preventing any user-driven invalid title
	// from ever reaching storage.
	if (titleChanged && newTitle.length > 0) {
		const err = await validateTitle(newTitle, guid, noteRepository);
		if (err) return { ok: false, error: err };
	}

	const now = formatTomboyDate(new Date());
	note.xmlContent = newXmlContent;
	note.title = newTitle;
	note.changeDate = now;
	note.metadataChangeDate = now;

	await noteRepository.put(note);

	// Propagate the rename to every other note that links to the old title
	// via `<link:internal>OldTitle</link:internal>`. Scope is deliberately
	// limited to `link:internal`: `link:broken` marks target titles that
	// don't currently resolve, so rewriting them would be confusing (and
	// they won't match in the common case). Comparison is case-sensitive —
	// "Apple" and "apple" are distinct notes (see Task 1).
	if (titleChanged && oldTitle.length > 0 && newTitle.length > 0) {
		const oldEscaped = escapeXmlText(oldTitle);
		const newEscaped = escapeXmlText(newTitle);
		const needle = `>${oldEscaped}</link:internal>`;
		const replacement = `>${newEscaped}</link:internal>`;
		const allNotes = await noteRepository.getAll();
		for (const other of allNotes) {
			if (other.guid === guid) continue;
			if (!other.xmlContent.includes(needle)) continue;
			other.xmlContent = other.xmlContent.split(needle).join(replacement);
			other.changeDate = now;
			other.metadataChangeDate = now;
			await noteRepository.put(other);
		}
	}

	// Only invalidate the shared note-list cache when the title changed.
	// Body-only edits don't affect any derived views that matter while the
	// user is actively typing (the title list for auto-linking, notebook
	// chips, etc.), so skipping invalidate here avoids a cascade where every
	// keystroke's debounced save triggers a full titleProvider refetch +
	// full-doc auto-link rescan. List pages remount on navigation and
	// refetch fresh data then.
	if (titleChanged) invalidateCache();
	return { ok: true, note, titleChanged };
}

/**
 * Escape XML-special characters in a plain-text string so it can be safely
 * embedded inside an XML text node. Mirrors `escapeXmlContent` in
 * `noteContentArchiver.ts` but also escapes `"` and `'` for defensive
 * consistency — title text never appears inside XML attributes today, but
 * the function is generic so future callers don't step on a footgun.
 */
function escapeXmlText(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/** Delete a note */
export async function deleteNoteById(guid: string): Promise<void> {
	await noteRepository.delete(guid);
	await removeFavorite(guid);
	invalidateCache();
}

/** Get the TipTap JSON content for a note */
export function getNoteEditorContent(note: NoteData): JSONContent {
	return deserializeContent(note.xmlContent);
}

/** Get all notes sorted by changeDate descending */
export async function listNotes(): Promise<NoteData[]> {
	return noteRepository.getAll();
}

/** Get a single note */
export async function getNote(guid: string): Promise<NoteData | undefined> {
	return noteRepository.get(guid);
}

/** Find a note by its title (case-sensitive, whitespace-trimmed). */
export async function findNoteByTitle(title: string): Promise<NoteData | undefined> {
	return noteRepository.findByTitle(title);
}

/** Import a .note XML string into IndexedDB */
export async function importNoteXml(xml: string, filename: string): Promise<NoteData> {
	const guid = filename.replace(/\.note$/, '');
	const uri = `note://tomboy/${guid}`;
	const note = parseNote(xml, uri);
	note.guid = guid;
	await noteRepository.put(note);
	return note;
}

/** Export a note to .note XML string */
export function exportNoteXml(note: NoteData): string {
	return serializeNote(note);
}

/** Sort notes: favorited first, then by the given date field descending */
export function sortForList(notes: NoteData[], by: 'changeDate' | 'createDate'): NoteData[] {
	return [...notes].sort((a, b) => {
		const pa = isFavorite(a.guid) ? 1 : 0;
		const pb = isFavorite(b.guid) ? 1 : 0;
		if (pa !== pb) return pb - pa;
		return (b[by] ?? '').localeCompare(a[by] ?? '');
	});
}
