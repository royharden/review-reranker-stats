import { describe, expect, it } from 'vitest';
import { isResultRow, resultRow, CHECK_STATES, RESULT_METHODS } from '../../src/core/eval/schema';
import { resultsMarkdown, rewriteReadmeResults, RESULT_COLUMNS, NAMED_FAILURE_SECTIONS } from '../../src/core/eval/resultsMd';
import { scoringTruth } from '../../src/core/eval/calibration';
import type { ItemTruth } from '../../src/core/synth/generator';

describe('reporting uncertainty and matching truth (UNRUN)', () => {
  it('unmeasured source reports contain every method, check, column, named failure and no fabricated CI', () => {
    const md = resultsMarkdown(null);
    for (const method of RESULT_METHODS) expect(md).toContain(method);
    for (const name of NAMED_FAILURE_SECTIONS) expect(md).toContain(name);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(md).toContain('| ' + id + ' | not yet measured |');
    expect(RESULT_COLUMNS).toContain('heap'); expect(CHECK_STATES).toContain('not assessable');
    expect(md).not.toContain('[0.0000, 0.0000]');
  });
  it('rejects non-finite values, inconsistent row states and invalid CIs', () => {
    const row = resultRow('dev', 'full', 'spearman', 0.5, 5, 'items'); expect(isResultRow(row)).toBe(true);
    expect(isResultRow({ ...row, value: Number.NaN })).toBe(false);
    expect(isResultRow({ ...row, status: 'not yet measured' })).toBe(false);
    expect(isResultRow({ ...row, ci: { lo: 1, hi: 0, level: 0.95, resamples: 2000, undefinedResamples: 0 } })).toBe(false);
  });
  it('rewrites exactly one README marker pair and rejects duplicate/reversed markers', () => {
    expect(rewriteReadmeResults('intro\n<!-- results:start -->old<!-- results:end -->\nend', 'new')).toBe('intro\n<!-- results:start -->\n\nnew\n\n<!-- results:end -->\nend');
    expect(() => rewriteReadmeResults('<!-- results:end --><!-- results:start -->', 'new')).toThrow();
    expect(() => rewriteReadmeResults('<!-- results:start --><!-- results:start --><!-- results:end -->', 'new')).toThrow();
  });
  it('drift coverage uses scoring-time expected stars and top-box probability instead of whole-item latent/mixture truth', () => {
    const truth: ItemTruth = { item_id: 'drift', category: 'c', source: 'generator', review_count: 40, expected_mean: 3,
      p_top_box: 0.5, distribution: [0, 0, 1, 0, 0], periods: [
        { start: 0, end: 10, review_count: 20, expected_mean: 2, p_top_box: 0.1 },
        { start: 10, end: 20, review_count: 20, expected_mean: 4, p_top_box: 0.9 },
      ] };
    expect(scoringTruth(truth, 10)).toEqual({ mean: 4, topBox: 0.9 });
    expect(scoringTruth(truth, 9)).toEqual({ mean: 2, topBox: 0.1 }); expect(scoringTruth(truth, 20)).toBeNull();
  });
});
