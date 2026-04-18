import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { sortForList, createNote, deleteNoteById } from '$lib/core/noteManager.js';
import {
	toggleFavorite,
	isFavorite,
	loadFavorites,
	_resetFavoritesForTest
} from '$lib/core/favorites.js';
import { _resetDBForTest } from '$lib/storage/db.js';

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	_resetDBForTest();
	_resetFavoritesForTest();
});

describe('favorite (local, per-device)', () => {
	it('toggleFavorite flips membership', async () => {
		const n = await createNote('test');
		expect(isFavorite(n.guid)).toBe(false);
		const added = await toggleFavorite(n.guid);
		expect(added).toBe(true);
		expect(isFavorite(n.guid)).toBe(true);
		const removed = await toggleFavorite(n.guid);
		expect(removed).toBe(false);
		expect(isFavorite(n.guid)).toBe(false);
	});

	it('does not write any tag onto the note', async () => {
		const n = await createNote('test');
		await toggleFavorite(n.guid);
		// Note itself stays untouched — nothing syncs to Firestore from here.
		expect(n.tags).not.toContain('system:pinned');
	});

	it('persists across reloads via appSettings', async () => {
		const n = await createNote('test');
		await toggleFavorite(n.guid);

		// Simulate a fresh session: drop the in-memory set but keep IDB.
		_resetFavoritesForTest();
		expect(isFavorite(n.guid)).toBe(false);
		await loadFavorites();
		expect(isFavorite(n.guid)).toBe(true);
	});

	it('deleting a note clears its favorite entry', async () => {
		const n = await createNote('test');
		await toggleFavorite(n.guid);
		await deleteNoteById(n.guid);
		expect(isFavorite(n.guid)).toBe(false);
	});

	it('sortForList puts favorited notes first then by changeDate desc', async () => {
		const a = await createNote('a');
		await new Promise((r) => setTimeout(r, 5));
		const b = await createNote('b');
		await toggleFavorite(a.guid); // pin the older note

		const sorted = sortForList([b, a], 'changeDate');
		expect(sorted[0].guid).toBe(a.guid);
		expect(sorted[1].guid).toBe(b.guid);
	});
});
