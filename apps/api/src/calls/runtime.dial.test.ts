/**
 * CALLS-CLIENT-V2 §3.2 — the DO (CALLS-V3 T1d/T4) dial path stamps the
 * X-Loonext-Session custom SIP header on the member ring `POST /v2/calls` body,
 * so the Android client can correlate the INVITE to its server session. Drives
 * the REAL runtime (createSessionRuntime) with only the network edge (global fetch)
 * stubbed, and asserts the exact header name/value the Android client reads.
 * #212 also pins X-Loonext-Caller (the real caller, so the member's ring shows
 * who is calling and not our own business `from`) on this same live v3 path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { createSessionRuntime } from "./runtime";

const env: Env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSessionRuntime.telnyx.dial — X-Loonext-Session header (§3.2)", () => {
  it("stamps custom_headers [{name:X-Loonext-Session, value:<session>}] on the /v2/calls body", async () => {
    const captured: { body: unknown }[] = [];
    const dialRoute: FetchRoute = async (url, request) => {
      if (url.pathname !== "/v2/calls" || request.method !== "POST") {
        return undefined;
      }
      captured.push({ body: await request.json() });
      return Response.json({
        data: { call_control_id: "member-ccid" },
      });
    };
    stubFetch(dialRoute);

    const rt = createSessionRuntime(env);
    const result = await rt.telnyx.dial({
      sipTarget: "sip:gencred_a@sip.telnyx.com",
      fromE164: "+16135550100",
      clientState: "brm-state",
      sessionId: "sess-do-9",
    });

    expect(result).toEqual({ ccid: "member-ccid" });
    expect(captured).toHaveLength(1);
    const body = captured[0].body as {
      to: string;
      client_state: string;
      custom_headers: { name: string; value: string }[];
    };
    expect(body.to).toBe("sip:gencred_a@sip.telnyx.com");
    expect(body.custom_headers).toEqual([
      { name: "X-Loonext-Session", value: "sess-do-9" },
    ]);
  });

  it("sends command_id so a journaled replay cannot ring a second billable leg", async () => {
    const captured: { body: unknown }[] = [];
    stubFetch(async (url, request) => {
      if (url.pathname !== "/v2/calls" || request.method !== "POST") {
        return undefined;
      }
      captured.push({ body: await request.json() });
      return Response.json({ data: { call_control_id: "member-ccid" } });
    });

    const rt = createSessionRuntime(env);
    await rt.telnyx.dial({
      sipTarget: "sip:gencred_a@sip.telnyx.com",
      fromE164: "+16135550100",
      clientState: "brm-state",
      sessionId: "sess-do-9",
      commandId: "leg:pending:abc-123",
    });

    // §4.1 effect execution is at-least-once, and `dial` is the only command
    // that creates a new billable leg. The pendingKey is frozen in the journal,
    // so a replay reuses it and Telnyx returns the original leg (verified live:
    // HTTP 202 + the same call_control_id).
    const body = captured[0].body as { command_id?: string };
    expect(body.command_id).toBe("leg:pending:abc-123");
  });

  it("omits command_id entirely when the caller has no pendingKey", async () => {
    const captured: { body: unknown }[] = [];
    stubFetch(async (url, request) => {
      if (url.pathname !== "/v2/calls" || request.method !== "POST") {
        return undefined;
      }
      captured.push({ body: await request.json() });
      return Response.json({ data: { call_control_id: "member-ccid" } });
    });

    const rt = createSessionRuntime(env);
    await rt.telnyx.dial({
      sipTarget: "sip:gencred_a@sip.telnyx.com",
      fromE164: "+16135550100",
      clientState: "brm-state",
      sessionId: "sess-do-9",
    });

    // A null/absent key must not be sent as `command_id: undefined` — Telnyx
    // would reject the field rather than treat it as absent.
    expect(Object.hasOwn(captured[0].body as object, "command_id")).toBe(false);
  });

  it("#212: stamps X-Loonext-Caller with the real caller when present", async () => {
    const captured: { body: unknown }[] = [];
    stubFetch(async (url, request) => {
      if (url.pathname !== "/v2/calls" || request.method !== "POST") {
        return undefined;
      }
      captured.push({ body: await request.json() });
      return Response.json({ data: { call_control_id: "member-ccid" } });
    });

    const rt = createSessionRuntime(env);
    await rt.telnyx.dial({
      sipTarget: "sip:gencred_a@sip.telnyx.com",
      // `from` is the owned business number (Telnyx keeps it for the WebRTC
      // leg); the caller rides the header instead.
      fromE164: "+16135550100",
      clientState: "brm-state",
      sessionId: "sess-do-9",
      caller: "+15875551234",
    });

    const body = captured[0].body as {
      from: string;
      custom_headers: { name: string; value: string }[];
    };
    expect(body.from).toBe("+16135550100");
    expect(body.custom_headers).toEqual([
      { name: "X-Loonext-Session", value: "sess-do-9" },
      { name: "X-Loonext-Caller", value: "+15875551234" },
    ]);
  });

  it("#212: omits X-Loonext-Caller for an anonymous/CLIR caller (null)", async () => {
    const captured: { body: unknown }[] = [];
    stubFetch(async (url, request) => {
      if (url.pathname !== "/v2/calls" || request.method !== "POST") {
        return undefined;
      }
      captured.push({ body: await request.json() });
      return Response.json({ data: { call_control_id: "member-ccid" } });
    });

    const rt = createSessionRuntime(env);
    await rt.telnyx.dial({
      sipTarget: "sip:gencred_a@sip.telnyx.com",
      fromE164: "+16135550100",
      clientState: "brm-state",
      sessionId: "sess-do-9",
      caller: null,
    });

    const body = captured[0].body as {
      custom_headers: { name: string; value: string }[];
    };
    expect(body.custom_headers).toEqual([
      { name: "X-Loonext-Session", value: "sess-do-9" },
    ]);
  });
});

/**
 * #616 — a rate limit is not a verdict on somebody's phone.
 *
 * Five places in the call path read "status < 500" as a DEFINITE refusal: this
 * leg is gone, stop trying. For most 4xx that is right — a 404 on a call
 * control id means the leg really has ended.
 *
 * A 429 is not one of them. It is produced by our AGGREGATE load against one
 * shared Telnyx account, so it is caused by OTHER calls and says nothing about
 * the leg in the request. Read as a refusal, it inverted the meaning: a
 * technician's phone marked dead because the workspace next door was busy, and
 * on an outbound call that terminalises and hangs up on a live customer.
 *
 * The nastiest part is WHEN it fires. A rate limit arrives when the account is
 * busiest, which is when a dropped call costs the most and when the largest
 * workspace is the one experiencing it. Every load-related failure in this
 * subsystem is like that, which is why #251's investigation found it.
 */
