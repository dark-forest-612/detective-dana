import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteData } from '$lib/core/note.js';

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
import { deserializeContent } from '$lib/core/noteContentArchiver.js';

function makeNote(overrides: Partial<NoteData> = {}): NoteData {
	return {
		uri: 'note://tomboy/abc',
		guid: 'abc',
		title: 'Hello',
		xmlContent: '<note-content version="0.1">Hello\n\nbody</note-content>',
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

beforeEach(() => {
	store.clear();
	putSpy.mockReset();
});

describe('updateNoteFromEditor — no-op save skip', () => {
	it('does NOT touch the note when the serialized doc matches the stored xmlContent', async () => {
		const xml = '<note-content version="0.1">Hello\n\nbody</note-content>';
		const note = makeNote({ xmlContent: xml });
		store.set(note.guid, note);

		// User "typed and undid" — the resulting doc is identical to what's stored.
		const doc = deserializeContent(xml);

		const result = await updateNoteFromEditor(note.guid, doc);

		// No write, no date change.
		expect(putSpy).not.toHaveBeenCalled();
		expect(result?.changeDate).toBe(note.changeDate);
		expect(result?.metadataChangeDate).toBe(note.metadataChangeDate);

		// Stored note should be untouched.
		expect(store.get(note.guid)?.changeDate).toBe(note.changeDate);
	});

	it('DOES save when the serialized doc differs from the stored xmlContent', async () => {
		const xml = '<note-content version="0.1">Hello\n\nbody</note-content>';
		const originalDate = '2024-06-01T10:20:30.1234567+00:00';
		const note = makeNote({ xmlContent: xml, changeDate: originalDate });
		store.set(note.guid, { ...note });

		const newDoc = deserializeContent(
			'<note-content version="0.1">Hello\n\nbody changed</note-content>'
		);

		const result = await updateNoteFromEditor(note.guid, newDoc);

		expect(putSpy).toHaveBeenCalledTimes(1);
		expect(result?.changeDate).not.toBe(originalDate);
		expect(store.get(note.guid)?.xmlContent).toContain('body changed');
	});
});
