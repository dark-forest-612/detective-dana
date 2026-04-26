import { getSetting, setSetting } from './appSettings.js';
import { APP_SETTINGS_COLLECTION, isFirebaseConfigured } from '$lib/firebase/firebaseClient.js';

/**
 * Cross-device key/value settings. Writes to Firestore
 * `appSettings/{id}` when Firebase is configured so changes on one
 * device propagate live to others; falls back to a local-only
 * IndexedDB key/value row otherwise.
 *
 * The Firestore document shape is `{ value: T }` so we can round-trip
 * arbitrary JSON without reserving top-level field names. Writes use
 * `setDoc(..., { merge: true })` to keep the door open for future
 * per-key metadata without stomping existing rows.
 *
 * Auth is still not wired up (Phase 5), so the Firestore path relies
 * on open rules scoped to `appSettings/*` — same cooperative-trust
 * model as note documents. Do not stash secrets here.
 */

const COLLECTION = APP_SETTINGS_COLLECTION;

/**
 * Setting id for the notebook names shown as tabs in the top nav.
 * Stored as `string[]` in display order.
 */
export const TAB_NOTEBOOKS_KEY = 'tabNotebooks';

/**
 * Setting id for the global ordering of notebook categories. Stored
 * as a `string[]` of notebook names in display order. Consumed by
 * the top nav, settings UI, and side panel notebook chips. Names
 * not present in this list fall back to alphabetical order.
 */
export const CATEGORY_ORDER_KEY = 'categoryOrder';

type FirestoreModule = typeof import('firebase/firestore');

let firestoreModulePromise: Promise<FirestoreModule> | null = null;

function loadFirestore(): Promise<FirestoreModule> {
	if (!firestoreModulePromise) {
		firestoreModulePromise = import('firebase/firestore');
	}
	return firestoreModulePromise;
}

async function docRef(id: string) {
	const { doc } = await loadFirestore();
	const { getFirestoreClient } = await import('$lib/firebase/firebaseClient.js');
	return doc(getFirestoreClient(), COLLECTION, id);
}

export async function getSyncedSetting<T>(id: string): Promise<T | undefined> {
	if (!isFirebaseConfigured) {
		return getSetting<T>(id);
	}
	try {
		const { getDoc } = await loadFirestore();
		const snap = await getDoc(await docRef(id));
		if (!snap.exists()) return undefined;
		const data = snap.data() as { value?: T } | undefined;
		return data?.value;
	} catch (err) {
		console.warn('[syncedSettings] getSyncedSetting failed, falling back to IDB', err);
		return getSetting<T>(id);
	}
}

export async function setSyncedSetting<T>(id: string, value: T): Promise<void> {
	if (!isFirebaseConfigured) {
		await setSetting<T>(id, value);
		return;
	}
	try {
		const { setDoc } = await loadFirestore();
		await setDoc(await docRef(id), { value }, { merge: true });
	} catch (err) {
		console.warn('[syncedSettings] setSyncedSetting failed, falling back to IDB', err);
		await setSetting<T>(id, value);
	}
}

/**
 * Subscribe to value changes. When Firebase is configured this uses
 * `onSnapshot` for live updates; otherwise the callback fires once
 * with the current IDB value and the returned unsubscribe is a no-op
 * (mirrors `idbNoteRepository.subscribeNote`).
 */
export function subscribeSyncedSetting<T>(
	id: string,
	cb: (v: T | undefined) => void
): () => void {
	if (!isFirebaseConfigured) {
		void getSetting<T>(id).then((v) => cb(v));
		return () => {};
	}

	let unsub: (() => void) | null = null;
	let cancelled = false;

	(async () => {
		try {
			const { onSnapshot } = await loadFirestore();
			const ref = await docRef(id);
			if (cancelled) return;
			unsub = onSnapshot(ref, (snap) => {
				if (!snap.exists()) {
					cb(undefined);
					return;
				}
				const data = snap.data() as { value?: T } | undefined;
				cb(data?.value);
			});
		} catch (err) {
			console.warn('[syncedSettings] subscribeSyncedSetting failed, using IDB one-shot', err);
			const v = await getSetting<T>(id);
			if (!cancelled) cb(v);
		}
	})();

	return () => {
		cancelled = true;
		if (unsub) unsub();
	};
}
