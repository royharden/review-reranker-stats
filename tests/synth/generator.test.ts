import { describe, expect, it } from 'vitest';
import { datasetHash } from '../../src/core/data/hash';
import { DAY_MS, distMean, generateCatalogue, itemSchedule, utcWeekday } from '../../src/core/synth/generator';
import { PROFILES } from '../../src/core/synth/profiles';
import type { SynthProfile } from '../../src/core/synth/profiles';
import { buildSampleReviews } from '../../src/core/synth/sample';

const demo = PROFILES.demo;
const SEED = 33;
const gen = generateCatalogue(demo, SEED);

function countsByItem(reviews: ReadonlyArray<{ item_id: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of reviews) m.set(r.item_id, (m.get(r.item_id) ?? 0) + 1);
  return m;
}

describe('generator determinism (PLAN M2 acceptance 4)', () => {
  it('same seed -> identical reviews, truth and datasetHash', async () => {
    const again = generateCatalogue(demo, SEED);
    expect(again.reviews).toEqual(gen.reviews);
    expect(again.truth).toEqual(gen.truth);
    expect(await datasetHash(again.reviews)).toBe(await datasetHash(gen.reviews));
  }, 60_000);

  it('a different seed -> a different datasetHash', async () => {
    const other = generateCatalogue(demo, SEED + 1);
    expect(await datasetHash(other.reviews)).not.toBe(await datasetHash(gen.reviews));
  }, 60_000);
});

describe('demo profile shape', () => {
  it('declares a calendar range and a fixed asOf = calendar end; eval is the larger profile', () => {
    expect(demo.calendar.start).toBe(Date.UTC(2023, 0, 1));
    expect(demo.calendar.end).toBe(Date.UTC(2025, 0, 1));
    expect(demo.asOf).toBe(demo.calendar.end);
    expect(PROFILES.eval.itemCount).toBeGreaterThan(demo.itemCount);
    expect(PROFILES.eval.asOf).toBe(PROFILES.eval.calendar.end);
    expect(PROFILES.eval.includeTraps).toBe(false);
  });

  it('~400 items in 6 categories with different baselines, ~40k reviews', () => {
    expect(demo.categories).toHaveLength(6);
    expect(new Set(demo.categories.map((c) => c.baseline)).size).toBe(6);
    const items = countsByItem(gen.reviews);
    expect(items.size).toBe(400);
    expect(gen.reviews.length).toBeGreaterThan(28_000);
    expect(gen.reviews.length).toBeLessThan(52_000);
    expect(new Set(gen.reviews.map((r) => r.category))).toEqual(new Set(demo.categories.map((c) => c.name)));
  });

  it('bounded integer ratings, timestamps inside the declared calendar, unique ids, both verified values', () => {
    const ids = new Set<string>();
    let verified = 0;
    for (const r of gen.reviews) {
      expect([1, 2, 3, 4, 5]).toContain(r.rating);
      expect(Number.isInteger(r.ts)).toBe(true);
      expect(r.ts).toBeGreaterThanOrEqual(demo.calendar.start);
      expect(r.ts).toBeLessThan(demo.asOf);
      ids.add(r.review_id);
      if (r.verified === true) verified++;
      expect(r.verified === true || r.verified === false).toBe(true);
    }
    expect(ids.size).toBe(gen.reviews.length);
    expect(verified).toBeGreaterThan(0);
    expect(verified).toBeLessThan(gen.reviews.length);
  });

  it('heavy-tailed per-item counts, with sparse (cold-start / insufficient) items', () => {
    const counts = Array.from(countsByItem(gen.reviews).values()).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(5 * median);
    expect(counts.filter((c) => c < 3).length).toBeGreaterThan(0);
    expect(counts.filter((c) => c <= 10).length).toBeGreaterThan(20);
  });

  it('weekday seasonality: weekend share is above the uniform 2/7', () => {
    // Weights Sun 1.3 ... Sat 1.3 -> expected weekend share 2.6 / 7.45 = 0.349 vs 0.286 uniform.
    const weekend = gen.reviews.filter((r) => {
      const d = utcWeekday(r.ts);
      return d === 0 || d === 6;
    }).length;
    expect(weekend / gen.reviews.length).toBeGreaterThan(0.32);
  });

  it('utcWeekday: 1970-01-01 was a Thursday, 2025-01-01 a Wednesday', () => {
    expect(utcWeekday(0)).toBe(4);
    expect(utcWeekday(Date.UTC(2025, 0, 1))).toBe(3);
    expect(utcWeekday(Date.UTC(2025, 0, 1) + DAY_MS - 1)).toBe(3);
  });
});

