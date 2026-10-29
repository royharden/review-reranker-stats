import type { BurstSpan } from '../../core/burst/types';
import type { ItemDetail } from '../../worker/details';

export function dayLabel(day: number): string { return new Date(day * 86_400_000).toISOString().slice(0, 10); }
export function Timeline({ detail, spans = [] }: { detail: ItemDetail | undefined; spans?: readonly BurstSpan[] }) {
  if (!detail || detail.bins.length === 0) return <p>No timeline data.</p>;
  const bins = detail.bins;
  const start = bins[0].startDay; const end = bins[bins.length - 1].endDay + 1;
  const x = (day: number) => 42 + (day - start) / (end - start) * 666;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const starY = (mean: number) => 148 - (mean - 1) / 4 * 116;
  // Separate paths across empty seven-day windows rather than implying observed ratings in gaps.
  const paths: string[] = []; let path = '';
  for (const bin of bins) {
    if (bin.rollingMean === null) { if (path) paths.push(path); path = ''; }
    else path += `${path ? ' L' : 'M'}${x(bin.endDay + 1)},${starY(bin.rollingMean)}`;
  }
  if (path) paths.push(path);
  return <figure className="timeline"><svg viewBox="0 0 760 190" role="img" aria-label={`Review counts and seven-day rolling star mean for ${detail.itemId}`}>
    <title>Counts per {detail.binDays === 1 ? 'day' : `${detail.binDays}-day bucket`}; seven-day rolling mean at each bucket end; shaded flagged spans</title>
    {spans.filter((s) => s.status === 'flagged').map((s) => <rect key={`${s.spanStart}:${s.spanEnd}`} x={x(Math.max(start, s.spanStart))} y="24" width={Math.max(1, x(Math.min(end, s.spanEnd + 1)) - x(Math.max(start, s.spanStart)))} height="126" fill="#ffd5a3" />)}
    {bins.map((b) => <rect key={b.startDay} x={x(b.startDay)} y={150 - b.count / maxCount * 110} width={Math.max(1, x(b.endDay + 1) - x(b.startDay) - 1)} height={b.count / maxCount * 110} fill="#9ac9c5"><title>{dayLabel(b.startDay)} through {dayLabel(b.endDay)}: {b.count} reviews; rolling mean {b.rollingMean?.toFixed(2) ?? 'unavailable'}</title></rect>)}
    {paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#4a3a96" strokeWidth="2.5" />)}
    {bins.filter((b) => b.rollingMean !== null).map((b) => <circle key={b.startDay} cx={x(b.endDay + 1)} cy={starY(b.rollingMean ?? 1)} r="2" fill="#4a3a96" />)}
    <line x1="42" x2="708" y1="150" y2="150" stroke="#506265" />
    <text x="3" y="18" fontSize="11">Count</text><text x="3" y="42" fontSize="11">{maxCount}</text><text x="20" y="150" fontSize="11">0</text>
    <text x="713" y="18" fontSize="11">Stars</text><text x="717" y="35" fontSize="11">5</text><text x="717" y="150" fontSize="11">1</text>
    <text x="42" y="175" fontSize="12">{dayLabel(start)}</text><text x="708" y="175" textAnchor="end" fontSize="12">{dayLabel(end - 1)}</text>
  </svg><figcaption>Teal: counts per {detail.binDays === 1 ? 'day' : `${detail.binDays}-day bucket`}. Purple: seven-day rolling mean at bucket end (right star axis). Orange: flagged spans, including restored spans.</figcaption></figure>;
}
