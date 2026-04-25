/**
 * Pure transform math for the image viewer modal.
 *
 * The viewer applies a CSS transform `translate(x,y) scale(s)` to the image.
 * `x` and `y` are in screen-space pixels (the same coordinate system as
 * pointer events), so a screen point P corresponds to image-space point
 * `(P - {x,y}) / scale`. Pinch zoom must keep the focal screen point over
 * the same image-space point — this file encodes that invariant in
 * `applyPinch` so the modal component can stay event-glue only.
 */

export interface Transform {
	scale: number;
	x: number;
	y: number;
}

export interface ScaleBounds {
	min: number;
	max: number;
}

export interface PinchInput {
	scale: number;
	focalX: number;
	focalY: number;
}

export interface PanInput {
	dx: number;
	dy: number;
}

export interface FitInput {
	imageW: number;
	imageH: number;
	viewportW: number;
	viewportH: number;
}

export function clampScale(scale: number, min: number, max: number): number {
	if (scale < min) return min;
	if (scale > max) return max;
	return scale;
}

export function applyPinch(t: Transform, input: PinchInput, bounds: ScaleBounds): Transform {
	const nextScale = clampScale(input.scale, bounds.min, bounds.max);
	// Image-space point under the focal *before* the zoom.
	const ix = (input.focalX - t.x) / t.scale;
	const iy = (input.focalY - t.y) / t.scale;
	// Solve for new offset so the same image point lands on the focal again.
	return {
		scale: nextScale,
		x: input.focalX - ix * nextScale,
		y: input.focalY - iy * nextScale
	};
}

export function applyPan(t: Transform, input: PanInput): Transform {
	return { scale: t.scale, x: t.x + input.dx, y: t.y + input.dy };
}

export function fitToViewport(input: FitInput): Transform {
	if (input.imageW <= 0 || input.imageH <= 0) {
		return { scale: 1, x: 0, y: 0 };
	}
	const wRatio = input.viewportW / input.imageW;
	const hRatio = input.viewportH / input.imageH;
	const scale = Math.min(wRatio, hRatio);
	return { scale, x: 0, y: 0 };
}
