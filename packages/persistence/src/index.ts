/** Thrown for any storage problem; `message` is safe to show to the player. */
export class SaveError extends Error {}

export interface SaveEnvelope<T> {
  format: string;
  version: number;
  savedAt: number;
  data: T;
}

export type Migration = (data: unknown) => unknown;

/**
 * Validates an envelope and upgrades old payloads step by step.
 * `migrations[n]` converts a version-n payload to version n+1.
 */
export function openEnvelope<T>(raw: unknown, format: string, current: number, migrations: Record<number, Migration> = {}): T {
  if (!raw || typeof raw !== 'object') throw new SaveError('Save data is empty or unreadable.');
  const env = raw as Partial<SaveEnvelope<unknown>>;
  if (env.format !== format || typeof env.version !== 'number') throw new SaveError('This is not an Untamed Earth save.');
  if (env.version > current) throw new SaveError(`Save was written by a newer version (v${env.version}); this build reads up to v${current}.`);
  let data = env.data;
  for (let v = env.version; v < current; v++) {
    const m = migrations[v];
    if (!m) throw new SaveError(`No migration path from save version ${v}.`);
    data = m(data);
  }
  return data as T;
}

export function sealEnvelope<T>(data: T, format: string, version: number, now: number): SaveEnvelope<T> {
  return { format, version, savedAt: now, data };
}

/** Promise wrapper over a single IndexedDB object store. Values are structured-cloned (typed arrays included). */
export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly name = 'untamed-earth', private readonly store = 'saves') {}

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new SaveError('This browser has no IndexedDB, so progress cannot be saved.'));
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(this.name, 1);
      } catch {
        return reject(new SaveError('Storage is blocked (private browsing or site permissions).'));
      }
      req.onupgradeneeded = () => req.result.createObjectStore(this.store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new SaveError(`Storage could not be opened: ${req.error?.message ?? 'unknown error'}.`));
      req.onblocked = () => reject(new SaveError('Storage is locked by another tab.'));
    });
    this.db.catch(() => (this.db = null));
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.store, mode);
      const req = fn(tx.objectStore(this.store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => {
        const quota = tx.error?.name === 'QuotaExceededError';
        reject(new SaveError(quota ? 'Storage is full; free some space and try again.' : `Storage error: ${tx.error?.message ?? 'unknown'}.`));
      };
    });
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (s) => s.put(value, key));
  }
  get<T>(key: string): Promise<T | undefined> {
    return this.run<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  }
  async delete(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
  }
}
