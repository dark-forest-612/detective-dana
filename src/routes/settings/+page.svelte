<script lang="ts">
	import { onMount } from "svelte";
	import {
		getClientId,
		getClientName,
		setClientName,
	} from "$lib/collab/identity.js";
	import { pushToast } from "$lib/stores/toast.js";
	import {
		getCachedNotebooks,
		onNotebooksChanged,
	} from "$lib/core/notebooks.js";
	import {
		applyCategoryOrder,
		moveCategory,
	} from "$lib/core/categoryOrder.js";
	import {
		subscribeSyncedSetting,
		setSyncedSetting,
		TAB_NOTEBOOKS_KEY,
		CATEGORY_ORDER_KEY,
	} from "$lib/storage/syncedSettings.js";

	type Tab = '카테고리' | '프로필' | '기기 정보';

	let activeTab: Tab = $state('카테고리');

	let clientId = $state("");
	let displayName = $state("");
	let saved = $state(false);

	let allNotebooks: string[] = $state([]);
	let selectedTabs: string[] = $state([]);
	let categoryOrder: string[] = $state([]);

	const orderedNotebooks = $derived(applyCategoryOrder(allNotebooks, categoryOrder));

	async function refreshNotebooks() {
		allNotebooks = await getCachedNotebooks();
	}

	onMount(() => {
		clientId = getClientId();
		displayName = getClientName() ?? "";
		void refreshNotebooks();
		const offNotebooks = onNotebooksChanged(() => {
			void refreshNotebooks();
		});
		const offTabs = subscribeSyncedSetting<string[]>(
			TAB_NOTEBOOKS_KEY,
			(v) => {
				selectedTabs = Array.isArray(v) ? [...v] : [];
			},
		);
		const offOrder = subscribeSyncedSetting<string[]>(
			CATEGORY_ORDER_KEY,
			(v) => {
				categoryOrder = Array.isArray(v) ? [...v] : [];
			},
		);
		return () => {
			offNotebooks();
			offTabs();
			offOrder();
		};
	});

	function handleSaveName() {
		setClientName(displayName);
		saved = true;
		pushToast("저장되었습니다.");
		setTimeout(() => (saved = false), 1500);
	}

	async function toggleTab(name: string) {
		const next = selectedTabs.includes(name)
			? selectedTabs.filter((n) => n !== name)
			: [...selectedTabs, name];
		selectedTabs = next;
		try {
			await setSyncedSetting<string[]>(TAB_NOTEBOOKS_KEY, next);
		} catch (err) {
			console.warn("[settings] failed to save tab notebooks", err);
			pushToast("저장에 실패했습니다.");
		}
	}

	async function handleMove(name: string, direction: 'up' | 'down') {
		// If name is not yet in the explicit order, seed from current display order
		const base = categoryOrder.length > 0 ? categoryOrder : orderedNotebooks;
		const ensured = base.includes(name) ? base : [...base, name];
		const next = moveCategory(ensured, name, direction);
		categoryOrder = next;
		try {
			await setSyncedSetting<string[]>(CATEGORY_ORDER_KEY, next);
		} catch (err) {
			console.warn("[settings] failed to save category order", err);
			pushToast("저장에 실패했습니다.");
		}
	}
</script>

