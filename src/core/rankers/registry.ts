// Ranker registry (PLAN M2 acceptance 6). M2 registers `mean`; M3 adds bayes_global, wilson, eb_category, eb_global,
// full and the full-minus-one ablations. Listing order is the fixed display order below, never insertion order.

import type { MethodId } from '../types';
import { meanRanker } from './mean';
import type { Ranker } from './types';

/** Display order for every method id (registered or not yet built). */
export const METHOD_ORDER: readonly MethodId[] = [
  'mean',
  'bayes_global',
  'wilson',
  'eb_category',
  'eb_global',
  'full',
  'full-verified',
  'full-recency',
  'full-burst',
];

const REGISTRY: ReadonlyMap<MethodId, Ranker> = new Map<MethodId, Ranker>([[meanRanker.id, meanRanker]]);

export function getRanker(id: MethodId): Ranker | undefined {
  return REGISTRY.get(id);
}

/** Registered rankers in METHOD_ORDER. */
export function registeredRankers(): Ranker[] {
  const out: Ranker[] = [];
  for (const id of METHOD_ORDER) {
    const r = REGISTRY.get(id);
    if (r) out.push(r);
  }
  return out;
}

export function isRegisteredMethod(id: string): id is MethodId {
  for (const m of METHOD_ORDER) if (m === id) return REGISTRY.has(m);
  return false;
}
