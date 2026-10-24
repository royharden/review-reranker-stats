// UNRUN, designed ~2k-review generated smoke through a complete in-memory adapter.
import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/core/data/dataset';
import { runDevelopment, runFinal, completeFinal, runEvaluation } from '../../src/core/eval/runner';
import { resultsJsonl, parseResultsJsonl, RESULT_METHODS } from '../../src/core/eval/schema';
import { resultsMarkdown } from '../../src/core/eval/resultsMd';
import { AT, prepared, MemoryStorage } from './helpers';

describe('evaluation smoke and no-target fitting (UNRUN)', () => {
  it('writes schema-valid dev/final JSONL and both fitted-prior runs through an in-memory adapter', async () => {
    const f = await prepared(); const storage = new MemoryStorage(f.manifest, f.payload);
    const devReport = await runDevelopment(f.tuned, f.protocol);
    expect(storage.reads).toBe(0); expect(parseResultsJsonl(resultsJsonl(devReport.rows))).toEqual(devReport.rows);
    const final = await runFinal({ final: true, manifestPath: 'memory', storage, dev: f.dev, at: AT });
    const complete = await completeFinal({ manifestPath: 'memory', storage, report: final.report, attempt: final.attempt, at: AT, frozenHash: final.manifest.frozenHash });
    expect(complete.finalRuns).toHaveLength(1); expect(complete.frozen.devFittedPriors).toEqual(f.tuned.scored.priors);
    expect(complete.finalRuns[0].fittedPriors.itemCount).toBeGreaterThan(complete.frozen.devFittedPriors.itemCount);
    expect(final.report.support.partitionItems).toBe(new Set(f.payload.reviews.map((r) => r.item_id)).size);
    expect(new Set(final.report.rows.map((r) => r.method))).toEqual(new Set(RESULT_METHODS));
    expect(final.report.checks.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(resultsMarkdown(final.report, complete)).toContain('Categories on the global prior (both runs)');
    expect(storage.reads).toBe(1);
  });
  it('changes to later ratings cannot change final C7 fitted priors, C, sigma2 or fallbacks', async () => {
    const f = await prepared();
    const changed = await buildDataset(f.full.reviews.map((r) => r.ts >= f.tuned.cutoffs[r.category] ? { ...r, rating: 1 as const } : r),
      { asOf: f.full.asOf, verifiedColumnPresent: true, insufficientBelow: 3 });
    const input = { scoringIds: new Set(f.payload.reviews.map((r) => r.item_id)), truth: null,
      cutoffs: f.tuned.cutoffs, rank: f.tuned.config, protocol: f.protocol, bestBaseline: f.tuned.bestBaseline,
      partition: 'heldout' as const, attackFamily: 'heldout' as const };
    const a = await runEvaluation({ ...input, dataset: f.full }); const b = await runEvaluation({ ...input, dataset: changed });
    expect(a.priors).toEqual(b.priors);
    expect(a.priors.methods.find((m) => m.method === 'bayes_global')?.m).toBe(f.tuned.config.bayes_m);
  });
  it('support failure labels check a insufficient support without rerolling the generator or hiding metrics', async () => {
    const f = await prepared(); const protocol = { ...f.protocol, support_gate: { min_items_per_category: 999, min_target_items: 999 } };
    const report = await runDevelopment(f.tuned, protocol);
    expect(report.support.sufficient).toBe(false); expect(report.checks.find((c) => c.id === 'a')?.status).toBe('insufficient support');
    expect(report.rows.filter((r) => r.metric === 'spearman').every((r) => r.status === 'insufficient support')).toBe(true);
  });
});
