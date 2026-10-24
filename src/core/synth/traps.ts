// Code-built named statistical traps (CL §1.3 step 1, §5 rankers/burst bullets; spec "Data and fixtures";
// PLAN M2 acceptance 4, M3 acceptance 2 and 5).
//
// Every trap lives in its own `trap:` category (or shares `trap:bursts` / `trap:recency`) with FIXED background
// items, so the expectation cannot be disturbed by the random catalogue. All ids are namespaced: items
// `trap:<trap>:<role>` (background `trap:<category-key>:bg-NN`), organic reviews `<item>:rNNNN`, injected reviews
// `<item>:bNNNN`. Ratings and verified flags of trap items are allocated EXACTLY from an explicit distribution
// (largest-remainder apportionment, then a seeded shuffle), so every trap's rating multiset is known in advance.
// Placement is relative to asOf: all trap reviews fall on UTC days strictly before floor(asOf / day), so none is
// "future".
//
// Expected outcomes (TrapMeta) are exported separately from the data for the M3 ranker/detector tests; the
// detector and rankers never see them.

import { cmp } from '../stats/hash';
import { rngFrom, shuffleInPlace } from '../stats/prng';
import type { Rng } from '../stats/prng';
import type { Rating, Review } from '../types';
import { DAY_MS, RATINGS, distMean, distTopBox } from './generator';
import type { ItemTruth, RatingDistribution, TruthPeriod } from './generator';

export type TrapName =
  | 'tiny_perfect'
  | 'category_gap'
  | 'promo_burst'
  | 'verified_promo'
  | 'bomb'
  | 'drip'
  | 'viral_organic'
  | 'new_item_launch'
  | 'sparse_mad_zero'
  | 'quality_drift'
  | 'eligibility_edge'
  | 'reach_11_windows';

export type TrapOutcome =
  /** B ranks below A for bayes_global, wilson, eb_*, full; above A for mean. */
  | 'b_below_a_except_mean'
  /** X and Y get different posteriors under eb_category, identical ones under eb_global and bayes_global. */
  | 'eb_category_differs_globals_equal'
  /** The planted span is flagged (volume z AND rating-shift test). */
  | 'flagged'
  /** Expected miss (listed in LIMITATIONS): the drip never forms a volume candidate. */
  | 'not_flagged_expected_miss'
  /** Volume candidate, ratings unchanged: "volume spike, ratings unchanged", no weight change. */
  | 'volume_only_unflagged'
  /** Detector cannot assess the item (too young); shrinkage is the only defence. */
  | 'unassessable'
  /** MAD = 0 baselines: finite z, no throw. */
  | 'finite_no_throw'
  /** Recency moves the drift item toward its current-period truth and hurts the stable sparse item. */
  | 'recency_helps_drift_hurts_stable'
  /** Either a flag or a named unassessable reason — never an error. */
  | 'flag_or_named_reason'
  /** 11 overlapping candidate windows merge into one span, flagged at default thresholds. */
  | 'single_span_flagged';

export interface PlantedBurst {
  item_id: string;
  direction: 'promo' | 'bomb' | 'volume';
  /** UTC day indices (floor(ts / 86_400_000)), inclusive. */
  start_day: number;
  end_day: number;
  /** Injected review ids, sorted by code unit. */
  review_ids: string[];
  /** Share of injected reviews with verified = true. */
  verified_share: number;
  /** Organic reviews of the item in the 90 days before start_day. */
  reference_in_90d: number;
  /** Organic history (days) before start_day. */
  history_days: number;
  /** Candidate (L, end-day) windows the design expects to trip at defaults, when derivable; else null. */
  expected_candidate_windows: number | null;
}

export interface TrapMeta {
  name: TrapName;
  categories: string[];
  /** role -> item_id */
  roles: Record<string, string>;
  outcome: TrapOutcome;
  expectation: string;
  burst: PlantedBurst | null;
  /** Organic expected star mean of the main target, when the trap has one. */
  target_expected_mean: number | null;
  /** Quartiles of expected item means within the target's category (type-7), for quartile placement checks. */
  category_quartiles: { q1: number; q3: number } | null;
  /** Other design numbers the M3 tests may assert against. */
  numbers: Record<string, number>;
}

