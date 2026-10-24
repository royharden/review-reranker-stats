// Person-run CLI boundary only. No network, no claim of independently verified source rights/coverage.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { SourceIdentity } from '../src/core/eval/split';

export interface LocalSourceMetadata {
  schema: 'local-source-1'; sourceId: string; csvSha256: string; normalizedRows: number; rejectedRows: number;
  complete: boolean; truncated: boolean; stopReason: string;
  coverage: { status: 'unverified' | 'confirmed-complete'; checkedAt: string | null; checkedBy: string | null; basis: string | null };
}
export interface LocalReadiness {
  schema: 'local-readiness-1'; sourceId: string; csvSha256: string; metadataSha256: string; normalizedRows: number;
  coverage: 'person-confirmed-complete'; checkedAt: string; checkedBy: string; basis: string;
}
const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 2000;
const at = (x: unknown): x is string => text(x) && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
export function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

/** Absence, truncation, rejects, or unverified coverage refuse the entire claim-bearing local eval. */
export async function localCsvReadiness(csvPath: string, csvBytes: Uint8Array, acceptedRows: number): Promise<LocalReadiness> {
  const sidecar = csvPath + '.source.json';
  let bytes: Buffer;
  try {
    const size = (await stat(sidecar)).size;
    if (size > 64_000) throw new Error('Source metadata exceeds 64,000 bytes');
    bytes = await readFile(sidecar);
    if (bytes.length > 64_000) throw new Error('Source metadata exceeds 64,000 bytes');
  } catch { throw new Error('Local CSV evaluation requires a readable <=64 KB ' + sidecar + '; unknown/truncated coverage cannot support a temporal headline. See README.'); }
  const raw: unknown = JSON.parse(bytes.toString('utf8'));
  if (!record(raw) || raw.schema !== 'local-source-1' || !text(raw.sourceId) || !hash(raw.csvSha256)
    || raw.csvSha256 !== digest(csvBytes) || raw.normalizedRows !== acceptedRows || !Number.isSafeInteger(raw.normalizedRows)
    || acceptedRows < 1 || raw.rejectedRows !== 0 || raw.complete !== true || raw.truncated !== false || raw.stopReason !== 'eof'
    || !record(raw.coverage) || raw.coverage.status !== 'confirmed-complete' || !at(raw.coverage.checkedAt)
    || !text(raw.coverage.checkedBy) || !text(raw.coverage.basis)) {
    throw new Error('Local source not ready: require matching CSV SHA-256/row count, complete EOF, no truncation/rejected rows, and explicit person-confirmed temporal coverage. No temporal headline; CSV remains usable for local descriptive inspection.');
  }
  return { schema: 'local-readiness-1', sourceId: raw.sourceId, csvSha256: raw.csvSha256, metadataSha256: digest(bytes),
    normalizedRows: acceptedRows, coverage: 'person-confirmed-complete', checkedAt: raw.coverage.checkedAt,
    checkedBy: raw.coverage.checkedBy, basis: raw.coverage.basis };
}
/** This script-owned extension survives the core's canonical manifest freeze without changing core API contracts. */
export function withLocalReadiness(source: SourceIdentity, localReadiness: LocalReadiness): SourceIdentity & { localReadiness: LocalReadiness } {
  return { ...source, localReadiness };
}
export function requireFrozenReadiness(source: SourceIdentity): LocalReadiness | null {
  if (source.kind === 'synthetic') return null;
  const raw: unknown = source;
  const r = record(raw) ? raw.localReadiness : null;
  if (!record(r) || r.schema !== 'local-readiness-1' || !text(r.sourceId) || !hash(r.csvSha256) || !hash(r.metadataSha256)
    || typeof r.normalizedRows !== 'number' || !Number.isSafeInteger(r.normalizedRows) || r.normalizedRows < 1
    || r.coverage !== 'person-confirmed-complete' || !at(r.checkedAt) || !text(r.checkedBy) || !text(r.basis)) {
    throw new Error('Frozen local CSV has no valid temporal-readiness attestation. Refusing final/readme headline; prepare a new dev experiment from confirmed source metadata.');
  }
  return { schema: 'local-readiness-1', sourceId: r.sourceId, csvSha256: r.csvSha256, metadataSha256: r.metadataSha256,
    normalizedRows: r.normalizedRows, coverage: 'person-confirmed-complete', checkedAt: r.checkedAt, checkedBy: r.checkedBy, basis: r.basis };
}
export function sourceReadinessMarkdown(source: SourceIdentity): string {
  const r = requireFrozenReadiness(source); if (r === null) return '';
  const safe = (x: string) => x.replace(/[\r\n|<>`]/g, ' ');
  return '\n## Local source readiness\n\nPerson-confirmed complete temporal coverage, not independently verified by this tool. '
    + 'Source: ' + safe(r.sourceId) + '; normalized rows: ' + r.normalizedRows + '; checked ' + safe(r.checkedAt) + ' by ' + safe(r.checkedBy)
    + '. Basis: ' + safe(r.basis) + '.\n\nCSV SHA-256: `' + r.csvSha256 + '`. Metadata SHA-256: `' + r.metadataSha256 + '`. '
    + 'These attestations are frozen before tuning/final reads; support gates still apply.\n';
}
