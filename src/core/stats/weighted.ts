// Reliability-weight summaries (CL §2.5 notation): for weights w_j and values x_j
//   S1 = sum w_j,  S2 = sum w_j^2,  n_eff = S1^2 / S2 (Kish),  mean = sum w_j x_j / S1,
//   SS = sum w_j (x_j - mean)^2 (residual sum of squares),  d = S1 - S2 / S1 (= n - 1 when all w_j = 1).
// Pooled within-item variance in EB is sum_i SS_i / sum_i d_i.

export interface WeightSums {
  s1: number;
  s2: number;
}

export interface WeightedSummary {
  s1: number;
  s2: number;
  /** Kish effective sample size S1^2 / S2; 0 for an empty input. */
  n_eff: number;
  /** Weighted mean; undefined for an empty input. */
  mean: number | undefined;
  /** Weighted residual sum of squares around the weighted mean; 0 for an empty input. */
  ss: number;
  /** Reliability-weight degrees of freedom S1 - S2/S1; 0 for an empty input. */
  d: number;
}

function checkWeights(w: readonly number[]): void {
  for (let j = 0; j < w.length; j++) {
    const v = w[j];
    if (!(Number.isFinite(v) && v > 0)) {
      throw new RangeError(`weights must be finite and > 0 (no review may reach weight 0); index ${j} = ${v}`);
    }
  }
}

/** S1 and S2. Weights must be finite and > 0. */
export function weightSums(w: readonly number[]): WeightSums {
  checkWeights(w);
  let s1 = 0;
  let s2 = 0;
  for (const v of w) {
    s1 += v;
    s2 += v * v;
  }
  return { s1, s2 };
}

/** Kish effective sample size; 0 for an empty input. */
export function nEff(w: readonly number[]): number {
  const { s1, s2 } = weightSums(w);
  return s2 === 0 ? 0 : (s1 * s1) / s2;
}

/** Weighted mean; undefined for an empty input. */
export function weightedMean(x: readonly number[], w: readonly number[]): number | undefined {
  return weightedSummary(x, w).mean;
}

/** Full summary in one pass over the inputs (two passes for SS). */
export function weightedSummary(x: readonly number[], w: readonly number[]): WeightedSummary {
  if (x.length !== w.length) throw new RangeError(`weightedSummary: length mismatch (${x.length} vs ${w.length})`);
  for (let j = 0; j < x.length; j++) {
    if (!Number.isFinite(x[j])) throw new RangeError(`weightedSummary: non-finite value at index ${j}`);
  }
  const { s1, s2 } = weightSums(w);
  if (x.length === 0) return { s1: 0, s2: 0, n_eff: 0, mean: undefined, ss: 0, d: 0 };
  let sx = 0;
  for (let j = 0; j < x.length; j++) sx += w[j] * x[j];
  const mean = sx / s1;
  let ss = 0;
  for (let j = 0; j < x.length; j++) {
    const r = x[j] - mean;
    ss += w[j] * r * r;
  }
  return { s1, s2, n_eff: (s1 * s1) / s2, mean, ss, d: s1 - s2 / s1 };
}

/** Unweighted arithmetic mean; undefined for an empty input. */
export function mean(x: readonly number[]): number | undefined {
  if (x.length === 0) return undefined;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}
