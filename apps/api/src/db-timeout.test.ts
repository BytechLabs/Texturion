import { afterEach, describe, expect, it, vi } from "vitest";

import { DB_TIMEOUT_MS, dbRequestSignal, getDb } from "./db";
import type { Env } from "./env";

/**
 * #251 — the database call has a deadline, and the caller's own signal survives.
 *
 * Every other outbound call this API makes is bounded by an
 * `AbortSignal.timeout`. The database was the exception, and it is the one
 * dependency on the hot path of every single request: without a deadline, a
 * pooler that stalls rather than refusing leaves the request waiting on a
 * subrequest that nothing in our code will abandon.
 *
 * #251 asks that crossing a ceiling "produces a truthful failure rather than a
 * hang". That is a property of the client's transport rather than of a load
 * test, which is why it is testable here and fixable before the ceiling is
 * ever reached.
 *
 * These drive the injected `fetch` directly. Standing a real PostgREST up to
 * watch it stall would test Supabase; what needs holding is that OUR wrapper
 * attaches a signal and does not throw away one it was handed.
 */

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
} as unknown as Env;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The `fetch` the Supabase client was built with, captured from a real call. */
async function capture(): Promise<RequestInit | undefined> {
  let seen: RequestInit | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_input: unknown, init?: RequestInit) => {
      seen = init;
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  // A fresh env object each time: the client is memoized per bindings object,
  // so reusing one would hand back a client built with an earlier spy.
  await getDb({ ...env } as Env).from("companies").select("id").limit(1);
  return seen;
}

describe("#251 the database call cannot hang forever", () => {
  it("attaches a signal to every request", async () => {
    const init = await capture();
    expect(init?.signal, "no signal reached fetch").toBeDefined();
    expect(init?.signal?.aborted).toBe(false);
  });

  it("uses the same order of magnitude as the other vendor calls", () => {
    // Not a latency budget. CAPACITY.md §1 measured the worst hot query at
    // 159 ms of plan and 282 ms end-to-end on a 50,000-conversation
    // workspace, so this is ~35x the worst legitimate case and cannot fire on
    // a slow query. A deadline tight enough to do that would turn a working
    // page into an error to prevent a hang nobody has hit, which is the worse
    // trade.
    expect(DB_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(DB_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("aborts once the deadline passes", async () => {
    // A millisecond deadline through the same helper the client uses.
    // `AbortSignal.timeout` is native and vitest's fake timers do not drive
    // it, so the choice was this or a test that waited ten seconds. A helper
    // that takes the number is the version that can actually be proven.
    const signal = dbRequestSignal(undefined, 5);
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signal.aborted, "the deadline never fired").toBe(true);
  });

  it("keeps a caller's own signal rather than replacing it", async () => {
    /*
     * The mistake this catches is quiet and specific: setting `signal` on the
     * init object throws away whatever was already there. Supabase passes one
     * for `.abortSignal()`, so a wrapper that clobbered it would silently
     * un-cancel a request the caller had already given up on — a fetch still
     * running for a client that stopped listening.
     */
    let seen: RequestInit | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input: unknown, init?: RequestInit) => {
        seen = init;
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const caller = new AbortController();
    await getDb({ ...env } as Env)
      .from("companies")
      .select("id")
      .abortSignal(caller.signal)
      .limit(1);

    expect(seen?.signal?.aborted).toBe(false);
    caller.abort();
    expect(seen?.signal?.aborted, "the caller's abort was discarded").toBe(true);
  });
});
