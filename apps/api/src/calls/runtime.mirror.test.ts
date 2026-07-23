/**
 * #209 - createSessionRuntime.mirror write-time coupling: a TERMINAL state
 * mirror back-fills a still-null `outcome` (coalesce semantics via the
 * `outcome=is.null` filter) and writes it BEFORE the state, so the incident
 * pair (state 'ended_%', outcome null) is never persistable even when the
 * terminal merge dies mid-flight. Drives the REAL runtime with only the
 * network edge (global fetch) stubbed, like runtime.dial.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { restMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { createSessionRuntime } from "./runtime";

const env: Env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

/** True for the coalesce-style outcome back-fill PATCH (`outcome=is.null`). */
function isOutcomeFill(url: URL): boolean {
  return url.searchParams.get("outcome") === "is.null";
}

describe("createSessionRuntime.mirror - terminal outcome coupling (#209)", () => {
  it("a terminal mirror back-fills the matching outcome FIRST, gated on outcome still null", async () => {
    const patches = stubRoute(
      restMatch(env, "PATCH", "calls"),
      () => new Response(null, { status: 204 }),
    );
    stubFetch(patches.route);

    const rt = createSessionRuntime(env);
    await rt.mirror("sess-209", {
      state: "ended_answered",
      answered_by_user_id: "user-1",
    });

    expect(patches.calls).toHaveLength(2);
    // 1. The coalesce: outcome = coalesce(outcome, 'answered') - only rows
    //    still outcome-null are touched, and it lands BEFORE the state.
    const fill = patches.calls[0];
    expect(isOutcomeFill(fill.url)).toBe(true);
    expect(fill.url.searchParams.get("call_session_id")).toBe("eq.sess-209");
    expect(fill.body).toEqual({ outcome: "answered" });
    // 2. The state mirror itself, untouched: no outcome in its body.
    const mirror = patches.calls[1];
    expect(isOutcomeFill(mirror.url)).toBe(false);
    expect(mirror.url.searchParams.get("call_session_id")).toBe("eq.sess-209");
    expect(mirror.body).toEqual({
      state: "ended_answered",
      answered_by_user_id: "user-1",
    });
  });

  it.each([
    ["ended_voicemail", "voicemail"],
    ["ended_missed", "missed"],
    ["ended_rejected", "missed"],
  ] as const)("derives %s → outcome %s", async (state, outcome) => {
    const patches = stubRoute(
      restMatch(env, "PATCH", "calls"),
      () => new Response(null, { status: 204 }),
    );
    stubFetch(patches.route);

    await createSessionRuntime(env).mirror("sess-map", { state });

    expect(patches.calls).toHaveLength(2);
    expect(patches.calls[0].body).toEqual({ outcome });
  });

  it("a NON-terminal mirror stays a single write with no outcome", async () => {
    const patches = stubRoute(
      restMatch(env, "PATCH", "calls"),
      () => new Response(null, { status: 204 }),
    );
    stubFetch(patches.route);

    await createSessionRuntime(env).mirror("sess-live", {
      state: "answered",
      answered_at: "2026-07-23T01:00:00.000Z",
    });

    expect(patches.calls).toHaveLength(1);
    expect(isOutcomeFill(patches.calls[0].url)).toBe(false);
    expect(patches.calls[0].body).toEqual({
      state: "answered",
      answered_at: "2026-07-23T01:00:00.000Z",
    });
  });

  it("a failed outcome back-fill throws BEFORE the state write - the bad pair never lands", async () => {
    const patches = stubRoute(restMatch(env, "PATCH", "calls"), (call) =>
      isOutcomeFill(call.url)
        ? Response.json({ message: "boom" }, { status: 500 })
        : new Response(null, { status: 204 }),
    );
    stubFetch(patches.route);

    await expect(
      createSessionRuntime(env).mirror("sess-fail", { state: "ended_answered" }),
    ).rejects.toThrow(/calls-v3 mirror failed/);

    // Ordering invariant: the terminal state was never written without its
    // outcome, so the shell's mirror-retry alarm re-runs BOTH.
    expect(patches.calls).toHaveLength(1);
    expect(isOutcomeFill(patches.calls[0].url)).toBe(true);
  });
});
