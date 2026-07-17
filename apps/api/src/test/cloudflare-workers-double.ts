/**
 * Calls v3 (#170 §15.2) — the `cloudflare:workers` node-resolution double.
 *
 * apps/api's vitest runs plain node-environment projects (no pool-workers, no
 * miniflare), and mount.test.ts imports the real ./index — which, once
 * src/index.ts re-exports a class extending `DurableObject` from
 * `cloudflare:workers`, fails node module resolution and kills the ENTIRE api
 * suite. This aliased double (vitest.config.ts resolve.alias, both projects)
 * supplies a no-op `DurableObject` base with just the storage/alarm surface the
 * shell uses, so the class loads under node and the shell tests can drive it
 * against an in-memory storage double. No pool-workers migration is required
 * for #170.
 */

/** The subset of DurableObjectStorage the CallSessionDO shell calls. */
export interface FakeStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

export interface FakeDurableObjectState {
  storage: FakeStorage;
  blockConcurrencyWhile?<T>(fn: () => Promise<T>): Promise<T>;
}

/** No-op base: stores ctx + env exactly like the real DurableObject. */
export class DurableObject<Env = unknown> {
  protected ctx: FakeDurableObjectState;
  protected env: Env;
  constructor(ctx: FakeDurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
