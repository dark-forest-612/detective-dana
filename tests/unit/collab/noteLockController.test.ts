import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NoteData, NoteLock } from '$lib/core/note.js';
import type { AcquireLockResult, NoteRepository } from '$lib/repository/NoteRepository.js';

function makeFakeRepo(initial: NoteData) {
	const store = new Map<string, NoteData>([[initial.guid, { ...initial }]]);
	const subscribers = new Map<string, Set<(n: NoteData | undefined) => void>>();

	function emit(guid: string) {
		const note = store.get(guid);
		const subs = subscribers.get(guid);
		if (!subs) return;
		for (const cb of subs) cb(note ? { ...note } : undefined);
	}

	const repo: NoteRepository = {
		getAll: vi.fn(),
		getAllIncludingTemplates: vi.fn(),
		get: vi.fn(async (guid) => store.get(guid)),
		put: vi.fn(),
		delete: vi.fn(),
		findByTitle: vi.fn(),

		acquireLock: vi.fn(
			async (guid, holder, holderName, ttlMs): Promise<AcquireLockResult> => {
				const note = store.get(guid);
				if (!note) return { ok: false, reason: 'not-found' };
				const now = Date.now();
				const existing = note.lock ?? null;
				if (existing && existing.expiresAtMs > now && existing.holder !== holder) {
					return {
						ok: false,
						reason: 'held-by-other',
						expiresAtMs: existing.expiresAtMs,
						holder: existing.holder,
						holderName: existing.holderName
					};
				}
				const lock: NoteLock = {
					holder,
					holderName,
					acquiredAtMs: now,
					expiresAtMs: now + ttlMs
				};
				store.set(guid, { ...note, lock });
				emit(guid);
				return { ok: true };
			}
		),

		releaseLock: vi.fn(async (guid, holder) => {
			const note = store.get(guid);
			if (!note) return;
			if (note.lock && note.lock.holder === holder) {
				store.set(guid, { ...note, lock: null });
				emit(guid);
			}
		}),

		heartbeatLock: vi.fn(async (guid, holder, ttlMs) => {
			const note = store.get(guid);
			if (!note || !note.lock || note.lock.holder !== holder) return;
			const lock: NoteLock = { ...note.lock, expiresAtMs: Date.now() + ttlMs };
			store.set(guid, { ...note, lock });
			emit(guid);
		}),

		subscribeNote: vi.fn((guid, cb) => {
			let set = subscribers.get(guid);
			if (!set) {
				set = new Set();
				subscribers.set(guid, set);
			}
			set.add(cb);
			queueMicrotask(() => cb(store.get(guid) ? { ...store.get(guid)! } : undefined));
			return () => {
				set!.delete(cb);
			};
		}),

		subscribeCollection: vi.fn(() => () => {})
	};

	return { repo, store, emit };
}

let fake: ReturnType<typeof makeFakeRepo>;
vi.mock('$lib/repository/index.js', () => ({
	get noteRepository() {
		return fake.repo;
	}
}));

import { _resetIdentityForTest } from '$lib/collab/identity.js';
import { NoteLockController, LOCK_HEARTBEAT_MS, LOCK_TTL_MS } from '$lib/collab/noteLockController.svelte.js';

function makeNote(guid: string, lock: NoteLock | null = null): NoteData {
	return {
		uri: `note://tomboy/${guid}`,
		guid,
		title: 'Test',
		xmlContent: '<note-content version="0.1">Test\n\n</note-content>',
		createDate: '2024-01-01T00:00:00.0000000+00:00',
		changeDate: '2024-01-01T00:00:00.0000000+00:00',
		metadataChangeDate: '2024-01-01T00:00:00.0000000+00:00',
		cursorPosition: 0,
		selectionBoundPosition: -1,
		width: 450,
		height: 360,
		x: 0,
		y: 0,
		tags: [],
		openOnStartup: false,
		lock
	};
}

