// Pure UI state reducer (CL §2.8; PLAN M2 acceptance 5). No React, no DOM: testable in Node.
//
// Staleness rule: the UI tracks exactly one pending request. A response is applied only if its requestId equals the
// pending requestId (and, for `computed`, its datasetHash equals the loaded dataset's hash); everything else —
// late results of a superseded parameter edit, progress from an abandoned load, a wrong schemaVersion — is
// discarded and counted. Request ids must strictly increase.

import type { ValidationReport } from '../core/data/schema';
import type { DetectionResult } from '../core/burst/types';
import type { MethodId, RankResult } from '../core/types';
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
        return { ...base, phase: 'loading', report: null, datasetHash: null, configHash: null, rankings: null, methods: [], detection: null };
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
        error: { code: 'crash', message: action.message, details: [] },
      };
  }
  return state;
}