describe("#616 a 429 is not a definite refusal", () => {
  function refusing(status: number): FetchRoute {
    return async (url, request) => {
      if (url.pathname !== "/v2/calls" || request.method !== "POST") {
        return undefined;
      }
      return Response.json(
        { errors: [{ code: "10007", title: "rate limited" }] },
        { status },
      );
    };
  }

  async function dialAgainst(status: number) {
    stubFetch(refusing(status));
    const rt = createSessionRuntime(env);
    return rt.telnyx.dial({
      sipTarget: "sip:gencred_a@sip.telnyx.com",
      fromE164: "+16135550100",
      clientState: "brm-state",
      sessionId: "sess-616",
      caller: "+16135550199",
      commandId: "pending-616",
    });
  }

  it("does not declare the leg dead when Telnyx rate-limits us", async () => {
    // THE DEFECT. `known-dead` prunes the pending leg immediately: premature
    // voicemail on an inbound call, and a hung-up customer on an outbound one.
    expect(await dialAgainst(429)).toEqual({ failure: "ambiguous" });
  });

  it("does not declare it dead on a timeout either", async () => {
    // A 408 is an unanswered question, not an answer.
    expect(await dialAgainst(408)).toEqual({ failure: "ambiguous" });
  });

  it("still declares it dead when Telnyx genuinely refuses", async () => {
    // The other half, and the one that makes this a distinction rather than a
    // blanket softening. A 404 or a 422 IS a statement about this leg, and
    // treating those as ambiguous would leave dead legs ringing out the full
    // window before the machine gave up on them.
    expect(await dialAgainst(404)).toEqual({ failure: "known-dead" });
    expect(await dialAgainst(422)).toEqual({ failure: "known-dead" });
  });

  it("keeps a server error ambiguous, which is what 429 now joins", async () => {
    // The fix adds no new branch: "not now" takes the path "we could not find
    // out" already had. A 429 and a 503 mean the same thing to a caller.
    expect(await dialAgainst(503)).toEqual({ failure: "ambiguous" });
  });
});
