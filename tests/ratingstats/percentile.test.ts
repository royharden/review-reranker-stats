import { describe, expect, it } from 'vitest';
import {
  percentilesByScore,
  rankPercentile,
  ranksByScore,
  withinCategoryPercentiles,
} from '../../src/core/ratingstats/percentile';

describe('ranksByScore (score desc, id asc by code unit)', () => {
  it('breaks score ties by id in code-unit order', () => {
    // scores: x 4.0, B 4.5, a 4.5 -> B (66) before a (97) at 4.5, then x
    const ranks = ranksByScore([
      { id: 'x', score: 4.0 },
      { id: 'a', score: 4.5 },
      { id: 'B', score: 4.5 },
    ]);
    expect(ranks.get('B')).toBe(1);
    expect(ranks.get('a')).toBe(2);
    expect(ranks.get('x')).toBe(3);
  });

  it('rejects duplicate ids and non-finite scores', () => {
    expect(() =>
      ranksByScore([
        { id: 'a', score: 1 },
        { id: 'a', score: 2 },
      ]),
    ).toThrow(RangeError);
    expect(() => ranksByScore([{ id: 'a', score: Number.NaN }])).toThrow(RangeError);
  });
});

describe('rankPercentile q = (N - rank) / (N - 1)', () => {
  it('top -> 1, bottom -> 0, middle of 5 -> 0.5', () => {
    expect(rankPercentile(1, 5)).toBe(1);
    expect(rankPercentile(5, 5)).toBe(0);
    // (5 - 3) / (5 - 1) = 0.5
    expect(rankPercentile(3, 5)).toBe(0.5);
  });

  it('N < 2 -> null; out-of-range rank throws', () => {
    expect(rankPercentile(1, 1)).toBeNull();
    expect(() => rankPercentile(0, 3)).toThrow(RangeError);
    expect(() => rankPercentile(4, 3)).toThrow(RangeError);
  });

  it('percentilesByScore maps every id', () => {
    const q = percentilesByScore([
      { id: 'a', score: 1 },
      { id: 'b', score: 3 },
      { id: 'c', score: 2 },
    ]);
    // ranks b=1, c=2, a=3 -> q = 1, 0.5, 0
    expect(q.get('b')).toBe(1);
    expect(q.get('c')).toBe(0.5);
    expect(q.get('a')).toBe(0);
  });
});

describe('withinCategoryPercentiles (display only)', () => {
  it('ranks within each category independently; singleton categories get null', () => {
    const q = withinCategoryPercentiles([
      { id: 'p1', category: 'phones', score: 4.1 },
      { id: 'p2', category: 'phones', score: 3.9 },
      { id: 'p3', category: 'phones', score: 4.4 },
      { id: 'k1', category: 'kitchen', score: 2.0 },
      { id: 'k2', category: 'kitchen', score: 2.5 },
      { id: 's1', category: 'solo', score: 5.0 },
    ]);
    // phones: p3 (rank 1) -> 1, p1 (2) -> 0.5, p2 (3) -> 0
    expect(q.get('p3')).toBe(1);
    expect(q.get('p1')).toBe(0.5);
    expect(q.get('p2')).toBe(0);
    // kitchen: k2 -> 1, k1 -> 0 (k1's 2.0 would be bottom globally too, but k2 tops its category)
    expect(q.get('k2')).toBe(1);
    expect(q.get('k1')).toBe(0);
    expect(q.get('s1')).toBeNull();
  });
});
