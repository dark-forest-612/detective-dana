import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { TomboyInternalLink } from '$lib/editor/extensions/TomboyInternalLink.js';
import { TomboyUrlLink } from '$lib/editor/extensions/TomboyUrlLink.js';
import { TomboyMonospace } from '$lib/editor/extensions/TomboyMonospace.js';
import type { TitleEntry } from '$lib/editor/autoLink/findTitleMatches.js';

function entry(title: string, guid = `guid-${title}`): TitleEntry {
	return { titleLower: title.toLocaleLowerCase(), original: title, guid };
}

let currentEditor: Editor | null = null;

afterEach(() => {
	currentEditor?.destroy();
	currentEditor = null;
});

function makeEditor(titles: TitleEntry[], currentGuid: string | null = null): Editor {
	const editor = new Editor({
		extensions: [
			Document,
			Paragraph,
			Text,
			TomboyMonospace,
			TomboyUrlLink,
			TomboyInternalLink.configure({
				getTitles: () => titles,
				getCurrentGuid: () => currentGuid
			})
		],
		content: '<p></p><p></p>' // two blocks so title-line guard doesn't trip
	});
	currentEditor = editor;
	return editor;
}

function collectLinkedTexts(editor: Editor): string[] {
	const out: string[] = [];
	editor.state.doc.descendants((node) => {
		if (!node.isText) return;
		for (const m of node.marks) {
			if (m.type.name === 'tomboyInternalLink') {
				out.push(node.text ?? '');
			}
		}
	});
	return out;
}

/** Returns the span text that carries a tomboyInternalLink mark, concatenated. */
function markedText(editor: Editor): string {
	return collectLinkedTexts(editor).join('');
}

function findTextEnd(editor: Editor, needle: string): number {
	const s = editor.state.doc.textContent;
	const idx = s.indexOf(needle);
	if (idx < 0) return -1;
	// PM position offset: text inside a paragraph starts at 1 past the paragraph
	// open. Our doc has two <p/> blocks: the first is empty (size 2), so its
	// content sits at positions 1..1. After "</p><p>" we're at 3. Walking the
	// doc via textContent is brittle; instead walk descendants to find the
	// real position.
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		if (!node.isText) return;
		const text = node.text ?? '';
		const local = text.indexOf(needle);
		if (local >= 0) {
			found = pos + local + needle.length;
		}
	});
	return found;
}

