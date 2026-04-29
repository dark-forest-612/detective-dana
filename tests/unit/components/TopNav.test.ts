import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import TopNav from '$lib/components/TopNav.svelte';
import { _resetDBForTest } from '$lib/storage/db.js';
import { setSetting } from '$lib/storage/appSettings.js';
import { TAB_NOTEBOOKS_KEY, CATEGORY_ORDER_KEY } from '$lib/storage/syncedSettings.js';

// page.url is read reactively in TopNav; stub `$app/state` with a
// mutable URL so individual tests can point at different routes.
let currentUrl = new URL('http://localhost/notes');
vi.mock('$app/state', () => ({
	get page() {
		return { url: currentUrl };
	}
}));

function setRoute(path: string) {
	currentUrl = new URL(`http://localhost${path}`);
}

describe('TopNav', () => {
	beforeEach(async () => {
		globalThis.indexedDB = new IDBFactory();
		_resetDBForTest();
		setRoute('/notes');
	});

	afterEach(async () => {
		cleanup();
		// Let pending async work from onMount (IDB reads,
		// subscribeSyncedSetting, getCachedNotebooks) settle before the
		// next test swaps in a fresh IDBFactory. Without this, stale
		// writes land in the next test's database and clobber its seed.
		await new Promise((r) => setTimeout(r, 20));
	});

	it('전체 링크가 렌더된다', () => {
		render(TopNav, { canGoBack: false, canGoForward: false });
		expect(screen.getByRole('link', { name: '전체' })).toBeInTheDocument();
	});

	it('홈/슬립노트 링크는 더 이상 렌더되지 않는다', () => {
		render(TopNav, { canGoBack: false, canGoForward: false });
		expect(screen.queryByRole('link', { name: '홈' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: '슬립노트' })).not.toBeInTheDocument();
	});

	it('뒤로가기 버튼은 canGoBack=false일 때 비활성화', () => {
		render(TopNav, { canGoBack: false, canGoForward: false });
		expect(screen.getByLabelText('뒤로가기')).toBeDisabled();
	});

	it('앞으로가기 버튼은 canGoForward=false일 때 비활성화', () => {
		render(TopNav, { canGoBack: false, canGoForward: false });
		expect(screen.getByLabelText('앞으로가기')).toBeDisabled();
	});

	it('뒤로가기 클릭 시 onback 콜백 호출', async () => {
		const user = userEvent.setup();
		const onback = vi.fn();
		render(TopNav, { canGoBack: true, canGoForward: false, onback });
		await user.click(screen.getByLabelText('뒤로가기'));
		expect(onback).toHaveBeenCalledOnce();
	});

	it('앞으로가기 클릭 시 onforward 콜백 호출', async () => {
		const user = userEvent.setup();
		const onforward = vi.fn();
		render(TopNav, { canGoBack: false, canGoForward: true, onforward });
		await user.click(screen.getByLabelText('앞으로가기'));
		expect(onforward).toHaveBeenCalledOnce();
	});

	it('/notes 경로에서 전체 탭이 active', () => {
		setRoute('/notes');
		render(TopNav, { canGoBack: false, canGoForward: false });
		expect(screen.getByRole('link', { name: '전체' })).toHaveAttribute('aria-current', 'page');
	});

	it('/notes?notebook=X 경로에서 전체 탭은 active가 아니다', () => {
		setRoute('/notes?notebook=Work');
		render(TopNav, { canGoBack: false, canGoForward: false });
		expect(screen.getByRole('link', { name: '전체' })).not.toHaveAttribute('aria-current', 'page');
	});

	it('선택된 노트북 탭이 렌더되고 알맞은 href를 갖는다', async () => {
		// Seed notebook cache + the synced tab config.
		await setSetting('notebooksCache', ['Work', 'Home']);
		await setSetting(TAB_NOTEBOOKS_KEY, ['Work', 'Home']);
		setRoute('/notes?notebook=Work');
		render(TopNav, { canGoBack: false, canGoForward: false });
		// Settings changes arrive async; wait for them.
		const workLink = await screen.findByRole('link', { name: 'Work' });
		expect(workLink).toHaveAttribute('href', '/notes?notebook=Work');
		expect(workLink).toHaveAttribute('aria-current', 'page');
		const homeLink = await screen.findByRole('link', { name: 'Home' });
		expect(homeLink).not.toHaveAttribute('aria-current', 'page');
	});

	it('존재하지 않는 노트북 이름은 탭에서 걸러진다', async () => {
		await setSetting('notebooksCache', ['Work']);
		await setSetting(TAB_NOTEBOOKS_KEY, ['Work', 'Ghost']);
		setRoute('/notes');
		render(TopNav, { canGoBack: false, canGoForward: false });
		await screen.findByRole('link', { name: 'Work' });
		expect(screen.queryByRole('link', { name: 'Ghost' })).not.toBeInTheDocument();
	});

	it('등록된 모든 노트북이 렌더된다 (제한 없음)', async () => {
		await setSetting('notebooksCache', ['A', 'B', 'C', 'D', 'E']);
		await setSetting(TAB_NOTEBOOKS_KEY, ['A', 'B', 'C', 'D', 'E']);
		setRoute('/notes');
		render(TopNav, { canGoBack: false, canGoForward: false });
		for (const name of ['A', 'B', 'C', 'D', 'E']) {
			const link = await screen.findByRole('link', { name });
			expect(link).toHaveAttribute('href', `/notes?notebook=${name}`);
		}
	});

	it('카테고리 순서가 적용되어 렌더된다', async () => {
		await setSetting('notebooksCache', ['A', 'B', 'C']);
		await setSetting(TAB_NOTEBOOKS_KEY, ['A', 'B', 'C']);
		await setSetting(CATEGORY_ORDER_KEY, ['C', 'A', 'B']);
		setRoute('/notes');
		render(TopNav, { canGoBack: false, canGoForward: false });
		// Both tabConfig and categoryOrder arrive asynchronously; wait until
		// the DOM reflects the final ordered state (C, A, B) rather than the
		// initial insertion order (A, B, C).
		await waitFor(() => {
			const links = screen.getAllByRole('link');
			const notebookLinks = links.filter((l) =>
				['전체', 'C', 'A', 'B'].includes(l.textContent?.trim() ?? '')
			);
			expect(notebookLinks.map((l) => l.textContent?.trim())).toEqual(['전체', 'C', 'A', 'B']);
		});
	});

	it('.nav-links 컨테이너는 가로 스크롤을 허용한다', () => {
		render(TopNav, { canGoBack: false, canGoForward: false });
		const navLinks = document.querySelector('.nav-links');
		expect(navLinks).not.toBeNull();
		// The nav-links-scroll class is added unconditionally to signal that
		// horizontal scroll is enabled (jsdom cannot compute Svelte-scoped
		// CSS, so we assert the marker class rather than a computed style).
		expect(navLinks).toHaveClass('nav-links-scroll');
	});
});
