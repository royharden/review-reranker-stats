import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { emptyReasonCounts } from '../../src/core/data/schema';
import type { ValidationReport } from '../../src/core/data/schema';
import { appReducer, initialAppState, isStale } from '../../src/ui/state';
import type { AppState } from '../../src/ui/state';
import { SCHEMA_VERSION, parseWorkerRequest } from '../../src/worker/protocol';
import type { WorkerResponse } from '../../src/worker/protocol';

function report(hash: string | null): ValidationReport {
  return {
    source: 'text',
    sourceName: 't',
    asOf: 0,
    fileRejection: null,
    bytes: 0,
    dataRows: 0,
    accepted: 0,
    rejected: 0,
    reasonCounts: emptyReasonCounts(),
    examples: [],
    verifiedColumnPresent: true,
    textColumnPresent: false,
    itemCount: 0,
    categoryCount: 0,
    insufficientCount: 0,
    insufficientItems: [],
    datasetHash: hash,
  };
}

const loaded = (requestId: number, hash: string): WorkerResponse => ({
  type: 'loaded',
  schemaVersion: SCHEMA_VERSION,
  requestId,
  datasetHash: hash,
  configHash: null,
  report: report(hash),
});

const computed = (requestId: number, datasetHash: string, configHash: string): WorkerResponse => ({
  type: 'computed',
  schemaVersion: SCHEMA_VERSION,
  requestId,
  datasetHash,
  configHash,
  rankings: { mean: [] },
  methods: ['mean'],
  computedConfig: defaultConfig(), asOf: 0, categories: [], methodLabels: { mean: 'Mean' }, itemDetails: [], rulingReplay: [], spanIdentities: [],
  detection: { schema: 'bursts-1', datasetHash, detectorConfigHash: 'detector-C', status: 'assessed', items: [], spans: [], testedSpanCount: 0,
    diagnostics: { candidateDays: 0, baselineWindowsEvaluated: 0 } },
});

function run(state: AppState, ...actions: Parameters<typeof appReducer>[1][]): AppState {
  return actions.reduce(appReducer, state);
}

describe('UI reducer discards stale responses (PLAN M2 acceptance 5)', () => {
  it('a response for a superseded requestId is discarded; the latest is applied', () => {
    let s = run(initialAppState(), { type: 'request', kind: 'load', requestId: 1 }, { type: 'request', kind: 'load', requestId: 2 });
    expect(s.pending).toEqual({ requestId: 2, kind: 'load' });
    s = appReducer(s, { type: 'response', response: loaded(1, 'old') });
    expect(s.datasetHash).toBeNull();
    expect(s.staleDiscarded).toBe(1);
    expect(s.phase).toBe('loading');
    s = appReducer(s, { type: 'response', response: loaded(2, 'new') });
    expect(s.datasetHash).toBe('new');
    expect(s.phase).toBe('loaded');
    expect(s.pending).toBeNull();
  });

  it('stale compute results after a parameter edit never overwrite the newer ranking', () => {
    let s = run(
      initialAppState(),
      { type: 'request', kind: 'load', requestId: 1 },
      { type: 'response', response: loaded(1, 'D') },
      { type: 'request', kind: 'compute', requestId: 2 },
      { type: 'request', kind: 'compute', requestId: 3 },
    );
    s = appReducer(s, { type: 'response', response: computed(3, 'D', 'C3') });
    expect(s.configHash).toBe('C3');
    // The slower, older compute arrives late: discarded.
    s = appReducer(s, { type: 'response', response: computed(2, 'D', 'C2') });
    expect(s.configHash).toBe('C3');
    expect(s.staleDiscarded).toBe(1);
  });

  it('progress and errors from abandoned requests are discarded too', () => {
    let s = run(initialAppState(), { type: 'request', kind: 'load', requestId: 5 }, { type: 'request', kind: 'load', requestId: 6 });
    s = appReducer(s, {
      type: 'response',
      response: { type: 'progress', schemaVersion: SCHEMA_VERSION, requestId: 5, datasetHash: null, configHash: null, phase: 'parse', pct: 0.5 },
    });
    s = appReducer(s, {
      type: 'response',
      response: { type: 'error', schemaVersion: SCHEMA_VERSION, requestId: 5, datasetHash: null, configHash: null, code: 'internal', message: 'x', details: [] },
    });
    expect(s.progress).toBeNull();
    expect(s.error).toBeNull();
    expect(s.staleDiscarded).toBe(2);
  });

  it('a computed response for another dataset is stale even with the current requestId', () => {
    const s = run(initialAppState(), { type: 'request', kind: 'load', requestId: 1 }, { type: 'response', response: loaded(1, 'D1') }, { type: 'request', kind: 'compute', requestId: 2 });
    expect(isStale(s, computed(2, 'D-other', 'C'))).toBe(true);
    expect(isStale(s, computed(2, 'D1', 'C'))).toBe(false);
  });

  it('a wrong schemaVersion is stale; responses with no pending request are stale', () => {
    const s = run(initialAppState(), { type: 'request', kind: 'load', requestId: 1 });
    expect(isStale(s, { ...loaded(1, 'D'), schemaVersion: SCHEMA_VERSION + 1 })).toBe(true);
    expect(isStale(initialAppState(), loaded(1, 'D'))).toBe(true);
  });

  it('request ids must strictly increase', () => {
    const s = run(initialAppState(), { type: 'request', kind: 'load', requestId: 4 });
    expect(appReducer(s, { type: 'request', kind: 'compute', requestId: 4 })).toBe(s);
    expect(appReducer(s, { type: 'request', kind: 'compute', requestId: 3 })).toBe(s);
  });

  it('cancel clears the pending request and the worker-side dataset; a late response is then stale', () => {
    let s = run(initialAppState(), { type: 'request', kind: 'load', requestId: 1 }, { type: 'cancelled' });
    expect(s.pending).toBeNull();
    expect(s.error?.code).toBe('cancelled');
    s = appReducer(s, { type: 'response', response: loaded(1, 'D') });
    expect(s.datasetHash).toBeNull();
    expect(s.staleDiscarded).toBe(1);
  });
});

describe('parseWorkerRequest', () => {
  it('accepts valid load/compute messages and rejects malformed ones', () => {
    expect(parseWorkerRequest({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 1, source: { kind: 'text', text: 'a', name: 'n', asOf: 0 } }).ok).toBe(true);
    expect(parseWorkerRequest({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 2, config: {}, rulings: [] }).ok).toBe(true);
    expect(parseWorkerRequest({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 1, source: { kind: 'text', text: 'a', name: 'n', asOf: 1.5 } }).ok).toBe(false);
    const wrongVersion = parseWorkerRequest({ type: 'compute', schemaVersion: 99, requestId: 3, config: {}, rulings: [] });
    expect(wrongVersion).toMatchObject({ ok: false, requestId: 3, code: 'schema-mismatch' });
    expect(parseWorkerRequest(null)).toMatchObject({ ok: false, requestId: -1 });
    expect(parseWorkerRequest({ type: 'nope', schemaVersion: SCHEMA_VERSION, requestId: 1 })).toMatchObject({ ok: false, code: 'bad-request' });
  });
});
