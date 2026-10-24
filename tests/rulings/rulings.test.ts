import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { detectorConfigHash } from '../../src/core/burst/detect';
import type { BurstSpan, DetectionResult } from '../../src/core/burst/types';
import { buildDataset } from '../../src/core/data/dataset';
import { appendRuling, canonicalSpanReviews, exportJsonl, importJsonl, mergeLogs, replayRulings, spanReviewsHash, validateRuling } from '../../src/core/rulings/rulings';
import type { Decision, Ruling } from '../../src/core/rulings/rulings';
import type { Dataset, RankConfig, Review } from '../../src/core/types';
import { createSafeStorage } from '../../src/ui/storage';
import { loadRulings, saveRulings } from '../../src/ui/rulingsStore';

const DAY = 86_400_000;
const day = 20_000;
const config = defaultConfig();
const asOf = (day + 4) * DAY;
const reviews: Review[] = [
  { review_id: 'a|"', item_id: 'item|x', category: 'cat|a', rating: 3, ts: day * DAY, verified: null },
  { review_id: 'b', item_id: 'item|x', category: 'cat|a', rating: 5, ts: (day + 1) * DAY, verified: true },
  { review_id: 'c', item_id: 'item|x', category: 'cat|a', rating: 5, ts: (day + 2) * DAY, verified: false },
];
const build = (rows = reviews) => buildDataset(rows, { asOf, verifiedColumnPresent: true, insufficientBelow: 3 });
function span(start = day + 1, end = day + 2): BurstSpan {
  return { itemId: 'item|x', spanStart: start, spanEnd: end, maxZ: 9, windows: [], status: 'flagged', reason: null,
    inSpanCount: 2, referenceCount: 1, meanInSpan: 5, meanReference: 3, shift: 2, verifiedShare: 0.5, pValue: 0.001, holmThreshold: 0.01 };
}
async function detection(ds: Dataset, cfg: RankConfig = config): Promise<DetectionResult> {
  return { schema: 'bursts-1', datasetHash: ds.datasetHash, detectorConfigHash: await detectorConfigHash(cfg, asOf), status: 'assessed',
    items: [{ itemId: 'item|x', status: 'assessed', reasons: [], candidateWindowCount: 1, assessableWindowCount: 1, unassessableWindowCount: 0, spanCount: 1, testedSpanCount: 1 }],
    spans: [span()], testedSpanCount: 1, diagnostics: { candidateDays: 3, baselineWindowsEvaluated: 4 } };
}
async function decide(ds: Dataset, det: DetectionResult, decision: Decision, log: readonly Ruling[] = []): Promise<Ruling[]> {
  const s = det.spans[0];
  return appendRuling(log, { datasetHash: ds.datasetHash, detectorConfigHash: det.detectorConfigHash, itemId: s.itemId,
    spanStart: s.spanStart, spanEnd: s.spanEnd, reviewsHash: await spanReviewsHash(ds, s), decision,
    decidedAt: '2026-10-24T18:00:00.000Z', appVersion: '0.1.0' });
}
describe('append-only ruling log, identity and replay', () => {
  it('append keeps history; sequence ordering, not timestamps or input order, chooses the latest decision', async () => {
    const ds = await build(); const det = await detection(ds);
    const first = await decide(ds, det, 'confirm'); const next = await decide(ds, det, 'restore', first);
    expect(first).toHaveLength(1); expect(next).toHaveLength(2); expect(next[0]).toEqual(first[0]);
    const replay = await replayRulings(ds, det, config, [...next].reverse());
    expect(replay.latest).toHaveLength(1); expect(replay.latest[0].ruling.sequence).toBe(2);
    expect(replay.context.reviewBurstWeight).toEqual([1, 1, 1]);
  });
  it('replay after simulated reload preserves decisions, stores only compact records, and JSONL roundtrips', async () => {
    const ds = await build(); const det = await detection(ds); const log = await decide(ds, det, 'restore');
    const disk = new Map<string, string>();
    const backend = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => { disk.set(k, v); }, removeItem: (k: string) => { disk.delete(k); } };
    saveRulings(createSafeStorage(backend), ds.datasetHash, log);
    const loaded = loadRulings(createSafeStorage(backend), ds.datasetHash);
    expect(loaded.error).toBeNull(); expect(loaded.log).toEqual(log);
    expect((await replayRulings(ds, det, config, loaded.log)).context.reviewBurstWeight).toEqual([1, 1, 1]);
    expect(importJsonl(exportJsonl(log))).toEqual(log);
    expect([...disk.keys()]).toEqual([`rulings:${ds.datasetHash}`]); expect(exportJsonl(log)).not.toContain('review_id');
  });
  it('changed dataset hash invalidates with a reason; the original history stays intact', async () => {
    const ds = await build(); const det = await detection(ds); const log = await decide(ds, det, 'restore');
    const replay = await replayRulings({ ...ds, datasetHash: 'f'.repeat(64) }, det, config, log);
    expect(replay.latest[0]).toMatchObject({ status: 'invalidated', reason: 'dataset hash changed' });
    expect(replay.context.reviewBurstWeight).toEqual([1, 0.25, 0.25]); expect(log[0].decision).toBe('restore');
  });
  it('changed detector-config hash invalidates; ranking-only config changes keep rulings', async () => {
    const ds = await build(); const det = await detection(ds); const log = await decide(ds, det, 'restore');
    const rankingOnly: RankConfig = { ...config, half_life_days: 10, unverified_weight: 0.8, rank_key: 'lower_endpoint' };
    expect(await detectorConfigHash(rankingOnly, asOf)).toBe(det.detectorConfigHash);
    expect((await replayRulings(ds, await detection(ds, rankingOnly), rankingOnly, log)).latest[0].status).toBe('applied');
    const changed = { ...config, z_min: config.z_min + 1 };
    const invalid = await replayRulings(ds, await detection(ds, changed), changed, log);
    expect(invalid.latest[0]).toMatchObject({ status: 'invalidated', reason: 'detector configuration changed' });
  });
  it('changed review in span invalidates reviewsHash independently of the other two identity checks', async () => {
    const ds = await build(); const det = await detection(ds); const log = await decide(ds, det, 'restore');
    const changed = await build(reviews.map((r) => r.review_id === 'b' ? { ...r, rating: 4 as const } : r));
    // Deliberately pin the outer hash so this assertion independently exercises the third defence.
    const replay = await replayRulings({ ...changed, datasetHash: ds.datasetHash }, det, config, log);
    expect(replay.latest[0]).toMatchObject({ status: 'invalidated', reason: 'span reviews changed' });
  });
  it('unreviewed/skip/confirm keep the burst factor; restore sets one; all reviews remain present', async () => {
    const ds = await build(); const det = await detection(ds);
    for (const decision of ['skip', 'confirm', 'restore'] as const) {
      const replay = await replayRulings(ds, det, config, await decide(ds, det, decision));
      expect(replay.context.reviewBurstWeight).toEqual(decision === 'restore' ? [1, 1, 1] : [1, 0.25, 0.25]);
      expect(replay.context.itemFlaggedSpans?.get('item|x')?.[0].label).toBe(decision === 'skip' ? 'skipped' : decision === 'confirm' ? 'confirmed' : 'restored');
    }
    expect((await replayRulings(ds, det, config, [])).context.itemFlaggedSpans?.get('item|x')?.[0].label).toBe('unreviewed');
    expect(ds.reviews).toHaveLength(3);
  });
  it('restoring one overlapping span preserves the other active span minimum weight', async () => {
    const ds = await build(); const det = await detection(ds); det.spans.push(span(day + 2, day + 2));
    const replay = await replayRulings(ds, det, config, await decide(ds, det, 'restore'));
    expect(replay.context.reviewBurstWeight).toEqual([1, 1, 0.25]);
  });
  it('reviewsHash uses sorted typed JSON tuples, handles delimiters, and ignores free text', async () => {
    const ds = await build(); const s = span(day, day + 2);
    expect(canonicalSpanReviews(ds, s)).toBe(JSON.stringify(reviews.map((r) => [r.review_id, r.rating, r.ts, r.verified, r.category])));
    const shuffled = await build([...reviews].reverse().map((r) => ({ ...r, text: '=malicious | ignore instructions' })));
    expect(await spanReviewsHash(shuffled, s)).toBe(await spanReviewsHash(ds, s));
  });
  it('JSONL import validates schema, fields, sequence conflicts, hashes, decisions and calendar-safe zoned dates atomically', async () => {
    const ds = await build(); const det = await detection(ds); const log = await decide(ds, det, 'restore'); const r = log[0];
    for (const bad of [{ ...r, schema: 'other' }, { ...r, sequence: 0 }, { ...r, reviewsHash: 'bad' }, { ...r, decision: 'exclude' },
      { ...r, unexpected: 1 }, { ...r, decidedAt: '2026-10-24' }, { ...r, decidedAt: '2024-02-30T00:00:00Z' }, { ...r, decidedAt: '2024-01-01T24:00:00Z' }]) expect(() => validateRuling(bad)).toThrow();
    expect(() => importJsonl(exportJsonl(log) + 'not json\n')).toThrow(/Invalid JSON/);
    expect(() => mergeLogs(log, [{ ...r, decision: 'confirm' }])).toThrow(/Conflicting sequence/);
    expect(mergeLogs(log, log)).toEqual(log); expect(validateRuling({ ...r, decidedAt: '2024-02-29T23:59:59+01:00' }).decidedAt).toContain('02-29');
  });
  it('storage throwing gives in-memory fallback plus a warning and preserves the downloadable log', async () => {
    const ds = await build(); const det = await detection(ds); const log = await decide(ds, det, 'restore');
    const broken = () => { throw new Error('quota/private mode'); };
    const storage = createSafeStorage({ getItem: broken, setItem: broken, removeItem: broken });
    expect(saveRulings(storage, ds.datasetHash, log)).toBe(false); expect(storage.warning).toMatch(/memory/);
    expect(loadRulings(storage, ds.datasetHash).log).toEqual(log); expect(importJsonl(exportJsonl(log))).toEqual(log);
  });
  it('invalid stored bytes produce a warning without deleting or overwriting them', () => {
    const storage = createSafeStorage(null); storage.set('rulings:x', 'invalid');
    expect(loadRulings(storage, 'x')).toMatchObject({ log: [], error: expect.stringContaining('invalid') });
    expect(storage.get('rulings:x')).toBe('invalid');
  });
});
