import 'fake-indexeddb/auto'; // installs IDBRequest, IDBKeyRange etc. as globals
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { getSetting, setSetting, deleteSetting } from '$lib/storage/appSettings.js';
import { _resetDBForTest } from '$lib/storage/db.js';

beforeEach(() => {
	// Fresh in-memory IDB for each test (keeps globals, resets data)
	globalThis.indexedDB = new IDBFactory();
	_resetDBForTest();
});

describe('appSettings', () => {
	it('returns undefined for unknown key', async () => {
		const val = await getSetting('nonexistent');
		expect(val).toBeUndefined();
	});

	it('roundtrips string value', async () => {
		await setSetting('myKey', 'hello');
		const val = await getSetting<string>('myKey');
		expect(val).toBe('hello');
	});

	it('overwrites previous value at same key', async () => {
		await setSetting('k', 'first');
		await setSetting('k', 'second');
		expect(await getSetting<string>('k')).toBe('second');
	});

	it('deleteSetting removes the row', async () => {
		await setSetting('toDelete', 'val');
		await deleteSetting('toDelete');
		expect(await getSetting('toDelete')).toBeUndefined();
	});

	it('stores structured value (object) intact', async () => {
		const obj = { a: 1, b: [2, 3] };
		await setSetting('obj', obj);
		expect(await getSetting('obj')).toEqual(obj);
	});

	it('upgrading from v3 drops syncManifest + sync indexes, preserves notes', async () => {
		// Open at v3 (pre-collab-fork schema) — put a note + manifest — close —
		// reopen via getDB() which upgrades to v4 (drops sync artifacts).
		const { openDB } = await import('idb');

		const dbOld = await openDB('tomboy-web', 3, {
			upgrade(db, oldVersion) {
				if (oldVersion < 1) {
					const noteStore = db.createObjectStore('notes', { keyPath: 'guid' });
					noteStore.createIndex('by-changeDate', 'changeDate');
					noteStore.createIndex('by-title', 'title');
					noteStore.createIndex('by-localDirty', 'localDirty');
					noteStore.createIndex('by-deleted', 'deleted');
					db.createObjectStore('syncManifest', { keyPath: 'id' });
				}
				if (oldVersion < 3) {
					db.createObjectStore('appSettings', { keyPath: 'id' });
				}
			}
		});

		await (dbOld as any).put('notes', {
			guid: 'test-guid',
			uri: 'note://tomboy/test-guid',
			title: 'Test',
			xmlContent: '',
			createDate: '',
			changeDate: '',
			metadataChangeDate: '',
			cursorPosition: 0,
			selectionBoundPosition: -1,
			width: 450,
			height: 360,
			x: 0,
			y: 0,
			tags: [],
			openOnStartup: false
		});
		await (dbOld as any).put('syncManifest', {
			id: 'manifest',
			lastSyncDate: '',
			lastSyncRev: 0,
			serverId: '',
			noteRevisions: {}
		});
		dbOld.close();

		const { getDB } = await import('$lib/storage/db.js');
		const dbNew = await getDB();

		// Note survives.
		const note = await dbNew.get('notes', 'test-guid');
		expect(note).toBeDefined();
		expect(note?.title).toBe('Test');

		// syncManifest store is gone; the sync-related indexes are gone.
		expect(dbNew.objectStoreNames.contains('syncManifest' as never)).toBe(false);
		const tx = dbNew.transaction('notes', 'readonly');
		expect(tx.store.indexNames.contains('by-localDirty' as never)).toBe(false);
		expect(tx.store.indexNames.contains('by-deleted' as never)).toBe(false);
	});
});
