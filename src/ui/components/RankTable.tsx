import { useState } from 'react';
import type { RankResult } from '../../core/types';
import { fmt } from '../../core/explain/fmt';
import { IntervalBar } from './IntervalBar';
import { StatusBadge } from './StatusBadge';

export function RankTable({ results, category, meanResults, onItem }: { results: readonly RankResult[]; category: string | null; meanResults: readonly RankResult[]; onItem: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const rows = results.map((result, i) => ({ result, rank: i + 1 })).filter(({ result }) => category === null || result.category === category);
  const meanRanks = new Map(meanResults.map((r, i) => [r.item_id, i + 1]));
  const pages = Math.max(1, Math.ceil(rows.length / 50)); const current = Math.min(page, pages - 1);
  if (rows.length === 0) return <p>No items match this category.</p>;
  return <><div className="table-scroll"><table><caption>Global ranks retained when filtering. Positive Δ means a rise versus mean. Category percentile is display only.</caption>
    <thead><tr><th>Rank</th><th>Item / category</th><th>Score</th><th>Δ vs mean</th><th>Interval</th><th>Reviews / effective</th><th>Category percentile</th><th>Status</th></tr></thead>
    <tbody>{rows.slice(current * 50, (current + 1) * 50).map(({ result: r, rank }) => {
      const delta = (meanRanks.get(r.item_id) ?? rank) - rank;
      return <tr key={r.item_id}><td>{rank}</td><td><button className="text-button" onClick={() => onItem(r.item_id)}>{r.item_id}</button><small className="block">{r.category}</small></td>
        <td className="number">{fmt('score', r.score)}</td><td className="number">{delta > 0 ? '+' : ''}{delta}</td><td><IntervalBar result={r} /></td>
        <td className="number">{r.n} / {fmt('n_eff', r.n_eff)}</td><td className="number">{r.parts.within_category_percentile === null ? '—' : fmt('percentile', r.parts.within_category_percentile)}</td>
        <td><div className="badges">{r.parts.insufficient && <StatusBadge status="insufficient" />}<StatusBadge status={r.parts.detector_status} />
          {r.parts.prior_source === 'global-fallback' && <StatusBadge status="global-fallback" />}
          {[...new Set(r.parts.flagged_spans.map((s) => s.label))].map((label) => <StatusBadge key={label} status={label} />)}</div></td></tr>;
    })}</tbody></table></div>
    <div className="toolbar"><button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current + 1} of {pages} · {rows.length} items</span><button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next</button></div></>;
}
