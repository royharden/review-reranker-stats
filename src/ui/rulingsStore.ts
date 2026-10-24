import { exportJsonl, importJsonl } from '../core/rulings/rulings';
import type { Ruling } from '../core/rulings/rulings';
import type { SafeStorage } from './storage';

export function loadRulings(storage: SafeStorage, datasetHash: string): { log: Ruling[]; error: string | null } {
  const raw = storage.get(`rulings:${datasetHash}`);
  if (raw === null) return { log: [], error: null };
  try { return { log: importJsonl(raw), error: null }; }
  catch (error) { return { log: [], error: `Stored ruling log is invalid and was not applied: ${error instanceof Error ? error.message : String(error)}` }; }
}
export function saveRulings(storage: SafeStorage, datasetHash: string, log: readonly Ruling[]): boolean {
  return storage.set(`rulings:${datasetHash}`, exportJsonl(log));
}
