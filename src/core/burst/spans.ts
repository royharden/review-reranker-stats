import { canonicalJson, cmp, sha256Hex } from '../stats/hash';
import type { Dataset } from '../types';
import { reviewsInDays } from './dailyCounts';
import type { BurstSpan, VolumeWindow } from './types';

/** C17 total order, used for per-item and dataset selection and queue order. */
export function spanPriority(a: Pick<BurstSpan, 'maxZ' | 'itemId' | 'spanStart' | 'spanEnd'>, b: Pick<BurstSpan, 'maxZ' | 'itemId' | 'spanStart' | 'spanEnd'>): number {
  return b.maxZ - a.maxZ || cmp(a.itemId, b.itemId) || a.spanStart - b.spanStart || a.spanEnd - b.spanEnd;
}

/** One connected component of overlapping or adjacent candidate ranges = one hypothesis. */
export function mergeWindows(windows: readonly VolumeWindow[]): BurstSpan[] {
  const sorted = windows.slice().sort((a, b) => cmp(a.itemId, b.itemId) || a.spanStart - b.spanStart || a.spanEnd - b.spanEnd || a.length - b.length);
  const spans: BurstSpan[] = [];
  for (const candidate of sorted) {
    const last = spans[spans.length - 1];
    if (last && last.itemId === candidate.itemId && candidate.spanStart <= last.spanEnd + 1) {
      last.spanEnd = Math.max(last.spanEnd, candidate.spanEnd);
      last.maxZ = Math.max(last.maxZ, candidate.z);
      last.windows.push(candidate);
    } else {
      spans.push({ itemId: candidate.itemId, spanStart: candidate.spanStart, spanEnd: candidate.spanEnd, maxZ: candidate.z, windows: [candidate],
        status: 'not-tested', reason: null, inSpanCount: 0, referenceCount: 0, meanInSpan: null, meanReference: null, shift: null,
        verifiedShare: null, pValue: null, holmThreshold: null });
    }
  }
  return spans.sort(spanPriority);
}

/** C6: typed tuples, code-unit ordering, no text and no delimiter ambiguity. M4 ruling replay uses this. */
export async function spanReviewsHash(dataset: Dataset, span: Pick<BurstSpan, 'itemId' | 'spanStart' | 'spanEnd'>): Promise<string> {
  const item = dataset.items.get(span.itemId);
  const rows = item ? reviewsInDays(dataset, item, span.spanStart, span.spanEnd) : [];
  rows.sort((a, b) => cmp(a.review_id, b.review_id));
  return sha256Hex(canonicalJson(rows.map((r) => [r.review_id, r.rating, r.ts, r.verified, r.category])));
}
