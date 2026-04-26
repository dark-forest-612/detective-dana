import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import ImageViewer from '$lib/components/ImageViewer.svelte';

const SRC = 'https://example.com/cat.png';

describe('ImageViewer', () => {
	beforeEach(() => {
		// Reset window keydown listeners between tests.
	});

	afterEach(() => {
		cleanup();
	});

	it('renders the image when open=true', () => {
		const { container } = render(ImageViewer, { props: { src: SRC, open: true } });
		const img = container.querySelector('img.tomboy-image-viewer-img') as HTMLImageElement | null;
		expect(img).not.toBeNull();
		expect(img!.getAttribute('src')).toBe(SRC);
	});

	it('renders nothing when open=false', () => {
		const { container } = render(ImageViewer, { props: { src: SRC, open: false } });
		const backdrop = container.querySelector('.tomboy-image-viewer-backdrop');
		expect(backdrop).toBeNull();
	});

	it('calls onclose when the backdrop is clicked', async () => {
		const onclose = vi.fn();
		const { container } = render(ImageViewer, { props: { src: SRC, open: true, onclose } });
		const backdrop = container.querySelector('.tomboy-image-viewer-backdrop')!;
		await fireEvent.click(backdrop);
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('does NOT call onclose when the image itself is clicked', async () => {
		const onclose = vi.fn();
		const { container } = render(ImageViewer, { props: { src: SRC, open: true, onclose } });
		const img = container.querySelector('img.tomboy-image-viewer-img')!;
		await fireEvent.click(img);
		expect(onclose).not.toHaveBeenCalled();
	});

	it('calls onclose when Escape is pressed', async () => {
		const onclose = vi.fn();
		render(ImageViewer, { props: { src: SRC, open: true, onclose } });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('does not listen for Escape when closed', async () => {
		const onclose = vi.fn();
		render(ImageViewer, { props: { src: SRC, open: false, onclose } });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onclose).not.toHaveBeenCalled();
	});
});
