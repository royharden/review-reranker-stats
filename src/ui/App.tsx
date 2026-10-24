import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import parsingTrapsCsv from '../../fixtures/parsing-traps.csv?raw';
import { defaultConfig } from '../core/config';
import type { RankConfig } from '../core/types';
import { createComputeClient } from '../worker/client';
import type { ComputeClient } from '../worker/client';
import { SCHEMA_VERSION } from '../worker/protocol';
import type { LoadSource, WorkerRequest } from '../worker/protocol';
import { LoadPage } from './pages/LoadPage';
import { RankingPage } from './pages/RankingPage';
import { appReducer, initialAppState } from './state';
import type { PendingKind } from './state';

// M2 thin journey (CL §1.3, PLAN C9): Load sample (or a file) -> worker parses + validates -> worker computes the
// `mean` ranking with config.default.json -> bare ranking table. The full UI (method toggles, item page, burst
// queue, params, exports) arrives in M4.
// System font stack only: no external fonts, no telemetry, no runtime fetches (PLAN §3).
const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif';

const pageStyle: CSSProperties = {
  fontFamily: SYSTEM_FONT_STACK,
  maxWidth: '72rem',
  margin: '0 auto',
  padding: '1rem',
  lineHeight: 1.5,
};

const navButton = (active: boolean): CSSProperties => ({
  padding: '0.4rem 0.9rem',
  border: '1px solid #888',
  borderBottom: active ? '2px solid #000' : '1px solid #888',
  background: active ? '#f2f2f2' : '#fff',
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
});

type View = 'load' | 'ranking';

export function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, initialAppState);
  const [view, setView] = useState<View>('load');
  const [config] = useState<RankConfig>(() => defaultConfig());
  const clientRef = useRef<ComputeClient | null>(null);
  const nextRequestId = useRef(1);

  useEffect(() => {
    const client = createComputeClient(
      (response) => dispatch({ type: 'response', response }),
      (message) => dispatch({ type: 'crashed', message }),
    );
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const send = useCallback((kind: PendingKind, make: (requestId: number) => WorkerRequest) => {
    const client = clientRef.current;
    if (client === null) return;
    const requestId = nextRequestId.current++;
    dispatch({ type: 'request', kind, requestId });
    client.send(make(requestId));
  }, []);

  const load = useCallback(
    (source: LoadSource) => {
      send('load', (requestId) => ({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId, source }));
    },
    [send],
  );

  // Once a dataset is loaded (and not rejected), compute rankings with the default parameters.
  useEffect(() => {
    if (state.phase === 'loaded' && state.datasetHash !== null) {
      send('compute', (requestId) => ({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId, config, rulings: [] }));
    }
  }, [state.phase, state.datasetHash, send, config]);

  const cancel = useCallback(() => {
    clientRef.current?.cancel();
    dispatch({ type: 'cancelled' });
  }, []);

  const busy = state.pending !== null;
  const progressText = state.progress
    ? `${state.progress.phase}: ${Math.round(state.progress.pct * 100)}%`
    : state.pending
      ? `${state.pending.kind === 'load' ? 'Loading' : 'Computing'}…`
      : null;
  const meanResults = state.rankings?.mean ?? null;

  return (
    <main style={pageStyle}>
      <header>
        <h1 style={{ marginBottom: '0.25rem' }}>Fair Review Re-Ranker</h1>
        <p style={{ marginTop: 0, color: '#555' }}>
          Construction build (milestone M2): all analysis runs locally in your browser; nothing is uploaded.
        </p>
        <nav style={{ display: 'flex', gap: '0.25rem' }} aria-label="Pages">
          <button type="button" style={navButton(view === 'load')} onClick={() => setView('load')}>
            Load
          </button>
          <button type="button" style={navButton(view === 'ranking')} onClick={() => setView('ranking')}>
            Ranking
          </button>
        </nav>
      </header>

      {view === 'load' ? (
        <LoadPage
          busy={busy}
          progressText={progressText}
          report={state.report}
          error={state.error}
          canViewRanking={meanResults !== null}
          onLoadSample={() => load({ kind: 'sample', profile: 'demo', parsingTrapsCsv })}
          onLoadFile={(file, asOf) => load({ kind: 'file', file, name: file.name, asOf })}
          onCancel={cancel}
          onViewRanking={() => setView('ranking')}
        />
      ) : (
        <RankingPage
          method="mean"
          results={meanResults}
          recomputing={state.phase === 'computing'}
          datasetHash={state.datasetHash}
          configHash={state.configHash}
        />
      )}
    </main>
  );
}
