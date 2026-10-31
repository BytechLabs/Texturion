/**
 * The slice of Durable Object storage the guard uses. The policy depends on
 * this rather than on `DurableObjectStorage`, so the node suites drive the
 * same code against a Map.
 */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every entry whose key starts with `prefix`. */
  list<T>(prefix: string): Promise<Map<string, T>>;
}

export function durableStore(storage: DurableObjectStorage): Store {
  return {
    get: <T>(key: string) => storage.get<T>(key),
    put: (key, value) => storage.put(key, value),
    delete: async (key) => {
      await storage.delete(key);
    },
    list: <T>(prefix: string) => storage.list<T>({ prefix }),
  };
}

/** Structured clone on every write, as Durable Object storage does. */
export class MemoryStore implements Store {
  readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.data.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list<T>(prefix: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [key, value] of [...this.data.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (key.startsWith(prefix)) out.set(key, structuredClone(value) as T);
    }
    return out;
  }
}
