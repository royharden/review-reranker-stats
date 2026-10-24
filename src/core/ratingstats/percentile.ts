// Ranks and rank percentiles (CL §2.4 ties, §2.5 F5, §8 damage).
//   rank: 1-based, ordered by (score desc, id asc by code unit) — the deterministic display/rank order.
//   rank percentile q = (N - rank) / (N - 1): 1 for the top item, 0 for the bottom; null when N < 2.
// Within-category percentile is display-only (F5): the global rank key is the absolute posterior mean.

import { cmp } from '../stats/hash';

export interface ScoredItem {
  id: string;
  score: number;
}

export interface CategorizedScoredItem extends ScoredItem {
  category: string;
}

/** Sort comparator for the canonical rank order: score descending, then id ascending (code unit). */
export function rankOrderCompare(a: ScoredItem, b: ScoredItem): number {
  if (a.score > b.score) return -1;
  if (a.score < b.score) return 1;
  return cmp(a.id, b.id);
}

/** 1-based ranks keyed by id. Throws on duplicate ids or non-finite scores. */
export function ranksByScore(items: readonly ScoredItem[]): Map<string, number> {
  const seen = new Set<string>();
  for (const it of items) {
    if (!Number.isFinite(it.score)) throw new RangeError(`ranksByScore: non-finite score for ${it.id}`);
    if (seen.has(it.id)) throw new RangeError(`ranksByScore: duplicate id ${it.id}`);
    seen.add(it.id);
  }
  const sorted = items.slice().sort(rankOrderCompare);
  const ranks = new Map<string, number>();
  sorted.forEach((it, i) => ranks.set(it.id, i + 1));
  return ranks;
}

/** q = (N - rank) / (N - 1); null when N < 2. rank must be an integer in [1, N]. */
export function rankPercentile(rank: number, total: number): number | null {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`rankPercentile: bad total ${total}`);
  if (!Number.isInteger(rank) || rank < 1 || rank > total) {
    throw new RangeError(`rankPercentile: rank must be an integer in [1, ${total}], got ${rank}`);
  }
  if (total < 2) return null;
  return (total - rank) / (total - 1);
}

/** Rank percentile of every item within the whole list, keyed by id. */
export function percentilesByScore(items: readonly ScoredItem[]): Map<string, number | null> {
  const ranks = ranksByScore(items);
  const out = new Map<string, number | null>();
  for (const [id, rank] of ranks) out.set(id, rankPercentile(rank, items.length));
  return out;
}

/** Rank percentile of every item within its own category (display only), keyed by id; null for singleton categories. */
export function withinCategoryPercentiles(items: readonly CategorizedScoredItem[]): Map<string, number | null> {
  const byCategory = new Map<string, CategorizedScoredItem[]>();
  for (const it of items) {
    const list = byCategory.get(it.category);
    if (list) list.push(it);
    else byCategory.set(it.category, [it]);
  }
  const out = new Map<string, number | null>();
  const categories = Array.from(byCategory.keys()).sort(cmp);
  for (const category of categories) {
    const group = byCategory.get(category) ?? [];
    for (const [id, q] of percentilesByScore(group)) out.set(id, q);
  }
  return out;
}
