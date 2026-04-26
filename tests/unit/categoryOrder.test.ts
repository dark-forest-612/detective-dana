import { describe, it, expect } from 'vitest';
import { applyCategoryOrder, moveCategory } from '$lib/core/categoryOrder.js';

describe('applyCategoryOrder', () => {
	it('빈 order가 주어지면 노트북을 원래 순서대로 반환한다', () => {
		const result = applyCategoryOrder(['A', 'B', 'C'], []);
		expect(result).toEqual(['A', 'B', 'C']);
	});

	it('부분 order: order에 있는 항목 먼저, 나머지는 원래 순서로 뒤에 붙는다', () => {
		const result = applyCategoryOrder(['A', 'B', 'C', 'D'], ['C', 'A']);
		expect(result).toEqual(['C', 'A', 'B', 'D']);
	});

	it('order에 존재하지 않는 이름이 있으면 걸러낸다', () => {
		const result = applyCategoryOrder(['A', 'B'], ['Ghost', 'A', 'Phantom']);
		expect(result).toEqual(['A', 'B']);
	});

	it('order가 모든 노트북을 포함하면 그 순서대로 반환한다', () => {
		const result = applyCategoryOrder(['A', 'B', 'C'], ['C', 'B', 'A']);
		expect(result).toEqual(['C', 'B', 'A']);
	});

	it('빈 노트북 목록이면 빈 배열을 반환한다', () => {
		const result = applyCategoryOrder([], ['A', 'B']);
		expect(result).toEqual([]);
	});
});

describe('moveCategory', () => {
	it('위로 이동: 배열 중간에서 위로 이동', () => {
		const result = moveCategory(['A', 'B', 'C'], 'B', 'up');
		expect(result).toEqual(['B', 'A', 'C']);
	});

	it('아래로 이동: 배열 중간에서 아래로 이동', () => {
		const result = moveCategory(['A', 'B', 'C'], 'B', 'down');
		expect(result).toEqual(['A', 'C', 'B']);
	});

	it('위로 이동: 첫 번째 항목에서 위로 이동하면 변화 없음 (경계)', () => {
		const result = moveCategory(['A', 'B', 'C'], 'A', 'up');
		expect(result).toEqual(['A', 'B', 'C']);
	});

	it('아래로 이동: 마지막 항목에서 아래로 이동하면 변화 없음 (경계)', () => {
		const result = moveCategory(['A', 'B', 'C'], 'C', 'down');
		expect(result).toEqual(['A', 'B', 'C']);
	});

	it('존재하지 않는 이름이면 원래 배열을 반환한다', () => {
		const result = moveCategory(['A', 'B', 'C'], 'Ghost', 'up');
		expect(result).toEqual(['A', 'B', 'C']);
	});

	it('원본 배열을 변경하지 않는다 (immutable)', () => {
		const original = ['A', 'B', 'C'];
		moveCategory(original, 'B', 'up');
		expect(original).toEqual(['A', 'B', 'C']);
	});
});
