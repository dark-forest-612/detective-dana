import { describe, it, expect } from 'vitest';
import {
	findTitleMatches,
	type TitleEntry
} from '$lib/editor/autoLink/findTitleMatches.js';

// New-style entry: case is preserved and significant.
function t(title: string, guid = `guid-${title}`): TitleEntry {
	return { original: title, guid };
}

describe('findTitleMatches — case sensitivity (case-sensitive behavior)', () => {
	it('does not match a lower-cased candidate against mixed-case text', () => {
		expect(findTitleMatches('Apple pie', [t('apple')])).toEqual([]);
	});

	it('does not match an upper-cased candidate against lower-case text', () => {
		expect(findTitleMatches('apple pie', [t('Apple')])).toEqual([]);
	});

	it('matches exact same-case candidate', () => {
		const m = findTitleMatches('Apple pie', [t('Apple')]);
		expect(m).toHaveLength(1);
		expect(m[0].target).toBe('Apple');
		expect(m[0]).toMatchObject({ from: 0, to: 5 });
	});

	it('treats titles that differ only in case as separate candidates', () => {
		// Only the candidate matching the text exactly (case included) wins.
		const m = findTitleMatches('Apple and apple', [
			t('Apple', 'g-apple-upper'),
			t('apple', 'g-apple-lower')
		]);
		expect(m).toHaveLength(2);
		// Sorted by from
		m.sort((a, b) => a.from - b.from);
		expect(m[0]).toMatchObject({ target: 'Apple', from: 0, to: 5, guid: 'g-apple-upper' });
		expect(m[1]).toMatchObject({ target: 'apple', from: 10, to: 15, guid: 'g-apple-lower' });
	});

	it('ALL-CAPS title does not match mixed-case text', () => {
		expect(findTitleMatches('Hello world', [t('HELLO')])).toEqual([]);
	});
});
