// UNRUN: source-only contract tests. Dirty Mode prohibits invoking vitest.
import { describe, expect, it } from 'vitest';
import { loadHeldOut } from '../../src/core/eval/heldout';
import { validateManifest } from '../../src/core/eval/manifest';
import { makeDevData } from '../../src/core/eval/split';
import { tuneDevelopment } from '../../src/core/eval/tune';
import { canonicalJson, sha256Hex } from '../../src/core/stats/hash';
import { AT, MemoryStorage, prepared } from './helpers';

describe('held-out storage capability and frozen settings (UNRUN)', () => {
  it('refuses without final before reading any storage', async () => {
    const fixture = await prepared(); const storage = new MemoryStorage(fixture.manifest, fixture.payload);
    await expect(loadHeldOut({ final: false, manifestPath: 'memory', storage, at: AT })).rejects.toThrow('--final');
    expect(storage.reads).toBe(0); expect(storage.writes).toHaveLength(0);
  });
  it('persists an opened receipt before the first held-out read and refuses a second final unless reread is disclosed', async () => {
    const f = await prepared(); const storage = new MemoryStorage(f.manifest, f.payload);
    const first = await loadHeldOut({ final: true, manifestPath: 'memory', storage, at: AT });
    expect(first.attempt).toBe(1); expect(storage.writes[0].readReceipts[0].phase).toBe('opened');
    await expect(loadHeldOut({ final: true, manifestPath: 'memory', storage, at: AT })).rejects.toThrow('--reread');
    const second = await loadHeldOut({ final: true, reread: true, manifestPath: 'memory', storage, at: AT });
    expect(second.attempt).toBe(2); expect(second.manifest.readReceipts.filter((r) => r.phase === 'opened').map((r) => r.reread)).toEqual([false, true]);
    expect(storage.reads).toBe(2); expect(second.manifest.frozenHash).toBe(f.manifest.frozenHash);
  });
  it('consumes a failed read and preserves the failure receipt', async () => {
    const f = await prepared(); const storage = new MemoryStorage(f.manifest, f.payload);
    storage.readHeldOut = async () => { throw new Error('sealed read failed'); };
    await expect(loadHeldOut({ final: true, manifestPath: 'memory', storage, at: AT })).rejects.toThrow('sealed read failed');
    expect(storage.manifest.readReceipts.map((r) => r.phase)).toEqual(['opened', 'failed']);
    await expect(loadHeldOut({ final: true, manifestPath: 'memory', storage, at: AT })).rejects.toThrow('--reread');
  });
  it('dev-only tuning never reads a throwing held-out adapter and rejects a mixed dev dataset', async () => {
    const f = await prepared(); let reads = 0;
    const input = { dev: f.dev, rank: f.rank, protocol: f.protocol,
      storage: { readHeldOut() { reads++; throw new Error('Held-out access during tuning'); } } };
    const tuned = await tuneDevelopment(input); expect(reads).toBe(0); expect(typeof tuned.config.bayes_m).toBe('number');
    expect(tuned.baselineScores.map((s) => s.method)).toEqual(['mean', 'bayes_global', 'wilson']);
    await expect(makeDevData(f.full, f.dev.source, f.protocol, f.rank)).rejects.toThrow('held-out');
  });
  it('rejects tampered frozen numeric m and malformed receipt lineage even when JSON is well-formed', async () => {
    const f = await prepared(); const changed = structuredClone(f.manifest); changed.frozen.rankConfig.bayes_m++;
    await expect(validateManifest(changed)).rejects.toThrow('digest');
    const bad = structuredClone(f.manifest);
    bad.readReceipts.push({ sequence: 1, attempt: 2, phase: 'loaded', at: AT, reread: true, frozenHash: bad.frozenHash, detail: 'fabricated' });
    await expect(validateManifest(bad)).rejects.toThrow('transition');
  });
  it('rejects a frozen median sentinel even if a caller recomputes outer digests', async () => {
    const f = await prepared(); const bad = JSON.parse(JSON.stringify(f.manifest)); bad.frozen.rankConfig.bayes_m = 'median';
    bad.frozen.configHash = await sha256Hex(canonicalJson({ rank: bad.frozen.rankConfig, eval: bad.frozen.evalConfig }));
    bad.frozenHash = await sha256Hex(canonicalJson(bad.frozen));
    await expect(validateManifest(bad)).rejects.toThrow('numeric');
  });
});
