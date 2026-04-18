import { getDB } from '$lib/storage/db.js';
import type { NoteData, NoteLock } from '$lib/core/note.js';
import type { AcquireLockResult, NoteRepository } from './NoteRepository.js';

const TEMPLATE_TAG = 'system:template';

function byChangeDateDesc(a: NoteData, b: NoteData): number {
	return b.changeDate > a.changeDate ? 1 : -1;
}

export const idbNoteRepository: NoteRepository = {
	async getAll() {
		const db = await getDB();
		const all = await db.getAll('notes');
		return all.filter((n) => !n.tags.includes(TEMPLATE_TAG)).sort(byChangeDateDesc);
	},

	async getAllIncludingTemplates() {
		const db = await getDB();
		const all = await db.getAll('notes');
		return all.sort(byChangeDateDesc);
	},

	async get(guid) {
		const db = await getDB();
		return db.get('notes', guid);
	},

	async put(note) {
		const db = await getDB();
		// Never let a content write clobber the current lock. The
		// caller's `note` holds the lock value it saw at read time,
		// which can race against heartbeat/release transactions. Merge
		// the stored lock back in instead.
		const stored = await db.get('notes', note.guid);
		const preservedLock = stored?.lock ?? null;
		await db.put('notes', { ...note, lock: preservedLock });
	},

	async delete(guid) {
		const db = await getDB();
		await db.delete('notes', guid);
	},

	async findByTitle(title) {
		const db = await getDB();
		const needle = title.trim().toLowerCase();
		if (!needle) return undefined;
		const all = await db.getAll('notes');
		const matches = all.filter((n) => n.title.trim().toLowerCase() === needle);
		if (matches.length === 0) return undefined;
		matches.sort(byChangeDateDesc);
		return matches[0];
	},

	// --- Collab lock primitives ---
	//
	// IDB is single-writer per browser, so no transaction is needed — the
	// lock state just mirrors the Firestore shape so the controller code
	// path is identical across backends. Takeover of a "stale" lock on the
	// same device is the only case that matters and it always succeeds.

	async acquireLock(guid, holder, holderName, ttlMs): Promise<AcquireLockResult> {
		const db = await getDB();
		const note = await db.get('notes', guid);
		if (!note) return { ok: false, reason: 'not-found' };
		const now = Date.now();
		const existing = note.lock ?? null;
		if (existing && existing.expiresAtMs > now && existing.holder !== holder) {
			return {
				ok: false,
				reason: 'held-by-other',
				expiresAtMs: existing.expiresAtMs,
				holder: existing.holder,
				holderName: existing.holderName
			};
		}
		const lock: NoteLock = {
			holder,
			holderName,
			acquiredAtMs: now,
			expiresAtMs: now + ttlMs
		};
		note.lock = lock;
		await db.put('notes', note);
		return { ok: true };
	},

	async releaseLock(guid, holder) {
		const db = await getDB();
		const note = await db.get('notes', guid);
		if (!note) return;
		if (note.lock && note.lock.holder === holder) {
			note.lock = null;
			await db.put('notes', note);
		}
	},

	async heartbeatLock(guid, holder, ttlMs) {
		const db = await getDB();
		const note = await db.get('notes', guid);
		if (!note || !note.lock || note.lock.holder !== holder) return;
		note.lock = { ...note.lock, expiresAtMs: Date.now() + ttlMs };
		await db.put('notes', note);
	},

	subscribeNote(guid, cb) {
		// No cross-tab IDB change events in the simple fallback path; we
		// fire once with the current value and let the caller's own writes
		// (through this same module) be the update source.
		void (async () => {
			const db = await getDB();
			const note = await db.get('notes', guid);
			cb(note);
		})();
		return () => {};
	},

	subscribeCollection(_cb) {
		// Single-user IDB — noteManager already calls invalidateCache()
		// on every mutation, so there's nothing to plumb here.
		return () => {};
	}
};
