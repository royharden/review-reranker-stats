import type { Parts } from '../types';
import { fmt } from './fmt';

/** Collect only factual numeric parts. Labels, dates, identifiers and external text never enter templates. */
export function formattedParts(parts: Parts): Set<string> {
  const tokens = new Set<string>();
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number' && Number.isFinite(value)) tokens.add(fmt(path, value));
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}.${i}`));
    else if (typeof value === 'object' && value !== null) Object.entries(value).forEach(([key, v]) => walk(v, path ? `${path}.${key}` : key));
  };
  walk(parts, ''); return tokens;
}
/** Formatted-to-formatted comparison; no floating-point string is compared to an unrounded value. */
export function grounded(text: string, parts: Parts): boolean {
  const allowed = formattedParts(parts);
  return (text.match(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).every((token) => allowed.has(token));
}
