import { useEffect, useState } from 'react';
import { defaultConfig, validateConfig } from '../../core/config';
import type { RankConfig } from '../../core/types';

const HELP: Record<string, string> = {
  half_life_days: 'Recency half-life in days; positive. Ranking only.', unverified_weight: 'False verified status factor in (0,1]; unknown stays one. Ranking only.',
  rank_key: 'EB methods only. Wilson always ranks its lower top-box endpoint; mean and Bayes keep their scores.',
  burst_weight: 'Applied to active flagged spans; strictly positive. Restored spans use one.',
  windows_days: 'Strictly ascending comma-separated days, each from 1 to 366.',
  permutations: 'Permutation replicates; larger values cost more computation.',
  max_perm_tests: 'Dataset test budget; capped items remain labelled partial.',
  bayes_m: 'Positive prior count, or median for the loaded catalogue median.',
  max_bytes: 'Input limits apply at the next load; committed hard caps still apply.',
  max_rows: 'Input limits apply at the next load; committed hard caps still apply.',
  insufficient_below: 'Labelling threshold applies when data is loaded.',
};
function toDraft(config: RankConfig): Record<string, string> {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]));
}
export function ParamsPage({ config, busy, canCompute, onApply }: { config: RankConfig; busy: boolean; canCompute: boolean; onApply: (config: RankConfig) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(config));
  useEffect(() => { setDraft(toDraft(config)); }, [config]);
  const entries = Object.entries(defaultConfig()).filter(([key]) => key !== 'schema' && key !== '_provenance');
  const raw: Record<string, unknown> = { ...config };
  for (const [key, fallback] of entries) {
    const text = draft[key] ?? '';
    raw[key] = key === 'windows_days' ? text.split(',').map((s) => s.trim() === '' ? Number.NaN : Number(s.trim()))
      : key === 'rank_key' || key === 'correction' ? text
      : key === 'bayes_m' && text.trim() === 'median' ? 'median'
      : typeof fallback === 'number' || key === 'bayes_m' ? text.trim() === '' ? '' : Number(text) : text;
  }
  const validation = validateConfig(raw);
  const edit = (key: string, value: string) => setDraft((prior) => ({ ...prior, [key]: value }));
  return <section className="card"><h2>Parameters</h2><p>Defaults are proposals, not tuned findings. Detector edits invalidate prior rulings; ranking-only edits preserve them. Input and support-label limits apply on the next load.</p>
    <form onSubmit={(e) => { e.preventDefault(); if (validation.ok) onApply(validation.config); }}>
      <div className="param-grid">{entries.map(([key, fallback]) => <label key={key}><span>{key.replaceAll('_', ' ')}</span>
        {key === 'rank_key' ? <select value={draft[key]} disabled={busy} onChange={(e) => edit(key, e.target.value)}><option value="posterior_mean">Absolute posterior mean</option><option value="lower_endpoint">Lower endpoint of two-sided interval</option></select>
          : key === 'correction' ? <input value="holm" readOnly />
          : <input type="text" inputMode={typeof fallback === 'number' ? 'decimal' : 'text'} value={draft[key] ?? ''} disabled={busy} onChange={(e) => edit(key, e.target.value)} />}
        {HELP[key] && <small>{HELP[key]}</small>}</label>)}</div>
      {!validation.ok && <div className="error" role="alert"><p>Fix these parameters before recomputing:</p><ul>{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      <div className="toolbar"><button type="button" disabled={busy} onClick={() => setDraft(toDraft(defaultConfig()))}>Reset form to defaults</button><button type="submit" className="primary" disabled={busy || !validation.ok}>{canCompute ? 'Apply and recompute' : 'Apply for next load'}</button></div>
    </form>
  </section>;
}
