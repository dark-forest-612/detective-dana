import 'fake-indexeddb/auto'; // installs IDBRequest, IDBKeyRange etc. as globals
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	getRecentNoteLog,
	recordNoteOpened,
	getRecentNoteRanks,
	sortByRecentOpen,
	onRecentNoteLogChanged,
	MAX_LOG_SIZE
} from '$lib/storage/recentNoteLog.js';
import { _resetDBForTest } from '$lib/storage/db.js';

beforeEach(() => {
	// Fresh in-memory IDB for each test (keeps globals, resets data)
	globalThis.indexedDB = new IDBFactory();
	_resetDBForTest();
});

describe('recentNoteLog', () => {
	// Test 1: empty log
	it('getRecentNoteLog returns [] when nothing recorded', async () => {
		const log = await getRecentNoteLog();
		expect(log).toEqual([]);
	});

	// Test 2: single record
	it('recordNoteOpened(g1) then getRecentNoteLog() returns [g1]', async () => {
		await recordNoteOpened('g1');
		const log = await getRecentNoteLog();
		expect(log).toEqual(['g1']);
	});

	// Test 3: most-recent first
	it('recordNoteOpened(g1); recordNoteOpened(g2) returns [g2, g1]', async () => {
		await recordNoteOpened('g1');
		await recordNoteOpened('g2');
		const log = await getRecentNoteLog();
		expect(log).toEqual(['g2', 'g1']);
	});

	// Test 4: dedup — recording existing guid moves it to front
	it('recording g1, g2, g1 returns [g1, g2] (no duplicate)', async () => {
		await recordNoteOpened('g1');
		await recordNoteOpened('g2');
		await recordNoteOpened('g1');
		const log = await getRecentNoteLog();
		expect(log).toEqual(['g1', 'g2']);
	});

	// Test 5: cap at MAX_LOG_SIZE
	it('caps at MAX_LOG_SIZE: recording 250 distinct guids → length === 200, oldest dropped', async () => {
		const guids: string[] = [];
		for (let i = 0; i < 250; i++) {
			guids.push(`guid-${i}`);
		}
		for (const g of guids) {
			await recordNoteOpened(g);
		}
		const log = await getRecentNoteLog();
		expect(log.length).toBe(MAX_LOG_SIZE);
		// Most recent is last recorded (guid-249)
		expect(log[0]).toBe('guid-249');
		// Oldest (guid-0 .. guid-49) are dropped
		expect(log).not.toContain('guid-0');
		expect(log).not.toContain('guid-49');
		// guid-50 is the oldest surviving one
		expect(log[MAX_LOG_SIZE - 1]).toBe('guid-50');
	});

	// Test 6: getRecentNoteRanks
	it('getRecentNoteRanks: after recording g3, g2, g1 → ranks are correct', async () => {
		await recordNoteOpened('g3');
		await recordNoteOpened('g2');
		await recordNoteOpened('g1');
		const ranks = await getRecentNoteRanks();
		// log is [g1, g2, g3] so g1→0, g2→1, g3→2
		expect(ranks.get('g1')).toBe(0);
		expect(ranks.get('g2')).toBe(1);
		expect(ranks.get('g3')).toBe(2);
		// Unrelated guid not in map
		expect(ranks.has('unknown')).toBe(false);
	});

	// Test 7: sortByRecentOpen basic
	it('sortByRecentOpen sorts notes by rank; unlisted notes fall back to original position', () => {
		const notes = [{ guid: 'a' }, { guid: 'b' }, { guid: 'c' }];
		const ranks = new Map<string, number>([
			['b', 0],
			['a', 1]
		]);
		const sorted = sortByRecentOpen(notes, ranks);
		expect(sorted.map((n) => n.guid)).toEqual(['b', 'a', 'c']);
	});

	// Test 8: sortByRecentOpen with fallbackSort
	it('sortByRecentOpen with fallbackSort: notes not in ranks use fallback', () => {
		const notes = [{ guid: 'b' }, { guid: 'a' }];
		const ranks = new Map<string, number>();
		// fallback sorts alphabetically
		const fallback = (x: { guid: string }, y: { guid: string }) => x.guid.localeCompare(y.guid);
		const sorted = sortByRecentOpen(notes, ranks, fallback);
		expect(sorted.map((n) => n.guid)).toEqual(['a', 'b']);
	});

	// Test 9: onRecentNoteLogChanged pub/sub
	it('onRecentNoteLogChanged fires after recordNoteOpened; unsubscribe stops calls', async () => {
		const cb = vi.fn();
		const unsub = onRecentNoteLogChanged(cb);

		await recordNoteOpened('x');
		expect(cb).toHaveBeenCalledTimes(1);

		await recordNoteOpened('y');
		expect(cb).toHaveBeenCalledTimes(2);

		unsub();

		await recordNoteOpened('z');
		expect(cb).toHaveBeenCalledTimes(2); // no more calls after unsubscribe
	});
});