async function flush(times = 3) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
	localStorage.clear();
	_resetIdentityForTest();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('NoteLockController', () => {
	it('reports "available" on first snapshot when no lock exists — does NOT auto-acquire', async () => {
		fake = makeFakeRepo(makeNote('a'));
		const ctrl = new NoteLockController('a', async () => false);

		await flush();
		expect(ctrl.state.kind).toBe('available');
		expect(fake.repo.acquireLock).not.toHaveBeenCalled();
		await ctrl.destroy();
	});

	it('acquire() transitions available → held-by-me', async () => {
		fake = makeFakeRepo(makeNote('a'));
		const ctrl = new NoteLockController('a', async () => false);
		await flush();
		expect(ctrl.state.kind).toBe('available');

		await ctrl.acquire();
		expect(ctrl.state.kind).toBe('held-by-me');
		await ctrl.destroy();
	});

	it('shows held-by-other without allowing acquire when another live holder is present', async () => {
		const otherLock: NoteLock = {
			holder: 'other-client',
			holderName: 'Alice',
			acquiredAtMs: Date.now(),
			expiresAtMs: Date.now() + LOCK_TTL_MS
		};
		fake = makeFakeRepo(makeNote('a', otherLock));
		const ctrl = new NoteLockController('a', async () => false);

		await flush();
		expect(ctrl.state.kind).toBe('held-by-other');
		if (ctrl.state.kind === 'held-by-other') {
			expect(ctrl.state.holderName).toBe('Alice');
		}

		// Manual acquire while held-by-other surfaces the conflict, state stays held-by-other.
		await ctrl.acquire();
		expect(ctrl.state.kind).toBe('held-by-other');
		await ctrl.destroy();
	});

	it('treats expired foreign locks as "available" and lets acquire() take them over', async () => {
		const expiredLock: NoteLock = {
			holder: 'other-client',
			acquiredAtMs: Date.now() - 60_000,
			expiresAtMs: Date.now() - 1_000
		};
		fake = makeFakeRepo(makeNote('a', expiredLock));
		const ctrl = new NoteLockController('a', async () => false);

		await flush();
		expect(ctrl.state.kind).toBe('available');

		await ctrl.acquire();
		expect(ctrl.state.kind).toBe('held-by-me');
		await ctrl.destroy();
	});

	it('release() flushes pending, clears the lock, and returns to available', async () => {
		fake = makeFakeRepo(makeNote('a'));
		const flushPending = vi.fn(async () => true);
		const ctrl = new NoteLockController('a', flushPending);
		await flush();
		await ctrl.acquire();
		expect(ctrl.state.kind).toBe('held-by-me');

		flushPending.mockClear();
		await ctrl.release();
		expect(flushPending).toHaveBeenCalledTimes(1);
		expect(ctrl.state.kind).toBe('available');
		expect(fake.store.get('a')?.lock).toBeNull();
		await ctrl.destroy();
	});

	it('heartbeats every LOCK_HEARTBEAT_MS while holding the lock, and not while available', async () => {
		fake = makeFakeRepo(makeNote('a'));
		const flushPending = vi.fn(async () => false);
		const ctrl = new NoteLockController('a', flushPending);
		await flush();

		const hbSpy = fake.repo.heartbeatLock as ReturnType<typeof vi.fn>;

		// No ticker while available.
		await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS + 10);
		expect(hbSpy).not.toHaveBeenCalled();

		await ctrl.acquire();
		hbSpy.mockClear();
		flushPending.mockClear();

		await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS + 10);
		// The periodic tick heartbeats only — content saves are debounced
		// by the caller (route/window), not driven from here.
		expect(flushPending).not.toHaveBeenCalled();
		expect(hbSpy).toHaveBeenCalledTimes(1);

		await ctrl.destroy();
	});

	it('exposes the latest remote snapshot via `note` for callers to read', async () => {
		fake = makeFakeRepo(makeNote('a'));
		const ctrl = new NoteLockController('a', async () => false);
		await flush();
		expect(ctrl.note?.guid).toBe('a');
		expect(ctrl.note?.xmlContent).toContain('Test');

		// Simulate a remote content update.
		const current = fake.store.get('a')!;
		fake.store.set('a', {
			...current,
			xmlContent: '<note-content version="0.1">Test\nNew body\n</note-content>'
		});
		fake.emit('a');
		await flush();
		expect(ctrl.note?.xmlContent).toContain('New body');

		await ctrl.destroy();
	});

	it('destroy() releases when we hold the lock', async () => {
		fake = makeFakeRepo(makeNote('a'));
		const ctrl = new NoteLockController('a', async () => false);
		await flush();
		await ctrl.acquire();
		expect(fake.store.get('a')?.lock).not.toBeNull();

		await ctrl.destroy();
		expect(fake.store.get('a')?.lock).toBeNull();
	});

	it('transitions to held-by-other when a remote snapshot steals the lock', async () => {
		fake = makeFakeRepo(makeNote('a'));
		const ctrl = new NoteLockController('a', async () => false);
		await flush();
		await ctrl.acquire();
		expect(ctrl.state.kind).toBe('held-by-me');

		const stealLock: NoteLock = {
			holder: 'other-client',
			holderName: 'Bob',
			acquiredAtMs: Date.now(),
			expiresAtMs: Date.now() + LOCK_TTL_MS
		};
		fake.store.set('a', { ...fake.store.get('a')!, lock: stealLock });
		fake.emit('a');

		await flush();
		expect(ctrl.state.kind).toBe('held-by-other');
		await ctrl.destroy();
	});
});
