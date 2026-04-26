import { describe, it, expect } from 'vitest';
import {
	clampScale,
	applyPinch,
	applyPan,
	fitToViewport,
	type Transform
} from '$lib/upload/viewerTransform.js';

describe('clampScale', () => {
	it('clamps below min', () => {
		expect(clampScale(0.5, 1, 4)).toBe(1);
	});
	it('passes values inside the range', () => {
		expect(clampScale(2, 1, 4)).toBe(2);
	});
	it('clamps above max', () => {
		expect(clampScale(10, 1, 4)).toBe(4);
	});
});

describe('applyPinch', () => {
	it('keeps the focal screen point over the same image point after zoom', () => {
		// At scale=1, x=y=0, image pixel (100,100) sits at screen (100,100).
		// Pinch to scale=2 about screen focal (100,100):
		// the image pixel (100,100) must still appear at screen (100,100).
		const t: Transform = { scale: 1, x: 0, y: 0 };
		const next = applyPinch(t, { scale: 2, focalX: 100, focalY: 100 }, { min: 1, max: 8 });
		expect(next.scale).toBeCloseTo(2);
		// screen' = x' + imagePoint * scale' must equal focal (100)
		// imagePoint = (100 - 0) / 1 = 100
		// 100 = x' + 100 * 2 → x' = -100
		expect(next.x).toBeCloseTo(-100);
		expect(next.y).toBeCloseTo(-100);
	});

	it('focal-invariant when zooming with a non-zero starting offset', () => {
		const t: Transform = { scale: 2, x: 30, y: -50 };
		const next = applyPinch(t, { scale: 4, focalX: 130, focalY: 70 }, { min: 1, max: 8 });
		// imagePoint = (focal - x) / scale = ((130-30)/2, (70+50)/2) = (50, 60)
		// next.x = focal - imagePoint * scale' = 130 - 50*4 = -70
		// next.y = 70 - 60*4 = -170
		expect(next.scale).toBeCloseTo(4);
		expect(next.x).toBeCloseTo(-70);
		expect(next.y).toBeCloseTo(-170);
	});

	it('clamps the resulting scale to the configured bounds', () => {
		const t: Transform = { scale: 1, x: 0, y: 0 };
		const huge = applyPinch(t, { scale: 100, focalX: 0, focalY: 0 }, { min: 1, max: 4 });
		expect(huge.scale).toBe(4);
		const tiny = applyPinch(t, { scale: 0.01, focalX: 0, focalY: 0 }, { min: 1, max: 4 });
		expect(tiny.scale).toBe(1);
	});
});

describe('applyPan', () => {
	it('shifts the offset by the pan delta and leaves scale untouched', () => {
		const t: Transform = { scale: 2, x: 50, y: -20 };
		const next = applyPan(t, { dx: 10, dy: 15 });
		expect(next.x).toBe(60);
		expect(next.y).toBe(-5);
		expect(next.scale).toBe(2);
	});
});

describe('fitToViewport', () => {
	it('downscales a wide image to fit the viewport width', () => {
		const t = fitToViewport({ imageW: 1600, imageH: 800, viewportW: 800, viewportH: 600 });
		// w-ratio 0.5, h-ratio 0.75 → fit = min = 0.5
		expect(t.scale).toBeCloseTo(0.5);
		expect(t.x).toBe(0);
		expect(t.y).toBe(0);
	});

	it('downscales a tall image to fit the viewport height', () => {
		const t = fitToViewport({ imageW: 800, imageH: 1200, viewportW: 800, viewportH: 600 });
		// w-ratio 1.0, h-ratio 0.5 → fit = 0.5
		expect(t.scale).toBeCloseTo(0.5);
	});

	it('keeps a small image at its natural size (modal acts as a frame; never upscales)', () => {
		const t = fitToViewport({ imageW: 200, imageH: 100, viewportW: 800, viewportH: 600 });
		// Image fits the modal — show it 1:1, centred by the consumer.
		expect(t.scale).toBeCloseTo(1);
	});

	it('returns scale 1 when the image is exactly the viewport size', () => {
		const t = fitToViewport({ imageW: 800, imageH: 600, viewportW: 800, viewportH: 600 });
		expect(t.scale).toBeCloseTo(1);
	});

	it('does not upscale when the image is smaller than the viewport in both axes', () => {
		const t = fitToViewport({ imageW: 50, imageH: 50, viewportW: 800, viewportH: 600 });
		expect(t.scale).toBeCloseTo(1);
	});

	it('downscales (preserving ratio) when only one axis exceeds the viewport', () => {
		// Image is 2000x100 → wider than 800 viewport but well within height.
		const t = fitToViewport({ imageW: 2000, imageH: 100, viewportW: 800, viewportH: 600 });
		// w-ratio 0.4, h-ratio 6, cap 1 → min = 0.4
		expect(t.scale).toBeCloseTo(0.4);
	});

	it('returns identity (scale 1) when image dimensions are zero', () => {
		const t = fitToViewport({ imageW: 0, imageH: 0, viewportW: 800, viewportH: 600 });
		expect(t.scale).toBe(1);
		expect(t.x).toBe(0);
		expect(t.y).toBe(0);
	});
});
