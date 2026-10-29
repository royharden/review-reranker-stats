import { cmp } from '../stats/hash';
import type { Rankings } from './scoring';
import type { EvalMethod, NamedFailures, Partition, PriorSnapshot, RankMovement } from './schema';

export const ABLATION_COMPARISONS: readonly [EvalMethod, EvalMethod][] = [
  ['full', 'full-verified'], ['full', 'full-recency'], ['full', 'full-burst'], ['eb_category', 'eb_global'],
  ['full:posterior_mean', 'full:lower_endpoint'],
];
export function rankMovements(rankings: Rankings): RankMovement[] {
  const mean = new Map((rankings.get('mean') ?? []).map((r, i) => [r.item_id, i + 1]));
  const movements: RankMovement[] = [];
  for (const [method, rows] of rankings) {
    const changes = rows.map((row, i) => {
      const meanRank = mean.get(row.item_id); if (meanRank === undefined) throw new Error('Rank universes differ');
      return { method, itemId: row.item_id, meanRank, methodRank: i + 1, delta: meanRank - (i + 1) };
    });
    changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || cmp(a.itemId, b.itemId));
    movements.push(...changes.slice(0, 10));
  }
  return movements;
}
export function globalPriorCategories(priors: PriorSnapshot, run: Partition): NamedFailures['globalPriorCategories'] {
  return priors.methods.flatMap((m) => m.categories.filter((c) => c.source !== 'category').map((c) => ({ run, method: m.method, category: c.category })));
}
