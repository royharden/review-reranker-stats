import { mean } from '../stats/weighted';
import type { Dataset, ItemIndex, Parts } from '../types';
import type { RankContext } from './types';
import { flaggedSpanRefs, weightSummary } from './weights';

export function baseParts(dataset: Dataset, item: ItemIndex, ctx: RankContext): Parts {
  return {
    raw_mean: mean(item.reviewIdx.map((i) => dataset.reviews[i].rating)) ?? null,
    n: item.n, n_eff: item.n,
    prior_mean: null, prior_source: null, tau2: null, sigma2: null, sigma2_fallback: false,
    shrink: null, posterior_mean: null, lo: null, hi: null,
    interval: { quantity: 'not-applicable', level: null },
    weights: weightSummary(dataset, item.reviewIdx, null, { verified: false, recency: false, burst: false }),
    rank_by_method: {}, rank_without: { verified: null, recency: null, burst: null },
    flagged_spans: flaggedSpanRefs(ctx, item.item_id), within_category_percentile: null,
    insufficient: item.insufficient, detector_status: ctx.itemDetectorStatus?.get(item.item_id) ?? 'not-run',
  };
}
