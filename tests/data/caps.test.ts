import { describe, expect, it } from 'vitest';
import { ingestCsvBlob, ingestCsvText } from '../../src/core/data/parse';
import type { SizedBlob } from '../../src/core/data/parse';
import { HEADER, csv, limits, options } from '../helpers';

// Input caps (PLAN M2 acceptance 1; CL §1.1 item 1, F6a): byte pre-check before any read; abort inside the
// papaparse step callback at data row max_rows + 1; the whole file is rejected, never truncated.

function rowsCsv(n: number): string {
  const lines: string[] = [HEADER];
  for (let i = 0; i < n; i++) lines.push(`r${i},it-${i % 500},cat-a,${(i % 5) + 1},1717236000000,true,`);
  return lines.join('\n') + '\n';
}

describe('byte cap (25,000,000 bytes)', () => {
  it('a fake 25,000,001-byte File is rejected before any byte is read', async () => {
    let reads = 0;
    const fake: SizedBlob = {
      size: 25_000_001,
      text: () => {
        reads++;
        return Promise.reject(new Error('the file must not be read'));
      },
    };
    const { report, dataset } = await ingestCsvBlob(fake, options({ source: 'upload', sourceName: 'huge.csv' }));
    expect(reads).toBe(0);
    expect(dataset).toBeNull();
    expect(report.fileRejection?.reason).toBe('too_many_bytes');
    expect(report.bytes).toBe(25_000_001);
    expect(report.accepted).toBe(0);
  });

  it('a real Blob just over the limit is rejected by size, one at the limit is read', async () => {
    const small = limits({ max_bytes: 100 });
    const atLimit = csv(['r1,it-1,cat-a,4,1717236000000,true,']);
    const padded = atLimit + ' '.repeat(100 - new TextEncoder().encode(atLimit).length);
    expect(new TextEncoder().encode(padded).length).toBe(100);
    const okResult = await ingestCsvBlob(new Blob([padded]), options({ limits: small }));
    expect(okResult.report.fileRejection).toBeNull();
    const over = await ingestCsvBlob(new Blob([padded + ' ']), options({ limits: small }));
    expect(over.report.fileRejection?.reason).toBe('too_many_bytes');
  });

  it('text input is checked on its UTF-8 byte length (multi-byte characters count fully)', async () => {
    const huge = 'a'.repeat(25_000_001);
    expect((await ingestCsvText(huge, options())).report.fileRejection?.reason).toBe('too_many_bytes');
    // 40 two-byte characters = 80 bytes > 79-byte limit, although only 40 UTF-16 code units.
    const r = await ingestCsvText('é'.repeat(40), options({ limits: limits({ max_bytes: 79 }) }));
    expect(r.report.fileRejection?.reason).toBe('too_many_bytes');
    expect(r.report.bytes).toBe(80);
  });
});

describe('row cap (200,000 data rows)', () => {
  it('a 200,001-row string is rejected as a whole (no truncation)', async () => {
    const { report, dataset } = await ingestCsvText(rowsCsv(200_001), options());
    expect(report.fileRejection?.reason).toBe('too_many_rows');
    expect(report.dataRows).toBe(200_001);
    expect(report.accepted).toBe(0);
    expect(dataset).toBeNull();
  }, 120_000);

  it('exactly 200,000 rows are accepted', async () => {
    const { report } = await ingestCsvText(rowsCsv(200_000), options());
    expect(report.fileRejection).toBeNull();
    expect(report.accepted).toBe(200_000);
  }, 120_000);

  it('the cap aborts at row max_rows + 1 and invalid rows count toward it', async () => {
    const small = limits({ max_rows: 3 });
    const bad = csv(['x1,it-1,cat-a,9,1717236000000,true,', 'x2,it-1,cat-a,9,1717236000000,true,', 'x3,it-1,cat-a,9,1717236000000,true,', 'x4,it-1,cat-a,9,1717236000000,true,']);
    const r = await ingestCsvText(bad, options({ limits: small }));
    expect(r.report.fileRejection?.reason).toBe('too_many_rows');
    expect(r.report.dataRows).toBe(4);
    const three = await ingestCsvText(rowsCsv(3), options({ limits: small }));
    expect(three.report.fileRejection).toBeNull();
    expect(three.report.accepted).toBe(3);
  });

  it('blank lines are not data rows', async () => {
    const text = HEADER + '\n\nr1,it-1,cat-a,4,1717236000000,true,\n\n\nr2,it-1,cat-a,5,1717236000000,true,\n';
    const r = await ingestCsvText(text, options({ limits: limits({ max_rows: 2 }) }));
    expect(r.report.fileRejection).toBeNull();
    expect(r.report.dataRows).toBe(2);
  });

  it('comma-only invalid records count toward the cap instead of being skipped as empty lines', async () => {
    // Regression: skipEmptyLines: 'greedy' silently drops these records, bypassing both the row cap and report.
    const row = ',,,,,,';
    const atLimit = await ingestCsvText(csv([row, row]), options({ limits: limits({ max_rows: 2 }) }));
    expect(atLimit.report.fileRejection).toBeNull();
    expect(atLimit.report.dataRows).toBe(2);
    expect(atLimit.report.rejected).toBe(2);
    expect(atLimit.report.reasonCounts.missing_review_id).toBe(2);

    const over = await ingestCsvText(csv([row, row, row]), options({ limits: limits({ max_rows: 2 }) }));
    expect(over.report.fileRejection?.reason).toBe('too_many_rows');
    expect(over.report.dataRows).toBe(3);
    expect(over.report.accepted).toBe(0);
    expect(over.dataset).toBeNull();
  });
});
