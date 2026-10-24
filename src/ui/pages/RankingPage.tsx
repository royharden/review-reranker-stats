import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { cmp } from '../../core/stats/hash';
import type { MethodId, RankResult } from '../../core/types';

// Bare ranking table (PLAN M2 acceptance 6; the full table with method/rank-key toggles, Δ vs mean, interval bars
// and badges arrives in M4). Ranks come from the worker's canonical order (score desc, item_id asc); the category
// filter is display-only and never re-ranks.

export interface RankingPageProps {
  method: MethodId;
  results: RankResult[] | null;
  recomputing: boolean;
  datasetHash: string | null;
  configHash: string | null;
}

const MAX_ROWS = 1000;
const tableStyle: CSSProperties = { borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' };
const cellStyle: CSSProperties = { borderBottom: '1px solid #ddd', padding: '0.25rem 0.5rem', textAlign: 'left' };
const numStyle: CSSProperties = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const badgeStyle: CSSProperties = { fontSize: '0.75rem', border: '1px solid #999', borderRadius: 3, padding: '0 0.3rem', marginLeft: '0.4rem' };

const ALL = '';

function fmt2(x: number | null): string {
  return x === null || !Number.isFinite(x) ? '—' : x.toFixed(2);
}

export function RankingPage(props: RankingPageProps) {
  const [category, setCategory] = useState<string>(ALL);
  const results = props.results;

  const categories = useMemo(() => {
    if (!results) return [];
    return Array.from(new Set(results.map((r) => r.category))).sort(cmp);
  }, [results]);

  if (!results) {
    return <p>No ranking yet. Load the sample or a CSV file first.</p>;
  }

  // Global rank = position in the canonical order, kept when filtering.
  const rows = results.map((r, i) => ({ r, rank: i + 1 })).filter(({ r }) => category === ALL || r.category === category);
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div>
      <h2>Ranking — {props.method}</h2>
      <p style={{ fontSize: '0.85rem', color: '#555' }}>
        {results.length} items. Interval: “—” means this method claims no interval. Dataset {props.datasetHash?.slice(0, 12) ?? '—'} · config{' '}
        {props.configHash?.slice(0, 12) ?? '—'}
        {props.recomputing && ' · recomputing…'}
      </p>
      <label>
        Category (display filter){' '}
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value={ALL}>All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <table style={{ ...tableStyle, marginTop: '0.75rem' }}>
        <thead>
          <tr>
            <th style={numStyle}>Rank</th>
            <th style={cellStyle}>Item</th>
            <th style={cellStyle}>Category</th>
            <th style={numStyle}>Reviews</th>
            <th style={numStyle}>Score</th>
            <th style={cellStyle}>90% interval</th>
            <th style={numStyle}>Within-category percentile</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ r, rank }) => (
            <tr key={r.item_id}>
              <td style={numStyle}>{rank}</td>
              <td style={cellStyle}>
                {r.item_id}
                {r.parts.insufficient && <span style={badgeStyle}>insufficient</span>}
              </td>
              <td style={cellStyle}>{r.category}</td>
              <td style={numStyle}>{r.n}</td>
              <td style={numStyle}>{fmt2(r.score)}</td>
              <td style={cellStyle}>{r.lo === null || r.hi === null ? '—' : `${fmt2(r.lo)} – ${fmt2(r.hi)}`}</td>
              <td style={numStyle}>{r.parts.within_category_percentile === null ? '—' : r.parts.within_category_percentile.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p>
          Showing the first {shown.length} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}
