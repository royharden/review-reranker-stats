import { useState } from 'react';
import type { Decision } from '../../core/rulings/rulings';
import { rulingKey } from '../../core/rulings/rulings';
import { fmt } from '../../core/explain/fmt';
import type { BurstSpan } from '../../core/burst/types';
import type { AppState } from '../state';
import { Timeline, dayLabel } from '../components/Timeline';
import { StatusBadge } from '../components/StatusBadge';

export function BurstsPage({ state, busy, onDecision, onItem }: { state: AppState; busy: boolean; onDecision: (span: BurstSpan, decision: Decision) => void; onItem: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false); const [page, setPage] = useState(0);
  const detection = state.detection;
  if (!detection) return <section className="card"><h2>Burst queue</h2><p>Load reviews and compute rankings to assess bursts.</p></section>;
  const flagged = detection.spans.filter((s) => s.status === 'flagged');
  const spans = showAll ? detection.spans : flagged;
  const pages = Math.max(1, Math.ceil(spans.length / 12)); const current = Math.min(page, pages - 1);
  const rulings = new Map(state.rulingReplay.map((r) => [rulingKey(r.ruling), r]));
  const limits = detection.items.filter((i) => i.status !== 'assessed');
  return <section><div className="card"><h2>Burst queue</h2><p>{flagged.length} flagged spans · {detection.testedSpanCount} permutation tests · <StatusBadge status={detection.status} /></p>
    <p>Flags require unusual volume and a two-sided rating shift. P-values are evidence scores, not fraud probabilities. Confirm keeps the burst factor; restore sets it to one; skip leaves the flag applied. No decision excludes reviews.</p>
    <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setPage(0); }} />Show volume-only, unassessable and untested spans</label>
    {flagged.length === 0 && <p className="notice">No flagged spans. This does not establish that reviews are authentic.</p>}
    {limits.length > 0 && <details><summary>{limits.length} items have partial or unassessable detection</summary><ul>{limits.map((i) => <li key={i.itemId}><button className="text-button" onClick={() => onItem(i.itemId)}>{i.itemId}</button>: {i.status} — {i.reasons.join(', ') || 'no assessable spans'}</li>)}</ul></details>}
  </div>
  {spans.slice(current * 12, (current + 1) * 12).map((span) => {
    const replay = rulings.get(rulingKey(span));
    const label = replay?.status === 'applied' ? replay.ruling.decision === 'restore' ? 'restored' : replay.ruling.decision === 'confirm' ? 'confirmed' : 'skipped' : 'unreviewed';
    return <article className="card" key={rulingKey(span)}><div className="toolbar"><h3><button className="text-button" onClick={() => onItem(span.itemId)}>{span.itemId}</button></h3><StatusBadge status={span.status} />{span.status === 'flagged' && <StatusBadge status={label} />}</div>
      <p>{dayLabel(span.spanStart)} through {dayLabel(span.spanEnd)} UTC · {span.inSpanCount} reviews in span / {span.referenceCount} reference reviews</p>
      <dl className="stats"><div><dt>Volume z</dt><dd>{fmt('z', span.maxZ)}</dd></div><div><dt>Shift (stars)</dt><dd>{fmt('shift', span.shift)}</dd></div><div><dt>Permutation p</dt><dd>{fmt('pValue', span.pValue)}</dd></div><div><dt>Holm threshold</dt><dd>{fmt('pValue', span.holmThreshold)}</dd></div><div><dt>Verified share (known)</dt><dd>{fmt('verified_share', span.verifiedShare)}</dd></div></dl>
      <p>Span mean {fmt('mean', span.meanInSpan)}; reference mean {fmt('mean', span.meanReference)}. {span.reason && `Limit: ${span.reason}.`}</p>
      <Timeline detail={state.itemDetails.find((d) => d.itemId === span.itemId)} spans={detection.spans.filter((s) => s.itemId === span.itemId)} />
      {replay?.status === 'invalidated' && <p className="warning">Previous decision invalidated: {replay.reason}.</p>}
      {span.status === 'flagged' && <div className="toolbar"><button disabled={busy} onClick={() => onDecision(span, 'confirm')}>Confirm flag</button><button disabled={busy} onClick={() => onDecision(span, 'restore')}>Restore weight</button><button disabled={busy} onClick={() => onDecision(span, 'skip')}>Skip for now</button></div>}
    </article>;
  })}
  <div className="toolbar"><button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current + 1} of {pages} · {spans.length} spans</span><button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next</button></div>
  {state.rulingReplay.length > 0 && <details className="card"><summary>Latest decisions and invalidation reasons</summary><ul>{state.rulingReplay.map((r) => <li key={r.ruling.sequence}>#{r.ruling.sequence} · {r.ruling.itemId} · {r.ruling.decision} · {r.status}{r.reason ? ` (${r.reason})` : ''}</li>)}</ul></details>}
  </section>;
}
