import type { MethodId, RankConfig, RankResult } from '../types';

export type CsvCell = string | number | null;
export function safeString(value: string): string {
  return /^[\t\r]/.test(value) || /^\s*[=+\-@]/u.test(value) ? "'" + value : value;
}
/** Neutralise string cells first, then RFC 4180 quote. Numeric cells stay numeric, including negative deltas. */
export function csvCell(value: CsvCell): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CSV numbers must be finite');
    return String(value);
  }
  const safe = safeString(value);
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}
export function encodeCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export interface ExportContext { method: MethodId; config: RankConfig; asOf: number; datasetHash: string; configHash: string }
export const RANKING_COLUMNS = ['item_id', 'category', 'method', 'rank', 'delta_vs_mean', 'score', 'raw_mean', 'posterior_mean', 'lo', 'hi', 'interval_quantity', 'interval_level', 'n', 'n_eff', 'within_category_percentile', 'prior_source', 'insufficient', 'detector_status', 'ruling_status', 'burst_downweighted_count', 'rank_key', 'asOf', 'datasetHash', 'configHash', 'config_json'] as const;
export function rankingRows(results: readonly RankResult[], meanResults: readonly RankResult[], context: ExportContext): CsvCell[][] {
  const meanRanks = new Map(meanResults.map((r, i) => [r.item_id, i + 1]));
  return results.map((r, i) => [r.item_id, r.category, context.method, i + 1, (meanRanks.get(r.item_id) ?? i + 1) - (i + 1), r.score,
    r.parts.raw_mean, r.parts.posterior_mean, r.lo, r.hi, r.parts.interval.quantity, r.parts.interval.level, r.n, r.n_eff,
    r.parts.within_category_percentile, r.parts.prior_source ?? '', String(r.parts.insufficient), r.parts.detector_status,
    [...new Set(r.parts.flagged_spans.map((s) => s.label))].join(';') || 'no flagged spans', r.parts.weights.burst_downweighted_count,
    context.config.rank_key, context.asOf, context.datasetHash, context.configHash, JSON.stringify(context.config)]);
}
export function rankingCsv(results: readonly RankResult[], meanResults: readonly RankResult[], context: ExportContext): string {
  return encodeCsv([RANKING_COLUMNS, ...rankingRows(results, meanResults, context)]);
}
