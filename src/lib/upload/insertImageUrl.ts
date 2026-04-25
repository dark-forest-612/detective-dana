/**
 * Insert an HTTP(S) image URL into the editor at the current cursor.
 *
 * The image preview plugin (`imagePreviewPlugin.ts`) detects URLs by scanning
 * for `https?://[^\s<>"']+` runs. To make the URL recognisable we surround it
 * with whitespace as needed: a leading space when the cursor is not already
 * at a whitespace boundary, and a trailing space so subsequent typing doesn't
 * extend the URL.
 *
 * The cursor is left immediately after the inserted text so the user can keep
 * typing.
 */

import type { Editor } from '@tiptap/core';

export function insertImageUrl(editor: Editor, url: string): void {
	const trimmed = url.trim();
	if (!trimmed) return;

	const { state } = editor;
	const { from } = state.selection;
	const charBefore = from > 1 ? state.doc.textBetween(from - 1, from, '\n', '\n') : '';
	const needsLeadingSpace = charBefore.length > 0 && !/\s/.test(charBefore);

	const text = `${needsLeadingSpace ? ' ' : ''}${trimmed} `;
	editor.chain().focus().insertContent(text).run();
}
