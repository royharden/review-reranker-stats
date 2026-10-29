import { describe, expect, it } from 'vitest';
import { defaultConfig, validateConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { defaultEvalConfig, validateEvalConfig } from '../../src/core/eval/config';
import { loadHeldOut } from '../../src/core/eval/heldout';
import type { HeldOutPayload, HeldOutStorage } from '../../src/core/eval/heldout';
import { freezeDevelopment, validateManifest } from '../../src/core/eval/manifest';
import type { EvalManifest } from '../../src/core/eval/manifest';
import { chooseCutoffs, makeDevData, partitionOf, splitTime } from '../../src/core/eval/split';
import type { Cutoffs, SourceIdentity } from '../../src/core/eval/split';
import type { Partition } from '../../src/core/eval/schema';
import { metricValue, resampledItems } from '../../src/core/eval/temporal';
import { tuneDevelopment } from '../../src/core/eval/tune';
import { identityDraw, occurrenceIndices } from '../../src/core/stats/bootstrap';
import { canonicalJson, cmp, sha256Hex } from '../../src/core/stats/hash';
import type { EvalConfig, Review } from '../../src/core/types';

const AT = '2026-10-24T00:00:00.000Z';

function itemFor(partition: Partition, protocol: EvalConfig): string {
  for (let i = 0; i < 10_000; i++) {
    const id = 'core-rework-' + i;
    if (partitionOf(id, protocol) === partition) return id;
  }
  throw new Error('No fixture item in requested partition');
}

async function devFixture(kind: SourceIdentity['kind'] = 'local-csv') {
  const rank = defaultConfig(); const protocol = defaultEvalConfig();
  const itemId = itemFor('dev', protocol);
  const reviews: Review[] = [0, 50, 100].map((ts) => ({ review_id: 'r' + ts, item_id: itemId,
    category: '__proto__', rating: 3 as const, ts, verified: true }));
  const dataset = await buildDataset(reviews, { asOf: 100, verifiedColumnPresent: true,
    insufficientBelow: rank.insufficient_below });
  const source: SourceIdentity = { kind, sourceHash: dataset.datasetHash, sourceName: 'core-rework', asOf: 100,
    calendar: kind === 'synthetic' ? { start: 0, end: 100 } : null,
    generatorVersion: kind === 'synthetic' ? 'core-rework-generator-1' : null };
  const dev = await makeDevData(dataset, source, protocol, rank);
  return { dataset, dev, rank, protocol, source };
}

async function rehashManifest(manifest: EvalManifest): Promise<EvalManifest> {
  const frozen = { ...manifest.frozen, configHash: await sha256Hex(canonicalJson({
    rank: manifest.frozen.rankConfig, eval: manifest.frozen.evalConfig })) };
  return { ...manifest, frozen, frozenHash: await sha256Hex(canonicalJson(frozen)) };
}

describe('M5 cutoff dictionary regressions', () => {
  it.each(['local-csv', 'synthetic'] as const)('keeps __proto__ pre/later reviews and its frozen cutoff for %s', async (kind) => {
    // what_bug_this_catches: assigning __proto__ on {} discards its numeric cutoff and silently drops every review.
    const { dataset, dev, rank, protocol } = await devFixture(kind);
    const cutoffs = chooseCutoffs(dev, protocol);
    expect(Object.getPrototypeOf(cutoffs)).toBeNull();
    expect(Object.hasOwn(cutoffs, '__proto__')).toBe(true);
    expect(cutoffs['__proto__']).toBe(80);
    const split = await splitTime(dataset, cutoffs, rank);
    expect(split.pre.reviews.map((r) => r.review_id).sort(cmp)).toEqual(['r0', 'r50']);
    expect(split.later.map((r) => r.review_id)).toEqual(['r100']);
    expect(split.pre.reviews.length + split.later.length).toBe(dataset.reviews.length);
    expect(split.unknownCategories).toEqual([]);

    const tuned = await tuneDevelopment({ dev, rank, protocol });
    const frozen = await freezeDevelopment(tuned, protocol, AT);
    const restored = await validateManifest(JSON.parse(JSON.stringify(frozen)));
    expect(Object.hasOwn(restored.frozen.cutoffs, '__proto__')).toBe(true);
    expect(restored.frozen.cutoffs['__proto__']).toBe(80);
    const restoredSplit = await splitTime(dataset, restored.frozen.cutoffs, rank);
    expect(restoredSplit.pre.reviews).toEqual(split.pre.reviews);
    expect(restoredSplit.later).toEqual(split.later);
    expect(restoredSplit.unknownCategories).toEqual([]);
  });

  it('treats a numeric inherited cutoff as unknown rather than as a frozen category', async () => {
    // what_bug_this_catches: direct bracket lookup accepts inherited numeric values on a restored/foreign object.
    const rank = defaultConfig();
    const dataset = await buildDataset([{ review_id: 'inherited-r', item_id: 'inherited-item', category: 'inherited',
      rating: 3, ts: 10, verified: null }], { asOf: 100, verifiedColumnPresent: true,
      insufficientBelow: rank.insufficient_below });
    const cutoffs: Cutoffs = Object.create({ inherited: 80 });
    const split = await splitTime(dataset, cutoffs, rank);
    expect(split.pre.reviews).toEqual([]);
    expect(split.later).toEqual([]);
    expect(split.unknownCategories).toEqual(['inherited']);
  });
});

describe('M5 bootstrap NDCG tie-order regressions', () => {
  it.each([
    ['prefix and internal space', ['a b', 'a']],
    ['escaped characters', ['a\\b', 'a"b', 'a\nb', 'a b', 'a']],
    ['UTF-16 code units', ['a\uffff', 'a\ud800', 'a\ud800\udc00', 'a\udc00', 'a\u0000', 'a']],
  ] as const)('keeps identity-resample NDCG equal to the original point metric for %s', (_label, ids) => {
    // what_bug_this_catches: JSON tuple IDs reorder prefixes/spaces/escapes, changing NDCG solely by resampling identity.
    const items = ids.map((id, i) => ({ id, score: 1, target: 1 + 4 * i / (ids.length - 1) }));
    const sampled = resampledItems(items, identityDraw(items.length));
    expect(sampled.slice().sort((a, b) => cmp(a.id, b.id)).map((item) => item.target))
      .toEqual(items.slice().sort((a, b) => cmp(a.id, b.id)).map((item) => item.target));
    expect(metricValue(sampled, 'ndcg@10', 2)).toBe(metricValue(items, 'ndcg@10', 2));
  });

  it('keeps duplicate draws as distinct occurrences and sorts occurrence 10 after occurrence 9', () => {
    // what_bug_this_catches: occurrence keys must neither deduplicate draws nor use unpadded lexical numeric order.
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i === 0 ? 'a' : 'a!' + i, score: 1, target: i === 0 ? 5 : 1 }));
    const indices = Array<number>(12).fill(0);
    const sampled = resampledItems(items, { indices, occurrences: occurrenceIndices(indices) });
    expect(sampled).toHaveLength(12);
    expect(new Set(sampled.map((item) => item.id)).size).toBe(12);
    expect(sampled.map((item) => item.target)).toEqual(Array<number>(12).fill(5));
    expect(sampled.map((item) => item.id).sort(cmp)).toEqual(sampled.map((item) => item.id));
    expect(metricValue(sampled, 'ndcg@10')).toBe(1);
  });
});

