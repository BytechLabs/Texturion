/**
 * CALLS-CLIENT-V2 §3.2 — the DO (CALLS-V3 T1d/T4) dial path stamps the
 * X-Loonext-Session custom SIP header on the member ring `POST /v2/calls` body,
 * so the header is present whether or not CALLS_V3_LEGACY is set. Drives the
 * REAL runtime (createSessionRuntime) with only the network edge (global fetch)
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
