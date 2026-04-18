/**
 * Browser-local identity for the collaboration layer.
 *
 * Phase 4 runs without Firebase Auth: each browser mints a random UUID on
 * first use and stores it in localStorage so we can identify "the same
 * editor across reloads" for lock ownership. The optional display name is
 * just cosmetic — it surfaces in the "X님이 편집 중" banner on other
 * people's screens.
 *
 * This is NOT secure identity. A malicious client can claim any UUID.
 * Security-relevant enforcement needs App Check + Firebase Auth (Phase 5).
 */

const CLIENT_ID_KEY = 'tomboy:clientId';
const CLIENT_NAME_KEY = 'tomboy:clientName';

let cachedId: string | null = null;

export function getClientId(): string {
	if (cachedId) return cachedId;
	if (typeof localStorage === 'undefined') {
		// SSR/tests: use a stable placeholder. Code that compares holders
		// still works; we just never actually persist.
		return 'client-ssr';
	}
	let id = localStorage.getItem(CLIENT_ID_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(CLIENT_ID_KEY, id);
	}
	cachedId = id;
	return id;
}

export function getClientName(): string | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	const v = localStorage.getItem(CLIENT_NAME_KEY);
	return v && v.length > 0 ? v : undefined;
}

export function setClientName(name: string): void {
	const trimmed = name.trim();
	if (typeof localStorage === 'undefined') return;
	if (trimmed.length === 0) {
		localStorage.removeItem(CLIENT_NAME_KEY);
	} else {
		localStorage.setItem(CLIENT_NAME_KEY, trimmed);
	}
}

/** Reset the cached client id — test hook. */
export function _resetIdentityForTest(): void {
	cachedId = null;
}
