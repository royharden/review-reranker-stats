import type { SynthTruth, ItemTruth } from '../synth/generator';
import type { EvalConfig } from '../types';
import type { Cutoffs } from './split';
import type { Rankings } from './scoring';
import type { TemporalItem } from './temporal';
import { resultRow } from './schema';
import type { CheckResult, Partition, ResultRow } from './schema';

export function scoringTruth(item: ItemTruth, cutoff: number): { mean: number; topBox: number } | null {
  if (item.periods === null) return { mean: item.expected_mean, topBox: item.p_top_box };
  // [start,end): scoring exactly at a change point uses the new period, never the whole-item mixture.
  const period = item.periods.find((p) => p.start <= cutoff && cutoff < p.end);
  return period ? { mean: period.expected_mean, topBox: period.p_top_box } : null;
}
export function calibrationReport(rankings: Rankings, truth: SynthTruth | null, cutoffs: Cutoffs, eligible: readonly TemporalItem[],
  partition: Partition, protocol: EvalConfig): { rows: ResultRow[]; check: CheckResult } {
  const rows: ResultRow[] = []; const byTruth = new Map(truth?.items.map((i) => [i.item_id, i]) ?? []);
  const later = new Map(eligible.map((i) => [i.id, i]));
  for (const [method, ranks] of rankings) {
    if (!ranks.some((r) => r.parts.interval.quantity !== 'not-applicable')) {
      for (const cohort of ['stable', 'drift-scoring-time'] as const) rows.push(resultRow(partition, method, 'interval-coverage', null, 0, 'no interval claimed', { cohort, reason: 'Method claims no interval.' }));
      continue;
    }
    for (const cohort of ['stable', 'drift-scoring-time'] as const) {
      let covered = 0; let n = 0;
      for (const row of ranks) {
        const itemTruth = byTruth.get(row.item_id);
        if (truth !== null && (!itemTruth || (itemTruth.periods !== null) !== (cohort === 'drift-scoring-time'))) continue;
        if (truth === null && cohort === 'drift-scoring-time') continue;
        const actual = itemTruth ? scoringTruth(itemTruth, cutoffs[row.category]) : null;
        const target = truth !== null ? row.parts.interval.quantity === 'top-box share' ? actual?.topBox : actual?.mean
          : row.parts.interval.quantity === 'top-box share' ? later.get(row.item_id)?.laterTopBox : later.get(row.item_id)?.target;
        if (row.lo === null || row.hi === null || target === undefined || target === null || !Number.isFinite(target)) continue;
        n++; if (row.lo <= target && target <= row.hi) covered++;
      }
      rows.push(resultRow(partition, method, 'interval-coverage', n ? covered / n : null, n,
        truth !== null ? 'synthetic ' + (method === 'wilson' ? 'true P(stars >= 4)' : 'expected observed star mean') + '; two-sided 90%'
          : 'real predictive agreement against later ' + (method === 'wilson' ? 'top-box share' : 'star mean') + '; NOT calibration', { cohort }));
    }
  }
  const primary = rows.filter((r) => r.cohort === 'stable' && (r.method === 'wilson' || r.method === 'eb_category' || r.method === 'eb_global' || r.method === 'full'));
  const [low, high] = protocol.pass_checks.d_coverage_band;
  const insufficient = primary.some((r) => r.support < 20);
  const status = truth === null ? 'not assessable' : insufficient ? 'insufficient support'
    : primary.every((r) => r.value !== null && r.value >= low && r.value <= high) ? 'met' : 'not met';
  return { rows, check: { id: 'd', status, reason: truth === null ? 'Local real data reports predictive agreement only; no generative calibration truth.'
    : insufficient ? 'Stable matching-truth interval cohorts need at least 20 items per primary interval method.'
      : 'Stable Wilson/top-box and EB/expected-star coverage must each lie in [' + low + ', ' + high + ']. Drift coverage is separate at the frozen scoring time.' } };
}
