/**
 * GET /v1/me (SPEC §7): profile + memberships, company-exempt, with optional
 * X-Company-Id hydration (subscription/plan/registration/numbers).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AUTHORIZE_RPC,
  apiRequest,
  buildTestApp,
  membershipResponder,
  pgError,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { meRoutes } from "./me";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const OTHER_COMPANY_ID = "11111111-2222-4333-8444-555555555555";
const MEMBER_ID = "22222222-3333-4444-8555-666666666666";

let auth: TestAuth;
const app = buildTestApp(meRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseStub(): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/profiles", () => [{ display_name: "Casey Owner" }]);
  // Settings, Account reads the password from the account itself: the Supabase
  // identities array cannot see one set after an OAuth signup.
  sb.on("POST", "/rest/v1/rpc/api_user_has_password", () => true);
  sb.on("GET", "/rest/v1/company_members", () => [
    {
      company_id: COMPANY_ID,
      role: "owner",
      companies: { name: "Acme Plumbing", subscription_status: "active" },
    },
  ]);
  return sb;
}

const POSTURE_RPC = "/rest/v1/rpc/company_mfa_posture";
const FACTOR_RPC = "/rest/v1/rpc/user_has_verified_mfa";

/**
 * #581: the MFA posture of the X-Company-Id workspace, which this route resolves
 * for itself.
 *
 * It has to. /v1/me is company-EXEMPT, so the middleware asks
 * `api_authorize_request` for `p_company_id => null` and gets no posture back at
 * all — the ambient authorize responder reproduces exactly that, which is the
 * state production is in, and the reason the handler cannot lean on it.
 *
 * `membershipResponder`'s `mfa` option could not stand in here even for a
 * company-scoped route: it has no `enrolled` field, so everything that turns on
 * #496 reads false through it and a test written that way passes against code
 * with no gate at all.
 *
 * `{ enforcing: false, enrolled: false }` is the quiet answer — no workspace
 * policy and no factor — which is the state every test written before #581 was
 * asserting against.
 */
function onMfaPosture(
  sb: SupabaseStub,
  posture: { enforcing: boolean; enrolled: boolean },
): void {
  sb.on("POST", POSTURE_RPC, () => ({
    required: posture.enforcing,
    grace_until: posture.enforcing ? "2020-01-01T00:00:00Z" : null,
    enforcing: posture.enforcing,
  }));
  sb.on("POST", FACTOR_RPC, () => posture.enrolled);
}

