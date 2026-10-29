import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { ablationRankers, annotateRankings } from '../../src/core/rankers/ablations';
import { fullRanker } from '../../src/core/rankers/full';
import { emptyRankContext } from '../../src/core/rankers/types';
import { ALL_FACTORS, burstWeightsForSpans, reviewWeights } from '../../src/core/rankers/weights';
import { buildTraps } from '../../src/core/synth/traps';
import type { MethodId, RankResult, Review } from '../../src/core/types';
import { ASOF } from '../helpers';

const config = defaultConfig();
const DAY = 86_400_000;

describe('positive weights and ablations', () => {
  it('extreme age / tiny half-life keep recency and final product >= 1e-12, recording both clamps in parts', async () => {
    const rows: Review[] = [{ review_id: 'r1', item_id: 'x', category: 'c', rating: 5, ts: 0, verified: false }];
    const dataset = await buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const ctx = { ...emptyRankContext(), reviewBurstWeight: [0.25] };
    const cfg = { ...config, half_life_days: 1e-300 };
    expect(reviewWeights(dataset, cfg, ctx, ALL_FACTORS).weights).toEqual([1e-12]);
    const parts = fullRanker.rank(dataset, cfg, ctx)[0].parts;
    expect(parts.weights.recency_floor_clamps).toBe(1);
    expect(parts.weights.product_floor_clamps).toBe(1);
    expect(parts.n).toBe(1);
    expect(parts.n_eff).toBeCloseTo(1, 12);
  });

  it('overlapping spans take minimum once; partial restore preserves the other active span', async () => {
    const day = Math.floor(ASOF / DAY) - 10;
    const rows: Review[] = [0, 1, 2].map((n) => ({ review_id: `r${n}`, item_id: 'x', category: 'c', rating: 4, ts: (day + n) * DAY, verified: true }));
    const dataset = await buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const spans = [{ itemId: 'x', spanStart: day, spanEnd: day + 1, weight: 0.25 }, { itemId: 'x', spanStart: day + 1, spanEnd: day + 2, weight: 0.25 }];
    expect(burstWeightsForSpans(dataset, spans)).toEqual([0.25, 0.25, 0.25]);
    expect(burstWeightsForSpans(dataset, [{ ...spans[0], weight: 1 }, spans[1]])).toEqual([1, 0.25, 0.25]);
  });

  it('unknown verified means weight 1; invalid weights / half-life / asOf are rejected', async () => {
    const dataset = await buildDataset([{ review_id: 'r', item_id: 'x', category: 'c', rating: 4, ts: ASOF, verified: null }], { asOf: ASOF, verifiedColumnPresent: false, insufficientBelow: 3 });
    expect(reviewWeights(dataset, config, emptyRankContext(), ALL_FACTORS).weights).toEqual([1]);
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(() => reviewWeights(dataset, { ...config, half_life_days: bad }, emptyRankContext(), ALL_FACTORS)).toThrow();
      expect(() => reviewWeights(dataset, { ...config, unverified_weight: bad }, emptyRankContext(), ALL_FACTORS)).toThrow();
    }
    expect(() => reviewWeights({ ...dataset, asOf: Infinity }, config, emptyRankContext(), ALL_FACTORS)).toThrow();
  });

  it('quality_drift: recency helps the improved item and hurts its stable sparse control', async () => {
    const traps = buildTraps(ASOF, 33);
    const m = traps.meta.find((x) => x.name === 'quality_drift')!;
    const dataset = await buildDataset(traps.reviews, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const withRecency = fullRanker.rank(dataset, config, emptyRankContext());
    const without = ablationRankers.find((r) => r.id === 'full-recency')!.rank(dataset, config, emptyRankContext());
    const estimate = (rows: RankResult[], id: string) => rows.find((r) => r.item_id === id)!.parts.posterior_mean!;
    expect(estimate(withRecency, m.roles.drift)).toBeGreaterThan(estimate(without, m.roles.drift));
    expect(Math.abs(estimate(withRecency, m.roles.drift) - m.target_expected_mean!)).toBeLessThan(Math.abs(estimate(without, m.roles.drift) - m.target_expected_mean!));
    expect(estimate(withRecency, m.roles.stable_sparse)).toBeLessThan(estimate(without, m.roles.stable_sparse));
    const rankings: Partial<Record<MethodId, RankResult[]>> = { full: withRecency, 'full-recency': without };
    annotateRankings(rankings);
    expect(withRecency[0].parts.rank_without.recency).toBe(without.findIndex((r) => r.item_id === withRecency[0].item_id) + 1);
  });
});
