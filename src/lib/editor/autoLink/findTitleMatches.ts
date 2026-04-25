/**
 * Pure text-matching utility for the auto-link feature.
 *
 * Given a text blob and a list of note titles, finds non-overlapping
 * substrings of `text` that match any title. Longer titles take
 * priority when candidates overlap. The match does not require word
 * boundaries — a title may sit inside a larger continuous run of
 * letters (e.g. Korean "강아지" inside "강아지의자리", or a Korean
 * title followed by a particle). The 5-character minimum on titles
 * keeps accidental matches rare.
 *
 * Matching is case-SENSITIVE: "Apple" and "apple" are different titles
 * and must match their text exactly (after trimming whitespace).
 */

export interface TitleEntry {
	/**
	 * The original title, preserved exactly as-is for matching and for the
	 * resulting `target`. Matching is case-sensitive on this value (trimmed).
	 */
	original: string;
	/** GUID of the note this title belongs to. */
	guid: string;
	/**
	 * @deprecated No longer consulted by findTitleMatches — matching is
	 * case-sensitive on `original`. Retained as an optional field so existing
	 * call sites that still populate it continue to type-check.
	 */
	titleLower?: string;
}

export interface Match {
	/** Inclusive start offset into the original text. */
	from: number;
	/** Exclusive end offset into the original text. */
	to: number;
	/** Original-cased title to store on the mark. */
	target: string;
	/** GUID of the target note. */
	guid: string;
}

export interface FindOptions {
	/** Skip candidate titles belonging to this guid (e.g. the current note). */
	excludeGuid?: string | null;
}

// Word character = Unicode letter / number / underscore.
// We use \p{L}\p{N}_ classes so this works for ASCII + CJK + accented scripts.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function isWordChar(ch: string | undefined): boolean {
	if (!ch) return false;
	return WORD_CHAR.test(ch);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findTitleMatches(
	text: string,
	titles: TitleEntry[],
	options: FindOptions = {}
): Match[] {
	if (!text) return [];
	const exclude = options.excludeGuid ?? null;

	// Keep only non-empty, non-excluded titles; de-dup by the case-sensitive
	// trimmed title so two notes with the same exact title collapse.
	const seen = new Set<string>();
	interface Candidate {
		needle: string;
		original: string;
		guid: string;
	}
	const candidates: Candidate[] = [];
	for (const entry of titles) {
		const trimmed = entry.original.trim();
		if (!trimmed) continue;
		if (exclude !== null && entry.guid === exclude) continue;
		if (seen.has(trimmed)) continue;
		seen.add(trimmed);
		candidates.push({ needle: trimmed, original: entry.original, guid: entry.guid });
	}
	if (candidates.length === 0) return [];

	// Sort longest-first so longer titles win overlaps.
	candidates.sort((a, b) => b.needle.length - a.needle.length);

	const matches: Match[] = [];

	let cursor = 0;
	outer: while (cursor < text.length) {
		for (const cand of candidates) {
			const needle = cand.needle;
			if (needle.length === 0) continue;
			if (cursor + needle.length > text.length) continue;
			// Case-sensitive compare against the raw text. No word-boundary
			// check — titles may match inside larger continuous text.
			if (text.startsWith(needle, cursor)) {
				const from = cursor;
				const to = cursor + needle.length;
				matches.push({ from, to, target: cand.original, guid: cand.guid });
				cursor = to;
				continue outer;
			}
		}
		// Advance by one code point (handle surrogate pairs).
		const code = text.codePointAt(cursor) ?? 0;
		cursor += code > 0xffff ? 2 : 1;
	}

	// Assert non-overlapping (defensive; loop guarantees this).
	return matches;
}

// Re-exported for convenience (the regex is only internal, but the escape
// helper is useful to any consumer who wants to build its own matcher).
export { escapeRegExp };
