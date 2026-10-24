import { describe, expect, it } from 'vitest';
import defaultJson from '../config.default.json';
import { configHash, defaultConfig, validateConfig } from '../src/core/config';

function withField(key: string, value: unknown): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(defaultJson)), [key]: value };
}

function errorsFor(raw: unknown): string[] {
  const r = validateConfig(raw);
  return r.ok ? [] : r.errors;
}

describe('validateConfig', () => {
  it('accepts the committed config.default.json and narrows it', () => {
    const r = validateConfig(JSON.parse(JSON.stringify(defaultJson)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.wilson_threshold).toBe(4);
      expect(r.config.rank_key).toBe('posterior_mean');
      expect(r.config.bayes_m).toBe('median');
      expect(r.config.windows_days).toEqual([1, 3, 7]);
    }
    expect(defaultConfig().schema).toBe('config-1');
  });

  it('rejects non-objects', () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig([]).ok).toBe(false);
    expect(validateConfig('config').ok).toBe(false);
  });

  it('weights must be finite and in (0, 1]', () => {
    for (const key of ['unverified_weight', 'burst_weight', 'weight_floor']) {
      expect(errorsFor(withField(key, 0)).some((e) => e.startsWith(key))).toBe(true);
      expect(errorsFor(withField(key, 1.5)).some((e) => e.startsWith(key))).toBe(true);
      expect(errorsFor(withField(key, -0.1)).some((e) => e.startsWith(key))).toBe(true);
      expect(errorsFor(withField(key, Number.NaN)).some((e) => e.startsWith(key))).toBe(true);
      expect(errorsFor(withField(key, '0.5')).some((e) => e.startsWith(key))).toBe(true);
      expect(validateConfig(withField(key, 1)).ok).toBe(true);
    }
  });

  it('half_life_days must be finite and > 0', () => {
    expect(errorsFor(withField('half_life_days', 0)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('half_life_days', -5)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('half_life_days', Number.POSITIVE_INFINITY)).length).toBeGreaterThan(0);
    expect(validateConfig(withField('half_life_days', 0.5)).ok).toBe(true);
  });

  it('wilson_threshold must be an integer in 1..5', () => {
    for (const bad of [0, 6, 4.5, '4', null]) {
      expect(errorsFor(withField('wilson_threshold', bad)).some((e) => e.startsWith('wilson_threshold'))).toBe(true);
    }
    for (const good of [1, 3, 5]) expect(validateConfig(withField('wilson_threshold', good)).ok).toBe(true);
  });

  it('checks levels, floors, integers, enums and windows', () => {
    expect(errorsFor(withField('interval_level', 1)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('p_max', 0)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('tau2_floor', 0)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('sigma2_no_info', -1)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('max_rows', 1.5)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('permutations', 0)).length).toBeGreaterThan(0);
    expect(errorsFor(withField('rank_key', 'median')).length).toBeGreaterThan(0);
    expect(errorsFor(withField('correction', 'bonferroni')).length).toBeGreaterThan(0);
    expect(errorsFor(withField('schema', 'config-2')).length).toBeGreaterThan(0);
    expect(errorsFor(withField('bayes_m', 0)).length).toBeGreaterThan(0);
    expect(validateConfig(withField('bayes_m', 42)).ok).toBe(true);
    expect(errorsFor(withField('windows_days', [])).length).toBeGreaterThan(0);
    expect(errorsFor(withField('windows_days', [1, 1.5])).length).toBeGreaterThan(0);
    expect(errorsFor(withField('windows_days', [3, 1])).length).toBeGreaterThan(0);
    expect(errorsFor(withField('detector_seed', -1)).length).toBeGreaterThan(0);
  });

  it('rejects unknown and missing keys, and reports every problem at once', () => {
    expect(errorsFor(withField('z_mn', 3)).some((e) => e.includes('unknown key'))).toBe(true);
    const missing = JSON.parse(JSON.stringify(defaultJson));
    delete missing.z_min;
    expect(errorsFor(missing)).toContain('z_min: missing');
    const several = { ...withField('half_life_days', 0), unverified_weight: 2, rank_key: 'x' };
    expect(errorsFor(several).length).toBeGreaterThanOrEqual(3);
  });
});

describe('configHash', () => {
  it('ignores _provenance and key order, and changes with any parameter', async () => {
    const a = defaultConfig();
    const reordered = validateConfig(Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(defaultJson))).reverse()));
    expect(reordered.ok).toBe(true);
    if (!reordered.ok) return;
    const noProv = { ...a };
    delete noProv._provenance;
    expect(await configHash(a)).toBe(await configHash(reordered.config));
    expect(await configHash(a)).toBe(await configHash(noProv));
    expect(await configHash(a)).not.toBe(await configHash({ ...a, half_life_days: 180 }));
    expect(await configHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
