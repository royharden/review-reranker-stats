// The bundled sample (CL §1.3 step 1, §2.8 "Sample delivery"): seeded `demo` catalogue + code-built traps +
// the hand-written fixtures/parsing-traps.csv, ALL passed through the real CSV path. The generated and trap reviews
// are serialised to CSV here and the parsing-trap rows (header removed) are appended, so the sample exercises
// exactly the parser, validation report and Dataset an upload gets. The caller supplies the fixture text (the UI
// bundles it; tests read it from disk), keeping this module free of file access.

import { cmp } from '../stats/hash';
import type { Review } from '../types';
import { CANONICAL_COLUMNS } from '../data/schema';
import { generateCatalogue } from './generator';
import type { SynthTruth } from './generator';
import { getProfile } from './profiles';
import type { ProfileId } from './profiles';
import { buildTraps } from './traps';
import type { TrapMeta } from './traps';

export interface SampleReviews {
  profile: ProfileId;
  seed: number;
  asOf: number;
  /** Generated catalogue + trap reviews (typed; not yet validated). */
  reviews: Review[];
  /** Merged truth (catalogue + trap organic truth), sorted by item_id. A separate object: never ranker input. */
  truth: SynthTruth;
  traps: TrapMeta[];
}

export interface SampleCsv extends SampleReviews {
  csv: string;
  /** Data rows contributed by the parsing-trap fixture (0 when none was supplied). */
  parsingTrapRows: number;
}

export function buildSampleReviews(profileId: ProfileId, seed?: number): SampleReviews {
  const profile = getProfile(profileId);
  const s = seed ?? profile.defaultSeed;
  const catalogue = generateCatalogue(profile, s);
  const traps = profile.includeTraps ? buildTraps(profile.asOf, s) : { reviews: [], truth: [], meta: [] };
  const truthItems = [...catalogue.truth.items, ...traps.truth].sort((a, b) => cmp(a.item_id, b.item_id));
  return {
    profile: profileId,
    seed: s,
    asOf: profile.asOf,
    reviews: [...catalogue.reviews, ...traps.reviews],
    truth: { ...catalogue.truth, items: truthItems },
    traps: traps.meta,
  };
}

/** RFC 4180 field quoting (only when needed). This app's own ids never need it; untrusted fixture text is not re-quoted here. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? '"' + value.replace(/"/g, '""') + '"' : value;
}

export function reviewsToCsvRows(reviews: readonly Review[]): string[] {
  return reviews.map((r) =>
    [
      csvField(r.review_id),
      csvField(r.item_id),
      csvField(r.category),
      String(r.rating),
      String(r.ts),
      r.verified === null ? '' : r.verified ? 'true' : 'false',
      csvField(r.text ?? ''),
    ].join(','),
  );
}

export const CANONICAL_HEADER = CANONICAL_COLUMNS.join(',');

/** Split a CSV into its first line (header) and the rest, accepting \n or \r\n. */
function splitHeader(csv: string): { header: string; body: string } {
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const nl = text.indexOf('\n');
  if (nl < 0) return { header: text.replace(/\r$/, ''), body: '' };
  return { header: text.slice(0, nl).replace(/\r$/, ''), body: text.slice(nl + 1) };
}

/**
 * Sample CSV: canonical header, generated + trap rows, then the fixture's data rows. The fixture must use the
 * canonical header (a mismatch is a build defect and throws).
 */
export function buildSampleCsv(profileId: ProfileId, parsingTrapsCsv: string | null, seed?: number): SampleCsv {
  const sample = buildSampleReviews(profileId, seed);
  const lines = [CANONICAL_HEADER, ...reviewsToCsvRows(sample.reviews)];
  let parsingTrapRows = 0;
  if (parsingTrapsCsv !== null) {
    const { header, body } = splitHeader(parsingTrapsCsv);
    if (header !== CANONICAL_HEADER) {
      throw new Error(`parsing-traps fixture header must be exactly "${CANONICAL_HEADER}", got "${header}"`);
    }
    const trimmed = body.replace(/(\r?\n)+$/, '');
    if (trimmed !== '') {
      lines.push(trimmed);
      parsingTrapRows = trimmed.split(/\r?\n/).filter((l) => l.trim() !== '').length;
    }
  }
  return { ...sample, csv: lines.join('\n') + '\n', parsingTrapRows };
}
