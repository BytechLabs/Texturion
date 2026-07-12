/**
 * D43 (#135) POST /v1/webrtc/token — the browser softphone's identity mint.
 * Real product code over the stubbed network edge (D13).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import { stubRoute, type Stub } from "../test/messaging-support";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import type { Env } from "../env";
import { webrtcRoutes } from "./webrtc";

const env: Env = {
  ...completeEnv(),
  TELNYX_WEBRTC_CONNECTION_ID: "3002000000000000000",
};
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;
const app = buildTestApp(webrtcRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface WorldOptions {
  subscriptionStatus?: string;
  existingCredential?: { telnyx_credential_id: string; sip_username: string };
  insertReturns?: unknown[];
  /** Overrides the credential-lookup responder (for the race case). */
  credentialLookup?: () => unknown[];
}

function world(options: WorldOptions = {}): {
  sb: SupabaseStub;
  create: Stub;
  token: Stub;
} {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  sb.on("GET", "/rest/v1/companies", () => [
    { subscription_status: options.subscriptionStatus ?? "active" },
  ]);
  sb.on(
    "GET",
    "/rest/v1/member_telephony_credentials",
    options.credentialLookup ??
      (() => (options.existingCredential ? [options.existingCredential] : [])),
  );
  sb.on(
    "POST",
    "/rest/v1/member_telephony_credentials",
    () =>
      options.insertReturns ?? [
        { telnyx_credential_id: "cred_1", sip_username: "gencredAAA" },
      ],
  );
  const create: Stub = stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.href === "https://api.telnyx.com/v2/telephony_credentials",
    () => ({ data: { id: "cred_1", sip_username: "gencredAAA" } }),
  );
  const token: Stub = stubRoute(
    (url, request) =>
      request.method === "POST" &&
      /\/v2\/telephony_credentials\/[^/]+\/token$/.test(url.pathname),
    () => new Response("jwt-token-abc", { status: 201 }),
  );
  return { sb, create, token };
}

describe("POST /v1/webrtc/token (D43)", () => {
  it("first token: mints the credential on the shared connection, stores it, returns the JWT", async () => {
    const w = world();
    stubFetch(jwksRoute(auth), w.sb.route, w.create.route, w.token.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/webrtc/token", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {},
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      token: "jwt-token-abc",
      sip_username: "gencredAAA",
      expires_in_hours: 24,
    });

    // The credential was minted on OUR shared connection, tagged by company.
    expect(w.create.calls).toHaveLength(1);
    expect(w.create.calls[0].body).toMatchObject({
      connection_id: "3002000000000000000",
      tag: COMPANY_ID,
    });
    // …and persisted for reuse.
    expect(
      w.sb.find("POST", "/rest/v1/member_telephony_credentials"),
    ).toHaveLength(1);
  });

  it("returning member: reuses the stored credential — no Telnyx create", async () => {
    const w = world({
      existingCredential: {
        telnyx_credential_id: "cred_existing",
        sip_username: "gencredBBB",
      },
    });
    stubFetch(jwksRoute(auth), w.sb.route, w.create.route, w.token.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/webrtc/token", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {},
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sip_username: string }).sip_username).toBe(
      "gencredBBB",
    );
    expect(w.create.calls).toHaveLength(0);
    // The token mint targeted the EXISTING credential.
    expect(w.token.calls[0].url.pathname).toContain("cred_existing");
  });

  it("a non-active subscription is an honest 402 — no credential, no token", async () => {
    const w = world({ subscriptionStatus: "canceled" });
    stubFetch(jwksRoute(auth), w.sb.route, w.create.route, w.token.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/webrtc/token", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {},
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: "subscription_inactive" },
    });
    expect(w.create.calls).toHaveLength(0);
    expect(w.token.calls).toHaveLength(0);
  });

  it("an unconfigured environment refuses honestly (no connection id)", async () => {
    const bare: typeof env = { ...env, TELNYX_WEBRTC_CONNECTION_ID: undefined };
    const w = world();
    stubFetch(jwksRoute(auth), w.sb.route);

    const res = await apiRequest(app, bare, await auth.token(), "/v1/webrtc/token", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {},
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringContaining("isn't configured") },
    });
  });

  it("first-token race: the losing insert reuses the winner and deletes its orphan", async () => {
    // ignoreDuplicates lost the race → the initial lookup finds nothing, the
    // insert returns [], and the re-read finds the winner's row.
    let reads = 0;
    const w = world({
      insertReturns: [],
      credentialLookup: () => {
        reads += 1;
        return reads === 1
          ? []
          : [
              {
                telnyx_credential_id: "cred_winner",
                sip_username: "gencredWIN",
              },
            ];
      },
    });
    const orphanDelete: Stub = stubRoute(
      (url, request) =>
        request.method === "DELETE" &&
        /\/v2\/telephony_credentials\/cred_1$/.test(url.pathname),
      () => new Response(null, { status: 204 }),
    );
    stubFetch(
      jwksRoute(auth),
      w.sb.route,
      w.create.route,
      w.token.route,
      orphanDelete.route,
    );

    const res = await apiRequest(app, env, await auth.token(), "/v1/webrtc/token", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {},
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sip_username: string }).sip_username).toBe(
      "gencredWIN",
    );
    expect(orphanDelete.calls).toHaveLength(1);
    expect(w.token.calls[0].url.pathname).toContain("cred_winner");
  });
});
