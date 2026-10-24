import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { contextFromDetection, detectBursts, detectorConfigHash } from '../../src/core/burst/detect';
import { DAY_MS, dailyCounts } from '../../src/core/burst/dailyCounts';
import { scanVolume } from '../../src/core/burst/robustZ';
import { buildTraps } from '../../src/core/synth/traps';
import type { TrapName } from '../../src/core/synth/traps';
import type { DetectionResult } from '../../src/core/burst/types';
import { ASOF } from '../helpers';

const config = defaultConfig();
const traps = buildTraps(ASOF, 33);
const target = (name: TrapName) => traps.meta.find((m) => m.name === name)!.roles.target;
const dataset = () => buildDataset(traps.reviews, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
// The same unmodified source feeds every test; these test bodies have not been executed in Dirty Mode.
let cached: Promise<DetectionResult> | undefined;
const detection = () => cached ??= dataset().then((ds) => detectBursts(ds, config));

describe('named burst traps at defaults (B = 1000, Holm alpha = 0.01)', () => {
  it('promo_burst, verified_promo and bomb are flagged by both volume and rating shift', async () => {
    const result = await detection();
    for (const name of ['promo_burst', 'verified_promo', 'bomb'] as const) {
      const planted = traps.meta.find((m) => m.name === name)!.burst!;
      const flagged = result.spans.find((span) => span.itemId === target(name) && span.status === 'flagged' && span.spanStart <= planted.start_day && span.spanEnd >= planted.end_day);
      expect(flagged).toBeDefined();
      expect(flagged!.maxZ).toBeGreaterThanOrEqual(3.5);
      expect(flagged!.pValue).toBeLessThanOrEqual(flagged!.holmThreshold!);
      expect(flagged!.referenceCount).toBeGreaterThanOrEqual(10);
      expect(flagged!.shift! * (name === 'bomb' ? -1 : 1)).toBeGreaterThan(0);
    }
  }, 120_000);

  it('viral_organic is volume-only, ratings unchanged, with no downweight', async () => {
    const result = await detection();
    const spans = result.spans.filter((span) => span.itemId === target('viral_organic'));
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((span) => span.status === 'volume-only')).toBe(true);
    expect(spans.some((span) => span.status === 'flagged')).toBe(false);
    const ds = await dataset();
    const weights = contextFromDetection(ds, result, config).reviewBurstWeight!;
    for (const i of ds.items.get(target('viral_organic'))!.reviewIdx) expect(weights[i]).toBe(1);
  }, 120_000);

  it('new_item_launch is unassessable with named too-young reason; drip is not flagged', async () => {
    const result = await detection();
    const launch = result.items.find((item) => item.itemId === target('new_item_launch'))!;
    expect(launch.status).toBe('unassessable');
    expect(launch.reasons).toContain('too-young');
    expect(result.spans.some((span) => span.itemId === target('drip') && span.status === 'flagged')).toBe(false);
  }, 120_000);

  it('sparse_mad_zero has finite robust z with scale >= 1', async () => {
    const ds = await dataset();
    const item = ds.items.get(target('sparse_mad_zero'))!;
    const scan = scanVolume(item.item_id, dailyCounts(ds, item), config);
    expect(scan.candidates.length).toBeGreaterThan(0);
    for (const candidate of scan.candidates) { expect(Number.isFinite(candidate.z)).toBe(true); expect(candidate.scale).toBeGreaterThanOrEqual(1); }
  });

  it('eligibility_edge yields a flag or a named unassessable reason, never a silent clean verdict', async () => {
    const result = await detection();
    const item = result.items.find((x) => x.itemId === target('eligibility_edge'))!;
    const flagged = result.spans.some((span) => span.itemId === item.itemId && span.status === 'flagged');
    expect(flagged || (item.status === 'unassessable' && item.reasons.length > 0)).toBe(true);
  }, 120_000);

  it('11 overlapping candidate windows merge into one span and reach the corrected threshold', async () => {
    const result = await detection();
    const item = result.items.find((x) => x.itemId === target('reach_11_windows'))!;
    const spans = result.spans.filter((span) => span.itemId === item.itemId);
    expect(item.candidateWindowCount).toBe(11);
    expect(spans).toHaveLength(1);
    expect(spans[0].windows).toHaveLength(11);
    expect(spans[0].status).toBe('flagged');
    expect(spans[0].pValue).toBeGreaterThanOrEqual(1 / 1001);
    expect(spans[0].pValue).toBeLessThanOrEqual(0.01);
  }, 120_000);
});

describe('detector determinism, sparse work, caps and identity', () => {
  it('shuffled accepted input produces identical output, including permutation p-values and hashes', async () => {
    const reversed = await buildDataset([...traps.reviews].reverse(), { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    expect(await detectBursts(reversed, config)).toEqual(await detection());
  }, 120_000);

  it('multi-year gaps allocate sparse review-day counts and bounded baseline work', async () => {
    const rows = traps.reviews.filter((r) => r.item_id === target('sparse_mad_zero')).map((r, i) => ({ ...r, ts: i < 20 ? Date.UTC(1980, 0, 1) : Date.UTC(2024, 11, 1) }));
    const ds = await buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 });
    const series = dailyCounts(ds, ds.items.values().next().value!);
    expect(series.days).toHaveLength(2);
    expect(series.prefix).toHaveLength(3);
    const result = await detectBursts(ds, config);
    expect(result.diagnostics.candidateDays).toBe(2);
    expect(result.diagnostics.baselineWindowsEvaluated).toBeLessThanOrEqual(2 * 3 * 90);
  });

  it('dataset cap propagates partial and keeps untested spans visibly marked', async () => {
    const result = await detectBursts(await dataset(), { ...config, max_perm_tests: 1 });
    expect(result.status).toBe('partial');
    expect(result.testedSpanCount).toBeLessThanOrEqual(1);
    expect(result.spans.some((span) => span.status === 'not-tested' && span.reason === 'dataset-cap')).toBe(true);
    expect(result.items.some((item) => item.status === 'partial' && item.reasons.includes('dataset-cap'))).toBe(true);
  });

  it('detector identity ignores ranking parameters but includes asOf and detector thresholds', async () => {
    const hash = await detectorConfigHash(config, ASOF);
    expect(await detectorConfigHash({ ...config, half_life_days: 7, burst_weight: 0.8, rank_key: 'lower_endpoint' }, ASOF)).toBe(hash);
    expect(await detectorConfigHash({ ...config, z_min: 4 }, ASOF)).not.toBe(hash);
    expect(await detectorConfigHash(config, ASOF + DAY_MS)).not.toBe(hash);
  });
});
