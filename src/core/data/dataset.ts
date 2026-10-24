// Dataset index (CL §2.4): canonical review order, per-item index, sorted categories, datasetHash.
//
// Order independence: reviews are stored sorted by review_id (code unit), items in item_id order, each item's
// reviewIdx sorted by (ts asc, review_id asc). Two inputs with the same accepted reviews give identical Datasets.

import { cmp } from '../stats/hash';
import type { Dataset, ItemIndex, Review } from '../types';
import { datasetHash } from './hash';

export interface BuildDatasetOptions {
  asOf: number;
  verifiedColumnPresent: boolean;
  /** Items with fewer accepted reviews than this are labelled insufficient (spec: 3). */
  insufficientBelow: number;
}

export async function buildDataset(accepted: readonly Review[], options: BuildDatasetOptions): Promise<Dataset> {
  const reviews = accepted.slice().sort((a, b) => cmp(a.review_id, b.review_id));

  const byItem = new Map<string, number[]>();
  const categoryOf = new Map<string, string>();
  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i];
    const list = byItem.get(r.item_id);
    if (list) list.push(i);
    else {
      byItem.set(r.item_id, [i]);
      categoryOf.set(r.item_id, r.category);
    }
  }

  const itemIds = Array.from(byItem.keys()).sort(cmp);
  const items = new Map<string, ItemIndex>();
  const categories = new Set<string>();
  for (const itemId of itemIds) {
    const idx = byItem.get(itemId) ?? [];
    idx.sort((a, b) => {
      const ra = reviews[a];
      const rb = reviews[b];
      if (ra.ts !== rb.ts) return ra.ts < rb.ts ? -1 : 1;
      return cmp(ra.review_id, rb.review_id);
    });
    const category = categoryOf.get(itemId) ?? '';
    categories.add(category);
    items.set(itemId, {
      item_id: itemId,
      category,
      reviewIdx: idx,
      n: idx.length,
      insufficient: idx.length < options.insufficientBelow,
      firstTs: reviews[idx[0]].ts,
      lastTs: reviews[idx[idx.length - 1]].ts,
    });
  }

  return {
    reviews,
    items,
    categories: Array.from(categories).sort(cmp),
    asOf: options.asOf,
    datasetHash: await datasetHash(reviews),
    verifiedColumnPresent: options.verifiedColumnPresent,
  };
}

/** Ratings of one item in its canonical (ts, review_id) order. */
export function itemRatings(dataset: Dataset, item: ItemIndex): number[] {
  return item.reviewIdx.map((i) => dataset.reviews[i].rating);
}
