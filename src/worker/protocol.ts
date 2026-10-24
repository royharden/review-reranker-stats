// Main-thread <-> compute-worker protocol (CL §2.8; PLAN M2 acceptance 5).
//
// Discriminated unions on `type`. Every message carries schemaVersion and requestId; every response also carries
// datasetHash and configHash (null when not applicable) so the UI can discard stale results. Plain structured-clone
// data only (a File/Blob is structured-cloneable; Maps are avoided in responses).

import type { ValidationReport } from '../core/data/schema';
import type { DetectionResult } from '../core/burst/types';
import type { MethodId, RankResult } from '../core/types';

export const SCHEMA_VERSION = 1;

/** What to load. File/text inputs carry their explicit asOf; the sample uses its profile's fixed asOf. */
export type LoadSource =
  | { kind: 'file'; file: Blob; name: string; asOf: number }
  | { kind: 'text'; text: string; name: string; asOf: number }
  | { kind: 'sample'; profile: 'demo'; parsingTrapsCsv: string };

export interface LoadRequest {
  type: 'load';
  schemaVersion: number;
  requestId: number;
  source: LoadSource;
}

export interface ComputeRequest {
  type: 'compute';
  schemaVersion: number;
  requestId: number;
  /** Untrusted until validated by the worker (validateConfig). */
  config: unknown;
  /** Ruling records (validated and replayed from M4; ignored in M2). */
  rulings: readonly unknown[];
}

export type WorkerRequest = LoadRequest | ComputeRequest;

export type ProgressPhase = 'generate' | 'parse' | 'index' | 'detect' | 'rank';

interface ResponseBase {
  schemaVersion: number;
  requestId: number;
  datasetHash: string | null;
  configHash: string | null;
}

export interface LoadedResponse extends ResponseBase {
  type: 'loaded';
  report: ValidationReport;
}

export interface ComputedResponse extends ResponseBase {
  type: 'computed';
  /** One ranking per registered method, each in canonical rank order. */
  rankings: Partial<Record<MethodId, RankResult[]>>;
  /** Methods that were computed, in display order. */
  methods: MethodId[];
  detection: DetectionResult;
}

export interface ProgressResponse extends ResponseBase {
  type: 'progress';
  phase: ProgressPhase;
  /** Fraction in [0, 1]. */
  pct: number;
}

export type ErrorCode = 'bad-request' | 'schema-mismatch' | 'no-dataset' | 'invalid-config' | 'internal';

export interface ErrorResponse extends ResponseBase {
  type: 'error';
  code: ErrorCode;
  message: string;
  /** Config validation messages when code = 'invalid-config'. */
  details: string[];
}

export type WorkerResponse = LoadedResponse | ComputedResponse | ProgressResponse | ErrorResponse;

// ---------------------------------------------------------------------------------------------------------------
// Request validation (the worker treats incoming messages as untrusted structured-clone data)
// ---------------------------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAsOf(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 8.64e15;
}

export type RequestParse =
  | { ok: true; request: WorkerRequest }
  | { ok: false; requestId: number; code: ErrorCode; message: string };

/** Validate an incoming message. requestId is echoed when readable (else -1) so the UI can match the error. */
export function parseWorkerRequest(raw: unknown): RequestParse {
  if (!isRecord(raw)) return { ok: false, requestId: -1, code: 'bad-request', message: 'message is not an object' };
  const requestId = typeof raw.requestId === 'number' && Number.isInteger(raw.requestId) ? raw.requestId : -1;
  if (requestId < 0) return { ok: false, requestId, code: 'bad-request', message: 'requestId must be a non-negative integer' };
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, requestId, code: 'schema-mismatch', message: `schemaVersion must be ${SCHEMA_VERSION}` };
  }
  if (raw.type === 'load') {
    const s = raw.source;
    if (!isRecord(s)) return { ok: false, requestId, code: 'bad-request', message: 'load.source missing' };
    if (s.kind === 'file' && s.file instanceof Blob && typeof s.name === 'string' && isAsOf(s.asOf)) {
      return { ok: true, request: { type: 'load', schemaVersion: SCHEMA_VERSION, requestId, source: { kind: 'file', file: s.file, name: s.name, asOf: s.asOf } } };
    }
    if (s.kind === 'text' && typeof s.text === 'string' && typeof s.name === 'string' && isAsOf(s.asOf)) {
      return { ok: true, request: { type: 'load', schemaVersion: SCHEMA_VERSION, requestId, source: { kind: 'text', text: s.text, name: s.name, asOf: s.asOf } } };
    }
    if (s.kind === 'sample' && s.profile === 'demo' && typeof s.parsingTrapsCsv === 'string') {
      return {
        ok: true,
        request: { type: 'load', schemaVersion: SCHEMA_VERSION, requestId, source: { kind: 'sample', profile: 'demo', parsingTrapsCsv: s.parsingTrapsCsv } },
      };
    }
    return { ok: false, requestId, code: 'bad-request', message: 'load.source is not a valid file, text or sample source' };
  }
  if (raw.type === 'compute') {
    const rulings = Array.isArray(raw.rulings) ? raw.rulings : null;
    if (rulings === null) return { ok: false, requestId, code: 'bad-request', message: 'compute.rulings must be an array' };
    return { ok: true, request: { type: 'compute', schemaVersion: SCHEMA_VERSION, requestId, config: raw.config, rulings } };
  }
  return { ok: false, requestId, code: 'bad-request', message: 'unknown message type' };
}
