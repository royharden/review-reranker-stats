import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/core/synth/generator';
import { TRAP_NAMES, apportion, buildTraps, isInjectedReviewId, stratifiedDays } from '../../src/core/synth/traps';
import type { TrapMeta, TrapName } from '../../src/core/synth/traps';
import type { Review } from '../../src/core/types';
import { ASOF } from '../helpers';

// Trap shape properties (PLAN M2 acceptance 4; the expected ranker/detector OUTCOMES are asserted in M3).
const SEED = 33;
const built = buildTraps(ASOF, SEED);
const ANCHOR = Math.floor(ASOF / DAY_MS);

function meta(name: TrapName): TrapMeta {
  const m = built.meta.find((x) => x.name === name);
  if (!m) throw new Error(`missing trap meta ${name}`);
  return m;
}

function reviewsOf(itemId: string): Review[] {
  return built.reviews.filter((r) => r.item_id === itemId);
}

const day = (r: Review) => Math.floor(r.ts / DAY_MS);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sortedRatings = (rs: Review[]) => rs.map((r) => r.rating).sort((a, b) => a - b);

function perDay(rs: Review[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rs) m.set(day(r), (m.get(day(r)) ?? 0) + 1);
  return m;
}

describe('trap data hygiene', () => {
  it('every trap has metadata exactly once', () => {
    expect(built.meta.map((m) => m.name).sort()).toEqual([...TRAP_NAMES].sort());
  });

  it('trap categories and ids are namespaced; review ids unique; all timestamps strictly before asOf', () => {
    const ids = new Set<string>();
    for (const r of built.reviews) {
      expect(r.category.startsWith('trap:')).toBe(true);
      expect(r.item_id.startsWith('trap:')).toBe(true);
      expect(r.review_id.startsWith(r.item_id + ':')).toBe(true);
      expect([1, 2, 3, 4, 5]).toContain(r.rating);
      expect(r.ts).toBeLessThan(ASOF);
      ids.add(r.review_id);
    }
    expect(ids.size).toBe(built.reviews.length);
  });

  it('deterministic; the seed moves only within-day times and orderings, never counts, days or rating multisets', () => {
    expect(buildTraps(ASOF, SEED)).toEqual(built);
    const other = buildTraps(ASOF, SEED + 1);
    expect(other.reviews.length).toBe(built.reviews.length);
    for (const m of built.meta) {
      for (const id of Object.values(m.roles)) {
        expect(sortedRatings(other.reviews.filter((r) => r.item_id === id))).toEqual(sortedRatings(reviewsOf(id)));
        expect(Array.from(perDay(other.reviews.filter((r) => r.item_id === id)))).toEqual(Array.from(perDay(reviewsOf(id))));
      }
    }
  });

  it('truth covers every trap item, excludes injected reviews and is a separate object', () => {
    const items = new Set(built.reviews.map((r) => r.item_id));
    expect(new Set(built.truth.map((t) => t.item_id))).toEqual(items);
    for (const t of built.truth) {
      const organic = reviewsOf(t.item_id).filter((r) => !isInjectedReviewId(r.review_id));
      expect(t.review_count).toBe(organic.length);
      expect(t.source).toBe('trap');
    }
  });

  it('trap truth matches the fixed organic rating multiset, including each drift period', () => {
    // Regression: unrounded design probabilities described a different population from exactRatings' fixed
    // integer counts (BG40 at n = 40 has observed mean 4.05, while the original design mean is 4.04).
    for (const t of built.truth) {
      const organic = reviewsOf(t.item_id).filter((r) => !isInjectedReviewId(r.review_id));
      expect(t.expected_mean).toBeCloseTo(mean(organic.map((r) => r.rating)), 12);
      expect(t.p_top_box).toBeCloseTo(organic.filter((r) => r.rating >= 4).length / organic.length, 12);
      for (let rating = 1; rating <= 5; rating++) {
        expect(t.distribution[rating - 1]).toBeCloseTo(organic.filter((r) => r.rating === rating).length / organic.length, 12);
      }
      for (const period of t.periods ?? []) {
        const rows = organic.filter((r) => r.ts >= period.start && r.ts < period.end);
        expect(period.review_count).toBe(rows.length);
        expect(period.expected_mean).toBeCloseTo(mean(rows.map((r) => r.rating)), 12);
        expect(period.p_top_box).toBeCloseTo(rows.filter((r) => r.rating >= 4).length / rows.length, 12);
      }
    }
    expect(built.truth.find((t) => t.item_id === 'trap:sparse_mad_zero:target')?.expected_mean).toBeCloseTo(4.05, 12);
  });

  it('injected-id detection is exact (regression: "trap:bomb:..." must not look injected)', () => {
    expect(isInjectedReviewId('trap:bomb:target:b0003')).toBe(true);
    expect(isInjectedReviewId('trap:bomb:target:r0003')).toBe(false);
    expect(isInjectedReviewId('trap:bursts:bg-01:r0000')).toBe(false);
  });

  it('helpers: largest-remainder apportionment and stratified days', () => {
    expect(apportion(800, [0, 0, 0.05, 0.2, 0.75])).toEqual([0, 0, 40, 160, 600]);
    expect(apportion(4, [0.03, 0.05, 0.12, 0.45, 0.35])).toEqual([0, 0, 1, 2, 1]);
    expect(apportion(7, [0.2, 0.2, 0.2, 0.2, 0.2]).reduce((s, v) => s + v, 0)).toBe(7);
    expect(stratifiedDays(10, 14, 5)).toEqual([10, 11, 12, 13, 14]);
    expect(stratifiedDays(0, 9, 4)).toEqual([0, 2, 5, 7]);
  });
});

