/**
 * Detect whether a URL in a `tomboyUrlLink` mark should be rendered as an
 * inline image preview instead of a plain hyperlink.
 *
 * We deliberately only match remote http(s) URLs with a recognised image
 * extension on the pathname (ignoring query / fragment). Local schemes
 * (`file:`, `blob:`, `data:`) are excluded — for privacy (users may not
 * want arbitrary local paths auto-loading) and because they can't be
 * shared across clients anyway. Any remote host is accepted so long as the
 * pathname itself ends in an image extension; query strings are ignored.
 */

const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'svg',
	'avif',
	'bmp'
]);

export function isImageUrl(url: string): boolean {
	if (!url || !url.trim()) return false;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

	// Extension comes from the pathname only — we never want the query
	// string (e.g. `?file=foo.png`) to flip a non-image URL to image.
	const pathname = parsed.pathname;
	const dotIdx = pathname.lastIndexOf('.');
	if (dotIdx === -1) return false;
	const slashIdx = pathname.lastIndexOf('/');
	if (dotIdx < slashIdx) return false; // dot is in a parent segment

	const ext = pathname.slice(dotIdx + 1).toLowerCase();
	return IMAGE_EXTENSIONS.has(ext);
}
