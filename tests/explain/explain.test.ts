import { expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { registeredRankers } from '../../src/core/rankers/registry';
import { emptyRankContext } from '../../src/core/rankers/types';
import { explain } from '../../src/core/explain/templates';
import { grounded } from '../../src/core/explain/grounded';
import { fmt } from '../../src/core/explain/fmt';
import { buildTraps } from '../../src/core/synth/traps';
import { ingestCsvText } from '../../src/core/data/parse';
import { ASOF, options, readFixture } from '../helpers';

it('grounded passes for every fixture item and method, using formatted-to-formatted numeric evidence', async () => {
  const traps = buildTraps(ASOF, 42);
  const parsed = await ingestCsvText(readFixture('parsing-traps.csv'), options());
  const ds = await buildDataset([...traps.reviews, ...(parsed.dataset?.reviews ?? [])], { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
  for (const ranker of registeredRankers()) for (const result of ranker.rank(ds, defaultConfig(), emptyRankContext())) {
    expect(grounded(explain(result.parts), result.parts), `${ranker.id}:${result.item_id}`).toBe(true);
    expect(grounded('Estimated mean 123456789.00 stars.', result.parts)).toBe(false);
  }
}, 60_000);
it('fmt has one fixed policy, finite guards, and normalizes negative zero', () => {
  expect(fmt('raw_mean', 4.12345)).toBe('4.12'); expect(fmt('n', 3)).toBe('3');
  expect(fmt('weights.burst_downweighted_count', 12)).toBe('12'); expect(fmt('sigma2', 0.05678)).toBe('0.057');
  expect(fmt('raw_mean', -0.0001)).toBe('0.00'); expect(fmt('lo', null)).toBe('—'); expect(fmt('n', Infinity)).toBe('—');
});
