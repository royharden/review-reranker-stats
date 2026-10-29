import { expect, it } from 'vitest';
import { buildDataset } from '../../src/core/data/dataset';
import { itemTimeline } from '../../src/worker/details';
import type { Review } from '../../src/core/types';
it('compact timeline conserves counts, bounds multi-year gaps and leaves rolling means absent across gaps', async () => {
  const rows: Review[] = [
    { review_id: 'a', item_id: 'i', category: 'c', rating: 1, ts: 0, verified: null },
    { review_id: 'b', item_id: 'i', category: 'c', rating: 5, ts: 10_000 * 86_400_000, verified: null },
  ];
  const ds = await buildDataset(rows, { asOf: rows[1].ts, verifiedColumnPresent: false, insufficientBelow: 3 });
  const item = ds.items.get('i'); if (!item) throw new Error('Missing fixture item');
  const detail = itemTimeline(ds, item);
  expect(detail.bins.length).toBeLessThanOrEqual(160); expect(detail.bins.reduce((n, b) => n + b.count, 0)).toBe(2);
  expect(detail.bins.at(-1)?.rollingMean).toBe(5); expect(detail.bins.some((b) => b.rollingMean === null)).toBe(true);
});