describe("GET /v1/me", () => {
  it("returns profile + memberships without X-Company-Id (company-exempt)", async () => {
    const sb = baseStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user_id: auth.subject,
      display_name: "Casey Owner",
      // #386: null means "we can reach you" — the common case, and the one
      // that needs no interpretation on three clients.
      email_state: null,
      has_password: true,
      memberships: [
        {
          company_id: COMPANY_ID,
          name: "Acme Plumbing",
          role: "owner",
          subscription_status: "active",
          // #540: the empty set for a member who has put nothing away, which is
          // everybody until they open Customise.
          dashboard_hidden: [],
        },
      ],
    });
    // Membership query is scoped to the verified sub and active rows only.
    const membershipCall = sb.find("GET", "/rest/v1/company_members")[0];
    expect(membershipCall.url.searchParams.get("user_id")).toBe(
      `eq.${auth.subject}`,
    );
    expect(membershipCall.url.searchParams.get("deactivated_at")).toBe(
      "is.null",
    );
  });

  it("hydrates the X-Company-Id company: subscription, plan, registration snapshot, numbers", async () => {
    const sb = baseStub();
    onMfaPosture(sb, { enforcing: false, enrolled: false });
    sb.on("GET", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing",
        country: "US",
        us_texting_enabled: true,
        requested_area_code: "416",
        plan: "starter",
        subscription_status: "active",
        current_period_start: "2026-06-15T00:00:00+00:00",
        current_period_end: "2026-07-15T00:00:00+00:00",
        overage_cap_multiplier: 3,
        registration_fee_paid_at: "2026-06-15T00:01:00+00:00",
        canceled_at: null,
        created_at: "2026-06-14T00:00:00+00:00",
        updated_at: "2026-06-15T00:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => [
      {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        status: "active",
        country: "US",
        number_e164: "+14165550000",
        requested_area_code: "416",
        created_at: "2026-06-15T00:02:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/messaging_registrations", () => [
      { kind: "brand", status: "approved" },
      { kind: "campaign", status: "pending", rejection_reason: null },
    ]);
    sb.on("GET", "/rest/v1/company_modules", () => []); // #133 enabled_modules
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      company: {
        plan: string;
        subscription_status: string;
        numbers: unknown[];
        billing_writes_enabled: boolean;
        registration: { brand: unknown; campaign: unknown };
      };
    };
    expect(body.company.plan).toBe("starter");
    expect(body.company.subscription_status).toBe("active");
    expect(body.company.numbers).toHaveLength(1);
    // #163: in-app billing writes default ON (kill-switch unset).
    expect(body.company.billing_writes_enabled).toBe(true);
    expect(body.company.registration.brand).toMatchObject({
      kind: "brand",
      status: "approved",
    });
    expect(body.company.registration.campaign).toMatchObject({
      kind: "campaign",
      status: "pending",
    });
  });

  it("flips billing_writes_enabled to false under the BILLING_WRITES_DISABLED kill-switch (#163)", async () => {
    const sb = baseStub();
    onMfaPosture(sb, { enforcing: false, enrolled: false });
    sb.on("GET", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing",
        country: "US",
        plan: "starter",
        subscription_status: "active",
        created_at: "2026-06-14T00:00:00+00:00",
        updated_at: "2026-06-15T00:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    sb.on("GET", "/rest/v1/company_modules", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    for (const flag of ["1", "true", "TRUE "]) {
      const res = await apiRequest(
        app,
        { ...env, BILLING_WRITES_DISABLED: flag },
        await auth.token(),
        "/v1/me",
        { companyId: COMPANY_ID },
      );
      expect(res.status, flag).toBe(200);
      const body = (await res.json()) as {
        company: { billing_writes_enabled: boolean };
      };
      expect(body.company.billing_writes_enabled, flag).toBe(false);
    }

    // Anything that isn't the documented on-values keeps writes enabled.
    const res = await apiRequest(
      app,
      { ...env, BILLING_WRITES_DISABLED: "0" },
      await auth.token(),
      "/v1/me",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as {
      company: { billing_writes_enabled: boolean };
    };
    expect(body.company.billing_writes_enabled).toBe(true);
  });

  it("403s when X-Company-Id is not one of the caller's active memberships", async () => {
    const sb = baseStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: OTHER_COMPANY_ID,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
  });

  it("422s on a malformed X-Company-Id", async () => {
    const sb = baseStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: "not-a-uuid",
    });
    expect(res.status).toBe(422);
  });

  it("401s without a token", async () => {
    stubFetch();
    const res = await app.request("/v1/me", {}, env);
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/me withholds the workspace at aal1 (#581)", () => {
  /** The hydration stub, with the posture this route resolves for itself. */
  function mfaStub(posture: {
    enforcing: boolean;
    enrolled: boolean;
  }): SupabaseStub {
    const sb = baseStub();
    onMfaPosture(sb, posture);
    sb.on("GET", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing",
        country: "US",
        plan: "starter",
        subscription_status: "active",
        created_at: "2026-06-14T00:00:00+00:00",
        updated_at: "2026-06-15T00:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => [
      {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        status: "active",
        country: "US",
        number_e164: "+14165550000",
        created_at: "2026-06-15T00:02:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    sb.on("GET", "/rest/v1/company_modules", () => []);
    return sb;
  }

  it("omits `company` for a session whose owner holds a factor (#496 reading)", async () => {
    // The workspace has NO policy — this is the personal enrolment that
    // GET /v1/company answers with `mfa_challenge_required`, and this route was
    // handing over the identical object.
    const sb = mfaStub({ enforcing: false, enrolled: true });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: COMPANY_ID,
    });
    // 200, not 403: the workspace switcher and every recovery path bootstrap
    // from this response, so refusing it would lock somebody out of the flow
    // that satisfies the challenge.
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.company).toBeUndefined();
    expect(body.flags).toBeUndefined();
    // The half that MUST survive: the memberships the switcher reads, and the
    // identity the account screens read.
    expect(body.memberships).toHaveLength(1);
    expect(body.user_id).toBe(auth.subject);
  });

  it("omits `company` when the workspace enforces and the session is aal1", async () => {
    // #314's half of the same gate, for somebody with no factor of their own.
    const sb = mfaStub({ enforcing: true, enrolled: false });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.company).toBeUndefined();
  });

  it("serves it once the code has been presented, without asking anything", async () => {
    const sb = mfaStub({ enforcing: true, enrolled: true });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token({ aal: "aal2" }),
      "/v1/me",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { company?: { plan: string } };
    expect(body.company?.plan).toBe("starter");
    // No posture can produce a demand at aal2, so neither lookup is paid for on
    // the hottest route in the product.
    expect(sb.find("POST", POSTURE_RPC)).toHaveLength(0);
    expect(sb.find("POST", FACTOR_RPC)).toHaveLength(0);
  });

  it("serves it to the ordinary case: no factor, no policy", async () => {
    // The state almost every workspace is in. A gate that fired here would be an
    // outage, not a fix.
    const sb = mfaStub({ enforcing: false, enrolled: false });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { company?: { plan: string } };
    expect(body.company?.plan).toBe("starter");
  });
});

