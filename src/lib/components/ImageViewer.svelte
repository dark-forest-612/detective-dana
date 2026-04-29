<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		applyPan,
		applyPinch,
		fitToViewport,
		clampScale,
		type Transform
	} from '$lib/upload/viewerTransform.js';

	interface Props {
		src: string;
		open: boolean;
		onclose?: () => void;
	}

	let { src, open, onclose }: Props = $props();

	// Zoom-out floor is the per-image fit scale (1 for images that fit the
	// modal, <1 for oversized ones). The user can always return to the
	// initial fitted view; pinch / wheel cannot shrink past that.
	const SCALE_MAX = 8;
	const WHEEL_STEP = 0.0015;

	let viewportEl: HTMLDivElement | undefined = $state(undefined);
	let imgEl: HTMLImageElement | undefined = $state(undefined);
	let transform = $state<Transform>({ scale: 1, x: 0, y: 0 });
	let minScale = $state(1);

	// Active pointers for pinch / pan tracking. Up to two for pinch.
	const pointers = new Map<number, { x: number; y: number }>();
	let pinchStart: { distance: number; scale: number } | null = null;
	let panLastSingle: { x: number; y: number } | null = null;

	function fit() {
		if (!imgEl || !viewportEl) return;
		const w = imgEl.naturalWidth;
		const h = imgEl.naturalHeight;
		const vw = viewportEl.clientWidth;
		const vh = viewportEl.clientHeight;
		const t = fitToViewport({ imageW: w, imageH: h, viewportW: vw, viewportH: vh });
		minScale = t.scale;
		// Centre the image in the viewport.
		transform = {
			scale: t.scale,
			x: (vw - w * t.scale) / 2,
			y: (vh - h * t.scale) / 2
		};
	}

	function handleImgLoad() {
		fit();
	}

	function handleResize() {
		fit();
	}

	$effect(() => {
		if (!open) return;
		// Reset transform on each open and refit once the image is mounted.
		transform = { scale: 1, x: 0, y: 0 };
		void tick().then(() => {
			if (imgEl?.complete) fit();
		});
	});

	function backdropClick(e: MouseEvent) {
		// Only close when the click target is the backdrop itself, not the image.
		if (e.target === e.currentTarget) onclose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose?.();
		}
	}

	function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		return Math.hypot(dx, dy);
	}

	function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
		return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
	}

	function pointerDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.size === 2) {
			const [p1, p2] = [...pointers.values()];
			pinchStart = { distance: distance(p1, p2), scale: transform.scale };
			panLastSingle = null;
		} else if (pointers.size === 1) {
			panLastSingle = { x: e.clientX, y: e.clientY };
		}
	}

	function pointerMove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		const prev = pointers.get(e.pointerId)!;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pointers.size === 2 && pinchStart) {
			const [p1, p2] = [...pointers.values()];
			const newDist = distance(p1, p2);
			if (pinchStart.distance > 0) {
				const ratio = newDist / pinchStart.distance;
				const focal = midpoint(p1, p2);
				transform = applyPinch(
					transform,
					{ scale: pinchStart.scale * ratio, focalX: focal.x, focalY: focal.y },
					{ min: minScale, max: SCALE_MAX }
				);
			}
		} else if (pointers.size === 1 && panLastSingle) {
			const dx = e.clientX - panLastSingle.x;
			const dy = e.clientY - panLastSingle.y;
			panLastSingle = { x: e.clientX, y: e.clientY };
			transform = applyPan(transform, { dx, dy });
		}
		void prev;
	}

	function pointerUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinchStart = null;
		if (pointers.size === 1) {
			const [p] = [...pointers.values()];
			panLastSingle = { x: p.x, y: p.y };
		} else if (pointers.size === 0) {
			panLastSingle = null;
		}
	}

	function wheel(e: WheelEvent) {
		e.preventDefault();
		const factor = Math.exp(-e.deltaY * WHEEL_STEP);
		transform = applyPinch(
			transform,
			{
				scale: clampScale(transform.scale * factor, minScale, SCALE_MAX),
				focalX: e.clientX,
				focalY: e.clientY
			},
			{ min: minScale, max: SCALE_MAX }
		);
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('resize', handleResize);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('resize', handleResize);
		};
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="tomboy-image-viewer-backdrop"
		bind:this={viewportEl}
		onclick={backdropClick}
		onpointerdown={pointerDown}
		onpointermove={pointerMove}
		onpointerup={pointerUp}
		onpointercancel={pointerUp}
		onwheel={wheel}
	>
		<img
			bind:this={imgEl}
			class="tomboy-image-viewer-img"
			{src}
			alt=""
			draggable="false"
			onload={handleImgLoad}
			style="transform: translate({transform.x}px, {transform.y}px) scale({transform.scale})"
		/>
		<button
			type="button"
			class="tomboy-image-viewer-close"
			onclick={() => onclose?.()}
			aria-label="닫기"
		>
			✕
		</button>
	</div>
{/if}

<style>
	.tomboy-image-viewer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		z-index: 2000;
		overflow: hidden;
		touch-action: none;
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
	}

	.tomboy-image-viewer-backdrop:active {
		cursor: grabbing;
	}

	.tomboy-image-viewer-img {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
		max-width: none;
		max-height: none;
		pointer-events: none;
		user-select: none;
		-webkit-user-drag: none;
	}

	.tomboy-image-viewer-close {
		position: absolute;
		top: calc(12px + var(--safe-area-top, 0px));
		right: calc(12px + var(--safe-area-right, 0px));
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: none;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		font-size: 1.2rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
