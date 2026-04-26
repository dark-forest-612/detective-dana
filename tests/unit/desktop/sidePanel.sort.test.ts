import { describe, it, expect } from 'vitest';
import type { NoteData } from '$lib/core/note.js';
import { orderSidePanelNotes } from '$lib/desktop/sidePanelSort.js';

/** Build a minimal NoteData fixture — only fields the sort logic touches. */
function makeNote(guid: string, changeDate: string, title = guid): NoteData {
	return {
		guid,
		title,
		changeDate,
		// Required fields we don't care about for sorting:
		uri: `note://tomboy/${guid}`,
		xmlContent: '',
		createDate: changeDate,
		metadataChangeDate: changeDate,
		cursorPosition: 0,
		selectionBoundPosition: -1,
		width: 450,
		height: 360,
		x: 0,
		y: 0,
		tags: [],
		openOnStartup: false,
		lock: null
	} as NoteData;
}

describe('orderSidePanelNotes', () => {
	it('최근 열람 기록이 없으면 changeDate 내림차순으로 정렬된다', () => {
		const notes = [
			makeNote('a', '2024-01-01T00:00:00+00:00'),
			makeNote('b', '2024-03-01T00:00:00+00:00'),
			makeNote('c', '2024-02-01T00:00:00+00:00')
		];
		const ranks = new Map<string, number>();
		const result = orderSidePanelNotes(notes, ranks);
		// No recent ranks → falls back to changeDate descending
		expect(result.map((n) => n.guid)).toEqual(['b', 'c', 'a']);
	});

	it('최근 열람한 노트가 가장 위로 온다', () => {
		const notes = [
			makeNote('a', '2024-03-01T00:00:00+00:00'), // newest by date
			makeNote('b', '2024-01-01T00:00:00+00:00'),
			makeNote('c', '2024-02-01T00:00:00+00:00')
		];
		// 'b' was opened most recently (rank 0), then 'c' (rank 1)
		const ranks = new Map<string, number>([
			['b', 0],
			['c', 1]
		]);
		const result = orderSidePanelNotes(notes, ranks);
		expect(result.map((n) => n.guid)).toEqual(['b', 'c', 'a']);
	});

	it('최근 열람 + 미기록 노트가 섞여 있을 때, 최근 열람 노트가 먼저, 나머지는 changeDate 순서', () => {
		const notes = [
			makeNote('newer', '2024-05-01T00:00:00+00:00'), // no rank — newest date
			makeNote('older', '2024-01-01T00:00:00+00:00'), // no rank — oldest date
			makeNote('mid', '2024-03-01T00:00:00+00:00'),   // no rank — mid date
			makeNote('recent', '2024-02-01T00:00:00+00:00') // rank 0 — most recently opened
		];
		const ranks = new Map<string, number>([['recent', 0]]);
		const result = orderSidePanelNotes(notes, ranks);
		// 'recent' first (has rank), then unranked notes in changeDate desc order
		expect(result[0].guid).toBe('recent');
		expect(result.slice(1).map((n) => n.guid)).toEqual(['newer', 'mid', 'older']);
	});
});
