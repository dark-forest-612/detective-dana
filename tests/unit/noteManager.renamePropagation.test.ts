import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteData } from '$lib/core/note.js';
import type { JSONContent } from '@tiptap/core';

// In-memory fake IDB keyed by guid so we can inspect writes.
const store = new Map<string, NoteData>();
const putSpy = vi.fn();

vi.mock('$lib/repository/index.js', () => ({
	noteRepository: {
		get: vi.fn(async (guid: string) => store.get(guid)),
		put: vi.fn(async (note: NoteData) => {
			putSpy(note);
			store.set(note.guid, { ...note });
		}),
		getAll: vi.fn(async () => Array.from(store.values())),
		getAllIncludingTemplates: vi.fn(async () => Array.from(store.values())),
		delete: vi.fn(),
		findByTitle: vi.fn()
	}
}));

vi.mock('$lib/stores/noteListCache.js', () => ({
	invalidateCache: vi.fn()
}));

import { updateNoteFromEditor } from '$lib/core/noteManager.js';

function makeNote(overrides: Partial<NoteData> = {}): NoteData {
	return {
		uri: 'note://tomboy/abc',
		guid: 'abc',
		title: 'Old',
		xmlContent: '<note-content version="0.1">Old\n\n</note-content>',
		createDate: '2024-01-01T00:00:00.0000000+00:00',
		changeDate: '2024-06-01T10:20:30.1234567+00:00',
		metadataChangeDate: '2024-06-01T10:20:30.1234567+00:00',
		cursorPosition: 0,
		selectionBoundPosition: -1,
		width: 450,
		height: 360,
		x: 0,
		y: 0,
		tags: [],
		openOnStartup: false,
		...overrides
	};
}

/** Build a minimal TipTap doc where the first paragraph's plain text is `title`
 *  and a second paragraph has the given text (no marks). */
function docWithTitleAndBody(title: string, body = ''): JSONContent {
	const titlePara: JSONContent = title.length
		? { type: 'paragraph', content: [{ type: 'text', text: title }] }
		: { type: 'paragraph' };
	const bodyPara: JSONContent = body.length
		? { type: 'paragraph', content: [{ type: 'text', text: body }] }
		: { type: 'paragraph' };
	return { type: 'doc', content: [titlePara, bodyPara] };
}

beforeEach(() => {
	store.clear();
	putSpy.mockReset();
});

