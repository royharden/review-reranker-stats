import type { DetectionResult } from '../burst/types';
import { midranks } from '../ratingstats/spearman';
import { median } from '../stats/robust';
import type { Dataset } from '../types';
import type { ScoredCatalogue, Rankings } from './scoring';
import { ATTACK_TYPES } from './plantBursts';
import type { AttackLabel, AttackTruth } from './plantBursts';
import { resultRow } from './schema';
import type { CheckResult, EvalMethod, NamedFailures, Partition, PriorDrift, ResultRow } from './schema';

const DAY = 86_400_000;
/** q uses score midranks, so an item-id display tie-break cannot invent attack movement. */
export function rankQualities(rankings: Rankings): Map<EvalMethod, Map<string, number>> {
  const out = new Map<EvalMethod, Map<string, number>>();
  for (const [method, rows] of rankings) {
    const ranks = midranks(rows.map((r) => r.score));
    out.set(method, new Map(rows.map((r, i) => [r.item_id, rows.length < 2 ? 0.5 : (ranks[i] - 1) / (rows.length - 1)])));
  }
  return out;
}
export function directedDamage(cleanQ: number, attackedQ: number, direction: 'promo' | 'bomb'): { signedLift: number; damage: number } {
  const signedLift = attackedQ - cleanQ; return { signedLift, damage: direction === 'bomb' ? -signedLift : signedLift };
}
export function damageCheck(full: number | null, baseline: number | null, ratio: number): CheckResult['status'] {
  return full === null || baseline === null || baseline <= 0 ? 'not assessable' : full <= ratio * baseline ? 'met' : 'not met';
}
export function flaggedReviewIds(dataset: Dataset, detection: DetectionResult): Set<string> {
  const ids = new Set<string>();
  for (const span of detection.spans) if (span.status === 'flagged') {
    const item = dataset.items.get(span.itemId); if (!item) continue;
    for (const i of item.reviewIdx) { const r = dataset.reviews[i]; const d = Math.floor(r.ts / DAY);
      if (d >= span.spanStart && d <= span.spanEnd) ids.add(r.review_id); }
  }
  return ids;
}
function sameUniverse(clean: Rankings, attacked: Rankings): void {
  for (const [method, rows] of clean) {
    const other = attacked.get(method); const ids = new Set(other?.map((r) => r.item_id));
    if (other === undefined || rows.length !== other.length || rows.some((r) => !ids.has(r.item_id))) throw new Error('Clean/attacked item universe differs');
  }
}
export function priorDrift(clean: ScoredCatalogue, attacked: ScoredCatalogue, labels: readonly AttackLabel[]): PriorDrift[] {
  const categories = new Set(labels.map((a) => a.category)); const out: PriorDrift[] = [];
  for (const m of clean.priors.methods) for (const c of m.categories) if (categories.has(c.category)) {
    const a = attacked.priors.methods.find((x) => x.method === m.method)?.categories.find((x) => x.category === c.category);
    if (a) out.push({ method: m.method, category: c.category, cleanMean: c.mean, attackedMean: a.mean, meanDelta: a.mean - c.mean,
      cleanTau2: c.tau2, attackedTau2: a.tau2, tau2Delta: a.tau2 - c.tau2, cleanSource: c.source, attackedSource: a.source });
  }
  return out;
}
export interface RobustnessReport {
  rows: ResultRow[]; check: CheckResult; evaded: NamedFailures['evadedAttacks']; flaggedOrganic: NamedFailures['flaggedOrganic'];
  drift: PriorDrift[];
}
export function robustnessReport(cleanRanks: Rankings, attackedRanks: Rankings, attacked: Dataset, detected: DetectionResult,
  truth: AttackTruth, partition: Partition, ratio: number, scoringIds: ReadonlySet<string>): RobustnessReport {
  sameUniverse(cleanRanks, attackedRanks);
  const cleanQ = rankQualities(cleanRanks); const attackedQ = rankQualities(attackedRanks);
  const rows: ResultRow[] = []; const states: Array<{ attack: string; status: CheckResult['status'] }> = [];
  const injected = new Set(truth.attacks.flatMap((a) => a.reviewIds)); const flagged = flaggedReviewIds(attacked, detected);
  // Detector statistics use the scoring partition only; dev reviews included solely for final prior fitting cannot dilute denominators.
  const scoredReviews = attacked.reviews.filter((r) => scoringIds.has(r.item_id));
  const scoredFlagged = scoredReviews.filter((r) => flagged.has(r.review_id));
  const truePositive = scoredFlagged.filter((r) => injected.has(r.review_id)).length;
  const injectedCount = scoredReviews.filter((r) => injected.has(r.review_id)).length;
  const organic = scoredReviews.filter((r) => !injected.has(r.review_id));
  const organicFlagged = organic.filter((r) => flagged.has(r.review_id)).length;
  const shared = [
    resultRow(partition, 'full', 'detector-precision', scoredFlagged.length ? truePositive / scoredFlagged.length : null, scoredFlagged.length, 'flagged review ids (unique; scoring partition only)'),
    resultRow(partition, 'full', 'detector-recall', injectedCount ? truePositive / injectedCount : null, injectedCount, 'all injected review ids (scoring partition only)'),
    resultRow(partition, 'full', 'organic-downweight-share', organic.length ? organicFlagged / organic.length : null, organic.length, 'all original organic reviews (scoring partition only)'),
  ]; rows.push(...shared);
  for (const attack of ATTACK_TYPES) {
    const labels = truth.attacks.filter((a) => a.attack === attack && scoringIds.has(a.itemId));
    const medians = new Map<EvalMethod, number | null>();
    for (const [method, cleanScores] of cleanQ) {
      const attackedScores = attackedQ.get(method); if (!attackedScores) throw new Error('Missing attacked method');
      const moves = labels.map((a) => {
        const before = cleanScores.get(a.itemId); const after = attackedScores.get(a.itemId);
        if (before === undefined || after === undefined) throw new Error('Attack target outside eligible universe');
        return { ...directedDamage(before, after, a.direction), entry: before < 0.9 && after >= 0.9, exit: before >= 0.9 && after < 0.9 };
      });
      const damage = median(moves.map((m) => m.damage)) ?? null; medians.set(method, damage);
      rows.push(resultRow(partition, method, 'signed-lift', median(moves.map((m) => m.signedLift)) ?? null, moves.length, 'median over attack target items; q_attacked - q_clean', { attack }));
      rows.push(resultRow(partition, method, 'damage', damage, moves.length, 'median over attack target items; bombing sign reversed', { attack }));
      const exit = attack === 'bomb';
      rows.push(resultRow(partition, method, exit ? 'top-10%-exits' : 'top-10%-entries', moves.length ? moves.filter((m) => exit ? m.exit : m.entry).length / moves.length : null,
        moves.length, 'share of attack target items crossing the score-midrank top-decile boundary', { attack }));
    }
    states.push({ attack, status: damageCheck(medians.get('full') ?? null, medians.get('bayes_global') ?? null, ratio) });
  }
  const check: CheckResult = { id: 'b', status: states.some((s) => s.status === 'not met') ? 'not met'
    : states.every((s) => s.status === 'met') ? 'met' : 'not assessable',
    reason: states.map((s) => s.attack + ': ' + s.status).join('; ') + '. Baseline median damage <= 0 or no attack targets is never a pass.' };
  const evaded = truth.attacks.filter((a) => scoringIds.has(a.itemId) && a.reviewIds.some((id) => !flagged.has(id)))
    .map((a) => ({ attack: a.attack, itemId: a.itemId, start: a.start, end: a.end, injectedReviews: a.reviewIds.length,
      flaggedReviews: a.reviewIds.filter((id) => flagged.has(id)).length }));
  const flaggedOrganic = detected.spans.filter((s) => s.status === 'flagged' && scoringIds.has(s.itemId)).flatMap((s) => {
    const n = organic.filter((r) => r.item_id === s.itemId && Math.floor(r.ts / DAY) >= s.spanStart && Math.floor(r.ts / DAY) <= s.spanEnd).length;
    return n ? [{ itemId: s.itemId, start: s.spanStart, end: s.spanEnd, organicReviews: n }] : [];
  });
  return { rows, check, evaded, flaggedOrganic, drift: [] };
}
