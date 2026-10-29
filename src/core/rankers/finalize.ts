// Shared tail for every ranker: canonical order (score desc, item_id asc by code unit; CL §2.4 ties), the method's
// 1-based rank in parts.rank_by_method, and the display-only within-category percentile (F5).

import { rankOrderCompare, withinCategoryPercentiles } from '../ratingstats/percentile';
import type { MethodId, RankResult } from '../types';

/** Sorts `results` in place, writes rank_by_method[method] and within_category_percentile, and returns it. */
export function finalizeRanking(results: RankResult[], method: MethodId): RankResult[] {
  results.sort((a, b) => rankOrderCompare({ id: a.item_id, score: a.score }, { id: b.item_id, score: b.score }));
  const percentiles = withinCategoryPercentiles(
    results.map((r) => ({ id: r.item_id, score: r.score, category: r.category })),
  );
  results.forEach((r, i) => {
    r.parts.rank_by_method[method] = i + 1;
    r.parts.within_category_percentile = percentiles.get(r.item_id) ?? null;
  });
  return results;
}
