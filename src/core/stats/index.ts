// Generic, DOM-free statistics core (CL §2.2, F13: shared core; ratingstats is the thin rating-specific layer).
export { erf, erfc, normalCdf, normalQuantile, twoSidedZ } from './quantile';
export { wilsonInterval, wilsonLower } from './wilson';
export type { WilsonInterval } from './wilson';
export { mulberry32, seedFrom, rngFrom, randInt, shuffleInPlace } from './prng';
export type { Rng } from './prng';
export { fnv1a32, fnv1a32Hex, sha256Hex, utf8, cmp, cmpNum, canonicalJson } from './hash';
export {
  occurrenceIndices,
  drawWithReplacement,
  identityDraw,
  quantileSorted,
  bootstrapStatistic,
  pairedDifferenceBootstrap,
  pairedMeanDifference,
} from './bootstrap';
export type { BootstrapDraw, DrawStatistic, BootstrapOptions, BootstrapResult } from './bootstrap';
export { weightSums, nEff, weightedMean, weightedSummary, mean } from './weighted';
export type { WeightSums, WeightedSummary } from './weighted';
export { MAD_TO_SD, median, mad, robustScale, robustZ } from './robust';