describe('M5 held-out loaded-receipt persistence regressions', () => {
  it.each([false, true])('leaves a valid consumed attempt and permits disclosed reread when loaded-write persisted=%s', async (persistBeforeThrow) => {
    // what_bug_this_catches: catching the loaded receipt write appends loaded -> failed and permanently poisons the ledger.
    const { dev, rank, protocol, source } = await devFixture();
    const manifest = await freezeDevelopment(await tuneDevelopment({ dev, rank, protocol }), protocol, AT);
    let durable: unknown = JSON.parse(JSON.stringify(manifest));
    let failLoadedWrite = true; let heldOutReads = 0;
    const payload: HeldOutPayload = { schema: 'sealed-heldout-1', source, truth: null,
      reviews: [{ review_id: 'held-r', item_id: itemFor('heldout', protocol), category: '__proto__',
        rating: 4, ts: 10, verified: true }] };
    const storage: HeldOutStorage = {
      exclusive: async (_path, action) => action(),
      readManifest: async () => JSON.parse(JSON.stringify(durable)),
      writeManifest: async (_path, value) => {
        const bytes: unknown = JSON.parse(JSON.stringify(value));
        if (failLoadedWrite && value.readReceipts.at(-1)?.phase === 'loaded') {
          failLoadedWrite = false;
          if (persistBeforeThrow) durable = bytes;
          throw new Error('loaded receipt write failed');
        }
        durable = bytes;
      },
      readHeldOut: async () => { heldOutReads++; return payload; },
    };
    const options = { final: true, manifestPath: 'memory-manifest', storage, at: AT };
    await expect(loadHeldOut(options)).rejects.toThrow('loaded receipt write failed');
    const afterFailure = await validateManifest(durable);
    expect(afterFailure.readReceipts.map((receipt) => receipt.phase))
      .toEqual(persistBeforeThrow ? ['opened', 'loaded'] : ['opened']);
    expect(heldOutReads).toBe(1);

    await expect(loadHeldOut(options)).rejects.toThrow('use --reread');
    expect(heldOutReads).toBe(1);
    const reread = await loadHeldOut({ ...options, reread: true });
    expect(reread.attempt).toBe(2);
    expect(heldOutReads).toBe(2);
    const restored = await validateManifest(durable);
    const secondAttempt = restored.readReceipts.filter((receipt) => receipt.attempt === 2);
    expect(secondAttempt.map((receipt) => receipt.phase)).toEqual(['opened', 'loaded']);
    expect(secondAttempt.every((receipt) => receipt.reread)).toBe(true);
    expect(restored.readReceipts.some((receipt) => receipt.phase === 'failed')).toBe(false);
  });
});

