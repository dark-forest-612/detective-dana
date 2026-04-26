/**
 * Pure helpers for ordering notebook categories.
 * No I/O — all functions return new arrays and leave inputs unchanged.
 */

/**
 * Reorders `allNotebooks` according to `order`:
 * items present in `order` (filtered to those that actually exist in
 * `allNotebooks`) come first in that order; remaining items are appended
 * in their original order.
 */
export function applyCategoryOrder(allNotebooks: string[], order: string[]): string[] {
	const existing = new Set(allNotebooks);
	const validOrder = order.filter((name) => existing.has(name));
	const orderedSet = new Set(validOrder);
	const rest = allNotebooks.filter((name) => !orderedSet.has(name));
	return [...validOrder, ...rest];
}

/**
 * Returns a new array with `name` moved up or down by 1 within `order`.
 * If `name` is not in `order`, returns `order` unchanged.
 * No-op at boundaries (first item cannot go up, last cannot go down).
 */
export function moveCategory(order: string[], name: string, direction: 'up' | 'down'): string[] {
	const idx = order.indexOf(name);
	if (idx === -1) return order;
	if (direction === 'up' && idx === 0) return order;
	if (direction === 'down' && idx === order.length - 1) return order;

	const next = [...order];
	const swapWith = direction === 'up' ? idx - 1 : idx + 1;
	[next[idx], next[swapWith]] = [next[swapWith], next[idx]];
	return next;
}
