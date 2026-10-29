import { describe, expect, it } from 'vitest';
import { configHash, defaultConfig } from '../../src/core/config';
import { createComputeHandler } from '../../src/worker/handler';
import { SCHEMA_VERSION } from '../../src/worker/protocol';
import type { WorkerResponse } from '../../src/worker/protocol';
import { ASOF, csv, readFixture } from '../helpers';

// The worker logic end to end in Node (the thin journey minus the browser): load -> loaded{report} ->
// compute -> computed{rankings} with matching hashes.

function harness() {
  const posted: WorkerResponse[] = [];
  const handler = createComputeHandler((m) => posted.push(m));
  const finals = () => posted.filter((m) => m.type !== 'progress');
  return { posted, handler, finals };
}

const text = csv(['r1,it-1,cat-a,5,2024-06-01T10:00:00Z,true,', 'r2,it-1,cat-a,4,2024-06-02T10:00:00Z,true,', 'r3,it-2,cat-a,2,2024-06-03T10:00:00Z,false,']);

describe('compute handler', () => {
  it('load text then compute: hashes match and mean is ranked', async () => {
    const { handler, finals } = harness();
    await handler.handle({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 1, source: { kind: 'text', text, name: 't.csv', asOf: ASOF } });
    const loaded = finals()[0];
    expect(loaded.type).toBe('loaded');
    if (loaded.type !== 'loaded') return;
    expect(loaded.requestId).toBe(1);
    expect(loaded.report.accepted).toBe(3);
    expect(loaded.datasetHash).toBe(loaded.report.datasetHash);

    const config = defaultConfig();
    await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 2, config, rulings: [] });
    const computed = finals()[1];
    expect(computed.type).toBe('computed');
    if (computed.type !== 'computed') return;
    expect(computed.requestId).toBe(2);
    expect(computed.datasetHash).toBe(loaded.datasetHash);
    expect(computed.configHash).toBe(await configHash(config));
    expect(computed.methods).toEqual(['mean', 'bayes_global', 'wilson', 'eb_category', 'eb_global', 'full', 'full-verified', 'full-recency', 'full-burst']);
    expect(computed.detection.datasetHash).toBe(loaded.datasetHash);
    expect(computed.detection.detectorConfigHash).toMatch(/^[0-9a-f]{64}$/);
    expect(computed.rankings.full?.[0].parts.rank_by_method).toHaveProperty('full-burst');
    expect(computed.rankings.mean?.map((r) => r.item_id)).toEqual(['it-1', 'it-2']);
  });

  it('compute before any load -> no-dataset error; invalid config -> invalid-config with details', async () => {
    const { handler, finals } = harness();
    await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 1, config: defaultConfig(), rulings: [] });
    expect(finals()[0]).toMatchObject({ type: 'error', code: 'no-dataset', requestId: 1 });
    await handler.handle({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 2, source: { kind: 'text', text, name: 't', asOf: ASOF } });
    await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 3, config: { ...defaultConfig(), half_life_days: 0 }, rulings: [] });
    const err = finals()[2];
    expect(err).toMatchObject({ type: 'error', code: 'invalid-config', requestId: 3 });
    if (err.type === 'error') expect(err.details.some((d) => d.startsWith('half_life_days'))).toBe(true);
  });

  it('a rejected file clears the previous dataset', async () => {
    const { handler, finals } = harness();
    await handler.handle({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 1, source: { kind: 'text', text, name: 't', asOf: ASOF } });
    await handler.handle({ type: 'load', schemaVersion: SCHEMA_VERSION, requestId: 2, source: { kind: 'text', text: 'a,a\n1,2\n', name: 'bad', asOf: ASOF } });
    expect(finals()[1]).toMatchObject({ type: 'loaded', datasetHash: null });
    await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 3, config: defaultConfig(), rulings: [] });
    expect(finals()[2]).toMatchObject({ type: 'error', code: 'no-dataset' });
  });

  it('malformed messages get an error response, never a throw', async () => {
    const { handler, finals } = harness();
    await handler.handle('hello');
    await handler.handle({ type: 'load', schemaVersion: 0, requestId: 7, source: {} });
    expect(finals()[0]).toMatchObject({ type: 'error', code: 'bad-request', requestId: -1 });
    expect(finals()[1]).toMatchObject({ type: 'error', code: 'schema-mismatch', requestId: 7 });
  });

  it('Load sample: demo catalogue + traps + parsing fixture through the real parser, fixed asOf', async () => {
    const { handler, finals, posted } = harness();
    await handler.handle({
      type: 'load',
      schemaVersion: SCHEMA_VERSION,
      requestId: 1,
      source: { kind: 'sample', profile: 'demo', parsingTrapsCsv: readFixture('parsing-traps.csv') },
    });
    const loaded = finals()[0];
    expect(loaded.type).toBe('loaded');
    if (loaded.type !== 'loaded') return;
    expect(loaded.report.source).toBe('sample');
    expect(loaded.report.asOf).toBe(ASOF);
    expect(loaded.report.rejected).toBe(22);
    expect(posted.some((m) => m.type === 'progress' && m.phase === 'generate')).toBe(true);
    await handler.handle({ type: 'compute', schemaVersion: SCHEMA_VERSION, requestId: 2, config: defaultConfig(), rulings: [] });
    const computed = finals()[1];
    expect(computed.type).toBe('computed');
    if (computed.type === 'computed') expect(computed.rankings.mean?.length).toBe(loaded.report.itemCount);
  }, 60_000);
});
