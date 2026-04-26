/**
 * Plugin-level integration tests for cross-word auto-linking.
 *
 * Covers the substring-match rule introduced for Korean-particle
 * support and the surrounding edge cases the user asked about:
 *   - existing link survives when it sits inside a larger continuous run
 *   - longer titles win even when both candidates share a prefix
 *   - links work inside list items, headings, and pasted blocks
 *   - editing in the middle re-scans both directions of the edit
 *   - suppressed marks (URL link, monospace) still block auto-linking
 *   - title line is still protected
 *   - serialization round-trip preserves the new matches
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { TomboyInternalLink } from '$lib/editor/extensions/TomboyInternalLink.js';
import { TomboyUrlLink } from '$lib/editor/extensions/TomboyUrlLink.js';
import { TomboyMonospace } from '$lib/editor/extensions/TomboyMonospace.js';
import { TomboyParagraph } from '$lib/editor/extensions/TomboyParagraph.js';
import { TomboyListItem } from '$lib/editor/extensions/TomboyListItem.js';
import { autoLinkPluginKey } from '$lib/editor/autoLink/autoLinkPlugin.js';
import {
	serializeContent,
	deserializeContent
} from '$lib/core/noteContentArchiver.js';
import type { TitleEntry } from '$lib/editor/autoLink/findTitleMatches.js';

function entry(title: string, guid = `guid-${title}`): TitleEntry {
	return { titleLower: title.toLocaleLowerCase(), original: title, guid };
}

let currentEditor: Editor | null = null;
afterEach(() => {
	currentEditor?.destroy();
	currentEditor = null;
});

interface MakeOpts {
	titles: TitleEntry[];
	currentGuid?: string | null;
	content?: string;
	withListsAndHeadings?: boolean;
}

function makeEditor(opts: MakeOpts): Editor {
	const titles = [...opts.titles];
	const currentGuid = opts.currentGuid ?? null;
	const baseExtensions = opts.withListsAndHeadings
		? [
				StarterKit.configure({
					code: false,
					codeBlock: false,
					paragraph: false,
					listItem: false
				}),
				TomboyParagraph,
				TomboyListItem
			]
		: [Document, Paragraph, Text];

	const editor = new Editor({
		extensions: [
			...baseExtensions,
			TomboyMonospace,
			TomboyUrlLink,
			TomboyInternalLink.configure({
				getTitles: () => titles,
				getCurrentGuid: () => currentGuid
			})
		],
		content: opts.content ?? '<p></p><p></p>'
	});
	currentEditor = editor;
	return editor;
}

interface LinkSpan {
	text: string;
	target: string;
}

function collectLinks(editor: Editor): LinkSpan[] {
	const out: LinkSpan[] = [];
	editor.state.doc.descendants((node) => {
		if (!node.isText) return;
		for (const m of node.marks) {
			if (m.type.name === 'tomboyInternalLink') {
				out.push({
					text: node.text ?? '',
					target: m.attrs.target as string
				});
			}
		}
	});
	return out;
}

describe('cross-word auto-link — Korean particle scenarios', () => {
	it('links a long Korean title followed immediately by a particle', () => {
		const TITLE = '톰보이 노트 사용법';
		const editor = makeEditor({ titles: [entry(TITLE)] });
		// Type into the body paragraph (skipping the first paragraph
		// which is the title-line guard).
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(
			'톰보이 노트 사용법에 따르면, 제목은 대소문자를 구분한다'
		);

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		// The mark covers exactly the title — the trailing 에 stays plain.
		expect(links[0].text).toBe(TITLE);
		expect(links[0].target).toBe(TITLE);
	});

	it('links every Korean particle variant attached to a title (은/는/이/가/을/를/에/의/도/로)', () => {
		const TITLE = '강아지의 산책 방법';
		const editor = makeEditor({ titles: [entry(TITLE)] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(
			[
				`${TITLE}은 짧다.`,
				`${TITLE}는 길다.`,
				`${TITLE}이 시작.`,
				`${TITLE}가 끝.`,
				`${TITLE}을 본다.`,
				`${TITLE}를 읽음.`,
				`${TITLE}에 관해.`,
				`${TITLE}의 핵심.`,
				`${TITLE}도 있다.`,
				`${TITLE}으로.`
			].join(' ')
		);

		const links = collectLinks(editor);
		// Every occurrence is matched and the link span equals the title only.
		expect(links).toHaveLength(10);
		for (const l of links) {
			expect(l.text).toBe(TITLE);
			expect(l.target).toBe(TITLE);
		}
	});

	it('links 강아지 inside 강아지의자리 (substring inside a larger Korean word)', () => {
		const editor = makeEditor({ titles: [entry('강아지')] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent('강아지의자리에 누웠다');

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe('강아지');
	});

	it('links the LONGER overlapping title in continuous Korean text', () => {
		// Both titles share a prefix; the longer one must win.
		const editor = makeEditor({
			titles: [entry('강아지'), entry('강아지의자')]
		});
		editor.commands.setTextSelection(3);
		editor.commands.insertContent('강아지의자리에 누웠다');

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe('강아지의자');
		expect(links[0].target).toBe('강아지의자');
	});

	it('links two adjacent Korean particle uses of the same title', () => {
		const TITLE = '고양이 키우기';
		const editor = makeEditor({ titles: [entry(TITLE)] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(`${TITLE}에 ${TITLE}는`);

		const links = collectLinks(editor);
		expect(links).toHaveLength(2);
		expect(links[0].text).toBe(TITLE);
		expect(links[1].text).toBe(TITLE);
	});
});

describe('cross-word auto-link — pre-existing marks loaded from XML', () => {
	const TITLE = '강아지 산책 일지';

	it('preserves an existing link mark when it sits at the start of a continuous Korean word', () => {
		// Simulate a saved note: title surrounded by text that, under the
		// new substring rule, the title is still a valid match for. The
		// stored mark must NOT be stripped when the doc loads.
		const editor = makeEditor({
			titles: [entry(TITLE)],
			content: `<p></p><p><a data-link-target="${TITLE}">${TITLE}</a>의 핵심</p>`
		});

		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe(TITLE);
		expect(links[0].target).toBe(TITLE);
	});

	it('preserves an existing mark during async boot when the title list is still empty', () => {
		// Boot path: editor loads a saved doc whose `<link:internal>` mark
		// sits at the start of a continuous Korean word ("강아지의 핵심").
		// At this moment the titles list hasn't been hydrated yet — the
		// plugin must NOT strip the mark just because the next character
		// is a letter (which under the cross-word rule is fine).
		const titles: TitleEntry[] = [];
		const editor = new Editor({
			extensions: [
				Document,
				Paragraph,
				Text,
				TomboyMonospace,
				TomboyUrlLink,
				TomboyInternalLink.configure({
					getTitles: () => titles,
					getCurrentGuid: () => null
				})
			],
			content: `<p></p><p><a data-link-target="${TITLE}">${TITLE}</a>의 핵심</p>`
		});
		currentEditor = editor;

		// Force the plugin to scan, but with no titles loaded.
		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe(TITLE);
		expect(links[0].target).toBe(TITLE);
	});

	it('strips a stale broken-target mark whose target is not in the titles list', () => {
		const editor = makeEditor({
			titles: [entry(TITLE)],
			content: `<p></p><p><a data-link-target="${TITLE}오타">${TITLE}오타</a> 본문</p>`
		});
		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		// The malformed mark is dropped because its target is not in the
		// titles list. Pass 2 then re-marks the title substring.
		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe(TITLE);
		expect(links[0].target).toBe(TITLE);
	});
});

describe('cross-word auto-link — list items and headings', () => {
	it('auto-links inside a list item', () => {
		const editor = makeEditor({
			titles: [entry('강아지 산책법')],
			withListsAndHeadings: true,
			content: '<p>제목 줄</p><ul><li><p>오늘 강아지 산책법에 대해 적었다</p></li></ul>'
		});

		// Force a full refresh so initial content is scanned.
		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe('강아지 산책법');
	});

	it('auto-links inside a heading', () => {
		const editor = makeEditor({
			titles: [entry('강아지 키우기')],
			withListsAndHeadings: true,
			content: '<p>제목 줄</p><h2>강아지 키우기에 대한 메모</h2>'
		});

		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe('강아지 키우기');
	});

	it('auto-links across multiple list items independently', () => {
		const editor = makeEditor({
			titles: [entry('강아지 산책법')],
			withListsAndHeadings: true,
			content:
				'<p>제목 줄</p><ul><li><p>강아지 산책법은 중요</p></li><li><p>강아지 산책법의 핵심</p></li></ul>'
		});

		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		const links = collectLinks(editor);
		expect(links).toHaveLength(2);
	});
});

describe('cross-word auto-link — mid-text edits re-scan both sides', () => {
	const TITLE = '강아지 산책 일지';

	it('inserts a character INSIDE a continuous run and creates a new match for the title before the insertion', () => {
		// Initial content has no link (titles list is empty when the doc
		// loads). After the user adds a title and edits inside the body
		// run, the plugin must re-scan around the edit and find the
		// title that already sat to the left of the cursor.
		const titles: TitleEntry[] = [];
		const editor = new Editor({
			extensions: [
				Document,
				Paragraph,
				Text,
				TomboyMonospace,
				TomboyUrlLink,
				TomboyInternalLink.configure({
					getTitles: () => titles,
					getCurrentGuid: () => null
				})
			],
			content: `<p></p><p>${TITLE}의자리</p>`
		});
		currentEditor = editor;

		// No link yet — title list empty.
		expect(collectLinks(editor)).toHaveLength(0);

		// Add the title and trigger a full rescan (simulates titles-loaded
		// path).
		titles.push(entry(TITLE));
		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe(TITLE);
	});

	it('typing in the middle of a long continuous word re-evaluates titles on both sides of the edit', () => {
		// Body: "Foobar강아지" — both substrings are titles. Plugin
		// should mark each one. Then the user inserts " " in the
		// middle, splitting the run; both still match because the
		// substring rule doesn't care about boundaries either way.
		const editor = makeEditor({
			titles: [entry('Foobar'), entry('강아지')],
			content: '<p></p><p>Foobar강아지</p>'
		});
		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		expect(collectLinks(editor)).toHaveLength(2);

		// Insert "X" right between "Foobar" and "강아지". The body paragraph's
		// content starts at PM pos 3 (after the empty first <p> and the
		// second <p>'s open). "Foobar" occupies positions 3..9, so position
		// 9 sits between "r" and "강".
		editor.commands.setTextSelection(9);
		editor.commands.insertContent('X');

		const linksAfter = collectLinks(editor);
		expect(linksAfter).toHaveLength(2);
		expect(linksAfter.map((l) => l.target).sort()).toEqual(['Foobar', '강아지']);
	});

	it('removing a character from the middle of a title removes that link but keeps neighbours', () => {
		const editor = makeEditor({
			titles: [entry('강아지 산책법'), entry('고양이')],
			content: '<p></p><p>강아지 산책법 그리고 고양이</p>'
		});
		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);
		expect(collectLinks(editor)).toHaveLength(2);

		// Delete the "산" character (one Korean syllable) from the middle of
		// the first title. Body starts at position 3; "강아지 " is 4 chars
		// (including space), so "산" sits at position 3+1+4 = 8.
		const docText = editor.state.doc.textContent;
		const idx = docText.indexOf('산');
		expect(idx).toBeGreaterThan(0);
		// Walk to find PM pos of "산".
		let pmPos = -1;
		editor.state.doc.descendants((node, pos) => {
			if (pmPos >= 0) return false;
			if (!node.isText) return;
			const local = (node.text ?? '').indexOf('산');
			if (local >= 0) pmPos = pos + local;
		});
		expect(pmPos).toBeGreaterThan(0);
		editor.commands.setTextSelection({ from: pmPos, to: pmPos + 1 });
		editor.commands.deleteSelection();

		const linksAfter = collectLinks(editor);
		// First title broken → link gone. "고양이" untouched → link kept.
		expect(linksAfter.map((l) => l.target)).toEqual(['고양이']);
	});

	it('appending a particle at the end of a typed title keeps the link on the title only', () => {
		const TITLE = '톰보이 노트';
		const editor = makeEditor({ titles: [entry(TITLE)] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(TITLE);
		expect(collectLinks(editor)).toEqual([{ text: TITLE, target: TITLE }]);

		// Type "에" right after — particle. Mark span must not extend.
		editor.commands.insertContent('에');
		expect(collectLinks(editor)).toEqual([{ text: TITLE, target: TITLE }]);

		// Continue typing more particles / text.
		editor.commands.insertContent(' 따르면');
		expect(collectLinks(editor)).toEqual([{ text: TITLE, target: TITLE }]);
	});
});

describe('cross-word auto-link — suppressed marks still block linking', () => {
	const TITLE = '강아지 산책법';

	it('does not auto-link when the matching substring is wrapped in a URL link', () => {
		const editor = makeEditor({ titles: [entry(TITLE)] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent({
			type: 'text',
			text: `${TITLE}에 대해`,
			marks: [{ type: 'tomboyUrlLink', attrs: { href: 'https://x' } }]
		});

		const links = collectLinks(editor);
		expect(links).toHaveLength(0);
	});

	it('does not auto-link when the matching substring is in monospace', () => {
		const editor = makeEditor({ titles: [entry(TITLE)] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent({
			type: 'text',
			text: `${TITLE}에`,
			marks: [{ type: 'tomboyMonospace' }]
		});

		expect(collectLinks(editor)).toHaveLength(0);
	});
});

describe('cross-word auto-link — title-line guard still holds', () => {
	it('does not link the current note title even when followed by a particle', () => {
		// Title-line guard takes precedence: even though "강아지 산책법에"
		// would now match, the FIRST paragraph is treated as the title
		// line and never auto-linked.
		const TITLE = '강아지 산책법';
		const editor = makeEditor({
			titles: [entry(TITLE, 'self'), entry(TITLE, 'duplicate-other')],
			currentGuid: 'self',
			content: `<p>${TITLE}에 대한 노트</p><p>본문 ${TITLE}에 따르면</p>`
		});
		editor.view.dispatch(
			editor.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);

		// First paragraph: not linked. Second: linked once.
		const links = collectLinks(editor);
		expect(links).toHaveLength(1);

		// Confirm it's specifically in the body paragraph, not the title line.
		let titleLineHasLink = false;
		let blockIdx = 0;
		editor.state.doc.forEach((block) => {
			if (blockIdx === 0) {
				block.descendants((node) => {
					if (!node.isText) return;
					if (node.marks.some((m) => m.type.name === 'tomboyInternalLink')) {
						titleLineHasLink = true;
					}
				});
			}
			blockIdx++;
		});
		expect(titleLineHasLink).toBe(false);
	});
});

describe('cross-word auto-link — serialization round-trip', () => {
	it('round-trips a Korean title-with-particle match through XML', () => {
		const TITLE = '강아지 산책법';
		const editor = makeEditor({ titles: [entry(TITLE)] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(`${TITLE}에 대해 알아보자`);

		const xml = serializeContent(editor.getJSON());
		// The mark must close right after the title — particle stays outside.
		expect(xml).toContain(`<link:internal>${TITLE}</link:internal>에 대해`);

		// Re-load and confirm the mark survives.
		const reloaded = makeEditor({ titles: [entry(TITLE)] });
		const docJson = deserializeContent(xml);
		reloaded.commands.setContent(docJson);
		reloaded.view.dispatch(
			reloaded.state.tr.setMeta(autoLinkPluginKey, { refresh: true, full: true })
		);
		const links = collectLinks(reloaded);
		expect(links.some((l) => l.text === TITLE && l.target === TITLE)).toBe(true);
	});
});

describe('cross-word auto-link — ASCII corner cases', () => {
	it('matches a title followed immediately by digits', () => {
		const TITLE = 'ProjectX';
		const editor = makeEditor({ titles: [entry(TITLE)] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent(`${TITLE}123 was a thing`);

		const links = collectLinks(editor);
		expect(links).toHaveLength(1);
		expect(links[0].text).toBe(TITLE);
	});

	it('still respects case sensitivity for cross-word matches', () => {
		const editor = makeEditor({ titles: [entry('Foobar')] });
		editor.commands.setTextSelection(3);
		editor.commands.insertContent('myFOOBARextra');

		expect(collectLinks(editor)).toHaveLength(0);
	});

	it('idempotent under cross-word: re-running the plugin makes no further changes', () => {
		const editor = makeEditor({
			titles: [entry('강아지 산책법')]
		});
		editor.commands.setTextSelection(3);
		editor.commands.insertContent('강아지 산책법에 대해');

		const before = editor.getJSON();
		editor.view.dispatch(editor.state.tr);
		const after = editor.getJSON();
		expect(after).toEqual(before);
	});
});
