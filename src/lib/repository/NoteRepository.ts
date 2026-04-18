import type { NoteData } from '$lib/core/note.js';

export type AcquireLockResult =
	| { ok: true }
	| { ok: false; reason: 'held-by-other'; expiresAtMs: number; holder: string; holderName?: string }
	| { ok: false; reason: 'not-found' };

/**
 * Storage-agnostic contract for the note collection. Phase 2 introduced
 * the CRUD methods; Phase 4 added lock primitives and `subscribeNote` so
 * the collab controller can react to remote changes without polling.
 *
 * Implementations must:
 * - Sort `getAll*` results by `changeDate` descending.
 * - Compare titles case-insensitively in `findByTitle` and return the
 *   most recently changed match.
 * - Acquire/heartbeat atomically so two racing clients never both believe
 *   they hold a lock (Firestore transaction; IDB is single-writer).
 */
export interface NoteRepository {
	/** All notes, excluding notebook template notes (tag `system:template`). */
	getAll(): Promise<NoteData[]>;

	/** All notes including template notes — used by notebook management. */
	getAllIncludingTemplates(): Promise<NoteData[]>;

	/** Load a single note by GUID. */
	get(guid: string): Promise<NoteData | undefined>;

	/**
	 * Insert or update a note. Overwrites any existing row with the same
	 * GUID. Implementations must preserve the stored `lock` field unless
	 * the caller explicitly sets it (the editor save path never touches
	 * the lock — `heartbeatLock` handles that).
	 */
	put(note: NoteData): Promise<void>;

	/** Hard-delete a note. */
	delete(guid: string): Promise<void>;

	/** Most recently changed note whose title matches `title` case-insensitively. */
	findByTitle(title: string): Promise<NoteData | undefined>;

	// --- Collab lock primitives (Phase 4) ---

	/**
	 * Attempt to acquire the edit lock on `guid`. Succeeds when the note
	 * has no lock, its lock has expired, or the caller already holds it
	 * (idempotent refresh). Returns `ok:false` with the current holder
	 * info when a live lock is held by someone else.
	 */
	acquireLock(
		guid: string,
		holder: string,
		holderName: string | undefined,
		ttlMs: number
	): Promise<AcquireLockResult>;

	/** Release the lock if (and only if) `holder` currently owns it. */
	releaseLock(guid: string, holder: string): Promise<void>;

	/**
	 * Bump the lock's `expiresAtMs` to `now + ttlMs` iff `holder` is the
	 * current owner. Silent no-op if the lock was taken over or released
	 * while the caller was idle — the controller detects this via
	 * `subscribeNote` and transitions state.
	 */
	heartbeatLock(guid: string, holder: string, ttlMs: number): Promise<void>;

	/**
	 * Subscribe to changes on a single note. The callback fires with
	 * `undefined` when the note is deleted and with the fresh NoteData
	 * otherwise. Returns an unsubscribe function.
	 *
	 * IDB implementation fires once synchronously and never updates —
	 * locks don't need cross-tab reactivity for the single-user fallback.
	 */
	subscribeNote(guid: string, cb: (note: NoteData | undefined) => void): () => void;

	/**
	 * Subscribe to any change in the full note collection — creates,
	 * updates, deletes. The callback is parameterless because listeners
	 * (note list UIs, auto-link provider) already re-query on change;
	 * delivering the doc set here would duplicate their work.
	 *
	 * IDB implementation returns a no-op unsubscribe: single-user IDB
	 * writes already call `invalidateCache()` directly.
	 */
	subscribeCollection(cb: () => void): () => void;
}
