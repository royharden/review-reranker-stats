import { expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config';
import { appendRuling } from '../../src/core/rulings/rulings';
import { buildTraps } from '../../src/core/synth/traps';
import { createComputeHandler } from '../../src/worker/handler';
import { SCHEMA_VERSION } from '../../src/worker/protocol';
import type { ComputedResponse, WorkerResponse } from '../../src/worker/protocol';
import { ASOF } from '../helpers';

it('worker integrates validated restore/replay, compact details, actual parameter metadata and ranking-only edits', async () => {
  const posted: WorkerResponse[] = [];
  const handler = createComputeHandler((response) => posted.push(response));
  // Generated review content has no free text; quote every id/category so CSV exercises the real parser.
  const rows = buildTraps(ASOF, 42).reviews;
  const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const text = 'review_id,item_id,category,rating,timestamp,verified\n' + rows.map((r) => [quote(r.review_id), quote(r.item_id), quote(r.category), r.rating, r.ts, r.verified === null ? '' : String(r.verified)].join(',')).join('\n');
  await handler.handle({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 1, source: { kind: 'text', text, name: 'traps', asOf: ASOF } });
  await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 2, config: defaultConfig(), rulings: [] });
  const computed = posted.find((r): r is ComputedResponse => r.type === 'computed');
  expect(computed).toBeDefined(); if (!computed || !computed.datasetHash) throw new Error('Missing computed result');
  const identity = computed.spanIdentities[0]; expect(identity).toBeDefined(); if (!identity) throw new Error('Fixture did not flag a span');
  const log = appendRuling([], { ...identity, datasetHash: computed.datasetHash, detectorConfigHash: computed.detection.detectorConfigHash,
    decision: 'restore', decidedAt: '2026-10-24T18:00:00Z', appVersion: '0.1.0' });
  const changed = { ...defaultConfig(), half_life_days: 100, rank_key: 'lower_endpoint' };
  await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 3, config: changed, rulings: log });
  const restored = posted.find((r): r is ComputedResponse => r.type === 'computed' && r.requestId === 3);
  expect(restored).toBeDefined(); if (!restored) throw new Error('Missing restored result');
  expect(restored.rulingReplay[0].status).toBe('applied'); expect(restored.computedConfig.rank_key).toBe('lower_endpoint');
  expect(restored.categories).toContain('trap:bursts'); expect(restored.methods).toContain('full'); expect(restored.methodLabels.full).toBeTruthy();
  const item = restored.rankings.full?.find((r) => r.item_id === identity.itemId);
  expect(item?.parts.flagged_spans.some((s) => s.span_start === identity.spanStart && s.span_end === identity.spanEnd && s.label === 'restored' && s.weight === 1)).toBe(true);
  expect(item?.n).toBe(rows.filter((r) => r.item_id === identity.itemId).length);
  for (const detail of restored.itemDetails) {
    expect(detail.bins.length).toBeLessThanOrEqual(160); expect(detail.explanations.full).toBeTruthy();
    expect(Object.keys(detail).sort()).toEqual(['binDays', 'bins', 'explanations', 'itemId']);
  }
}, 60_000);

it('load parameters apply support labels and smaller caps; invalid ruling records fail instead of being ignored', async () => {
  const posted: WorkerResponse[] = []; const handler = createComputeHandler((r) => posted.push(r));
  const text = 'review_id,item_id,category,rating,timestamp\nr1,a,c,4,2024-01-01T00:00:00Z\nr2,a,c,4,2024-01-02T00:00:00Z\n';
  await handler.handle({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 1, config: { ...defaultConfig(), insufficient_below: 2 }, source: { kind: 'text', text, name: 't', asOf: ASOF } });
  expect(posted.find((r) => r.type === 'loaded')).toMatchObject({ report: { insufficientCount: 0 } });
  await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 2, config: defaultConfig(), rulings: [{ decision: 'restore' }] });
  expect(posted.at(-1)).toMatchObject({ type: 'error', code: 'internal' });
  await handler.handle({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 3, config: { ...defaultConfig(), max_rows: 1 }, source: { kind: 'text', text, name: 't', asOf: ASOF } });
  expect(posted.at(-1)).toMatchObject({ type: 'loaded', datasetHash: null, report: { fileRejection: { reason: 'too_many_rows' } } });
});
