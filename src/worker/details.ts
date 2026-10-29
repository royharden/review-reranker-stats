// Compact chart DTOs: no review ids, free text or accepted CSV rows cross to UI/storage.
import { DAY_MS } from '../core/burst/dailyCounts';
import { explain } from '../core/explain/templates';
import type { Dataset, ItemIndex, MethodId, RankResult } from '../core/types';

export interface TimelineBin { startDay: number; endDay: number; count: number; rollingMean: number | null }
export interface ItemDetail { itemId: string; bins: TimelineBin[]; binDays: number; explanations: Partial<Record<MethodId, string>> }
export function itemTimeline(dataset: Dataset, item: ItemIndex): Pick<ItemDetail, 'bins' | 'binDays'> {
  const first = Math.floor(item.firstTs / DAY_MS);
  const last = Math.floor(item.lastTs / DAY_MS);
  const binDays = Math.max(1, Math.ceil((last - first + 1) / 160));
  const bins: TimelineBin[] = [];
  let pos = 0; let left = 0; let rollingSum = 0;
  // Bounded at 160 buckets regardless of elapsed time, with exact count conservation.
  for (let startDay = first; startDay <= last; startDay += binDays) {
    const endDay = Math.min(last, startDay + binDays - 1);
    let count = 0;
    while (pos < item.reviewIdx.length) {
      const r = dataset.reviews[item.reviewIdx[pos]];
      if (Math.floor(r.ts / DAY_MS) > endDay) break;
      rollingSum += r.rating; count++; pos++;
    }
    while (left < pos && Math.floor(dataset.reviews[item.reviewIdx[left]].ts / DAY_MS) < endDay - 6) {
      rollingSum -= dataset.reviews[item.reviewIdx[left]].rating; left++;
    }
    bins.push({ startDay, endDay, count, rollingMean: pos > left ? rollingSum / (pos - left) : null });
  }
  return { bins, binDays };
}
export function buildItemDetails(dataset: Dataset, rankings: Partial<Record<MethodId, RankResult[]>>, methods: readonly MethodId[]): ItemDetail[] {
  const byItem = new Map<string, ItemDetail>();
  for (const item of dataset.items.values()) byItem.set(item.item_id, { itemId: item.item_id, ...itemTimeline(dataset, item), explanations: {} });
  for (const method of methods) for (const result of rankings[method] ?? []) {
    const detail = byItem.get(result.item_id);
    if (detail) detail.explanations[method] = explain(result.parts);
  }
  return [...byItem.values()];
}
