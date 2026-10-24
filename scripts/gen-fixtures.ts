// SOURCE ONLY, UNRUN. Seeded sample dump to the gitignored local-data directory; no network.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildSampleCsv } from '../src/core/synth/sample';
import { buildTraps } from '../src/core/synth/traps';
import { getProfile } from '../src/core/synth/profiles';
import { CANONICAL_HEADER, reviewsToCsvRows } from '../src/core/synth/sample';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length > 1 || argv[0] !== undefined && !/^\d+$/.test(argv[0])) throw new Error('Usage: npm run gen:fixtures -- [integer-seed]');
  const seed = argv[0] === undefined ? 33 : Number(argv[0]); if (!Number.isSafeInteger(seed)) throw new Error('Invalid seed');
  const out = resolve('data/local/fixtures'); await mkdir(out, { recursive: true });
  const parsing = await readFile(resolve('fixtures/parsing-traps.csv'), 'utf8');
  const sample = buildSampleCsv('demo', parsing, seed);
  const traps = buildTraps(getProfile('demo').asOf, seed);
  await Promise.all([
    writeFile(join(out, 'demo-seed-' + seed + '.csv'), sample.csv, { encoding: 'utf8', flag: 'wx' }),
    writeFile(join(out, 'traps-seed-' + seed + '.csv'), [CANONICAL_HEADER, ...reviewsToCsvRows(traps.reviews)].join('\n') + '\n', { encoding: 'utf8', flag: 'wx' }),
    writeFile(join(out, 'truth-seed-' + seed + '.json'), JSON.stringify(sample.truth, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }),
    writeFile(join(out, 'trap-labels-seed-' + seed + '.json'), JSON.stringify(traps.meta, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }),
  ]);
  console.log('Wrote seeded demo/traps and separate truth/label sidecars to ' + out);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
