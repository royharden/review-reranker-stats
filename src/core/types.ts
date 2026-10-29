// Shared contracts for the deterministic core (CL §2.4, §2.5, §9; PLAN.md §2 C2, C4, C10, C16).
//
// Erasable syntax only (PLAN §4): union literal types instead of enums, no namespaces, no parameter properties.
// Data-bearing fields that may be absent use `null` (structured-clone and JSON friendly); functions that can be
// undefined for a statistical reason return `{ value: undefined, reason }` instead (see ratingstats/spearman.ts).

// ---------------------------------------------------------------------------------------------------------------
// Reviews and datasets
// ---------------------------------------------------------------------------------------------------------------

export type Rating = 1 | 2 | 3 | 4 | 5;

/** One accepted review. Field names follow the CSV columns of the spec. */
export interface Review {
  review_id: string;
  item_id: string;
  category: string;
  rating: Rating;
  /** Epoch milliseconds, UTC. */
  ts: number;
  /** Tri-state: true / false when the column is present and valid, null when absent or blank (unknown). */
  verified: boolean | null;
  /** Optional free text. Never used by any ranker; carried only so the injection-text trap can be displayed. */
  text?: string;
}

/** Per-item index into Dataset.reviews. */
export interface ItemIndex {
  item_id: string;
  category: string;
  /** Indices into Dataset.reviews, sorted by (ts asc, review_id asc by code unit). */
  reviewIdx: number[];
  n: number;
  /** n < insufficient_below (spec: < 3 reviews). Kept and ranked, but labelled. */
  insufficient: boolean;
  firstTs: number;
  lastTs: number;
}

