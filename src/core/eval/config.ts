import proposed from '../../../config.eval.json';
import type { EvalConfig } from '../types';

function object(x: unknown): x is Record<string, unknown> { return typeof x === 'object' && x !== null && !Array.isArray(x); }
function positive(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x > 0; }
function count(x: unknown): x is number { return positive(x) && Number.isSafeInteger(x); }
function fraction(x: unknown): x is number { return positive(x) && x < 1; }
/** Protocol values are frozen together with all ranker/detector settings before any final read. */
export function validateEvalConfig(raw: unknown): EvalConfig {
  if (!object(raw) || raw.schema !== 'eval-config-1' || typeof raw.split_seed !== 'string' || !raw.split_seed
    || !fraction(raw.dev_share) || raw.cutoff_rule !== 'elapsed_fraction' || !fraction(raw.cutoff_fraction)
    || !count(raw.min_later_reviews) || !count(raw.cold_start_max_earlier) || !count(raw.bootstrap_resamples)
    || raw.bootstrap_level !== 0.95 || !Number.isSafeInteger(raw.bootstrap_seed) || !Number.isSafeInteger(raw.generator_seed)
    || (raw.generator_profile !== 'demo' && raw.generator_profile !== 'eval') || raw.ndcg_k !== 10
    || raw.final_refit_scope !== 'all-items-pre-cutoff' || !object(raw.support_gate)
    || !count(raw.support_gate.min_items_per_category) || !count(raw.support_gate.min_target_items)
    || !Array.isArray(raw.amazon_categories) || raw.amazon_categories.some((x) => typeof x !== 'string')
    || !object(raw.pass_checks) || typeof raw.pass_checks.a_min_paired_ci_lower !== 'number'
    || !Number.isFinite(raw.pass_checks.a_min_paired_ci_lower) || !positive(raw.pass_checks.b_max_damage_ratio)
    || typeof raw.pass_checks.c_viral_organic_unflagged !== 'boolean' || !Array.isArray(raw.pass_checks.d_coverage_band)
    || raw.pass_checks.d_coverage_band.length !== 2 || !fraction(raw.pass_checks.d_coverage_band[0])
    || !fraction(raw.pass_checks.d_coverage_band[1]) || raw.pass_checks.d_coverage_band[0] > raw.pass_checks.d_coverage_band[1]
    || !fraction(raw.pass_checks.e_max_organic_downweight_share)) throw new Error('Invalid evaluation protocol');
  // Structural checks above precede this narrowing; JSON roundtrip breaks caller aliases to frozen proposals.
  return JSON.parse(JSON.stringify(raw)) as EvalConfig;
}
export function defaultEvalConfig(): EvalConfig { return validateEvalConfig(proposed); }
