import { mad, median, robustScale } from '../stats/robust';
import type { RankConfig } from '../types';
import { countDays } from './dailyCounts';
import type { DailyCounts } from './dailyCounts';
import type { VolumeWindow } from './types';

export interface VolumeScan {
  candidates: VolumeWindow[];
  assessable: number;
  unassessable: number;
  baselineWindowsEvaluated: number;
}
/** Baselines stop at the item's first review day: pre-launch days are not invented zeros. */
export function scanVolume(itemId: string, series: DailyCounts, config: RankConfig): VolumeScan {
  const out: VolumeScan = { candidates: [], assessable: 0, unassessable: 0, baselineWindowsEvaluated: 0 };
  const firstDay = series.days[0];
  for (const length of config.windows_days) for (const end of series.days) {
    const start = end - length + 1;
    const earliest = Math.max(firstDay, start - config.baseline_days);
    const baseline: number[] = [];
    // Non-overlapping L-day periods strictly before this candidate's start; zero counts included.
    for (let bEnd = start - 1; bEnd - length + 1 >= earliest; bEnd -= length) {
      baseline.push(countDays(series, bEnd - length + 1, bEnd));
      out.baselineWindowsEvaluated++;
    }
    if (baseline.length < config.min_baseline_windows) { out.unassessable++; continue; }
    out.assessable++;
    const center = median(baseline) ?? 0;
    const deviation = mad(baseline) ?? 0;
    const scale = robustScale(baseline) ?? 1;
    const count = countDays(series, start, end);
    const z = (count - center) / scale;
    if (z >= config.z_min) out.candidates.push({ itemId, spanStart: start, spanEnd: end, length, count, baselineWindows: baseline.length, median: center, mad: deviation, scale, z });
  }
  return out;
}
