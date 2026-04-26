<script lang="ts">
	// Floating two-button menu shown next to a read-mode tap selection.
	// Mirrors a native context-menu vibe (right-click on desktop, long-press
	// + drag on mobile) but constrained to the two actions that matter on
	// the mobile note view: copy the text, or extract it into a new note.
	//
	// Positioning: anchored to the selection's bounding rect (viewport
	// coords). We render below the selection by default and flip above when
	// there isn't room. Horizontal placement clamps inside the viewport so
	// the menu stays fully visible on narrow screens.

	interface Props {
		rect: { left: number; top: number; right: number; bottom: number };
		oncopy: () => void;
		oncreateNote: () => void;
	}

	let { rect, oncopy, oncreateNote }: Props = $props();

	let menuEl: HTMLDivElement | undefined = $state(undefined);
	let menuSize = $state<{ width: number; height: number }>({ width: 0, height: 0 });

	$effect(() => {
		const el = menuEl;
		if (!el) return;
		const r = el.getBoundingClientRect();
		if (r.width !== menuSize.width || r.height !== menuSize.height) {
			menuSize = { width: r.width, height: r.height };
		}
	});

	const GAP = 8;
	const VIEWPORT_PAD = 8;

	const position = $derived.by(() => {
		const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
		const vh = typeof window !== 'undefined' ? window.innerHeight : 640;

		const w = menuSize.width || 180;
		const h = menuSize.height || 40;

		const centerX = (rect.left + rect.right) / 2;
		let left = centerX - w / 2;
		left = Math.max(VIEWPORT_PAD, Math.min(left, vw - w - VIEWPORT_PAD));

		const spaceBelow = vh - rect.bottom - VIEWPORT_PAD;
		let top: number;
		if (spaceBelow >= h + GAP) {
			top = rect.bottom + GAP;
		} else {
			// Flip above the selection.
			top = rect.top - GAP - h;
			if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
		}
		return { left, top };
	});

	function handleCopy(e: MouseEvent) {
		e.stopPropagation();
		oncopy();
	}

	function handleCreate(e: MouseEvent) {
		e.stopPropagation();
		oncreateNote();
	}
</script>

<div
	bind:this={menuEl}
	class="tap-select-menu"
	role="menu"
	tabindex="-1"
	style="left:{position.left}px; top:{position.top}px;"
	onpointerdown={(e) => e.stopPropagation()}
>
	<button type="button" class="item" onclick={handleCopy}>
		<span class="icon" aria-hidden="true">📋</span>
		<span>복사하기</span>
	</button>
	<div class="sep" aria-hidden="true"></div>
	<button type="button" class="item" onclick={handleCreate}>
		<span class="icon" aria-hidden="true">＋</span>
		<span>새 노트 만들기</span>
	</button>
</div>

<style>
	.tap-select-menu {
		position: fixed;
		z-index: 450;
		display: flex;
		align-items: stretch;
		background: #ffffff;
		color: #1f2937;
		border: 1px solid #d0d7de;
		border-radius: 10px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
		overflow: hidden;
		font-size: 0.9rem;
		user-select: none;
		-webkit-user-select: none;
	}

	.item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 9px 14px;
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		font: inherit;
		white-space: nowrap;
	}

	.item:active {
		background: #eef2f7;
	}

	.icon {
		font-size: 1rem;
		line-height: 1;
	}

	.sep {
		width: 1px;
		background: #e4e8ec;
		flex-shrink: 0;
	}
</style>
