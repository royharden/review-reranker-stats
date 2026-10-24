// Seeded synthetic catalogue generator (CL §5 data bullets, §8 generator bullets; PLAN M2 acceptance 4).
//
// Pure and deterministic: output depends only on (profile, seed). Every item draws from its own PRNG stream
// rngFrom(seed, 'item', item_id), so items are independent of generation order.
//
// Design:
//   - Review-count schedule from item ids BEFORE any rating is drawn (CL §8): count, sparse/regular, launch time and
//     drift membership are FNV-1a hashes of (seed, purpose, item_id) — they never depend on ratings or on PRNG state.
//     Regular items: Pareto(scale, shape) capped (heavy tail); sparse items: 1..sparseMax (cold start, insufficient).
//   - Bounded integer ratings from an explicit per-item categorical distribution over 1..5: p_k ∝ exp(-(k - q)² /
//     (2 sd²)) around the item's latent quality q ~ Normal(category baseline, spread), clipped. Truth is computed from
//     that distribution exactly (expected observed star mean and P(rating >= 4)), not from q, so rounding and clipping
//     cannot make truth and data disagree (F9).
//   - Drift items: one change point at 60% of the item's active life; the distribution after it uses q ± driftStep.
//     Review counts per period are fixed from the schedule, so the per-period and whole-item truths are exact.
//   - Timestamps uniform in the item's active period with weekday seasonality (rejection sampling on UTC weekday).
//   - verified ~ Bernoulli(category verifiedShare).
//
// Truth is returned as a SEPARATE object of a separate type (SynthTruth); no ranker or detector accepts it.

import { rngFrom, seedFrom } from '../stats/prng';
import type { Rng } from '../stats/prng';
import { cmp } from '../stats/hash';
import type { Rating, Review } from '../types';
import type { ProfileId, SynthProfile } from './profiles';

export const DAY_MS = 86_400_000;
export const RATINGS: readonly Rating[] = [1, 2, 3, 4, 5];

/** A categorical distribution over ratings 1..5 (index 0 = 1 star); sums to 1. */
export type RatingDistribution = readonly number[];

export interface TruthPeriod {
  /** [start, end) epoch ms. */
  start: number;
  end: number;
  review_count: number;
  expected_mean: number;
  p_top_box: number;
}

export interface ItemTruth {
  item_id: string;
  category: string;
  source: 'generator' | 'trap';
  /** Organic (non-injected) reviews this truth describes. */
  review_count: number;
  /** Expected observed star mean of the item's organic reviews (count-weighted over periods for drift items). */
  expected_mean: number;
  /** True P(rating >= 4) of the item's organic reviews (count-weighted over periods for drift items). */
  p_top_box: number;
  /** The item's rating distribution (count-weighted mixture for drift items). */
  distribution: RatingDistribution;
  /** Per-period truth for drift items, in time order; null otherwise. */
  periods: TruthPeriod[] | null;
}

export interface SynthTruth {
  kind: 'synth-truth-1';
  profile: ProfileId;
  seed: number;
  calendar: { start: number; end: number };
  asOf: number;
  /** Sorted by item_id (code unit). */
  items: ItemTruth[];
}

export interface GeneratedCatalogue {
  reviews: Review[];
  truth: SynthTruth;
}

// ---------------------------------------------------------------------------------------------------------------
// Small pure helpers (shared with traps.ts)
// ---------------------------------------------------------------------------------------------------------------

/** Uniform in [0, 1) from context keys only (no PRNG state): the id-based schedule. */
export function unitFrom(...keys: ReadonlyArray<string | number>): number {
  return seedFrom(...keys) / 4294967296;
}

export function distMean(p: RatingDistribution): number {
  let m = 0;
  for (let k = 0; k < 5; k++) m += (k + 1) * p[k];
  return m;
}

export function distTopBox(p: RatingDistribution): number {
  return p[3] + p[4];
}

export function normalizeDist(weights: readonly number[]): number[] {
  let s = 0;
  for (const w of weights) s += w;
  return weights.map((w) => w / s);
}

/** Discretised Gaussian kernel around q over 1..5. */
export function kernelDistribution(q: number, sd: number): number[] {
  const w: number[] = [];
  for (let k = 1; k <= 5; k++) w.push(Math.exp(-((k - q) * (k - q)) / (2 * sd * sd)));
  return normalizeDist(w);
}

/** Count-weighted mixture of distributions. */
export function mixDistributions(parts: ReadonlyArray<{ p: RatingDistribution; n: number }>): number[] {
  const out = [0, 0, 0, 0, 0];
  let total = 0;
  for (const { p, n } of parts) {
    total += n;
    for (let k = 0; k < 5; k++) out[k] += n * p[k];
  }
  return total === 0 ? out : out.map((v) => v / total);
}

export function drawRating(rng: Rng, p: RatingDistribution): Rating {
  const u = rng();
  let c = 0;
  for (let k = 0; k < 5; k++) {
    c += p[k];
    if (u < c) return RATINGS[k];
  }
  return 5;
}

