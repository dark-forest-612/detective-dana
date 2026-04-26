import { getSetting, setSetting } from './appSettings.js';

/**
 * Local-only log of which notes were opened most recently. Stored as
 * a string[] of note guids in IndexedDB under the key
 * `recentNoteLog`. Most-recent is index 0. Capped at MAX_LOG_SIZE
 * to keep the row small. Never synced — this is a per-device hint
 * the side panel uses to surface the user's working set.
 */
export const RECENT_NOTE_LOG_KEY = 'recentNoteLog';
export const MAX_LOG_SIZE = 200;

// Pub/sub listeners
const listeners = new Set<() => void>();

/** Returns the current log (most-recent first). Empty array if none. */
export async function getRecentNoteLog(): Promise<string[]> {
	const log = await getSetting<string[]>(RECENT_NOTE_LOG_KEY);
	return log ?? [];
}

/** Records that `guid` was opened "now". Moves it to index 0,
 *  deduping any earlier entry for the same guid. Truncates to MAX_LOG_SIZE. */
export async function recordNoteOpened(guid: string): Promise<void> {
	const current = await getRecentNoteLog();
	// Remove any existing entry for this guid (dedup)
	const deduped = current.filter((g) => g !== guid);
	// Prepend to front
	deduped.unshift(guid);
	// Truncate to cap
	const trimmed = deduped.slice(0, MAX_LOG_SIZE);
	await setSetting(RECENT_NOTE_LOG_KEY, trimmed);
	// Notify listeners
	for (const cb of listeners) {
		cb();
	}
}

/** Returns a Map<guid, rank> where rank=0 means most-recent.
 *  Useful for cheap O(1) lookups when sorting note lists. */
export async function getRecentNoteRanks(): Promise<Map<string, number>> {
	const log = await getRecentNoteLog();
	const map = new Map<string, number>();
	for (let i = 0; i < log.length; i++) {
		map.set(log[i], i);
	}
	return map;
}

/** Sorts an array of notes by recent-open rank (most-recent first).
 *  Notes not in the log fall back to `fallbackSort(a, b)` (default:
 *  preserve input order — i.e., a stable no-op). Pure function aside
 *  from being driven by the precomputed rank map; takes the map as
 *  an argument so callers can subscribe-once and avoid re-reading. */
export function sortByRecentOpen<T extends { guid: string }>(
	notes: T[],
	ranks: Map<string, number>,
	fallbackSort?: (a: T, b: T) => number
): T[] {
	// Sentinel value for notes not in the log — larger than any valid rank
	const NOT_IN_LOG = ranks.size + notes.length;
	return [...notes].sort((a, b) => {
		const ra = ranks.has(a.guid) ? ranks.get(a.guid)! : NOT_IN_LOG;
		const rb = ranks.has(b.guid) ? ranks.get(b.guid)! : NOT_IN_LOG;
		if (ra !== rb) {
			return ra - rb;
		}
		// Both are in-log (same rank, impossible) or both not in log — use fallback
		if (fallbackSort) {
			return fallbackSort(a, b);
		}
		// Stable no-op: preserve original order via index comparison
		const ia = notes.indexOf(a);
		const ib = notes.indexOf(b);
		return ia - ib;
	});
}

/** Subscribe to log changes. Fires the callback after each successful
 *  `recordNoteOpened`. Returns an unsubscribe function. */
export function onRecentNoteLogChanged(cb: () => void): () => void {
	listeners.add(cb);
	return () => {
		listeners.delete(cb);
	};
}
