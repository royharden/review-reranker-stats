import type { RankResult } from '../../core/types';
import { fmt } from '../../core/explain/fmt';

export function IntervalBar({ result }: { result: RankResult }) {
  const meta = result.parts.interval;
  if (result.lo === null || result.hi === null || meta.quantity === 'not-applicable') return <span title="This method does not claim an interval">—</span>;
  const min = meta.quantity === 'top-box share' ? 0 : 1;
  const max = meta.quantity === 'top-box share' ? 1 : 5;
  const x = (n: number) => 8 + 124 * (Math.min(max, Math.max(min, n)) - min) / (max - min);
  const label = `${fmt('interval.level', meta.level)} two-sided interval, ${meta.quantity}: ${fmt('lo', result.lo)} to ${fmt('hi', result.hi)}`;
  return <span className="interval"><svg viewBox="0 0 140 30" role="img" aria-label={label}>
    <title>{label}</title><line x1="8" x2="132" y1="11" y2="11" stroke="#c7d3d5" />
    <line x1={x(result.lo)} x2={x(result.hi)} y1="11" y2="11" stroke="#087d79" strokeWidth="5" />
    <text x="8" y="28" fontSize="9">{min}</text><text x="128" y="28" fontSize="9">{max}</text>
  </svg><small>{fmt('lo', result.lo)}–{fmt('hi', result.hi)} {meta.quantity}</small></span>;
}
