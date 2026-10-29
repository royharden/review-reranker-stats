// Rating-specific metric layer over src/core/stats (CL §2.2, F13).
export { midranks, spearman } from './spearman';
export type { SpearmanResult, SpearmanUndefinedReason } from './spearman';
export { dcg, ndcgAtK, starGain } from './ndcg';
export type { NdcgItem, NdcgResult, NdcgUndefinedReason, GainFn } from './ndcg';
export { rankOrderCompare, ranksByScore, rankPercentile, percentilesByScore, withinCategoryPercentiles } from './percentile';
export type { ScoredItem, CategorizedScoredItem } from './percentile';
