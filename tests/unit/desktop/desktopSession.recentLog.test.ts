import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { _resetDBForTest } from '$lib/storage/db.js';
import { noteRepository } from '$lib/repository/index.js';
import { createEmptyNote } from '$lib/core/note.js';
import { getRecentNoteLog } from '$lib/storage/recentNoteLog.js';
import { SETTINGS_WINDOW_GUID } from '$lib/desktop/session.svelte.js';

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	_resetDBForTest();
});

async function seedNote(guid: string) {
	await noteRepository.put(createEmptyNote(guid));
}

describe('desktopSession — recent-note log integration', () => {
	it('openWindow records a note guid in the recent-open log', async () => {
		const guid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
		await seedNote(guid);

		const { desktopSession } = await import('$lib/desktop/session.svelte.js');
		desktopSession._reset();

		desktopSession.openWindow(guid);

		// Give any microtasks (fire-and-forget promise) a chance to settle
		await new Promise((r) => setTimeout(r, 50));

		const log = await getRecentNoteLog();
		expect(log).toContain(guid);
	});

	it('openWindow on the settings singleton does NOT touch the recent-open log', async () => {
		const { desktopSession } = await import('$lib/desktop/session.svelte.js');
		desktopSession._reset();

		desktopSession.openSettings();

		await new Promise((r) => setTimeout(r, 50));

		const log = await getRecentNoteLog();
		expect(log).not.toContain(SETTINGS_WINDOW_GUID);
		expect(log).toHaveLength(0);
	});

	it('openWindowAt records the guid', async () => {
		const guid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
		await seedNote(guid);

		const { desktopSession } = await import('$lib/desktop/session.svelte.js');
		desktopSession._reset();

		desktopSession.openWindowAt(guid, { x: 100, y: 200, width: 600, height: 500 });

		await new Promise((r) => setTimeout(r, 50));

		const log = await getRecentNoteLog();
		expect(log).toContain(guid);
	});
});