describe('tiny_perfect', () => {
  it('B = 3 five-stars; A = 800 reviews with mean exactly 4.7; >= 30 background items with >= 40 reviews, mean ~4.2', () => {
    const m = meta('tiny_perfect');
    const b = reviewsOf(m.roles.B);
    const a = reviewsOf(m.roles.A);
    expect(sortedRatings(b)).toEqual([5, 5, 5]);
    expect(a).toHaveLength(800);
    expect(mean(a.map((r) => r.rating))).toBeCloseTo(4.7, 12);
    const bg = built.reviews.filter((r) => r.category === 'trap:tiny_perfect' && r.item_id !== m.roles.A && r.item_id !== m.roles.B);
    const bgItems = perItemCounts(bg);
    expect(bgItems.size).toBeGreaterThanOrEqual(30);
    for (const n of bgItems.values()) expect(n).toBeGreaterThanOrEqual(40);
    const bgMean = mean(bg.map((r) => r.rating));
    expect(bgMean).toBeGreaterThan(4.05);
    expect(bgMean).toBeLessThan(4.4);
  });
});

function perItemCounts(rs: Review[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rs) m.set(r.item_id, (m.get(r.item_id) ?? 0) + 1);
  return m;
}

describe('category_gap', () => {
  it('X and Y: identical counts and rating multisets (raw mean 4.0) in categories with different baselines (>= 20 items each)', () => {
    const m = meta('category_gap');
    const x = reviewsOf(m.roles.X);
    const y = reviewsOf(m.roles.Y);
    expect(x).toHaveLength(12);
    expect(sortedRatings(x)).toEqual(sortedRatings(y));
    expect(mean(x.map((r) => r.rating))).toBe(4);
    expect(x[0].category).not.toBe(y[0].category);
    const low = built.reviews.filter((r) => r.category === x[0].category);
    const high = built.reviews.filter((r) => r.category === y[0].category);
    expect(perItemCounts(low).size).toBeGreaterThanOrEqual(20);
    expect(perItemCounts(high).size).toBeGreaterThanOrEqual(20);
    expect(mean(high.map((r) => r.rating)) - mean(low.map((r) => r.rating))).toBeGreaterThan(0.8);
  });
});

