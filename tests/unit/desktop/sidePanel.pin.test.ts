import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import SidePanel from '$lib/desktop/SidePanel.svelte';
import { _resetDBForTest } from '$lib/storage/db.js';

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	_resetDBForTest();
});

afterEach(async () => {
	cleanup();
	await new Promise((r) => setTimeout(r, 20));
});

const stubProps = {
	openGuids: new Set<string>(),
	currentWorkspace: 0,
	workspaceSummaries: [
		{ index: 0, windowCount: 0 },
		{ index: 1, windowCount: 0 },
		{ index: 2, windowCount: 0 },
		{ index: 3, windowCount: 0 }
	],
	onopen: () => {},
	onopensettings: () => {},
	onswitchworkspace: () => {}
};

describe('SidePanel 핀 동작', () => {
	it('초기 렌더 시 .expanded 클래스가 없다', () => {
		render(SidePanel, stubProps);
		const aside = document.querySelector('aside.side-panel');
		expect(aside).not.toBeNull();
		expect(aside!.classList.contains('expanded')).toBe(false);
	});

	it('마우스 진입 시 .expanded 가 추가된다', () => {
		render(SidePanel, stubProps);
		const aside = document.querySelector('aside.side-panel')!;
		fireEvent.mouseEnter(aside);
		expect(aside.classList.contains('expanded')).toBe(true);
	});

	it('마우스 이탈 시 .expanded 가 제거된다 (핀 안 된 상태)', () => {
		render(SidePanel, stubProps);
		const aside = document.querySelector('aside.side-panel')!;
		fireEvent.mouseEnter(aside);
		fireEvent.mouseLeave(aside);
		expect(aside.classList.contains('expanded')).toBe(false);
	});

	it('패널 내부 클릭 시 .pinned 와 .expanded 가 모두 적용되고, 마우스 이탈해도 유지된다', () => {
		render(SidePanel, stubProps);
		const aside = document.querySelector('aside.side-panel')!;
		const rail = aside.querySelector('.rail')!;
		fireEvent.pointerDown(rail);
		expect(aside.classList.contains('pinned')).toBe(true);
		expect(aside.classList.contains('expanded')).toBe(true);
		fireEvent.mouseLeave(aside);
		expect(aside.classList.contains('expanded')).toBe(true);
	});

	it('패널 외부 클릭 시 .pinned 가 해제된다', async () => {
		render(SidePanel, stubProps);
		const aside = document.querySelector('aside.side-panel')!;
		const rail = aside.querySelector('.rail')!;
		// Pin the panel first
		fireEvent.pointerDown(rail);
		expect(aside.classList.contains('pinned')).toBe(true);
		// Click outside — trigger the global handler
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(aside.classList.contains('pinned')).toBe(false);
	});

	it('포커스 진입 시 .pinned 가 적용된다', () => {
		render(SidePanel, stubProps);
		const aside = document.querySelector('aside.side-panel')!;
		fireEvent.focusIn(aside);
		expect(aside.classList.contains('pinned')).toBe(true);
	});
});
