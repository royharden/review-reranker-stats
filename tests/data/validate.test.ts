import { describe, expect, it } from 'vitest';
import {
  EPOCH_MS_MAX,
  parseRating,
  parseTimestamp,
  parseTimestampAsOf,
  parseVerified,
  utf8ByteLength,
} from '../../src/core/data/validate';

const T_2024_06_01_10Z = Date.UTC(2024, 5, 1, 10); // 1717236000000

describe('parseRating: integer 1..5 only', () => {
  it('accepts 1..5 and Amazon-style 5.0', () => {
    expect(parseRating('1')).toEqual({ ok: true, value: 1 });
    expect(parseRating(' 5 ')).toEqual({ ok: true, value: 5 });
    expect(parseRating('4.0')).toEqual({ ok: true, value: 4 });
  });

  it('rejects 0, 6, 4.5, blank, words, signs and exponents as bad_rating', () => {
    for (const bad of ['0', '6', '4.5', '', '  ', 'five', '-3', '+4', '4e0', '04', '5.01']) {
      expect(parseRating(bad)).toEqual({ ok: false, reason: 'bad_rating' });
    }
  });
});

describe('parseTimestamp (CL §2.4)', () => {
  it('ISO with Z', () => {
    expect(parseTimestamp('2024-06-01T10:00:00Z')).toEqual({ ok: true, value: T_2024_06_01_10Z });
    expect(parseTimestamp('2024-06-01T10:00Z')).toEqual({ ok: true, value: T_2024_06_01_10Z });
    expect(parseTimestamp('2024-06-01 10:00:00Z')).toEqual({ ok: true, value: T_2024_06_01_10Z });
  });

  it('explicit offsets convert to UTC (+02:00, +0200, -05:30)', () => {
    expect(parseTimestamp('2024-06-01T12:00:00+02:00')).toEqual({ ok: true, value: T_2024_06_01_10Z });
    expect(parseTimestamp('2024-06-01T12:00:00+0200')).toEqual({ ok: true, value: T_2024_06_01_10Z });
    // 04:30 at -05:30 = 10:00Z
    expect(parseTimestamp('2024-06-01T04:30:00-05:30')).toEqual({ ok: true, value: T_2024_06_01_10Z });
  });

  it('fractions are truncated to milliseconds', () => {
    expect(parseTimestamp('2024-06-01T10:00:00.25Z')).toEqual({ ok: true, value: T_2024_06_01_10Z + 250 });
    expect(parseTimestamp('2024-06-01T10:00:00.123456Z')).toEqual({ ok: true, value: T_2024_06_01_10Z + 123 });
  });

  it('zone-less ISO and bare dates are rejected as zoneless', () => {
    expect(parseTimestamp('2024-06-01T10:00:00')).toEqual({ ok: false, reason: 'bad_timestamp_zoneless' });
    expect(parseTimestamp('2024-06-01 10:00')).toEqual({ ok: false, reason: 'bad_timestamp_zoneless' });
    expect(parseTimestamp('2024-06-01')).toEqual({ ok: false, reason: 'bad_timestamp_zoneless' });
  });

  it('integers >= 1e11 and <= 8.64e15 are epoch milliseconds', () => {
    expect(parseTimestamp('1717236000000')).toEqual({ ok: true, value: T_2024_06_01_10Z });
    expect(parseTimestamp('100000000000')).toEqual({ ok: true, value: 1e11 });
    expect(parseTimestamp('8640000000000000')).toEqual({ ok: true, value: EPOCH_MS_MAX });
  });

  it('smaller integers are rejected as epoch seconds, larger ones as bad', () => {
    expect(parseTimestamp('1717236000')).toEqual({ ok: false, reason: 'bad_timestamp_epoch_seconds' });
    expect(parseTimestamp('99999999999')).toEqual({ ok: false, reason: 'bad_timestamp_epoch_seconds' });
    expect(parseTimestamp('0')).toEqual({ ok: false, reason: 'bad_timestamp_epoch_seconds' });
    expect(parseTimestamp('8640000000000001')).toEqual({ ok: false, reason: 'bad_timestamp' });
    expect(parseTimestamp('9'.repeat(400))).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  it('garbage, decimals, exponents and impossible dates are bad_timestamp', () => {
    for (const bad of ['', 'yesterday', '1.7e12', '1717236000000.5', '-1717236000000', '2024-02-30T00:00:00Z', '2024-13-01T00:00:00Z', '2024-06-01T24:00:00Z', '2024-06-01T10:00:00+25:00', '0050-01-01T00:00:00Z']) {
      expect(parseTimestamp(bad)).toEqual({ ok: false, reason: 'bad_timestamp' });
    }
  });

  it('leap day is valid; asOf rule: after asOf is future, exactly asOf is accepted', () => {
    expect(parseTimestamp('2024-02-29T00:00:00Z').ok).toBe(true);
    const asOf = T_2024_06_01_10Z;
    expect(parseTimestampAsOf('2024-06-01T10:00:00Z', asOf)).toEqual({ ok: true, value: asOf });
    expect(parseTimestampAsOf('2024-06-01T10:00:00.001Z', asOf)).toEqual({ ok: false, reason: 'future_timestamp' });
    expect(parseTimestampAsOf('1717236000', asOf)).toEqual({ ok: false, reason: 'bad_timestamp_epoch_seconds' });
  });
});

describe('parseVerified: tri-state', () => {
  it('true/1, false/0 case-insensitively; blank = unknown', () => {
    expect(parseVerified('true')).toEqual({ ok: true, value: true });
    expect(parseVerified(' TRUE ')).toEqual({ ok: true, value: true });
    expect(parseVerified('1')).toEqual({ ok: true, value: true });
    expect(parseVerified('False')).toEqual({ ok: true, value: false });
    expect(parseVerified('0')).toEqual({ ok: true, value: false });
    expect(parseVerified('')).toEqual({ ok: true, value: null });
  });

  it('anything else is malformed_verified', () => {
    for (const bad of ['yes', 'no', '2', 't', 'verified']) {
      expect(parseVerified(bad)).toEqual({ ok: false, reason: 'malformed_verified' });
    }
  });
});

describe('utf8ByteLength', () => {
  it('matches TextEncoder for ASCII, 2-, 3- and 4-byte characters', () => {
    const enc = new TextEncoder();
    for (const s of ['', 'abc', 'café', '€uro', 'a😀b', 'é'.repeat(10)]) {
      expect(utf8ByteLength(s)).toBe(enc.encode(s).length);
    }
  });
});
