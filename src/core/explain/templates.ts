import type { Parts } from '../types';
import { fmt } from './fmt';
import { grounded } from './grounded';

/** No review text or user-provided labels are interpolated into this numeric explanation. */
export function explain(parts: Parts): string {
  const sentences = [`Raw mean ${fmt('raw_mean', parts.raw_mean)} stars from ${fmt('n', parts.n)} reviews; effective count ${fmt('n_eff', parts.n_eff)}.`];
  if (parts.posterior_mean !== null) sentences.push(`Estimated mean ${fmt('posterior_mean', parts.posterior_mean)} stars.`);
  if (parts.prior_mean !== null) sentences.push(`Prior mean ${fmt('prior_mean', parts.prior_mean)} stars (${parts.prior_source ?? 'global'}); share pulled toward the prior ${fmt('shrink', parts.shrink)}.`);
  if (parts.lo !== null && parts.hi !== null) sentences.push(`Two-sided interval for ${parts.interval.quantity}: ${fmt('lo', parts.lo)} to ${fmt('hi', parts.hi)} at level ${fmt('interval.level', parts.interval.level)}.`);
  if (parts.sigma2_fallback) sentences.push('Within-item variance uses the no-information fallback.');
  sentences.push(`Burst-downweighted reviews: ${fmt('weights.burst_downweighted_count', parts.weights.burst_downweighted_count)}. Detector: ${parts.detector_status}.`);
  if (parts.insufficient) sentences.push('Insufficient review support; this item is retained in the ranking.');
  const text = sentences.join(' ');
  if (!grounded(text, parts)) throw new Error('Explanation failed numeric grounding');
  return text;
}
