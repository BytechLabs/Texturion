/**
 * GET /v1/me (SPEC §7): profile + memberships, company-exempt, with optional
 * X-Company-Id hydration (subscription/plan/registration/numbers).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
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
  sb.on("GET", "/rest/v1/company_members", () => [
    {
      company_id: COMPANY_ID,
      role: "owner",
      companies: { name: "Acme Plumbing", subscription_status: "active" },
    },
  ]);
  return sb;
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
      memberships: [
        {
          company_id: COMPANY_ID,
          name: "Acme Plumbing",
          role: "owner",
          subscription_status: "active",
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
