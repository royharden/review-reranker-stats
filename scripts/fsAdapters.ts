import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson } from '../src/core/stats/hash';
import { validateManifest } from '../src/core/eval/manifest';
import type { EvalManifest } from '../src/core/eval/manifest';
import type { HeldOutPayload, HeldOutStorage } from '../src/core/eval/heldout';

/** No host or network API exists here: this is a local sealed-partition adapter. */
export class FileHeldOutStorage implements HeldOutStorage {
  heldOutPath: string;
  constructor(heldOutPath: string) { this.heldOutPath = heldOutPath; }
  async exclusive<T>(manifestPath: string, action: () => Promise<T>): Promise<T> {
    await mkdir(dirname(manifestPath), { recursive: true });
    const lockPath = manifestPath + '.lock';
    // Exclusive creation refuses parallel final reads. A stale crash lock requires explicit operator recovery.
    const lock = await open(lockPath, 'wx');
    try { return await action(); } finally { await lock.close(); await unlink(lockPath); }
  }
  async readManifest(manifestPath: string): Promise<unknown> { return JSON.parse(await readFile(manifestPath, 'utf8')) as unknown; }
  async writeManifest(manifestPath: string, value: EvalManifest): Promise<void> {
    const next = await validateManifest(value);
    let prior: EvalManifest | null = null;
    try { prior = await validateManifest(await this.readManifest(manifestPath)); }
    catch (error) { if (!isMissing(error)) throw error; }
    if (prior !== null) {
      if (prior.frozenHash !== next.frozenHash || canonicalJson(prior.frozen) !== canonicalJson(next.frozen)) throw new Error('Refusing to replace frozen dev settings; use a new output directory for a distinct experiment');
      if (canonicalJson(next.readReceipts.slice(0, prior.readReceipts.length)) !== canonicalJson(prior.readReceipts)
        || canonicalJson(next.finalRuns.slice(0, prior.finalRuns.length)) !== canonicalJson(prior.finalRuns)) throw new Error('Refusing to rewrite prior read/final receipts');
    }
    // Write + fsync the next bytes before replacement. An abandoned .next file is never silently overwritten.
    const temporary = manifestPath + '.next'; const handle = await open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify(next, null, 2) + '\n', 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, manifestPath);
  }
  async readHeldOut(): Promise<HeldOutPayload> {
    // Domain loader validates the envelope/rows. This boundary must never be called by preparation or tuning.
    return JSON.parse(await readFile(this.heldOutPath, 'utf8')) as HeldOutPayload;
  }
}
export function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
export async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
export async function writeNewJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}
export async function writeArtifacts(directory: string, jsonl: string, markdown: string, report: unknown): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'results.jsonl'), jsonl, { encoding: 'utf8', flag: 'wx' }),
    writeFile(join(directory, 'results.md'), markdown, { encoding: 'utf8', flag: 'wx' }),
    writeNewJson(join(directory, 'report.json'), report),
  ]);
}
