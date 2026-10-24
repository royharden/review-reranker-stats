// NDCG@k (CL §8; PLAN C13): gain = target - 1 (a 1-star target contributes zero gain), log2 discount
//   DCG@k = sum_{r=1..min(k, N)} gain(target at predicted rank r) / log2(r + 1)
//   NDCG@k = DCG@k / IDCG@k, IDCG = DCG of the targets sorted descending.
// Predicted order: score descending, ties broken by id ascending (code unit) so the metric is deterministic.

import { cmp } from '../stats/hash';

export interface NdcgItem {
  id: string;
  /** Predicted score (higher ranks first). */
  score: number;
  /** Target, e.g. the item's later-period mean stars (1..5). */
  target: number;
}

export type GainFn = (target: number) => number;

/** Default star gain: target - 1, so 1 star -> 0 and 5 stars -> 4 (PLAN C13). */
export const starGain: GainFn = (target) => target - 1;

export type NdcgUndefinedReason = 'no-items' | 'zero-ideal-gain' | 'non-finite-input';

export type NdcgResult = { value: number } | { value: undefined; reason: NdcgUndefinedReason };

/** Discounted cumulative gain of `gains` (already in rank order) truncated at k. */
export function dcg(gains: readonly number[], k: number): number {
  const m = Math.min(k, gains.length);
  let s = 0;
  for (let r = 1; r <= m; r++) s += gains[r - 1] / Math.log2(r + 1);
  return s;
}

/** NDCG@k of the predicted order against the targets. k must be a positive integer. */
export function ndcgAtK(items: readonly NdcgItem[], k: number, gain: GainFn = starGain): NdcgResult {
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`ndcgAtK: k must be a positive integer, got ${k}`);
  if (items.length === 0) return { value: undefined, reason: 'no-items' };
  for (const it of items) {
    if (!Number.isFinite(it.score) || !Number.isFinite(it.target)) return { value: undefined, reason: 'non-finite-input' };
  }
  const predicted = items.slice().sort((a, b) => (b.score - a.score) || cmp(a.id, b.id));
  const gains = predicted.map((it) => gain(it.target));
  const ideal = items.map((it) => gain(it.target)).sort((a, b) => b - a);
  const idcg = dcg(ideal, k);
  if (!(idcg > 0)) return { value: undefined, reason: 'zero-ideal-gain' };
  return { value: dcg(gains, k) / idcg };
}