export interface TrapBuild {
  reviews: Review[];
  /** Organic truth for every trap item (injected reviews excluded), sorted by item_id. */
  truth: ItemTruth[];
  meta: TrapMeta[];
}

// ---------------------------------------------------------------------------------------------------------------
// Distributions (index 0 = 1 star). Means in comments.
// ---------------------------------------------------------------------------------------------------------------

const BG40: RatingDistribution = [0.03, 0.05, 0.12, 0.45, 0.35]; // 4.04
const BG42: RatingDistribution = [0.02, 0.03, 0.1, 0.4, 0.45]; // 4.23
const BG44: RatingDistribution = [0.01, 0.02, 0.07, 0.33, 0.57]; // 4.43
const LOW35: RatingDistribution = [0.08, 0.12, 0.22, 0.33, 0.25]; // 3.55
const LOW33: RatingDistribution = [0.1, 0.14, 0.24, 0.3, 0.22]; // 3.40
const HIGH45: RatingDistribution = [0.01, 0.02, 0.06, 0.3, 0.61]; // 4.48
const HIGH46: RatingDistribution = [0.01, 0.01, 0.05, 0.25, 0.68]; // 4.58
const PROMO_TARGET: RatingDistribution = [0.12, 0.2, 0.3, 0.24, 0.14]; // 3.08 (bottom quartile)
const BOMB_TARGET: RatingDistribution = [0.01, 0.01, 0.04, 0.2, 0.74]; // 4.65 (top quartile)
const A_800: RatingDistribution = [0, 0, 0.05, 0.2, 0.75]; // 4.70 exactly at n = 800: 40 x 3, 160 x 4, 600 x 5
const ALL_FIVE: RatingDistribution = [0, 0, 0, 0, 1];
const NEW_ITEM: RatingDistribution = [0, 0, 0.025, 0.1, 0.875]; // 4.85 exactly at n = 40
const STABLE_8: RatingDistribution = [0, 0, 0.125, 0.5, 0.375]; // 4.25 exactly at n = 8

function lerpDist(a: RatingDistribution, b: RatingDistribution, t: number): number[] {
  return a.map((v, k) => (1 - t) * v + t * b[k]);
}

// ---------------------------------------------------------------------------------------------------------------
// Exact allocation helpers
// ---------------------------------------------------------------------------------------------------------------

/** Largest-remainder apportionment of `count` over a distribution; ties broken by lower index. */
export function apportion(count: number, p: RatingDistribution): number[] {
  const raw = p.map((v) => v * count);
  const out = raw.map((v) => Math.floor(v + 1e-9));
  let remaining = count - out.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, k) => ({ k, frac: v - Math.floor(v + 1e-9) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.k - b.k));
  for (let i = 0; remaining > 0; i = (i + 1) % order.length) {
    out[order[i].k]++;
    remaining--;
  }
  return out;
}

export function exactRatings(count: number, p: RatingDistribution, rng: Rng): Rating[] {
  const counts = apportion(count, p);
  const out: Rating[] = [];
  counts.forEach((c, k) => {
    for (let j = 0; j < c; j++) out.push(RATINGS[k]);
  });
  return shuffleInPlace(out, rng);
}

export function exactFlags(count: number, share: number, rng: Rng): boolean[] {
  const nTrue = Math.round(count * share);
  const out: boolean[] = [];
  for (let j = 0; j < count; j++) out.push(j < nTrue);
  return shuffleInPlace(out, rng);
}

/** `count` days spread evenly over [firstDay, lastDay] (inclusive); count = span gives exactly one per day. */
export function stratifiedDays(firstDay: number, lastDay: number, count: number): number[] {
  const span = lastDay - firstDay + 1;
  const days: number[] = [];
  for (let k = 0; k < count; k++) days.push(firstDay + Math.floor((k * span) / count));
  return days;
}

