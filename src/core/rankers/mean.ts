// `mean` baseline (CL §2.5 with PLAN C4): score = the item's unweighted mean star rating. Descriptive only, so it
// claims no interval: lo = hi = null and the UI shows "—".

import { mean } from '../stats/weighted';
import type { Dataset, IntervalMeta, Parts, RankConfig, RankResult } from '../types';
import { finalizeRanking } from './finalize';
import type { RankContext, Ranker } from './types';

const NO_INTERVAL: IntervalMeta = { quantity: 'not-applicable', level: null };

function verifiedShare(dataset: Dataset, reviewIdx: readonly number[]): number | null {
  let known = 0;
  let verified = 0;
  for (const i of reviewIdx) {
    const v = dataset.reviews[i].verified;
    if (v !== null) {
      known++;
      if (v) verified++;
    }
  }
  return known === 0 ? null : verified / known;
}

function rankMean(dataset: Dataset, _config: RankConfig, ctx: RankContext): RankResult[] {
  const results: RankResult[] = [];
  for (const item of dataset.items.values()) {
    const ratings = item.reviewIdx.map((i) => dataset.reviews[i].rating);
    // Items exist only because they have >= 1 accepted review, so the mean is defined.
    const raw = mean(ratings) ?? Number.NaN;
    const parts: Parts = {
      raw_mean: raw,
      n: item.n,
      n_eff: item.n,
      prior_mean: null,
      prior_source: null,
      tau2: null,
      sigma2: null,
      sigma2_fallback: false,
      shrink: null,
      posterior_mean: null,
      lo: null,
      hi: null,
      interval: NO_INTERVAL,
      weights: {
        verified_share: verifiedShare(dataset, item.reviewIdx),
        mean_recency: null,
        burst_downweighted_count: 0,
        recency_floor_clamps: 0,
        product_floor_clamps: 0,
      },
      rank_by_method: {},
      rank_without: { verified: null, recency: null, burst: null },
      flagged_spans: [],
      within_category_percentile: null,
      insufficient: item.insufficient,
      detector_status: ctx.itemDetectorStatus?.get(item.item_id) ?? 'not-run',
    };
    results.push({
      item_id: item.item_id,
      category: item.category,
      score: raw,
      lo: null,
      hi: null,
      n: item.n,
      n_eff: item.n,
      parts,
    });
  }
  return finalizeRanking(results, 'mean');
}

export const meanRanker: Ranker = {
  id: 'mean',
  label: 'Mean stars (raw)',
  interval: NO_INTERVAL,
  rank: rankMean,
};
