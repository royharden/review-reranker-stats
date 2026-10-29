import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { buildDataset } from '../src/core/data/dataset';
import { fullRanker } from '../src/core/rankers/full';
import { reviewWeights, ALL_FACTORS } from '../src/core/rankers/weights';
import { emptyRankContext } from '../src/core/rankers/types';
import { rngFrom } from '../src/core/stats/prng';
import { buildTraps } from '../src/core/synth/traps';
import { generateCatalogue } from '../src/core/synth/generator';
import { PROFILES } from '../src/core/synth/profiles';
import { ASOF, ingest, readFixture } from './helpers';

describe('no-exclusion invariant', () => {
  it('all fixtures retain every accepted review under arbitrary positive burst weights', async () => {
    const config = defaultConfig();
    const inputs = [buildTraps(ASOF, 33).reviews, generateCatalogue({ ...PROFILES.demo, itemCount: 30 }, 33).reviews];
    const fixtures = await Promise.all(inputs.map((rows) => buildDataset(rows, { asOf: ASOF, verifiedColumnPresent: true, insufficientBelow: 3 })));
    fixtures.push((await ingest(readFixture('parsing-traps.csv'))).dataset!);
    for (const dataset of fixtures) {
      const original = JSON.stringify(dataset.reviews);
      for (let seed = 0; seed < 3; seed++) {
        const rng = rngFrom(seed, 'no-exclusion');
        const ctx = { ...emptyRankContext(), reviewBurstWeight: dataset.reviews.map(() => rng() < 0.5 ? 0.25 : 1) };
        const weights = reviewWeights(dataset, config, ctx, ALL_FACTORS).weights;
        expect(weights).toHaveLength(dataset.reviews.length);
        expect(weights.every((w) => Number.isFinite(w) && w >= 1e-12)).toBe(true);
        const result = fullRanker.rank(dataset, config, ctx);
        expect(result.reduce((sum, row) => sum + row.n, 0)).toBe(dataset.reviews.length);
        for (const row of result) expect(row.n).toBe(dataset.items.get(row.item_id)!.reviewIdx.length);
      }
      expect(JSON.stringify(dataset.reviews)).toBe(original);
    }
  });

  it('static source guard: core never filters accepted review membership by a flag', () => {
    const root = fileURLToPath(new URL('../src/core', import.meta.url));
    const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8');
      // Guard common direct exclusion patterns. Temporal dataset partitioning is legitimate; flag-based
      // membership changes are not. This source guard complements the all-review property and manual review.
      expect(source, file).not.toMatch(/\.(?:reviews|reviewIdx)\s*\.\s*filter\s*\([^;\n]*(?:flagged|isFlagged|burstFlag)/);
      expect(source, file).not.toMatch(/\b(?:reviews|reviewIdx)\s*=\s*[^;\n]*\.filter\s*\([^;\n]*(?:flagged|isFlagged|burstFlag)/);
    }
  });
});
