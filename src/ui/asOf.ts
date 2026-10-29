// asOf field helpers (PLAN C14): the upload form's asOf is prefilled with TODAY, read once at the UI boundary (the
// caller passes `new Date()`; core never reads a clock). The field is a UTC calendar date; asOf is the last
// millisecond of that UTC day, so reviews from earlier the same day are never "future".

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD of `now` in UTC. */
export function utcDateValue(now: Date): string {
  const y = String(now.getUTCFullYear()).padStart(4, '0');
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** End of the given UTC day in epoch ms, or null for an invalid/impossible date. */
export function asOfFromDateValue(value: string): number | null {
  const m = DATE_RE.exec(value);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const start = Date.UTC(y, mo - 1, d);
  const check = new Date(start);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return start + DAY_MS - 1;
}

/** Human-readable UTC rendering of an asOf value (ISO 8601 with Z). */
export function formatAsOf(asOf: number): string {
  return new Date(asOf).toISOString();
}
