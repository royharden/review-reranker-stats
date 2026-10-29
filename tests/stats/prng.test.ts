import { describe, expect, it } from 'vitest';
import { mulberry32, randInt, rngFrom, seedFrom, shuffleInPlace } from '../../src/core/stats/prng';

const close = (actual: number, expected: number, tol = 1e-9) => {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
};

describe('mulberry32', () => {
  // Golden values come from an independent reference computation recorded in the plan (CL §2.4), NOT from this
  // implementation's own first run.
  it('seed 0 golden stream: 0.2664292087, 0.0003297457', () => {
    const r = mulberry32(0);
    close(r(), 0.2664292087);
    close(r(), 0.0003297457);
  });

  it('seed 42 golden stream: 0.6011037519, 0.4482905590, 0.8524657935', () => {
    const r = mulberry32(42);
    close(r(), 0.6011037519);
    close(r(), 0.448290559);
    close(r(), 0.8524657935);
  });

  it('same seed gives the same stream; different seeds give different streams', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const sa = Array.from({ length: 20 }, () => a());
    const sb = Array.from({ length: 20 }, () => b());
    const sc = Array.from({ length: 20 }, () => c());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('outputs lie in [0, 1)', () => {
    const r = mulberry32(123456789);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seedFrom / rngFrom', () => {
  it('is deterministic and order-sensitive in its keys', () => {
    expect(seedFrom('item-1', 10, 12)).toBe(seedFrom('item-1', 10, 12));
    expect(seedFrom('item-1', 10, 12)).not.toBe(seedFrom('item-1', 12, 10));
  });

  it("keeps ('a','b') distinct from ('ab') — keys are framed by canonical JSON, not concatenated", () => {
    expect(seedFrom('a', 'b')).not.toBe(seedFrom('ab'));
    expect(seedFrom('a|b')).not.toBe(seedFrom('a', 'b'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const s = seedFrom('x', 1);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });

  it('rngFrom streams depend only on the keys', () => {
    const a = rngFrom('detector', 'item-9', 100, 104);
    const b = rngFrom('detector', 'item-9', 100, 104);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('randInt / shuffleInPlace', () => {
  it('randInt stays in range and rejects bad n', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const v = randInt(r, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
    expect(() => randInt(r, 0)).toThrow(RangeError);
  });

  it('shuffle is a deterministic permutation for a given seed', () => {
    const a = shuffleInPlace([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(5));
    const b = shuffleInPlace([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(5));
    expect(a).toEqual(b);
    expect(a.slice().sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
