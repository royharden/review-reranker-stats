import { describe, expect, it } from 'vitest';
import { mean, nEff, weightSums, weightedMean, weightedSummary } from '../../src/core/stats/weighted';

describe('n_eff (Kish: S1^2 / S2)', () => {
  it('(1, 1, 1) -> 3', () => {
    // S1 = 3, S2 = 3, n_eff = 9 / 3 = 3
    expect(nEff([1, 1, 1])).toBe(3);
  });

  it('(1, 1, 0.25) -> 2.454545...', () => {
    // S1 = 2.25, S2 = 1 + 1 + 0.0625 = 2.0625, n_eff = 2.25^2 / 2.0625 = 5.0625 / 2.0625 = 2.4545...(= 27/11)
    expect(Math.abs(nEff([1, 1, 0.25]) - 27 / 11)).toBeLessThan(1e-12);
    expect(Math.abs(nEff([1, 1, 0.25]) - 2.454545)).toBeLessThan(1e-6);
  });

  it('empty input -> 0', () => {
    expect(nEff([])).toBe(0);
  });

  it('rejects zero, negative and non-finite weights (no review may reach weight 0)', () => {
    expect(() => nEff([1, 0])).toThrow(RangeError);
    expect(() => nEff([1, -0.5])).toThrow(RangeError);
    expect(() => nEff([1, Number.NaN])).toThrow(RangeError);
  });
});

describe('weighted mean and summary', () => {
  it('weighted mean of (5, 1) with weights (1, 0.25) = (5 + 0.25) / 1.25 = 4.2', () => {
    expect(Math.abs((weightedMean([5, 1], [1, 0.25]) ?? Number.NaN) - 4.2)).toBeLessThan(1e-12);
  });

  it('unit weights reduce to the arithmetic mean and d = n - 1', () => {
    // x = (2, 4, 6): mean 4, SS = 4 + 0 + 4 = 8, S1 = S2 = 3, d = 3 - 3/3 = 2
    const s = weightedSummary([2, 4, 6], [1, 1, 1]);
    expect(s.mean).toBe(4);
    expect(s.ss).toBe(8);
    expect(s.d).toBe(2);
    expect(s.n_eff).toBe(3);
    expect(weightSums([1, 1, 1])).toEqual({ s1: 3, s2: 3 });
  });

  it('reliability-weight d = S1 - S2/S1 with fractional weights', () => {
    // w = (1, 1, 0.25): S1 = 2.25, S2 = 2.0625, d = 2.25 - 2.0625/2.25 = 2.25 - 0.916666... = 1.333333...
    // x = (4, 4, 0): mean = (4 + 4 + 0) / 2.25 = 3.5555...; SS = 2*(0.4444...)^2 + 0.25*(3.5555...)^2
    //   = 2*0.197530864 + 0.25*12.641975309 = 0.395061728 + 3.160493827 = 3.555555556 (= 32/9)
    const s = weightedSummary([4, 4, 0], [1, 1, 0.25]);
    expect(Math.abs(s.d - 4 / 3)).toBeLessThan(1e-12);
    expect(Math.abs((s.mean ?? Number.NaN) - 32 / 9)).toBeLessThan(1e-12);
    expect(Math.abs(s.ss - 32 / 9)).toBeLessThan(1e-12);
  });

  it('empty input -> mean undefined, everything else 0', () => {
    expect(weightedSummary([], [])).toEqual({ s1: 0, s2: 0, n_eff: 0, mean: undefined, ss: 0, d: 0 });
    expect(mean([])).toBeUndefined();
  });

  it('length mismatch throws', () => {
    expect(() => weightedSummary([1, 2], [1])).toThrow(RangeError);
  });
});
