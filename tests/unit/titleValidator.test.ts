import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { idbNoteRepository } from '$lib/repository/idbNoteRepository.js';
import { _resetDBForTest } from '$lib/storage/db.js';
import type { NoteData } from '$lib/core/note.js';
import {
	MIN_TITLE_LENGTH,
	validateTitle,
	validateTitleLength,
	validateTitleUnique
} from '$lib/core/titleValidator.js';

function makeNote(guid: string, title: string): NoteData {
	const iso = '2024-01-01T00:00:00Z';
	return {
		uri: `note://tomboy/${guid}`,
		guid,
		title,
		xmlContent: `<note-content version="0.1">${title}\n\n</note-content>`,
		createDate: iso,
		changeDate: iso,
		metadataChangeDate: iso,
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

describe('validateTitleLength', () => {
	it('rejects titles shorter than 5 chars', () => {
		const err = validateTitleLength('abc');
		expect(err).toEqual({ kind: 'tooShort', minLength: MIN_TITLE_LENGTH, actual: 3 });
	});

	it('accepts exactly 5 chars (boundary)', () => {
		expect(validateTitleLength('abcde')).toBeNull();
	});

	it('trims before counting, so "   ab   " is too short', () => {
		const err = validateTitleLength('   ab   ');
		expect(err).toEqual({ kind: 'tooShort', minLength: MIN_TITLE_LENGTH, actual: 2 });
	});

	it('rejects an empty string', () => {
		const err = validateTitleLength('');
		expect(err?.kind).toBe('tooShort');
		expect((err as { actual: number }).actual).toBe(0);
	});

	it('accepts a well-formed title', () => {
		expect(validateTitleLength('Hello world')).toBeNull();
	});
});

describe('validateTitleUnique (IDB)', () => {
	it('returns null when no other note has this title', async () => {
		await idbNoteRepository.put(makeNote('self', 'Apple Pie'));
		const result = await validateTitleUnique('Apple Pie', 'self', idbNoteRepository);
		expect(result).toBeNull();
	});

	it('returns null when the caller is renaming to the same title (ignores self guid)', async () => {
		await idbNoteRepository.put(makeNote('self', 'Hello World'));
		const result = await validateTitleUnique('Hello World', 'self', idbNoteRepository);
		expect(result).toBeNull();
	});

	it('returns duplicate when another note has the exact same title', async () => {
		await idbNoteRepository.put(makeNote('other', 'Hello World'));
		const result = await validateTitleUnique('Hello World', 'self', idbNoteRepository);
		expect(result).toEqual({ kind: 'duplicate', conflictGuid: 'other' });
	});

	it('is case-sensitive: "Apple" and "apple" are considered distinct', async () => {
		await idbNoteRepository.put(makeNote('lower', 'apple pie'));
		const result = await validateTitleUnique('Apple Pie', 'self', idbNoteRepository);
		expect(result).toBeNull();
	});

	it('trims surrounding whitespace on both sides before comparing', async () => {
		await idbNoteRepository.put(makeNote('other', 'Hello World'));
		const result = await validateTitleUnique('  Hello World  ', 'self', idbNoteRepository);
		expect(result).toEqual({ kind: 'duplicate', conflictGuid: 'other' });
	});

	it('returns null for an empty trimmed title (length check covers that case)', async () => {
		await idbNoteRepository.put(makeNote('other', 'Something'));
		const result = await validateTitleUnique('   ', 'self', idbNoteRepository);
		expect(result).toBeNull();
	});
});

describe('validateTitle (composed)', () => {
	it('returns the length error when title is too short (before even checking uniqueness)', async () => {
		await idbNoteRepository.put(makeNote('other', 'abc'));
		const result = await validateTitle('abc', 'self', idbNoteRepository);
		expect(result?.kind).toBe('tooShort');
	});

	it('returns duplicate when the title is long enough but collides', async () => {
		await idbNoteRepository.put(makeNote('other', 'Hello World'));
		const result = await validateTitle('Hello World', 'self', idbNoteRepository);
		expect(result).toEqual({ kind: 'duplicate', conflictGuid: 'other' });
	});

	it('returns null when the title passes both checks', async () => {
		await idbNoteRepository.put(makeNote('other', 'Something else'));
		const result = await validateTitle('Unique title', 'self', idbNoteRepository);
		expect(result).toBeNull();
	});
});
