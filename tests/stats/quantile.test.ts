import { describe, expect, it } from 'vitest';
import { erf, erfc, normalCdf, normalQuantile, twoSidedZ } from '../../src/core/stats/quantile';

// Reference values: the standard normal quantiles printed in every z-table and reproduced by independent
// high-precision libraries (e.g. scipy.stats.norm.ppf):
//   Phi^-1(0.9)   = 1.2815515655446004
//   Phi^-1(0.95)  = 1.6448536269514722
//   Phi^-1(0.975) = 1.959963984540054
//   Phi^-1(0.995) = 2.5758293035489004
// PLAN M1 acceptance 2 pins the 7-decimal forms at tolerance 1e-6; the 16-digit forms are checked at 1e-9
// (the accuracy target of Acklam + one Halley step).

const close = (actual: number, expected: number, tol: number) => {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
};

describe('normalQuantile (Acklam + Halley refinement)', () => {
  it('pins Phi^-1(0.9/0.95/0.975/0.995) to the plan values within 1e-6', () => {
    close(normalQuantile(0.9), 1.2815516, 1e-6);
    close(normalQuantile(0.95), 1.6448536, 1e-6);
    close(normalQuantile(0.975), 1.959964, 1e-6);
    close(normalQuantile(0.995), 2.5758293, 1e-6);
  });

  it('matches 16-digit reference quantiles within 1e-9', () => {
    close(normalQuantile(0.9), 1.2815515655446004, 1e-9);
    close(normalQuantile(0.95), 1.6448536269514722, 1e-9);
    close(normalQuantile(0.975), 1.959963984540054, 1e-9);
    close(normalQuantile(0.995), 2.5758293035489004, 1e-9);
  });

  it('is symmetric: Phi^-1(p) = -Phi^-1(1 - p)', () => {
    // 1 - 0.9 is 0.09999999999999998 in floating point, so compare at a tight tolerance rather than bit equality.
    close(normalQuantile(0.1), -normalQuantile(0.9), 1e-12);
    close(normalQuantile(0.025), -normalQuantile(0.975), 1e-12);
    close(normalQuantile(0.005), -normalQuantile(0.995), 1e-12);
    close(normalQuantile(1e-6), -normalQuantile(1 - 1e-6), 1e-8);
  });

  it('returns exactly 0 at the median and +/-Infinity at the endpoints', () => {
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('throws RangeError outside [0, 1] and for NaN', () => {
    expect(() => normalQuantile(-0.1)).toThrow(RangeError);
    expect(() => normalQuantile(1.5)).toThrow(RangeError);
    expect(() => normalQuantile(Number.NaN)).toThrow(RangeError);
  });

  it('round-trips through normalCdf in the body and both tails (Acklam lower-tail branch included)', () => {
    for (const p of [1e-10, 1e-6, 0.001, 0.01, 0.02, 0.0243, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 0.999]) {
      const x = normalQuantile(p);
      // relative error in p
      expect(Math.abs(normalCdf(x) - p) / p).toBeLessThan(1e-9);
    }
  });

  it('twoSidedZ(0.9) is the 90% two-sided z = 1.6448536 used by Wilson and EB', () => {
    close(twoSidedZ(0.9), 1.6448536, 1e-6);
    close(twoSidedZ(0.95), 1.959964, 1e-6);
  });
});

describe('normalCdf / erf / erfc', () => {
  it('Phi(0) = 0.5 exactly and Phi is symmetric', () => {
    expect(normalCdf(0)).toBe(0.5);
    close(normalCdf(-1.3) + normalCdf(1.3), 1, 1e-15);
  });

  it('Phi(1.959963984540054) = 0.975 and Phi(-1.6448536269514722) = 0.05', () => {
    close(normalCdf(1.959963984540054), 0.975, 1e-12);
    close(normalCdf(-1.6448536269514722), 0.05, 1e-12);
  });

  it('erf/erfc reference values: erf(1) = 0.8427007929497149, erfc(3) = 2.209049699858544e-5', () => {
    // Abramowitz & Stegun Table 7.1 / standard library values.
    close(erf(1), 0.8427007929497149, 1e-14);
    close(erf(-1), -0.8427007929497149, 1e-14);
    expect(Math.abs(erfc(3) - 2.209049699858544e-5) / 2.209049699858544e-5).toBeLessThan(1e-12);
    expect(erf(0)).toBe(0);
    expect(erfc(0)).toBe(1);
  });

  it('series and continued-fraction branches agree at the 2.5 switch point', () => {
    const below = erfc(2.4999999999);
    const above = erfc(2.5);
    expect(Math.abs(below - above) / above).toBeLessThan(1e-8);
  });
});
