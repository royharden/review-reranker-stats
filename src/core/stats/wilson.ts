// Two-sided Wilson score interval for a binomial proportion, no continuity correction (CL §2.5, PLAN §1 row 12).

export interface WilsonInterval {
  lo: number;
  hi: number;
  /** Wilson centre (shrunken proportion); 0.5 when n = 0. */
  center: number;
}

/**
 * Wilson interval for k successes in n trials at normal quantile z (two-sided: z = 1.6448536 for 90%).
 *
 * n = 0 returns the uninformative interval { lo: 0, hi: 1, center: 0.5 } (documented; never NaN).
 * k = 0 forces lo = 0 exactly and k = n forces hi = 1 exactly (the closed form gives these up to rounding).
 */
export function wilsonInterval(k: number, n: number, z: number): WilsonInterval {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`wilsonInterval: n must be a non-negative integer, got ${n}`);
  if (!Number.isInteger(k) || k < 0 || k > n) {
    throw new RangeError(`wilsonInterval: k must be an integer in [0, n], got k=${k}, n=${n}`);
  }
  if (!(Number.isFinite(z) && z > 0)) throw new RangeError(`wilsonInterval: z must be finite and > 0, got ${z}`);
  if (n === 0) return { lo: 0, hi: 1, center: 0.5 };

  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;

  const lo = k === 0 ? 0 : Math.max(0, center - half);
  const hi = k === n ? 1 : Math.min(1, center + half);
  return { lo, hi, center };
}

/** Lower Wilson bound (the `wilson` ranker's score). */
export function wilsonLower(k: number, n: number, z: number): number {
  return wilsonInterval(k, n, z).lo;
}
