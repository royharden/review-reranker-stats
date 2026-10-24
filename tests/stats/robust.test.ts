import { describe, expect, it } from 'vitest';
import { mad, median, robustScale, robustZ } from '../../src/core/stats/robust';

describe('median', () => {
  it('odd n: middle value', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('even n: mean of the two middle values', () => {
    // sorted (1, 2, 3, 4) -> (2 + 3) / 2 = 2.5
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('does not mutate its input and is undefined when empty', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
    expect(median([])).toBeUndefined();
  });
});

describe('MAD (unscaled)', () => {
  it('even n: (1, 2, 3, 4) -> median 2.5, |dev| (1.5, 0.5, 0.5, 1.5) -> MAD 1', () => {
    expect(mad([1, 2, 3, 4])).toBe(1);
  });

  it('MAD = 0 when more than half the values equal the median', () => {
    // (5, 5, 5, 9): median 5, |dev| (0, 0, 0, 4) -> MAD 0
    expect(mad([5, 5, 5, 9])).toBe(0);
  });
});

describe('robustScale = max(1, 1.4826 * MAD, sqrt(median))', () => {
  it('MAD = 0 falls back to sqrt(median) when that exceeds 1', () => {
    // (5, 5, 5, 9): MAD 0, sqrt(5) = 2.2360679... > 1
    expect(robustScale([5, 5, 5, 9])).toBe(Math.sqrt(5));
  });

  it('MAD = 0 and median 0 (sparse_mad_zero) falls back to 1, never 0', () => {
    expect(robustScale([0, 0, 0, 0, 3])).toBe(1);
  });

  it('uses 1.4826 * MAD when it dominates', () => {
    // (0, 10, 20, 30, 40): median 20, |dev| (20, 10, 0, 10, 20) -> MAD 10 -> 14.826 > sqrt(20) = 4.47
    expect(Math.abs((robustScale([0, 10, 20, 30, 40]) ?? Number.NaN) - 14.826)).toBeLessThan(1e-12);
  });

  it('robustZ is finite for an all-zero baseline: (4 - 0) / 1 = 4', () => {
    expect(robustZ(4, [0, 0, 0, 0])).toBe(4);
    expect(robustZ(4, [])).toBeUndefined();
  });
});
