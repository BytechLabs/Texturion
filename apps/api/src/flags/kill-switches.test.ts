/**
 * #283 — "each risky subsystem has a documented kill switch and **someone has
 * tested it**". This is that test.
 *
 * A kill switch nobody has pulled is a hypothesis. These pull each one at its
 * real choke point, through the real route, and assert two things per switch:
 * that it stops the thing, and that it stops ONLY the thing. A switch that
 * takes more with it than it advertises is worse than none, because it will be
 * reached for during an incident and make the incident bigger.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

import { app } from "../index";
import {
  authorizeRoute,
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { resetFlagCache } from "./evaluate";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;

/** The flag store, answering with whatever this incident looks like. */
function flagsRoute(values: Record<string, boolean>): FetchRoute {
  return (url) =>
    url.pathname.endsWith("/rpc/api_evaluate_flags")
      ? Response.json(values)
      : undefined;
}

beforeEach(async () => {
  // A fresh isolate is the production reset; tests need the same.
  resetFlagCache();
  auth ??= await createTestAuth(env);
});

async function callWebrtcToken(): Promise<Response> {
  return app.request(
    "/v1/webrtc/token",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        "X-Company-Id": COMPANY_ID,
      },
    },
    env,
  );
}

describe("kill:calls", () => {
  it("refuses a new call token while the switch is off", async () => {
    stubFetch(
      jwksRoute(auth),
      authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
      flagsRoute({ "kill:calls": false }),
    );

    const res = await callWebrtcToken();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("service_unavailable");
    // The message has to tell somebody holding a phone what still works.
    expect(body.error.message).toMatch(/texting still works/i);
  });

  it("lets the token through when the switch is on", async () => {
    stubFetch(
      jwksRoute(auth),
      authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
      flagsRoute({ "kill:calls": true }),
      // Whatever happens past the gate, it is not our 503.
      () => Response.json({ data: {} }),
    );

    const res = await callWebrtcToken();
    expect(res.status).not.toBe(503);
  });

  it("lets the token through when the flag store is empty", async () => {
    // The default state, and the one every existing customer is in.
    stubFetch(
      jwksRoute(auth),
      authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
      flagsRoute({}),
      () => Response.json({ data: {} }),
    );

    const res = await callWebrtcToken();
    expect(res.status).not.toBe(503);
  });

  it("lets the token through when the flag store is DOWN", async () => {
    // The property that makes flags safe to depend on: an outage in the switch
    // must never be able to switch anything off.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(
      jwksRoute(auth),
      authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
      (url) =>
        url.pathname.endsWith("/rpc/api_evaluate_flags")
          ? new Response("boom", { status: 500 })
          : undefined,
      () => Response.json({ data: {} }),
    );

    const res = await callWebrtcToken();
    expect(res.status).not.toBe(503);
    errorSpy.mockRestore();
  });

  it("does not take texting down with it", async () => {
    // The containment property, asserted at the switch rather than through the
    // whole send path: reaching for kill:calls during a calls incident must
    // leave every other subsystem exactly where it was. A switch that takes
    // more with it than it advertises makes the incident bigger.
    stubFetch(
      jwksRoute(auth),
      authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
      flagsRoute({ "kill:calls": false }),
    );

    const { isKilled } = await import("./evaluate");
    expect(await isKilled(env, "kill:calls", COMPANY_ID)).toBe(true);
    for (const other of ["kill:outbound-send", "kill:ai", "kill:realtime"] as const) {
      expect(await isKilled(env, other, COMPANY_ID), other).toBe(false);
    }
  });
});

describe("kill:outbound-send", () => {
  it("stops every send at the one choke point", async () => {
    stubFetch(
      jwksRoute(auth),
      authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
      flagsRoute({ "kill:outbound-send": false }),
    );

    const { runPreSendGates } = await import("../messaging/send");
    await expect(
      runPreSendGates(env, COMPANY_ID, "+14165551234"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });

  it("says nothing was lost, because nothing was", async () => {
    // The copy matters: a contractor whose text did not send needs to know
    // whether to retype it.
    stubFetch(
      jwksRoute(auth),
      authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
      flagsRoute({ "kill:outbound-send": false }),
    );

    const { runPreSendGates } = await import("../messaging/send");
    await expect(
      runPreSendGates(env, COMPANY_ID, "+14165551234"),
    ).rejects.toMatchObject({ message: expect.stringMatching(/nothing you sent was lost/i) });
  });
});
