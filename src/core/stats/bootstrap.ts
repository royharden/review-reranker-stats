// Paired bootstrap over items (CL §8 "Temporal agreement"; PLAN §3 occurrence-index resampling).
//
// One resample = one index vector of length n drawn with replacement. The SAME vector is applied to both methods of
// a comparison (pairing), and both metrics are recomputed on it. Duplicate draws are kept as distinct occurrences:
// `occurrences[j]` counts how many earlier positions of the vector drew the same index, so a caller that builds a
// resampled item set can key entries as `${item_id}#${occurrence}` and never deduplicate an item drawn twice.
//
// The percentile CI uses linear interpolation between order statistics (Hyndman-Fan type 7). No claim is made that a
// finite-sample percentile CI contains the point estimate.

import { mulberry32 } from './prng';
import type { Rng } from './prng';
import { cmpNum } from './hash';

/** One bootstrap draw over n items. */
export interface BootstrapDraw {
  /** Drawn item positions in [0, n), length n, with replacement. */
  indices: readonly number[];
  /** occurrences[j] = number of positions before j holding the same index (0 for a first draw). */
  occurrences: readonly number[];
}

/** A statistic on a draw; undefined when the statistic is undefined on that draw (e.g. constant Spearman input). */
export type DrawStatistic = (draw: BootstrapDraw) => number | undefined;

export interface BootstrapOptions {
  /** Number of resamples B (CL §9: 2,000 in eval). */
  resamples: number;
  /** Two-sided level, e.g. 0.95. */
  level: number;
  /** Seed for mulberry32. */
  seed: number;
}

export type BootstrapResult =
  | {
      ok: true;
      /** Statistic on the identity draw (every item once). */
      estimate: number | undefined;
      lo: number;
      hi: number;
      level: number;
      resamples: number;
      /** Resamples on which the statistic was undefined and therefore skipped. */
      undefinedResamples: number;
    }
  | {
      ok: false;
      reason: 'no-items' | 'statistic-undefined-on-all-resamples';
      level: number;
      resamples: number;
    };

/** Occurrence index of each position: how many earlier positions drew the same index. */
export function occurrenceIndices(indices: readonly number[]): number[] {
  const seen = new Map<number, number>();
  const out = new Array<number>(indices.length);
  for (let j = 0; j < indices.length; j++) {
    const idx = indices[j];
    const count = seen.get(idx) ?? 0;
    out[j] = count;
    seen.set(idx, count + 1);
  }
  return out;
}

/** Draw n indices in [0, n) with replacement and attach occurrence indices. */
export function drawWithReplacement(n: number, rng: Rng): BootstrapDraw {
  const indices = new Array<number>(n);
  for (let j = 0; j < n; j++) indices[j] = Math.floor(rng() * n);
  return { indices, occurrences: occurrenceIndices(indices) };
}

/** The identity draw: every item exactly once, in order. */
export function identityDraw(n: number): BootstrapDraw {
  const indices = new Array<number>(n);
  const occurrences = new Array<number>(n);
  for (let j = 0; j < n; j++) {
    indices[j] = j;
    occurrences[j] = 0;
  }
  return { indices, occurrences };
}

/** Type-7 quantile of an ascending-sorted, non-empty array. */
export function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('quantileSorted: empty array');
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantileSorted: p must be in [0, 1], got ${p}`);
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const frac = h - lo;
  const a = sorted[lo];
  const b = sorted[hi];
  // When a === b the result is exactly a (no rounding drift), which the identity tests rely on.
  return a === b ? a : a + frac * (b - a);
}

function validate(n: number, opts: BootstrapOptions): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`bootstrap: n must be a non-negative integer, got ${n}`);
  if (!Number.isInteger(opts.resamples) || opts.resamples < 1) {
    throw new RangeError(`bootstrap: resamples must be a positive integer, got ${opts.resamples}`);
  }
  if (!(opts.level > 0 && opts.level < 1)) throw new RangeError(`bootstrap: level must be in (0, 1), got ${opts.level}`);
  if (!Number.isFinite(opts.seed)) throw new RangeError(`bootstrap: seed must be finite, got ${opts.seed}`);
}

/**
 * Generic bootstrap of a statistic over n items with a percentile CI. Deterministic for a given seed. For a paired
 * comparison, pass a statistic that evaluates BOTH methods on the same draw and returns their difference (see
 * pairedDifferenceBootstrap).
 */
export function bootstrapStatistic(n: number, statistic: DrawStatistic, opts: BootstrapOptions): BootstrapResult {
  validate(n, opts);
  if (n === 0) return { ok: false, reason: 'no-items', level: opts.level, resamples: opts.resamples };
  const rng = mulberry32(opts.seed);
  const values: number[] = [];
  let undefinedResamples = 0;
  for (let b = 0; b < opts.resamples; b++) {
    const v = statistic(drawWithReplacement(n, rng));
    if (v === undefined || !Number.isFinite(v)) undefinedResamples++;
    else values.push(v);
  }
  if (values.length === 0) {
    return { ok: false, reason: 'statistic-undefined-on-all-resamples', level: opts.level, resamples: opts.resamples };
  }
  values.sort(cmpNum);
  const alpha = 1 - opts.level;
  const est = statistic(identityDraw(n));
  return {
    ok: true,
    estimate: est === undefined || !Number.isFinite(est) ? undefined : est,
    lo: quantileSorted(values, alpha / 2),
    hi: quantileSorted(values, 1 - alpha / 2),
    level: opts.level,
    resamples: opts.resamples,
    undefinedResamples,
  };
}

/**
 * Paired bootstrap of metricA - metricB: both metrics are recomputed on the same draw (one shared index vector per
 * resample). Used for `full - best_baseline` on Spearman and NDCG@10 (CL §8). A draw on which either metric is
 * undefined is skipped and counted.
 */
export function pairedDifferenceBootstrap(
  n: number,
  metricA: DrawStatistic,
  metricB: DrawStatistic,
  opts: BootstrapOptions,
): BootstrapResult {
  return bootstrapStatistic(
    n,
    (draw) => {
      const a = metricA(draw);
      const b = metricB(draw);
      if (a === undefined || b === undefined) return undefined;
      return a - b;
    },
    opts,
  );
}

/**
 * The paired mean-difference primitive (CL §5): per-item differences d_i = a_i - b_i are formed ONCE, then each
 * resample averages d over the drawn indices. Identities this guarantees exactly:
 *   a == b elementwise                 -> CI [0, 0]
 *   d_i == c for all i (c exact in fp) -> CI [c, c]  (a sum of k copies of c divided by k is c when c, k*c are exact)
 */
export function pairedMeanDifference(a: readonly number[], b: readonly number[], opts: BootstrapOptions): BootstrapResult {
  if (a.length !== b.length) {
    throw new RangeError(`pairedMeanDifference: length mismatch (${a.length} vs ${b.length})`);
  }
  const d = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      throw new RangeError(`pairedMeanDifference: non-finite value at index ${i}`);
    }
    d[i] = a[i] - b[i];
  }
  return bootstrapStatistic(
    d.length,
    (draw) => {
      let sum = 0;
      for (const idx of draw.indices) sum += d[idx];
      return sum / draw.indices.length;
    },
    opts,
  );
}
