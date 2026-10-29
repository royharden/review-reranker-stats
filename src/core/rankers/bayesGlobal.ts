import { median } from '../stats/robust';
import { mean } from '../stats/weighted';
import type { Dataset, RankConfig } from '../types';
import { finalizeRanking } from './finalize';
import { baseParts } from './parts';
import type { Ranker } from './types';

export interface BayesGlobalFit { C: number | null; m: number | null }
export function fitBayesGlobal(dataset: Dataset, config: RankConfig): BayesGlobalFit {
  return {
    C: mean(dataset.reviews.map((r) => r.rating)) ?? null,
    m: config.bayes_m === 'median' ? median(Array.from(dataset.items.values(), (item) => item.n)) ?? null : config.bayes_m,
  };
}

export const bayesGlobalRanker: Ranker = {
  id: 'bayes_global', label: 'Bayes global (IMDb-style)', interval: { quantity: 'not-applicable', level: null },
  rank(dataset, config, ctx) {
    const { C, m } = fitBayesGlobal(dataset, config);
    if (C === null || m === null) return [];
    const out = Array.from(dataset.items.values(), (item) => {
      const parts = baseParts(dataset, item, ctx);
      const raw = parts.raw_mean ?? C;
      const score = (m * C + item.n * raw) / (m + item.n);
      parts.prior_mean = C;
      parts.prior_source = 'global';
      parts.shrink = m / (m + item.n);
      return { item_id: item.item_id, category: item.category, score, lo: null, hi: null, n: item.n, n_eff: item.n, parts };
    });
    return finalizeRanking(out, 'bayes_global');
  },
};