describe('burst traps', () => {
  function checkBurst(name: TrapName, rating: number | null, n: number, verifiedShare: number, days: number) {
    const m = meta(name);
    const burst = m.burst;
    expect(burst).not.toBeNull();
    if (!burst) return m;
    const injected = built.reviews.filter((r) => burst.review_ids.includes(r.review_id));
    expect(injected).toHaveLength(n);
    if (rating !== null) expect(injected.every((r) => r.rating === rating)).toBe(true);
    expect(burst.verified_share).toBeCloseTo(verifiedShare, 12);
    expect(injected.filter((r) => r.verified === true).length).toBe(Math.round(n * verifiedShare));
    expect(burst.end_day - burst.start_day + 1).toBe(days);
    for (const r of injected) {
      expect(day(r)).toBeGreaterThanOrEqual(burst.start_day);
      expect(day(r)).toBeLessThanOrEqual(burst.end_day);
      expect(isInjectedReviewId(r.review_id)).toBe(true);
    }
    return m;
  }

  it('burst targets have >= 90 days of history and >= 60 organic reference reviews in the 90 days before', () => {
    for (const name of ['promo_burst', 'verified_promo', 'bomb', 'reach_11_windows', 'viral_organic'] as const) {
      const b = meta(name).burst;
      expect(b?.history_days ?? 0).toBeGreaterThanOrEqual(90);
      expect(b?.reference_in_90d ?? 0).toBeGreaterThanOrEqual(60);
      // Recompute from the data, not just the metadata.
      const organic = reviewsOf(meta(name).roles.target).filter((r) => !isInjectedReviewId(r.review_id));
      const start = b?.start_day ?? 0;
      expect(organic.filter((r) => day(r) >= start - 90 && day(r) < start).length).toBeGreaterThanOrEqual(60);
    }
  });

  it('promo_burst: 25 five-stars in 2 days, 80% unverified, bottom-quartile item', () => {
    const m = checkBurst('promo_burst', 5, 25, 0.2, 2);
    expect(m.target_expected_mean ?? 99).toBeLessThan(m.category_quartiles?.q1 ?? -1);
  });

  it('verified_promo: same shape, 100% verified', () => {
    const m = checkBurst('verified_promo', 5, 25, 1, 2);
    expect(m.target_expected_mean ?? 99).toBeLessThan(m.category_quartiles?.q1 ?? -1);
  });

  it('bomb: 25 one-stars in 2 days on a top-quartile item', () => {
    const m = checkBurst('bomb', 1, 25, 0.2, 2);
    expect(m.target_expected_mean ?? -1).toBeGreaterThan(m.category_quartiles?.q3 ?? 99);
  });

  it('drip: the same 25 five-stars spread over ~60 days, never more than one per day', () => {
    const m = checkBurst('drip', 5, 25, 0.2, 58);
    const injected = built.reviews.filter((r) => m.burst?.review_ids.includes(r.review_id));
    expect(Math.max(...perDay(injected).values())).toBe(1);
    expect(m.outcome).toBe('not_flagged_expected_miss');
  });

  it('viral_organic: 60 reviews in 2 days drawn exactly from the item’s own distribution', () => {
    const m = checkBurst('viral_organic', null, 60, 0.85, 2);
    const injected = built.reviews.filter((r) => m.burst?.review_ids.includes(r.review_id));
    expect(Math.abs(mean(injected.map((r) => r.rating)) - (m.target_expected_mean ?? 0))).toBeLessThan(0.05);
    expect(m.outcome).toBe('volume_only_unflagged');
  });

  it('new_item_launch: all reviews within the last 10 days before asOf', () => {
    const rs = reviewsOf(meta('new_item_launch').roles.target);
    expect(rs).toHaveLength(40);
    for (const r of rs) expect(r.ts).toBeGreaterThanOrEqual(ASOF - 10 * DAY_MS);
  });

  it('sparse_mad_zero: one review every 6 days (zero-median 1-day baselines), then a 4-review day', () => {
    const rs = reviewsOf(meta('sparse_mad_zero').roles.target);
    expect(rs).toHaveLength(40);
    const counts = perDay(rs);
    expect(Math.max(...counts.values())).toBe(4);
    expect(Array.from(counts.values()).filter((c) => c > 1)).toEqual([4]);
  });

  it('eligibility_edge: exactly 30 reviews, the first 35 days before asOf', () => {
    const rs = reviewsOf(meta('eligibility_edge').roles.target);
    expect(rs).toHaveLength(30);
    expect(Math.min(...rs.map(day))).toBe(ANCHOR - 35);
  });

  it('reach_11_windows: a one-day burst on a 1-review-per-day item trips exactly 11 candidate windows (L = 1, 3, 7)', () => {
    const m = checkBurst('reach_11_windows', 5, 40, 0.5, 1);
    const rs = reviewsOf(m.roles.target);
    const counts = perDay(rs);
    const first = Math.min(...counts.keys());
    for (let d = first; d <= ANCHOR - 1; d++) expect(counts.get(d) ?? 0).toBeGreaterThanOrEqual(1);
    const burstDay = m.burst?.start_day ?? 0;
    expect(counts.get(burstDay)).toBe(41);
    expect(ANCHOR - 1 - burstDay).toBeGreaterThanOrEqual(6);
    // Candidate windows end on review days; count those containing the burst day.
    let windows = 0;
    for (const L of [1, 3, 7]) {
      for (const end of counts.keys()) if (burstDay >= end - L + 1 && burstDay <= end) windows++;
    }
    expect(windows).toBe(11);
    expect(m.burst?.expected_candidate_windows).toBe(11);
  });
});

