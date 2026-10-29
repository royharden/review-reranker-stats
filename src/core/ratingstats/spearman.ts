// Spearman rank correlation with midranks on the actual values (PLAN §3: the display tie-break by item_id is never
// used for metrics). rho = Pearson correlation of the two midrank vectors, which is the exact tie-corrected Spearman.

import { cmpNum } from '../stats/hash';

export type SpearmanUndefinedReason = 'too-few-items' | 'constant-input' | 'length-mismatch' | 'non-finite-input';

export type SpearmanResult = { value: number } | { value: undefined; reason: SpearmanUndefinedReason };

/**
 * 1-based midranks in ascending order: tied values share the average of the positions they occupy.
 * Example: [10, 20, 20, 30] -> [1, 2.5, 2.5, 4].
 */
export function midranks(values: readonly number[]): number[] {
  const n = values.length;
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Index tie-break only makes the sort deterministic; tied values receive the same midrank regardless.
  order.sort((a, b) => cmpNum(values[a], values[b]) || a - b);
  const ranks = new Array<number>(n);
  let start = 0;
  while (start < n) {
    let end = start;
    while (end + 1 < n && values[order[end + 1]] === values[order[start]]) end++;
    // positions start..end (0-based) are ranks start+1..end+1; their average:
    const avg = (start + end + 2) / 2;
    for (let k = start; k <= end; k++) ranks[order[k]] = avg;
    start = end + 1;
  }
  return ranks;
}

/** Pearson correlation; undefined when either vector has zero variance. Inputs must have equal length >= 2. */
function pearson(x: readonly number[], y: readonly number[]): number | undefined {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return undefined;
  const r = sxy / Math.sqrt(sxx * syy);
  // Guard rounding just outside [-1, 1].
  return Math.max(-1, Math.min(1, r));
}

/**
 * Spearman's rho between paired vectors x and y (e.g. method scores and later-period target means).
 * Undefined with a reason for fewer than 2 items, constant input on either side, length mismatch or non-finite input.
 */
export function spearman(x: readonly number[], y: readonly number[]): SpearmanResult {
  if (x.length !== y.length) return { value: undefined, reason: 'length-mismatch' };
  if (x.length < 2) return { value: undefined, reason: 'too-few-items' };
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) return { value: undefined, reason: 'non-finite-input' };
  }
  const r = pearson(midranks(x), midranks(y));
  if (r === undefined) return { value: undefined, reason: 'constant-input' };
  return { value: r };
}
