import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { _resetDBForTest } from '$lib/storage/db.js';
import { setSetting, getSetting } from '$lib/storage/appSettings.js';
import { TAB_NOTEBOOKS_KEY, CATEGORY_ORDER_KEY } from '$lib/storage/syncedSettings.js';

// Seed notebooksCache so getCachedNotebooks() returns a fixed list.
async function seedNotebooks(names: string[]) {
	await setSetting('notebooksCache', names);
}

describe('설정 페이지 (카테고리 탭)', () => {
	beforeEach(async () => {
		globalThis.indexedDB = new IDBFactory();
		_resetDBForTest();
	});

	afterEach(async () => {
		cleanup();
		await new Promise((r) => setTimeout(r, 20));
	});

	it('탭 네비게이션이 카테고리/프로필/기기 정보 세 개를 렌더한다', async () => {
		const { default: SettingsPage } = await import('$routes/settings/+page.svelte');
		render(SettingsPage);
		const tabs = screen.getAllByRole('tab');
		expect(tabs).toHaveLength(3);
		const labels = tabs.map((t) => t.textContent?.trim());
		expect(labels).toContain('카테고리');
		expect(labels).toContain('프로필');
		expect(labels).toContain('기기 정보');
	});

	it('기본 활성 탭은 카테고리이다', async () => {
		const { default: SettingsPage } = await import('$routes/settings/+page.svelte');
		render(SettingsPage);
		const tabs = screen.getAllByRole('tab');
		const activeTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
		expect(activeTab?.textContent?.trim()).toBe('카테고리');
		// 카테고리 패널의 특징적인 텍스트가 보여야 함
		expect(screen.getByRole('tabpanel')).toBeInTheDocument();
	});

	it('프로필 탭 클릭 시 닉네임 입력 필드가 표시된다', async () => {
		const user = userEvent.setup();
		const { default: SettingsPage } = await import('$routes/settings/+page.svelte');
		render(SettingsPage);
		const tabs = screen.getAllByRole('tab');
		const profileTab = tabs.find((t) => t.textContent?.trim() === '프로필')!;
		await user.click(profileTab);
		await waitFor(() => {
			expect(screen.getByPlaceholderText('닉네임 (선택)')).toBeInTheDocument();
		});
	});

	it('카테고리 4개 이상 등록 가능 (제한 없음)', async () => {
		const user = userEvent.setup();
		await seedNotebooks(['A', 'B', 'C', 'D', 'E']);
		const { default: SettingsPage } = await import('$routes/settings/+page.svelte');
		render(SettingsPage);

		// 카테고리 탭이 기본 활성화되어 있으므로 체크박스 기다림
		const checkboxA = await screen.findByRole('checkbox', { name: /A/ });
		await user.click(checkboxA);
		const checkboxB = await screen.findByRole('checkbox', { name: /B/ });
		await user.click(checkboxB);
		const checkboxC = await screen.findByRole('checkbox', { name: /C/ });
		await user.click(checkboxC);
		const checkboxD = await screen.findByRole('checkbox', { name: /D/ });
		await user.click(checkboxD);

		await waitFor(async () => {
			const saved = await getSetting<string[]>(TAB_NOTEBOOKS_KEY);
			expect(saved).toHaveLength(4);
			expect(saved).toContain('A');
			expect(saved).toContain('B');
			expect(saved).toContain('C');
			expect(saved).toContain('D');
		});
	});

	it('위로/아래로 버튼이 카테고리 순서를 변경하고 저장한다', async () => {
		const user = userEvent.setup();
		await seedNotebooks(['A', 'B', 'C']);
		// Set initial order so A is first
		await setSetting(CATEGORY_ORDER_KEY, ['A', 'B', 'C']);
		const { default: SettingsPage } = await import('$routes/settings/+page.svelte');
		render(SettingsPage);

		// 아래로 버튼 찾기 (A 행의 아래로 버튼)
		// 첫 번째 행의 ▼ 버튼 클릭 — A가 B 아래로 이동해야 함
		const downButtons = await screen.findAllByRole('button', { name: '▼' });
		await user.click(downButtons[0]); // A의 아래로

		await waitFor(async () => {
			const saved = await getSetting<string[]>(CATEGORY_ORDER_KEY);
			expect(saved).toBeDefined();
			// A가 B 뒤로 이동했으므로 B가 첫 번째
			expect(saved![0]).toBe('B');
			expect(saved![1]).toBe('A');
		});
	});

	it('첫 번째 행은 위로 버튼 비활성화, 마지막 행은 아래로 버튼 비활성화', async () => {
		await seedNotebooks(['A', 'B', 'C']);
		await setSetting(CATEGORY_ORDER_KEY, ['A', 'B', 'C']);
		const { default: SettingsPage } = await import('$routes/settings/+page.svelte');
		render(SettingsPage);

		const upButtons = await screen.findAllByRole('button', { name: '▲' });
		const downButtons = await screen.findAllByRole('button', { name: '▼' });

		// 첫 번째 행 위로 버튼 비활성화
		expect(upButtons[0]).toBeDisabled();
		// 마지막 행 아래로 버튼 비활성화
		expect(downButtons[downButtons.length - 1]).toBeDisabled();

		// 나머지는 활성화
		expect(upButtons[upButtons.length - 1]).not.toBeDisabled();
		expect(downButtons[0]).not.toBeDisabled();
	});

	it('카테고리 목록 컨테이너에 .category-list-scroll 클래스가 있다', async () => {
		await seedNotebooks(['A', 'B']);
		const { default: SettingsPage } = await import('$routes/settings/+page.svelte');
		render(SettingsPage);

		await waitFor(() => {
			const container = document.querySelector('.category-list-scroll');
			expect(container).toBeInTheDocument();
		});
	});
});
