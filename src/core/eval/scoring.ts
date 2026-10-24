import { detectBursts, contextFromDetection } from '../burst/detect';
import type { DetectionResult } from '../burst/types';
import { fitBayesGlobal } from '../rankers/bayesGlobal';
import { registeredRankers, getRanker } from '../rankers/registry';
import type { RankContext } from '../rankers/types';
import { cmp } from '../stats/hash';
import type { Dataset, RankConfig, RankResult } from '../types';
import type { Cutoffs } from './split';
import type { EvalMethod, MethodPrior, PriorSnapshot } from './schema';

export type Rankings = ReadonlyMap<EvalMethod, readonly RankResult[]>;
export interface ScoredCatalogue { rankings: Rankings; detection: DetectionResult; context: RankContext; priors: PriorSnapshot }
/** Fits every method on the complete pre-cutoff catalogue. Selection of scoring items happens AFTER this call. */
export async function scoreCatalogue(pre: Dataset, config: RankConfig, cutoffs: Cutoffs): Promise<ScoredCatalogue> {
  const times = new Map(Object.entries(cutoffs));
  const detection = await detectBursts(pre, config, times);
  const context = { ...contextFromDetection(pre, detection, config), asOfByCategory: times };
  const rankings = new Map<EvalMethod, RankResult[]>();
  for (const ranker of registeredRankers()) rankings.set(ranker.id, ranker.rank(pre, config, context));
  const full = getRanker('full');
  if (!full) throw new Error('Missing full ranker');
  for (const key of ['posterior_mean', 'lower_endpoint'] as const) {
    rankings.set(key === 'posterior_mean' ? 'full:posterior_mean' : 'full:lower_endpoint', full.rank(pre, { ...config, rank_key: key }, context));
  }
  return { rankings, detection, context, priors: snapshotPriors(pre, config, rankings) };
}
export function snapshotPriors(pre: Dataset, config: RankConfig, rankings: Rankings): PriorSnapshot {
  const bayes = fitBayesGlobal(pre, config);
  const methods: MethodPrior[] = [];
  for (const [method, rows] of rankings) {
    const categories = new Map<string, MethodPrior['categories'][number]>();
    for (const row of rows) {
      const p = row.parts;
      if (p.prior_mean !== null && p.tau2 !== null && p.prior_source !== null) categories.set(row.category,
        { category: row.category, mean: p.prior_mean, tau2: p.tau2, source: p.prior_source });
    }
    const first = rows[0];
    methods.push({ method, C: method === 'bayes_global' ? bayes.C : null,
      m: method === 'bayes_global' ? bayes.m : null, sigma2: first?.parts.sigma2 ?? null,
      sigma2Fallback: first?.parts.sigma2_fallback ?? false, categories: Array.from(categories.values()).sort((a, b) => cmp(a.category, b.category)) });
  }
  return { datasetHash: pre.datasetHash, itemCount: pre.items.size, reviewCount: pre.reviews.length, methods };
}
export function restrictRankings(rankings: Rankings, ids: ReadonlySet<string>): Rankings {
  return new Map(Array.from(rankings, ([method, rows]) => [method, rows.filter((r) => ids.has(r.item_id))]));
}
