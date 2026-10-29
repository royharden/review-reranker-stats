// CSV ingest (CL §1.1 item 1, §2.4; PLAN M2 acceptance 1-2).
//
// One deterministic path for every input:
//   1. Byte pre-check BEFORE any reading: Blob/File.size for uploads, the UTF-8 byte length for text. Over
//      max_bytes rejects the file.
//   2. papaparse (header: false, delimiter ',', blank lines skipped) feeds rows one at a time through `step` into a
//      pure row ingester. The first row is the header (exact names; duplicate/unknown/missing names reject the file).
//   3. The row cap is enforced inside `step`: when data row max_rows + 1 arrives (invalid rows count too), the parser
//      is aborted and the WHOLE file is rejected — no silent truncation.
//   4. Each data row gets at most one reason (ROW_REJECT_REASONS order). Reason totals are complete; retained
//      example rows are capped per reason.
//   5. Accepted reviews become a Dataset (canonical order + SHA-256 datasetHash).
//
// Uploads are read with Blob.text() after the size check and then parsed as a string, so the browser worker and the
// Node tests share exactly the same parsing code. The 25 MB cap bounds the in-memory string (DEFERRED-VALIDATION).
// `text` cells are carried on the Review for display/export only; nothing downstream reads them.

import Papa from 'papaparse';
import type { Parser, ParseStepResult } from 'papaparse';
import { cmp } from '../stats/hash';
import type { Dataset, RankConfig, Review } from '../types';
import { buildDataset } from './dataset';
import {
  EXAMPLE_FIELD_MAX,
  EXAMPLE_FIELDS_MAX,
  INSUFFICIENT_LIST_MAX,
  REQUIRED_COLUMNS,
  emptyReasonCounts,
  isKnownColumn,
} from './schema';
import type {
  Column,
  FileRejection,
  RejectedExample,
  RowRejectReason,
  SourceKind,
  ValidationReport,
} from './schema';
import { cleanId, isValidAsOf, parseRating, parseTimestampAsOf, parseVerified, utf8ByteLength } from './validate';

export type IngestLimits = Pick<RankConfig, 'max_bytes' | 'max_rows' | 'max_examples_per_reason' | 'insufficient_below'>;

export interface IngestOptions {
  /** Explicit reference time (epoch ms). Core never reads a clock. */
  asOf: number;
  limits: IngestLimits;
  source: SourceKind;
  sourceName: string;
  /** Optional progress callback, fraction in [0, 1] of characters parsed. */
  onProgress?: (fraction: number) => void;
}

export interface IngestResult {
  report: ValidationReport;
  /** null when the whole file was rejected. */
  dataset: Dataset | null;
}

const PROGRESS_EVERY_ROWS = 5000;

/** Minimal sized-blob shape: what the byte pre-check and the reader need. A File is one. */
export interface SizedBlob {
  readonly size: number;
  text(): Promise<string>;
}

/** Ingest an uploaded file. The size check happens before any byte is read. */
export async function ingestCsvBlob(blob: SizedBlob, options: IngestOptions): Promise<IngestResult> {
  checkAsOf(options.asOf);
  if (blob.size > options.limits.max_bytes) {
    return rejectedResult(options, blob.size, 0, {
      reason: 'too_many_bytes',
      message: `File is ${blob.size} bytes; the limit is ${options.limits.max_bytes} bytes. Nothing was read.`,
      columns: [],
    });
  }
  const text = await blob.text();
  return ingestParsed(text, blob.size, options);
}

/** Ingest CSV text (tests, the sample path, pasted input). The UTF-8 byte length is checked before parsing. */
export async function ingestCsvText(text: string, options: IngestOptions): Promise<IngestResult> {
  checkAsOf(options.asOf);
  const bytes = utf8ByteLength(text);
  if (bytes > options.limits.max_bytes) {
    return rejectedResult(options, bytes, 0, {
      reason: 'too_many_bytes',
      message: `Input is ${bytes} bytes (UTF-8); the limit is ${options.limits.max_bytes} bytes. Nothing was parsed.`,
      columns: [],
    });
  }
  return ingestParsed(text, bytes, options);
}

