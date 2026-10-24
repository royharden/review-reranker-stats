import { buildDataset } from '../data/dataset';
import { cmp, fnv1a32, canonicalJson, sha256Hex } from '../stats/hash';
import type { Dataset, EvalConfig, RankConfig, Review } from '../types';
import type { SynthTruth } from '../synth/generator';
import type { Partition } from './schema';

export type Cutoffs = Readonly<Record<string, number>>;
export interface SourceIdentity {
  kind: 'synthetic' | 'local-csv'; sourceHash: string; sourceName: string; asOf: number;
  calendar: { start: number; end: number } | null; generatorVersion: string | null;
}
/** The tag is a boundary guarantee checked by makeDevData, not a cast on an arbitrary catalogue. */
export interface DevData { kind: 'dev-only-1'; dataset: Dataset; source: SourceIdentity; truth: SynthTruth | null }
export function partitionOf(itemId: string, config: Pick<EvalConfig, 'split_seed' | 'dev_share'>): Partition {
  return fnv1a32(config.split_seed + ':' + itemId) / 4294967296 < config.dev_share ? 'dev' : 'heldout';
}
export async function subset(dataset: Dataset, reviews: readonly Review[], config: RankConfig, asOf = dataset.asOf): Promise<Dataset> {
  return buildDataset(reviews, { asOf, verifiedColumnPresent: dataset.verifiedColumnPresent, insufficientBelow: config.insufficient_below });
}
export async function makeDevData(dataset: Dataset, source: SourceIdentity, protocol: EvalConfig, rank: RankConfig,
  truth: SynthTruth | null = null): Promise<DevData> {
  // This constructor refuses a mixed/held-out set. Partitioning belongs to the storage preparation boundary.
  if (dataset.reviews.some((r) => partitionOf(r.item_id, protocol) !== 'dev')) throw new Error('DevData contains held-out items');
  if (source.asOf !== dataset.asOf) throw new Error('Source reference time mismatch');
  const ids = new Set(dataset.items.keys());
  return { kind: 'dev-only-1', dataset: await subset(dataset, dataset.reviews, rank), source,
    truth: truth === null ? null : { ...truth, items: truth.items.filter((item) => ids.has(item.item_id)) } };
}
export function chooseCutoffs(dev: DevData, config: EvalConfig): Cutoffs {
  // Category names are untrusted data; __proto__ must be an ordinary own key.
  const cutoffs: Record<string, number> = Object.create(null);
  const calendar = dev.source.calendar;
  if (dev.source.kind === 'synthetic') {
    if (calendar === null || !(calendar.end > calendar.start)) throw new Error('Synthetic source requires its declared calendar');
    const cutoff = Math.floor(calendar.start + config.cutoff_fraction * (calendar.end - calendar.start));
    for (const category of dev.dataset.categories) cutoffs[category] = cutoff;
  } else {
    for (const category of dev.dataset.categories) {
      const times = dev.dataset.reviews.filter((r) => r.category === category).map((r) => r.ts);
      if (times.length === 0) continue;
      let first = times[0]; let last = times[0];
      for (const ts of times) { first = Math.min(first, ts); last = Math.max(last, ts); }
      cutoffs[category] = Math.floor(first + config.cutoff_fraction * (last - first));
    }
  }
  return cutoffs;
}
export interface TimeSplit { pre: Dataset; later: readonly Review[]; unknownCategories: string[] }
export async function splitTime(dataset: Dataset, cutoffs: Cutoffs, config: RankConfig): Promise<TimeSplit> {
  const pre: Review[] = []; const later: Review[] = []; const unknown = new Set<string>();
  for (const review of dataset.reviews) {
    // Frozen JSON objects regain Object.prototype, so reject inherited values too.
    const cutoff = Object.hasOwn(cutoffs, review.category) ? cutoffs[review.category] : undefined;
    if (cutoff === undefined || !Number.isFinite(cutoff)) { unknown.add(review.category); continue; }
    // Strictly before the cutoff fits. A review at the boundary is a target and can never fit a prior.
    (review.ts < cutoff ? pre : later).push(review);
  }
  // Recency and detector history are evaluated at the scoring boundary, never at the end of the target period.
  // Per-category scoring clocks are handled by scoring each category at its own cutoff (see runner).
  const values = Object.values(cutoffs);
  return { pre: await subset(dataset, pre, config, values.length ? Math.max(...values) : dataset.asOf), later,
    unknownCategories: Array.from(unknown).sort(cmp) };
}
export async function splitIdentity(dev: DevData, protocol: EvalConfig, cutoffs: Cutoffs): Promise<string> {
  return sha256Hex(canonicalJson({ source: dev.source, seed: protocol.split_seed, share: protocol.dev_share,
    devItems: Array.from(dev.dataset.items.keys()).sort(cmp), cutoffs }));
}
