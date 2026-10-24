import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/core/data/dataset';
import { canonicalDatasetString, datasetHash } from '../../src/core/data/hash';
import type { Review } from '../../src/core/types';
import { ASOF, csv, ingest } from '../helpers';

const reviews: Review[] = [
  { review_id: 'b', item_id: 'i2', category: 'c', rating: 5, ts: 3, verified: true },
  { review_id: 'a', item_id: 'i1', category: 'c', rating: 4, ts: 2, verified: null },
  { review_id: 'c', item_id: 'i1', category: 'c', rating: 2, ts: 1, verified: false, text: 'hello' },
];

describe('datasetHash', () => {
  it('is SHA-256 of canonical JSON of [review_id, item_id, category, rating, ts, verified] sorted by review_id', async () => {
    expect(canonicalDatasetString(reviews)).toBe('[["a","i1","c",4,2,null],["b","i2","c",5,3,true],["c","i1","c",2,1,false]]');
    expect(await datasetHash(reviews)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on input order or on text, and changes with any rating', async () => {
    const shuffled = [reviews[2], reviews[0], reviews[1]];
    const noText = reviews.map((r) => ({ ...r, text: undefined }));
    expect(await datasetHash(shuffled)).toBe(await datasetHash(reviews));
    expect(await datasetHash(noText)).toBe(await datasetHash(reviews));
    const changed = reviews.map((r) => (r.review_id === 'a' ? { ...r, rating: 5 as const } : r));
    expect(await datasetHash(changed)).not.toBe(await datasetHash(reviews));
  });

  it('two files with the same accepted reviews in different row order give the same hash', async () => {
    const rows = ['r1,it-1,cat-a,4,2024-06-01T10:00:00Z,true,', 'r2,it-2,cat-a,5,1717236000000,,', 'r3,it-1,cat-a,2,2024-06-03T10:00:00+00:00,0,'];
    const a = await ingest(csv(rows));
    const b = await ingest(csv([rows[2], rows[0], rows[1]]));
    expect(a.report.datasetHash).toBe(b.report.datasetHash);
  });
});

describe('buildDataset', () => {
  it('canonical review order, item index sorted by (ts, review_id), sorted categories, insufficient label', async () => {
    const ds = await buildDataset(reviews, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    expect(ds.reviews.map((r) => r.review_id)).toEqual(['a', 'b', 'c']);
    const i1 = ds.items.get('i1');
    expect(i1?.reviewIdx.map((i) => ds.reviews[i].review_id)).toEqual(['c', 'a']);
    expect(i1).toMatchObject({ n: 2, insufficient: true, firstTs: 1, lastTs: 2, category: 'c' });
    expect(Array.from(ds.items.keys())).toEqual(['i1', 'i2']);
    expect(ds.categories).toEqual(['c']);
    expect(ds.asOf).toBe(ASOF);
  });

  it('an empty input gives an empty dataset, not an error', async () => {
    const ds = await buildDataset([], { asOf: ASOF, verifiedColumnPresent: false, insufficientBelow: 3 });
    expect(ds.items.size).toBe(0);
    expect(ds.categories).toEqual([]);
    expect(ds.datasetHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
