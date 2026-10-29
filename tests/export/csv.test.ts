import { describe, expect, it } from 'vitest';
import { csvCell, encodeCsv, rankingRows, safeString } from '../../src/core/export/csv';
import { defaultConfig } from '../../src/core/config';
import { buildDataset } from '../../src/core/data/dataset';
import { meanRanker } from '../../src/core/rankers/mean';
import { emptyRankContext } from '../../src/core/rankers/types';

describe('typed formula-safe CSV', () => {
  it.each(['=1+1', ' =1', '+x', '-x', '@x', '\tx', '\rx'])('neutralises the string cell %j before quoting', (input) => {
    expect(safeString(input)).toBe("'" + input);
    expect(csvCell(input)).toBe(/[",\r\n]/.test(input) ? '"\'' + input.replace(/"/g, '""') + '"' : "'" + input);
  });
  it('negative numeric deltas stay numbers while string negatives are neutralised; RFC4180 quotes are doubled', () => {
    expect(csvCell(-12)).toBe('-12'); expect(csvCell('-12')).toBe("'-12");
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'); expect(encodeCsv([['header', 'delta'], ['=x', -2]])).toBe("header,delta\r\n'=x,-2\r\n");
    expect(() => csvCell(NaN)).toThrow();
  });
  it('ranking export carries numeric global delta and provenance, interval quantity and ruling status', async () => {
    const ds = await buildDataset([{ review_id: 'r', item_id: '=1+1', category: '@cat', rating: 4, ts: 0, verified: null }], { asOf: 0, verifiedColumnPresent: false, insufficientBelow: 3 });
    const results = meanRanker.rank(ds, defaultConfig(), emptyRankContext());
    const rows = rankingRows(results, results, { method: 'mean', config: defaultConfig(), asOf: 0, datasetHash: ds.datasetHash, configHash: 'c' });
    expect(rows[0][4]).toBe(0); expect(typeof rows[0][4]).toBe('number'); expect(rows[0]).toContain('not-applicable'); expect(rows[0]).toContain('no flagged spans');
  });
});
