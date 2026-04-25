import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { insertImageUrl } from '$lib/upload/insertImageUrl.js';

let ed: Editor | null = null;

beforeEach(() => {
	ed = null;
});

afterEach(() => {
	ed?.destroy();
	ed = null;
});

function makeEditor(content = '<p></p>'): Editor {
	ed = new Editor({
		extensions: [Document, Paragraph, Text],
		content
	});
	return ed;
}

describe('insertImageUrl', () => {
	const URL = 'https://example.com/cat.png';

	it('inserts the URL into an empty paragraph', () => {
		const e = makeEditor('<p></p>');
		insertImageUrl(e, URL);
		expect(e.state.doc.textContent).toContain(URL);
	});

	it('inserts at the cursor with leading whitespace so the URL is whitespace-bounded', () => {
		const e = makeEditor('<p>hello</p>');
		// Cursor after 'hello' (pos 1 + 'hello'.length)
		e.commands.setTextSelection(1 + 'hello'.length);
		insertImageUrl(e, URL);
		const text = e.state.doc.textContent;
		const idx = text.indexOf(URL);
		expect(idx).toBeGreaterThan(0);
		expect(text[idx - 1]).toMatch(/\s/);
	});

	it('inserts trailing whitespace (or end-of-doc) so the URL is properly terminated', () => {
		const e = makeEditor('<p>hello</p>');
		e.commands.setTextSelection(1 + 'hello'.length);
		insertImageUrl(e, URL);
		const text = e.state.doc.textContent;
		const idx = text.indexOf(URL);
		const after = text[idx + URL.length];
		expect(after === undefined || /\s/.test(after)).toBe(true);
	});

	it('does not modify the doc when the URL is empty', () => {
		const e = makeEditor('<p>hello</p>');
		const before = e.state.doc.toJSON();
		insertImageUrl(e, '');
		expect(e.state.doc.toJSON()).toEqual(before);
	});

	it('places the cursor immediately after the inserted URL (and any trailing space)', () => {
		const e = makeEditor('<p>hi</p>');
		e.commands.setTextSelection(1 + 'hi'.length);
		insertImageUrl(e, URL);
		const text = e.state.doc.textContent;
		const urlEnd = text.indexOf(URL) + URL.length;
		// The cursor should be at or just past the URL end.
		expect(e.state.selection.from).toBeGreaterThanOrEqual(urlEnd);
		expect(e.state.selection.from).toBeLessThanOrEqual(urlEnd + 2);
	});

	it('inserts in mid-paragraph, splitting surrounding text correctly', () => {
		const e = makeEditor('<p>before|after</p>');
		// Place cursor at the literal '|' position (5 chars into 'before|after')
		const text0 = e.state.doc.textContent;
		const pipeIdx = text0.indexOf('|');
		// Move cursor to BEFORE the '|', then delete '|' so we have 'beforeafter' with cursor between.
		e.commands.setTextSelection(1 + pipeIdx);
		e.commands.deleteRange({ from: 1 + pipeIdx, to: 1 + pipeIdx + 1 });
		// Cursor is now between 'before' and 'after'.
		insertImageUrl(e, URL);
		const out = e.state.doc.textContent;
		expect(out).toContain('before');
		expect(out).toContain(URL);
		expect(out).toContain('after');
		const urlIdx = out.indexOf(URL);
		expect(out.slice(0, urlIdx)).toMatch(/before\s$/);
		expect(out.slice(urlIdx + URL.length)).toMatch(/^\s?after/);
	});
});
