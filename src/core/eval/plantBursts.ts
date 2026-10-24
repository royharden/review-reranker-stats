import { buildDataset } from '../data/dataset';
import { cmp } from '../stats/hash';
import { rngFrom } from '../stats/prng';
import type { Dataset, RankConfig, Rating, Review } from '../types';
import type { Cutoffs } from './split';

const DAY = 86_400_000;
export type AttackType = 'promo_burst' | 'verified_promo' | 'bomb';
export type ShapeFamily = 'dev' | 'heldout';
export const ATTACK_TYPES: readonly AttackType[] = ['promo_burst', 'verified_promo', 'bomb'];
export interface AttackLabel {
  attack: AttackType; itemId: string; category: string; direction: 'promo' | 'bomb';
  start: number; end: number; reviewIds: string[]; shape: string; family: ShapeFamily;
}
/** Labels live ONLY here; Review/Dataset carry no planted, attack, truth, or fraud fields. */
export interface AttackTruth { kind: 'attack-truth-1'; family: ShapeFamily; seed: number; attacks: AttackLabel[] }
export interface PlantedDataset { dataset: Dataset; truth: AttackTruth }

export async function plantBursts(clean: Dataset, seed: number, family: ShapeFamily, cutoffs: Cutoffs, config: RankConfig,
  targetIds: ReadonlySet<string> = new Set(clean.items.keys())): Promise<PlantedDataset> {
  const injected: Review[] = []; const attacks: AttackLabel[] = []; const existing = new Set(clean.reviews.map((r) => r.review_id));
  for (const category of clean.categories) {
    const items = Array.from(clean.items.values()).filter((i) => i.category === category && targetIds.has(i.item_id))
      .map((item) => ({ item, mean: item.reviewIdx.reduce((s, i) => s + clean.reviews[i].rating, 0) / item.n }));
    items.sort((a, b) => a.mean - b.mean || cmp(a.item.item_id, b.item.item_id));
    const quartile = Math.floor(items.length / 4);
    // Two disjoint bottom-quartile targets plus one top-quartile target. Small categories are disclosed by empty support.
    if (quartile < 2 || !Number.isFinite(cutoffs[category])) continue;
    const bottom = items.slice(0, quartile); const top = items.slice(items.length - quartile);
    const rng = rngFrom(seed, 'attack-targets', family, category);
    const first = Math.floor(rng() * bottom.length);
    const second = (first + 1 + Math.floor(rng() * (bottom.length - 1))) % bottom.length;
    const targets = [bottom[first], bottom[second], top[Math.floor(rng() * top.length)]];
    ATTACK_TYPES.forEach((attack, a) => {
      const target = targets[a].item; const direction = attack === 'bomb' ? 'bomb' : 'promo';
      const stream = rngFrom(seed, 'attack-shape', family, attack, target.item_id);
      const duration = family === 'dev' ? (attack === 'bomb' ? 3 : 1) : (attack === 'verified_promo' ? 7 : 5);
      const n = family === 'dev' ? 50 + Math.floor(stream() * 31) : 35 + Math.floor(stream() * 41);
      const end = Math.floor(cutoffs[category] / DAY) - 2;
      const start = end - duration + 1;
      const ids: string[] = [];
      for (let j = 0; j < n; j++) {
        // Held-out verified promos are split into two lobes, with an empty interior; soft promos include 4-star ratings.
        const offset = family === 'heldout' && attack === 'verified_promo'
          ? (j % 2 === 0 ? 0 : duration - 1) : Math.floor(stream() * duration);
        const rating: Rating = attack === 'bomb' ? (family === 'heldout' && j % 3 === 0 ? 2 : 1)
          : family === 'heldout' && attack === 'promo_burst' && j % 4 !== 0 ? 4 : 5;
        const id = JSON.stringify(['injected', seed, family, attack, target.item_id, j]);
        if (existing.has(id)) throw new Error('Injected review id collides with clean data'); existing.add(id); ids.push(id);
        injected.push({ review_id: id, item_id: target.item_id, category, rating,
          ts: (start + offset) * DAY + Math.floor(stream() * DAY),
          verified: attack === 'verified_promo' || family === 'heldout' && j % 5 === 0 });
      }
      attacks.push({ attack, itemId: target.item_id, category, direction, start, end, reviewIds: ids.sort(cmp), family,
        shape: family === 'dev' ? 'hard-' + duration + '-day' : attack === 'verified_promo' ? 'split-7-day' : attack === 'bomb' ? 'mixed-low-5-day' : 'soft-4-star-5-day' });
    });
  }
  const dataset = await buildDataset([...clean.reviews, ...injected], { asOf: clean.asOf,
    verifiedColumnPresent: clean.verifiedColumnPresent, insufficientBelow: config.insufficient_below });
  return { dataset, truth: { kind: 'attack-truth-1', family, seed, attacks } };
}