/** Injected (planted) trap reviews end in `:bNNNN`; organic ones in `:rNNNN`. */
export function isInjectedReviewId(reviewId: string): boolean {
  return /:b\d{4}$/.test(reviewId);
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/** Type-7 quantile of a sorted array. */
function quantile7(sorted: readonly number[], q: number): number {
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// ---------------------------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------------------------

interface ItemBuild {
  reviews: Review[];
  truth: ItemTruth;
}

class TrapWriter {
  readonly reviews: Review[] = [];
  readonly truth: ItemTruth[] = [];
  readonly meta: TrapMeta[] = [];
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Organic reviews of one item on the given days with exactly allocated ratings and verified flags.
   * `idOffset` continues an item's review-id sequence (second period of a drift item); `recordTruth: false` skips the
   * truth entry (the caller merges periods into one truth).
   */
  organic(
    itemId: string,
    category: string,
    days: readonly number[],
    p: RatingDistribution,
    verifiedShare: number,
    options: { rngKey?: string; idOffset?: number; recordTruth?: boolean } = {},
  ): ItemBuild {
    const rng = rngFrom(this.seed, 'trap-organic', options.rngKey ?? itemId);
    const idOffset = options.idOffset ?? 0;
    const ratings = exactRatings(days.length, p, rng);
    // Trap ratings are a fixed apportioned multiset, unlike the catalogue's independent random draws. Its
    // ground truth must describe those integer counts rather than the unrounded design distribution.
    const distribution = apportion(days.length, p).map((count) => count / days.length);
    const flags = exactFlags(days.length, verifiedShare, rng);
    const reviews: Review[] = days.map((day, j) => ({
      review_id: `${itemId}:r${pad4(idOffset + j)}`,
      item_id: itemId,
      category,
      rating: ratings[j],
      ts: day * DAY_MS + Math.floor(rng() * DAY_MS),
      verified: flags[j],
    }));
    const truth: ItemTruth = {
      item_id: itemId,
      category,
      source: 'trap',
      review_count: days.length,
      expected_mean: distMean(distribution),
      p_top_box: distTopBox(distribution),
      distribution,
      periods: null,
    };
    this.reviews.push(...reviews);
    if (options.recordTruth ?? true) this.truth.push(truth);
    return { reviews, truth };
  }

  /** Injected reviews: `perDay` = [day, count] pairs; constant rating or an exactly allocated distribution. */
  inject(
    itemId: string,
    category: string,
    perDay: ReadonlyArray<readonly [number, number]>,
    ratingsOf: Rating | RatingDistribution,
    verifiedShare: number,
  ): { ids: string[]; verifiedShare: number } {
    const rng = rngFrom(this.seed, 'trap-inject', itemId);
    const days: number[] = [];
    for (const [day, count] of perDay) for (let j = 0; j < count; j++) days.push(day);
    const ratings: Rating[] =
      typeof ratingsOf === 'number' ? days.map(() => ratingsOf) : exactRatings(days.length, ratingsOf, rng);
    const flags = exactFlags(days.length, verifiedShare, rng);
    const ids: string[] = [];
    days.forEach((day, j) => {
      const id = `${itemId}:b${pad4(j)}`;
      ids.push(id);
      this.reviews.push({
        review_id: id,
        item_id: itemId,
        category,
        rating: ratings[j],
        ts: day * DAY_MS + Math.floor(rng() * DAY_MS),
        verified: flags[j],
      });
    });
    const nTrue = flags.filter((f) => f).length;
    return { ids: ids.sort(cmp), verifiedShare: days.length === 0 ? 0 : nTrue / days.length };
  }

  background(
    categoryKey: string,
    category: string,
    n: number,
    distOf: (i: number) => RatingDistribution,
    countOf: (i: number) => number,
    firstDay: number,
    lastDay: number,
  ): ItemBuild[] {
    const out: ItemBuild[] = [];
    for (let i = 0; i < n; i++) {
      const id = `trap:${categoryKey}:bg-${String(i).padStart(2, '0')}`;
      out.push(this.organic(id, category, stratifiedDays(firstDay, lastDay, countOf(i)), distOf(i), 0.85));
    }
    return out;
  }

  organicBefore(itemId: string, startDay: number, windowDays: number): number {
    let n = 0;
    for (const r of this.reviews) {
      if (r.item_id !== itemId || isInjectedReviewId(r.review_id)) continue;
      const d = Math.floor(r.ts / DAY_MS);
      if (d >= startDay - windowDays && d < startDay) n++;
    }
    return n;
  }

  firstOrganicDay(itemId: string): number {
    let first = Number.POSITIVE_INFINITY;
    for (const r of this.reviews) {
      if (r.item_id === itemId && !isInjectedReviewId(r.review_id)) first = Math.min(first, Math.floor(r.ts / DAY_MS));
    }
    return first;
  }
}

/**
 * Build every trap relative to asOf. Deterministic in (asOf, seed); the seed only moves within-day times and the
 * order of exactly allocated ratings/flags, never any count, day or rating multiset.
 */
export function buildTraps(asOf: number, seed: number): TrapBuild {
  const w = new TrapWriter(seed);
  const anchor = Math.floor(asOf / DAY_MS); // first day NOT used; the last trap day is anchor - 1
  const last = anchor - 1;

  // ---- tiny_perfect -----------------------------------------------------------------------------------------
  {
    const cat = 'trap:tiny_perfect';
    const bgDists = [BG40, BG42, BG44];
    const bg = w.background('tiny_perfect', cat, 30, (i) => bgDists[i % 3], (i) => 40 + ((i * 7) % 21), anchor - 730, last);
    const a = w.organic('trap:tiny_perfect:A', cat, stratifiedDays(anchor - 730, last, 800), A_800, 0.85);
    w.organic('trap:tiny_perfect:B', cat, [anchor - 40, anchor - 25, anchor - 10], ALL_FIVE, 1);
    const bgMean = bg.reduce((s, b) => s + b.truth.expected_mean, 0) / bg.length;
    w.meta.push({
      name: 'tiny_perfect',
      categories: [cat],
      roles: { A: 'trap:tiny_perfect:A', B: 'trap:tiny_perfect:B' },
      outcome: 'b_below_a_except_mean',
      expectation:
        'B (3 five-stars) ranks below A (800 reviews, mean 4.7) for bayes_global, wilson, eb_category, eb_global and full; above A for mean.',
      burst: null,
      target_expected_mean: a.truth.expected_mean,
      category_quartiles: null,
      numbers: { a_n: 800, a_mean: 4.7, b_n: 3, b_mean: 5, background_items: bg.length, background_min_reviews: 40, background_expected_mean: bgMean },
    });
  }

  // ---- category_gap -----------------------------------------------------------------------------------------
  {
    const low = 'trap:category_gap_low';
    const high = 'trap:category_gap_high';
    const lowBg = w.background('category_gap_low', low, 24, (i) => (i % 2 === 0 ? LOW35 : LOW33), () => 40, anchor - 730, last);
    const highBg = w.background('category_gap_high', high, 24, (i) => (i % 2 === 0 ? HIGH45 : HIGH46), () => 40, anchor - 730, last);
    // X and Y: identical rating multisets, days, within-day times and verified flags (same rng key); only ids and
    // categories differ. 2 x 5, 8 x 4, 2 x 3 -> raw mean 4.0, n = 12.
    const XY: RatingDistribution = [0, 0, 2 / 12, 8 / 12, 2 / 12];
    const days = stratifiedDays(anchor - 365, last, 12);
    w.organic('trap:category_gap:X', low, days, XY, 1, { rngKey: 'trap:category_gap:XY' });
    w.organic('trap:category_gap:Y', high, days, XY, 1, { rngKey: 'trap:category_gap:XY' });
    const mean = (xs: ItemBuild[]) => xs.reduce((s, b) => s + b.truth.expected_mean, 0) / xs.length;
    w.meta.push({
      name: 'category_gap',
      categories: [low, high],
      roles: { X: 'trap:category_gap:X', Y: 'trap:category_gap:Y' },
      outcome: 'eb_category_differs_globals_equal',
      expectation:
        'X and Y have identical review counts and raw means in categories with different baselines: eb_category gives different posteriors (each toward its own prior); eb_global and bayes_global give identical ones.',
      burst: null,
      target_expected_mean: distMean(XY),
      category_quartiles: null,
      numbers: { n: 12, raw_mean: 4, low_background_expected_mean: mean(lowBg), high_background_expected_mean: mean(highBg) },
    });
  }

  // ---- trap:bursts (shared category for every detector trap) --------------------------------------------------
  const bursts = 'trap:bursts';
  const burstBg = w.background('bursts', bursts, 24, (i) => lerpDist(LOW35, HIGH45, i / 23), () => 70, anchor - 300, last);
  const burstTargets: ItemTruth[] = [];

  const burstTrap = (
    name: TrapName,
    p: RatingDistribution,
    plant: (id: string) => { days: [number, number]; ids: string[]; verifiedShare: number; direction: PlantedBurst['direction'] },
    outcome: TrapOutcome,
    expectation: string,
    expectedWindows: number | null,
    organicDays: readonly number[] = stratifiedDays(anchor - 200, last, 200),
  ): void => {
    const id = `trap:${name}:target`;
    const organic = w.organic(id, bursts, organicDays, p, 0.85);
    const planted = plant(id);
    burstTargets.push(organic.truth);
    w.meta.push({
      name,
      categories: [bursts],
      roles: { target: id },
      outcome,
      expectation,
      burst: {
        item_id: id,
        direction: planted.direction,
        start_day: planted.days[0],
        end_day: planted.days[1],
        review_ids: planted.ids,
        verified_share: planted.verifiedShare,
        reference_in_90d: w.organicBefore(id, planted.days[0], 90),
        history_days: planted.days[0] - w.firstOrganicDay(id),
        expected_candidate_windows: expectedWindows,
      },
      target_expected_mean: organic.truth.expected_mean,
      category_quartiles: null, // filled below once every bursts item exists
      numbers: { injected: planted.ids.length },
    });
  };

  // promo_burst: 25 five-stars in 2 days, 80% unverified, bottom-quartile item; >= 90 days history, ~90 organic
  // reference reviews in the 90 days before.
  burstTrap(
    'promo_burst',
    PROMO_TARGET,
    (id) => {
      const d = anchor - 30;
      const r = w.inject(id, bursts, [[d, 13], [d + 1, 12]], 5, 0.2);
      return { days: [d, d + 1], ids: r.ids, verifiedShare: r.verifiedShare, direction: 'promo' };
    },
    'flagged',
    '25 five-stars in 2 days (80% unverified) on a bottom-quartile item: flagged.',
    null,
  );
  // verified_promo: same shape, 100% verified, so only the detector helps.
  burstTrap(
    'verified_promo',
    PROMO_TARGET,
    (id) => {
      const d = anchor - 45;
      const r = w.inject(id, bursts, [[d, 13], [d + 1, 12]], 5, 1);
      return { days: [d, d + 1], ids: r.ids, verifiedShare: r.verifiedShare, direction: 'promo' };
    },
    'flagged',
    '25 verified five-stars in 2 days on a bottom-quartile item: flagged (the verified weight cannot help).',
    null,
  );
  // bomb: 25 one-stars in 2 days on a top-quartile item.
  burstTrap(
    'bomb',
    BOMB_TARGET,
    (id) => {
      const d = anchor - 30;
      const r = w.inject(id, bursts, [[d, 13], [d + 1, 12]], 1, 0.2);
      return { days: [d, d + 1], ids: r.ids, verifiedShare: r.verifiedShare, direction: 'bomb' };
    },
    'flagged',
    '25 one-stars in 2 days (80% unverified) on a top-quartile item: flagged (two-sided shift test).',
    null,
  );
  // drip: the same 25 five-stars spread over 60 days — expected to evade.
  burstTrap(
    'drip',
    PROMO_TARGET,
    (id) => {
      const first = anchor - 80;
      const perDay: Array<[number, number]> = [];
      for (let k = 0; k < 25; k++) perDay.push([first + Math.floor((k * 60) / 25), 1]);
      const r = w.inject(id, bursts, perDay, 5, 0.2);
      return { days: [first, perDay[perDay.length - 1][0]], ids: r.ids, verifiedShare: r.verifiedShare, direction: 'promo' };
    },
    'not_flagged_expected_miss',
    '25 five-stars spread over 60 days on a bottom-quartile item: expected to evade (LIMITATIONS).',
    null,
  );
  // viral_organic: big volume spike with the item's own rating distribution — must not be flagged.
  burstTrap(
    'viral_organic',
    BG40,
    (id) => {
      const d = anchor - 30;
      const r = w.inject(id, bursts, [[d, 30], [d + 1, 30]], BG40, 0.85);
      return { days: [d, d + 1], ids: r.ids, verifiedShare: r.verifiedShare, direction: 'volume' };
    },
    'volume_only_unflagged',
    '60 reviews in 2 days drawn from the item’s own distribution: volume candidate, ratings unchanged, not flagged.',
    null,
  );
  // eligibility_edge: exactly 30 reviews, first one 35 days before asOf; 10 five-stars 3 days before asOf.
  burstTrap(
    'eligibility_edge',
    LOW35,
    (id) => {
      const d = anchor - 3;
      const r = w.inject(id, bursts, [[d, 10]], 5, 0.3);
      return { days: [d, d], ids: r.ids, verifiedShare: r.verifiedShare, direction: 'promo' };
    },
    'flag_or_named_reason',
    'Exactly 30 reviews over ~35 days: the detector returns a flag or a named unassessable reason, never an error.',
    null,
    stratifiedDays(anchor - 35, anchor - 6, 20),
  );
  // reach_11_windows: exactly one organic review on every day for 150 days, then 40 five-stars on ONE day. With
  // windows L = 1, 3, 7 and candidates only on review days, the windows containing that day are 1 + 3 + 7 = 11
  // (every later day has a review, and the burst is >= 7 days before asOf); windows without it have count = L
  // against an all-L baseline (z = 0). All 11 overlap, merge into one span and need one permutation test.
  burstTrap(
    'reach_11_windows',
    PROMO_TARGET,
    (id) => {
      const d = anchor - 20;
      const r = w.inject(id, bursts, [[d, 40]], 5, 0.5);
      return { days: [d, d], ids: r.ids, verifiedShare: r.verifiedShare, direction: 'promo' };
    },
    'single_span_flagged',
    'A one-day burst trips 11 overlapping candidate windows (1 + 3 + 7), merges into one span and is flagged at defaults.',
    11,
    stratifiedDays(anchor - 150, last, 150),
  );

  // new_item_launch: all 40 reviews within the last 10 days -> unassessable (< 28 days of history).
  {
    const id = 'trap:new_item_launch:target';
    const organic = w.organic(id, bursts, stratifiedDays(anchor - 10, last, 40), NEW_ITEM, 0.5);
    burstTargets.push(organic.truth);
    w.meta.push({
      name: 'new_item_launch',
      categories: [bursts],
      roles: { target: id },
      outcome: 'unassessable',
      expectation: 'All 40 reviews fall in the last 10 days: unassessable (fewer than 28 days); shrinkage is the only defence.',
      burst: null,
      target_expected_mean: organic.truth.expected_mean,
      category_quartiles: null,
      numbers: { n: 40, active_days: 10 },
    });
  }

  // sparse_mad_zero: one review every 6 days (1-day baselines all zero: median 0, MAD 0), then a 4-review day.
  {
    const id = 'trap:sparse_mad_zero:target';
    const days: number[] = [];
    for (let k = 0; k < 36; k++) days.push(anchor - 240 + 6 * k);
    const spikeDay = anchor - 12;
    for (let k = 0; k < 4; k++) days.push(spikeDay);
    const organic = w.organic(id, bursts, days, BG40, 0.85);
    burstTargets.push(organic.truth);
    w.meta.push({
      name: 'sparse_mad_zero',
      categories: [bursts],
      roles: { target: id },
      outcome: 'finite_no_throw',
      expectation: 'Zero-median, zero-MAD baselines: scale = max(1, 1.4826 MAD, sqrt(median)) = 1, z finite, no throw.',
      burst: null,
      target_expected_mean: organic.truth.expected_mean,
      category_quartiles: null,
      numbers: { n: 40, spike_day: spikeDay, spike_count: 4, gap_days: 6 },
    });
  }

  // Quartile placement within trap:bursts (expected organic means of every item in the category).
  {
    const means = [...burstBg.map((b) => b.truth.expected_mean), ...burstTargets.map((t) => t.expected_mean)].sort((a, b) => a - b);
    const quartiles = { q1: quantile7(means, 0.25), q3: quantile7(means, 0.75) };
    for (const m of w.meta) if (m.categories[0] === bursts) m.category_quartiles = quartiles;
  }

  // ---- quality_drift + stable sparse control (trap:recency) ---------------------------------------------------
  {
    const cat = 'trap:recency';
    w.background('recency', cat, 20, (i) => (i % 2 === 0 ? LOW35 : BG40), () => 40, anchor - 730, last);
    const driftId = 'trap:quality_drift:target';
    const changeDay = anchor - 182;
    const before = w.organic(driftId, cat, stratifiedDays(anchor - 730, changeDay - 1, 180), PROMO_TARGET, 0.85, {
      rngKey: `${driftId}:before`,
    });
    // Second period of the same item: ids continue at r0180; one merged truth (with periods) is kept.
    const after = w.organic(driftId, cat, stratifiedDays(changeDay, last, 60), HIGH45, 0.85, {
      rngKey: `${driftId}:after`,
      idOffset: 180,
      recordTruth: false,
    });
    const periods: TruthPeriod[] = [
      { start: (anchor - 730) * DAY_MS, end: changeDay * DAY_MS, review_count: before.truth.review_count, expected_mean: before.truth.expected_mean, p_top_box: before.truth.p_top_box },
      { start: changeDay * DAY_MS, end: anchor * DAY_MS, review_count: after.truth.review_count, expected_mean: after.truth.expected_mean, p_top_box: after.truth.p_top_box },
    ];
    const total = before.truth.review_count + after.truth.review_count;
    const mixed = before.truth.distribution.map((v, k) =>
      (before.truth.review_count * v + after.truth.review_count * after.truth.distribution[k]) / total,
    );
    before.truth.review_count = total;
    before.truth.expected_mean = distMean(mixed);
    before.truth.p_top_box = distTopBox(mixed);
    before.truth.distribution = mixed;
    before.truth.periods = periods;

    const stableId = 'trap:quality_drift:stable_sparse';
    w.organic(stableId, cat, stratifiedDays(anchor - 730, last, 8), STABLE_8, 0.85);
    w.meta.push({
      name: 'quality_drift',
      categories: [cat],
      roles: { drift: driftId, stable_sparse: stableId },
      outcome: 'recency_helps_drift_hurts_stable',
      expectation:
        'The drift item improved to its current-period distribution 182 days before asOf: recency moves its estimate toward the current-period truth. The stable sparse item (8 reviews, 4.25, mostly old) loses effective weight under recency and is pulled further toward the category prior.',
      burst: null,
      target_expected_mean: after.truth.expected_mean,
      category_quartiles: null,
      numbers: { change_day: changeDay, before_n: periods[0].review_count, after_n: periods[1].review_count, before_mean: periods[0].expected_mean, after_mean: periods[1].expected_mean, stable_n: 8, stable_mean: 4.25 },
    });
  }

  w.truth.sort((a, b) => cmp(a.item_id, b.item_id));
  return { reviews: w.reviews, truth: w.truth, meta: w.meta };
}

/** All trap names in a fixed order (for tests that iterate every trap). */
export const TRAP_NAMES: readonly TrapName[] = [
  'tiny_perfect',
  'category_gap',
  'promo_burst',
  'verified_promo',
  'bomb',
  'drip',
  'viral_organic',
  'new_item_launch',
  'sparse_mad_zero',
  'quality_drift',
  'eligibility_edge',
  'reach_11_windows',
];