describe("PATCH /v1/me (#112: set your own display name)", () => {
  it("upserts the caller's profile name, company-exempt (no X-Company-Id)", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/profiles", () => [{ display_name: "Pat Rivera" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      method: "PATCH",
      companyId: null,
      body: { display_name: "  Pat Rivera  " },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ display_name: "Pat Rivera" });

    // Upsert on user_id, scoped to the CALLER (the sub, never a body field),
    // with the whitespace trimmed.
    const upsert = sb.find("POST", "/rest/v1/profiles")[0];
    expect(upsert.url.searchParams.get("on_conflict")).toBe("user_id");
    expect(upsert.body).toMatchObject({
      user_id: auth.subject,
      display_name: "Pat Rivera",
    });
  });

  it("422s an empty or over-long name", async () => {
    const sb = supabaseStub(env);
    stubFetch(jwksRoute(auth), sb.route);
    for (const display_name of ["", "   ", "x".repeat(81)]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
        method: "PATCH",
        companyId: null,
        body: { display_name },
      });
      expect(res.status, JSON.stringify(display_name)).toBe(422);
    }
    expect(sb.find("POST", "/rest/v1/profiles")).toHaveLength(0);
  });
});

describe("POST /v1/me/oriented (#286: the joining orientation)", () => {
  function orientedStub(): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("POST", AUTHORIZE_RPC, membershipResponder(MEMBER_ID, "member"));
    return sb;
  }

  it("marks the CALLER, in the company they sent, from the session", async () => {
    const sb = orientedStub();
    sb.on("POST", "/rest/v1/rpc/api_mark_oriented", () => ({
      oriented: true,
      marked: true,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/oriented",
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ oriented: true, marked: true });

    // The user id is the verified `sub`. There is no body on this route at
    // all, which is the point: "I have been oriented" is only ever a statement
    // about yourself, and a body would be somewhere to put somebody else's id.
    const call = sb.find("POST", "/rest/v1/rpc/api_mark_oriented")[0];
    expect(call.body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
    });
  });

  it("answers 200 to a repeat, saying it changed nothing", async () => {
    // Two devices can race this: the same person finishes on a phone while the
    // laptop's copy is still open, or a client retries after a dropped
    // response. Neither is an error — they are both already oriented.
    const sb = orientedStub();
    sb.on("POST", "/rest/v1/rpc/api_mark_oriented", () => ({
      oriented: true,
      marked: false,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/oriented",
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ oriented: true, marked: false });
  });

  it("refuses somebody who is not a member of the company they named", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", AUTHORIZE_RPC, membershipResponder(MEMBER_ID, null));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/oriented",
      { method: "POST", companyId: OTHER_COMPANY_ID },
    );
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_mark_oriented")).toHaveLength(0);
  });

  it("carries the orientation on the read the card already makes", async () => {
    // Folded into /v1/me/firsts rather than given a route of its own: it is
    // the same question at the same moment, and a second round trip on app
    // start would cost every member of every workspace forever for a screen
    // each of them sees once.
    const sb = orientedStub();
    sb.on("POST", "/rest/v1/rpc/api_member_firsts", () => ({
      replied: false,
      noted: false,
      marked_done: false,
      oriented: false,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me/firsts", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ oriented: false });
  });
});

describe("PUT /v1/me/dashboard (#540: a member puts a panel away)", () => {
  function dashboardStub(): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("POST", AUTHORIZE_RPC, membershipResponder(MEMBER_ID, "member"));
    return sb;
  }

  it("saves the set for the CALLER, in the company they sent", async () => {
    const sb = dashboardStub();
    sb.on("POST", "/rest/v1/rpc/api_set_dashboard_hidden", () => [
      "pipeline",
      "recent_calls",
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/dashboard",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { hidden: ["pipeline", "recent_calls"] },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: ["pipeline", "recent_calls"] });

    // The user id is the verified `sub`, never the body — there is no request a
    // caller can make that rearranges somebody else's dashboard.
    const call = sb.find("POST", "/rest/v1/rpc/api_set_dashboard_hidden")[0];
    expect(call.body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_hidden: ["pipeline", "recent_calls"],
    });
  });

  it("stores the declared order whatever order the boxes were clicked in", async () => {
    // Otherwise the same screen has several stored spellings, and the next thing
    // that compares two sets — a test, a support answer — is comparing noise.
    const sb = dashboardStub();
    sb.on("POST", "/rest/v1/rpc/api_set_dashboard_hidden", () => [
      "response_time",
      "recent_calls",
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/me/dashboard", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: { hidden: ["recent_calls", "response_time", "recent_calls"] },
    });
    const call = sb.find("POST", "/rest/v1/rpc/api_set_dashboard_hidden")[0];
    expect(call.body).toMatchObject({
      p_hidden: ["response_time", "recent_calls"],
    });
  });

  it("refuses a panel id that is not a panel", async () => {
    // The column is read back on every app load. An open write is how it fills
    // with ids nobody can render, and it never gets cleaned up.
    const sb = dashboardStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/dashboard",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { hidden: ["unassigned"] },
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/rpc/api_set_dashboard_hidden")).toHaveLength(
      0,
    );
  });

  it("refuses to hide a queue section even though it is a real tile id", async () => {
    // THE LINE, asserted at the edge as well as in the shared module: the queue
    // is the work, and "waiting" is a tile a client could plausibly send.
    const sb = dashboardStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/dashboard",
      { method: "PUT", companyId: COMPANY_ID, body: { hidden: ["waiting"] } },
    );
    expect(res.status).toBe(422);
  });

  it("accepts an empty set — that is how a member puts a panel back", async () => {
    const sb = dashboardStub();
    sb.on("POST", "/rest/v1/rpc/api_set_dashboard_hidden", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/dashboard",
      { method: "PUT", companyId: COMPANY_ID, body: { hidden: [] } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: [] });
  });

  it("refuses somebody who is not a member of the company they named", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", AUTHORIZE_RPC, membershipResponder(MEMBER_ID, null));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/dashboard",
      {
        method: "PUT",
        companyId: OTHER_COMPANY_ID,
        body: { hidden: ["pipeline"] },
      },
    );
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_set_dashboard_hidden")).toHaveLength(
      0,
    );
  });

  it("reports a membership deactivated mid-session as forbidden, not as a failed save", async () => {
    // A retry can never work, so an error that invites one is the wrong answer.
    const sb = dashboardStub();
    sb.on("POST", "/rest/v1/rpc/api_set_dashboard_hidden", () =>
      pgError("P0002", "no active membership for this user in this company"),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/me/dashboard",
      {
        method: "PUT",
        companyId: COMPANY_ID,
        body: { hidden: ["pipeline"] },
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/me carries the dashboard preference (#540)", () => {
  it("reads it off the membership rather than a second round trip", async () => {
    // The landing screen has to know the layout BEFORE it paints. A route of its
    // own would render the four measures and then take two away, which reads as
    // a broken page rather than as a preference being honoured.
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/profiles", () => [{ display_name: "Casey Owner" }]);
    sb.on("POST", "/rest/v1/rpc/api_user_has_password", () => true);
    sb.on("GET", "/rest/v1/company_members", () => [
      {
        company_id: COMPANY_ID,
        role: "owner",
        dashboard_hidden: ["recent_calls", "pipeline", "not_a_panel"],
        companies: { name: "Acme Plumbing", subscription_status: "active" },
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: null,
    });
    const body = (await res.json()) as {
      memberships: { dashboard_hidden: string[] }[];
    };
    // Normalised on the way out: the stale id is DROPPED rather than handed to
    // three clients to defend against, and the order is the declared one.
    expect(body.memberships[0].dashboard_hidden).toEqual([
      "pipeline",
      "recent_calls",
    ]);
    // One query, not two — the column rides on the select that was already
    // happening on the hottest route in the product.
    expect(sb.find("GET", "/rest/v1/company_members")).toHaveLength(1);
  });

  it("treats a null column as nothing hidden", async () => {
    // A membership predating the column, and the state every client already
    // renders correctly.
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/profiles", () => [{ display_name: "Casey Owner" }]);
    sb.on("POST", "/rest/v1/rpc/api_user_has_password", () => true);
    sb.on("GET", "/rest/v1/company_members", () => [
      {
        company_id: COMPANY_ID,
        role: "owner",
        dashboard_hidden: null,
        companies: { name: "Acme Plumbing", subscription_status: "active" },
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", {
      companyId: null,
    });
    const body = (await res.json()) as {
      memberships: { dashboard_hidden: string[] }[];
    };
    expect(body.memberships[0].dashboard_hidden).toEqual([]);
  });
});

