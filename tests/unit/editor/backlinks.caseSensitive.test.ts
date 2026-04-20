import { describe, it, expect } from 'vitest';
import type { NoteData } from '$lib/core/note.js';

/**
 * Pure replica of the backlink detection predicate used by
 * NoteActionSheet.svelte / NoteContextMenu.svelte. Keeping this in one
 * place here (even as a mirror) lets us test the case-sensitivity
 * contract without spinning up the Svelte component tree.
 *
 * If this logic drifts from the Svelte components, update both.
 */
function findBacklinks(currentTitle: string, currentGuid: string, notes: NoteData[]): NoteData[] {
	const titleTrimmed = currentTitle.trim();
	return notes.filter((n) => {
		if (n.guid === currentGuid) return false;
		const xml = n.xmlContent;
		return (
			xml.includes(`>${titleTrimmed}</link:internal>`) ||
			xml.includes(`>${titleTrimmed}</link:broken>`)
		);
	});
}

function makeNote(guid: string, title: string, xmlContent: string): NoteData {
	return {
		uri: `note://tomboy/${guid}`,
		guid,
		title,
		xmlContent,
		createDate: '2024-01-01T00:00:00Z',
		changeDate: '2024-01-01T00:00:00Z',
		metadataChangeDate: '2024-01-01T00:00:00Z',
		cursorPosition: 0,
		selectionBoundPosition: -1,
		width: 450,
		height: 360,
		x: 0,
		y: 0,
		tags: [],
		openOnStartup: false
	};
}

describe('backlink discovery — case sensitivity', () => {
	it('does NOT flag a note that links to a differently-cased title as a backlink', () => {
		const other = makeNote(
			'other',
			'Other',
			'<note-content version="0.1">Other\n\nI mention <link:internal>apple</link:internal> here.</note-content>'
		);
		// Current note is "Apple" (different case from the mark text "apple").
		const results = findBacklinks('Apple', 'me', [other]);
		expect(results).toEqual([]);
	});

	it('flags a note whose internal link matches the current title exactly (same case)', () => {
		const other = makeNote(
			'other',
			'Other',
			'<note-content version="0.1">Other\n\nSee <link:internal>Apple</link:internal> today.</note-content>'
		);
		const results = findBacklinks('Apple', 'me', [other]);
		expect(results.map((n) => n.guid)).toEqual(['other']);
	});

	it('distinguishes backlinks for "Apple" and "apple" as separate notes', () => {
		const ref1 = makeNote(
			'ref1',
			'Ref One',
			'<note-content version="0.1">Ref One\n\n<link:internal>Apple</link:internal></note-content>'
		);
		const ref2 = makeNote(
			'ref2',
			'Ref Two',
			'<note-content version="0.1">Ref Two\n\n<link:internal>apple</link:internal></note-content>'
		);

		// Looking up backlinks for "Apple" should only return ref1.
		expect(findBacklinks('Apple', 'apple-note', [ref1, ref2]).map((n) => n.guid)).toEqual([
			'ref1'
		]);

		// Looking up backlinks for "apple" should only return ref2.
		expect(findBacklinks('apple', 'apple-note', [ref1, ref2]).map((n) => n.guid)).toEqual([
			'ref2'
		]);
	});

	it('also applies to broken-link marks (case-sensitive)', () => {
		const other = makeNote(
			'other',
			'Other',
			'<note-content version="0.1">Other\n\n<link:broken>apple</link:broken></note-content>'
		);
		// Mark text "apple" does not match current title "Apple".
		expect(findBacklinks('Apple', 'me', [other])).toEqual([]);
		// Same-case hit works.
		const matching = makeNote(
			'ok',
			'Ok',
			'<note-content version="0.1">Ok\n\n<link:broken>Apple</link:broken></note-content>'
		);
		expect(findBacklinks('Apple', 'me', [matching]).map((n) => n.guid)).toEqual(['ok']);
	});
});
