// Hashing and canonical ordering helpers (CL §2.4, PLAN C6, C17).
//
// - fnv1a32: 32-bit FNV-1a over the UTF-8 bytes of a string (sync; item split, PRNG seeding).
// - sha256Hex: SHA-256 via Web Crypto (globalThis.crypto.subtle; browsers, workers, Node >= 20). Async.
// - cmp: code-unit string comparison. Every sort that affects hashes, ranks or selection uses it, never a locale-aware comparison.
// - canonicalJson: JSON with object keys sorted by cmp, for config/ruling hashes.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const encoder = new TextEncoder();

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** 32-bit FNV-1a of the UTF-8 encoding of `text`, as an unsigned integer. */
export function fnv1a32(text: string): number {
  const bytes = encoder.encode(text);
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** 8-character lowercase hex of fnv1a32. */
export function fnv1a32Hex(text: string): string {
  return fnv1a32(text).toString(16).padStart(8, '0');
}

/** SHA-256 of a string (UTF-8) or bytes, as 64 lowercase hex characters. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const source = typeof input === 'string' ? encoder.encode(input) : input;
  // Copy into a fresh ArrayBuffer-backed view so the argument is a plain BufferSource on every TS lib version.
  const bytes = new Uint8Array(source.length);
  bytes.set(source);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Code-unit comparison: a < b ? -1 : a > b ? 1 : 0. Locale-independent and total on strings. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numeric comparison for sorts (ascending). NaN is not expected; callers validate finiteness first. */
export function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonical JSON: like JSON.stringify but object keys are emitted in code-unit order at every depth, so equal
 * values always give identical strings. Throws on non-finite numbers, functions, symbols and bigint rather than
 * silently changing them. `undefined` object members are omitted (as JSON.stringify does); `undefined` array
 * entries throw.
 */
export function canonicalJson(value: unknown): string {
  return canon(value, false);
}

function canon(value: unknown, inArray: boolean): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${String(value)}`);
      return JSON.stringify(value);
    case 'undefined':
      if (inArray) throw new TypeError('canonicalJson: undefined array entry');
      return '';
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((v) => canon(v, true)).join(',') + ']';
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort(cmp);
      const parts: string[] = [];
      for (const key of keys) {
        const v = obj[key];
        if (v === undefined) continue;
        parts.push(JSON.stringify(key) + ':' + canon(v, false));
      }
      return '{' + parts.join(',') + '}';
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}
