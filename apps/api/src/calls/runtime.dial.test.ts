/**
 * CALLS-CLIENT-V2 §3.2 — the DO (CALLS-V3 T1d/T4) dial path stamps the
 * X-Loonext-Session custom SIP header on the member ring `POST /v2/calls` body,
 * so the header is present whether or not CALLS_V3_LEGACY is set. Drives the
 * REAL runtime (createSessionRuntime) with only the network edge (global fetch)
 * stubbed, and asserts the exact header name/value the Android client reads.
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
});
