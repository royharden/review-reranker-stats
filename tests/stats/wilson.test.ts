import { describe, expect, it } from 'vitest';
import { wilsonInterval, wilsonLower } from '../../src/core/stats/wilson';

describe('wilsonInterval (two-sided, no continuity correction)', () => {
  it('8/10 at z = 1.959964 gives [0.4902, 0.9433]', () => {
    // Derivation: phat = 0.8, z^2 = 3.841459, z^2/n = 0.3841459, denom = 1.3841459
    //   center = (0.8 + 3.841459/20) / 1.3841459 = 0.99207295 / 1.3841459 = 0.716740
    //   half   = 1.959964 * sqrt(0.8*0.2/10 + 3.841459/400) / 1.3841459
    //          = 1.959964 * sqrt(0.016 + 0.0096036) / 1.3841459 = 1.959964 * 0.160011 / 1.3841459 = 0.226577
    //   lo = 0.490163, hi = 0.943317
    const { lo, hi } = wilsonInterval(8, 10, 1.959964);
    expect(Math.abs(lo - 0.4902)).toBeLessThan(1e-4);
    expect(Math.abs(hi - 0.9433)).toBeLessThan(1e-4);
  });

  it('0/5 has lower bound exactly 0', () => {
    // center - half = (z^2/2n)/denom - z*(z/2n)/denom = 0 algebraically; forced exactly to 0.
    const { lo, hi } = wilsonInterval(0, 5, 1.6448536);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
  });

  it('5/5 has upper bound exactly 1', () => {
    const { lo, hi } = wilsonInterval(5, 5, 1.6448536);
    expect(hi).toBe(1);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(1);
  });

  it('n = 0 is handled without NaN: the uninformative interval [0, 1]', () => {
    const r = wilsonInterval(0, 0, 1.6448536);
    expect(r).toEqual({ lo: 0, hi: 1, center: 0.5 });
    expect(Number.isNaN(r.lo) || Number.isNaN(r.hi)).toBe(false);
  });

  it('lower bound grows with evidence at a fixed share (tiny_perfect intuition: 3/3 below 752/800)', () => {
    const z = 1.6448536;
    expect(wilsonLower(3, 3, z)).toBeLessThan(wilsonLower(752, 800, z));
  });

  it('rejects k > n, negative or fractional counts and a non-positive z', () => {
    expect(() => wilsonInterval(6, 5, 1.64)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 5, 1.64)).toThrow(RangeError);
    expect(() => wilsonInterval(1.5, 5, 1.64)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 5, 0)).toThrow(RangeError);
  });
});