function checkAsOf(asOf: number): void {
  if (!isValidAsOf(asOf)) throw new RangeError(`ingest: asOf must be an integer epoch-ms value, got ${asOf}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Row ingester: pure state machine fed one row at a time.
// ---------------------------------------------------------------------------------------------------------------

export type RowOutcome = 'continue' | 'abort';

export interface RowIngester {
  /** Feed one parsed row (header first). `parseErrors` = papaparse reported a quoting problem on this row. */
  push(fields: readonly string[], parseErrors: boolean): RowOutcome;
  /** Called once after the last row (or after an abort). */
  finish(bytes: number): Promise<IngestResult>;
}

export function createRowIngester(options: IngestOptions): RowIngester {
  const { asOf, limits } = options;
  let header: Column[] | null = null;
  let headerIndex: Partial<Record<Column, number>> = {};
  let fileRejection: FileRejection | null = null;
  let dataRows = 0;
  const reasonCounts = emptyReasonCounts();
  const examples: RejectedExample[] = [];
  const examplesPerReason = emptyReasonCounts();
  const accepted: Review[] = [];
  const acceptedIds = new Set<string>();
  const itemCategory = new Map<string, string>();

  const reject = (reason: RowRejectReason, fields: readonly string[]): void => {
    reasonCounts[reason]++;
    if (examplesPerReason[reason] < limits.max_examples_per_reason) {
      examplesPerReason[reason]++;
      examples.push({
        row: dataRows,
        reason,
        values: fields.slice(0, EXAMPLE_FIELDS_MAX).map((v) => (v.length > EXAMPLE_FIELD_MAX ? v.slice(0, EXAMPLE_FIELD_MAX) + '…' : v)),
      });
    }
  };

  const acceptHeader = (fields: readonly string[]): RowOutcome => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    const unknown: string[] = [];
    for (const name of fields) {
      if (seen.has(name)) duplicates.add(name);
      seen.add(name);
      if (!isKnownColumn(name)) unknown.push(name);
    }
    if (duplicates.size > 0) {
      fileRejection = {
        reason: 'duplicate_header',
        message: 'The header row repeats a column name; the file is rejected because the intended column is ambiguous.',
        columns: Array.from(duplicates).sort(cmp),
      };
      return 'abort';
    }
    const missing = REQUIRED_COLUMNS.filter((c) => !seen.has(c));
    if (missing.length > 0) {
      fileRejection = {
        reason: 'missing_header',
        message: `Required column(s) missing: ${missing.join(', ')}. Header names must match exactly (case-sensitive).`,
        columns: missing.slice().sort(cmp),
      };
      return 'abort';
    }
    if (unknown.length > 0) {
      fileRejection = {
        reason: 'unknown_header',
        message: 'Unknown column(s) in the header. Allowed: review_id, item_id, category, rating, timestamp, verified, text.',
        columns: unknown.slice().sort(cmp),
      };
      return 'abort';
    }
    const cols: Column[] = [];
    const index: Partial<Record<Column, number>> = {};
    fields.forEach((name, i) => {
      if (isKnownColumn(name)) {
        cols.push(name);
        index[name] = i;
      }
    });
    header = cols;
    headerIndex = index;
    return 'continue';
  };

  const cell = (fields: readonly string[], column: Column): string | null => {
    const i = headerIndex[column];
    return i === undefined ? null : fields[i];
  };

  const acceptRow = (fields: readonly string[], parseErrors: boolean, width: number): void => {
    if (parseErrors || fields.length !== width) return reject('malformed_row', fields);

    const reviewId = cleanId(cell(fields, 'review_id') ?? '');
    if (reviewId === '') return reject('missing_review_id', fields);
    const itemId = cleanId(cell(fields, 'item_id') ?? '');
    if (itemId === '') return reject('missing_item_id', fields);
    const category = cleanId(cell(fields, 'category') ?? '');
    if (category === '') return reject('missing_category', fields);

    const rating = parseRating(cell(fields, 'rating') ?? '');
    if (!rating.ok) return reject(rating.reason, fields);
    const ts = parseTimestampAsOf(cell(fields, 'timestamp') ?? '', asOf);
    if (!ts.ok) return reject(ts.reason, fields);

    const verifiedCell = cell(fields, 'verified');
    let verified: boolean | null = null;
    if (verifiedCell !== null) {
      const v = parseVerified(verifiedCell);
      if (!v.ok) return reject(v.reason, fields);
      verified = v.value;
    }

    if (acceptedIds.has(reviewId)) return reject('duplicate_review_id', fields);
    const knownCategory = itemCategory.get(itemId);
    if (knownCategory !== undefined && knownCategory !== category) return reject('inconsistent_category', fields);

    const review: Review = { review_id: reviewId, item_id: itemId, category, rating: rating.value, ts: ts.value, verified };
    const textCell = cell(fields, 'text');
    if (textCell !== null && textCell !== '') review.text = textCell;
    accepted.push(review);
    acceptedIds.add(reviewId);
    if (knownCategory === undefined) itemCategory.set(itemId, category);
  };

  return {
    push(fields, parseErrors) {
      if (fileRejection !== null) return 'abort';
      if (header === null) return acceptHeader(fields);
      dataRows++;
      if (dataRows > limits.max_rows) {
        fileRejection = {
          reason: 'too_many_rows',
          message: `The file has more than ${limits.max_rows} data rows (stopped at row ${dataRows}); the whole file is rejected rather than truncated.`,
          columns: [],
        };
        return 'abort';
      }
      // Unknown header names abort the file, so the header row width equals the known-column count.
      acceptRow(fields, parseErrors, header.length);
      return 'continue';
    },

    async finish(bytes) {
      if (fileRejection === null && header === null) {
        fileRejection = { reason: 'empty_file', message: 'The file is empty: no header row was found.', columns: [] };
      }
      if (fileRejection !== null) return rejectedResult(options, bytes, dataRows, fileRejection);

      const columnsPresent = new Set<Column>(header ?? []);
      const verifiedColumnPresent = columnsPresent.has('verified');
      const dataset = await buildDataset(accepted, {
        asOf,
        verifiedColumnPresent,
        insufficientBelow: limits.insufficient_below,
      });
      const insufficient: string[] = [];
      let insufficientCount = 0;
      for (const item of dataset.items.values()) {
        if (item.insufficient) {
          insufficientCount++;
          if (insufficient.length < INSUFFICIENT_LIST_MAX) insufficient.push(item.item_id);
        }
      }
      const report: ValidationReport = {
        source: options.source,
        sourceName: options.sourceName,
        asOf,
        fileRejection: null,
        bytes,
        dataRows,
        accepted: accepted.length,
        rejected: dataRows - accepted.length,
        reasonCounts,
        examples,
        verifiedColumnPresent,
        textColumnPresent: columnsPresent.has('text'),
        itemCount: dataset.items.size,
        categoryCount: dataset.categories.length,
        insufficientCount,
        insufficientItems: insufficient,
        datasetHash: dataset.datasetHash,
      };
      return { report, dataset };
    },
  };
}

function rejectedResult(options: IngestOptions, bytes: number, dataRows: number, rejection: FileRejection): IngestResult {
  return {
    dataset: null,
    report: {
      source: options.source,
      sourceName: options.sourceName,
      asOf: options.asOf,
      fileRejection: rejection,
      bytes,
      dataRows,
      accepted: 0,
      rejected: 0,
      reasonCounts: emptyReasonCounts(),
      examples: [],
      verifiedColumnPresent: false,
      textColumnPresent: false,
      itemCount: 0,
      categoryCount: 0,
      insufficientCount: 0,
      insufficientItems: [],
      datasetHash: null,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// papaparse driver
// ---------------------------------------------------------------------------------------------------------------

async function ingestParsed(rawText: string, bytes: number, options: IngestOptions): Promise<IngestResult> {
  // A leading UTF-8 BOM would otherwise become part of the first header name.
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const ingester = createRowIngester(options);
  // Whitespace-only input has no header row; skip papaparse (its behaviour on empty input is not relied upon).
  if (text.trim() === '') return ingester.finish(bytes);
  const total = Math.max(1, text.length);
  let rows = 0;

  await new Promise<void>((resolve, reject) => {
    try {
      Papa.parse<string[]>(text, {
        delimiter: ',',
        header: false,
        // Skip empty lines only. Greedy mode also discards comma-only records such as ",,,,,,", which are
        // invalid data rows and must count toward the row cap and rejection totals.
        skipEmptyLines: true,
        dynamicTyping: false,
        step(results: ParseStepResult<string[]>, parser: Parser) {
          const outcome = ingester.push(results.data, results.errors.length > 0);
          rows++;
          if (outcome === 'abort') {
            parser.abort();
            return;
          }
          if (options.onProgress && rows % PROGRESS_EVERY_ROWS === 0) {
            options.onProgress(Math.min(1, results.meta.cursor / total));
          }
        },
        complete() {
          resolve();
        },
      });
    } catch (error) {
      reject(error);
    }
  });

  options.onProgress?.(1);
  return ingester.finish(bytes);
}
