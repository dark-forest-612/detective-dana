/**
 * Vercel Function: token issuer + completion callback for Vercel Blob client
 * uploads. The browser calls `@vercel/blob/client.upload(..., { handleUploadUrl:
 * '/api/blob-upload' })`, which POSTs to this route twice:
 *   1) `blob.generate-client-token` — we mint a short-lived upload token
 *   2) `blob.upload-completed` — Vercel notifies us once the Blob is durable
 *
 * Lives outside the SvelteKit src/ tree because the project uses
 * `@sveltejs/adapter-static`, which can't host server endpoints. Vercel picks
 * up `/api/*` files at the project root and deploys them as serverless
 * functions automatically.
 */

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = [
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/svg+xml',
	'image/avif',
	'image/bmp'
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const body = req.body as HandleUploadBody;

	try {
		const json = await handleUpload({
			body,
			request: req as unknown as Request,
			onBeforeGenerateToken: async (pathname) => {
				// Sanity check: pathname must be an image-like path under /notes/.
				// Anything else gets rejected — we don't want this endpoint to
				// be used as a generic file dump.
				if (!pathname.startsWith('notes/')) {
					throw new Error('invalid pathname');
				}
				return {
					allowedContentTypes: ALLOWED,
					maximumSizeInBytes: MAX_BYTES,
					addRandomSuffix: true
				};
			},
			onUploadCompleted: async () => {
				// No DB write needed — the URL is embedded directly in the
				// note's text via the editor.
			}
		});
		return res.status(200).json(json);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'upload failed';
		return res.status(400).json({ error: message });
	}
}
