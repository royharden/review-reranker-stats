import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import parsingTrapsCsv from '../../fixtures/parsing-traps.csv?raw';
import packageInfo from '../../package.json';
import { defaultConfig } from '../core/config';
import type { MethodId, RankConfig } from '../core/types';
import type { BurstSpan } from '../core/burst/types';
import { appendRuling, exportJsonl, importJsonl, MAX_RULINGS_BYTES, mergeLogs, rulingKey } from '../core/rulings/rulings';
import type { Decision, Ruling } from '../core/rulings/rulings';
import { rankingCsv } from '../core/export/csv';
import { createComputeClient } from '../worker/client';
import type { ComputeClient } from '../worker/client';
import { SCHEMA_VERSION } from '../worker/protocol';
import type { LoadSource, WorkerRequest } from '../worker/protocol';
import { LoadPage } from './pages/LoadPage';
import { RankingPage } from './pages/RankingPage';
import { ItemPage } from './pages/ItemPage';
import { BurstsPage } from './pages/BurstsPage';
import { ParamsPage } from './pages/ParamsPage';
import { appReducer, initialAppState } from './state';
import type { PendingKind } from './state';
import { browserStorageBackend, createSafeStorage } from './storage';
import { loadRulings, saveRulings } from './rulingsStore';
import './styles.css';

