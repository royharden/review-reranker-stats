// Append-only, portable local decisions. No clock or browser state is read here.
import { reviewsInDays } from '../burst/dailyCounts';
import { parseTimestamp } from '../data/validate';
import type { DetectionResult } from '../burst/types';
import type { RankContext } from '../rankers/types';
import { burstWeightsForSpans } from '../rankers/weights';
import { canonicalJson, cmp, sha256Hex } from '../stats/hash';
import type { Dataset, FlaggedSpanRef, RankConfig, SpanRulingLabel } from '../types';

export type Decision = 'confirm' | 'restore' | 'skip';
export interface Ruling {
  schema: 'rulings-1'; ruleVersion: 1; sequence: number; kind: 'burst';
  datasetHash: string; detectorConfigHash: string; itemId: string;
  spanStart: number; spanEnd: number; reviewsHash: string; decision: Decision;
  decidedAt: string; appVersion: string;
}
export interface SpanIdentity { itemId: string; spanStart: number; spanEnd: number; reviewsHash: string }
export type InvalidationReason = 'dataset hash changed' | 'detector configuration changed' | 'span reviews changed';
export interface ReplayedRuling { ruling: Ruling; status: 'applied' | 'invalidated'; reason: InvalidationReason | null }
export interface RulingReplay { context: RankContext; latest: ReplayedRuling[]; identities: SpanIdentity[] }
export const MAX_RULINGS_BYTES = 5_000_000;
export const MAX_RULINGS = 20_000;
const FIELDS = ['schema', 'ruleVersion', 'sequence', 'kind', 'datasetHash', 'detectorConfigHash', 'itemId', 'spanStart', 'spanEnd', 'reviewsHash', 'decision', 'decidedAt', 'appVersion'];
const HASH = /^[a-f0-9]{64}$/;
const DAY_BOUND = 100_000_000;
export function rulingKey(span: Pick<SpanIdentity, 'itemId' | 'spanStart' | 'spanEnd'>): string {
  return JSON.stringify([span.itemId, span.spanStart, span.spanEnd]);
}
export function validateRuling(value: unknown): Ruling {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Ruling must be an object');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== FIELDS.length || Object.keys(v).some((key) => !FIELDS.includes(key))) throw new Error('Ruling has missing or unknown fields');
  if (v.schema !== 'rulings-1' || v.ruleVersion !== 1 || v.kind !== 'burst') throw new Error('Unsupported ruling version or kind');
  if (typeof v.sequence !== 'number' || !Number.isSafeInteger(v.sequence) || v.sequence < 1) throw new Error('Invalid ruling sequence');
  for (const key of ['datasetHash', 'detectorConfigHash', 'reviewsHash']) {
    if (typeof v[key] !== 'string' || !HASH.test(v[key])) throw new Error(`Invalid ${key}`);
  }
  if (typeof v.itemId !== 'string' || v.itemId.trim().length === 0 || v.itemId.length > 100_000) throw new Error('Invalid itemId');
  if (typeof v.spanStart !== 'number' || !Number.isInteger(v.spanStart) || Math.abs(v.spanStart) > DAY_BOUND ||
      typeof v.spanEnd !== 'number' || !Number.isInteger(v.spanEnd) || Math.abs(v.spanEnd) > DAY_BOUND || v.spanEnd < v.spanStart) throw new Error('Invalid span days');
  if (v.decision !== 'confirm' && v.decision !== 'restore' && v.decision !== 'skip') throw new Error('Invalid decision');
  if (typeof v.decidedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v.decidedAt) || !parseTimestamp(v.decidedAt).ok) throw new Error('decidedAt requires a valid calendar date and zoned ISO timestamp');
  if (typeof v.appVersion !== 'string' || v.appVersion.trim().length === 0 || v.appVersion.length > 100) throw new Error('Invalid appVersion');
  return { schema: 'rulings-1', ruleVersion: 1, sequence: v.sequence, kind: 'burst', datasetHash: v.datasetHash as string,
    detectorConfigHash: v.detectorConfigHash as string, itemId: v.itemId, spanStart: v.spanStart, spanEnd: v.spanEnd,
    reviewsHash: v.reviewsHash as string, decision: v.decision, decidedAt: v.decidedAt, appVersion: v.appVersion };
}
/** Equal sequences may be deduplicated only when the complete records agree. Conflicts fail atomically. */
export function validateLog(values: readonly unknown[]): Ruling[] {
  if (values.length > MAX_RULINGS) throw new Error(`At most ${MAX_RULINGS} rulings may be imported`);
  const bySequence = new Map<number, Ruling>();
  for (const raw of values) {
    const ruling = validateRuling(raw);
    const prior = bySequence.get(ruling.sequence);
    if (prior && canonicalJson(prior) !== canonicalJson(ruling)) throw new Error(`Conflicting sequence ${ruling.sequence}; import the matching history`);
    bySequence.set(ruling.sequence, ruling);
  }
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}
export function importJsonl(text: string): Ruling[] {
  if (new TextEncoder().encode(text).length > MAX_RULINGS_BYTES) throw new Error('Rulings file exceeds 5 MB');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return validateLog(lines.map((line, i): unknown => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on nonblank line ${i + 1}`); }
  }));
}
export function exportJsonl(log: readonly Ruling[]): string {
  const checked = validateLog(log);
  const text = checked.map((r) => JSON.stringify(r)).join('\n') + (checked.length ? '\n' : '');
  if (new TextEncoder().encode(text).length > MAX_RULINGS_BYTES) throw new Error('Ruling history exceeds the 5 MB portable-log limit; download the existing history before starting a new session');
  return text;
}
export function mergeLogs(existing: readonly Ruling[], imported: readonly Ruling[]): Ruling[] {
  return validateLog([...existing, ...imported]);
}
export function appendRuling(log: readonly Ruling[], input: Omit<Ruling, 'schema' | 'ruleVersion' | 'sequence' | 'kind'>): Ruling[] {
  const checked = validateLog(log);
  const sequence = (checked.at(-1)?.sequence ?? 0) + 1;
  const next = validateRuling({ ...input, schema: 'rulings-1', ruleVersion: 1, sequence, kind: 'burst' });
  return validateLog([...checked, next]);
}
/** C6: typed tuples, sorted by review_id with code-unit comparison; free text is excluded. */
export function canonicalSpanReviews(dataset: Dataset, span: Pick<SpanIdentity, 'itemId' | 'spanStart' | 'spanEnd'>): string {
  const item = dataset.items.get(span.itemId);
  const reviews = item ? reviewsInDays(dataset, item, span.spanStart, span.spanEnd) : [];
  return canonicalJson([...reviews].sort((a, b) => cmp(a.review_id, b.review_id)).map((r) => [r.review_id, r.rating, r.ts, r.verified, r.category]));
}
export function spanReviewsHash(dataset: Dataset, span: Pick<SpanIdentity, 'itemId' | 'spanStart' | 'spanEnd'>): Promise<string> {
  return sha256Hex(canonicalSpanReviews(dataset, span));
}
export async function replayRulings(dataset: Dataset, detection: DetectionResult, config: RankConfig, rawLog: readonly unknown[]): Promise<RulingReplay> {
  const log = validateLog(rawLog);
  const latest = new Map<string, Ruling>();
  for (const ruling of log) latest.set(rulingKey(ruling), ruling);
  const hashes = new Map<string, string>();
  const hashFor = async (span: Pick<SpanIdentity, 'itemId' | 'spanStart' | 'spanEnd'>): Promise<string> => {
    const key = rulingKey(span);
    const old = hashes.get(key);
    if (old !== undefined) return old;
    const hash = await spanReviewsHash(dataset, span); hashes.set(key, hash); return hash;
  };
  const replayed: ReplayedRuling[] = [];
  const applicable = new Map<string, Ruling>();
  for (const ruling of latest.values()) {
    const reason: InvalidationReason | null = ruling.datasetHash !== dataset.datasetHash ? 'dataset hash changed'
      : ruling.detectorConfigHash !== detection.detectorConfigHash ? 'detector configuration changed'
      : ruling.reviewsHash !== await hashFor(ruling) ? 'span reviews changed' : null;
    replayed.push({ ruling, status: reason ? 'invalidated' : 'applied', reason });
    if (reason === null) applicable.set(rulingKey(ruling), ruling);
  }
  const refs = new Map<string, FlaggedSpanRef[]>();
  const active = [];
  const identities: SpanIdentity[] = [];
  for (const span of detection.spans) {
    if (span.status !== 'flagged') continue;
    identities.push({ itemId: span.itemId, spanStart: span.spanStart, spanEnd: span.spanEnd, reviewsHash: await hashFor(span) });
    const decision = applicable.get(rulingKey(span))?.decision;
    const label: SpanRulingLabel = decision === 'restore' ? 'restored' : decision === 'confirm' ? 'confirmed' : decision === 'skip' ? 'skipped' : 'unreviewed';
    const weight = label === 'restored' ? 1 : config.burst_weight;
    const list = refs.get(span.itemId) ?? [];
    list.push({ span_start: span.spanStart, span_end: span.spanEnd, label, weight }); refs.set(span.itemId, list);
    active.push({ itemId: span.itemId, spanStart: span.spanStart, spanEnd: span.spanEnd, weight });
  }
  return { latest: replayed.sort((a, b) => a.ruling.sequence - b.ruling.sequence), identities,
    context: { reviewBurstWeight: burstWeightsForSpans(dataset, active), itemFlaggedSpans: refs,
      itemDetectorStatus: new Map(detection.items.map((item) => [item.itemId, item.status])) } };
}
