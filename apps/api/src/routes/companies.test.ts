/**
 * POST /v1/companies, GET /v1/company, PATCH /v1/company (SPEC §4.1, §7, §10).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
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
import { companiesRoutes } from "./companies";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;
const app = buildTestApp(companiesRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWithRole(role: string | null): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

const validBody = {
  name: "Acme Plumbing",
  country: "US",
  requested_area_code: "416", // wrong on purpose in some tests below
  aup_accepted: true,
};

async function errorCodeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("POST /v1/companies (company-exempt)", () => {
  it("creates the company via api_create_company and returns 201", async () => {
    const sb = supabaseStub(env);
    const company = {
      id: COMPANY_ID,
      name: "Acme Plumbing",
      country: "US",
      subscription_status: "incomplete",
    };
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => company);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212", country: "US" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(company);

    const rpc = sb.find("POST", "/rest/v1/rpc/api_create_company")[0];
    expect(rpc.body).toEqual({
      p_owner_user_id: auth.subject,
      p_name: "Acme Plumbing",
      p_country: "US",
      p_requested_area_code: "212",
      p_us_texting_enabled: true,
    });
  });

  it("defaults CA companies to us_texting_enabled=true and honors false", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({ id: COMPANY_ID }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: {
        ...validBody,
        country: "CA",
        requested_area_code: "416",
        us_texting_enabled: false,
      },
    });
    expect(res.status).toBe(201);
    const rpc = sb.find("POST", "/rest/v1/rpc/api_create_company")[0];
    expect(rpc.body).toMatchObject({
      p_country: "CA",
      p_us_texting_enabled: false,
    });
  });

  it("422s without AUP acceptance (missing or false)", async () => {
    stubFetch(jwksRoute(auth), supabaseStub(env).route);
    for (const aup of [undefined, false]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/companies",
        {
          method: "POST",
          companyId: null,
          body: { ...validBody, requested_area_code: "212", aup_accepted: aup },
        },
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        error: { code: "validation_failed", message: expect.any(String) },
      });
    }
  });

  it("422s when the area code is not US/CA-assigned or mismatches the country", async () => {
    stubFetch(jwksRoute(auth), supabaseStub(env).route);
    const cases = [
      { country: "US", requested_area_code: "242" }, // Bahamas
      { country: "US", requested_area_code: "999" }, // unassigned
      { country: "US", requested_area_code: "416" }, // Canadian code, US company
      { country: "CA", requested_area_code: "212" }, // US code, CA company
      { country: "US", requested_area_code: "800" }, // non-geographic
    ];
    for (const overrides of cases) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/companies",
        { method: "POST", companyId: null, body: { ...validBody, ...overrides } },
      );
      expect(res.status, JSON.stringify(overrides)).toBe(422);
    }
  });

  it("passes the browser's IANA timezone through to api_create_company (D15)", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({ id: COMPANY_ID }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: {
        ...validBody,
        requested_area_code: "212",
        timezone: "America/Vancouver",
      },
    });
    expect(res.status).toBe(201);
    expect(sb.find("POST", "/rest/v1/rpc/api_create_company")[0].body).toMatchObject(
      { p_timezone: "America/Vancouver" },
    );
  });

  it("omits p_timezone when the body carries none (SQL default applies, D15)", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({ id: COMPANY_ID }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212" },
    });
    expect(res.status).toBe(201);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_create_company")[0].body,
    ).not.toHaveProperty("p_timezone");
  });

  it("422s an invalid timezone at create (D15 IANA validation)", async () => {
    stubFetch(jwksRoute(auth), supabaseStub(env).route);
    for (const timezone of ["Not/AZone", "EST5EDT-nonsense", "Toronto", ""]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/companies",
        {
          method: "POST",
          companyId: null,
          body: { ...validBody, requested_area_code: "212", timezone },
        },
      );
      expect(res.status, timezone).toBe(422);
      expect(await errorCodeOf(res)).toBe("validation_failed");
    }
  });

  it("422s when a US company tries us_texting_enabled=false", async () => {
    stubFetch(jwksRoute(auth), supabaseStub(env).route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: {
        ...validBody,
        requested_area_code: "212",
        us_texting_enabled: false,
      },
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /v1/company", () => {
  it("returns company + numbers + registration for any member", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/companies", () => [
      { id: COMPANY_ID, name: "Acme", plan: "pro", subscription_status: "active" },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: COMPANY_ID,
      plan: "pro",
      numbers: [],
      registration: { brand: null, campaign: null },
    });
  });

  it("selects cancel_at_period_end (and only customer-safe columns) for the view", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/companies", () => [
      { id: COMPANY_ID, cancel_at_period_end: true },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cancel_at_period_end: true });

    // SPEC §9 "handle cancel_at_period_end display" — the flag is part of the
    // company view; Stripe/Telnyx internals stay server-side (SPEC §10).
    const select = sb
      .find("GET", "/rest/v1/companies")[0]
      .url.searchParams.get("select");
    expect(select).toContain("cancel_at_period_end");
    expect(select).toContain("timezone"); // D15: exposed in the company view
    expect(select).not.toContain("stripe_");
    expect(select).not.toContain("telnyx_");
  });

  it("403s a non-member", async () => {
    const sb = stubWithRole(null);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /v1/company (O/A; cap owner-only)", () => {
  it("403s a plain member (role gate)", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { name: "New Name" },
    });
    expect(res.status).toBe(403);
  });

  it("lets an admin rename but NOT touch the overage cap", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [
      { id: COMPANY_ID, name: "New Name" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const rename = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { name: "New Name" },
    });
    expect(rename.status).toBe(200);
    const patchCall = sb.find("PATCH", "/rest/v1/companies")[0];
    expect(patchCall.body).toEqual({ name: "New Name" });

    const cap = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { overage_cap_multiplier: 5 },
    });
    expect(cap.status).toBe(403);
  });

  it("lets the owner set and remove the overage cap", async () => {
    const sb = stubWithRole("owner");
    sb.on("PATCH", "/rest/v1/companies", () => [
      { id: COMPANY_ID, overage_cap_multiplier: 5 },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const raise = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { overage_cap_multiplier: 5 },
    });
    expect(raise.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      overage_cap_multiplier: 5,
    });

    const remove = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { overage_cap_multiplier: null },
    });
    expect(remove.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[1].body).toEqual({
      overage_cap_multiplier: null,
    });
  });

  it("lets an admin set the timezone; invalid zones are 422 (D15)", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [
      { id: COMPANY_ID, timezone: "America/Denver" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const ok = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { timezone: "America/Denver" },
    });
    expect(ok.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      timezone: "America/Denver",
    });

    const bad = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { timezone: "Eastern" },
    });
    expect(bad.status).toBe(422);
    expect(await errorCodeOf(bad)).toBe("validation_failed");
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(1);
  });

  it("422s an empty patch and a non-positive cap", async () => {
    const sb = stubWithRole("owner");
    stubFetch(jwksRoute(auth), sb.route);
    for (const body of [{}, { overage_cap_multiplier: 0 }, { name: "" }]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
        method: "PATCH",
        companyId: COMPANY_ID,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});
