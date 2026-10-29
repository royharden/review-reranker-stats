import type { MethodId, RankResult } from '../types';
import { rankEmpiricalBayes } from './ebNormal';
import type { Ranker } from './types';

export const ablationRankers: readonly Ranker[] = [
  { id: 'full-verified', label: 'Full minus verified', interval: { quantity: 'mean stars', level: 0.9, approx: 'normal' },
    rank: (ds, cfg, ctx) => rankEmpiricalBayes(ds, cfg, ctx, 'full-verified', 'category', { verified: false, recency: true, burst: true }) },
  { id: 'full-recency', label: 'Full minus recency', interval: { quantity: 'mean stars', level: 0.9, approx: 'normal' },
    rank: (ds, cfg, ctx) => rankEmpiricalBayes(ds, cfg, ctx, 'full-recency', 'category', { verified: true, recency: false, burst: true }) },
  { id: 'full-burst', label: 'Full minus burst', interval: { quantity: 'mean stars', level: 0.9, approx: 'normal' },
    rank: (ds, cfg, ctx) => rankEmpiricalBayes(ds, cfg, ctx, 'full-burst', 'category', { verified: true, recency: true, burst: false }) },
];

/** Join ranks after all methods finish. No ranker reuses a baseline's fitted prior. */
export function annotateRankings(rankings: Partial<Record<MethodId, RankResult[]>>): void {
  const byItem = new Map<string, Partial<Record<MethodId, number>>>();
  for (const [method, rows] of Object.entries(rankings)) {
    rows.forEach((row, i) => {
      const ranks = byItem.get(row.item_id) ?? {};
      // method is narrowed by the rankings object's declared key type at this boundary.
      ranks[method as MethodId] = i + 1;
      byItem.set(row.item_id, ranks);
    });
  }
  for (const rows of Object.values(rankings)) for (const row of rows) {
    const ranks = byItem.get(row.item_id) ?? {};
    row.parts.rank_by_method = { ...ranks };
    row.parts.rank_without = { verified: ranks['full-verified'] ?? null, recency: ranks['full-recency'] ?? null, burst: ranks['full-burst'] ?? null };
  }
}
