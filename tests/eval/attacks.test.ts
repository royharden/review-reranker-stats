// UNRUN: no generated fixture or claimed detector result exists until this test is executed later.
import { describe, expect, it } from 'vitest';
import { plantBursts } from '../../src/core/eval/plantBursts';
import { directedDamage, damageCheck, rankQualities } from '../../src/core/eval/robustness';
import { splitTime } from '../../src/core/eval/split';
import { prepared } from './helpers';

describe('independent attack labels and direction-normalised damage (UNRUN)', () => {
  it('labels every injected review in a separate sidecar, changes held-out shape families, and leaves clean data unchanged', async () => {
    const f = await prepared(); const split = await splitTime(f.full, f.tuned.cutoffs, f.tuned.config);
    const originalHash = split.pre.datasetHash;
    const a = await plantBursts(split.pre, 44, 'dev', f.tuned.cutoffs, f.tuned.config);
    const again = await plantBursts(split.pre, 44, 'dev', f.tuned.cutoffs, f.tuned.config);
    const held = await plantBursts(split.pre, 44, 'heldout', f.tuned.cutoffs, f.tuned.config);
    expect(a.dataset.datasetHash).toBe(again.dataset.datasetHash); expect(a.truth).toEqual(again.truth);
    expect(a.truth.attacks.length).toBeGreaterThan(0);
    expect(new Set(a.truth.attacks.map((x) => x.shape))).not.toEqual(new Set(held.truth.attacks.map((x) => x.shape)));
    const ids = new Set(a.truth.attacks.flatMap((x) => x.reviewIds));
    expect(ids.size).toBe(a.dataset.reviews.length - split.pre.reviews.length);
    expect(a.dataset.reviews.filter((r) => ids.has(r.review_id)).every((r) => r.ts < f.tuned.cutoffs[r.category])).toBe(true);
    expect(a.dataset.reviews.every((r) => !('planted' in r) && !('truth' in r) && !('attack' in r))).toBe(true);
    expect(split.pre.datasetHash).toBe(originalHash);
  });
  it('a downward bomb has positive damage while signed lift remains negative; zero or negative baseline damage never passes', () => {
    expect(directedDamage(0.9, 0.2, 'bomb')).toEqual({ signedLift: -0.7, damage: 0.7 });
    expect(damageCheck(-0.1, 0, 0.5)).toBe('not assessable');
    expect(damageCheck(-0.1, -0.2, 0.5)).toBe('not assessable');
    expect(damageCheck(0.2, 0.5, 0.5)).toBe('met');
    expect(damageCheck(0.3, 0.5, 0.5)).toBe('not met');
  });
  it('attack rank qualities use score midranks rather than item-id ordering', async () => {
    const f = await prepared(); const first = f.tuned.scored.rankings.get('mean')?.[0]; if (!first) throw new Error('Missing fixture row');
    const scores = rankQualities(new Map([['mean', [{ ...first, item_id: 'z', score: 4 }, { ...first, item_id: 'a', score: 4 }, { ...first, item_id: 'low', score: 1 }]]]));
    expect(scores.get('mean')?.get('a')).toBe(0.75); expect(scores.get('mean')?.get('z')).toBe(0.75);
  });
});
