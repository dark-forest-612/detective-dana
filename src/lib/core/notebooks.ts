import { createEmptyNote, formatTomboyDate, type NoteData } from './note.js';

import { noteRepository } from '$lib/repository/index.js';
import { generateGuid } from '$lib/utils/guid.js';
import { getSetting, setSetting } from '$lib/storage/appSettings.js';

const PREFIX = 'system:notebook:';
const TEMPLATE = 'system:template';
const CACHE_KEY = 'notebooksCache';

// 노트북 목록 변경 알림용 pub/sub. 로컬 쓰기(createNotebook 등)와
// Firestore 원격 변경 모두 이 훅을 통해 구독자들에게 전파된다.
const notebookListeners = new Set<(names: string[]) => void>();

/**
 * 노트북 목록이 바뀔 때 호출되는 콜백을 등록한다.
 * 반환값은 구독을 해제하는 함수.
 */
export function onNotebooksChanged(cb: (names: string[]) => void): () => void {
	notebookListeners.add(cb);
	return () => {
		notebookListeners.delete(cb);
	};
}

/** 모든 구독자에게 새 노트북 목록을 전달한다. 내부용. */
export function notifyNotebooksChanged(names: string[]): void {
	for (const l of notebookListeners) {
		try {
			l(names);
		} catch (err) {
			console.warn('[notebooks] listener failed', err);
		}
	}
}

/**
 * 캐시를 버리고 새로 계산한 뒤 구독자에게 알린다.
 * 원격 컬렉션 변경 시 `repository/index.ts`에서 호출된다.
 */
export async function invalidateNotebooksCache(): Promise<string[]> {
	const fresh = await listNotebooks();
	await setSetting(CACHE_KEY, fresh);
	notifyNotebooksChanged(fresh);
	return fresh;
}

/** Extract the notebook name from a note's tags, or null if none. */
export function getNotebook(note: NoteData): string | null {
	const t = note.tags.find((x) => x.startsWith(PREFIX));
	return t ? t.slice(PREFIX.length) : null;
}

/** List all unique notebook names from all notes (including templates), sorted. */
export async function listNotebooks(): Promise<string[]> {
	const all = await noteRepository.getAllIncludingTemplates();
	const set = new Set<string>();
	for (const n of all) {
		for (const t of n.tags) {
			if (t.startsWith(PREFIX)) set.add(t.slice(PREFIX.length));
		}
	}
	return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

/**
 * 캐시된 노트북 목록을 즉시 반환한다. 없으면 계산 후 저장.
 * 자주 바뀌지 않으므로 매번 전체 노트를 훑는 대신 이 캐시를 사용한다.
 */
export async function getCachedNotebooks(): Promise<string[]> {
	const cached = await getSetting<string[]>(CACHE_KEY);
	if (cached) return cached;
	const fresh = await listNotebooks();
	await setSetting(CACHE_KEY, fresh);
	return fresh;
}

/** 노트북 목록 캐시를 다시 계산해서 저장하고 구독자에게 알린다. */
export async function refreshNotebooksCache(): Promise<string[]> {
	const fresh = await listNotebooks();
	await setSetting(CACHE_KEY, fresh);
	notifyNotebooksChanged(fresh);
	return fresh;
}

/** Create a notebook (idempotent — no-op if already exists). */
export async function createNotebook(name: string): Promise<void> {
	const clean = name.trim();
	if (!clean || clean.includes(':')) throw new Error('올바르지 않은 노트북 이름입니다.');
	const existing = await listNotebooks();
	if (existing.includes(clean)) return;

	const n = createEmptyNote(generateGuid());
	n.title = clean;
	n.tags = [TEMPLATE, PREFIX + clean];
	const now = formatTomboyDate(new Date());
	n.createDate = now;
	n.changeDate = now;
	n.metadataChangeDate = now;
	await noteRepository.put(n);
	await refreshNotebooksCache();
}

/** Assign a notebook to a note (replaces any existing notebook tag). */
export async function assignNotebook(guid: string, name: string | null): Promise<void> {
	const note = await noteRepository.get(guid);
	if (!note) return;
	note.tags = note.tags.filter((t) => !t.startsWith(PREFIX));
	if (name) note.tags.push(PREFIX + name.trim());
	const now = formatTomboyDate(new Date());
	note.changeDate = now;
	note.metadataChangeDate = now;
	await noteRepository.put(note);
	await refreshNotebooksCache();
}

/**
 * 노트 배열을 노트북 이름으로 필터링한다.
 * - null: 전체 반환
 * - '': 노트북 없는 노트만 반환
 * - 'xxx': 해당 노트북에 속한 노트만 반환
 */
export function filterByNotebook(notes: NoteData[], name: string | null): NoteData[] {
	if (name === null) return notes;
	if (name === '') return notes.filter((n) => !n.tags.some((t) => t.startsWith(PREFIX)));
	return notes.filter((n) => n.tags.includes(PREFIX + name));
}

/** Delete a notebook: removes template note + strips tag from member notes. */
export async function deleteNotebook(name: string): Promise<void> {
	const all = await noteRepository.getAllIncludingTemplates();
	for (const n of all) {
		const isTemplate = n.tags.includes(TEMPLATE) && n.tags.includes(PREFIX + name);
		if (isTemplate) {
			await noteRepository.delete(n.guid);
			continue;
		}
		if (n.tags.includes(PREFIX + name)) {
			n.tags = n.tags.filter((t) => t !== PREFIX + name);
			await noteRepository.put(n);
		}
	}
	await refreshNotebooksCache();
}
