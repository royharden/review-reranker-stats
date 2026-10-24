import type { MethodId } from '../../core/types';
import { fmt } from '../../core/explain/fmt';
import type { AppState } from '../state';
import { Timeline } from '../components/Timeline';
import { IntervalBar } from '../components/IntervalBar';
import { StatusBadge } from '../components/StatusBadge';

export function ItemPage({ state, itemId, method, onBursts, onBack }: { state: AppState; itemId: string | null; method: MethodId; onBursts: () => void; onBack: () => void }) {
  const detail = state.itemDetails.find((d) => d.itemId === itemId);
  const selected = (state.rankings?.[method] ?? []).find((r) => r.item_id === itemId);
  if (!detail || !selected) return <section className="card"><h2>Item</h2><p>Select an item in Ranking to inspect its evidence.</p><button onClick={onBack}>Open Ranking</button></section>;
  const spans = state.detection?.spans.filter((s) => s.itemId === itemId) ?? [];
  const assessment = state.detection?.items.find((i) => i.itemId === itemId);
  return <section className="card"><div className="toolbar"><button onClick={onBack}>← Ranking</button><button onClick={onBursts}>Review bursts</button></div>
    <h2 className="break">{itemId}</h2><p>{selected.category} · <StatusBadge status={selected.parts.detector_status} /> {selected.parts.insufficient && <StatusBadge status="insufficient" />}</p>
    {assessment && assessment.reasons.length > 0 && <p className="warning">Detector limits: {assessment.reasons.join(', ')}. This is not a clean bill of health.</p>}
    <Timeline detail={detail} spans={spans} />
    <h3>{state.methodLabels[method] ?? method}: explanation</h3><p className="explanation">{detail.explanations[method] ?? 'No explanation returned.'}</p>
    <div className="badges">{selected.parts.flagged_spans.map((s) => <StatusBadge key={`${s.span_start}:${s.span_end}`} status={s.label} />)}</div>
    <div className="table-scroll"><table><caption>All methods on the same accepted reviews; Wilson uses top-box share, other scores use stars.</caption><thead><tr><th>Method</th><th>Global rank</th><th>Score</th><th>Estimated mean</th><th>Interval</th><th>Effective n</th><th>Prior</th></tr></thead>
      <tbody>{state.methods.map((m) => { const r = state.rankings?.[m]?.find((row) => row.item_id === itemId); if (!r) return null;
        return <tr key={m}><th>{state.methodLabels[m] ?? m}</th><td>{r.parts.rank_by_method[m]}</td><td>{fmt('score', r.score)}</td><td>{fmt('posterior_mean', r.parts.posterior_mean)}</td><td><IntervalBar result={r} /></td><td>{fmt('n_eff', r.n_eff)}</td><td>{r.parts.prior_source ?? '—'}</td></tr>; })}</tbody></table></div>
    <p className="muted">Every accepted review remains in the analysis. A restored span has burst factor one; overlapping active flags can still reduce a review’s weight. Verified and recency factors remain separate.</p>
  </section>;
}
