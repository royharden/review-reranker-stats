// Seeded PRNG (CL §2.4): mulberry32, written fresh from the public-domain algorithm, plus FNV-1a context seeding so
// every random stream depends only on stable keys (e.g. config seed, item id, span), never on processing order.

import { canonicalJson, fnv1a32 } from './hash';

export type Rng = () => number;

/** mulberry32: returns a generator of uniform floats in [0, 1). Seed is coerced to int32. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Unsigned 32-bit seed from context keys: FNV-1a of the canonical JSON array of the keys. Using canonical JSON
 * (not plain concatenation) keeps ('a', 'b') distinct from ('ab') and from ('a|b').
 */
export function seedFrom(...keys: ReadonlyArray<string | number>): number {
  return fnv1a32(canonicalJson(keys));
}

/** Convenience: a mulberry32 stream seeded from context keys. */
export function rngFrom(...keys: ReadonlyArray<string | number>): Rng {
  return mulberry32(seedFrom(...keys));
}

/** Uniform integer in [0, n). n must be a positive integer. */
export function randInt(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`randInt: n must be a positive integer, got ${n}`);
  return Math.floor(rng() * n);
}

/** In-place Fisher-Yates shuffle driven by `rng`; returns the same array. */
export function shuffleInPlace<T>(values: T[], rng: Rng): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
}
