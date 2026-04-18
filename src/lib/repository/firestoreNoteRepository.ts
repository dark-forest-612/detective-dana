import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	onSnapshot,
	runTransaction,
	setDoc,
	updateDoc,
	type QueryDocumentSnapshot
} from 'firebase/firestore';
import { getFirestoreClient } from '$lib/firebase/firebaseClient.js';
import type { NoteData, NoteLock } from '$lib/core/note.js';
import type { AcquireLockResult, NoteRepository } from './NoteRepository.js';

const COLLECTION = 'notes';
const TEMPLATE_TAG = 'system:template';

function toNoteData(snap: QueryDocumentSnapshot): NoteData {
	return snap.data() as NoteData;
}

function byChangeDateDesc(a: NoteData, b: NoteData): number {
	return b.changeDate > a.changeDate ? 1 : -1;
}

export const firestoreNoteRepository: NoteRepository = {
	async getAll() {
		const db = getFirestoreClient();
		const snap = await getDocs(collection(db, COLLECTION));
		return snap.docs
			.map(toNoteData)
			.filter((n) => !n.tags.includes(TEMPLATE_TAG))
			.sort(byChangeDateDesc);
	},

	async getAllIncludingTemplates() {
		const db = getFirestoreClient();
		const snap = await getDocs(collection(db, COLLECTION));
		return snap.docs.map(toNoteData).sort(byChangeDateDesc);
	},

	async get(guid) {
		const db = getFirestoreClient();
		const snap = await getDoc(doc(db, COLLECTION, guid));
		if (!snap.exists()) return undefined;
		return snap.data() as NoteData;
	},

	async put(note) {
		const db = getFirestoreClient();
		// Strip `lock` and use merge:true so content writes never touch
		// the lock field — acquire/heartbeat/release transactions own it.
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { lock: _lock, ...rest } = note;
		await setDoc(doc(db, COLLECTION, note.guid), rest, { merge: true });
	},

	async delete(guid) {
		const db = getFirestoreClient();
		await deleteDoc(doc(db, COLLECTION, guid));
	},

	async findByTitle(title) {
		const needle = title.trim().toLowerCase();
		if (!needle) return undefined;
		const db = getFirestoreClient();
		const snap = await getDocs(collection(db, COLLECTION));
		const matches = snap.docs
			.map(toNoteData)
			.filter((n) => n.title.trim().toLowerCase() === needle);
		if (matches.length === 0) return undefined;
		matches.sort(byChangeDateDesc);
		return matches[0];
	},

	// --- Collab lock primitives (Phase 4) ---

	async acquireLock(guid, holder, holderName, ttlMs): Promise<AcquireLockResult> {
		const db = getFirestoreClient();
		const ref = doc(db, COLLECTION, guid);
		return runTransaction(db, async (tx) => {
			const snap = await tx.get(ref);
			if (!snap.exists()) return { ok: false, reason: 'not-found' as const };
			const note = snap.data() as NoteData;
			const now = Date.now();
			const existing = note.lock ?? null;
			if (existing && existing.expiresAtMs > now && existing.holder !== holder) {
				return {
					ok: false,
					reason: 'held-by-other' as const,
					expiresAtMs: existing.expiresAtMs,
					holder: existing.holder,
					holderName: existing.holderName
				};
			}
			const nextLock: NoteLock = {
				holder,
				holderName,
				acquiredAtMs: now,
				expiresAtMs: now + ttlMs
			};
			tx.update(ref, { lock: nextLock });
			return { ok: true };
		});
	},

	async releaseLock(guid, holder) {
		const db = getFirestoreClient();
		const ref = doc(db, COLLECTION, guid);
		// Transaction so we don't accidentally clear a lock that was taken
		// over in between our read and our release.
		await runTransaction(db, async (tx) => {
			const snap = await tx.get(ref);
			if (!snap.exists()) return;
			const note = snap.data() as NoteData;
			if (note.lock && note.lock.holder === holder) {
				tx.update(ref, { lock: null });
			}
		});
	},

	async heartbeatLock(guid, holder, ttlMs) {
		const db = getFirestoreClient();
		const ref = doc(db, COLLECTION, guid);
		await runTransaction(db, async (tx) => {
			const snap = await tx.get(ref);
			if (!snap.exists()) return;
			const note = snap.data() as NoteData;
			if (!note.lock || note.lock.holder !== holder) return;
			const nextLock: NoteLock = {
				...note.lock,
				expiresAtMs: Date.now() + ttlMs
			};
			tx.update(ref, { lock: nextLock });
		});
		// `updateDoc` import kept in case we switch to a plain update in
		// profiled hotpaths — transactions cost an extra read each heartbeat.
		void updateDoc;
	},

	subscribeNote(guid, cb) {
		const db = getFirestoreClient();
		return onSnapshot(doc(db, COLLECTION, guid), (snap) => {
			cb(snap.exists() ? (snap.data() as NoteData) : undefined);
		});
	},

	subscribeCollection(cb) {
		const db = getFirestoreClient();
		return onSnapshot(collection(db, COLLECTION), () => cb());
	}
};
