// Sparse UTC day counts. Space follows review days, never elapsed calendar time.
import type { Dataset, ItemIndex, Review } from '../types';

export const DAY_MS = 86_400_000;
export interface DailyCounts { days: number[]; counts: number[]; prefix: number[] }
export function lowerBound(values: readonly number[], target: number): number {
  let lo = 0; let hi = values.length;
  while (lo < hi) { const mid = lo + Math.floor((hi - lo) / 2); if (values[mid] < target) lo = mid + 1; else hi = mid; }
  return lo;
}
export function dailyCounts(dataset: Dataset, item: ItemIndex): DailyCounts {
  const days: number[] = []; const counts: number[] = [];
  for (const i of item.reviewIdx) {
    const day = Math.floor(dataset.reviews[i].ts / DAY_MS);
    if (days.length > 0 && days[days.length - 1] === day) counts[counts.length - 1]++;
    else { days.push(day); counts.push(1); }
  }
  const prefix = [0];
  for (const count of counts) prefix.push(prefix[prefix.length - 1] + count);
  return { days, counts, prefix };
}
export function countDays(series: DailyCounts, start: number, end: number): number {
  return series.prefix[lowerBound(series.days, end + 1)] - series.prefix[lowerBound(series.days, start)];
}

/** Item indices are already sorted by (timestamp, review id); only the selected range is materialised. */
export function reviewsInDays(dataset: Dataset, item: ItemIndex, start: number, end: number): Review[] {
  const boundary = (day: number): number => {
    let lo = 0; let hi = item.reviewIdx.length;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (Math.floor(dataset.reviews[item.reviewIdx[mid]].ts / DAY_MS) < day) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  return item.reviewIdx.slice(boundary(start), boundary(end + 1)).map((i) => dataset.reviews[i]);
}