describe('autoLinkPlugin — paste then edit breaks match (regression)', () => {
	const TITLE = '처음 먹는 마음의 중요성';
	const titles = [entry(TITLE, 'target-guid')];

	it('paste the title → link is added', () => {
		const editor = makeEditor(titles, 'current-guid');
		// Simulate paste of plain text into the 2nd (body) paragraph.
		editor.commands.setTextSelection(3); // inside second paragraph
		editor.commands.insertContent(TITLE);

		expect(markedText(editor)).toContain(TITLE);
	});

	it('appending "123" at the end of the pasted title keeps the link on the title portion only', () => {
		// Under the cross-word matching rule, "<title>123" still contains
		// the title as a substring, so the link must STAY — but only on
		// the title chars; the appended "123" is plain text.
		const editor = makeEditor(titles, 'current-guid');
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(TITLE);

		const endOfTitle = findTextEnd(editor, TITLE);
		expect(endOfTitle).toBeGreaterThan(0);

		editor.commands.setTextSelection(endOfTitle);
		editor.commands.insertContent('123');

		const linked = collectLinkedTexts(editor);
		expect(linked).toEqual([TITLE]);
	});

	it('REGRESSION: inserting "123 " in the middle of the pasted title removes the link', () => {
		const editor = makeEditor(titles, 'current-guid');
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(TITLE);

		// Position between "마음의 " and "중요성" — find "의 " and insert after.
		const afterUi = findTextEnd(editor, '마음의 ');
		expect(afterUi).toBeGreaterThan(0);

		editor.commands.setTextSelection(afterUi);
		editor.commands.insertContent('123 ');

		const linked = collectLinkedTexts(editor).join('');
		// The doc text is now "처음 먹는 마음의 123 중요성" — no substring matches
		// the original title as a whole word, so the link must be gone.
		expect(linked).toBe('');
	});

	it('end-appending one WORD character: plugin shrinks the mark back to the title', () => {
		// ProseMirror's inclusive mark would extend the mark to "…1", but the
		// plugin must reconcile: span ≠ target (Pass 1 strips), then Pass 2
		// re-applies the mark on the substring that still equals the title.
		const editor = makeEditor(titles, 'current-guid');
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(TITLE);

		expect(markedText(editor)).toContain(TITLE);

		const endOfTitle = findTextEnd(editor, TITLE);
		editor.commands.setTextSelection(endOfTitle);
		editor.commands.insertContent('1');

		// The mark must cover exactly the title — not the trailing "1".
		expect(collectLinkedTexts(editor)).toEqual([TITLE]);
	});

	it('REGRESSION: two pasted copies in the same paragraph — editing the 2nd must only affect the 2nd', () => {
		// Reproduction of the exact user scenario. Paragraph contains two
		// consecutive copies of the same title; only the second gets "123 "
		// injected in its middle. The plugin must:
		//   - KEEP the link on the untouched first copy.
		//   - REMOVE the link on the edited second copy.
		const editor = makeEditor(titles, 'current-guid');
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(TITLE + ' ' + TITLE);

		// Both copies should be linked now.
		expect(collectLinkedTexts(editor)).toHaveLength(2);

		// Edit only the SECOND copy: insert "123 " after its "마음의 ".
		const docText = editor.state.doc.textContent;
		const firstIdx = docText.indexOf('마음의 ');
		const secondIdx = docText.indexOf('마음의 ', firstIdx + 1);
		expect(secondIdx).toBeGreaterThan(firstIdx);

		// Convert the second textContent-offset to a PM position by walking
		// the doc.
		let pmPos = -1;
		let seen = 0;
		editor.state.doc.descendants((node, pos) => {
			if (pmPos >= 0) return false;
			if (!node.isText) return;
			const txt = node.text ?? '';
			let localStart = 0;
			while (true) {
				const hit = txt.indexOf('마음의 ', localStart);
				if (hit < 0) break;
				seen++;
				if (seen === 2) {
					pmPos = pos + hit + '마음의 '.length;
					return false;
				}
				localStart = hit + 1;
			}
		});
		expect(pmPos).toBeGreaterThan(0);

		editor.commands.setTextSelection(pmPos);
		editor.commands.insertContent('123 ');

		// Second copy text is now "처음 먹는 마음의 123 중요성" — no longer
		// matches any title. Exactly ONE link should remain (the first copy).
		const linked = collectLinkedTexts(editor);
		expect(linked).toHaveLength(1);
		expect(linked[0]).toBe(TITLE);
	});

	it('REGRESSION: legacy broken mark gets reconciled to a fresh substring match', async () => {
		// A real-world artefact from data saved with earlier serializer bugs:
		// the mark's `target` attribute equals the extended (broken) text
		// ("title123"), which Pass 1 used to preserve because spanText ===
		// target. The fix: Pass 1 also requires `target` to be a known title.
		// With cross-word matching, Pass 2 then re-marks the title substring
		// that lives inside "title123".
		const editor = makeEditor(titles, 'current-guid');
		editor.commands.setTextSelection(3);
		editor.commands.insertContent({
			type: 'text',
			text: TITLE + '123',
			marks: [
				{ type: 'tomboyInternalLink', attrs: { target: TITLE + '123' } }
			]
		});

		// The malformed-target mark is dropped (target not in titles); a fresh
		// mark is applied to the TITLE substring inside "TITLE123".
		const linked = collectLinkedTexts(editor);
		expect(linked).toEqual([TITLE]);
	});

	it('two pasted copies, appending "123" at the END of the 2nd: both links remain', () => {
		// Substring rule: "TITLE123" still contains the title, so the second
		// link survives — its mark span is reconciled to cover only the title
		// chars. The first untouched copy is unaffected.
		const editor = makeEditor(titles, 'current-guid');
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(TITLE + ' ' + TITLE);

		expect(collectLinkedTexts(editor)).toHaveLength(2);

		const docText = editor.state.doc.textContent;
		const firstEnd = docText.indexOf(TITLE) + TITLE.length;
		const secondEnd = docText.indexOf(TITLE, firstEnd + 1) + TITLE.length;

		let pmPos = -1;
		let cumulative = 0;
		editor.state.doc.descendants((node, pos) => {
			if (pmPos >= 0) return false;
			if (!node.isText) return;
			const len = (node.text ?? '').length;
			if (cumulative + len >= secondEnd) {
				pmPos = pos + (secondEnd - cumulative);
				return false;
			}
			cumulative += len;
		});
		expect(pmPos).toBeGreaterThan(0);

		editor.commands.setTextSelection(pmPos);
		editor.commands.insertContent('123');

		const linked = collectLinkedTexts(editor);
		expect(linked).toEqual([TITLE, TITLE]);
	});
});
