import type { NoteData } from '$lib/core/note.js';
import { sortForList } from '$lib/core/noteManager.js';
import { sortByRecentOpen } from '$lib/storage/recentNoteLog.js';

/**
 * Order side-panel notes: most-recently-opened first, with notes
 * never opened falling back to changeDate-descending. Caller is
 * responsible for slicing to the display cap.
 */
export function orderSidePanelNotes(
	notes: NoteData[],
	recentRanks: Map<string, number>
): NoteData[] {
	const dateSorted = sortForList(notes, 'changeDate');
	return sortByRecentOpen(dateSorted, recentRanks);
}
