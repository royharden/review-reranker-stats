import { buildDataset } from '../data/dataset';
import { detectBursts } from '../burst/detect';
import { buildTraps } from '../synth/traps';
import { canonicalJson } from '../stats/hash';
import type { Dataset, EvalConfig, RankConfig } from '../types';
import type { SynthTruth } from '../synth/generator';
import { loadHeldOut } from './heldout';
import type { HeldOutStorage } from './heldout';
import { appendFinalRun, validateManifest } from './manifest';
import type { EvalManifest } from './manifest';
import { partitionOf, splitTime } from './split';
import type { Cutoffs, DevData } from './split';
import type { BaselineId, TuneResult } from './tune';
import { scoreCatalogue, restrictRankings } from './scoring';
import { supportReport, temporalItems, temporalReport } from './temporal';
import { plantBursts } from './plantBursts';
import type { ShapeFamily } from './plantBursts';
import { priorDrift, robustnessReport } from './robustness';
import { calibrationReport } from './calibration';
import { globalPriorCategories, rankMovements } from './ablations';
import { resultRow, RESULT_METHODS } from './schema';
import type { CheckResult, Partition, RunReport } from './schema';

async function organicControl(config: RankConfig, asOf: number, seed: number): Promise<CheckResult> {
  const traps = buildTraps(asOf, seed);
  const target = traps.meta.find((m) => m.name === 'viral_organic')?.roles.target;
  if (target === undefined) return { id: 'c', status: 'not assessable', reason: 'No viral_organic control fixture.' };
  // Evaluate the canonical control in isolation; no attack labels or expected outcomes enter the detector.
  const reviews = traps.reviews.filter((r) => r.item_id === target);
  const dataset = await buildDataset(reviews, { asOf, verifiedColumnPresent: true, insufficientBelow: config.insufficient_below });
  const detected = await detectBursts(dataset, config);
  const item = detected.items.find((i) => i.itemId === target);
  const flagged = detected.spans.some((s) => s.itemId === target && s.status === 'flagged');
  return { id: 'c', status: flagged ? 'not met' : item?.status !== 'assessed' ? 'not assessable' : 'met',
    reason: 'Canonical synthetic viral_organic control: ' + (flagged ? 'flagged' : item?.status === 'assessed' ? 'assessed and unflagged' : 'unassessable/partial') + '; not evidence of real-world organic recall.' };
}
export interface EvaluationInput {
  dataset: Dataset; scoringIds: ReadonlySet<string>; truth: SynthTruth | null; cutoffs: Cutoffs;
  rank: RankConfig; protocol: EvalConfig; bestBaseline: BaselineId; partition: Partition; attackFamily: ShapeFamily;
}
/** Pure evaluation. dataset is dev-only before the gate, or all items AFTER the final gate. */
export async function runEvaluation(input: EvaluationInput): Promise<RunReport> {
  const { dataset, scoringIds, truth, cutoffs, rank, protocol, bestBaseline, partition } = input;
  if (typeof rank.bayes_m !== 'number') throw new Error('Evaluation requires numeric dev-frozen bayes m');
  const { pre, later, unknownCategories } = await splitTime(dataset, cutoffs, rank);
  const scoredIds = new Set(Array.from(scoringIds).filter((id) => pre.items.has(id)));
  const clean = await scoreCatalogue(pre, rank, cutoffs);
  const rankings = restrictRankings(clean.rankings, scoredIds);
  const eligible = temporalItems(pre, later, scoringIds, protocol);
  const support = supportReport(dataset, pre, scoringIds, eligible, protocol, unknownCategories);
  const rows = temporalReport(eligible, rankings, bestBaseline, partition, protocol, support);
  const planted = await plantBursts(pre, protocol.generator_seed + 3300, input.attackFamily, cutoffs, rank, scoredIds);
  const attacked = await scoreCatalogue(planted.dataset, rank, cutoffs);
  const robust = robustnessReport(rankings, restrictRankings(attacked.rankings, scoredIds), planted.dataset,
    attacked.detection, planted.truth, partition, protocol.pass_checks.b_max_damage_ratio, scoredIds);
  rows.push(...robust.rows);
  const coverage = calibrationReport(rankings, truth, cutoffs, eligible, partition, protocol); rows.push(...coverage.rows);
  const paired = rows.find((r) => r.method === 'full' && r.metric === 'paired-spearman' && r.cohort === 'overall');
  const checkA: CheckResult = { id: 'a', status: !support.sufficient ? 'insufficient support' : paired?.ci === null || paired?.ci === undefined
    || paired.value === null ? 'not assessable' : paired.ci.lo > protocol.pass_checks.a_min_paired_ci_lower ? 'met' : 'not met',
    reason: !support.sufficient ? support.reasons.join('; ') : 'Lower two-sided 95% paired Spearman CI of full minus frozen ' + bestBaseline
      + ' must be > ' + protocol.pass_checks.a_min_paired_ci_lower + '; undefined bootstrap statistics cannot pass.' };
  const organic = rows.find((r) => r.metric === 'organic-downweight-share');
  const checkE: CheckResult = { id: 'e', status: organic?.value === null || organic?.value === undefined ? 'not assessable'
    : organic.value <= protocol.pass_checks.e_max_organic_downweight_share ? 'met' : 'not met',
    reason: 'Organic review downweight share in the attacked scoring partition must be <= ' + protocol.pass_checks.e_max_organic_downweight_share
      + '; denominator excludes every injected review id and excludes prior-only items.' };
  const checkC = await organicControl(rank, pre.asOf, protocol.generator_seed);
  for (const method of RESULT_METHODS) for (const metric of ['runtime-per-100k-ms', 'runtime-at-200k-ms', 'heap-used-bytes'] as const) {
    rows.push(resultRow(partition, method, metric, null, 0, 'Node script benchmark only', { status: 'not yet measured', reason: 'Run scripts/eval.ts with --benchmark; core does not read clocks or heap.' }));
  }
  return { schema: 'eval-run-1', partition, rows, checks: [checkA, robust.check, checkC, coverage.check, checkE], support,
    priors: clean.priors, priorDrift: priorDrift(clean, attacked, planted.truth.attacks), bestBaseline, rankKey: rank.rank_key,
    failures: { evadedAttacks: robust.evaded, flaggedOrganic: robust.flaggedOrganic, rankMovements: rankMovements(rankings),
      globalPriorCategories: globalPriorCategories(clean.priors, partition) } };
}
export function runDevelopment(tuned: TuneResult, protocol: EvalConfig): Promise<RunReport> {
  return runEvaluation({ dataset: tuned.dev.dataset, scoringIds: new Set(tuned.dev.dataset.items.keys()), truth: tuned.dev.truth,
    cutoffs: tuned.cutoffs, rank: tuned.config, protocol, bestBaseline: tuned.bestBaseline, partition: 'dev', attackFamily: 'dev' });
}
export async function runFinal(options: { final: boolean; manifestPath: string; storage: HeldOutStorage; dev: DevData; at: string; reread?: boolean }):
  Promise<{ report: RunReport; manifest: EvalManifest; attempt: number }> {
  const before = await validateManifest(await options.storage.readManifest(options.manifestPath));
  if (options.dev.dataset.datasetHash !== before.frozen.devDatasetHash || canonicalJson(options.dev.source) !== canonicalJson(before.frozen.source)) throw new Error('Dev source differs from frozen manifest; final cannot retune');
  const read = await loadHeldOut(options);
  if (read.manifest.frozenHash !== before.frozenHash) throw new Error('Frozen manifest changed during final admission');
  const frozen = read.manifest.frozen;
  const full = await buildDataset([...options.dev.dataset.reviews, ...read.dataset.reviews], {
    asOf: frozen.source.asOf, verifiedColumnPresent: options.dev.dataset.verifiedColumnPresent || read.dataset.verifiedColumnPresent,
    insufficientBelow: frozen.rankConfig.insufficient_below });
  if (full.datasetHash !== frozen.source.sourceHash) throw new Error('Combined dev/held-out source hash mismatch (attempt consumed)');
  if (Array.from(read.dataset.items.keys()).some((id) => partitionOf(id, frozen.evalConfig) !== 'heldout')) throw new Error('Wrong final scoring partition');
  const truth = read.truth === null || options.dev.truth === null ? null : { ...read.truth, items: [...options.dev.truth.items, ...read.truth.items] };
  const report = await runEvaluation({ dataset: full, scoringIds: new Set(read.dataset.items.keys()), truth,
    cutoffs: frozen.cutoffs, rank: frozen.rankConfig, protocol: frozen.evalConfig, bestBaseline: frozen.bestBaseline,
    partition: 'heldout', attackFamily: 'heldout' });
  if (frozen.baselineScores.every((score) => score.spearman === null)) {
    report.checks = report.checks.map((check) => check.id === 'a' ? { id: 'a', status: 'not assessable',
      reason: 'No defined dev baseline Spearman was available at freeze; the recorded mean fallback cannot support a selected-baseline temporal headline.' } : check);
  }
  return { report, manifest: read.manifest, attempt: read.attempt };
}
/** Called after script-only benchmark rows are added. Preserve concurrent disclosed read events. */
export async function completeFinal(options: { storage: HeldOutStorage; manifestPath: string; report: RunReport; attempt: number; at: string; frozenHash: string }): Promise<EvalManifest> {
  return options.storage.exclusive(options.manifestPath, async () => {
    const current = await validateManifest(await options.storage.readManifest(options.manifestPath));
    if (current.frozenHash !== options.frozenHash) throw new Error('Frozen final manifest changed');
    const next = await appendFinalRun(current, options.report, options.attempt, options.at);
    await options.storage.writeManifest(options.manifestPath, next); return next;
  });
}
