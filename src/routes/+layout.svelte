<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import Toast from '$lib/components/Toast.svelte';
	import TopNav from '$lib/components/TopNav.svelte';
	import { page } from '$app/state';
	import { bindViewportHeight } from '$lib/viewport/viewportHeight.js';
	import { loadFavorites } from '$lib/core/favorites.js';

	let { children } = $props();

	const isDesktopRoute = $derived(page.url.pathname.startsWith('/desktop'));
	const isEmbedded = $derived(page.url.searchParams.get('embed') === '1');
	const isChromeless = $derived(isDesktopRoute || isEmbedded);

	let offline = $state(false);
	let installPrompt: BeforeInstallPromptEvent | null = $state(null);
	let showInstallBanner = $state(false);

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}

	onMount(() => {
		// Device-local favorites live in IndexedDB; warm the in-memory set
		// so `isFavorite()` reads in the UI reflect saved state.
		void loadFavorites();

		offline = !navigator.onLine;
		const goOffline = () => { offline = true; };
		const goOnline = () => { offline = false; };
		window.addEventListener('offline', goOffline);
		window.addEventListener('online', goOnline);

		const onInstallPrompt = (e: Event) => {
			e.preventDefault();
			installPrompt = e as BeforeInstallPromptEvent;
			if (!window.matchMedia('(display-mode: standalone)').matches) {
				showInstallBanner = true;
			}
		};
		window.addEventListener('beforeinstallprompt', onInstallPrompt);

		const unbindViewport = bindViewportHeight();

		// Alt 키 단독 입력 시 브라우저 메뉴바가 포커스되는 동작을 전역에서 억제.
		// Alt+키 조합은 각각 별도 keydown을 받으므로 영향 없음.
		const swallowAlt = (e: KeyboardEvent) => {
			if (e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
				e.preventDefault();
			}
		};
		window.addEventListener('keydown', swallowAlt);
		window.addEventListener('keyup', swallowAlt);

		// 뒤로가기/앞으로가기 단축키 차단:
		//   Alt+Left/Right (Win/Linux/ChromeOS), Cmd+[ / Cmd+] (macOS).
		const blockNavShortcut = (e: KeyboardEvent) => {
			if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
				e.preventDefault();
				return;
			}
			if (e.metaKey && (e.key === '[' || e.key === ']')) {
				e.preventDefault();
			}
		};
		window.addEventListener('keydown', blockNavShortcut);

		// 브라우저 뒤로가기 버튼/제스처 차단: 센티넬 엔트리를 push 해 두고
		// popstate 가 발생할 때마다 다시 push 해 같은 위치를 유지한다.
		history.pushState(null, '', location.href);
		const blockPopstate = () => {
			history.pushState(null, '', location.href);
		};
		window.addEventListener('popstate', blockPopstate);

		return () => {
			window.removeEventListener('offline', goOffline);
			window.removeEventListener('online', goOnline);
			window.removeEventListener('beforeinstallprompt', onInstallPrompt);
			window.removeEventListener('keydown', swallowAlt);
			window.removeEventListener('keyup', swallowAlt);
			window.removeEventListener('keydown', blockNavShortcut);
			window.removeEventListener('popstate', blockPopstate);
			unbindViewport();
		};
	});

	async function handleInstall() {
		if (!installPrompt) return;
		await installPrompt.prompt();
		const { outcome } = await installPrompt.userChoice;
		if (outcome === 'accepted') {
			showInstallBanner = false;
		}
		installPrompt = null;
	}

	function dismissInstallBanner() {
		showInstallBanner = false;
	}
</script>

<svelte:head>
	<title>Tomboy Web</title>
</svelte:head>

{#if isChromeless}
	<div class="chromeless">
		{@render children()}
	</div>
	<Toast />
{:else}
	{#if offline}
		<div class="offline-banner" role="alert">
			오프라인 상태입니다
		</div>
	{/if}

	{#if showInstallBanner}
		<div class="install-banner">
			<span>홈 화면에 추가하여 앱처럼 사용하세요</span>
			<div class="install-actions">
				<button class="install-btn" onclick={handleInstall}>설치</button>
				<button class="dismiss-btn" onclick={dismissInstallBanner}>✕</button>
			</div>
		</div>
	{/if}

	<div class="app-shell">
		<TopNav />
		<div class="content">
			{@render children()}
		</div>
	</div>
	<Toast />
{/if}

<style>
	.app-shell {
		/* Fill the dynamic viewport; when the on-screen keyboard is open,
		   `--keyboard-inset` (set by bindViewportHeight) shrinks the
		   content area from the bottom so the toolbar lands right above
		   the keyboard. See lib/viewport/viewportHeight.ts for the
		   rationale — pinning to `visualViewport.height` instead caused
		   blank space when the Safari URL bar was visible and visibly
		   fought iOS's scroll-to-focus. */
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 100vh;
		height: 100dvh;
		padding-bottom: var(--keyboard-inset, 0px);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* When embedded (in an iframe) or on the desktop route, the settings page
	   still needs a flex column container so its inner layout (which uses
	   height:100%) sizes correctly. */
	.chromeless {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 100vh;
		height: 100dvh;
		padding-bottom: var(--keyboard-inset, 0px);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.chromeless > :global(*) {
		flex: 1;
		min-height: 0;
	}

	.content {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.offline-banner {
		background: var(--color-text-secondary);
		color: white;
		text-align: center;
		padding: 4px 12px;
		font-size: 0.8rem;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 1000;
	}

	.install-banner {
		background: var(--color-primary);
		color: white;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		font-size: 0.85rem;
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 1000;
		padding-bottom: calc(8px + var(--safe-area-bottom));
	}

	.install-actions {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-shrink: 0;
	}

	.install-btn {
		background: white;
		color: var(--color-primary);
		border: none;
		border-radius: 4px;
		padding: 4px 12px;
		font-weight: 600;
		font-size: 0.85rem;
	}

	.dismiss-btn {
		background: none;
		border: none;
		color: white;
		font-size: 1rem;
		padding: 4px;
		opacity: 0.8;
	}
</style>
