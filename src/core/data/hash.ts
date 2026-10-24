// Dataset hashing (CL §2.4; PLAN C6 style canonicalisation).
//
// datasetHash = SHA-256 of canonical JSON of the accepted reviews as tuples
//   [review_id, item_id, category, rating, ts, verified]
// sorted by review_id with code-unit comparison (review ids are unique after validation). Canonical JSON (not a
// delimiter join) keeps untrusted strings containing '|' or ',' unambiguous.
//
// Deliberately excluded: `text` (no ranker, detector or explainer reads it, so it must not change identity — the
// injection-text trap relies on this), asOf (an upload's asOf defaults to "today"; including it would invalidate
// every ruling the next day; asOf-dependent outcomes are covered by the detector-config and reviews hashes), and
// file order / formatting (two files with the same accepted reviews have the same hash).

import { canonicalJson, cmp, sha256Hex } from '../stats/hash';
import type { Review } from '../types';

export type ReviewTuple = [string, string, string, number, number, boolean | null];

export function reviewTuple(r: Review): ReviewTuple {
  return [r.review_id, r.item_id, r.category, r.rating, r.ts, r.verified];
}

/** The exact string that is hashed: canonical JSON of the sorted tuples. */
export function canonicalDatasetString(reviews: readonly Review[]): string {
  const tuples = reviews.map(reviewTuple);
  tuples.sort((a, b) => cmp(a[0], b[0]));
  return canonicalJson(tuples);
}

export async function datasetHash(reviews: readonly Review[]): Promise<string> {
  return sha256Hex(canonicalDatasetString(reviews));
}
