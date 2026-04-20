import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { idbNoteRepository } from '$lib/repository/idbNoteRepository.js';
import { _resetDBForTest } from '$lib/storage/db.js';
import type { NoteData } from '$lib/core/note.js';

function makeNote(guid: string, title: string, changeDate: string): NoteData {
	return {
		uri: `note://tomboy/${guid}`,
		guid,
		title,
		xmlContent: `<note-content version="0.1">${title}\n\n</note-content>`,
		createDate: changeDate,
		changeDate,
		metadataChangeDate: changeDate,
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

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	_resetDBForTest();
});

describe('idbNoteRepository.findByTitle — case sensitivity', () => {
	it('does NOT return a lower-case note when searching with upper-case title', async () => {
		await idbNoteRepository.put(makeNote('lower', 'apple', '2024-01-01T00:00:00Z'));
		const result = await idbNoteRepository.findByTitle('Apple');
		expect(result).toBeUndefined();
	});

	it('does NOT return an upper-case note when searching with lower-case title', async () => {
		await idbNoteRepository.put(makeNote('upper', 'APPLE', '2024-01-01T00:00:00Z'));
		const result = await idbNoteRepository.findByTitle('apple');
		expect(result).toBeUndefined();
	});

	it('returns the exact-case match when multiple case variants coexist', async () => {
		await idbNoteRepository.put(makeNote('a-lower', 'apple', '2024-01-01T00:00:00Z'));
		await idbNoteRepository.put(makeNote('a-upper', 'APPLE', '2024-02-01T00:00:00Z'));
		await idbNoteRepository.put(makeNote('a-title', 'Apple', '2024-03-01T00:00:00Z'));

		expect((await idbNoteRepository.findByTitle('apple'))?.guid).toBe('a-lower');
		expect((await idbNoteRepository.findByTitle('APPLE'))?.guid).toBe('a-upper');
		expect((await idbNoteRepository.findByTitle('Apple'))?.guid).toBe('a-title');
	});

	it('still trims surrounding whitespace on the needle (but not case)', async () => {
		await idbNoteRepository.put(makeNote('t', 'Apple', '2024-01-01T00:00:00Z'));
		expect((await idbNoteRepository.findByTitle('  Apple  '))?.guid).toBe('t');
		// But case mismatch still fails.
		expect(await idbNoteRepository.findByTitle('  apple  ')).toBeUndefined();
	});
});
