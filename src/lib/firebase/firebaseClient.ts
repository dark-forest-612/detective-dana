import { env } from '$env/dynamic/public';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager,
	type Firestore
} from 'firebase/firestore';

interface FirebaseConfig {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket: string;
	messagingSenderId: string;
	appId: string;
}

function readConfig(): FirebaseConfig | null {
	const apiKey = env.PUBLIC_FIREBASE_API_KEY;
	if (!apiKey) return null;
	return {
		apiKey,
		authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
		projectId: env.PUBLIC_FIREBASE_PROJECT_ID ?? '',
		storageBucket: env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
		messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
		appId: env.PUBLIC_FIREBASE_APP_ID ?? ''
	};
}

/**
 * `true` when every required PUBLIC_FIREBASE_* env var is present. The
 * repository selector uses this to decide between IDB and Firestore without
 * taking a dependency on Firebase being actually reachable.
 */
export const isFirebaseConfigured = readConfig() !== null;

export const NOTES_COLLECTION =
	env.PUBLIC_FIREBASE_NOTES_COLLECTION || 'notes';
export const APP_SETTINGS_COLLECTION =
	env.PUBLIC_FIREBASE_APP_SETTINGS_COLLECTION || 'appSettings';

let firebaseApp: FirebaseApp | null = null;
let firestore: Firestore | null = null;

/**
 * Lazy Firestore accessor. `initializeApp` + `initializeFirestore` run on
 * the first call and are cached for the page's lifetime. The persistent
 * local cache keeps the app offline-capable (Firestore's own IDB layer
 * replaces the role the old `storage/db.ts` played for sync).
 */
export function getFirestoreClient(): Firestore {
	if (firestore) return firestore;
	const config = readConfig();
	if (!config) {
		throw new Error(
			'Firebase is not configured. Set PUBLIC_FIREBASE_* env vars in .env.'
		);
	}
	firebaseApp = initializeApp(config);
	firestore = initializeFirestore(firebaseApp, {
		localCache: persistentLocalCache({
			tabManager: persistentMultipleTabManager()
		})
	});
	return firestore;
}
