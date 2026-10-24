// Worker logic without the worker global (CL §2.8): owns the loaded Dataset, answers load/compute requests and
// posts progress. compute.worker.ts binds it to `self`; tests drive it directly in Node.
//
// Requests are processed one at a time in arrival order (the queue below), so a compute can never observe a
// half-finished load. Cancellation is not handled here: the client terminates and respawns the whole worker.

import { configHash, defaultConfig, validateConfig } from '../core/config';
import { ingestCsvBlob, ingestCsvText } from '../core/data/parse';
import type { IngestLimits, IngestResult } from '../core/data/parse';
import { emptyRankContext } from '../core/rankers/types';
import { registeredRankers } from '../core/rankers/registry';
import { buildSampleCsv } from '../core/synth/sample';
import type { Dataset, MethodId, RankResult } from '../core/types';
import { SCHEMA_VERSION, parseWorkerRequest } from './protocol';
import type { ComputeRequest, LoadRequest, ProgressPhase, WorkerResponse } from './protocol';

export type Post = (message: WorkerResponse) => void;

export interface ComputeHandler {
  /** Handle one raw incoming message; resolves when its responses have been posted. */
  handle(raw: unknown): Promise<void>;
}

export function createComputeHandler(post: Post): ComputeHandler {
  let dataset: Dataset | null = null;
  let queue: Promise<void> = Promise.resolve();
  const defaults = defaultConfig();
  const limits: IngestLimits = {
    max_bytes: defaults.max_bytes,
    max_rows: defaults.max_rows,
    max_examples_per_reason: defaults.max_examples_per_reason,
    insufficient_below: defaults.insufficient_below,
  };

  const progress = (requestId: number, phase: ProgressPhase, pct: number, cfgHash: string | null = null): void => {
    post({
      type: 'progress',
      schemaVersion: SCHEMA_VERSION,
      requestId,
      datasetHash: dataset?.datasetHash ?? null,
      configHash: cfgHash,
      phase,
      pct,
    });
  };

  const load = async (req: LoadRequest): Promise<void> => {
    const { source, requestId } = req;
    // A new load replaces the dataset even if the file is rejected: the user asked for this file, not the old one.
    dataset = null;
    const onProgress = (f: number) => progress(requestId, 'parse', f);
    let result: IngestResult;
    if (source.kind === 'file') {
      progress(requestId, 'parse', 0);
      result = await ingestCsvBlob(source.file, { asOf: source.asOf, limits, source: 'upload', sourceName: source.name, onProgress });
    } else if (source.kind === 'text') {
      progress(requestId, 'parse', 0);
      result = await ingestCsvText(source.text, { asOf: source.asOf, limits, source: 'text', sourceName: source.name, onProgress });
    } else {
      progress(requestId, 'generate', 0);
      const sample = buildSampleCsv(source.profile, source.parsingTrapsCsv);
      progress(requestId, 'parse', 0);
      result = await ingestCsvText(sample.csv, {
        asOf: sample.asOf,
        limits,
        source: 'sample',
        sourceName: `sample:${sample.profile} (seed ${sample.seed})`,
        onProgress,
      });
    }
    dataset = result.dataset;
    post({
      type: 'loaded',
      schemaVersion: SCHEMA_VERSION,
      requestId,
      datasetHash: dataset?.datasetHash ?? null,
      configHash: null,
      report: result.report,
    });
  };

  const compute = async (req: ComputeRequest): Promise<void> => {
    const { requestId } = req;
    if (dataset === null) {
      post({
        type: 'error',
        schemaVersion: SCHEMA_VERSION,
        requestId,
        datasetHash: null,
        configHash: null,
        code: 'no-dataset',
        message: 'No dataset is loaded (or the last file was rejected). Load a file or the sample first.',
        details: [],
      });
      return;
    }
    // Requests run one at a time (queue below), so the dataset cannot change while this compute runs.
    const ds: Dataset = dataset;
    const validated = validateConfig(req.config);
    if (!validated.ok) {
      post({
        type: 'error',
        schemaVersion: SCHEMA_VERSION,
        requestId,
        datasetHash: ds.datasetHash,
        configHash: null,
        code: 'invalid-config',
        message: 'The parameters are invalid; nothing was recomputed.',
        details: validated.errors,
      });
      return;
    }
    const config = validated.config;
    const cfgHash = await configHash(config);
    // req.rulings: replayed into ctx.reviewBurstWeight from M4 on; M2 has no detector, so the context is empty.
    const ctx = emptyRankContext();
    const rankers = registeredRankers();
    const rankings: Partial<Record<MethodId, RankResult[]>> = {};
    const methods: MethodId[] = [];
    rankers.forEach((ranker, i) => {
      progress(requestId, 'rank', i / rankers.length, cfgHash);
      rankings[ranker.id] = ranker.rank(ds, config, ctx);
      methods.push(ranker.id);
    });
    post({
      type: 'computed',
      schemaVersion: SCHEMA_VERSION,
      requestId,
      datasetHash: ds.datasetHash,
      configHash: cfgHash,
      rankings,
      methods,
    });
  };

  const run = async (raw: unknown): Promise<void> => {
    const parsed = parseWorkerRequest(raw);
    if (!parsed.ok) {
      post({
        type: 'error',
        schemaVersion: SCHEMA_VERSION,
        requestId: parsed.requestId,
        datasetHash: dataset?.datasetHash ?? null,
        configHash: null,
        code: parsed.code,
        message: parsed.message,
        details: [],
      });
      return;
    }
    const req = parsed.request;
    try {
      if (req.type === 'load') await load(req);
      else await compute(req);
    } catch (error) {
      post({
        type: 'error',
        schemaVersion: SCHEMA_VERSION,
        requestId: req.requestId,
        datasetHash: dataset?.datasetHash ?? null,
        configHash: null,
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
        details: [],
      });
    }
  };

  return {
    handle(raw) {
      const next = queue.then(() => run(raw));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
