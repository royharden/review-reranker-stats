import { fitBayesGlobal } from '../rankers/bayesGlobal';
import type { EvalConfig, RankConfig, RankKey } from '../types';
import { validateEvalConfig } from './config';
import { chooseCutoffs, splitTime, splitIdentity } from './split';
import type { Cutoffs, DevData } from './split';
import { scoreCatalogue } from './scoring';
import type { ScoredCatalogue } from './scoring';
import { metricValue, temporalItems } from './temporal';
import type { EvalMethod } from './schema';

export type BaselineId = 'mean' | 'bayes_global' | 'wilson';
export const BASELINE_TIE_ORDER: readonly BaselineId[] = ['mean', 'bayes_global', 'wilson'];
export interface SelectionScore { method: EvalMethod; spearman: number | null; eligibleItems: number }
export interface TuneResult {
  dev: DevData; cutoffs: Cutoffs; splitHash: string; config: RankConfig & { bayes_m: number };
  bestBaseline: BaselineId; baselineScores: SelectionScore[]; keyScores: SelectionScore[]; scored: ScoredCatalogue;
}
/** No storage parameter, loader import, or held-out payload exists in this API. */
export async function tuneDevelopment(options: { dev: DevData; rank: RankConfig; protocol: EvalConfig }): Promise<TuneResult> {
  const { dev, rank } = options;
  const protocol = validateEvalConfig(options.protocol);
  if (rank.interval_level !== 0.9) throw new Error('Evaluation requires two-sided 90% rank intervals');
  if (dev.kind !== 'dev-only-1') throw new Error('Tuning requires DevData');
  const cutoffs = chooseCutoffs(dev, protocol);
  const { pre, later } = await splitTime(dev.dataset, cutoffs, rank);
  const m = fitBayesGlobal(pre, rank).m;
  if (m === null || !Number.isFinite(m) || m <= 0) throw new Error('No positive dev pre-cutoff bayes m to freeze');
  const config = { ...rank, bayes_m: m };
  const first = await scoreCatalogue(pre, config, cutoffs);
  const eligible = temporalItems(pre, later, new Set(dev.dataset.items.keys()), protocol);
  const metric = (method: EvalMethod): SelectionScore => {
    const scores = new Map((first.rankings.get(method) ?? []).map((r) => [r.item_id, r.score]));
    const items = eligible.map((i) => ({ id: i.id, score: scores.get(i.id) ?? Number.NaN, target: i.target }));
    return { method, spearman: metricValue(items, 'spearman') ?? null, eligibleItems: items.length };
  };
  const baselineScores = BASELINE_TIE_ORDER.map(metric);
  let bestBaseline: BaselineId = 'mean'; let best = -Infinity;
  for (const id of BASELINE_TIE_ORDER) {
    const score = baselineScores.find((s) => s.method === id)?.spearman;
    if (score !== undefined && score !== null && score > best) { best = score; bestBaseline = id; }
  }
  const keyScores = [metric('full:posterior_mean'), metric('full:lower_endpoint')];
  const posterior = keyScores[0].spearman; const lower = keyScores[1].spearman;
  const key: RankKey = lower !== null && (posterior === null || lower > posterior) ? 'lower_endpoint' : 'posterior_mean';
  const selected = { ...config, rank_key: key };
  // The selected full row and its prior snapshot must match the frozen rank key, not the proposal key.
  const scored = key === config.rank_key ? first : await scoreCatalogue(pre, selected, cutoffs);
  return { dev, cutoffs, splitHash: await splitIdentity(dev, protocol, cutoffs), config: selected,
    bestBaseline, baselineScores, keyScores, scored };
}
