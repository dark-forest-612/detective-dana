import { noteRepository } from '$lib/repository/index.js';
import { getClientId, getClientName } from './identity.js';
import type { NoteData } from '$lib/core/note.js';

/**
 * Tunables. TTL is the absolute time a lock survives without a heartbeat;
 * the heartbeat cadence must be safely shorter than TTL so a couple of
 * dropped writes can be retried before the lock expires. With
 * HEARTBEAT=30s, TTL=90s gives two retry slots.
 *
 * Content saves are NOT driven from here — the route/window debounces
 * flushPending() a few seconds after each edit. The controller only owns
 * lock state + heartbeating.
 */
export const LOCK_TTL_MS = 90_000;
export const LOCK_HEARTBEAT_MS = 30_000;

export type LockState =
	| { kind: 'loading' }
	| { kind: 'available' }
	| { kind: 'held-by-me'; expiresAtMs: number }
	| { kind: 'held-by-other'; holder: string; holderName?: string; expiresAtMs: number }
	| { kind: 'error'; message: string };

/**
 * Per-note lock state machine. One controller per opened note; drives:
 * - `state` — reactive lock state for the editor UI to read.
 * - `note`  — latest remote NoteData (from `subscribeNote`), used by the
 *   route to refresh the editor content when we're NOT the live editor.
 *   Updating while `held-by-me` is skipped by the caller to avoid stomping
 *   mid-edit TipTap state.
 *
 * Acquisition is explicit — the UI decides when to call `acquire()` /
 * `release()`. Expired remote locks surface as `available`, not as
 * held-by-other, so the "편집" button works as a takeover.
 */
export class NoteLockController {
	state: LockState = $state({ kind: 'loading' });
	note: NoteData | undefined = $state.raw(undefined);

	private readonly guid: string;
	private readonly holderId: string;
	private readonly holderName: string | undefined;
	private readonly flushPending: () => Promise<boolean>;

	private unsubscribe: (() => void) | null = null;
	private ticker: ReturnType<typeof setInterval> | null = null;
	private busy = false;
	private destroyed = false;

	/**
	 * @param guid           The note being edited.
	 * @param flushPending   Called before `release()` / `destroy()` so the
	 *                       last pending edit lands before we give up the
	 *                       lock. Not called from the periodic heartbeat —
	 *                       the caller debounces saves itself.
	 */
	constructor(guid: string, flushPending: () => Promise<boolean>) {
		this.guid = guid;
		this.holderId = getClientId();
		this.holderName = getClientName();
		this.flushPending = flushPending;

		this.unsubscribe = noteRepository.subscribeNote(guid, (note) => {
			if (this.destroyed) return;
			this.onSnapshot(note);
		});
	}

	private onSnapshot(note: NoteData | undefined): void {
		if (!note) {
			this.state = { kind: 'error', message: 'note not found' };
			this.stopTicker();
			return;
		}
		this.note = note;
		const now = Date.now();
		const lock = note.lock ?? null;

		// No lock, or TTL elapsed → anyone can claim. An expired lock by us
		// also lands here (e.g. if the tab was backgrounded past TTL and
		// the heartbeat missed), which correctly demotes us out of
		// `held-by-me` so the UI no longer shows the editing state.
		if (!lock || lock.expiresAtMs <= now) {
			this.state = { kind: 'available' };
			this.stopTicker();
			return;
		}

		if (lock.holder === this.holderId) {
			this.state = { kind: 'held-by-me', expiresAtMs: lock.expiresAtMs };
			this.startTicker();
			return;
		}

		this.state = {
			kind: 'held-by-other',
			holder: lock.holder,
			holderName: lock.holderName,
			expiresAtMs: lock.expiresAtMs
		};
		this.stopTicker();
	}

	/**
	 * User-initiated lock acquisition. Idempotent when we already hold
	 * it. Fails with `held-by-other` when a live lock is owned elsewhere
	 * (expired foreign locks are treated as free by the repository).
	 */
	async acquire(): Promise<void> {
		if (this.busy || this.destroyed) return;
		this.busy = true;
		try {
			const res = await noteRepository.acquireLock(
				this.guid,
				this.holderId,
				this.holderName,
				LOCK_TTL_MS
			);
			if (this.destroyed) return;
			if (res.ok) {
				// Optimistic transition — snapshot will re-confirm shortly.
				this.state = {
					kind: 'held-by-me',
					expiresAtMs: Date.now() + LOCK_TTL_MS
				};
				this.startTicker();
			} else if (res.reason === 'held-by-other') {
				this.state = {
					kind: 'held-by-other',
					holder: res.holder,
					holderName: res.holderName,
					expiresAtMs: res.expiresAtMs
				};
			} else if (res.reason === 'not-found') {
				this.state = { kind: 'error', message: 'note not found' };
			}
		} catch (err) {
			if (this.destroyed) return;
			const msg = err instanceof Error ? err.message : String(err);
			this.state = { kind: 'error', message: msg };
		} finally {
			this.busy = false;
		}
	}

	/**
	 * User-initiated release. Flushes any pending edits first so we don't
	 * strand a half-saved buffer on the client, then clears the lock on
	 * the backend. Optimistically transitions to `available` — the next
	 * snapshot will confirm and, if someone else grabs it between our
	 * release and their acquire, move us to `held-by-other`.
	 */
	async release(): Promise<void> {
		if (this.busy || this.destroyed) return;
		if (this.state.kind !== 'held-by-me') return;
		this.busy = true;
		this.stopTicker();
		try {
			await this.flushPending();
			if (this.destroyed) return;
			await noteRepository.releaseLock(this.guid, this.holderId);
			if (this.destroyed) return;
			this.state = { kind: 'available' };
		} catch (err) {
			if (this.destroyed) return;
			const msg = err instanceof Error ? err.message : String(err);
			this.state = { kind: 'error', message: msg };
		} finally {
			this.busy = false;
		}
	}

	private startTicker(): void {
		if (this.ticker) return;
		this.ticker = setInterval(async () => {
			if (this.destroyed) return;
			if (this.state.kind !== 'held-by-me') return;
			try {
				await noteRepository.heartbeatLock(this.guid, this.holderId, LOCK_TTL_MS);
			} catch (err) {
				console.error('[noteLock] heartbeat failed:', err);
			}
		}, LOCK_HEARTBEAT_MS);
	}

	private stopTicker(): void {
		if (this.ticker) {
			clearInterval(this.ticker);
			this.ticker = null;
		}
	}

	async destroy(): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stopTicker();
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.state.kind === 'held-by-me') {
			try {
				await this.flushPending();
				await noteRepository.releaseLock(this.guid, this.holderId);
			} catch {
				// best-effort — a crashed release just means the lock
				// waits out its TTL.
			}
		}
	}
}
