import type { MethodId, RankKey } from '../../core/types';
import type { AppState } from '../state';
import { RankTable } from '../components/RankTable';

export function RankingPage({ state, method, category, busy, onMethod, onCategory, onRankKey, onItem }: {
  state: AppState; method: MethodId; category: string | null; busy: boolean;
  onMethod: (method: MethodId) => void; onCategory: (category: string | null) => void; onRankKey: (key: RankKey) => void; onItem: (id: string) => void;
}) {
  const results = state.rankings?.[method];
  if (!results) return <section className="card"><h2>Ranking</h2><p>Load a file or the sample to compare methods.</p></section>;
  const key = state.computedConfig?.rank_key ?? 'posterior_mean';
  const isEb = method.startsWith('eb_') || method.startsWith('full');
  const quantity = results[0]?.parts.interval.quantity;
  return <section className="card"><h2>Ranking</h2><div className="toolbar">
    <label>Method<select value={method} onChange={(e) => { const found = state.methods.find((m) => m === e.target.value); if (found) onMethod(found); }}>
      {state.methods.map((m) => <option key={m} value={m}>{state.methodLabels[m] ?? m}</option>)}</select></label>
    <label>EB rank key<select value={key} disabled={busy} onChange={(e) => onRankKey(e.target.value === 'lower_endpoint' ? 'lower_endpoint' : 'posterior_mean')}><option value="posterior_mean">Absolute posterior mean</option><option value="lower_endpoint">Lower endpoint of two-sided interval</option></select></label>
    <label>Category<select value={category === null ? 'all' : `cat:${category}`} onChange={(e) => onCategory(e.target.value === 'all' ? null : e.target.value.slice(4))}><option value="all">All categories</option>{state.categories.map((c) => <option key={c} value={`cat:${c}`}>{c}</option>)}</select></label>
  </div>
    <p className="muted">{isEb ? `Ordered by ${key === 'posterior_mean' ? 'absolute posterior mean' : 'the lower endpoint of the two-sided interval'} (stars).` : method === 'wilson' ? 'Ordered by the Wilson lower endpoint (top-box share); the EB key does not change this baseline.' : 'Ordered by this baseline’s star score; the EB key does not change it.'} {quantity === 'top-box share' ? 'Intervals use the 0–1 share axis.' : quantity === 'mean stars' ? 'Intervals use the 1–5 star axis.' : 'This method claims no interval.'} Category percentile ranges from zero to one and never changes ordering.</p>
    {busy && <p className="notice" role="status">Recomputing. The table shows the previous result until the new result arrives.</p>}
    <RankTable key={`${method}:${category ?? ''}`} results={results} category={category} meanResults={state.rankings?.mean ?? []} onItem={onItem} />
    <details><summary>Result provenance</summary><p>As of {state.asOf === null ? '—' : new Date(state.asOf).toISOString()}</p><p className="hash">Dataset: {state.datasetHash}</p><p className="hash">Config: {state.configHash}</p></details>
  </section>;
}
