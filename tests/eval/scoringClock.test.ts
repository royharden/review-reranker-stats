// UNRUN: category-specific scoring seam and detector provenance regression.
import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/core/data/dataset';
import { defaultConfig } from '../../src/core/config';
import { detectBursts } from '../../src/core/burst/detect';
import { reviewWeights } from '../../src/core/rankers/weights';
import { emptyRankContext } from '../../src/core/rankers/types';
import type { Review } from '../../src/core/types';

const DAY = 86_400_000;
describe('category-specific evaluation scoring time (UNRUN)', () => {
  it('uses each category cutoff for recency and item age, records it in provenance, and leaves default callers unchanged', async () => {
    const start = Date.UTC(2023, 0, 1); const asOf = start + 100 * DAY;
    const reviews: Review[] = ['early', 'late'].flatMap((category) => Array.from({ length: 30 }, (_, i) => ({
      review_id: category + i, item_id: category, category, rating: 4 as const, ts: start + i * DAY / 100, verified: true,
    })));
    const dataset = await buildDataset(reviews, { asOf, verifiedColumnPresent: true, insufficientBelow: 3 });
    const config = { ...defaultConfig(), half_life_days: 10 };
    const times = new Map([['early', start + 10 * DAY], ['late', start + 100 * DAY]]);
    const recencyOnly = { verified: false, recency: true, burst: false };
    const mapped = reviewWeights(dataset, config, { ...emptyRankContext(), asOfByCategory: times }, recencyOnly);
    const fallback = reviewWeights(dataset, config, emptyRankContext(), recencyOnly);
    const i = dataset.reviews.findIndex((r) => r.review_id === 'early0');
    expect(mapped.weights[i]).toBeCloseTo(0.5); expect(fallback.weights[i]).toBeCloseTo(2 ** -10);
    const detected = await detectBursts(dataset, config, times); const original = await detectBursts(dataset, config);
    expect(detected.items.find((item) => item.itemId === 'early')?.reasons).toContain('too-young');
    expect(original.items.find((item) => item.itemId === 'early')?.reasons).not.toContain('too-young');
    expect(detected.detectorConfigHash).not.toBe(original.detectorConfigHash);
    expect((await detectBursts(dataset, config)).detectorConfigHash).toBe(original.detectorConfigHash);
  });
});
