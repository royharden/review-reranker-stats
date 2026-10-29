import { describe, expect, it } from 'vitest';
import { asOfFromDateValue, utcDateValue } from '../../src/ui/asOf';
import { createSafeStorage } from '../../src/ui/storage';
import type { StorageBackend } from '../../src/ui/storage';

describe('asOf field helpers (PLAN C14)', () => {
  it('today is formatted as a UTC date and asOf is the last millisecond of that UTC day', () => {
    expect(utcDateValue(new Date(Date.UTC(2026, 9, 24, 23, 59)))).toBe('2026-10-24');
    expect(asOfFromDateValue('2026-10-24')).toBe(Date.UTC(2026, 9, 25) - 1);
  });

  it('invalid or impossible dates give null', () => {
    for (const bad of ['', '2026-02-30', '2026-13-01', '26-10-24', '2026-10-24T00:00Z', '1969-12-31']) {
      expect(asOfFromDateValue(bad)).toBeNull();
    }
  });
});

describe('safe storage', () => {
  function memoryBackend(): StorageBackend & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }

  it('persists through a working backend without a warning', () => {
    const backend = memoryBackend();
    const s = createSafeStorage(backend);
    expect(s.set('k', 'v')).toBe(true);
    expect(backend.data.get('k')).toBe('v');
    expect(s.get('k')).toBe('v');
    expect(s.warning).toBeNull();
  });

  it('a throwing backend falls back to memory and sets a warning', () => {
    const throwing: StorageBackend = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const s = createSafeStorage(throwing);
    expect(s.set('k', 'v')).toBe(false);
    expect(s.warning).not.toBeNull();
    expect(s.get('k')).toBe('v');
    expect(() => s.remove('k')).not.toThrow();
    expect(s.get('k')).toBeNull();
  });

  it('no backend at all: memory only, with a warning from the start', () => {
    const s = createSafeStorage(null);
    expect(s.warning).not.toBeNull();
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
  });
});