<div class="settings-page">
	<div class="tab-strip" role="tablist">
		{#each (['카테고리', '프로필', '기기 정보'] as Tab[]) as tab (tab)}
			<button
				role="tab"
				aria-selected={activeTab === tab}
				class="tab-btn"
				class:active={activeTab === tab}
				onclick={() => { activeTab = tab; }}
			>{tab}</button>
		{/each}
	</div>

	<main class="settings-content">
		{#if activeTab === '카테고리'}
			<div role="tabpanel" id="panel-categories" class="tab-panel">
				<section class="section">
					<h2>네비게이션 바에 표시할 카테고리</h2>
					<p class="info-text">
						선택한 노트북이 상단 탭에 "전체" 옆에 나타남.
					</p>
					{#if orderedNotebooks.length === 0}
						<p class="empty">아직 노트북이 없습니다.</p>
					{:else}
						<div class="category-list-scroll" style="max-height: 50vh; overflow-y: auto;">
							<ul class="tab-list">
								{#each orderedNotebooks as nb, i (nb)}
									{@const checked = selectedTabs.includes(nb)}
									<li class="category-row">
										<label class="tab-row">
											<input
												type="checkbox"
												aria-label={nb}
												{checked}
												onchange={() => toggleTab(nb)}
											/>
											<span class="tab-name">🗂 {nb}</span>
										</label>
										<div class="order-btns">
											<button
												aria-label="▲"
												class="order-btn"
												disabled={i === 0}
												onclick={() => handleMove(nb, 'up')}
											>▲</button>
											<button
												aria-label="▼"
												class="order-btn"
												disabled={i === orderedNotebooks.length - 1}
												onclick={() => handleMove(nb, 'down')}
											>▼</button>
										</div>
									</li>
								{/each}
							</ul>
						</div>
						<p class="count-hint">
							{selectedTabs.length}개 선택됨
						</p>
					{/if}
				</section>
			</div>
		{:else if activeTab === '프로필'}
			<div role="tabpanel" id="panel-profile" class="tab-panel">
				<section class="section">
					<h2>닉네임</h2>
					<div class="name-row">
						<input
							class="name-input"
							type="text"
							placeholder="닉네임 (선택)"
							bind:value={displayName}
							maxlength="40"
							onkeydown={(e) => e.key === "Enter" && handleSaveName()}
						/>
						<button class="btn-save" onclick={handleSaveName}>
							{saved ? "저장됨" : "저장"}
						</button>
					</div>
				</section>
			</div>
		{:else if activeTab === '기기 정보'}
			<div role="tabpanel" id="panel-device" class="tab-panel">
				<section class="section">
					<h2>기기 ID</h2>
					<p class="info-text">디버깅 용.</p>
					<code class="client-id">{clientId}</code>
				</section>
			</div>
		{/if}
	</main>
</div>

<style>
	.settings-page {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.tab-strip {
		display: flex;
		border-bottom: 1px solid var(--color-border, #dee2e6);
		padding: 0 16px;
		gap: 4px;
		flex-shrink: 0;
	}

	.tab-btn {
		padding: 10px 16px;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		white-space: nowrap;
	}

	.tab-btn.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
		font-weight: 600;
	}

	.settings-content {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		padding-bottom: max(16px, var(--safe-area-bottom));
	}

	.section {
		margin-bottom: 32px;
	}

	.section h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 12px;
		color: var(--color-text);
	}

	.info-text {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
		margin-bottom: 12px;
	}

	.empty {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		padding: 12px 0;
	}

	.tab-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid var(--color-border, #dee2e6);
		border-radius: 8px;
		overflow: hidden;
	}

	.tab-list li + li {
		border-top: 1px solid var(--color-border, #eee);
	}

	.category-row {
		display: flex;
		align-items: center;
	}

	.tab-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		cursor: pointer;
		color: var(--color-text);
		flex: 1;
		min-width: 0;
	}

	.tab-row input[type="checkbox"] {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.tab-name {
		font-size: 0.95rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.order-btns {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 8px 4px 0;
		flex-shrink: 0;
	}

	.order-btn {
		padding: 2px 6px;
		border: 1px solid var(--color-border, #dee2e6);
		border-radius: 4px;
		background: var(--color-bg, #fff);
		color: var(--color-text);
		font-size: 0.75rem;
		cursor: pointer;
		line-height: 1;
	}

	.order-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.count-hint {
		margin-top: 8px;
		font-size: 0.82rem;
		color: var(--color-text-secondary);
	}

	.name-row {
		display: flex;
		gap: 8px;
	}

	.name-input {
		flex: 1;
		padding: 10px 12px;
		border: 1px solid var(--color-border, #dee2e6);
		border-radius: 8px;
		font-size: 0.95rem;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.btn-save {
		padding: 10px 16px;
		border: none;
		border-radius: 8px;
		background: var(--color-primary);
		color: white;
		font-size: 0.95rem;
		font-weight: 600;
		flex-shrink: 0;
		cursor: pointer;
	}

	.client-id {
		display: inline-block;
		padding: 6px 10px;
		background: var(--color-bg-secondary, #f5f5f5);
		border-radius: 6px;
		font-family: monospace;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		word-break: break-all;
	}
</style>
