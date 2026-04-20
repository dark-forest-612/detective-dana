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
		title: 'Original Title',
		xmlContent: '<note-content version="0.1">Original Title\n\nbody</note-content>',
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

describe('updateNoteFromEditor — title validation gate', () => {
	it('refuses to save when the new title is shorter than 5 chars (after trim)', async () => {
		const target = makeNote({ guid: 'target', title: 'Original Title' });
		store.set(target.guid, { ...target });

		const result = await updateNoteFromEditor(target.guid, docWithTitleAndBody('abc', 'body'));

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.error.kind).toBe('tooShort');
		// Nothing persisted.
		expect(putSpy).not.toHaveBeenCalled();
		expect(store.get('target')?.title).toBe('Original Title');
	});

	it('treats "   ab   " as too short (trims before counting)', async () => {
		const target = makeNote({ guid: 'target', title: 'Original Title' });
		store.set(target.guid, { ...target });

		const result = await updateNoteFromEditor(
			target.guid,
			docWithTitleAndBody('   ab   ', 'body')
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.error.kind).toBe('tooShort');
		expect(putSpy).not.toHaveBeenCalled();
	});

	it('refuses to save when renaming to a title that another note already owns', async () => {
		const target = makeNote({ guid: 'target', title: 'Original Title' });
		const other = makeNote({
			guid: 'other',
			title: 'Taken Title',
			xmlContent: '<note-content version="0.1">Taken Title\n\n</note-content>'
		});
		store.set(target.guid, { ...target });
		store.set(other.guid, { ...other });

		const result = await updateNoteFromEditor(
			target.guid,
			docWithTitleAndBody('Taken Title', 'body')
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.error.kind).toBe('duplicate');
		if (result.error.kind !== 'duplicate') throw new Error('unreachable');
		expect(result.error.conflictGuid).toBe('other');
		// Neither the target nor the conflicting note should have been rewritten.
		expect(putSpy).not.toHaveBeenCalled();
		expect(store.get('target')?.title).toBe('Original Title');
		expect(store.get('other')?.title).toBe('Taken Title');
	});

	it('does NOT propagate a rename when the new title is invalid', async () => {
		// Another note references "Original Title" via <link:internal>. A
		// rejected rename must NOT sweep the reference.
		const target = makeNote({ guid: 'target', title: 'Original Title' });
		const ref = makeNote({
			guid: 'ref',
			title: 'Ref Title',
			xmlContent:
				'<note-content version="0.1">Ref Title\n\n<link:internal>Original Title</link:internal></note-content>',
			changeDate: '2024-06-01T10:20:30.1234567+00:00'
		});
		store.set(target.guid, { ...target });
		store.set(ref.guid, { ...ref });

		// Too-short title.
		const result = await updateNoteFromEditor(target.guid, docWithTitleAndBody('No', 'body'));

		expect(result.ok).toBe(false);
		expect(store.get('ref')?.xmlContent).toContain(
			'<link:internal>Original Title</link:internal>'
		);
		expect(store.get('ref')?.changeDate).toBe('2024-06-01T10:20:30.1234567+00:00');
	});

	it('returns { ok:true, titleChanged:true } and still propagates renames on a valid rename', async () => {
		const target = makeNote({ guid: 'target', title: 'Original Title' });
		const ref = makeNote({
			guid: 'ref',
			title: 'Ref Title',
			xmlContent:
				'<note-content version="0.1">Ref Title\n\n<link:internal>Original Title</link:internal></note-content>'
		});
		store.set(target.guid, { ...target });
		store.set(ref.guid, { ...ref });

		const result = await updateNoteFromEditor(
			target.guid,
			docWithTitleAndBody('Brand New Title', '')
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('unreachable');
		expect(result.titleChanged).toBe(true);
		expect(result.note.title).toBe('Brand New Title');
		// Rename propagated to the referencing note.
		expect(store.get('ref')?.xmlContent).toContain(
			'<link:internal>Brand New Title</link:internal>'
		);
		expect(store.get('ref')?.xmlContent).not.toContain(
			'<link:internal>Original Title</link:internal>'
		);
	});

	it('returns { ok:true, titleChanged:false } when only the body changed', async () => {
		const target = makeNote({ guid: 'target', title: 'Original Title' });
		store.set(target.guid, { ...target });

		const result = await updateNoteFromEditor(
			target.guid,
			docWithTitleAndBody('Original Title', 'new body')
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('unreachable');
		expect(result.titleChanged).toBe(false);
		expect(result.note.title).toBe('Original Title');
	});

	it('allows renaming a note to a title that only collides with ITSELF (self-guid ignored)', async () => {
		// Scenario: a no-op edit flow where the title happens to already be
		// set. The self-guid must be filtered out of the uniqueness check.
		const target = makeNote({ guid: 'target', title: 'Self Only Title' });
		store.set(target.guid, { ...target });

		const result = await updateNoteFromEditor(
			target.guid,
			docWithTitleAndBody('Self Only Title', 'body changed')
		);

		expect(result.ok).toBe(true);
	});

	it('is case-sensitive for duplicate detection: "Apple Pie" vs "apple pie" are distinct', async () => {
		const target = makeNote({ guid: 'target', title: 'Original Title' });
		const other = makeNote({
			guid: 'other',
			title: 'apple pie',
			xmlContent: '<note-content version="0.1">apple pie\n\n</note-content>'
		});
		store.set(target.guid, { ...target });
		store.set(other.guid, { ...other });

		const result = await updateNoteFromEditor(
			target.guid,
			docWithTitleAndBody('Apple Pie', 'body')
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('unreachable');
		expect(result.note.title).toBe('Apple Pie');
	});

	it('returns { ok:false, error:{kind:"notFound"} } when the guid is unknown', async () => {
		const result = await updateNoteFromEditor('missing', docWithTitleAndBody('Hello World', ''));
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.error.kind).toBe('notFound');
	});
});
