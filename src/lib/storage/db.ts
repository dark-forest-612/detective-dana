import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface TomboyDB extends DBSchema {
	notes: {
		key: string;
		value: {
			guid: string;
			uri: string;
			title: string;
			xmlContent: string;
			createDate: string;
			changeDate: string;
			metadataChangeDate: string;
			cursorPosition: number;
			selectionBoundPosition: number;
			width: number;
			height: number;
			x: number;
			y: number;
			tags: string[];
			openOnStartup: boolean;
			lock?: {
				holder: string;
				holderName?: string;
				acquiredAtMs: number;
				expiresAtMs: number;
			} | null;
		};
		indexes: {
			'by-changeDate': string;
			'by-title': string;
		};
	};
	appSettings: {
		key: string;
		value: { id: string; value: unknown };
	};
}

const DB_NAME = 'tomboy-web';
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase<TomboyDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<TomboyDB>> {
	if (!dbPromise) {
		dbPromise = openDB<TomboyDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion, _newVersion, tx) {
				if (oldVersion < 1) {
					const noteStore = db.createObjectStore('notes', { keyPath: 'guid' });
					noteStore.createIndex('by-changeDate', 'changeDate');
					noteStore.createIndex('by-title', 'title');
				}

				if (oldVersion < 3) {
					db.createObjectStore('appSettings', { keyPath: 'id' });
				}

				if (oldVersion < 4) {
					// Phase 1 (collab fork): drop Dropbox-sync artifacts.
					// These stores/indexes only existed on databases created by
					// earlier versions; the current schema type no longer knows
					// about them, hence the `never` casts.
					const storeNames = db.objectStoreNames as unknown as DOMStringList;
					if (storeNames.contains('syncManifest')) {
						db.deleteObjectStore('syncManifest' as never);
					}
					const notes = tx.objectStore('notes');
					const indexNames = notes.indexNames as unknown as DOMStringList;
					for (const idx of ['by-localDirty', 'by-deleted']) {
						if (indexNames.contains(idx)) {
							notes.deleteIndex(idx as never);
						}
					}
				}
			}
		});
	}
	return dbPromise;
}

/** Reset DB promise (for testing with fake-indexeddb) */
export function _resetDBForTest(): void {
	dbPromise = null;
}

export type { TomboyDB };
