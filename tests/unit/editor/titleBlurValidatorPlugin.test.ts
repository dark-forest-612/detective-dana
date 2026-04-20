import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Extension } from '@tiptap/core';
import { createTitleBlurValidatorPlugin } from '$lib/editor/titleValidation/titleBlurValidatorPlugin.js';

let currentEditor: Editor | null = null;

function makeEditor(opts: {
	onLeaveTitle: (titleText: string) => void;
	content?: string;
}): Editor {
	const ext = Extension.create({
		name: 'tomboyTitleBlurValidatorTest',
		addProseMirrorPlugins() {
			return [createTitleBlurValidatorPlugin({ onLeaveTitle: opts.onLeaveTitle })];
		}
	});

	const editor = new Editor({
		extensions: [Document, Paragraph, Text, ext],
		// Two paragraphs by default so "leave first block" is reachable.
		content: opts.content ?? '<p>Hello</p><p>Body text</p>'
	});
	currentEditor = editor;
	return editor;
}

beforeEach(() => {
	currentEditor = null;
});

afterEach(() => {
	currentEditor?.destroy();
	currentEditor = null;
});

describe('titleBlurValidatorPlugin', () => {
	it('fires onLeaveTitle with the first-block text when the caret moves from block 0 to block 1', () => {
		const spy = vi.fn();
		const ed = makeEditor({ onLeaveTitle: spy, content: '<p>Hello</p><p>Body text</p>' });

		// Place the caret inside the title (block 0).
		ed.commands.setTextSelection(2);
		expect(spy).not.toHaveBeenCalled();

		// Move the caret into block 1. Doc layout:
		//   pos 0: <p>  opening
		//   pos 1..6: "Hello" with trailing boundary
		//   pos 7: </p> closing, <p> opening
		//   pos 8..16: "Body text"
		// Any position >= 8 is inside block 1.
		ed.commands.setTextSelection(10);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe('Hello');
	});

	it('does NOT fire while the caret stays inside the title block', () => {
		const spy = vi.fn();
		const ed = makeEditor({ onLeaveTitle: spy, content: '<p>Hello world</p><p>Body</p>' });

		ed.commands.setTextSelection(2);
		ed.commands.setTextSelection(5);
		ed.commands.setTextSelection(3);

		expect(spy).not.toHaveBeenCalled();
	});

	it('does NOT fire on entering the title from elsewhere (only on leaving)', () => {
		const spy = vi.fn();
		const ed = makeEditor({ onLeaveTitle: spy, content: '<p>Hello</p><p>Body</p>' });

		// Start in block 1 (this leave fires once — ignore it).
		ed.commands.setTextSelection(9);
		spy.mockClear();

		// Move back into the title.
		ed.commands.setTextSelection(3);
		expect(spy).not.toHaveBeenCalled();
	});

	it('reports the CURRENT first-block text (including unsaved edits) at the moment of leave', () => {
		const spy = vi.fn();
		const ed = makeEditor({ onLeaveTitle: spy, content: '<p>Hi</p><p>Body</p>' });

		// Move caret into title, then append to it.
		ed.commands.setTextSelection(3);
		ed.commands.insertContent(' there');
		// Title is now "Hi there". Leave to block 1.
		const doc = ed.state.doc;
		const block1Start = doc.child(0).nodeSize + 1;
		ed.commands.setTextSelection(block1Start + 1);

		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe('Hi there');
	});

	it('fires exactly once per leave, even when the same move triggers multiple transactions', () => {
		const spy = vi.fn();
		const ed = makeEditor({ onLeaveTitle: spy, content: '<p>Hello</p><p>Body</p>' });

		ed.commands.setTextSelection(2);
		ed.commands.setTextSelection(9);

		expect(spy).toHaveBeenCalledTimes(1);
	});
});
