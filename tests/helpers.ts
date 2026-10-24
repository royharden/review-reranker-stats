// Shared test helpers (not a test file: vitest only collects *.test.ts).
import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/core/config';
import { ingestCsvText } from '../src/core/data/parse';
import type { IngestLimits, IngestOptions, IngestResult } from '../src/core/data/parse';

/** 2025-01-01T00:00:00Z — the demo profile's fixed asOf; the parsing-trap fixture is written against it. */
export const ASOF = Date.UTC(2025, 0, 1);

export const HEADER = 'review_id,item_id,category,rating,timestamp,verified,text';

export function limits(overrides: Partial<IngestLimits> = {}): IngestLimits {
  const c = defaultConfig();
  return {
    max_bytes: c.max_bytes,
    max_rows: c.max_rows,
    max_examples_per_reason: c.max_examples_per_reason,
    insufficient_below: c.insufficient_below,
    ...overrides,
  };
}

export function options(overrides: Partial<IngestOptions> = {}): IngestOptions {
  return { asOf: ASOF, limits: limits(), source: 'text', sourceName: 'test', ...overrides };
}

/** Header + rows joined with \n. */
export function csv(rows: readonly string[], header: string = HEADER): string {
  return [header, ...rows].join('\n') + '\n';
}

export function ingest(text: string, overrides: Partial<IngestOptions> = {}): Promise<IngestResult> {
  return ingestCsvText(text, options(overrides));
}

export function readFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}
