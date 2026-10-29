// SOURCE ONLY, UNRUN. Person-run activation entrypoint; never imported by UI, worker, or core.
import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { defaultConfig, validateConfig } from '../src/core/config';
import { buildDataset } from '../src/core/data/dataset';
import { ingestCsvText } from '../src/core/data/parse';
import { detectBursts, contextFromDetection } from '../src/core/burst/detect';
import { generateCatalogue } from '../src/core/synth/generator';
import type { SynthTruth } from '../src/core/synth/generator';
import { getProfile } from '../src/core/synth/profiles';
import { getRanker } from '../src/core/rankers/registry';
import { canonicalJson } from '../src/core/stats/hash';
import type { Dataset, Review } from '../src/core/types';
import { defaultEvalConfig, validateEvalConfig } from '../src/core/eval/config';
import { makeDevData, partitionOf, splitTime } from '../src/core/eval/split';
import type { DevData, SourceIdentity } from '../src/core/eval/split';
import { tuneDevelopment } from '../src/core/eval/tune';
import { freezeDevelopment, validateManifest } from '../src/core/eval/manifest';
import type { EvalManifest } from '../src/core/eval/manifest';
import { runDevelopment, runFinal, completeFinal } from '../src/core/eval/runner';
import { RESULT_METHODS, resultRow, resultsJsonl } from '../src/core/eval/schema';
import type { ResultRow, RunReport } from '../src/core/eval/schema';
import { resultsMarkdown, rewriteReadmeResults } from '../src/core/eval/resultsMd';
import { FileHeldOutStorage, isMissing, readJson, writeArtifacts, writeNewJson } from './fsAdapters';
import { localCsvReadiness, withLocalReadiness, requireFrozenReadiness, sourceReadinessMarkdown } from './sourceReadiness';

