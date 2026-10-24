// Ranker interface (CL §2.5; PLAN M2 acceptance 6, C4).
//
// Every method — baselines, EB variants, `full` and its ablations — implements Ranker and returns one RankResult per
// item, already sorted in the canonical rank order (score desc, item_id asc by code unit). Rankers are pure: the
// same (dataset, config, ctx) always gives the same output, and no ranker ever drops a review.

import type { Dataset, DetectorStatus, FlaggedSpanRef, IntervalMeta, MethodId, RankConfig, RankResult } from '../types';

/**
 * Inputs a ranker may need beyond the dataset and config. Filled in by later milestones (M3 detector, M4 rulings);
 * a ranker that does not use a field ignores it.
 */
export interface RankContext {
  /**
   * Burst weight per review, indexed like Dataset.reviews, after ruling replay (1 = not down-weighted). null when the
   * detector has not run; then every burst weight is 1.
   */
  reviewBurstWeight: readonly number[] | null;
  /** Detector status per item_id; null when the detector has not run ('not-run' everywhere). */
  itemDetectorStatus: ReadonlyMap<string, DetectorStatus> | null;
  /** Flagged span references after ruling replay; optional for direct baseline callers. */
  itemFlaggedSpans?: ReadonlyMap<string, readonly FlaggedSpanRef[]> | null;
}

export function emptyRankContext(): RankContext {
  return { reviewBurstWeight: null, itemDetectorStatus: null };
}

export interface Ranker {
  id: MethodId;
  /** Short human label for tables and exports. */
  label: string;
  /** Default interval metadata. Result parts.interval is authoritative for the configured level and UI axis. */
  interval: IntervalMeta;
  rank(dataset: Dataset, config: RankConfig, ctx: RankContext): RankResult[];
}
