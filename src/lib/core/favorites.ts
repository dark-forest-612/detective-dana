// Device-local favorites. Unlike notes themselves, favorites never leave
// the device — each browser/user keeps its own set in IndexedDB
// (appSettings row `localFavorites`) so collaborators on the same note
// can independently pin what matters to them.
//
// A `SvelteSet` backs the store so UI code can call `isFavorite(guid)`
// inside `$derived` / `{#if}` without any subscription boilerplate;
// toggling re-runs every dependent computation.

import { SvelteSet } from 'svelte/reactivity';
import { getSetting, setSetting } from '$lib/storage/appSettings.js';

const KEY = 'localFavorites';

const _favorites = new SvelteSet<string>();
let _loadPromise: Promise<void> | null = null;

export function loadFavorites(): Promise<void> {
	if (_loadPromise) return _loadPromise;
	_loadPromise = (async () => {
		const stored = await getSetting<string[]>(KEY);
		if (Array.isArray(stored)) {
			for (const g of stored) _favorites.add(g);
		}
	})();
	return _loadPromise;
}

function persist(): Promise<void> {
	return setSetting(KEY, Array.from(_favorites));
}

export function isFavorite(guid: string): boolean {
	return _favorites.has(guid);
}

export async function toggleFavorite(guid: string): Promise<boolean> {
	// Ensure we've merged any previously-saved state before mutating,
	// otherwise a toggle before the initial load finishes would persist
	// only this one guid and wipe the rest.
	await loadFavorites();
	const next = !_favorites.has(guid);
	if (next) _favorites.add(guid);
	else _favorites.delete(guid);
	await persist();
	return next;
}

/** Clear a favorite without toggling. Called when a note is deleted. */
export async function removeFavorite(guid: string): Promise<void> {
	if (!_favorites.has(guid)) return;
	_favorites.delete(guid);
	await persist();
}

/** Test hook. */
export function _resetFavoritesForTest(): void {
	_favorites.clear();
	_loadPromise = null;
}
