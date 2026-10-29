import { describe, expect, it } from 'vitest';
import { canonicalJson, cmp, fnv1a32, fnv1a32Hex, sha256Hex } from '../../src/core/stats/hash';

describe('fnv1a32', () => {
  // Published FNV-1a 32-bit test vectors (Fowler/Noll/Vo reference test suite).
  it('"" -> 0x811c9dc5 (the offset basis: no bytes are mixed in)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('"a" -> 0xe40c292c', () => {
    // (0x811c9dc5 ^ 0x61) * 0x01000193 mod 2^32 = 0xe40c292c
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });

  it('"foobar" -> 0xbf9cf968', () => {
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('hashes UTF-8 bytes, so non-ASCII input is stable and unsigned', () => {
    const h = fnv1a32('café');
    expect(h).toBe(fnv1a32('café'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(fnv1a32Hex('')).toBe('811c9dc5');
  });
});

describe('sha256Hex (Web Crypto)', () => {
  // FIPS 180-2 / NIST example vectors.
  it('"" -> e3b0c442...b855', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('"abc" -> ba7816bf...15ad', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts bytes and matches the string form', async () => {
    expect(await sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(await sha256Hex('abc'));
  });
});

describe('cmp (code-unit order, never localeCompare)', () => {
  it('orders by UTF-16 code unit: "B" (66) before "a" (97)', () => {
    expect(cmp('B', 'a')).toBe(-1);
    expect(cmp('a', 'B')).toBe(1);
    expect(cmp('a', 'a')).toBe(0);
    expect(['b', 'B', 'a', 'A', '10', '9'].sort(cmp)).toEqual(['10', '9', 'A', 'B', 'a', 'b']);
  });
});

describe('canonicalJson', () => {
  it('sorts object keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('gives identical output for objects built in different key orders', () => {
    expect(canonicalJson({ x: 1, y: 'z' })).toBe(canonicalJson({ y: 'z', x: 1 }));
  });

  it('throws on non-finite numbers instead of emitting null', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson([Number.POSITIVE_INFINITY])).toThrow(TypeError);
  });

  it('omits undefined object members like JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
