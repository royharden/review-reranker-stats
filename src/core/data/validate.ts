// Per-field validation for CSV rows (CL §1.1 item 1, §2.4). Pure functions; no clock (asOf is an argument).
//
// Timestamp rule (CL §2.4):
//   - ISO 8601 date-time with `Z` or an explicit offset (±HH:MM or ±HHMM); `T` or a single space between date and
//     time; seconds and a fraction optional (fraction truncated to milliseconds).
//   - ISO without a zone (incl. a bare date) is rejected as ambiguous: 'bad_timestamp_zoneless'.
//   - A plain non-negative integer in [1e11, 8.64e15] is epoch milliseconds.
//   - A smaller plain integer is rejected as 'bad_timestamp_epoch_seconds' rather than guessed.
//   - Anything else (decimals, exponents, out-of-range dates, larger integers) is 'bad_timestamp'.
//   - A valid timestamp strictly after asOf is 'future_timestamp' (a review at exactly asOf is accepted).

import type { Rating } from '../types';
import type { RowRejectReason } from './schema';

export const EPOCH_MS_MIN = 1e11;
/** Largest time value ECMAScript Date supports (±8.64e15 ms). */
export const EPOCH_MS_MAX = 8.64e15;

export type FieldResult<T> = { ok: true; value: T } | { ok: false; reason: RowRejectReason };

const RATING_RE = /^[1-5](?:\.0+)?$/;
const INTEGER_RE = /^\d+$/;
// date, separator, hh:mm, optional :ss, optional .fraction, optional zone
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|[+-]\d{2}:?\d{2})?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rating: an integer 1..5 written as a digit, optionally followed by a zero fraction ("5" or "5.0"; Amazon-style
 * floats). "0", "6", "4.5", blanks and anything else are rejected.
 */
export function parseRating(raw: string): FieldResult<Rating> {
  const s = raw.trim();
  if (!RATING_RE.test(s)) return { ok: false, reason: 'bad_rating' };
  const d = s.charCodeAt(0) - 48;
  if (d === 1 || d === 2 || d === 3 || d === 4 || d === 5) return { ok: true, value: d };
  return { ok: false, reason: 'bad_rating' };
}

/** Parse a timestamp (without the asOf check). */
export function parseTimestamp(raw: string): FieldResult<number> {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'bad_timestamp' };

  if (INTEGER_RE.test(s)) {
    // Long digit strings parse to large finite numbers or Infinity; both fall outside the accepted range below.
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, reason: 'bad_timestamp' };
    if (n < EPOCH_MS_MIN) return { ok: false, reason: 'bad_timestamp_epoch_seconds' };
    if (n > EPOCH_MS_MAX) return { ok: false, reason: 'bad_timestamp' };
    return { ok: true, value: n };
  }

  if (DATE_ONLY_RE.test(s)) return { ok: false, reason: 'bad_timestamp_zoneless' };

  const m = ISO_RE.exec(s);
  if (m === null) return { ok: false, reason: 'bad_timestamp' };
  const zone = m[8];
  if (zone === undefined) return { ok: false, reason: 'bad_timestamp_zoneless' };

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number((m[7] + '00').slice(0, 3));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: 'bad_timestamp' };
  }

  let offsetMinutes = 0;
  if (zone !== 'Z' && zone !== 'z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2, 4));
    if (oh > 23 || om > 59) return { ok: false, reason: 'bad_timestamp' };
    offsetMinutes = sign * (oh * 60 + om);
  }

  // Date.UTC is a pure calendar computation (it does not read the clock). Years 0..99 would be mapped to 1900..1999
  // by Date.UTC, so they are rejected outright; reviews from before 100 AD are not plausible input.
  if (year < 100) return { ok: false, reason: 'bad_timestamp' };
  const local = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  // Reject calendar overflow such as 2024-02-30 (Date.UTC would roll it into March).
  const check = new Date(local);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  const ts = local - offsetMinutes * 60_000;
  if (!Number.isFinite(ts) || ts < -EPOCH_MS_MAX || ts > EPOCH_MS_MAX) return { ok: false, reason: 'bad_timestamp' };
  return { ok: true, value: ts };
}

/** Parse a timestamp and apply the asOf rule. */
export function parseTimestampAsOf(raw: string, asOf: number): FieldResult<number> {
  const r = parseTimestamp(raw);
  if (!r.ok) return r;
  if (r.value > asOf) return { ok: false, reason: 'future_timestamp' };
  return r;
}

/**
 * verified is tri-state: true/1 and false/0 (case-insensitive, surrounding whitespace ignored); blank = unknown
 * (null). Anything else is 'malformed_verified'. An absent column is also unknown (handled by the caller).
 */
export function parseVerified(raw: string): FieldResult<boolean | null> {
  const s = raw.trim().toLowerCase();
  if (s === '') return { ok: true, value: null };
  if (s === 'true' || s === '1') return { ok: true, value: true };
  if (s === 'false' || s === '0') return { ok: true, value: false };
  return { ok: false, reason: 'malformed_verified' };
}

/** Identifier/category cell: surrounding whitespace trimmed; empty after trimming means missing. */
export function cleanId(raw: string): string {
  return raw.trim();
}

/** asOf must be a finite integer epoch-ms value inside the Date range. */
export function isValidAsOf(asOf: number): boolean {
  return Number.isInteger(asOf) && asOf >= -EPOCH_MS_MAX && asOf <= EPOCH_MS_MAX;
}

/**
 * UTF-8 byte length of a string without allocating an encoded copy. Lone surrogates count 3 bytes (they encode as
 * U+FFFD, matching TextEncoder).
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}
