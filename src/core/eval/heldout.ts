import { buildDataset } from '../data/dataset';
import { canonicalJson } from '../stats/hash';
import type { Dataset, Review } from '../types';
import type { SynthTruth } from '../synth/generator';
import { assertTimestamp, validateManifest } from './manifest';
import type { EvalManifest, ReadReceipt } from './manifest';
import { partitionOf } from './split';
import type { SourceIdentity } from './split';

export interface HeldOutPayload { schema: 'sealed-heldout-1'; source: SourceIdentity; reviews: Review[]; truth: SynthTruth | null }
export interface HeldOutStorage {
  /** Implementations must serialize the entire operation for this manifest, including reads and writes. */
  exclusive<T>(manifestPath: string, action: () => Promise<T>): Promise<T>;
  readManifest(manifestPath: string): Promise<unknown>;
  writeManifest(manifestPath: string, value: EvalManifest): Promise<void>;
  /** This method is the only final-data read. It is invoked AFTER the opened receipt is durably written. */
  readHeldOut(manifest: EvalManifest): Promise<HeldOutPayload>;
}
export interface HeldOutRead { dataset: Dataset; truth: SynthTruth | null; manifest: EvalManifest; attempt: number }
function validateReviews(reviews: readonly Review[], manifest: EvalManifest): void {
  const ids = new Set<string>(); const categories = new Map<string, string>();
  for (const r of reviews) {
    if (!r || typeof r.review_id !== 'string' || !r.review_id || ids.has(r.review_id) || typeof r.item_id !== 'string' || !r.item_id
      || typeof r.category !== 'string' || !r.category || ![1, 2, 3, 4, 5].includes(r.rating)
      || !Number.isSafeInteger(r.ts) || r.ts > manifest.frozen.source.asOf
      || !(r.verified === null || typeof r.verified === 'boolean') || partitionOf(r.item_id, manifest.frozen.evalConfig) !== 'heldout') throw new Error('Invalid sealed held-out review');
    const category = categories.get(r.item_id); if (category !== undefined && category !== r.category) throw new Error('Sealed item category changed');
    ids.add(r.review_id); categories.set(r.item_id, r.category);
  }
}
/** Intentionally not exported from eval/index.ts; tuning has no loader or storage dependency. */
export async function loadHeldOut(options: { final: boolean; manifestPath: string; storage: HeldOutStorage; at: string; reread?: boolean }): Promise<HeldOutRead> {
  if (options.final !== true) throw new Error('Held-out data requires --final');
  assertTimestamp(options.at);
  return options.storage.exclusive(options.manifestPath, async () => {
    let manifest = await validateManifest(await options.storage.readManifest(options.manifestPath));
    const previous = manifest.readReceipts.filter((r) => r.phase === 'opened').length;
    if (previous > 0 && options.reread !== true) throw new Error('Held-out data has already been read or attempted; use --reread to disclose another read');
    if (previous === 0 && options.reread === true) throw new Error('--reread requires a previous final read');
    const attempt = previous + 1;
    const receipt = (phase: ReadReceipt['phase'], detail: string): ReadReceipt => ({ sequence: manifest.readReceipts.length + 1,
      attempt, phase, at: options.at, reread: previous > 0, frozenHash: manifest.frozenHash, detail });
    manifest = { ...manifest, readReceipts: [...manifest.readReceipts, receipt('opened', 'Final read authorised against frozen dev settings.')] };
    await options.storage.writeManifest(options.manifestPath, manifest);
    let dataset: Dataset; let truth: SynthTruth | null;
    try {
      const payload = await options.storage.readHeldOut(manifest);
      if (payload.schema !== 'sealed-heldout-1' || canonicalJson(payload.source) !== canonicalJson(manifest.frozen.source)
        || !Array.isArray(payload.reviews)) throw new Error('Held-out source identity mismatch');
      validateReviews(payload.reviews, manifest);
      dataset = await buildDataset(payload.reviews, { asOf: payload.source.asOf, verifiedColumnPresent: true,
        insufficientBelow: manifest.frozen.rankConfig.insufficient_below });
      // Truth is a separate reporting sidecar. It is never supplied to scoring/detection.
      if (payload.truth !== null && (payload.truth.kind !== 'synth-truth-1' || !Array.isArray(payload.truth.items)
        || payload.truth.items.some((i) => !dataset.items.has(i.item_id)))) throw new Error('Invalid held-out truth sidecar');
      truth = payload.truth;
    } catch (error) {
      manifest = { ...manifest, readReceipts: [...manifest.readReceipts, receipt('failed', 'Final data read failed; this attempt remains consumed.')] };
      await options.storage.writeManifest(options.manifestPath, manifest);
      throw error;
    }
    manifest = { ...manifest, readReceipts: [...manifest.readReceipts, receipt('loaded', 'Loaded ' + dataset.items.size + ' sealed items.')] };
    // A failed acknowledgement write is not a data-read failure. Durable state may be opened or loaded, and both
    // remain consumed, valid attempts; never append failed after an in-memory (or durably written) loaded receipt.
    await options.storage.writeManifest(options.manifestPath, manifest);
    return { dataset, truth, manifest, attempt };
  });
}
