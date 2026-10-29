// Configuration loader (PLAN §3 "[Codex] all weights validated finite in (0, 1], half-life finite and > 0"; CL §9).
//
// JSON (an import or JSON.parse) yields widened, untrusted values. validateConfig checks every field of RankConfig
// and narrows it field by field — never with an `as` cast — returning either the typed config or the complete list
// of problems. Unknown keys are errors too, so a typo in a key name cannot silently fall back to a default.

import defaultConfigJson from '../../config.default.json';
import { canonicalJson, sha256Hex } from './stats/hash';
import type { RankConfig, RankKey, Rating } from './types';

export type ConfigValidation = { ok: true; config: RankConfig } | { ok: false; errors: string[] };

const KNOWN_KEYS: readonly string[] = [
  '_provenance',
  'schema',
  'max_bytes',
  'max_rows',
  'max_examples_per_reason',
  'insufficient_below',
  'wilson_threshold',
  'interval_level',
  'bayes_m',
  'min_category_items',
  'tau2_floor',
  'sigma2_floor',
  'sigma2_no_info',
  'unverified_weight',
  'half_life_days',
  'weight_floor',
  'burst_weight',
  'burst_min_reviews',
  'burst_min_days',
  'windows_days',
  'baseline_days',
  'min_baseline_windows',
  'z_min',
  'p_max',
  'correction',
  'permutations',
  'min_reference_reviews',
  'max_spans_per_item',
  'max_perm_tests',
  'detector_seed',
  'rank_key',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRating(n: number): Rating | null {
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n;
  return null;
}

function toRankKey(value: unknown): RankKey | null {
  if (value === 'posterior_mean' || value === 'lower_endpoint') return value;
  return null;
}

/**
 * Field readers. Each records an error and returns a placeholder when the value is invalid; the placeholder is never
 * returned to callers because any recorded error makes the whole validation fail.
 */
function makeReaders(raw: Record<string, unknown>, errors: string[]) {
  const finite = (key: string): number => {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${key}: must be a finite number (got ${describe(v)})`);
      return Number.NaN;
    }
    return v;
  };
  const positive = (key: string): number => {
    const v = finite(key);
    if (Number.isFinite(v) && !(v > 0)) errors.push(`${key}: must be > 0 (got ${v})`);
    return v;
  };
  /** Finite in (0, 1]: every weight factor (no review may reach weight 0). */
  const unitWeight = (key: string): number => {
    const v = finite(key);
    if (Number.isFinite(v) && !(v > 0 && v <= 1)) errors.push(`${key}: must be in (0, 1] (got ${v})`);
    return v;
  };
  /** Finite in the open interval (0, 1): levels and p-values. */
  const openUnit = (key: string): number => {
    const v = finite(key);
    if (Number.isFinite(v) && !(v > 0 && v < 1)) errors.push(`${key}: must be in (0, 1) (got ${v})`);
    return v;
  };
  const integer = (key: string, min: number, max: number = Number.MAX_SAFE_INTEGER): number => {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      errors.push(`${key}: must be an integer (got ${describe(v)})`);
      return Number.NaN;
    }
    if (v < min || v > max) errors.push(`${key}: must be an integer in [${min}, ${max}] (got ${v})`);
    return v;
  };
  return { finite, positive, unitWeight, openUnit, integer };
}

function describe(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v);
  if (typeof v === 'number') return String(v);
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return typeof v;
}

/** Validate and narrow an untrusted config value. Returns every problem found, not just the first. */
export function validateConfig(raw: unknown): ConfigValidation {
  if (!isRecord(raw)) return { ok: false, errors: ['config: must be a JSON object'] };
  const errors: string[] = [];
  const r = makeReaders(raw, errors);

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.includes(key)) errors.push(`${key}: unknown key`);
  }
  for (const key of KNOWN_KEYS) {
    if (key !== '_provenance' && !(key in raw)) errors.push(`${key}: missing`);
  }

  let provenance: string | undefined;
  if ('_provenance' in raw) {
    const p = raw._provenance;
    if (typeof p === 'string') provenance = p;
    else errors.push('_provenance: must be a string when present');
  }

  if (raw.schema !== 'config-1') errors.push(`schema: must be "config-1" (got ${describe(raw.schema)})`);

  const max_bytes = r.integer('max_bytes', 1);
  const max_rows = r.integer('max_rows', 1);
  const max_examples_per_reason = r.integer('max_examples_per_reason', 0, 10_000);
  const insufficient_below = r.integer('insufficient_below', 1, 1_000_000);

  const wilsonRaw = r.integer('wilson_threshold', 1, 5);
  const wilson_threshold = toRating(wilsonRaw);
  // The integer reader already reported a non-integer or out-of-range value; toRating only narrows the type.

  const interval_level = r.openUnit('interval_level');

  let bayes_m: number | 'median' = 'median';
  const bm = raw.bayes_m;
  if (bm === 'median') bayes_m = 'median';
  else if (typeof bm === 'number' && Number.isFinite(bm) && bm > 0) bayes_m = bm;
  else errors.push(`bayes_m: must be "median" or a finite number > 0 (got ${describe(bm)})`);

  const min_category_items = r.integer('min_category_items', 2, 1_000_000);
  const tau2_floor = r.positive('tau2_floor');
  const sigma2_floor = r.positive('sigma2_floor');
  const sigma2_no_info = r.positive('sigma2_no_info');
  const unverified_weight = r.unitWeight('unverified_weight');
  const half_life_days = r.positive('half_life_days');
  const weight_floor = r.unitWeight('weight_floor');
  const burst_weight = r.unitWeight('burst_weight');

  const burst_min_reviews = r.integer('burst_min_reviews', 1);
  const burst_min_days = r.integer('burst_min_days', 0);

  const windows_days: number[] = [];
  const wd = raw.windows_days;
  if (!Array.isArray(wd) || wd.length === 0) {
    errors.push('windows_days: must be a non-empty array of positive integers');
  } else {
    for (let i = 0; i < wd.length; i++) {
      const v: unknown = wd[i];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 366) {
        errors.push(`windows_days[${i}]: must be an integer in [1, 366] (got ${describe(v)})`);
      } else if (windows_days.length > 0 && v <= windows_days[windows_days.length - 1]) {
        errors.push('windows_days: must be strictly ascending without duplicates');
      } else {
        windows_days.push(v);
      }
    }
  }

  const baseline_days = r.integer('baseline_days', 1, 3660);
  const min_baseline_windows = r.integer('min_baseline_windows', 1);
  const z_min = r.positive('z_min');
  const p_max = r.openUnit('p_max');
  if (raw.correction !== 'holm') errors.push(`correction: must be "holm" (got ${describe(raw.correction)})`);
  const permutations = r.integer('permutations', 1, 1_000_000);
  const min_reference_reviews = r.integer('min_reference_reviews', 1);
  const max_spans_per_item = r.integer('max_spans_per_item', 1, 1000);
  const max_perm_tests = r.integer('max_perm_tests', 1);
  const detector_seed = r.integer('detector_seed', 0, 0xffffffff);

  const rank_key = toRankKey(raw.rank_key);
  if (rank_key === null) errors.push(`rank_key: must be "posterior_mean" or "lower_endpoint" (got ${describe(raw.rank_key)})`);

  if (errors.length > 0 || wilson_threshold === null || rank_key === null) {
    return { ok: false, errors: errors.length > 0 ? errors : ['config: invalid'] };
  }

  const config: RankConfig = {
    schema: 'config-1',
    max_bytes,
    max_rows,
    max_examples_per_reason,
    insufficient_below,
    wilson_threshold,
    interval_level,
    bayes_m,
    min_category_items,
    tau2_floor,
    sigma2_floor,
    sigma2_no_info,
    unverified_weight,
    half_life_days,
    weight_floor,
    burst_weight,
    burst_min_reviews,
    burst_min_days,
    windows_days,
    baseline_days,
    min_baseline_windows,
    z_min,
    p_max,
    correction: 'holm',
    permutations,
    min_reference_reviews,
    max_spans_per_item,
    max_perm_tests,
    detector_seed,
    rank_key,
  };
  if (provenance !== undefined) config._provenance = provenance;
  return { ok: true, config };
}

/** The committed config.default.json, validated. Throws if the committed file itself is invalid (a build defect). */
export function defaultConfig(): RankConfig {
  const result = validateConfig(defaultConfigJson);
  if (!result.ok) throw new Error(`config.default.json is invalid: ${result.errors.join('; ')}`);
  return result.config;
}

/**
 * SHA-256 of the canonical JSON of a config with `_provenance` removed (free text never changes behaviour).
 * Key order does not matter. Used by the worker to tag responses so stale results can be discarded; it is never a
 * ruling invalidation key (PLAN §3).
 */
export async function configHash(config: RankConfig): Promise<string> {
  const copy: Record<string, unknown> = { ...config };
  delete copy._provenance;
  return sha256Hex(canonicalJson(copy));
}
