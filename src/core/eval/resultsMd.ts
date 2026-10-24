import { CHECK_IDS, RESULT_METHODS } from './schema';
import type { EvalMethod, ResultRow, RunReport } from './schema';
import type { EvalManifest } from './manifest';
import { ABLATION_COMPARISONS, globalPriorCategories } from './ablations';
import { ATTACK_TYPES } from './plantBursts';

export const RESULT_COLUMNS = ['Spearman overall (95% CI)', 'NDCG@10 overall (95% CI)', 'Spearman cold-start (95% CI)',
  'NDCG@10 cold-start (95% CI)', 'Paired Spearman difference vs best baseline (95% CI)', 'Paired NDCG@10 difference vs best baseline (95% CI)',
  'signed lift', 'damage', 'top-10% entries (promo) / exits (bomb)', 'detector precision', 'detector recall',
  'organic-downweight share', 'interval coverage', 'runtime per 100k', 'runtime at 200k', 'heap'] as const;
export const NAMED_FAILURE_SECTIONS = ['Evaded attacks', 'Flagged organic bursts', 'Top-10 items by |rank change vs mean| per method', 'Categories on the global prior (both runs)'] as const;
export const README_RESULTS_START = '<!-- results:start -->';
export const README_RESULTS_END = '<!-- results:end -->';
function cell(value: unknown): string { return String(value).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' '); }
function number(value: number): string { return value.toFixed(4); }
function show(row: ResultRow | undefined): string {
  if (!row) return 'not yet measured';
  const value = row.value === null ? row.status : number(row.value);
  const ci = row.ci === null ? '' : ' [' + number(row.ci.lo) + ', ' + number(row.ci.hi) + ']';
  return cell(value + ci + ' (n=' + row.support + ')' + (row.status === 'measured' ? '' : '; ' + row.status));
}
function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return '| ' + headers.map(cell).join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n'
    + rows.map((r) => '| ' + r.map(cell).join(' | ') + ' |').join('\n') + '\n';
}
/** No report means no numbers: this is also the source placeholder used before activation. */
export function resultsMarkdown(report: RunReport | null, manifest: EvalManifest | null = null): string {
  const lines = ['# Evaluation results', '', report ? 'Measured partition: **' + report.partition + '**. Frozen baseline: **' + report.bestBaseline
    + '**; selected full key: **' + report.rankKey + '**.' : '**not yet measured**. Evaluation, tests, runtime and support have not been run.', ''];
  if (manifest) lines.push('Frozen manifest: `' + manifest.frozenHash + '`. Final read attempts: ' + manifest.readReceipts.filter((r) => r.phase === 'opened').length
    + '. Disclosed rereads: ' + manifest.readReceipts.filter((r) => r.phase === 'opened' && r.reread).length + '.', '');
  lines.push('## Checks (a)–(e)', '', table(['Check', 'Status', 'Reason'], CHECK_IDS.map((id) => {
    const c = report?.checks.find((x) => x.id === id); return [id, c?.status ?? 'not yet measured', c?.reason ?? 'No evaluation run.'];
  })), '');
  if (report) lines.push('Eligible targets: ' + report.support.eligibleItems + '; cold-start: ' + report.support.coldStartItems
    + '; scoring partition items: ' + report.support.partitionItems + '; prior-fitting items: ' + report.support.fitItems + '.',
  table(['Category', 'Partition items', 'Eligible targets'], report.support.perCategory.map((r) => [r.category, r.partitionItems, r.eligibleItems])),
  report.support.sufficient ? 'Support gate met.' : '**insufficient support**: ' + report.support.reasons.map(cell).join('; '), '');
  const find = (method: EvalMethod, metric: ResultRow['metric'], cohort: ResultRow['cohort'] = 'overall', attack: string | null = null) =>
    report?.rows.find((r) => r.method === method && r.metric === metric && r.cohort === cohort && r.attack === attack);
  lines.push('## Temporal agreement', '', table(['Method', ...RESULT_COLUMNS.slice(0, 6)], RESULT_METHODS.map((method) => [method,
    show(find(method, 'spearman')), show(find(method, 'ndcg@10')), show(find(method, 'spearman', 'cold-start')), show(find(method, 'ndcg@10', 'cold-start')),
    show(find(method, 'paired-spearman')), show(find(method, 'paired-ndcg@10'))])), '',
  'CIs use seeded item bootstrap; paired comparisons recompute both metrics on the same occurrence-preserving draws. Undefined resamples are counted in JSONL. Cold-start n<20 is labelled underpowered.', '');
  lines.push('## Attacks', '', table(['Method', 'Attack', 'signed lift', 'damage', 'top-10% entries (promo) / exits (bomb)'],
    RESULT_METHODS.flatMap((method) => ATTACK_TYPES.map((attack) => [method, attack, show(find(method, 'signed-lift', 'overall', attack)),
      show(find(method, 'damage', 'overall', attack)), show(find(method, attack === 'bomb' ? 'top-10%-exits' : 'top-10%-entries', 'overall', attack))]))), '',
  'Lift is q_attacked − q_clean; bomb damage reverses the sign. Baseline damage ≤0 makes check (b) not assessable. Dev and final use different attack-shape families. Recall applies only to sampled generator shapes.', '');
  lines.push('## Detector and matching-truth intervals', '', table(['Method', 'detector precision', 'detector recall', 'organic-downweight share', 'interval coverage (stable)', 'interval coverage (drift at scoring time)'],
    RESULT_METHODS.map((method) => [method, method === 'full' || !report ? show(find(method, 'detector-precision')) : 'shared detector; see full',
      method === 'full' || !report ? show(find(method, 'detector-recall')) : 'shared detector; see full',
      method === 'full' || !report ? show(find(method, 'organic-downweight-share')) : 'shared detector; see full',
      show(find(method, 'interval-coverage', 'stable')), show(find(method, 'interval-coverage', 'drift-scoring-time'))])), '',
  'Detector denominators are unique review ids in the scoring partition. Coverage compares Wilson to true top-box probability and EB to expected stars. Local real CSV results are predictive agreement, never generative calibration.', '');
  lines.push('## Ablations and key comparison', '', table(['Method', 'Comparison'], ABLATION_COMPARISONS), '',
    'The full-minus-one rows above remove exactly the named factor. Both EB grouping variants and both full keys are evaluated with the same item universe.', '');
  lines.push('## Runtime', '', table(['Method', 'runtime per 100k (ms)', 'runtime at 200k (ms)', 'heap (bytes)'], RESULT_METHODS.map((method) => [method,
    show(find(method, 'runtime-per-100k-ms')), show(find(method, 'runtime-at-200k-ms')), show(find(method, 'heap-used-bytes'))])), '',
    'Timing and process heap are measured only by the Node script when --benchmark is supplied; they include detection and fitting. Heap is a sampled process heap, not browser-worker peak memory.', '');
  lines.push('## Fitted prior drift under attack', '', report ? table(['Method', 'Category', 'clean μ', 'attacked μ', 'Δμ', 'clean τ²', 'attacked τ²', 'Δτ²', 'Fallback/source change'],
    report.priorDrift.map((d) => [d.method, d.category, d.cleanMean, d.attackedMean, d.meanDelta, d.cleanTau2, d.attackedTau2, d.tau2Delta, d.cleanSource + ' → ' + d.attackedSource])) : 'not yet measured', '');
  lines.push('## ' + NAMED_FAILURE_SECTIONS[0], '', !report ? 'not yet measured' : report.failures.evadedAttacks.length
    ? table(['Attack', 'Item', 'Start day', 'End day', 'Injected reviews', 'Flagged injected reviews'], report.failures.evadedAttacks.map((f) => [f.attack, f.itemId, f.start, f.end, f.injectedReviews, f.flaggedReviews])) : 'None observed in this measured run.', '');
  lines.push('## ' + NAMED_FAILURE_SECTIONS[1], '', !report ? 'not yet measured' : report.failures.flaggedOrganic.length
    ? table(['Item', 'Start day', 'End day', 'Organic reviews in flagged span'], report.failures.flaggedOrganic.map((f) => [f.itemId, f.start, f.end, f.organicReviews])) : 'None observed in this measured run.', '');
  lines.push('## ' + NAMED_FAILURE_SECTIONS[2], '', !report ? 'not yet measured' : table(['Method', 'Item', 'Mean rank', 'Method rank', 'Rank change'],
    report.failures.rankMovements.map((f) => [f.method, f.itemId, f.meanRank, f.methodRank, f.delta])), '');
  const fallbacks = report ? [...(manifest ? globalPriorCategories(manifest.frozen.devFittedPriors, 'dev') : []),
    ...report.failures.globalPriorCategories.filter((f) => !manifest || f.run !== 'dev')] : [];
  lines.push('## ' + NAMED_FAILURE_SECTIONS[3], '', !report ? 'not yet measured' : table(['Run', 'Method', 'Category'], fallbacks.map((f) => [f.run, f.method, f.category])), '',
    'Both runs’ μ/τ²/σ²/C, numeric m and fallback flags are retained side by side in manifest.json. Final priors refit all items’ pre-cutoff reviews; held-out targets are scored only after the gate.', '');
  return lines.join('\n');
}
export function rewriteReadmeResults(readme: string, markdown: string): string {
  const start = readme.indexOf(README_RESULTS_START); const end = readme.indexOf(README_RESULTS_END);
  if (start < 0 || end < start || readme.indexOf(README_RESULTS_START, start + 1) >= 0 || readme.indexOf(README_RESULTS_END, end + 1) >= 0) throw new Error('README needs exactly one ordered results marker pair');
  return readme.slice(0, start + README_RESULTS_START.length) + '\n\n' + markdown.trim() + '\n\n' + readme.slice(end);
}