describe('M5 evaluation confidence-level contracts', () => {
  it('accepts 95% bootstrap confidence and rejects other evaluation levels', () => {
    // what_bug_this_catches: arbitrary bootstrap levels produce CIs that do not match the evaluation's 95% claim.
    const protocol = defaultEvalConfig();
    expect(validateEvalConfig(protocol).bootstrap_level).toBe(0.95);
    expect(() => validateEvalConfig({ ...protocol, bootstrap_level: 0.9 })).toThrow('Invalid evaluation protocol');
  });

  it('requires 90% rank intervals and 95% bootstrap confidence at tune and freeze boundaries', async () => {
    // what_bug_this_catches: typed callers can bypass protocol loading or mutate a tuned proposal before freezing.
    const { dev, rank, protocol } = await devFixture();
    const changedRank = { ...rank, interval_level: 0.95 };
    expect(validateConfig(changedRank).ok).toBe(true); // The interactive rank config remains editable.
    await expect(tuneDevelopment({ dev, rank: changedRank, protocol })).rejects.toThrow('90% rank intervals');
    await expect(tuneDevelopment({ dev, rank, protocol: { ...protocol, bootstrap_level: 0.9 } }))
      .rejects.toThrow('Invalid evaluation protocol');
    const tuned = await tuneDevelopment({ dev, rank, protocol });
    await expect(freezeDevelopment({ ...tuned, config: { ...tuned.config, interval_level: 0.95 } }, protocol, AT))
      .rejects.toThrow('90% rank intervals');
    await expect(freezeDevelopment(tuned, { ...protocol, bootstrap_level: 0.9 }, AT))
      .rejects.toThrow('Invalid evaluation protocol');
  });

  it('rejects disallowed frozen interval levels even with recomputed valid hashes', async () => {
    // what_bug_this_catches: a self-consistent disk manifest still must obey the report's 90%/95% protocol.
    const { dev, rank, protocol } = await devFixture();
    const manifest = await freezeDevelopment(await tuneDevelopment({ dev, rank, protocol }), protocol, AT);
    const changedRank = await rehashManifest({ ...manifest, frozen: { ...manifest.frozen,
      rankConfig: { ...manifest.frozen.rankConfig, interval_level: 0.95 } } });
    await expect(validateManifest(changedRank)).rejects.toThrow('90% rank intervals');
    const changedBootstrap = await rehashManifest({ ...manifest, frozen: { ...manifest.frozen,
      evalConfig: { ...manifest.frozen.evalConfig, bootstrap_level: 0.9 } } });
    await expect(validateManifest(changedBootstrap)).rejects.toThrow('Invalid evaluation protocol');
  });
});
