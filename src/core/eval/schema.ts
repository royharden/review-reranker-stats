import { METHOD_ORDER } from '../rankers/registry';
import type { EvalConfig, MethodId, RankConfig, RankKey } from '../types';

export const CHECK_IDS = ['a', 'b', 'c', 'd', 'e'] as const;
export type CheckId = typeof CHECK_IDS[number];
export const CHECK_STATES = ['met', 'not met', 'not assessable', 'insufficient support', 'not yet measured'] as const;
export type CheckState = typeof CHECK_STATES[number];
export type Partition = 'dev' | 'heldout';
export type EvalMethod = MethodId | 'full:posterior_mean' | 'full:lower_endpoint';
export const RESULT_METHODS: readonly EvalMethod[] = [...METHOD_ORDER, 'full:posterior_mean', 'full:lower_endpoint'];
export const METRICS = ['spearman', 'ndcg@10', 'paired-spearman', 'paired-ndcg@10', 'signed-lift', 'damage',
  'top-10%-entries', 'top-10%-exits', 'detector-precision', 'detector-recall', 'organic-downweight-share',
  'interval-coverage', 'runtime-per-100k-ms', 'runtime-at-200k-ms', 'heap-used-bytes'] as const;
export type Metric = typeof METRICS[number];
export type RowState = 'measured' | 'not assessable' | 'insufficient support' | 'not yet measured';
export interface ConfidenceInterval {
  lo: number; hi: number; level: number; resamples: number; undefinedResamples: number;
}
export interface ResultRow {
  schema: 'eval-result-1'; partition: Partition; method: EvalMethod; metric: Metric;
  cohort: 'overall' | 'cold-start' | 'stable' | 'drift-scoring-time';
  attack: string | null; value: number | null; ci: ConfidenceInterval | null;
  support: number; denominator: string; status: RowState; reason: string | null;
}
export interface CheckResult { id: CheckId; status: CheckState; reason: string }
export interface CategoryPrior { category: string; mean: number; tau2: number; source: 'category' | 'global' | 'global-fallback' }
export interface MethodPrior {
  method: EvalMethod; C: number | null; m: number | null; sigma2: number | null; sigma2Fallback: boolean;
  categories: CategoryPrior[];
}
export interface PriorSnapshot { datasetHash: string; itemCount: number; reviewCount: number; methods: MethodPrior[] }
export interface SupportReport {
  partitionItems: number; fitItems: number; eligibleItems: number; coldStartItems: number;
  perCategory: Array<{ category: string; partitionItems: number; eligibleItems: number }>;
  sufficient: boolean; reasons: string[];
}
export interface RankMovement { method: EvalMethod; itemId: string; meanRank: number; methodRank: number; delta: number }
export interface NamedFailures {
  evadedAttacks: Array<{ attack: string; itemId: string; start: number; end: number; injectedReviews: number; flaggedReviews: number }>;
  flaggedOrganic: Array<{ itemId: string; start: number; end: number; organicReviews: number }>;
  rankMovements: RankMovement[];
  globalPriorCategories: Array<{ run: Partition; method: EvalMethod; category: string }>;
}
export interface PriorDrift {
  method: EvalMethod; category: string; cleanMean: number; attackedMean: number; meanDelta: number;
  cleanTau2: number; attackedTau2: number; tau2Delta: number; cleanSource: string; attackedSource: string;
}
export interface RunReport {
  schema: 'eval-run-1'; partition: Partition; rows: ResultRow[]; checks: CheckResult[]; support: SupportReport;
  priors: PriorSnapshot; failures: NamedFailures; priorDrift: PriorDrift[];
  bestBaseline: 'mean' | 'bayes_global' | 'wilson'; rankKey: RankKey;
}
export interface FrozenSettings { rank: RankConfig; eval: EvalConfig }

function record(x: unknown): x is Record<string, unknown> { return typeof x === 'object' && x !== null && !Array.isArray(x); }
function finite(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x); }
function integer(x: unknown): x is number { return finite(x) && Number.isSafeInteger(x) && x >= 0; }
function member<T extends string>(x: unknown, xs: readonly T[]): x is T { return typeof x === 'string' && xs.some((s) => s === x); }
export function isConfidenceInterval(x: unknown): x is ConfidenceInterval {
  return record(x) && finite(x.lo) && finite(x.hi) && x.lo <= x.hi && finite(x.level) && x.level > 0 && x.level < 1
    && integer(x.resamples) && x.resamples > 0 && integer(x.undefinedResamples) && x.undefinedResamples < x.resamples;
}
/** Reject missing/NaN values and contradictory uncertainty states before emitting JSONL. */
export function isResultRow(x: unknown): x is ResultRow {
  if (!record(x) || x.schema !== 'eval-result-1' || !member(x.partition, ['dev', 'heldout'])
    || !member(x.method, RESULT_METHODS) || !member(x.metric, METRICS)
    || !member(x.cohort, ['overall', 'cold-start', 'stable', 'drift-scoring-time'])
    || !(x.attack === null || typeof x.attack === 'string') || !integer(x.support) || typeof x.denominator !== 'string'
    || !member(x.status, ['measured', 'not assessable', 'insufficient support', 'not yet measured'])
    || !(x.reason === null || typeof x.reason === 'string') || !(x.ci === null || isConfidenceInterval(x.ci))) return false;
  if (x.status === 'measured') return finite(x.value) && x.support > 0 && x.reason === null;
  return (x.value === null || (x.status === 'insufficient support' && finite(x.value)))
    && typeof x.reason === 'string' && x.reason.length > 0 && (x.status === 'insufficient support' || x.ci === null);
}
export function resultsJsonl(rows: readonly ResultRow[]): string {
  return rows.map((row) => { if (!isResultRow(row)) throw new Error('Invalid eval-result-1 row'); return JSON.stringify(row); }).join('\n') + '\n';
}
export function parseResultsJsonl(text: string): ResultRow[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '').map((line, i) => {
    const raw: unknown = JSON.parse(line); if (!isResultRow(raw)) throw new Error('Invalid result row ' + (i + 1)); return raw;
  });
}
export function resultRow(partition: Partition, method: EvalMethod, metric: Metric, value: number | null, support: number,
  denominator: string, options: Partial<Pick<ResultRow, 'cohort' | 'attack' | 'ci' | 'status' | 'reason'>> = {}): ResultRow {
  const row: ResultRow = { schema: 'eval-result-1', partition, method, metric, value, support, denominator,
    cohort: 'overall', attack: null, ci: null, status: value === null ? 'not assessable' : 'measured',
    reason: value === null ? 'No usable denominator or statistic is undefined.' : null, ...options };
  if (!isResultRow(row)) throw new Error('Inconsistent result row: ' + metric); return row;
}
