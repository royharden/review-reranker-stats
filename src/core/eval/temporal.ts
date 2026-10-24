import { ndcgAtK } from '../ratingstats/ndcg';
import { spearman } from '../ratingstats/spearman';
import { bootstrapStatistic, pairedDifferenceBootstrap } from '../stats/bootstrap';
import type { BootstrapDraw, BootstrapResult } from '../stats/bootstrap';
import { cmp } from '../stats/hash';
import { seedFrom } from '../stats/prng';
import type { Dataset, EvalConfig, Review } from '../types';
import type { Rankings } from './scoring';
import { resultRow } from './schema';
import type { ConfidenceInterval, EvalMethod, Partition, ResultRow, SupportReport } from './schema';

export interface TemporalItem { id: string; category: string; earlier: number; later: number; target: number; laterTopBox: number }
export function temporalItems(pre: Dataset, later: readonly Review[], ids: ReadonlySet<string>, config: EvalConfig): TemporalItem[] {
  const targets = new Map<string, { n: number; sum: number; top: number }>();
  for (const r of later) {
    if (!ids.has(r.item_id)) continue;
    const t = targets.get(r.item_id) ?? { n: 0, sum: 0, top: 0 };
    t.n++; t.sum += r.rating; t.top += r.rating >= 4 ? 1 : 0; targets.set(r.item_id, t);
  }
  const out: TemporalItem[] = [];
  for (const item of pre.items.values()) {
    const t = targets.get(item.item_id);
    if (ids.has(item.item_id) && t !== undefined && t.n >= config.min_later_reviews) out.push({ id: item.item_id,
      category: item.category, earlier: item.n, later: t.n, target: t.sum / t.n, laterTopBox: t.top / t.n });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}
export function supportReport(source: Dataset, pre: Dataset, ids: ReadonlySet<string>, eligible: readonly TemporalItem[], config: EvalConfig,
  unknownCategories: readonly string[] = []): SupportReport {
  const counts = new Map<string, { category: string; partitionItems: number; eligibleItems: number }>();
  for (const item of source.items.values()) if (ids.has(item.item_id)) {
    const row = counts.get(item.category) ?? { category: item.category, partitionItems: 0, eligibleItems: 0 }; row.partitionItems++; counts.set(item.category, row);
  }
  for (const item of eligible) { const row = counts.get(item.category); if (row) row.eligibleItems++; }
  const perCategory = Array.from(counts.values()).sort((a, b) => cmp(a.category, b.category));
  const reasons: string[] = [];
  if (eligible.length < config.support_gate.min_target_items) reasons.push('Only ' + eligible.length + ' eligible targets; need ' + config.support_gate.min_target_items);
  for (const row of perCategory) if (row.partitionItems < config.support_gate.min_items_per_category) reasons.push(row.category + ': only ' + row.partitionItems + ' partition items');
  if (perCategory.length === 0) reasons.push('No categories in scoring partition');
  if (unknownCategories.length) reasons.push('No frozen dev cutoff for: ' + unknownCategories.join(', '));
  return { partitionItems: ids.size, fitItems: pre.items.size, eligibleItems: eligible.length,
    coldStartItems: eligible.filter((i) => i.earlier <= config.cold_start_max_earlier).length, perCategory, sufficient: reasons.length === 0, reasons };
}
export interface MetricItem { id: string; score: number; target: number }
/**
 * Encode UTF-16 code units at fixed width, then terminate below every hex digit. This preserves cmp's original-ID
 * order even for prefixes, whitespace, escapes and surrogate code units. The padded suffix orders occurrences
 * numerically within an original ID, without allowing an occurrence suffix to change the primary ID tie-break.
 */
function occurrenceId(id: string, occurrence: number, width: number): string {
  let encoded = '';
  for (let i = 0; i < id.length; i++) encoded += id.charCodeAt(i).toString(16).padStart(4, '0');
  return encoded + '!' + String(occurrence).padStart(width, '0');
}
/** Each duplicate draw has a distinct, order-preserving occurrence id. Arrays retain every sampled observation. */
export function resampledItems(items: readonly MetricItem[], draw: BootstrapDraw): MetricItem[] {
  const width = String(draw.indices.length).length;
  return draw.indices.map((index, position) => ({ ...items[index],
    id: occurrenceId(items[index].id, draw.occurrences[position], width) }));
}
export function metricValue(items: readonly MetricItem[], metric: 'spearman' | 'ndcg@10', k = 10): number | undefined {
  return metric === 'spearman' ? spearman(items.map((i) => i.score), items.map((i) => i.target)).value : ndcgAtK(items, k).value;
}
export function bootstrapCi(result: BootstrapResult): ConfidenceInterval | null {
  return result.ok ? { lo: result.lo, hi: result.hi, level: result.level, resamples: result.resamples, undefinedResamples: result.undefinedResamples } : null;
}
function pairedRows(eligible: readonly TemporalItem[], rankings: Rankings): Map<EvalMethod, MetricItem[]> {
  const out = new Map<EvalMethod, MetricItem[]>();
  for (const [method, ranks] of rankings) {
    const scores = new Map(ranks.map((r) => [r.item_id, r.score]));
    out.set(method, eligible.map((item) => {
      const score = scores.get(item.id); if (score === undefined) throw new Error('Missing eligible score for ' + method + ':' + item.id);
      return { id: item.id, score, target: item.target };
    }));
  }
  return out;
}
export function temporalReport(eligible: readonly TemporalItem[], rankings: Rankings, bestBaseline: 'mean' | 'bayes_global' | 'wilson',
  partition: Partition, config: EvalConfig, support: SupportReport): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const cohort of ['overall', 'cold-start'] as const) {
    const members = eligible.filter((i) => cohort === 'overall' || i.earlier <= config.cold_start_max_earlier);
    const vectors = pairedRows(members, rankings);
    const baseline = vectors.get(bestBaseline); if (baseline === undefined) throw new Error('Missing frozen baseline');
    for (const metric of ['spearman', 'ndcg@10'] as const) {
      // Same seed/n implies the same shared item-index draws for every comparison in this cohort.
      const options = { resamples: config.bootstrap_resamples, level: config.bootstrap_level,
        seed: seedFrom(config.bootstrap_seed, partition, cohort, metric) };
      for (const [method, items] of vectors) {
        const statistic = (draw: BootstrapDraw) => metricValue(resampledItems(items, draw), metric, config.ndcg_k);
        const baselineStat = (draw: BootstrapDraw) => metricValue(resampledItems(baseline, draw), metric, config.ndcg_k);
        const value = metricValue(items, metric, config.ndcg_k);
        const boot = bootstrapStatistic(items.length, statistic, options);
        const paired = pairedDifferenceBootstrap(items.length, statistic, baselineStat, options);
        const base = metricValue(baseline, metric, config.ndcg_k);
        const insufficient = !support.sufficient || (cohort === 'cold-start' && members.length < 20);
        const extra = { cohort, status: insufficient ? 'insufficient support' as const : value === undefined ? 'not assessable' as const : 'measured' as const,
          reason: insufficient ? (cohort === 'cold-start' && members.length < 20 ? 'Cold-start cohort underpowered (<20 items).' : support.reasons.join('; ')) : value === undefined ? 'Undefined metric (constant scores/targets, no items, or zero ideal gain).' : null };
        rows.push(resultRow(partition, method, metric, value ?? null, items.length, 'eligible paired items', { ...extra, ci: value === undefined ? null : bootstrapCi(boot) }));
        const difference = value === undefined || base === undefined ? null : value - base;
        rows.push(resultRow(partition, method, metric === 'spearman' ? 'paired-spearman' : 'paired-ndcg@10', difference,
          items.length, 'same item draws: method minus frozen ' + bestBaseline, { ...extra,
            status: insufficient ? 'insufficient support' : difference === null ? 'not assessable' : 'measured',
            reason: insufficient ? extra.reason : difference === null ? 'Paired statistic undefined.' : null,
            ci: difference === null ? null : bootstrapCi(paired) }));
      }
    }
  }
  return rows;
}
