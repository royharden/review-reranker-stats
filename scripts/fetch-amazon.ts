// SOURCE ONLY, UNRUN. PERSON-RUN ONLY. Never import this entrypoint from UI, workers, demo, or tests.
// Activation requires a person to inspect official source/category/licence pages and edit this fixed source map.
// No generic URL/config-file input, automatic source discovery, broad host suffixes, or automatic coverage claims.
import { createHash } from 'node:crypto';
import { mkdir, open, realpath, lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { get } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { parseRating, parseTimestamp, parseVerified } from '../src/core/data/validate';
import type { LocalSourceMetadata } from './sourceReadiness';

interface InspectedCategory {
  id: string; category: string; url: string;
  inspectedAt: string; officialReference: string; termsReference: string; termsBasis: string;
}
// DEFERRED D9: No category, source URL, licence or CDN host has been verified in this construction run.
// Add exact official download hosts only after inspecting every redirect; never accept *.huggingface.co / *.amazonaws.com.
const EXACT_HTTPS_HOSTS: ReadonlySet<string> = new Set(['huggingface.co']);
const INSPECTED_CATEGORIES: readonly InspectedCategory[] = [];
const CAPS = Object.freeze({ compressedBytes: 100_000_000, decompressedBytes: 250_000_000, sourceRows: 200_000,
  outputRows: 200_000, outputBytes: 25_000_000, lineBytes: 1_000_000, durationMs: 120_000, redirects: 3 });
const HEADER = 'review_id,item_id,category,rating,timestamp,verified\n';
type StopReason = 'eof' | 'compressed-bytes' | 'decompressed-bytes' | 'source-rows' | 'output-rows' | 'output-bytes' | 'line-bytes' | 'duration' | 'error';
class BoundReached extends Error {
  readonly reason: StopReason;
  constructor(reason: StopReason) { super('Fetch stopped at ' + reason + ' cap; output is incomplete and cannot support a temporal headline.'); this.reason = reason; }
}
function checkedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !EXACT_HTTPS_HOSTS.has(url.hostname) || url.port !== '' && url.port !== '443'
    || url.username !== '' || url.password !== '' || url.hash !== '') throw new Error('Refused source/redirect: exact inspected HTTPS host required.');
  return url;
}
function request(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((accept, reject) => {
    const req = get(url, { signal, headers: { 'Accept-Encoding': 'identity', 'User-Agent': 's33-person-run-normalizer/1' } }, accept);
    req.on('error', reject);
  });
}
async function download(start: string, signal: AbortSignal): Promise<{ response: IncomingMessage; hosts: string[] }> {
  let url = checkedUrl(start); const hosts: string[] = [];
  for (let redirects = 0; ; redirects++) {
    if (signal.aborted) throw new BoundReached('duration');
    const response = await request(url, signal); hosts.push(url.hostname);
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location; response.destroy();
      if (!location || redirects >= CAPS.redirects) throw new Error('Missing redirect location or redirect cap exceeded.');
      url = checkedUrl(new URL(location, url).href); // validate BEFORE the next request, including relative redirects
      continue;
    }
    if (response.statusCode !== 200) { response.destroy(); throw new Error('Download refused: expected HTTP 200.'); }
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
      response.destroy(); throw new Error('Unexpected HTTP content encoding; require raw .jsonl.gz bytes for bounded gunzip.');
    }
    const length = response.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > CAPS.compressedBytes)) {
      response.destroy(); throw new BoundReached('compressed-bytes');
    }
    return { response, hosts };
  }
}
function csvCell(value: string | number): string {
  const text = String(value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
interface Normalized { csv: string; timestamp: number }
function normalize(raw: unknown, source: InspectedCategory, ordinal: number): Normalized | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  // Explicit selection: user_id/title/text/images and all other fields are never copied to output/metadata/logs.
  const row = raw as Record<string, unknown>;
  const parent = typeof row.parent_asin === 'string' ? row.parent_asin.trim() : '';
  // ASIN-like identifiers only, also preventing formula-bearing spreadsheet string cells and hash separators.
  if (!/^[A-Za-z0-9]{1,64}$/.test(parent)) return null;
  if (typeof row.rating !== 'number' && typeof row.rating !== 'string') return null;
  if (typeof row.timestamp !== 'number' && typeof row.timestamp !== 'string') return null;
  if (typeof row.timestamp === 'number' && !Number.isSafeInteger(row.timestamp)) return null;
  const rating = parseRating(String(row.rating)); const timestamp = parseTimestamp(String(row.timestamp));
  const verifiedRaw = row.verified_purchase;
  if (verifiedRaw !== undefined && verifiedRaw !== null && !['boolean', 'number', 'string'].includes(typeof verifiedRaw)) return null;
  const verified = parseVerified(verifiedRaw === undefined || verifiedRaw === null ? '' : String(verifiedRaw));
  if (!rating.ok || !timestamp.ok || !verified.ok) return null;
  // 1-based source ordinal counts every nonblank source row, including rejects. No user identifier participates.
  const reviewId = createHash('sha256').update(parent + '|' + timestamp.value + '|' + ordinal).digest('hex').slice(0, 32);
  return { csv: [reviewId, parent, source.category, rating.value, timestamp.value, verified.value === null ? '' : String(verified.value)].map(csvCell).join(',') + '\n',
    timestamp: timestamp.value };
}
function selectedCategory(argv: readonly string[]): InspectedCategory {
  if (argv.length !== 3 || argv[0] !== '--category' || argv[2] !== '--confirm-source-inspected') {
    throw new Error('Person-run only. Usage: npx --no-install tsx scripts/fetch-amazon.ts --category <inspected-id> --confirm-source-inspected. First inspect official categories/terms/redirect hosts and configure INSPECTED_CATEGORIES in source; currently none are approved.');
  }
  const source = INSPECTED_CATEGORIES.find((category) => category.id === argv[1]);
  if (!source) throw new Error('No inspected source for this category. Category selection, licence/terms and current download/redirect hosts are DEFERRED (D9). A person must inspect and configure the fixed source map; no network request was made.');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(source.id) || !/^[A-Za-z0-9][A-Za-z0-9 _&()-]{0,127}$/.test(source.category)
    || !/^\d{4}-\d\d-\d\dT.*Z$/.test(source.inspectedAt) || !Number.isFinite(Date.parse(source.inspectedAt))
    || !source.officialReference.startsWith('https://') || !source.termsReference.startsWith('https://') || source.termsBasis.trim().length < 20
    || !checkedUrl(source.url).pathname.endsWith('.jsonl.gz')) throw new Error('Incomplete inspected category configuration; require exact HTTPS .jsonl.gz source, inspection timestamp and terms basis.');
  return source;
}
/** Existing path components must be real directories, preventing a data/local junction from writing outside the repo. */
async function localOutputDirectory(): Promise<string> {
  const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  let current = root;
  for (const part of ['data', 'local', 'amazon']) {
    current = join(current, part);
    try { await mkdir(current); } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const info = await lstat(current); const actual = await realpath(current); const rel = relative(root, actual);
    if (!info.isDirectory() || info.isSymbolicLink() || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Refused output directory outside real repository data/local.');
  }
  return current;
}
async function main(): Promise<void> {
  const source = selectedCategory(process.argv.slice(2)); // fail before filesystem/network until source inspection is configured
  const directory = await localOutputDirectory(); const csvPath = join(directory, source.id + '.csv');
  const metadataPath = csvPath + '.source.json';
  // Reserve both names exclusively. Reruns never overwrite old source evidence or append mixed downloads.
  let csv: FileHandle | null = null; let metadata: FileHandle | null = null;
  try {
    metadata = await open(metadataPath, 'wx');
    await metadata.writeFile('{"schema":"local-source-1","complete":false,"truncated":true,"stopReason":"in-progress"}\n');
    csv = await open(csvPath, 'wx');
  } catch (error) { await csv?.close(); await metadata?.close(); throw error; }
  if (csv === null || metadata === null) throw new Error('Failed to reserve local output files.');
  const output = csv; const provenance = metadata;
  const controller = new AbortController(); let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, CAPS.durationMs);
  let compressedBytes = 0; let decompressedBytes = 0; let sourceRows = 0; let normalizedRows = 0; let rejectedRows = 0;
  let outputBytes = 0; let firstTimestamp: number | null = null; let lastTimestamp: number | null = null;
  let hosts: string[] = []; let stopReason: StopReason = 'error'; let failure: unknown = null;
  const csvHash = createHash('sha256'); const startedAt = new Date().toISOString();
  async function writeCsv(text: string): Promise<void> {
    if (controller.signal.aborted) throw new BoundReached('duration');
    const bytes = Buffer.from(text, 'utf8');
    if (outputBytes + bytes.length > CAPS.outputBytes) throw new BoundReached('output-bytes');
    // FileHandle.writeFile on a regular open file writes from its current position; every awaited chunk is bounded.
    await output.writeFile(bytes); csvHash.update(bytes); outputBytes += bytes.length;
  }
  async function row(line: string): Promise<void> {
    if (line.trim() === '') return;
    sourceRows++; if (sourceRows > CAPS.sourceRows) throw new BoundReached('source-rows');
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { rejectedRows++; return; }
    const normalized = normalize(raw, source, sourceRows);
    if (normalized === null) { rejectedRows++; return; }
    if (normalizedRows >= CAPS.outputRows) throw new BoundReached('output-rows');
    await writeCsv(normalized.csv); normalizedRows++;
    firstTimestamp = firstTimestamp === null ? normalized.timestamp : Math.min(firstTimestamp, normalized.timestamp);
    lastTimestamp = lastTimestamp === null ? normalized.timestamp : Math.max(lastTimestamp, normalized.timestamp);
  }
  // Buffering is one bounded gunzip chunk plus at most lineBytes for the current JSONL record; never the whole download.
  let pending = Buffer.alloc(0);
  async function chunk(bytes: Buffer): Promise<void> {
    decompressedBytes += bytes.length;
    if (decompressedBytes > CAPS.decompressedBytes) throw new BoundReached('decompressed-bytes');
    let offset = 0;
    for (;;) {
      const end = bytes.indexOf(10, offset);
      const part = bytes.subarray(offset, end === -1 ? bytes.length : end);
      if (pending.length + part.length > CAPS.lineBytes) throw new BoundReached('line-bytes');
      pending = Buffer.concat([pending, part]);
      if (end === -1) break;
      // Fatal UTF-8 decoding avoids silently normalizing corrupted identifier bytes.
      const line = new TextDecoder('utf-8', { fatal: true }).decode(pending); pending = Buffer.alloc(0);
      await row(line); offset = end + 1;
    }
  }
  try {
    await writeCsv(HEADER);
    const opened = await download(source.url, controller.signal); hosts = opened.hosts;
    const counter = new Transform({ transform(bytes: Buffer, _encoding, callback) {
      compressedBytes += bytes.length;
      callback(compressedBytes > CAPS.compressedBytes ? new BoundReached('compressed-bytes') : null, bytes);
    } });
    const sink = new Writable({ write(bytes: Buffer, _encoding, callback) { chunk(bytes).then(() => callback(), callback); },
      final(callback) { (async () => { if (pending.length > 0) await row(new TextDecoder('utf-8', { fatal: true }).decode(pending)); })().then(() => callback(), callback); } });
    await pipeline(opened.response, counter, createGunzip({ chunkSize: 64 * 1024 }), sink, { signal: controller.signal });
    if (expired) throw new BoundReached('duration');
    stopReason = 'eof';
  } catch (error) { stopReason = expired ? 'duration' : error instanceof BoundReached ? error.reason : 'error'; failure = error; }
  finally {
    clearTimeout(timer); controller.abort();
    try {
      await output.sync();
      const evidence: LocalSourceMetadata & Record<string, unknown> = { schema: 'local-source-1', sourceId: source.id,
        csvSha256: csvHash.digest('hex'), normalizedRows, rejectedRows, complete: stopReason === 'eof', truncated: stopReason !== 'eof', stopReason,
        coverage: { status: 'unverified', checkedAt: null, checkedBy: null, basis: null },
        source: { category: source.category, url: source.url, inspectedAt: source.inspectedAt, officialReference: source.officialReference,
          termsReference: source.termsReference, termsBasis: source.termsBasis, redirectHosts: hosts },
        startedAt, finishedAt: new Date().toISOString(), caps: CAPS, compressedBytes, decompressedBytes, sourceRows, outputBytes,
        observedRange: { firstTimestamp, lastTimestamp }, idDerivation: 'sha256(parent_asin|normalized-epoch-ms|1-based-nonblank-source-ordinal), first 32 hex',
        retainedFields: ['review_id', 'item_id', 'category', 'rating', 'timestamp', 'verified'], droppedFields: ['user_id', 'title', 'text', 'images'],
        note: 'EOF and observed timestamp range do not prove complete representative temporal coverage. A person must inspect ordering/filtering/rights and confirm coverage before local evaluation. Caps/errors cannot be overridden into a headline.' };
      const bytes = Buffer.from(JSON.stringify(evidence, null, 2) + '\n');
      if (bytes.length > 64_000) throw new Error('Source metadata unexpectedly exceeds bound');
      await provenance.truncate(0); await provenance.write(bytes, 0, bytes.length, 0); await provenance.sync();
    } finally { await output.close(); await provenance.close(); }
  }
  if (failure !== null) throw new Error('Incomplete local CSV retained with unverified metadata (' + stopReason + '). No temporal headline. '
    + (failure instanceof BoundReached ? failure.message : 'Download/normalization failed; inspect source and constraints.'));
  console.log('Normalized ' + normalizedRows + ' rows (' + rejectedRows + ' rejected) to ' + csvPath + '. Coverage remains UNVERIFIED; no temporal headline.');
}
// Deliberately not a package script, app action, imported library or test helper.
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Person-run fetch failed.'); process.exitCode = 1; });
