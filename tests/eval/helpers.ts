import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { generateCatalogue } from '../../src/core/synth/generator';
import { getProfile } from '../../src/core/synth/profiles';
import { defaultEvalConfig } from '../../src/core/eval/config';
import { makeDevData, partitionOf } from '../../src/core/eval/split';
import type { SourceIdentity } from '../../src/core/eval/split';
import { tuneDevelopment } from '../../src/core/eval/tune';
import { freezeDevelopment } from '../../src/core/eval/manifest';
import type { EvalManifest } from '../../src/core/eval/manifest';
import type { HeldOutPayload, HeldOutStorage } from '../../src/core/eval/heldout';

export const AT = '2026-10-24T12:00:00.000Z';
export function smallConfig() {
  const rank = { ...defaultConfig(), permutations: 9, max_perm_tests: 20 };
  const protocol = { ...defaultEvalConfig(), cutoff_fraction: 0.5, min_later_reviews: 1, bootstrap_resamples: 20,
    support_gate: { min_items_per_category: 1, min_target_items: 2 } };
  return { rank, protocol };
}
/** Designed ~2k-review fixture (48 items, 30..60 reviews/item), generated only when future tests run. */
export async function prepared() {
  const { rank, protocol } = smallConfig();
  const profile = { ...getProfile('eval'), itemCount: 48, driftShare: 0,
    counts: { sparseShare: 0, sparseMax: 1, paretoScale: 30, paretoShape: 1.8, maxCount: 60 } };
  const generated = generateCatalogue(profile, protocol.generator_seed);
  const full = await buildDataset(generated.reviews, { asOf: profile.asOf, verifiedColumnPresent: true, insufficientBelow: 3 });
  const source: SourceIdentity = { kind: 'synthetic', sourceHash: full.datasetHash, sourceName: 'smoke', asOf: profile.asOf,
    calendar: profile.calendar, generatorVersion: 's33-generator-1' };
  const devReviews = full.reviews.filter((r) => partitionOf(r.item_id, protocol) === 'dev');
  const heldReviews = full.reviews.filter((r) => partitionOf(r.item_id, protocol) === 'heldout');
  const devSet = await buildDataset(devReviews, { asOf: source.asOf, verifiedColumnPresent: true, insufficientBelow: 3 });
  const dev = await makeDevData(devSet, source, protocol, rank, generated.truth);
  const payload: HeldOutPayload = { schema: 'sealed-heldout-1', source, reviews: heldReviews,
    truth: { ...generated.truth, items: generated.truth.items.filter((i) => partitionOf(i.item_id, protocol) === 'heldout') } };
  const tuned = await tuneDevelopment({ dev, rank, protocol }); const manifest = await freezeDevelopment(tuned, protocol, AT);
  return { full, dev, payload, tuned, manifest, rank, protocol };
}
export class MemoryStorage implements HeldOutStorage {
  manifest: EvalManifest; payload: HeldOutPayload; reads = 0; writes: EvalManifest[] = []; locked = false;
  constructor(manifest: EvalManifest, payload: HeldOutPayload) { this.manifest = structuredClone(manifest); this.payload = structuredClone(payload); }
  async exclusive<T>(_path: string, action: () => Promise<T>): Promise<T> {
    if (this.locked) throw new Error('Concurrent admission'); this.locked = true;
    try { return await action(); } finally { this.locked = false; }
  }
  async readManifest(): Promise<unknown> { return structuredClone(this.manifest); }
  async writeManifest(_path: string, manifest: EvalManifest): Promise<void> {
    this.manifest = structuredClone(manifest); this.writes.push(structuredClone(manifest));
  }
  async readHeldOut(): Promise<HeldOutPayload> {
    this.reads++;
    if (this.manifest.readReceipts.at(-1)?.phase !== 'opened') throw new Error('Read before durable receipt');
    return structuredClone(this.payload);
  }
}
