import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock so the import below picks it up.
vi.mock('@vercel/blob/client', () => ({
	upload: vi.fn()
}));

import { upload } from '@vercel/blob/client';
import { uploadImage } from '$lib/upload/blobUpload.js';

const mockedUpload = upload as unknown as ReturnType<typeof vi.fn>;

describe('uploadImage', () => {
	beforeEach(() => {
		mockedUpload.mockReset();
	});

	it('calls @vercel/blob/client.upload with public access and the API route, and returns the URL', async () => {
		mockedUpload.mockResolvedValue({ url: 'https://blob.vercel-storage.com/cat-abc.png' });
		const file = new File([new Uint8Array([1, 2, 3])], 'cat.png', { type: 'image/png' });

		const url = await uploadImage(file);

		expect(mockedUpload).toHaveBeenCalledTimes(1);
		const [pathname, body, opts] = mockedUpload.mock.calls[0] as [string, File, Record<string, unknown>];
		expect(pathname).toMatch(/\.png$/i);
		expect(body).toBe(file);
		expect(opts).toMatchObject({
			access: 'public',
			handleUploadUrl: '/api/blob-upload'
		});
		expect(url).toBe('https://blob.vercel-storage.com/cat-abc.png');
	});

	it('preserves the file extension in the generated pathname', async () => {
		mockedUpload.mockResolvedValue({ url: 'https://x/y.jpg' });
		await uploadImage(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
		const [pathname] = mockedUpload.mock.calls[0] as [string];
		expect(pathname).toMatch(/\.jpg$/i);
	});

	it('derives an extension from the MIME type when the filename has none', async () => {
		mockedUpload.mockResolvedValue({ url: 'https://x/y.png' });
		await uploadImage(new File(['x'], 'noext', { type: 'image/png' }));
		const [pathname] = mockedUpload.mock.calls[0] as [string];
		expect(pathname).toMatch(/\.png$/i);
	});

	it('produces a unique pathname for repeated uploads of the same filename', async () => {
		mockedUpload.mockResolvedValue({ url: 'https://x/y.png' });
		const f = new File(['x'], 'same.png', { type: 'image/png' });
		await uploadImage(f);
		await uploadImage(f);
		const p1 = (mockedUpload.mock.calls[0] as [string])[0];
		const p2 = (mockedUpload.mock.calls[1] as [string])[0];
		expect(p1).not.toBe(p2);
	});

	it('rejects when the underlying upload fails', async () => {
		mockedUpload.mockRejectedValue(new Error('network down'));
		await expect(
			uploadImage(new File(['x'], 'a.png', { type: 'image/png' }))
		).rejects.toThrow(/network/);
	});
});