describe('updateNoteFromEditor — title rename propagation', () => {
	it('rewrites <link:internal>OldOne</link:internal> to <link:internal>NewOne</link:internal> in a referencing note', async () => {
		const target = makeNote({ guid: 'target', title: 'OldOne' });
		const ref = makeNote({
			guid: 'ref',
			title: 'RefOne',
			xmlContent:
				'<note-content version="0.1">RefOne\n\nsee <link:internal>OldOne</link:internal> here</note-content>'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('NewOne', ''));

		const updatedRef = store.get('ref');
		expect(updatedRef?.xmlContent).toContain('<link:internal>NewOne</link:internal>');
		expect(updatedRef?.xmlContent).not.toContain('<link:internal>OldOne</link:internal>');
	});

	it('does NOT touch notes that do not reference the renamed title', async () => {
		const target = makeNote({ guid: 'target', title: 'Old' });
		const unrelated = makeNote({
			guid: 'unrelated',
			title: 'Unrelated',
			xmlContent: '<note-content version="0.1">Unrelated\n\nno refs</note-content>',
			changeDate: '2024-06-01T10:20:30.1234567+00:00'
		});
		store.set(target.guid, target);
		store.set(unrelated.guid, unrelated);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('New', ''));

		const stored = store.get('unrelated');
		expect(stored?.changeDate).toBe('2024-06-01T10:20:30.1234567+00:00');
		expect(stored?.xmlContent).toBe(unrelated.xmlContent);
	});

	it('is case-sensitive: renaming "apple"→"grape" does NOT touch notes with <link:internal>Apple</link:internal>', async () => {
		const target = makeNote({ guid: 'target', title: 'apple' });
		const ref = makeNote({
			guid: 'ref',
			title: 'Ref',
			xmlContent:
				'<note-content version="0.1">Ref\n\nsee <link:internal>Apple</link:internal> here</note-content>',
			changeDate: '2024-06-01T10:20:30.1234567+00:00'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('grape', ''));

		const stored = store.get('ref');
		expect(stored?.xmlContent).toContain('<link:internal>Apple</link:internal>');
		expect(stored?.changeDate).toBe('2024-06-01T10:20:30.1234567+00:00');
	});

	it('replaces multiple occurrences in the same referencing note', async () => {
		const target = makeNote({ guid: 'target', title: 'OldOne' });
		const ref = makeNote({
			guid: 'ref',
			title: 'RefOne',
			xmlContent:
				'<note-content version="0.1">RefOne\n\n<link:internal>OldOne</link:internal> and <link:internal>OldOne</link:internal> again</note-content>'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('NewOne', ''));

		const stored = store.get('ref');
		const matches = stored?.xmlContent.match(/<link:internal>NewOne<\/link:internal>/g) ?? [];
		expect(matches.length).toBe(2);
		expect(stored?.xmlContent).not.toContain('<link:internal>OldOne</link:internal>');
	});

	it('updates multiple referencing notes', async () => {
		const target = makeNote({ guid: 'target', title: 'OldOne' });
		const ref1 = makeNote({
			guid: 'ref1',
			title: 'RefOne',
			xmlContent:
				'<note-content version="0.1">RefOne\n\n<link:internal>OldOne</link:internal></note-content>'
		});
		const ref2 = makeNote({
			guid: 'ref2',
			title: 'RefTwo',
			xmlContent:
				'<note-content version="0.1">RefTwo\n\n<link:internal>OldOne</link:internal></note-content>'
		});
		store.set(target.guid, target);
		store.set(ref1.guid, ref1);
		store.set(ref2.guid, ref2);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('NewOne', ''));

		expect(store.get('ref1')?.xmlContent).toContain('<link:internal>NewOne</link:internal>');
		expect(store.get('ref2')?.xmlContent).toContain('<link:internal>NewOne</link:internal>');
	});

	it('also saves the renamed note with the new title', async () => {
		const target = makeNote({ guid: 'target', title: 'OldOne' });
		store.set(target.guid, target);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('NewOne', ''));

		const stored = store.get('target');
		expect(stored?.title).toBe('NewOne');
		expect(stored?.xmlContent).toContain('NewOne');
	});

	it('XML-escapes the new title when building the replacement text', async () => {
		const target = makeNote({ guid: 'target', title: 'Old' });
		const ref = makeNote({
			guid: 'ref',
			title: 'Ref',
			xmlContent:
				'<note-content version="0.1">Ref\n\n<link:internal>Old</link:internal></note-content>'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('Rock & Roll', ''));

		const stored = store.get('ref');
		expect(stored?.xmlContent).toContain('<link:internal>Rock &amp; Roll</link:internal>');
	});

	it('finds references whose old title contains XML-special characters (escaped form in XML)', async () => {
		// Old title contains "&" — it lives in XML as "A &amp; B C".
		const target = makeNote({
			guid: 'target',
			title: 'A & B C',
			xmlContent: '<note-content version="0.1">A &amp; B C\n\n</note-content>'
		});
		const ref = makeNote({
			guid: 'ref',
			title: 'RefOne',
			xmlContent:
				'<note-content version="0.1">RefOne\n\n<link:internal>A &amp; B C</link:internal></note-content>'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('Cedar', ''));

		const stored = store.get('ref');
		expect(stored?.xmlContent).toContain('<link:internal>Cedar</link:internal>');
		expect(stored?.xmlContent).not.toContain('<link:internal>A &amp; B C</link:internal>');
	});

	it('does NOT propagate when oldTitle is empty (brand-new note)', async () => {
		const target = makeNote({
			guid: 'target',
			title: '',
			xmlContent: '<note-content version="0.1">\n\n</note-content>'
		});
		const ref = makeNote({
			guid: 'ref',
			title: 'Ref',
			xmlContent:
				'<note-content version="0.1">Ref\n\n<link:internal>Something</link:internal></note-content>',
			changeDate: '2024-06-01T10:20:30.1234567+00:00'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('New', ''));

		const stored = store.get('ref');
		expect(stored?.changeDate).toBe('2024-06-01T10:20:30.1234567+00:00');
		expect(stored?.xmlContent).toBe(ref.xmlContent);
	});

	it('does NOT propagate when the title is unchanged (body-only edit)', async () => {
		const target = makeNote({
			guid: 'target',
			title: 'Old',
			xmlContent: '<note-content version="0.1">Old\n\n</note-content>'
		});
		const ref = makeNote({
			guid: 'ref',
			title: 'Ref',
			xmlContent:
				'<note-content version="0.1">Ref\n\n<link:internal>Old</link:internal></note-content>',
			changeDate: '2024-06-01T10:20:30.1234567+00:00'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		// Title stays "Old" but body changes.
		await updateNoteFromEditor(target.guid, docWithTitleAndBody('Old', 'body change'));

		const stored = store.get('ref');
		expect(stored?.changeDate).toBe('2024-06-01T10:20:30.1234567+00:00');
		expect(stored?.xmlContent).toBe(ref.xmlContent);
	});

	it('leaves <link:broken>Old</link:broken> untouched (scope limited to link:internal)', async () => {
		const target = makeNote({ guid: 'target', title: 'Old' });
		const ref = makeNote({
			guid: 'ref',
			title: 'Ref',
			xmlContent:
				'<note-content version="0.1">Ref\n\n<link:broken>Old</link:broken></note-content>'
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('New', ''));

		const stored = store.get('ref');
		// link:broken is deliberately not rewritten.
		expect(stored?.xmlContent).toContain('<link:broken>Old</link:broken>');
	});

	it('bumps changeDate on rewritten referencing notes', async () => {
		const target = makeNote({ guid: 'target', title: 'OldOne' });
		const refOldDate = '2024-06-01T10:20:30.1234567+00:00';
		const ref = makeNote({
			guid: 'ref',
			title: 'RefOne',
			xmlContent:
				'<note-content version="0.1">RefOne\n\n<link:internal>OldOne</link:internal></note-content>',
			changeDate: refOldDate,
			metadataChangeDate: refOldDate
		});
		store.set(target.guid, target);
		store.set(ref.guid, ref);

		await updateNoteFromEditor(target.guid, docWithTitleAndBody('NewOne', ''));

		const stored = store.get('ref');
		expect(stored?.changeDate).not.toBe(refOldDate);
	});
});