type View = 'load' | 'ranking' | 'item' | 'bursts' | 'params';
const VIEWS: View[] = ['load', 'ranking', 'item', 'bursts', 'params'];
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function App() {
  const [state, dispatch] = useReducer(appReducer, undefined, initialAppState);
  const [view, setView] = useState<View>('load');
  const [config, setConfig] = useState<RankConfig>(() => defaultConfig());
  const [method, setMethod] = useState<MethodId>('full');
  const [category, setCategory] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [log, setLog] = useState<Ruling[]>([]);
  const [storage] = useState(() => createSafeStorage(browserStorageBackend()));
  const [storageWarning, setStorageWarning] = useState<string | null>(storage.warning);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const clientRef = useRef<ComputeClient | null>(null);
  const workerCrashed = useRef(false);
  const nextRequestId = useRef(1);
  const lastSource = useRef<LoadSource | null>(null);
  const generation = useRef(0);
  const corruptStoredLog = useRef(false);
  const configRef = useRef(config);
  const logRef = useRef(log);
  const importBusy = useRef(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const client = createComputeClient((response) => dispatch({ type: 'response', response }), (message) => { workerCrashed.current = true; dispatch({ type: 'crashed', message }); });
    clientRef.current = client;
    return () => { client.dispose(); clientRef.current = null; };
  }, []);
  const send = useCallback((kind: PendingKind, make: (requestId: number) => WorkerRequest) => {
    const client = clientRef.current;
    if (!client) return;
    const requestId = nextRequestId.current++;
    dispatch({ type: 'request', kind, requestId }); client.send(make(requestId));
  }, []);
  const compute = useCallback((nextConfig: RankConfig, rulings: readonly Ruling[]) => {
    send('compute', (requestId) => ({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId, config: nextConfig, rulings }));
  }, [send]);
  const load = useCallback((source: LoadSource) => {
    if (workerCrashed.current) { clientRef.current?.cancel(); workerCrashed.current = false; }
    generation.current++; lastSource.current = source; corruptStoredLog.current = false;
    setLog([]); logRef.current = []; setItemId(null); setCategory(null); setLocalError(null); setNotice(null);
    send('load', (requestId) => ({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId, source, config: configRef.current }));
  }, [send]);
  useEffect(() => {
    if (state.phase !== 'loaded' || state.datasetHash === null) return;
    const saved = loadRulings(storage, state.datasetHash);
    corruptStoredLog.current = saved.error !== null;
    logRef.current = saved.log; setLog(saved.log); setStorageWarning(storage.warning);
    if (saved.error) setLocalError(saved.error + ' New rulings will stay in memory so the original bytes are preserved.');
    compute(configRef.current, saved.log);
  }, [state.phase, state.datasetHash, storage, compute]);

  const busy = state.pending !== null || importing;
  const ready = state.phase === 'ready';
  const selectedMethod = state.methods.includes(method) ? method : state.methods[0] ?? method;
  const effectiveCategory = category !== null && state.categories.includes(category) ? category : null;
  const openItem = (id: string) => { setItemId(id); setView('item'); };
  const applyConfig = (next: RankConfig) => {
    configRef.current = next; setConfig(next); setLocalError(null); setNotice('Parameters applied. Input limits and support labels take effect on the next load.');
    if (state.datasetHash) compute(next, logRef.current);
  };
  const persist = (next: Ruling[]) => {
    // Serialize first, before changing live state; oversize/nonportable logs fail atomically.
    exportJsonl(next);
    if (!corruptStoredLog.current && state.datasetHash) saveRulings(storage, state.datasetHash, next);
    setStorageWarning(storage.warning); logRef.current = next; setLog(next);
  };
  const decide = (span: BurstSpan, decision: Decision) => {
    if (!ready || busy || !state.datasetHash || !state.detection) return;
    const identity = state.spanIdentities.find((s) => rulingKey(s) === rulingKey(span));
    if (!identity) { setLocalError('Span identity is unavailable. Recompute before deciding.'); return; }
    try {
      const next = appendRuling(logRef.current, { ...identity, datasetHash: state.datasetHash,
        detectorConfigHash: state.detection.detectorConfigHash, decision, decidedAt: new Date().toISOString(), appVersion: packageInfo.version });
      persist(next); setLocalError(null); setNotice(`Appended ${decision} ruling. History remains available in the JSONL download.`); compute(configRef.current, next);
    } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); }
  };
  const importFile = async (file: File) => {
    if (!state.datasetHash || !ready || busy || importBusy.current) return;
    const startGeneration = generation.current;
    importBusy.current = true; setImporting(true); setLocalError(null);
    try {
      if (file.size > MAX_RULINGS_BYTES) throw new Error('Rulings file exceeds 5 MB');
      const imported = importJsonl(await file.text());
      if (generation.current !== startGeneration) return;
      const next = mergeLogs(logRef.current, imported); persist(next);
      setNotice(`Read ${imported.length} imported records; history contains ${next.length} unique records. Hash mismatches are shown as invalidated.`);
      compute(configRef.current, next);
    } catch (error) { if (generation.current === startGeneration) setLocalError(error instanceof Error ? error.message : String(error)); }
    finally { importBusy.current = false; setImporting(false); }
  };
  const cancel = () => { generation.current++; clientRef.current?.cancel(); workerCrashed.current = false; dispatch({ type: 'cancelled' }); setView('load'); };
  const downloadRulings = () => { try { download('rulings.jsonl', exportJsonl(logRef.current), 'application/x-ndjson;charset=utf-8'); } catch (error) { setLocalError(String(error)); } };
  const downloadCsv = () => {
    if (!ready || !state.computedConfig || state.asOf === null || !state.datasetHash || !state.configHash) return;
    try { download(`ranking-${selectedMethod}.csv`, rankingCsv(state.rankings?.[selectedMethod] ?? [], state.rankings?.mean ?? [],
      { method: selectedMethod, config: state.computedConfig, asOf: state.asOf, datasetHash: state.datasetHash, configHash: state.configHash }), 'text/csv;charset=utf-8'); }
    catch (error) { setLocalError(String(error)); }
  };
  const progressText = state.progress ? `${state.progress.phase}: ${Math.round(state.progress.pct * 100)}%` : state.pending?.kind === 'load' ? 'Loading…' : 'Computing…';
  return <main><a className="skip-link" href="#content">Skip to content</a><header className="app-header"><div><p className="eyebrow">Local analysis · review evidence</p><h1>Fair Review Re-Ranker</h1><p>Smaller samples deserve context. Unusual bursts deserve a closer look.</p></div><span className="local-pill">Browser only · no uploads</span></header>
    <nav aria-label="Pages">{VIEWS.map((v) => <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</nav>
    <div className="toolbar downloads"><button disabled={!ready || busy} onClick={downloadCsv}>Download full ranking CSV</button><button disabled={log.length === 0} onClick={downloadRulings}>Download rulings JSONL ({log.length})</button>
      <label className="file-label">Import rulings JSONL<input type="file" accept=".jsonl,.ndjson,application/x-ndjson" disabled={!ready || busy} onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) void importFile(f); }} /></label>
    </div>
    {storageWarning && <p className="warning" role="alert">{storageWarning}</p>}
    {corruptStoredLog.current && <p className="warning">Stored history could not be read. New decisions are kept in memory; download the JSONL to preserve them.</p>}
    {notice && <p className="notice" role="status">{notice}</p>}{localError && <p className="error" role="alert">{localError}</p>}
    {state.error && view !== 'load' && <div className="error" role="alert">{state.error.message}<ul>{state.error.details.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
    {state.pending && <div className="progress" role="status"><span>{progressText}</span><progress max="1" value={state.progress?.pct ?? 0} /><button onClick={cancel}>Cancel</button></div>}
    {importing && <p role="status">Validating ruling history…</p>}
    {state.datasetHash && state.phase === 'error' && <button disabled={busy} onClick={() => compute(configRef.current, logRef.current)}>Retry computation</button>}
    {state.error && !state.datasetHash && lastSource.current && <button disabled={busy} onClick={() => { if (lastSource.current) load(lastSource.current); }}>Reload last source</button>}
    <div id="content" tabIndex={-1}>
      {view === 'load' && <LoadPage busy={busy} progressText={progressText} report={state.report} error={state.error} canViewRanking={state.rankings !== null} onLoadSample={() => load({ kind: 'sample', profile: 'demo', parsingTrapsCsv })} onLoadFile={(file, asOf) => load({ kind: 'file', file, name: file.name, asOf })} onCancel={cancel} onViewRanking={() => setView('ranking')} />}
      {view === 'ranking' && <RankingPage state={state} method={selectedMethod} category={effectiveCategory} busy={busy} onMethod={setMethod} onCategory={setCategory} onRankKey={(rank_key) => applyConfig({ ...configRef.current, rank_key })} onItem={openItem} />}
      {view === 'item' && <ItemPage state={state} itemId={itemId} method={selectedMethod} onBack={() => setView('ranking')} onBursts={() => setView('bursts')} />}
      {view === 'bursts' && <BurstsPage state={state} busy={busy || !ready} onDecision={decide} onItem={openItem} />}
      {view === 'params' && <ParamsPage config={config} busy={busy} canCompute={state.datasetHash !== null} onApply={applyConfig} />}
    </div><footer>Local analysis for human review. Flags are not fraud findings. No accepted review is excluded. Reload the same data to replay compact saved rulings. Construction source: runtime validation pending.</footer>
  </main>;
}
