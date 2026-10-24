// Robust location/scale (CL §2.6 pass 1): median, MAD (unscaled), and the detector's robust scale
//   scale = max(1, 1.4826 * MAD, sqrt(median))
// which stays >= 1 when MAD = 0 (fixes the spec's sqrt(0) case for sparse_mad_zero).

import { cmpNum } from './hash';

/** Consistency constant making MAD estimate the standard deviation under normality. */
export const MAD_TO_SD = 1.4826;

/** Median (mean of the two middle values for even n); undefined for an empty input. Does not mutate its input. */
export function median(values: readonly number[]): number | undefined {
  const n = values.length;
  if (n === 0) return undefined;
  const sorted = values.slice().sort(cmpNum);
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median absolute deviation from the median (unscaled); undefined for an empty input. */
export function mad(values: readonly number[]): number | undefined {
  const m = median(values);
  if (m === undefined) return undefined;
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Detector robust scale max(1, 1.4826 * MAD, sqrt(median)) over the baseline counts; undefined for an empty
 * input. A negative median (not possible for counts) contributes sqrt(0).
 */
export function robustScale(values: readonly number[]): number | undefined {
  const m = median(values);
  const d = mad(values);
  if (m === undefined || d === undefined) return undefined;
  return Math.max(1, MAD_TO_SD * d, Math.sqrt(Math.max(0, m)));
}

/** Robust z = (x - median(baseline)) / robustScale(baseline); undefined for an empty baseline. Always finite. */
export function robustZ(x: number, baseline: readonly number[]): number | undefined {
  const m = median(baseline);
  const s = robustScale(baseline);
  if (m === undefined || s === undefined) return undefined;
  return (x - m) / s;
}
