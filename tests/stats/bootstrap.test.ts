import { describe, expect, it } from 'vitest';
import {
  bootstrapStatistic,
  drawWithReplacement,
  identityDraw,
  occurrenceIndices,
  pairedDifferenceBootstrap,
  pairedMeanDifference,
  quantileSorted,
} from '../../src/core/stats/bootstrap';
import type { BootstrapDraw } from '../../src/core/stats/bootstrap';
import { mulberry32 } from '../../src/core/stats/prng';

const OPTS = { resamples: 500, level: 0.95, seed: 2033 };

describe('paired mean-difference primitive', () => {
  it('identical per-item vectors -> CI exactly [0, 0]', () => {
    // Every per-item difference is 0, so every resample mean is 0 and both percentiles are 0.
    const a = [3.2, 4.1, 2.7, 4.9, 3.3, 1.8];
    const r = pairedMeanDifference(a, a.slice(), OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lo).toBe(0);
    expect(r.hi).toBe(0);
    expect(r.estimate).toBe(0);
  });

  it('per-item differences all equal to c -> CI exactly [c, c]', () => {
    // b integers, a = b + 0.25: every difference is exactly 0.25 in floating point, a resample sum of n copies of
    // 0.25 is exact, and dividing by n returns 0.25 exactly.
    const b = [1, 2, 3, 4, 5, 2, 3];
    const a = b.map((v) => v + 0.25);
    const r = pairedMeanDifference(a, b, OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lo).toBe(0.25);
    expect(r.hi).toBe(0.25);
  });

  it('same seed -> same CI; a different seed -> (almost surely) different CI', () => {
    const a = [0.9, 0.4, 0.7, 0.1, 0.5, 0.8, 0.3, 0.6];
    const b = [0.5, 0.6, 0.2, 0.3, 0.4, 0.1, 0.9, 0.2];
    const r1 = pairedMeanDifference(a, b, OPTS);
    const r2 = pairedMeanDifference(a, b, OPTS);
    const r3 = pairedMeanDifference(a, b, { ...OPTS, seed: 7 });
    expect(r1).toEqual(r2);
    expect(r1).not.toEqual(r3);
  });

  it('length mismatch throws; empty input reports no-items', () => {
    expect(() => pairedMeanDifference([1], [1, 2], OPTS)).toThrow(RangeError);
    const r = pairedMeanDifference([], [], OPTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no-items');
  });
});

describe('occurrence-index resampling', () => {
  it('occurrenceIndices counts earlier draws of the same index', () => {
    // indices (2, 0, 2, 2, 1, 0) -> occurrences (0, 0, 1, 2, 0, 1)
    expect(occurrenceIndices([2, 0, 2, 2, 1, 0])).toEqual([0, 0, 1, 2, 0, 1]);
  });

  it('a draw keeps duplicates as distinct occurrences, so keyed entries never deduplicate', () => {
    const draw = drawWithReplacement(50, mulberry32(11));
    expect(draw.indices).toHaveLength(50);
    expect(draw.occurrences).toHaveLength(50);
    const keys = draw.indices.map((idx, j) => `${idx}#${draw.occurrences[j]}`);
    expect(new Set(keys).size).toBe(50);
    // With 50 draws from 50 items a duplicate is (overwhelmingly) present; the seed makes this deterministic.
    expect(new Set(draw.indices).size).toBeLessThan(50);
  });

  it('the identity draw has every item once with occurrence 0', () => {
    expect(identityDraw(4)).toEqual({ indices: [0, 1, 2, 3], occurrences: [0, 0, 0, 0] });
  });
});

describe('pairing and determinism of generic metrics', () => {
  it('both metrics see the same index vector on every resample', () => {
    const seenA: string[] = [];
    const seenB: string[] = [];
    const record = (sink: string[]) => (draw: BootstrapDraw) => {
      sink.push(draw.indices.join(','));
      return draw.indices.length;
    };
    pairedDifferenceBootstrap(10, record(seenA), record(seenB), { resamples: 25, level: 0.9, seed: 3 });
    expect(seenA).toEqual(seenB);
  });

  it('resamples where the statistic is undefined are skipped and counted', () => {
    let call = 0;
    const r = bootstrapStatistic(5, () => (call++ % 2 === 0 ? undefined : 1), { resamples: 10, level: 0.9, seed: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.undefinedResamples).toBe(5);
    expect(r.lo).toBe(1);
    expect(r.hi).toBe(1);
  });

  it('a statistic undefined on every resample reports a reason, never NaN', () => {
    const r = bootstrapStatistic(5, () => undefined, { resamples: 10, level: 0.9, seed: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('statistic-undefined-on-all-resamples');
  });
});

describe('quantileSorted (type 7)', () => {
  it('interpolates linearly between order statistics', () => {
    // n = 5, p = 0.25 -> h = 4 * 0.25 = 1 -> x[1] = 20; p = 0.1 -> h = 0.4 -> 10 + 0.4 * 10 = 14
    expect(quantileSorted([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(Math.abs(quantileSorted([10, 20, 30, 40, 50], 0.1) - 14)).toBeLessThan(1e-12);
    expect(quantileSorted([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(quantileSorted([10, 20, 30, 40, 50], 1)).toBe(50);
  });
});
