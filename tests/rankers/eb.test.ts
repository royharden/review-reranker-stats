import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { fitEmpiricalBayes, fitPrior, ebCategoryRanker, ebGlobalRanker } from '../../src/core/rankers/ebNormal';
import type { EbItemSummary } from '../../src/core/rankers/ebNormal';
import { registeredRankers } from '../../src/core/rankers/registry';
import { emptyRankContext } from '../../src/core/rankers/types';
import { buildTraps } from '../../src/core/synth/traps';
import type { MethodId, Rating, Review } from '../../src/core/types';
import { ASOF } from '../helpers';

const config = defaultConfig();
const ctx = emptyRankContext();
const traps = buildTraps(ASOF, 33);
const ds = () => buildDataset(traps.reviews, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
const review = (id: string, item: string, rating: Rating, category = 'small'): Review => ({ review_id: id, item_id: item, category, rating, ts: ASOF - 1000, verified: true });

describe('EB frozen estimator (CL 2.5, C2/C3)', () => {
  it('uses sigma2_floor for estimated variance and sigma2_no_info = 1 for all singletons', async () => {
    const constant = await buildDataset([review('1', 'a', 4), review('2', 'a', 4), review('3', 'b', 4)], { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const fit = fitEmpiricalBayes(constant, config, ctx);
    expect(fit.sigma2).toBe(0.05);
    expect(fit.sigma2Fallback).toBe(false);
    const singletons = await buildDataset([review('1', 'a', 3), review('2', 'b', 5)], { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const noInfo = fitEmpiricalBayes(singletons, config, ctx);
    expect(noInfo.sigma2).toBe(1);
    expect(noInfo.sigma2Fallback).toBe(true);
    expect(noInfo.items.map((x) => x.v)).toEqual([1, 1]);
  });

  it('one-step tau2 and marginal-precision prior use 1/(tau2 + v), not 1/v', () => {
    const item = { item_id: 'x', category: 'c', reviewIdx: [0], n: 1, insufficient: true, firstTs: 0, lastTs: 0 };
    const summary = { s1: 1, s2: 1, n_eff: 1, mean: 0, ss: 0, d: 0 };
    const xs: EbItemSummary[] = [{ item, summary, mean: 2, v: 0.5 }, { item: { ...item, item_id: 'y' }, summary, mean: 4, v: 1.5 }];
    // Sample between-item variance = 2; average sampling variance = 1; tau2 = 1.
    // Precisions = 2/3 and 2/5; mu = (4/3 + 8/5)/(2/3 + 2/5) = 2.75.
    const prior = fitPrior(xs, 0.01)!;
    expect(prior.mean).toBeCloseTo(2.75, 12);
    expect(prior.tau2).toBe(1);
    expect(prior.itemCount).toBe(2);
  });

  it('category < 20 items uses a named global-fallback, with finite all-identical and singleton outputs', async () => {
    for (const rows of [[review('1', 'a', 5)], [review('1', 'a', 4), review('2', 'a', 4), review('3', 'b', 4)]]) {
      const dataset = await buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
      const result = ebCategoryRanker.rank(dataset, config, ctx);
      for (const row of result) {
        expect(row.parts.prior_source).toBe('global-fallback');
        expect(row.parts.tau2).toBe(0.01);
        for (const value of [row.score, row.lo, row.hi, row.parts.prior_mean]) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('named ranking traps and every registered interface', () => {
  it('tiny_perfect: B above A for mean, below A for bayes_global/wilson/eb_category/eb_global/full', async () => {
    const dataset = await ds();
    const ids = traps.meta.find((m) => m.name === 'tiny_perfect')!.roles;
    for (const ranker of registeredRankers()) {
      if (!(['mean', 'bayes_global', 'wilson', 'eb_category', 'eb_global', 'full'] as MethodId[]).includes(ranker.id)) continue;
      const result = ranker.rank(dataset, config, ctx);
      const a = result.findIndex((r) => r.item_id === ids.A);
      const b = result.findIndex((r) => r.item_id === ids.B);
      if (ranker.id === 'mean') expect(b).toBeLessThan(a); else expect(b).toBeGreaterThan(a);
    }
  });

  it('category_gap: category posteriors differ; global EB and bayes_global estimates are identical', async () => {
    const dataset = await ds();
    const ids = traps.meta.find((m) => m.name === 'category_gap')!.roles;
    for (const ranker of registeredRankers().filter((r) => ['eb_category', 'eb_global', 'bayes_global'].includes(r.id))) {
      const result = ranker.rank(dataset, config, ctx);
      const x = result.find((r) => r.item_id === ids.X)!;
      const y = result.find((r) => r.item_id === ids.Y)!;
      if (ranker.id === 'eb_category') expect(x.score).toBeLessThan(y.score); else expect(x.score).toBe(y.score);
    }
  });

  it('every registered ranker conforms: all items, finite scores, matching interval units, no invented baseline intervals', async () => {
    const dataset = await ds();
    expect(registeredRankers()).toHaveLength(9);
    for (const ranker of registeredRankers()) {
      const result = ranker.rank(dataset, config, ctx);
      expect(result).toHaveLength(dataset.items.size);
      for (const row of result) {
        expect(Number.isFinite(row.score)).toBe(true);
        expect(row.n).toBe(dataset.items.get(row.item_id)!.n);
        expect(row.parts.interval.quantity).toBe(ranker.interval.quantity);
        expect(row.parts.n_eff).toBeGreaterThan(0);
        if (ranker.id === 'mean' || ranker.id === 'bayes_global') { expect(row.lo).toBeNull(); expect(row.hi).toBeNull(); }
        else { expect(Number.isFinite(row.lo)).toBe(true); expect(Number.isFinite(row.hi)).toBe(true); }
      }
      expect(ranker.rank(await buildDataset([], { asOf: ASOF, verifiedColumnPresent: false, insufficientBelow: 3 }), config, ctx)).toEqual([]);
    }
  });

  it('posterior-mean vs lower-endpoint rank key selects matching absolute-star values', async () => {
    const dataset = await ds();
    const posterior = ebGlobalRanker.rank(dataset, config, ctx);
    const lower = ebGlobalRanker.rank(dataset, { ...config, rank_key: 'lower_endpoint' }, ctx);
    for (const row of posterior) expect(row.score).toBe(row.parts.posterior_mean);
    for (const row of lower) expect(row.score).toBe(row.lo);
    expect(new Map(lower.map((r) => [r.item_id, r.parts.posterior_mean]))).toEqual(new Map(posterior.map((r) => [r.item_id, r.parts.posterior_mean])));
  });
});
