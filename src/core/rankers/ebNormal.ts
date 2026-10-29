// Frozen one-step normal-normal EB (CL 2.5, PLAN C2/C3). Reliability weights, not frequency weights.
import { normalQuantile } from '../stats/quantile';
import { weightedSummary } from '../stats/weighted';
import type { WeightedSummary } from '../stats/weighted';
import type { Dataset, ItemIndex, MethodId, RankConfig, RankResult } from '../types';
import { finalizeRanking } from './finalize';
import { baseParts } from './parts';
import { rankKeyScore } from './rankKey';
import type { RankContext, Ranker } from './types';
import { reviewWeights, weightSummary } from './weights';
import type { ReviewWeights, WeightFactors } from './weights';

export interface EbItemSummary { item: ItemIndex; summary: WeightedSummary; mean: number; v: number }
export interface EbPrior { mean: number; tau2: number; itemCount: number }
export interface EbFit {
  sigma2: number;
  sigma2Fallback: boolean;
  global: EbPrior | null;
  categories: Map<string, EbPrior>;
  items: EbItemSummary[];
  weights: ReviewWeights | null;
}

/** One-step method of moments, then marginal-precision mean 1/(tau2 + v), not 1/v. */
export function fitPrior(items: readonly EbItemSummary[], tau2Floor: number): EbPrior | null {
  if (items.length === 0) return null;
  const average = items.reduce((sum, x) => sum + x.mean, 0) / items.length;
  let spread = 0;
  let sampling = 0;
  for (const x of items) { spread += (x.mean - average) ** 2; sampling += x.v; }
  const tau2 = items.length < 2 ? tau2Floor : Math.max(tau2Floor, spread / (items.length - 1) - sampling / items.length);
  let precision = 0;
  let weighted = 0;
  for (const x of items) { const a = 1 / (tau2 + x.v); precision += a; weighted += a * x.mean; }
  return { mean: weighted / precision, tau2, itemCount: items.length };
}

export function fitEmpiricalBayes(dataset: Dataset, config: RankConfig, ctx: RankContext, factors: WeightFactors | null = null): EbFit {
  const weights = factors === null ? null : reviewWeights(dataset, config, ctx, factors);
  const items: EbItemSummary[] = [];
  let ss = 0;
  let d = 0;
  for (const item of dataset.items.values()) {
    const summary = weightedSummary(item.reviewIdx.map((i) => dataset.reviews[i].rating), item.reviewIdx.map((i) => weights?.weights[i] ?? 1));
    if (summary.mean === undefined) throw new Error('Dataset item has no accepted reviews');
    items.push({ item, summary, mean: summary.mean, v: 0 });
    if (summary.n_eff > 1 && summary.d > 0) { ss += summary.ss; d += summary.d; }
  }
  const sigma2Fallback = d <= 0;
  const sigma2 = sigma2Fallback ? config.sigma2_no_info : Math.max(config.sigma2_floor, ss / d);
  const groups = new Map<string, EbItemSummary[]>();
  for (const x of items) {
    x.v = sigma2 / x.summary.n_eff;
    const group = groups.get(x.item.category);
    if (group) group.push(x); else groups.set(x.item.category, [x]);
  }
  const categories = new Map<string, EbPrior>();
  for (const [category, group] of groups) {
    const prior = fitPrior(group, config.tau2_floor);
    if (prior !== null) categories.set(category, prior);
  }
  return { sigma2, sigma2Fallback, global: fitPrior(items, config.tau2_floor), categories, items, weights };
}

export function rankEmpiricalBayes(dataset: Dataset, config: RankConfig, ctx: RankContext, method: MethodId, grouping: 'category' | 'global', factors: WeightFactors | null = null): RankResult[] {
  const fit = fitEmpiricalBayes(dataset, config, ctx, factors);
  const global = fit.global;
  if (global === null) return [];
  const z = normalQuantile(1 - (1 - config.interval_level) / 2);
  const out: RankResult[] = [];
  for (const x of fit.items) {
    const category = fit.categories.get(x.item.category);
    const useCategory = grouping === 'category' && category !== undefined && category.itemCount >= config.min_category_items;
    const prior = useCategory ? category : global;
    const shrink = x.v / (x.v + prior.tau2);
    const posterior = shrink * prior.mean + (1 - shrink) * x.mean;
    const variance = prior.tau2 * x.v / (prior.tau2 + x.v);
    const lo = Math.max(1, posterior - z * Math.sqrt(variance));
    const hi = Math.min(5, posterior + z * Math.sqrt(variance));
    const parts = baseParts(dataset, x.item, ctx);
    parts.n_eff = x.summary.n_eff;
    parts.prior_mean = prior.mean;
    parts.prior_source = grouping === 'global' ? 'global' : useCategory ? 'category' : 'global-fallback';
    parts.tau2 = prior.tau2; parts.sigma2 = fit.sigma2; parts.sigma2_fallback = fit.sigma2Fallback;
    parts.shrink = shrink; parts.posterior_mean = posterior; parts.lo = lo; parts.hi = hi;
    parts.interval = { quantity: 'mean stars', level: config.interval_level, approx: 'normal' };
    if (fit.weights !== null && factors !== null) parts.weights = weightSummary(dataset, x.item.reviewIdx, fit.weights, factors);
    out.push({ item_id: x.item.item_id, category: x.item.category, score: rankKeyScore(posterior, lo, config.rank_key), lo, hi, n: x.item.n, n_eff: x.summary.n_eff, parts });
  }
  return finalizeRanking(out, method);
}

export const ebCategoryRanker: Ranker = {
  id: 'eb_category', label: 'EB category', interval: { quantity: 'mean stars', level: 0.9, approx: 'normal' },
  rank: (dataset, config, ctx) => rankEmpiricalBayes(dataset, config, ctx, 'eb_category', 'category'),
};
export const ebGlobalRanker: Ranker = {
  id: 'eb_global', label: 'EB global', interval: { quantity: 'mean stars', level: 0.9, approx: 'normal' },
  rank: (dataset, config, ctx) => rankEmpiricalBayes(dataset, config, ctx, 'eb_global', 'global'),
};
