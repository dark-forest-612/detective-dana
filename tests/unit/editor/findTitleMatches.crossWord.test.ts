/**
 * Cross-word matching for the auto-link feature.
 *
 * The old behaviour required matches to be surrounded by non-word
 * characters (Unicode \p{L}\p{N}_), which excluded Korean titles
 * followed by particles ("톰보이 노트 사용법에 따르면" → 사용법 was
 * not linked because "에" is a letter and breaks the right-side
 * boundary). The new rule simply finds the longest title that fits
 * the text, regardless of what comes immediately before or after,
 * relying on the existing 5-character minimum-title constraint to
 * keep accidental matches rare.
 */

import { describe, it, expect } from 'vitest';
import {
	findTitleMatches,
	type TitleEntry
} from '$lib/editor/autoLink/findTitleMatches.js';

function t(title: string, guid = `guid-${title}`): TitleEntry {
	return { original: title, guid };
}

describe('findTitleMatches — cross-word (no boundary requirement)', () => {
	it('matches a title immediately followed by a Korean particle', () => {
		const m = findTitleMatches('톰보이 노트 사용법에 따르면, 제목은', [t('톰보이 노트 사용법')]);
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({
			from: 0,
			to: '톰보이 노트 사용법'.length,
			target: '톰보이 노트 사용법'
		});
	});

	it('matches a title that sits inside a longer continuous Korean word', () => {
		// Title "강아지" inside "강아지의자리" — the canonical case the
		// new behaviour exists to support.
		const m = findTitleMatches('강아지의자리에 누웠다', [t('강아지')]);
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({ from: 0, to: 3, target: '강아지' });
	});

	it('matches a title used as a suffix of a larger word', () => {
		// Title "Foobar" matches inside "myFoobar" — pure substring now.
		const m = findTitleMatches('myFoobar', [t('Foobar')]);
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({ from: 2, to: 8, target: 'Foobar' });
	});

	it('matches a title used as a prefix of a larger word', () => {
		const m = findTitleMatches('Foobar today', [t('Foobar')]);
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({ from: 0, to: 6, target: 'Foobar' });
	});

	it('matches a title across an underscore', () => {
		// Underscore used to count as a word char and block matching.
		const m = findTitleMatches('alpha_Foobar_beta', [t('Foobar')]);
		expect(m).toHaveLength(1);
		expect(m[0].target).toBe('Foobar');
	});

	it('prefers the LONGER overlapping title in continuous Korean text', () => {
		// Both "강아지" and "강아지의자" are titles. Text contains both.
		// Longest-first wins.
		const m = findTitleMatches('강아지의자리에 누웠다', [
			t('강아지'),
			t('강아지의자')
		]);
		expect(m).toHaveLength(1);
		expect(m[0].target).toBe('강아지의자');
		expect(m[0]).toMatchObject({ from: 0, to: 5 });
	});

	it('matches the same title twice in a continuous run', () => {
		// Title "Foobar" appears twice back-to-back with no separator.
		const m = findTitleMatches('FoobarFoobar', [t('Foobar')]);
		expect(m).toHaveLength(2);
		expect(m[0]).toMatchObject({ from: 0, to: 6 });
		expect(m[1]).toMatchObject({ from: 6, to: 12 });
	});

	it('matches a Korean title used twice in a row with no separator', () => {
		const m = findTitleMatches('강아지강아지', [t('강아지')]);
		expect(m).toHaveLength(2);
		expect(m[0]).toMatchObject({ from: 0, to: 3 });
		expect(m[1]).toMatchObject({ from: 3, to: 6 });
	});

	it('still respects case sensitivity when matching cross-word', () => {
		// "FOOBAR" contains "foobar" lexically but not case-sensitively.
		expect(findTitleMatches('myFOOBAR', [t('foobar')])).toEqual([]);
	});

	it('still treats regex-special chars in titles as literals', () => {
		// "a.b" must not match "aXb" even though there are no boundaries.
		expect(findTitleMatches('xxaXbyy', [t('a.b')])).toEqual([]);
		const m = findTitleMatches('xxa.byy', [t('a.b')]);
		expect(m).toHaveLength(1);
	});

	it('still excludes the current note via excludeGuid', () => {
		const self = t('강아지', 'self');
		const other = t('서울특별', 'other');
		const m = findTitleMatches(
			'강아지의자리 서울특별시에서',
			[self, other],
			{ excludeGuid: 'self' }
		);
		expect(m).toHaveLength(1);
		expect(m[0].target).toBe('서울특별');
	});

	it('matches a Korean title at the very end of a continuous word', () => {
		// "와플강아지" — title "강아지" at suffix.
		const m = findTitleMatches('와플강아지', [t('강아지')]);
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({ from: 2, to: 5 });
	});

	it('finds non-overlapping matches across mixed scripts', () => {
		// Two titles, each cross-word: first inside Korean, second inside
		// ASCII. Both should be found.
		const m = findTitleMatches('강아지의자리abFoobarcd', [
			t('강아지'),
			t('Foobar')
		]);
		expect(m).toHaveLength(2);
		const targets = m.map((x) => x.target).sort();
		expect(targets).toEqual(['Foobar', '강아지']);
	});

	it('does not produce overlapping matches when a longer title wins', () => {
		// Title "강아지의자" (5) and title "의자리" (3). Text "강아지의자리".
		// Longest-first picks "강아지의자" at 0..5; "의자리" overlaps that
		// span and so cannot match. Only one match overall.
		const m = findTitleMatches('강아지의자리', [t('강아지의자'), t('의자리')]);
		expect(m).toHaveLength(1);
		expect(m[0].target).toBe('강아지의자');
	});

	it('falls back to a shorter title when a longer overlapping one is consumed earlier', () => {
		// "강아지의자리Foobar" — matches "강아지의자" then continues
		// past it, then matches "Foobar". The skipped "의자리" doesn't
		// match because its span overlaps the already-consumed prefix.
		const m = findTitleMatches('강아지의자리Foobar', [
			t('강아지의자'),
			t('의자리'),
			t('Foobar')
		]);
		expect(m).toHaveLength(2);
		const targets = m.map((x) => x.target);
		expect(targets).toContain('강아지의자');
		expect(targets).toContain('Foobar');
		expect(targets).not.toContain('의자리');
	});
});
