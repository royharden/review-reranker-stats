import { describe, expect, it } from 'vitest';
import { midranks, spearman } from '../../src/core/ratingstats/spearman';

describe('midranks', () => {
  it('tied values share the average of their positions', () => {
    // sorted 10 | 20 20 | 30 -> positions 1 | 2 3 | 4 -> ranks 1 | 2.5 2.5 | 4
    expect(midranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    // all tied: positions 1..3 -> 2 each
    expect(midranks([7, 7, 7])).toEqual([2, 2, 2]);
  });
});

describe('spearman (midranks on actual values)', () => {
  it('hand-ranked example with ties on both sides = 29/38 = 0.7631578947...', () => {
    // x = (10, 20, 20, 30, 40) -> rx = (1, 2.5, 2.5, 4, 5)
    // y = ( 1,  3,  2,  2,  5) -> sorted 1 | 2 2 | 3 | 5 -> ry = (1, 4, 2.5, 2.5, 5)
    // mean rank = 3 on both sides
    // dx = (-2, -0.5, -0.5, 1, 2), dy = (-2, 1, -0.5, -0.5, 2)
    // sum dx*dy = 4 - 0.5 + 0.25 - 0.5 + 4 = 7.25
    // sum dx^2  = 4 + 0.25 + 0.25 + 1 + 4 = 9.5;  sum dy^2 = 4 + 1 + 0.25 + 0.25 + 4 = 9.5
    // rho = 7.25 / sqrt(9.5 * 9.5) = 7.25 / 9.5 = 29/38
    expect(midranks([1, 3, 2, 2, 5])).toEqual([1, 4, 2.5, 2.5, 5]);
    const r = spearman([10, 20, 20, 30, 40], [1, 3, 2, 2, 5]);
    expect(r.value).toBeDefined();
    expect(Math.abs((r.value ?? Number.NaN) - 29 / 38)).toBeLessThan(1e-12);
  });

  it('perfectly monotone -> 1, reversed -> -1 (ranks only, so non-linear is fine)', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16]).value).toBe(1);
    expect(spearman([1, 2, 3, 4], [16, 9, 4, 1]).value).toBe(-1);
  });

  it('is invariant to input order (pairs shuffled together)', () => {
    const a = spearman([10, 20, 20, 30, 40], [1, 3, 2, 2, 5]);
    const b = spearman([40, 20, 10, 30, 20], [5, 2, 1, 2, 3]);
    expect(Math.abs((a.value ?? Number.NaN) - (b.value ?? Number.NaN))).toBeLessThan(1e-12);
  });

  it('constant input -> undefined with reason constant-input', () => {
    expect(spearman([3, 3, 3], [1, 2, 3])).toEqual({ value: undefined, reason: 'constant-input' });
    expect(spearman([1, 2, 3], [4, 4, 4])).toEqual({ value: undefined, reason: 'constant-input' });
  });

  it('fewer than 2 items -> undefined with reason too-few-items', () => {
    expect(spearman([1], [2])).toEqual({ value: undefined, reason: 'too-few-items' });
    expect(spearman([], [])).toEqual({ value: undefined, reason: 'too-few-items' });
  });

  it('length mismatch and non-finite input are named, not NaN', () => {
    expect(spearman([1, 2], [1, 2, 3])).toEqual({ value: undefined, reason: 'length-mismatch' });
    expect(spearman([1, Number.NaN], [1, 2])).toEqual({ value: undefined, reason: 'non-finite-input' });
  });
});
