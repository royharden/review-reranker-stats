import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { countDays, dailyCounts, DAY_MS } from '../../src/core/burst/dailyCounts';
import { detectBursts } from '../../src/core/burst/detect';
import { holm, permutationShift } from '../../src/core/burst/permutation';
import { scanVolume } from '../../src/core/burst/robustZ';
import { mergeWindows, spanPriority, spanReviewsHash } from '../../src/core/burst/spans';
import type { VolumeWindow } from '../../src/core/burst/types';
import type { Review } from '../../src/core/types';
import { ASOF } from '../helpers';

const config = defaultConfig();
const candidate = (start: number, end: number, z = 4, itemId = 'i'): VolumeWindow => ({ itemId, spanStart: start, spanEnd: end, z, length: end - start + 1, count: 10, baselineWindows: 4, median: 1, mad: 0, scale: 1 });

describe('detector primitives', () => {
  it('merge overlapping or adjacent ranges transitively, retain every constituent, and use C17 total order', () => {
    const merged = mergeWindows([candidate(8, 8), candidate(3, 4), candidate(1, 2), candidate(2, 3), candidate(1, 1, 6, 'B'), candidate(1, 1, 6, 'a')]);
    expect(merged.map((s) => [s.itemId, s.spanStart, s.spanEnd])).toEqual([['B', 1, 1], ['a', 1, 1], ['i', 1, 4], ['i', 8, 8]]);
    expect(merged[2].windows).toHaveLength(3);
    expect(spanPriority({ ...merged[2], spanEnd: 3 }, merged[2])).toBeLessThan(0);
  });

  it('permutation p-values are seeded, two-sided, include ties and use the add-one bound', () => {
    const low = Array<number>(20).fill(1); const high = Array<number>(20).fill(5);
    const promo = permutationShift(high, low, 1000, 33, 'x', 1, 1);
    const bomb = permutationShift(low, high, 1000, 33, 'x', 1, 1);
    expect(promo).toEqual(permutationShift(high, low, 1000, 33, 'x', 1, 1));
    expect(promo.pValue).toBe(bomb.pValue);
    expect(promo.pValue).toBeGreaterThanOrEqual(1 / 1001);
    expect(promo.pValue).toBeLessThanOrEqual(0.002); // reachable even with five Holm hypotheses
    expect(permutationShift(high, high, 1000, 33, 'x', 1, 1).pValue).toBe(1);
  });

  it('Holm step-down uses the merged family, stops after a failure, and treats thin-reference slots conservatively', () => {
    expect(holm([0.001, 0.006, 0.007], 0.01).map((x) => x.rejected)).toEqual([true, false, false]);
    expect(holm([null, 0.001], 0.01).map((x) => x.rejected)).toEqual([false, true]);
    expect(holm([0.001, 0.001, 0.001, 0.001, 0.001], 0.01).every((x) => x.rejected)).toBe(true);
  });

  it('candidate windows end only on review days, include zero baseline counts, and require four full prior windows', async () => {
    const rows: Review[] = [0, 40].flatMap((day) => Array.from({ length: 20 }, (_, i): Review => ({ review_id: `${day}-${i}`, item_id: 'i', category: 'c', rating: 4, ts: (19000 + day) * DAY_MS, verified: true })));
    const ds = await buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const series = dailyCounts(ds, ds.items.get('i')!);
    expect(countDays(series, 19001, 19039)).toBe(0);
    const scan = scanVolume('i', series, config);
    expect(scan.unassessable).toBe(3); // the first review day has no history for any L
    expect(scan.candidates.length).toBeGreaterThan(0);
    for (const c of scan.candidates) {
      expect(series.days).toContain(c.spanEnd);
      expect(c.baselineWindows).toBeGreaterThanOrEqual(4);
      expect(c.median).toBe(0);
    }
    const early = scanVolume('i', series, { ...config, min_baseline_windows: 100 });
    expect(early.assessable).toBe(0);
  });

  it('per-item five-span cap retains the strongest spans and marks partial; thin reference has a named reason', async () => {
    const anchor = Math.floor(ASOF / DAY_MS);
    const rows: Review[] = [];
    // Sparse isolated large spikes, separated by > 90 days: each produces one component, every reference is thin.
    for (let k = 0; k < 8; k++) for (let j = 0; j < 40; j++) rows.push({ review_id: `${k}-${j}`, item_id: 'i', category: 'c', rating: 5, ts: (anchor - 1000 + k * 120) * DAY_MS, verified: true });
    const ds = await buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const result = await detectBursts(ds, config);
    expect(result.spans.length).toBeGreaterThan(5);
    expect(result.spans.filter((s) => s.reason !== 'item-cap')).toHaveLength(5);
    expect(result.spans.some((s) => s.status === 'not-tested' && s.reason === 'item-cap')).toBe(true);
    expect(result.spans.some((s) => s.status === 'unassessable' && s.reason === 'thin-reference')).toBe(true);
    expect(result.items[0].status).toBe('partial');
  });

  it('span reviewsHash uses sorted typed tuples and ignores text while a changed review invalidates it', async () => {
    const rows: Review[] = [{ review_id: 'r|x', item_id: 'i', category: 'c|x', rating: 4, ts: 19000 * DAY_MS, verified: true, text: 'untrusted' }];
    const ds = await buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const span = { itemId: 'i', spanStart: 19000, spanEnd: 19000 };
    const changedText = await buildDataset([{ ...rows[0], text: 'different' }], { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    expect(await spanReviewsHash(ds, span)).toBe(await spanReviewsHash(changedText, span));
    const changedRating = await buildDataset([{ ...rows[0], rating: 5 }], { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    expect(await spanReviewsHash(ds, span)).not.toBe(await spanReviewsHash(changedRating, span));
  });
});