describe('id-based count schedule, assigned before ratings', () => {
  it('per-item counts, launches and drift membership do not change when rating parameters change', () => {
    const shifted: SynthProfile = {
      ...demo,
      ratingKernelSd: 0.6,
      categories: demo.categories.map((c) => ({ ...c, baseline: c.baseline - 0.7, verifiedShare: 0.5 })),
    };
    const other = generateCatalogue(shifted, SEED);
    expect(countsByItem(other.reviews)).toEqual(countsByItem(gen.reviews));
    for (let i = 0; i < demo.itemCount; i++) expect(itemSchedule(shifted, SEED, i)).toEqual(itemSchedule(demo, SEED, i));
  });
});

describe('truth (separate object; F9 definitions)', () => {
  it('one truth entry per item, computed exactly from the item distribution', () => {
    expect(gen.truth.kind).toBe('synth-truth-1');
    expect('reviews' in gen.truth).toBe(false);
    const counts = countsByItem(gen.reviews);
    expect(gen.truth.items.map((t) => t.item_id)).toEqual(Array.from(counts.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const t of gen.truth.items) {
      expect(t.review_count).toBe(counts.get(t.item_id));
      const sum = t.distribution.reduce((s, p) => s + p, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-12);
      expect(Math.abs(t.expected_mean - distMean(t.distribution))).toBeLessThan(1e-12);
      expect(Math.abs(t.p_top_box - (t.distribution[3] + t.distribution[4]))).toBeLessThan(1e-12);
      expect(t.expected_mean).toBeGreaterThanOrEqual(1);
      expect(t.expected_mean).toBeLessThanOrEqual(5);
    }
  });

  it('drift items carry per-period truth whose counts add up and whose periods are ordered', () => {
    const drift = gen.truth.items.filter((t) => t.periods !== null);
    expect(drift.length).toBeGreaterThan(0);
    for (const t of drift) {
      const periods = t.periods ?? [];
      expect(periods).toHaveLength(2);
      expect(periods[0].review_count + periods[1].review_count).toBe(t.review_count);
      expect(periods[0].end).toBe(periods[1].start);
      expect(periods[0].expected_mean).not.toBe(periods[1].expected_mean);
      const mixed = (periods[0].review_count * periods[0].expected_mean + periods[1].review_count * periods[1].expected_mean) / t.review_count;
      expect(Math.abs(mixed - t.expected_mean)).toBeLessThan(1e-9);
    }
  });

  it('category baselines show up in truth: books (4.3) above beauty (3.6)', () => {
    const avg = (cat: string) => {
      const xs = gen.truth.items.filter((t) => t.category === cat).map((t) => t.expected_mean);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    expect(avg('books')).toBeGreaterThan(avg('beauty') + 0.2);
  });
});

describe('sample assembly', () => {
  it('demo sample = catalogue + traps, with truth for every item', () => {
    const sample = buildSampleReviews('demo');
    expect(sample.seed).toBe(demo.defaultSeed);
    expect(sample.traps.length).toBeGreaterThan(0);
    const items = new Set(sample.reviews.map((r) => r.item_id));
    expect(new Set(sample.truth.items.map((t) => t.item_id))).toEqual(items);
  }, 60_000);
});
