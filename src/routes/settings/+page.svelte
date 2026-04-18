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
		subscribeSyncedSetting,
		setSyncedSetting,
		TAB_NOTEBOOKS_KEY,
	} from "$lib/storage/syncedSettings.js";

	const MAX_TAB_NOTEBOOKS = 3;

	let clientId = $state("");
	let displayName = $state("");
	let saved = $state(false);

	let allNotebooks: string[] = $state([]);
	let selectedTabs: string[] = $state([]);

	const selectedCount = $derived(selectedTabs.length);
	const atLimit = $derived(selectedCount >= MAX_TAB_NOTEBOOKS);

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
		return () => {
			offNotebooks();
			offTabs();
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
		if (next.length > MAX_TAB_NOTEBOOKS) {
			pushToast(`탭은 최대 ${MAX_TAB_NOTEBOOKS}개까지 선택 가능.`);
			return;
		}
		selectedTabs = next;
		try {
			await setSyncedSetting<string[]>(TAB_NOTEBOOKS_KEY, next);
		} catch (err) {
			console.warn("[settings] failed to save tab notebooks", err);
			pushToast("저장에 실패했습니다.");
		}
	}
</script>

<div class="settings-page">
	<main class="settings-content">
		<section class="section">
			<h2>탭에 표시할 노트북 (최대 {MAX_TAB_NOTEBOOKS}개)</h2>
			<p class="info-text">
				선택한 노트북이 상단 탭에 "전체" 옆에 나타남.
			</p>
			{#if allNotebooks.length === 0}
				<p class="empty">아직 노트북이 없습니다.</p>
			{:else}
				<ul class="tab-list">
					{#each allNotebooks as nb (nb)}
						{@const checked = selectedTabs.includes(nb)}
						<li>
							<label
								class="tab-row"
								class:disabled={!checked && atLimit}
							>
								<input
									type="checkbox"
									{checked}
									disabled={!checked && atLimit}
									onchange={() => toggleTab(nb)}
								/>
								<span class="tab-name">🗂 {nb}</span>
							</label>
						</li>
					{/each}
				</ul>
				<p class="count-hint">
					{selectedCount} / {MAX_TAB_NOTEBOOKS} 선택됨
				</p>
			{/if}
		</section>

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

		<section class="section">
			<h2>기기 ID</h2>
			<p class="info-text">디버깅 용.</p>
			<code class="client-id">{clientId}</code>
		</section>
	</main>
</div>

<style>
	.settings-page {
		display: flex;
		flex-direction: column;
		height: 100%;
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

	.tab-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		cursor: pointer;
		color: var(--color-text);
	}

	.tab-row.disabled {
		opacity: 0.4;
		cursor: not-allowed;
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
