/**
 * Browser-side image upload to Vercel Blob.
 *
 * Uses the client-direct upload pattern: the file streams from the browser
 * straight to Blob storage, with our `/api/blob-upload` Vercel Function only
 * issuing a short-lived token (and getting an "upload completed" callback).
 * That avoids the 4.5MB request-body limit on Vercel Functions, so phone-
 * camera photos go through without server-side bridging.
 *
 * Returns the public Blob URL on success.
 */

import { upload } from '@vercel/blob/client';

const MIME_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/avif': 'avif',
	'image/bmp': 'bmp'
};

function extensionFor(file: File): string {
	const dot = file.name.lastIndexOf('.');
	if (dot >= 0 && dot < file.name.length - 1) {
		return file.name.slice(dot + 1).toLowerCase();
	}
	return MIME_EXT[file.type] ?? 'bin';
}

function uniqueId(): string {
	const arr = new Uint8Array(8);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function uploadImage(file: File): Promise<string> {
	const ext = extensionFor(file);
	const pathname = `notes/${Date.now()}-${uniqueId()}.${ext}`;
	const result = await upload(pathname, file, {
		access: 'public',
		handleUploadUrl: '/api/blob-upload'
	});
	return result.url;
}
