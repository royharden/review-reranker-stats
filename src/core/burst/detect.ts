// Three-pass sparse detector. The accepted corpus is unchanged in every pass, including flagged reviews.
import { canonicalJson, sha256Hex } from '../stats/hash';
import { mean } from '../stats/weighted';
import type { Dataset, DetectorStatus, FlaggedSpanRef, RankConfig } from '../types';
import type { RankContext } from '../rankers/types';
import { burstWeightsForSpans } from '../rankers/weights';
import { DAY_MS, dailyCounts, reviewsInDays } from './dailyCounts';
import { holm, permutationShift } from './permutation';
import { scanVolume } from './robustZ';
import { mergeWindows, spanPriority } from './spans';
import type { BurstSpan, DetectionResult, ItemDetection } from './types';

/** asOf participates because it changes history eligibility; ranking-only parameters never invalidate rulings. */
export function detectorConfigHash(config: RankConfig, asOf: number): Promise<string> {
  return sha256Hex(canonicalJson({ schema: 'detector-config-1', asOf, burst_min_reviews: config.burst_min_reviews,
    burst_min_days: config.burst_min_days, windows_days: config.windows_days, baseline_days: config.baseline_days,
    min_baseline_windows: config.min_baseline_windows, z_min: config.z_min, p_max: config.p_max, correction: config.correction,
    permutations: config.permutations, min_reference_reviews: config.min_reference_reviews,
    max_spans_per_item: config.max_spans_per_item, max_perm_tests: config.max_perm_tests, detector_seed: config.detector_seed }));
}

export async function detectBursts(dataset: Dataset, config: RankConfig): Promise<DetectionResult> {
  const items: ItemDetection[] = [];
  const all: BurstSpan[] = [];
  const diagnostics = { candidateDays: 0, baselineWindowsEvaluated: 0 };
  const asOfDay = Math.floor(dataset.asOf / DAY_MS);
  for (const item of dataset.items.values()) {
    const result: ItemDetection = { itemId: item.item_id, status: 'assessed', reasons: [], candidateWindowCount: 0,
      assessableWindowCount: 0, unassessableWindowCount: 0, spanCount: 0, testedSpanCount: 0 };
    if (item.n < config.burst_min_reviews) result.reasons.push('too-few-reviews');
    if (asOfDay - Math.floor(item.firstTs / DAY_MS) < config.burst_min_days) result.reasons.push('too-young');
    if (result.reasons.length > 0) { result.status = 'unassessable'; items.push(result); continue; }
    const series = dailyCounts(dataset, item);
    diagnostics.candidateDays += series.days.length;
    const volume = scanVolume(item.item_id, series, config);
    diagnostics.baselineWindowsEvaluated += volume.baselineWindowsEvaluated;
    result.candidateWindowCount = volume.candidates.length;
    result.assessableWindowCount = volume.assessable;
    result.unassessableWindowCount = volume.unassessable;
    if (volume.assessable === 0) { result.status = 'unassessable'; result.reasons.push('insufficient-baseline-history'); }
    const spans = mergeWindows(volume.candidates);
    result.spanCount = spans.length;
    spans.forEach((span, i) => { if (i >= config.max_spans_per_item) span.reason = 'item-cap'; });
    all.push(...spans);
    items.push(result);
  }
  all.sort(spanPriority);
  const selected: BurstSpan[] = [];
  for (const span of all) {
    if (span.reason === 'item-cap') continue;
    if (selected.length < config.max_perm_tests) selected.push(span); else span.reason = 'dataset-cap';
  }
  const itemResults = new Map(items.map((item) => [item.itemId, item]));
  let testedSpanCount = 0;
  for (const span of all) {
    const item = dataset.items.get(span.itemId);
    if (!item) throw new Error('Span has no dataset item');
    const inside = reviewsInDays(dataset, item, span.spanStart, span.spanEnd);
    const reference = reviewsInDays(dataset, item, span.spanStart - config.baseline_days, span.spanStart - 1);
    span.inSpanCount = inside.length; span.referenceCount = reference.length;
    span.meanInSpan = mean(inside.map((r) => r.rating)) ?? null;
    span.meanReference = mean(reference.map((r) => r.rating)) ?? null;
    span.shift = span.meanInSpan !== null && span.meanReference !== null ? span.meanInSpan - span.meanReference : null;
    const known = inside.filter((r) => r.verified !== null);
    span.verifiedShare = known.length > 0 ? known.filter((r) => r.verified === true).length / known.length : null;
    const itemResult = itemResults.get(span.itemId);
    if (!itemResult) throw new Error('Span has no detector item');
    if (span.reason === 'item-cap' || span.reason === 'dataset-cap') {
      itemResult.status = 'partial';
      if (!itemResult.reasons.includes(span.reason)) itemResult.reasons.push(span.reason);
      continue;
    }
    if (reference.length < config.min_reference_reviews) {
      span.status = 'unassessable'; span.reason = 'thin-reference';
      if (!itemResult.reasons.includes('thin-reference')) itemResult.reasons.push('thin-reference');
      continue;
    }
    const test = permutationShift(inside.map((r) => r.rating), reference.map((r) => r.rating), config.permutations,
      config.detector_seed, span.itemId, span.spanStart, span.spanEnd);
    span.pValue = test.pValue;
    span.status = 'volume-only';
    testedSpanCount++; itemResult.testedSpanCount++;
  }
  // Family = selected merged spans per item. A thin-reference span retains a slot as p = 1.
  const families = new Map<string, BurstSpan[]>();
  for (const span of selected) {
    const family = families.get(span.itemId);
    if (family) family.push(span); else families.set(span.itemId, [span]);
  }
  for (const family of families.values()) {
    const corrected = holm(family.map((span) => span.pValue), config.p_max);
    family.forEach((span, i) => {
      span.holmThreshold = corrected[i].threshold;
      if (corrected[i].rejected) span.status = 'flagged';
    });
  }
  for (const item of items) {
    if (item.status === 'assessed' && item.spanCount > 0 && item.testedSpanCount === 0) item.status = 'unassessable';
  }
  const status: DetectorStatus = items.some((item) => item.status === 'partial') ? 'partial'
    : items.length > 0 && items.every((item) => item.status === 'unassessable') ? 'unassessable' : 'assessed';
  return { schema: 'bursts-1', datasetHash: dataset.datasetHash, detectorConfigHash: await detectorConfigHash(config, dataset.asOf),
    status, items, spans: all, testedSpanCount, diagnostics };
}

/** Default unreviewed context. M4 may rebuild the same context with restored/confirmed span weights. */
export function contextFromDetection(dataset: Dataset, detection: DetectionResult, config: RankConfig): RankContext {
  const flagged = detection.spans.filter((span) => span.status === 'flagged');
  const refs = new Map<string, FlaggedSpanRef[]>();
  for (const span of flagged) {
    const list = refs.get(span.itemId) ?? [];
    list.push({ span_start: span.spanStart, span_end: span.spanEnd, label: 'unreviewed', weight: config.burst_weight });
    refs.set(span.itemId, list);
  }
  return {
    reviewBurstWeight: burstWeightsForSpans(dataset, flagged.map((span) => ({ ...span, weight: config.burst_weight }))),
    itemDetectorStatus: new Map(detection.items.map((item) => [item.itemId, item.status])),
    itemFlaggedSpans: refs,
  };
}
