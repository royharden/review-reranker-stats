import { validateConfig } from '../config';
import { canonicalJson, sha256Hex } from '../stats/hash';
import type { EvalConfig, RankConfig } from '../types';
import { validateEvalConfig } from './config';
import type { Cutoffs, SourceIdentity } from './split';
import type { PriorSnapshot, RunReport } from './schema';
import { RESULT_METHODS } from './schema';
import type { BaselineId, SelectionScore, TuneResult } from './tune';

export const EVAL_VERSION = 's33-eval-1';
export const ATTACK_VERSION = 's33-attack-families-1';
export interface FrozenManifest {
  schema: 'eval-freeze-1'; evaluationVersion: typeof EVAL_VERSION; attackVersion: typeof ATTACK_VERSION;
  freezeDate: string; source: SourceIdentity; devDatasetHash: string; splitHash: string; cutoffs: Cutoffs;
  rankConfig: RankConfig & { bayes_m: number }; evalConfig: EvalConfig;
  configHash: string; bestBaseline: BaselineId; baselineScores: SelectionScore[]; keyScores: SelectionScore[];
  devFittedPriors: PriorSnapshot;
}
export interface ReadReceipt {
  sequence: number; attempt: number; phase: 'opened' | 'loaded' | 'failed'; at: string;
  reread: boolean; frozenHash: string; detail: string;
}
export interface FinalRunReceipt { attempt: number; reportHash: string; fittedPriors: PriorSnapshot; completedAt: string }
export interface EvalManifest {
  schema: 'eval-manifest-1'; frozen: FrozenManifest; frozenHash: string;
  readReceipts: ReadReceipt[]; finalRuns: FinalRunReceipt[];
}
const hex = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const count = (x: unknown): x is number => finite(x) && Number.isSafeInteger(x) && x >= 0;
const timestamp = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x));
export function assertTimestamp(at: string): void { if (!timestamp(at)) throw new Error('Explicit ISO timestamp required'); }
export function isSourceIdentity(x: unknown): x is SourceIdentity {
  return obj(x) && (x.kind === 'synthetic' || x.kind === 'local-csv') && hex(x.sourceHash) && typeof x.sourceName === 'string'
    && finite(x.asOf) && (x.generatorVersion === null || typeof x.generatorVersion === 'string')
    && (x.calendar === null ? x.kind === 'local-csv' : obj(x.calendar) && finite(x.calendar.start) && finite(x.calendar.end) && x.calendar.end > x.calendar.start);
}
export function isPriorSnapshot(x: unknown): x is PriorSnapshot {
  if (!obj(x) || !hex(x.datasetHash) || !count(x.itemCount) || !count(x.reviewCount) || !Array.isArray(x.methods)) return false;
  const seen = new Set<string>();
  for (const m of x.methods) {
    if (!obj(m) || !RESULT_METHODS.some((id) => id === m.method) || typeof m.method !== 'string' || seen.has(m.method)
      || !(m.C === null || finite(m.C) && m.C >= 1 && m.C <= 5) || !(m.m === null || finite(m.m) && m.m > 0)
      || !(m.sigma2 === null || finite(m.sigma2) && m.sigma2 > 0) || typeof m.sigma2Fallback !== 'boolean' || !Array.isArray(m.categories)) return false;
    seen.add(m.method); const categories = new Set<string>();
    for (const c of m.categories) {
      if (!obj(c) || typeof c.category !== 'string' || categories.has(c.category) || !finite(c.mean) || c.mean < 1 || c.mean > 5
        || !finite(c.tau2) || c.tau2 <= 0 || !['category', 'global', 'global-fallback'].includes(String(c.source))) return false;
      categories.add(c.category);
    }
  }
  return seen.size === RESULT_METHODS.length;
}
function selections(x: unknown, expected: readonly string[]): x is SelectionScore[] {
  return Array.isArray(x) && x.length === expected.length && x.every((s, i) => obj(s) && s.method === expected[i]
    && (s.spearman === null || finite(s.spearman) && s.spearman >= -1 && s.spearman <= 1) && count(s.eligibleItems));
}
/** Validate disk bytes, including event history, BEFORE the gate is consulted. Never trust a TS assertion on JSON. */
export async function validateManifest(raw: unknown): Promise<EvalManifest> {
  if (!obj(raw) || raw.schema !== 'eval-manifest-1' || !obj(raw.frozen) || !hex(raw.frozenHash)
    || !Array.isArray(raw.readReceipts) || !Array.isArray(raw.finalRuns)) throw new Error('Invalid manifest envelope');
  const f = raw.frozen;
  if (f.schema !== 'eval-freeze-1' || f.evaluationVersion !== EVAL_VERSION || f.attackVersion !== ATTACK_VERSION || !timestamp(f.freezeDate)
    || !isSourceIdentity(f.source) || !hex(f.devDatasetHash) || !hex(f.splitHash) || !hex(f.configHash)
    || !obj(f.cutoffs) || Object.values(f.cutoffs).some((v) => !finite(v)) || Object.keys(f.cutoffs).length === 0
    || !['mean', 'bayes_global', 'wilson'].includes(String(f.bestBaseline))
    || !selections(f.baselineScores, ['mean', 'bayes_global', 'wilson'])
    || !selections(f.keyScores, ['full:posterior_mean', 'full:lower_endpoint']) || !isPriorSnapshot(f.devFittedPriors)) throw new Error('Invalid frozen manifest');
  const rank = validateConfig(f.rankConfig); if (!rank.ok || typeof rank.config.bayes_m !== 'number') throw new Error('Final m must be numeric and frozen');
  if (rank.config.interval_level !== 0.9) throw new Error('Evaluation requires two-sided 90% rank intervals');
  const protocol = validateEvalConfig(f.evalConfig);
  if (await sha256Hex(canonicalJson({ rank: rank.config, eval: protocol })) !== f.configHash
    || await sha256Hex(canonicalJson(f)) !== raw.frozenHash) throw new Error('Frozen configuration/manifest digest mismatch');
  let attempts = 0; const phases = new Map<number, string>();
  for (let i = 0; i < raw.readReceipts.length; i++) {
    const r = raw.readReceipts[i];
    if (!obj(r) || r.sequence !== i + 1 || !count(r.attempt) || r.attempt < 1 || !timestamp(r.at)
      || r.frozenHash !== raw.frozenHash || typeof r.reread !== 'boolean' || typeof r.detail !== 'string') throw new Error('Invalid read receipt');
    if (r.phase === 'opened') {
      if (r.attempt !== attempts + 1 || r.reread !== (r.attempt > 1)) throw new Error('Invalid final/reread attempt lineage');
      attempts++; phases.set(r.attempt, 'opened');
    } else {
      if (!['loaded', 'failed'].includes(String(r.phase)) || phases.get(r.attempt) !== 'opened' || r.attempt !== attempts
        || r.reread !== (r.attempt > 1)) throw new Error('Invalid receipt transition');
      phases.set(r.attempt, String(r.phase));
    }
  }
  const completed = new Set<number>();
  for (const run of raw.finalRuns) {
    if (!obj(run) || !count(run.attempt) || phases.get(run.attempt) !== 'loaded' || completed.has(run.attempt)
      || !hex(run.reportHash) || !timestamp(run.completedAt) || !isPriorSnapshot(run.fittedPriors)) throw new Error('Invalid final run receipt');
    completed.add(run.attempt);
  }
  return JSON.parse(JSON.stringify(raw)) as EvalManifest;
}
export async function freezeDevelopment(tuned: TuneResult, protocol: EvalConfig, freezeDate: string): Promise<EvalManifest> {
  assertTimestamp(freezeDate);
  const evaluation = validateEvalConfig(protocol);
  if (tuned.config.interval_level !== 0.9) throw new Error('Evaluation requires two-sided 90% rank intervals');
  const frozen: FrozenManifest = { schema: 'eval-freeze-1', evaluationVersion: EVAL_VERSION, attackVersion: ATTACK_VERSION,
    freezeDate, source: tuned.dev.source, devDatasetHash: tuned.dev.dataset.datasetHash, splitHash: tuned.splitHash,
    cutoffs: tuned.cutoffs, rankConfig: tuned.config, evalConfig: evaluation,
    configHash: await sha256Hex(canonicalJson({ rank: tuned.config, eval: evaluation })), bestBaseline: tuned.bestBaseline,
    baselineScores: tuned.baselineScores, keyScores: tuned.keyScores, devFittedPriors: tuned.scored.priors };
  return validateManifest({ schema: 'eval-manifest-1', frozen, frozenHash: await sha256Hex(canonicalJson(frozen)), readReceipts: [], finalRuns: [] });
}
export async function appendFinalRun(manifest: EvalManifest, report: RunReport, attempt: number, completedAt: string): Promise<EvalManifest> {
  assertTimestamp(completedAt);
  if (report.partition !== 'heldout') throw new Error('Final report partition mismatch');
  return validateManifest({ ...manifest, finalRuns: [...manifest.finalRuns, { attempt, completedAt,
    reportHash: await sha256Hex(canonicalJson(report)), fittedPriors: report.priors }] });
}