/** Standard normal via Box-Muller; uses 1 - rng() so log never sees 0. */
export function standardNormal(rng: Rng): number {
  const u1 = 1 - rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function clip(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** UTC weekday of an epoch-ms time, 0 = Sunday (1970-01-01 was a Thursday). */
export function utcWeekday(ts: number): number {
  const day = Math.floor(ts / DAY_MS);
  return (((day + 4) % 7) + 7) % 7;
}

/** Uniform integer time in [a, b) thinned by weekday weights (bounded rejection loop; last draw kept). */
export function sampleTime(rng: Rng, a: number, b: number, weekdayWeights: readonly number[]): number {
  let wMax = 0;
  for (const w of weekdayWeights) wMax = Math.max(wMax, w);
  let t = a;
  for (let attempt = 0; attempt < 64; attempt++) {
    t = Math.floor(a + rng() * (b - a));
    if (rng() * wMax < weekdayWeights[utcWeekday(t)]) return t;
  }
  return t;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

// ---------------------------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------------------------

export interface ItemSchedule {
  item_id: string;
  categoryIndex: number;
  sparse: boolean;
  count: number;
  launch: number;
  drift: boolean;
  /** +1 improves after the change point, -1 worsens. */
  driftDirection: 1 | -1;
}

/** The id-based schedule for one item: depends only on (profile, seed, item index) — never on ratings. */
export function itemSchedule(profile: SynthProfile, seed: number, index: number): ItemSchedule {
  const nCat = profile.categories.length;
  const categoryIndex = index % nCat;
  const item_id = `${profile.categories[categoryIndex].name}-${pad(Math.floor(index / nCat), 4)}`;
  const c = profile.counts;
  const uCount = unitFrom(seed, 'count', item_id);
  const sparse = unitFrom(seed, 'sparse', item_id) < c.sparseShare;
  const count = sparse
    ? 1 + Math.floor(uCount * c.sparseMax)
    : Math.min(c.maxCount, Math.max(1, Math.floor(c.paretoScale * Math.pow(1 - uCount, -1 / c.paretoShape))));
  const span = profile.calendar.end - profile.calendar.start;
  const launchFraction = unitFrom(seed, 'launch', item_id) * (sparse ? 0.95 : profile.launchMaxFraction);
  const launch = profile.calendar.start + Math.floor(launchFraction * span);
  const drift = !sparse && count >= 60 && unitFrom(seed, 'drift', item_id) < profile.driftShare;
  const driftDirection = unitFrom(seed, 'drift-direction', item_id) < 0.5 ? -1 : 1;
  return { item_id, categoryIndex, sparse, count, launch, drift, driftDirection };
}

interface Segment {
  start: number;
  end: number;
  n: number;
  p: RatingDistribution;
}

export function generateCatalogue(profile: SynthProfile, seed: number): GeneratedCatalogue {
  const reviews: Review[] = [];
  const truthItems: ItemTruth[] = [];
  const end = profile.calendar.end;

  for (let index = 0; index < profile.itemCount; index++) {
    const sched = itemSchedule(profile, seed, index);
    const cat = profile.categories[sched.categoryIndex];
    const rng = rngFrom(seed, 'item', sched.item_id);

    const q = clip(cat.baseline + cat.spread * standardNormal(rng), 1.3, 4.9);
    const p1 = kernelDistribution(q, profile.ratingKernelSd);

    const segments: Segment[] = [];
    if (sched.drift) {
      const change = sched.launch + Math.floor(0.6 * (end - sched.launch));
      // Step in the scheduled direction; if that would leave [1.3, 4.9], step the other way so the two periods
      // always differ (clipping both to the same bound would make a "drift" item with no drift).
      let q2 = q + sched.driftDirection * profile.driftStep;
      if (q2 > 4.9 || q2 < 1.3) q2 = q - sched.driftDirection * profile.driftStep;
      q2 = clip(q2, 1.3, 4.9);
      const p2 = kernelDistribution(q2, profile.ratingKernelSd);
      const nBefore = Math.round((sched.count * (change - sched.launch)) / (end - sched.launch));
      segments.push({ start: sched.launch, end: change, n: nBefore, p: p1 });
      segments.push({ start: change, end, n: sched.count - nBefore, p: p2 });
    } else {
      segments.push({ start: sched.launch, end, n: sched.count, p: p1 });
    }

    const drafts: Array<{ ts: number; rating: Rating; verified: boolean }> = [];
    for (const seg of segments) {
      for (let j = 0; j < seg.n; j++) {
        const ts = sampleTime(rng, seg.start, seg.end, profile.weekdayWeights);
        const rating = drawRating(rng, seg.p);
        const verified = rng() < cat.verifiedShare;
        drafts.push({ ts, rating, verified });
      }
    }
    // Ids follow time order; equal times keep draw order (stable sort), which is itself deterministic.
    drafts.sort((a, b) => a.ts - b.ts);
    drafts.forEach((d, j) => {
      reviews.push({
        review_id: `${sched.item_id}-r${pad(j, 5)}`,
        item_id: sched.item_id,
        category: cat.name,
        rating: d.rating,
        ts: d.ts,
        verified: d.verified,
      });
    });

    const mixture = mixDistributions(segments.map((s) => ({ p: s.p, n: s.n })));
    truthItems.push({
      item_id: sched.item_id,
      category: cat.name,
      source: 'generator',
      review_count: sched.count,
      expected_mean: distMean(mixture),
      p_top_box: distTopBox(mixture),
      distribution: mixture,
      periods: sched.drift
        ? segments.map((s) => ({
            start: s.start,
            end: s.end,
            review_count: s.n,
            expected_mean: distMean(s.p),
            p_top_box: distTopBox(s.p),
          }))
        : null,
    });
  }

  truthItems.sort((a, b) => cmp(a.item_id, b.item_id));
  return {
    reviews,
    truth: {
      kind: 'synth-truth-1',
      profile: profile.id,
      seed,
      calendar: { start: profile.calendar.start, end: profile.calendar.end },
      asOf: profile.asOf,
      items: truthItems,
    },
  };
}
