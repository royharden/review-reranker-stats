// Standard normal CDF and inverse CDF (quantile), pure and deterministic.
//
// normalQuantile: Peter J. Acklam's rational approximation (relative error ~1.15e-9) followed by one Halley
// refinement step against an accurate erfc-based CDF, giving |error| well below 1e-9 on (0, 1).
// erfc: for 0 <= t < 2.5, erfc = 1 - erf with erf from the all-positive series
//   erf(t) = (2/sqrt(pi)) e^{-t^2} sum_{n>=0} (2t^2)^n t / (1*3*...*(2n+1))   (no cancellation);
// for t >= 2.5, the Laplace continued fraction (Abramowitz & Stegun 7.1.14)
//   sqrt(pi) e^{t^2} erfc(t) = 1 / (t + (1/2) / (t + (2/2) / (t + (3/2) / (t + ...))))
// evaluated with the modified Lentz algorithm, which keeps full relative accuracy in the tail.

const SQRT_PI = Math.sqrt(Math.PI);
const SQRT_2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);
const TINY = 1e-300;
const EPS = 1e-16;

/** erf(t) for |t| < 2.5 via the positive series above. */
function erfSeries(t: number): number {
  const t2 = t * t;
  const twoT2 = 2 * t2;
  let term = t;
  let sum = t;
  for (let n = 1; n < 500; n++) {
    term *= twoT2 / (2 * n + 1);
    sum += term;
    if (Math.abs(term) <= EPS * Math.abs(sum)) break;
  }
  return (2 / SQRT_PI) * Math.exp(-t2) * sum;
}

/** erfc(t) for t >= 2.5 via the continued fraction above (modified Lentz). */
function erfcContinuedFraction(t: number): number {
  // F = b0 + a1/(b1 + a2/(b2 + ...)) with b_k = t, a_k = k/2.
  let f = t;
  let c = f;
  let d = 0;
  for (let k = 1; k < 5000; k++) {
    const a = k / 2;
    d = t + a * d;
    if (d === 0) d = TINY;
    c = t + a / c;
    if (c === 0) c = TINY;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) <= EPS) break;
  }
  return Math.exp(-t * t) / (SQRT_PI * f);
}

/** Complementary error function. */
export function erfc(t: number): number {
  if (Number.isNaN(t)) return Number.NaN;
  if (t < 0) return 2 - erfc(-t);
  if (t < 2.5) return 1 - erfSeries(t);
  return erfcContinuedFraction(t);
}

/** Error function. */
export function erf(t: number): number {
  if (Number.isNaN(t)) return Number.NaN;
  if (Math.abs(t) < 2.5) return erfSeries(t);
  return t > 0 ? 1 - erfcContinuedFraction(t) : erfcContinuedFraction(-t) - 1;
}

/** Standard normal CDF, Phi(x) = 0.5 * erfc(-x / sqrt(2)). Accurate in both tails. */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / SQRT_2);
}

// Acklam coefficients.
const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
  2.506628277459239,
];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
  2.938163982698783,
];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const P_LOW = 0.02425;

/** Acklam's approximation for p in (0, 0.5]. */
function acklamLowerHalf(p: number): number {
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}

/**
 * Inverse standard normal CDF. Returns -Infinity at p = 0 and +Infinity at p = 1; throws RangeError outside [0, 1].
 * For p > 0.5 it returns -normalQuantile(1 - p) (1 - p is exact there), so both tails get the same treatment.
 */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`normalQuantile: p must be in [0, 1], got ${String(p)}`);
  }
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  if (p > 0.5) return -normalQuantile(1 - p);
  let x = acklamLowerHalf(p);
  // One Halley step: e = Phi(x) - p, u = e / phi(x); x <- x - u / (1 + x u / 2).
  const e = normalCdf(x) - p;
  const u = e * SQRT_2PI * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

/** z for a two-sided interval at `level` (e.g. 0.9 -> 1.6448536...). */
export function twoSidedZ(level: number): number {
  if (!(level > 0 && level < 1)) {
    throw new RangeError(`twoSidedZ: level must be in (0, 1), got ${String(level)}`);
  }
  return normalQuantile(1 - (1 - level) / 2);
}
