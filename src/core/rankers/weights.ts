// Positive review weights (PLAN C16). Evidence changes influence, never membership in the dataset.
import type { Dataset, FlaggedSpanRef, RankConfig, WeightSummary } from '../types';
import type { RankContext } from './types';

const DAY_MS = 86_400_000;
export interface WeightFactors { verified: boolean; recency: boolean; burst: boolean }
export const ALL_FACTORS: WeightFactors = { verified: true, recency: true, burst: true };
export interface ReviewWeights {
  weights: number[];
  recency: number[];
  burst: number[];
  recencyClamped: boolean[];
  productClamped: boolean[];
}

function checkWeight(value: number, field: string): void {
  if (!(Number.isFinite(value) && value > 0 && value <= 1)) throw new RangeError(`${field} must be finite in (0, 1]`);
}

export interface ActiveSpanWeight {
  itemId: string;
  spanStart: number;
  spanEnd: number;
  weight: number;
}

/** Rebuild from active spans after each ruling replay: the minimum applies once, even for overlaps. */
export function burstWeightsForSpans(dataset: Dataset, spans: readonly ActiveSpanWeight[]): number[] {
  const weights = dataset.reviews.map(() => 1);
  for (const span of spans) {
    checkWeight(span.weight, 'span weight');
    const item = dataset.items.get(span.itemId);
    if (!item) continue;
    for (const i of item.reviewIdx) {
      const day = Math.floor(dataset.reviews[i].ts / DAY_MS);
      if (day >= span.spanStart && day <= span.spanEnd) weights[i] = Math.min(weights[i], span.weight);
    }
  }
  return weights;
}

export function reviewWeights(dataset: Dataset, config: RankConfig, ctx: RankContext, factors: WeightFactors): ReviewWeights {
  checkWeight(config.unverified_weight, 'unverified_weight');
  checkWeight(config.weight_floor, 'weight_floor');
  checkWeight(config.burst_weight, 'burst_weight');
  if (!(Number.isFinite(config.half_life_days) && config.half_life_days > 0)) throw new RangeError('half_life_days must be finite and > 0');
  if (!Number.isFinite(dataset.asOf)) throw new RangeError('asOf must be finite');
  if (ctx.reviewBurstWeight !== null && ctx.reviewBurstWeight.length !== dataset.reviews.length) throw new RangeError('burst weight length mismatch');
  const out: ReviewWeights = { weights: [], recency: [], burst: [], recencyClamped: [], productClamped: [] };
  dataset.reviews.forEach((r, i) => {
    const verified = factors.verified && r.verified === false ? config.unverified_weight : 1;
    const age = Math.max(0, (dataset.asOf - r.ts) / DAY_MS);
    const rawRecency = factors.recency ? Math.pow(0.5, age / config.half_life_days) : 1;
    const recency = Math.max(config.weight_floor, rawRecency);
    const burst = factors.burst ? ctx.reviewBurstWeight?.[i] ?? 1 : 1;
    checkWeight(burst, 'review burst weight');
    const product = verified * recency * burst;
    out.weights.push(Math.max(config.weight_floor, product));
    out.recency.push(recency);
    out.burst.push(burst);
    out.recencyClamped.push(rawRecency < config.weight_floor);
    out.productClamped.push(product < config.weight_floor);
  });
  return out;
}

export function weightSummary(dataset: Dataset, idx: readonly number[], weights: ReviewWeights | null, factors: WeightFactors): WeightSummary {
  let known = 0;
  let verified = 0;
  let recency = 0;
  let downweighted = 0;
  let recencyClamps = 0;
  let productClamps = 0;
  for (const i of idx) {
    const flag = dataset.reviews[i].verified;
    if (flag !== null) { known++; if (flag) verified++; }
    if (weights !== null) {
      recency += weights.recency[i];
      if (weights.burst[i] < 1) downweighted++;
      if (weights.recencyClamped[i]) recencyClamps++;
      if (weights.productClamped[i]) productClamps++;
    }
  }
  return {
    verified_share: known === 0 ? null : verified / known,
    mean_recency: factors.recency && idx.length > 0 ? recency / idx.length : null,
    burst_downweighted_count: downweighted,
    recency_floor_clamps: recencyClamps,
    product_floor_clamps: productClamps,
  };
}

/** Copy refs so later ranking annotation never mutates a shared detector/ruling context. */
export function flaggedSpanRefs(ctx: RankContext, itemId: string): FlaggedSpanRef[] {
  return (ctx.itemFlaggedSpans?.get(itemId) ?? []).map((span) => ({ ...span }));
}
