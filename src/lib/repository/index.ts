import { idbNoteRepository } from './idbNoteRepository.js';
import { firestoreNoteRepository } from './firestoreNoteRepository.js';
import { isFirebaseConfigured } from '$lib/firebase/firebaseClient.js';
import { invalidateCache } from '$lib/stores/noteListCache.js';
import type { NoteRepository } from './NoteRepository.js';

/**
 * Active note repository. Resolves to Firestore when the
 * PUBLIC_FIREBASE_* env vars are set, and falls back to IndexedDB for
 * local development without Firebase credentials. Both implementations
 * satisfy the same `NoteRepository` interface, so callers never need to
 * know which backend is live.
 */
export const noteRepository: NoteRepository = isFirebaseConfigured
	? firestoreNoteRepository
	: idbNoteRepository;

// Pipe remote Firestore collection changes into the shared cache
// invalidator so `TopNav`, `/notes`, `SidePanel`, and `titleProvider`
// — all of which already subscribe via `onInvalidate` — rebuild when a
// remote device creates/edits/deletes a note. Also refresh the notebook
// cache + notify its subscribers so new `system:notebook:*` tags from
// other devices surface live. Guarded against SSR and test environments
// (no window / Firebase unconfigured).
if (isFirebaseConfigured && typeof window !== 'undefined') {
	try {
		noteRepository.subscribeCollection(() => {
			invalidateCache();
			// Dynamic import to avoid a module-load cycle:
			// `notebooks.ts` imports `noteRepository` from this file.
			void import('$lib/core/notebooks.js').then((m) => m.invalidateNotebooksCache());
		});
	} catch (err) {
		console.warn('[repository] subscribeCollection failed', err);
	}
}

export { isFirebaseConfigured };
export type { NoteRepository } from './NoteRepository.js';
