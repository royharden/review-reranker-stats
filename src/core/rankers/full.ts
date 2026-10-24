import { rankEmpiricalBayes } from './ebNormal';
import type { Ranker } from './types';
import { ALL_FACTORS } from './weights';

export const fullRanker: Ranker = {
  id: 'full', label: 'Full weighted EB', interval: { quantity: 'mean stars', level: 0.9, approx: 'normal' },
  rank: (dataset, config, ctx) => rankEmpiricalBayes(dataset, config, ctx, 'full', 'category', ALL_FACTORS),
};