describe('quality_drift + stable sparse control', () => {
  it('drift item: 180 old reviews then 60 recent ones from a better distribution; truth per period', () => {
    const m = meta('quality_drift');
    const rs = reviewsOf(m.roles.drift);
    expect(rs).toHaveLength(240);
    const changeDay = m.numbers.change_day;
    const before = rs.filter((r) => day(r) < changeDay);
    const after = rs.filter((r) => day(r) >= changeDay);
    expect(before).toHaveLength(180);
    expect(after).toHaveLength(60);
    expect(mean(after.map((r) => r.rating))).toBeGreaterThan(mean(before.map((r) => r.rating)) + 1);
    const truth = built.truth.find((t) => t.item_id === m.roles.drift);
    expect(truth?.periods).toHaveLength(2);
    expect(truth?.periods?.[0].review_count).toBe(180);
    expect(truth?.periods?.[1].review_count).toBe(60);
    expect(truth?.review_count).toBe(240);
  });

  it('stable sparse item: 8 reviews spread over two years with mean exactly 4.25', () => {
    const rs = reviewsOf(meta('quality_drift').roles.stable_sparse);
    expect(rs).toHaveLength(8);
    expect(mean(rs.map((r) => r.rating))).toBe(4.25);
    expect(Math.max(...rs.map(day)) - Math.min(...rs.map(day))).toBeGreaterThan(600);
    expect(rs.every((r) => r.verified === true)).toBe(true);
    const ordered = rs.slice().sort((a, b) => a.ts - b.ts);
    expect(ordered.map((r) => r.rating)).toEqual([5, 5, 5, 4, 4, 4, 4, 3]);
    expect(ordered.slice(0, 7).every((r) => day(r) === ANCHOR - 730)).toBe(true);
    const background = built.reviews.filter((r) => r.category === 'trap:recency_stable' && r.item_id !== rs[0].item_id);
    expect(new Set(background.map((r) => r.item_id)).size).toBe(20);
    expect(background.every((r) => r.rating === 4)).toBe(true);
  });
});
