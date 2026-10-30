/**
 * `CALL_SESSIONS` for a node test: the real CallSessionDO class, one instance
 * per name, behind a stub that behaves like a Durable Object RPC stub.
 *
 * Without this binding the webhook router drops every inbound and outbound
 * call event on the floor (`dispatchInboundCallEvent` stamps and returns when
 * the namespace is absent), so no hermetic test could follow a call past
 * `call.initiated`.
 *
 * What it keeps from the platform:
 *   - one object per `idFromName`, so every leg of a session lands on the
 *     same machine, and two sessions never share one;
 *   - RPC copies its arguments and results, so a caller cannot mutate the
 *     object's state through a shared reference (structuredClone here);
 *   - an alarm is consumed when it fires, and only fires when somebody fires
 *     it — `fireDueAlarms` is the scheduler, and the test owns the clock.
 *
 * What it does not keep: storage durability across an eviction, input gates,
 * and real isolate timing. Those are the workerd project's to measure
 * (vitest.workerd.config.ts); none of them changes which commands a call
 * sends, which is what the journeys count.
 */
import { CallSessionDO } from "../src/calls/session-do";
import { makeStorage } from "../src/calls/session-do-fake";
import type { SessionRuntime } from "../src/calls/runtime";

interface SessionObject {
  name: string;
  instance: CallSessionDO;
  store: ReturnType<typeof makeStorage>;
}

export interface CallSessionsDouble {
  /** What goes in `env.CALL_SESSIONS`. */
  namespace: DurableObjectNamespace;
  /** Names of every object created so far, in creation order. */
  names(): string[];
  instance(name: string): CallSessionDO | undefined;
  /** Resolves once every object's FIFO has drained. */
  idle(): Promise<void>;
  /** The earliest armed alarm across every object, or null. */
  nextAlarmAt(): number | null;
  /** Run every alarm due at `nowMs`; returns how many fired. */
  fireDueAlarms(nowMs?: number): Promise<number>;
}

export interface CallSessionsOptions {
  /**
   * Hands an object a runtime instead of letting it build the real one from
   * `env`. The node journeys use it to keep the Telnyx half real and replace
   * only the database half; the e2e harness leaves it unset.
   */
  runtimeFor?: (name: string) => SessionRuntime | undefined;
}

class FakeDurableObjectId {
  constructor(readonly name: string) {}

  toString(): string {
    return Buffer.from(this.name).toString("hex");
  }

  equals(other: { toString(): string }): boolean {
    return other.toString() === this.toString();
  }
}

const MAX_IDLE_PASSES = 10;

export function createCallSessions(
  env: object,
  options: CallSessionsOptions = {},
): CallSessionsDouble {
  const objects = new Map<string, SessionObject>();
  let rpcCalls = 0;

  function objectFor(name: string): SessionObject {
    const existing = objects.get(name);
    if (existing) return existing;
    const store = makeStorage();
    const instance = new CallSessionDO(
      { storage: store.storage } as never,
      env as never,
    );
    const runtime = options.runtimeFor?.(name);
    if (runtime) instance.installRuntime(runtime);
    const created = { name, instance, store };
    objects.set(name, created);
    return created;
  }

  function stubFor(name: string): unknown {
    return new Proxy(
      {},
      {
        get(_target, property) {
          // A stub is not a thenable; `await stub` must not call into it.
          if (property === "then" || typeof property !== "string") {
            return undefined;
          }
          return (...args: unknown[]) => {
            rpcCalls += 1;
            const copied = structuredClone(args);
            const { instance } = objectFor(name);
            const method = (instance as unknown as Record<string, unknown>)[
              property
            ];
            if (typeof method !== "function") {
              return Promise.reject(
                new TypeError(`CallSessionDO has no RPC method ${property}`),
              );
            }
            return Promise.resolve()
              .then(() => (method as (...a: unknown[]) => unknown).apply(instance, copied))
              .then((result) => structuredClone(result));
          };
        },
      },
    );
  }

  const namespace = {
    idFromName: (name: string) => new FakeDurableObjectId(name),
    get: (id: FakeDurableObjectId) => stubFor(id.name),
    getByName: (name: string) => stubFor(name),
  } as unknown as DurableObjectNamespace;

  async function idle(): Promise<void> {
    // A drained object can be handed more work by another's cascade, so loop
    // until a full pass neither creates an object nor calls into one.
    for (let pass = 0; pass < MAX_IDLE_PASSES; pass += 1) {
      const objectsBefore = objects.size;
      const callsBefore = rpcCalls;
      await Promise.all([...objects.values()].map((o) => o.instance.whenIdle()));
      if (objects.size === objectsBefore && rpcCalls === callsBefore) return;
    }
    // Returning here would let a journey assert on work that is still running.
    throw new Error(`call sessions still busy after ${MAX_IDLE_PASSES} passes`);
  }

  return {
    namespace,
    names: () => [...objects.keys()],
    instance: (name) => objects.get(name)?.instance,
    idle,
    nextAlarmAt() {
      let soonest: number | null = null;
      for (const { store } of objects.values()) {
        const at = store.getAlarmAt();
        if (at !== null && (soonest === null || at < soonest)) soonest = at;
      }
      return soonest;
    },
    async fireDueAlarms(nowMs = Date.now()) {
      let fired = 0;
      for (const { instance, store } of objects.values()) {
        const at = store.getAlarmAt();
        if (at === null || at > nowMs) continue;
        // The platform clears an alarm as it delivers it; the handler arms
        // the next one itself.
        await store.storage.deleteAlarm();
        await instance.alarm();
        fired += 1;
      }
      await idle();
      return fired;
    },
  };
}
