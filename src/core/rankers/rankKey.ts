import type { RankKey } from '../types';

/** EB keys stay on the absolute star axis. Percentiles never participate in ordering. */
export function rankKeyScore(posteriorMean: number, lo: number, key: RankKey): number {
  return key === 'lower_endpoint' ? lo : posteriorMean;
}
