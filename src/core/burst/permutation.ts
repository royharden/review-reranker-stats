import { rngFrom, shuffleInPlace } from '../stats/prng';
import { mean } from '../stats/weighted';

export interface PermutationResult { statistic: number; pValue: number; exceedances: number; permutations: number }
/** Two-sided absolute mean shift. Seed stream is per (item, span), independent of dataset traversal order. */
export function permutationShift(inside: readonly number[], reference: readonly number[], permutations: number, seed: number, itemId: string, start: number, end: number): PermutationResult {
  if (inside.length === 0 || reference.length === 0) throw new RangeError('permutationShift needs two non-empty groups');
  if (!Number.isInteger(permutations) || permutations < 1) throw new RangeError('permutations must be a positive integer');
  const statistic = Math.abs((mean(inside) ?? 0) - (mean(reference) ?? 0));
  const pooled = [...inside, ...reference];
  const total = pooled.reduce((sum, x) => sum + x, 0);
  const rng = rngFrom(seed, 'permutation', itemId, start, end);
  let exceedances = 0;
  for (let b = 0; b < permutations; b++) {
    shuffleInPlace(pooled, rng);
    let sum = 0;
    for (let i = 0; i < inside.length; i++) sum += pooled[i];
    const shift = Math.abs(sum / inside.length - (total - sum) / reference.length);
    // Include ties (and floating-point equivalents); observed zero must always give p = 1.
    if (shift >= statistic - 1e-12) exceedances++;
  }
  return { statistic, pValue: (1 + exceedances) / (permutations + 1), exceedances, permutations };
}

/** Holm step-down; null p-values occupy a family slot conservatively as p = 1, never become significant. */
export function holm(pValues: readonly (number | null)[], alpha: number): Array<{ rejected: boolean; threshold: number }> {
  const order = pValues.map((p, index) => ({ p: p ?? 1, index })).sort((a, b) => a.p - b.p || a.index - b.index);
  const out = pValues.map(() => ({ rejected: false, threshold: 0 }));
  let continuing = true;
  order.forEach(({ p, index }, rank) => {
    const threshold = alpha / (order.length - rank);
    const rejected = continuing && pValues[index] !== null && p <= threshold;
    if (!rejected) continuing = false;
    out[index] = { rejected, threshold };
  });
  return out;
}