export interface Dataset {
  reviews: readonly Review[];
  items: Map<string, ItemIndex>;
  /** Category names sorted by code unit. */
  categories: string[];
  /** Explicit reference time (epoch ms UTC). Core never reads a clock (PLAN §1 row 8). */
  asOf: number;
  /** SHA-256 hex of the canonical accepted-review content (defined in src/core/data/hash.ts, M2). */
  datasetHash: string;
  verifiedColumnPresent: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Methods, intervals and explanation parts
// ---------------------------------------------------------------------------------------------------------------

export type BaseMethodId = 'mean' | 'bayes_global' | 'wilson' | 'eb_category' | 'eb_global' | 'full';
/** `full` minus one weight factor (CL §8 ablations). */
export type AblationMethodId = 'full-verified' | 'full-recency' | 'full-burst';
export type MethodId = BaseMethodId | AblationMethodId;

export type RankKey = 'posterior_mean' | 'lower_endpoint';

export type PriorSource = 'category' | 'global-fallback' | 'global';

/**
 * What an interval is an interval OF. Wilson is a top-box share interval and is never drawn on the star axis;
 * EB intervals are on mean stars; `mean` and `bayes_global` claim no interval (PLAN C4).
 */
export interface IntervalMeta {
  quantity: 'mean stars' | 'top-box share' | 'not-applicable';
  /** Two-sided coverage level, e.g. 0.9; null when quantity is 'not-applicable'. */
  level: number | null;
  approx?: 'normal' | 'wilson-score';
}

export type DetectorStatus = 'assessed' | 'partial' | 'unassessable' | 'not-run';

/** Effect label of a flagged span after ruling replay (CL §2.7). */
export type SpanRulingLabel = 'unreviewed' | 'skipped' | 'confirmed' | 'restored';

/** Reference to one flagged span as shown in an item's parts. Days are UTC day indices (floor(ts / 86_400_000)). */
export interface FlaggedSpanRef {
  span_start: number;
  span_end: number;
  label: SpanRulingLabel;
  /** Burst weight this span applies (burst_weight while active, 1 when restored). */
  weight: number;
}

export interface WeightSummary {
  /** Share of the item's reviews with verified === true among those with known status; null if none known. */
  verified_share: number | null;
  /** Mean recency factor over the item's reviews; null for methods without recency. */
  mean_recency: number | null;
  /** Reviews whose burst weight is < 1 after ruling replay. */
  burst_downweighted_count: number;
  /** Reviews whose recency factor was raised to weight_floor (PLAN C16). */
  recency_floor_clamps: number;
  /** Reviews whose final weight product was raised to weight_floor (PLAN C16). */
  product_floor_clamps: number;
}

export interface RankWithout {
  verified: number | null;
  recency: number | null;
  burst: number | null;
}

/**
 * Shared explanation/telemetry shape for every method (CL §2.5 `parts`). Fields a method does not use are null.
 * `shrink` is B_i = v_i / (v_i + tau2): the share pulled toward the prior (PLAN C10).
 */
export interface Parts {
  raw_mean: number | null;
  n: number;
  n_eff: number;
  prior_mean: number | null;
  prior_source: PriorSource | null;
  tau2: number | null;
  sigma2: number | null;
  /** True when sigma2 came from sigma2_no_info because no item had within-item information (PLAN C2). */
  sigma2_fallback: boolean;
  shrink: number | null;
  posterior_mean: number | null;
  lo: number | null;
  hi: number | null;
  interval: IntervalMeta;
  weights: WeightSummary;
  rank_by_method: Partial<Record<MethodId, number>>;
  rank_without: RankWithout;
  flagged_spans: FlaggedSpanRef[];
  within_category_percentile: number | null;
  insufficient: boolean;
  detector_status: DetectorStatus;
}

/** One item's result for one method. `lo`/`hi` are null when the method claims no interval (PLAN C4). */
export interface RankResult {
  item_id: string;
  /** The item's category (first accepted row wins). Added in M2 so tables, filters and exports need no second lookup. */
  category: string;
  score: number;
  lo: number | null;
  hi: number | null;
  n: number;
  n_eff: number;
  parts: Parts;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration (mirrors config.default.json / config.eval.json; snake_case keys as in CL §9)
//
// A JSON import or JSON.parse yields widened types (number, string), not the literal unions below. Config objects
// are therefore validated and narrowed when loaded — by the M2 config loader, a pure type guard such as
// `validateConfig(raw: unknown): RankConfig` that rejects out-of-range or unknown values — and never cast with `as`.
// config.eval.json is layered over config.default.json; it does not repeat ranker/detector parameters.
// ---------------------------------------------------------------------------------------------------------------

export interface RankConfig {
  _provenance?: string;
  schema: 'config-1';
  // input (CL §1.1 item 1, §2.4)
  max_bytes: number;
  max_rows: number;
  max_examples_per_reason: number;
  insufficient_below: number;
  // rankers (CL §2.5)
  /**
   * Top-box cut: a rating >= wilson_threshold counts as a success for Wilson. Typed `Rating`, but the JSON value is a
   * plain `number`; the M2 config loader must check it is an integer in 1..5 before narrowing (see section note).
   */
  wilson_threshold: Rating;
  /** Two-sided level for Wilson and EB intervals; z = normalQuantile(1 - (1 - level) / 2) = 1.6448536 at 0.9. */
  interval_level: number;
  /** 'median' = median per-item review count of the fitting set; a number when frozen from dev. */
  bayes_m: number | 'median';
  min_category_items: number;
  tau2_floor: number;
  sigma2_floor: number;
  sigma2_no_info: number;
  unverified_weight: number;
  half_life_days: number;
  weight_floor: number;
  burst_weight: number;
  // detector (CL §2.6)
  burst_min_reviews: number;
  burst_min_days: number;
  windows_days: number[];
  baseline_days: number;
  min_baseline_windows: number;
  z_min: number;
  p_max: number;
  correction: 'holm';
  permutations: number;
  min_reference_reviews: number;
  max_spans_per_item: number;
  max_perm_tests: number;
  /** Base seed for per-(item, span) permutation streams, combined with seedFrom(...) context keys. */
  detector_seed: number;
  rank_key: RankKey;
}

export interface EvalPassChecks {
  a_min_paired_ci_lower: number;
  b_max_damage_ratio: number;
  c_viral_organic_unflagged: boolean;
  d_coverage_band: [number, number];
  e_max_organic_downweight_share: number;
}

export interface EvalConfig {
  _provenance?: string;
  schema: 'eval-config-1';
  split_seed: string;
  dev_share: number;
  cutoff_rule: 'elapsed_fraction';
  cutoff_fraction: number;
  min_later_reviews: number;
  cold_start_max_earlier: number;
  bootstrap_resamples: number;
  bootstrap_level: number;
  bootstrap_seed: number;
  generator_seed: number;
  generator_profile: 'demo' | 'eval';
  ndcg_k: number;
  final_refit_scope: 'all-items-pre-cutoff';
  support_gate: {
    min_items_per_category: number;
    min_target_items: number;
  };
  amazon_categories: string[];
  pass_checks: EvalPassChecks;
}