interface Options { final: boolean; reread: boolean; benchmark: boolean; out: string; csv: string | null; asOf: string | null; rankConfig: string | null; evalConfig: string | null }
function argumentsFor(argv: readonly string[]): Options {
  const options: Options = { final: false, reread: false, benchmark: false, out: 'results', csv: null, asOf: null, rankConfig: null, evalConfig: null };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]; if (seen.has(arg)) throw new Error('Duplicate option ' + arg); seen.add(arg);
    if (arg === '--final') options.final = true;
    else if (arg === '--reread') options.reread = true;
    else if (arg === '--benchmark') options.benchmark = true;
    else {
      const value = argv[++i]; if (!value || value.startsWith('--')) throw new Error('Missing option value for ' + arg);
      if (arg === '--out') options.out = value;
      else if (arg === '--csv') options.csv = value;
      else if (arg === '--as-of') options.asOf = value;
      else if (arg === '--rank-config') options.rankConfig = value;
      else if (arg === '--eval-config') options.evalConfig = value;
      else throw new Error('Unknown option ' + arg);
    }
  }
  if (options.reread && !options.final) throw new Error('--reread requires --final');
  if (options.final && (options.csv || options.asOf || options.rankConfig || options.evalConfig)) throw new Error('--final uses only frozen source/settings; source/config options would retune');
  if (options.csv !== null && options.asOf === null) throw new Error('--csv requires explicit --as-of ISO timestamp');
  if (options.asOf !== null && options.csv === null) throw new Error('--as-of requires --csv');
  return options;
}
interface DevFile { schema: 'sealed-dev-1'; source: SourceIdentity; reviews: Review[]; truth: SynthTruth | null; verifiedColumnPresent: boolean }
async function loadDev(path: string, manifest: EvalManifest): Promise<DevData> {
  const raw = await readJson(path);
  if (typeof raw !== 'object' || raw === null || !('schema' in raw) || raw.schema !== 'sealed-dev-1'
    || !('reviews' in raw) || !Array.isArray(raw.reviews) || !('source' in raw) || canonicalJson(raw.source) !== canonicalJson(manifest.frozen.source)
    || !('truth' in raw) || !('verifiedColumnPresent' in raw) || typeof raw.verifiedColumnPresent !== 'boolean') throw new Error('Invalid sealed dev file');
  const payload = raw as DevFile;
  const dataset = await buildDataset(payload.reviews, { asOf: payload.source.asOf, verifiedColumnPresent: payload.verifiedColumnPresent,
    insufficientBelow: manifest.frozen.rankConfig.insufficient_below });
  if (dataset.datasetHash !== manifest.frozen.devDatasetHash) throw new Error('Sealed dev data changed after freezing');
  return makeDevData(dataset, payload.source, manifest.frozen.evalConfig, manifest.frozen.rankConfig, payload.truth);
}
async function benchmarkRows(pre: Dataset, manifest: EvalManifest, partition: RunReport['partition']): Promise<ResultRow[]> {
  if (pre.reviews.length === 0) throw new Error('Cannot benchmark an empty source');
  const rows: ResultRow[] = [];
  const cfg = manifest.frozen.rankConfig; const clocks = new Map(Object.entries(manifest.frozen.cutoffs));
  for (const size of [100_000, 200_000]) {
    const reviews: Review[] = Array.from({ length: size }, (_, i) => ({ ...pre.reviews[i % pre.reviews.length], review_id: JSON.stringify(['benchmark', size, i]) }));
    const data = await buildDataset(reviews, { asOf: pre.asOf, verifiedColumnPresent: pre.verifiedColumnPresent, insufficientBelow: cfg.insufficient_below });
    for (const method of RESULT_METHODS) {
      const ranker = getRanker(method.startsWith('full:') ? 'full' : method as Exclude<typeof method, 'full:posterior_mean' | 'full:lower_endpoint'>);
      if (!ranker) throw new Error('Missing benchmark ranker');
      const config = method === 'full:posterior_mean' ? { ...cfg, rank_key: 'posterior_mean' as const }
        : method === 'full:lower_endpoint' ? { ...cfg, rank_key: 'lower_endpoint' as const } : cfg;
      const started = performance.now();
      const detected = await detectBursts(data, config, clocks);
      ranker.rank(data, config, { ...contextFromDetection(data, detected, config), asOfByCategory: clocks });
      const elapsed = performance.now() - started;
      const heap = process.memoryUsage().heapUsed;
      rows.push(resultRow(partition, method, size === 100_000 ? 'runtime-per-100k-ms' : 'runtime-at-200k-ms', elapsed,
        size, 'one Node run, detector plus method fit; exact cloned review count'));
      if (size === 200_000) rows.push(resultRow(partition, method, 'heap-used-bytes', heap, size, 'sampled process heapUsed after 200k run; not isolated allocation or peak heap'));
    }
  }
  return rows;
}
async function main(): Promise<void> {
  const options = argumentsFor(process.argv.slice(2));
  const out = resolve(options.out); const manifestPath = join(out, 'manifest.json');
  const devPath = join(out, 'sealed', 'dev.json'); const heldPath = join(out, 'sealed', 'heldout.json');
  const storage = new FileHeldOutStorage(heldPath);
  let report: RunReport; let manifest: EvalManifest; let dev: DevData; let attempt: number | null = null;
  if (options.final) {
    // No generation, tuning or source parsing is reachable on this branch.
    manifest = await validateManifest(await storage.readManifest(manifestPath));
    requireFrozenReadiness(manifest.frozen.source);
    dev = await loadDev(devPath, manifest);
    const final = await runFinal({ final: true, manifestPath, storage, dev, at: new Date().toISOString(), reread: options.reread });
    report = final.report; manifest = final.manifest; attempt = final.attempt;
  } else {
    try { await access(manifestPath); throw new Error('Manifest already exists. Reuse it only with --final; use a new --out for a distinct dev experiment.'); }
    catch (error) { if (!isMissing(error)) throw error; }
    await mkdir(out, { recursive: true });
    // A caller-chosen --out also protects its sealed local reviews from accidental Git inclusion.
    try { await writeFile(join(out, '.gitignore'), '*\n', { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error; }
    const rankRaw = options.rankConfig ? await readJson(resolve(options.rankConfig)) : defaultConfig();
    const checked = validateConfig(rankRaw); if (!checked.ok) throw new Error(checked.errors.join('; '));
    const rank = checked.config; const protocol = options.evalConfig ? validateEvalConfig(await readJson(resolve(options.evalConfig))) : defaultEvalConfig();
    let dataset: Dataset; let truth: SynthTruth | null; let source: SourceIdentity;
    if (options.csv !== null) {
      const path = resolve(options.csv); const asOf = Date.parse(options.asOf ?? '');
      if (!Number.isSafeInteger(asOf) || !/(Z|[+-]\d\d:\d\d)$/.test(options.asOf ?? '')) throw new Error('Explicit zoned --as-of required');
      const info = await stat(path); if (info.size > rank.max_bytes) throw new Error('Local CSV exceeds configured byte cap');
      const csvBytes = await readFile(path);
      if (csvBytes.length > rank.max_bytes) throw new Error('Local CSV exceeds configured byte cap');
      const parsed = await ingestCsvText(csvBytes.toString('utf8'), { asOf, limits: rank, source: 'text', sourceName: basename(path) });
      if (!parsed.dataset || parsed.report.rejected > 0) throw new Error('Normalized local CSV must have no rejected rows: ' + JSON.stringify(parsed.report.reasonCounts));
      dataset = parsed.dataset; truth = null;
      const readiness = await localCsvReadiness(path, csvBytes, parsed.report.accepted);
      source = withLocalReadiness({ kind: 'local-csv', sourceHash: dataset.datasetHash, sourceName: basename(path), asOf, calendar: null, generatorVersion: null }, readiness);
    } else {
      const profile = getProfile(protocol.generator_profile); const generated = generateCatalogue(profile, protocol.generator_seed);
      dataset = await buildDataset(generated.reviews, { asOf: profile.asOf, verifiedColumnPresent: true, insufficientBelow: rank.insufficient_below });
      truth = generated.truth;
      source = { kind: 'synthetic', sourceHash: dataset.datasetHash, sourceName: profile.id, asOf: profile.asOf,
        calendar: profile.calendar, generatorVersion: 's33-generator-1' };
    }
    // Preparation partitions and seals source rows once. Tuning gets only dev bytes; it has no adapter capability.
    const devReviews = dataset.reviews.filter((r) => partitionOf(r.item_id, protocol) === 'dev');
    const heldReviews = dataset.reviews.filter((r) => partitionOf(r.item_id, protocol) === 'heldout');
    const devTruth = truth === null ? null : { ...truth, items: truth.items.filter((i) => partitionOf(i.item_id, protocol) === 'dev') };
    const heldTruth = truth === null ? null : { ...truth, items: truth.items.filter((i) => partitionOf(i.item_id, protocol) === 'heldout') };
    await writeNewJson(devPath, { schema: 'sealed-dev-1', source, reviews: devReviews, truth: devTruth, verifiedColumnPresent: dataset.verifiedColumnPresent });
    await writeNewJson(heldPath, { schema: 'sealed-heldout-1', source, reviews: heldReviews, truth: heldTruth });
    dev = await makeDevData(await buildDataset(devReviews, { asOf: source.asOf, verifiedColumnPresent: dataset.verifiedColumnPresent, insufficientBelow: rank.insufficient_below }), source, protocol, rank, devTruth);
    const tuned = await tuneDevelopment({ dev, rank, protocol });
    manifest = await freezeDevelopment(tuned, protocol, new Date().toISOString());
    // Freeze is durable BEFORE runDevelopment returns and well before any final read.
    await storage.exclusive(manifestPath, () => storage.writeManifest(manifestPath, manifest));
    report = await runDevelopment(tuned, protocol);
  }
  if (options.benchmark) {
    const pre = await splitTime(dev.dataset, manifest.frozen.cutoffs, manifest.frozen.rankConfig);
    const measured = await benchmarkRows(pre.pre, manifest, report.partition);
    report.rows = report.rows.filter((r) => !r.metric.startsWith('runtime-') && r.metric !== 'heap-used-bytes').concat(measured);
  }
  if (attempt !== null) manifest = await completeFinal({ storage, manifestPath, report, attempt,
    at: new Date().toISOString(), frozenHash: manifest.frozenHash });
  const jsonl = resultsJsonl(report.rows); const markdown = resultsMarkdown(report, manifest) + sourceReadinessMarkdown(manifest.frozen.source);
  const runName = attempt === null ? 'dev' : 'final-' + String(attempt).padStart(4, '0');
  await writeArtifacts(join(out, 'runs', runName), jsonl, markdown, report);
  await Promise.all([writeFile(join(out, 'results.jsonl'), jsonl, 'utf8'), writeFile(join(out, 'results.md'), markdown, 'utf8')]);
  const readmePath = resolve('README.md'); const readme = await readFile(readmePath, 'utf8');
  await writeFile(readmePath, rewriteReadmeResults(readme, markdown), 'utf8');
  console.log('Wrote ' + runName + ' to ' + out + '. Final read attempts: ' + manifest.readReceipts.filter((r) => r.phase === 'opened').length + '.');
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
