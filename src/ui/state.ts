// Pure UI state reducer (CL §2.8; PLAN M2 acceptance 5). No React, no DOM: testable in Node.
//
// Staleness rule: the UI tracks exactly one pending request. A response is applied only if its requestId equals the
// pending requestId (and, for `computed`, its datasetHash equals the loaded dataset's hash); everything else —
// late results of a superseded parameter edit, progress from an abandoned load, a wrong schemaVersion — is
// discarded and counted. Request ids must strictly increase.

import type { ValidationReport } from '../core/data/schema';
import type { DetectionResult } from '../core/burst/types';
import type { MethodId, RankConfig, RankResult } from '../core/types';
import type { ReplayedRuling, SpanIdentity } from '../core/rulings/rulings';
import type { ItemDetail } from '../worker/details';
import { SCHEMA_VERSION } from '../worker/protocol';
import type { ErrorCode, ProgressPhase, WorkerResponse } from '../worker/protocol';

export type Phase = 'idle' | 'loading' | 'loaded' | 'computing' | 'ready' | 'error';
export type PendingKind = 'load' | 'compute';

export interface UiError {
  code: ErrorCode | 'crash' | 'cancelled';
  message: string;
  details: string[];
}

export interface AppState {
  phase: Phase;
  pending: { requestId: number; kind: PendingKind } | null;
  /** Highest requestId issued so far (0 = none). */
  lastRequestId: number;
  report: ValidationReport | null;
  datasetHash: string | null;
  configHash: string | null;
  rankings: Partial<Record<MethodId, RankResult[]>> | null;
  methods: MethodId[];
  detection: DetectionResult | null;
  computedConfig: RankConfig | null;
  asOf: number | null;
  categories: string[];
  methodLabels: Partial<Record<MethodId, string>>;
  itemDetails: ItemDetail[];
  rulingReplay: ReplayedRuling[];
  spanIdentities: SpanIdentity[];
  progress: { phase: ProgressPhase; pct: number } | null;
  error: UiError | null;
  /** Responses discarded as stale (for display/debugging and tests). */
  staleDiscarded: number;
}

export type AppAction =
  | { type: 'request'; kind: PendingKind; requestId: number }
  | { type: 'response'; response: WorkerResponse }
  | { type: 'cancelled' }
  | { type: 'crashed'; message: string };

export function initialAppState(): AppState {
  return {
    phase: 'idle',
    pending: null,
    lastRequestId: 0,
    report: null,
    datasetHash: null,
    configHash: null,
    rankings: null,
    methods: [],
    detection: null,
    computedConfig: null, asOf: null, categories: [], methodLabels: {}, itemDetails: [], rulingReplay: [], spanIdentities: [],
    progress: null,
    error: null,
    staleDiscarded: 0,
  };
}

/** True when a response must be ignored. */
export function isStale(state: AppState, response: WorkerResponse): boolean {
  if (response.schemaVersion !== SCHEMA_VERSION) return true;
  if (state.pending === null || response.requestId !== state.pending.requestId) return true;
  if (response.type === 'computed' && response.datasetHash !== state.datasetHash) return true;
  return false;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'request': {
      if (!Number.isInteger(action.requestId) || action.requestId <= state.lastRequestId) return state;
      const base: AppState = {
        ...state,
        pending: { requestId: action.requestId, kind: action.kind },
        lastRequestId: action.requestId,
        progress: null,
        error: null,
      };
      if (action.kind === 'load') {
        // A new load supersedes everything derived from the previous dataset.
        return { ...base, phase: 'loading', report: null, datasetHash: null, configHash: null, rankings: null, methods: [], detection: null,
          computedConfig: null, asOf: null, categories: [], methodLabels: {}, itemDetails: [], rulingReplay: [], spanIdentities: [] };
      }
      // Keep the previous rankings visible (marked as recomputing) until the new ones arrive.
      return { ...base, phase: 'computing' };
    }

    case 'response': {
      const r = action.response;
      if (isStale(state, r)) return { ...state, staleDiscarded: state.staleDiscarded + 1 };
      switch (r.type) {
        case 'progress':
          return { ...state, progress: { phase: r.phase, pct: r.pct } };
        case 'loaded':
          return {
            ...state,
            phase: 'loaded',
            pending: null,
            progress: null,
            report: r.report,
            datasetHash: r.datasetHash,
            configHash: null,
            rankings: null,
            methods: [],
            detection: null,
            computedConfig: null, asOf: r.report.asOf, categories: [], methodLabels: {}, itemDetails: [], rulingReplay: [], spanIdentities: [],
          };
        case 'computed':
          return {
            ...state,
            phase: 'ready',
            pending: null,
            progress: null,
            configHash: r.configHash,
            rankings: r.rankings,
            methods: r.methods,
            detection: r.detection,
            computedConfig: r.computedConfig, asOf: r.asOf, categories: r.categories, methodLabels: r.methodLabels,
            itemDetails: r.itemDetails, rulingReplay: r.rulingReplay, spanIdentities: r.spanIdentities,
          };
        case 'error':
          return {
            ...state,
            phase: 'error',
            pending: null,
            progress: null,
            datasetHash: r.code === 'no-dataset' ? null : state.datasetHash,
            error: { code: r.code, message: r.message, details: r.details },
          };
      }
      return state;
    }

    case 'cancelled':
      // The worker was terminated and respawned empty: no dataset remains on the worker side.
      return {
        ...state,
        phase: 'idle',
        pending: null,
        progress: null,
        datasetHash: null,
        configHash: null,
        rankings: null,
        methods: [],
        detection: null,
        computedConfig: null, asOf: null, categories: [], methodLabels: {}, itemDetails: [], rulingReplay: [], spanIdentities: [],
        error: { code: 'cancelled', message: 'Cancelled. The compute worker was restarted; load the data again.', details: [] },
      };

    case 'crashed':
      return {
        ...state,
        phase: 'error',
        pending: null,
        progress: null,
        datasetHash: null,
        rankings: null,
        methods: [],
        detection: null,
        computedConfig: null, asOf: null, categories: [], methodLabels: {}, itemDetails: [], rulingReplay: [], spanIdentities: [],
        error: { code: 'crash', message: action.message, details: [] },
      };
  }
  return state;
}
