import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { meanRanker } from '../../src/core/rankers/mean';
import { METHOD_ORDER, getRanker, registeredRankers } from '../../src/core/rankers/registry';
import { emptyRankContext } from '../../src/core/rankers/types';
import type { Rating, Review } from '../../src/core/types';
import { ASOF } from '../helpers';

function review(id: string, item: string, rating: Rating, category = 'c1'): Review {
  return { review_id: id, item_id: item, category, rating, ts: 1_700_000_000_000, verified: true };
}

async function dataset(rs: Review[]) {
  return buildDataset(rs, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
}

describe('mean ranker (PLAN C4, M2 acceptance 6)', () => {
  it('conforms to Ranker: one result per item, score = raw mean, lo/hi null, no interval claimed', async () => {
    const ds = await dataset([review('a', 'x', 5), review('b', 'x', 4), review('c', 'y', 3)]);
    const out = meanRanker.rank(ds, defaultConfig(), emptyRankContext());
    expect(meanRanker.id).toBe('mean');
    expect(meanRanker.interval).toEqual({ quantity: 'not-applicable', level: null });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ item_id: 'x', category: 'c1', score: 4.5, lo: null, hi: null, n: 2, n_eff: 2 });
    expect(out[0].parts).toMatchObject({ raw_mean: 4.5, lo: null, hi: null, posterior_mean: null, detector_status: 'not-run' });
    expect(out[0].parts.rank_by_method.mean).toBe(1);
    expect(out[1].parts.rank_by_method.mean).toBe(2);
  });

  it('ties are sorted by score desc then item_id asc by code unit (not locale)', async () => {
    // 'B' (0x42) < 'a' (0x61) by code unit; a locale-aware comparison would put 'a' first.
    const ds = await dataset([review('1', 'a', 4), review('2', 'B', 4), review('3', 'c', 5)]);
    const out = meanRanker.rank(ds, defaultConfig(), emptyRankContext());
    expect(out.map((r) => r.item_id)).toEqual(['c', 'B', 'a']);
  });

  it('is deterministic and uses every review (no exclusion)', async () => {
    const rs = [review('1', 'a', 1), review('2', 'a', 5), review('3', 'b', 3)];
    const ds = await dataset(rs);
    const ds2 = await dataset([rs[2], rs[0], rs[1]]);
    const o1 = meanRanker.rank(ds, defaultConfig(), emptyRankContext());
    const o2 = meanRanker.rank(ds2, defaultConfig(), emptyRankContext());
    expect(o1).toEqual(o2);
    expect(o1.reduce((s, r) => s + r.n, 0)).toBe(rs.length);
  });

  it('within-category percentile is display-only and per category', async () => {
    const ds = await dataset([review('1', 'a', 5, 'k1'), review('2', 'b', 3, 'k1'), review('3', 'c', 4, 'k2')]);
    const out = meanRanker.rank(ds, defaultConfig(), emptyRankContext());
    const byId = new Map(out.map((r) => [r.item_id, r]));
    expect(byId.get('a')?.parts.within_category_percentile).toBe(1);
    expect(byId.get('b')?.parts.within_category_percentile).toBe(0);
    expect(byId.get('c')?.parts.within_category_percentile).toBeNull();
  });

  it('an empty dataset returns an empty result', async () => {
    expect(meanRanker.rank(await dataset([]), defaultConfig(), emptyRankContext())).toEqual([]);
  });
});

describe('ranker registry', () => {
  it('registers mean and lists rankers in METHOD_ORDER', () => {
    expect(getRanker('mean')).toBe(meanRanker);
    const ids = registeredRankers().map((r) => r.id);
    expect(ids).toContain('mean');
    expect(ids).toEqual(METHOD_ORDER.filter((m) => ids.includes(m)));
  });
});
