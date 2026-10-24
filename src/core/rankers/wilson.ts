import { normalQuantile } from '../stats/quantile';
import { wilsonInterval } from '../stats/wilson';
import { finalizeRanking } from './finalize';
import { baseParts } from './parts';
import type { Ranker } from './types';

export const wilsonRanker: Ranker = {
  id: 'wilson', label: 'Wilson lower endpoint',
  interval: { quantity: 'top-box share', level: 0.9, approx: 'wilson-score' },
  rank(dataset, config, ctx) {
    const z = normalQuantile(1 - (1 - config.interval_level) / 2);
    const out = Array.from(dataset.items.values(), (item) => {
      let successes = 0;
      for (const i of item.reviewIdx) if (dataset.reviews[i].rating >= config.wilson_threshold) successes++;
      const { lo, hi } = wilsonInterval(successes, item.n, z);
      const parts = baseParts(dataset, item, ctx);
      parts.lo = lo; parts.hi = hi;
      parts.interval = { quantity: 'top-box share', level: config.interval_level, approx: 'wilson-score' };
      return { item_id: item.item_id, category: item.category, score: lo, lo, hi, n: item.n, n_eff: item.n, parts };
    });
    return finalizeRanking(out, 'wilson');
  },
};
