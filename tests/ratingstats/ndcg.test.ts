import { describe, expect, it } from 'vitest';
import { dcg, ndcgAtK, starGain } from '../../src/core/ratingstats/ndcg';

describe('NDCG@k with gain = target - 1 and log2 discount', () => {
  it('hand example NDCG@3 = (2 + 4/log2 3) / (5 + 3/log2 3) = 0.6562973...', () => {
    // Items (score, target): A (0.9, 3), B (0.8, 5), C (0.7, 1), D (0.6, 4)
    // Predicted order A, B, C, D -> gains 2, 4, 0, 3
    //   DCG@3  = 2/log2(2) + 4/log2(3) + 0/log2(4) = 2 + 2.5237190 + 0 = 4.5237190
    // Ideal order B, D, A, C -> gains 4, 3, 2, 0
    //   IDCG@3 = 4/log2(2) + 3/log2(3) + 2/log2(4) = 4 + 1.8927893 + 1 = 6.8927893
    // NDCG@3 = 4.5237190 / 6.8927893 = 0.6562973
    const items = [
      { id: 'A', score: 0.9, target: 3 },
      { id: 'B', score: 0.8, target: 5 },
      { id: 'C', score: 0.7, target: 1 },
      { id: 'D', score: 0.6, target: 4 },
    ];
    const r = ndcgAtK(items, 3);
    const expected = (2 + 4 / Math.log2(3)) / (5 + 3 / Math.log2(3));
    expect(Math.abs((r.value ?? Number.NaN) - expected)).toBeLessThan(1e-12);
    expect(Math.abs((r.value ?? Number.NaN) - 0.6562973)).toBeLessThan(1e-6);
  });

  it('the ideal order scores exactly 1 and the metric never exceeds 1', () => {
    const items = [
      { id: 'A', score: 4, target: 5 },
      { id: 'B', score: 3, target: 4 },
      { id: 'C', score: 2, target: 2 },
    ];
    expect(ndcgAtK(items, 3).value).toBe(1);
    const worst = items.map((it) => ({ ...it, score: -it.score }));
    expect(ndcgAtK(worst, 3).value ?? 2).toBeLessThan(1);
  });

  it('a 1-star target contributes zero gain (PLAN C13)', () => {
    expect(starGain(1)).toBe(0);
    expect(starGain(5)).toBe(4);
  });

  it('ties in predicted score are broken by id ascending (code unit), deterministically', () => {
    // Same score: 'B' (code unit 66) precedes 'a' (97). Predicted order B, a -> gains 0, 4.
    // DCG@2 = 0 + 4/log2(3); IDCG@2 = 4 + 0 -> NDCG = 1/log2(3)
    const r = ndcgAtK(
      [
        { id: 'a', score: 1, target: 5 },
        { id: 'B', score: 1, target: 1 },
      ],
      2,
    );
    expect(Math.abs((r.value ?? Number.NaN) - 1 / Math.log2(3))).toBeLessThan(1e-12);
  });

  it('all-1-star targets -> undefined (zero ideal gain); empty -> undefined (no items)', () => {
    expect(ndcgAtK([{ id: 'x', score: 1, target: 1 }], 10)).toEqual({ value: undefined, reason: 'zero-ideal-gain' });
    expect(ndcgAtK([], 10)).toEqual({ value: undefined, reason: 'no-items' });
  });

  it('accepts a generic gain function', () => {
    const items = [
      { id: 'A', score: 2, target: 1 },
      { id: 'B', score: 1, target: 0 },
    ];
    // identity gain: DCG@2 = 1/1 + 0 = 1 = IDCG -> 1
    expect(ndcgAtK(items, 2, (t) => t).value).toBe(1);
  });

  it('dcg truncates at k and k must be a positive integer', () => {
    expect(dcg([3, 3, 3], 1)).toBe(3);
    expect(() => ndcgAtK([{ id: 'x', score: 1, target: 3 }], 0)).toThrow(RangeError);
  });
});
