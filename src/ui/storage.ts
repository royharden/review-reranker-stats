// Safe key-value storage (CL §2.7 store; PLAN M4 extends it for rulings). Every backend call is wrapped in
// try/catch: in private mode, with blocked site data or over quota, values fall back to an in-memory map for this
// session and `warning` explains that nothing will persist. Only compact app data is ever stored here — never CSV
// rows or review text.

export type StorageBackend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SafeStorage {
  get(key: string): string | null;
  /** Returns true when the value reached persistent storage, false when it is held in memory only. */
  set(key: string, value: string): boolean;
  remove(key: string): void;
  /** Null while persistence works; a user-facing message once it has failed (or was never available). */
  readonly warning: string | null;
}

const UNAVAILABLE = 'Browser storage is unavailable (private mode, blocked site data or full quota). Changes are kept in memory for this session only — download them to keep them.';

/** The page's localStorage, or null when even touching it throws. */
export function browserStorageBackend(): StorageBackend | null {
  try {
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function createSafeStorage(backend: StorageBackend | null): SafeStorage {
  const memory = new Map<string, string>();
  let warning: string | null = backend === null ? UNAVAILABLE : null;

  return {
    get(key) {
      if (memory.has(key)) return memory.get(key) ?? null;
      if (backend === null || warning !== null) return null;
      try {
        return backend.getItem(key);
      } catch {
        warning = UNAVAILABLE;
        return null;
      }
    },
    set(key, value) {
      if (backend !== null && warning === null) {
        try {
          backend.setItem(key, value);
          memory.delete(key);
          return true;
        } catch {
          warning = UNAVAILABLE;
        }
      }
      memory.set(key, value);
      return false;
    },
    remove(key) {
      memory.delete(key);
      if (backend === null || warning !== null) return;
      try {
        backend.removeItem(key);
      } catch {
        warning = UNAVAILABLE;
      }
    },
    get warning() {
      return warning;
    },
  };
}
