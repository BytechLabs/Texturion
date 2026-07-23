/**
 * POST /v1/companies, GET /v1/company, PATCH /v1/company (SPEC §4.1, §7, §10).
 */
import { DEFAULT_MCTB_MESSAGE } from "@loonext/shared";
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

  it("stages a chosen number on create when its area code matches the country", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({ id: COMPANY_ID }));
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: {
        ...validBody,
        country: "US",
        requested_area_code: "212",
        chosen_number_e164: "+12125550188",
      },
    });
    expect(res.status).toBe(201);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      chosen_number_e164: "+12125550188",
    });
  });

  it("422s a chosen number whose area code is a different country", async () => {
    stubFetch(jwksRoute(auth), supabaseStub(env).route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: {
        ...validBody,
        country: "US",
        requested_area_code: "212",
        chosen_number_e164: "+14165550100", // 416 is a Canadian area code
      },
    });
    expect(res.status).toBe(422);
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

  it("409s when the RPC reports the per-user owner cap (#31)", async () => {
    const sb = supabaseStub(env);
    // Migration 20260707160000: api_create_company refuses a 6th owned
    // workspace with an { outcome: 'owner_cap', limit } sentinel.
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({
      outcome: "owner_cap",
      limit: 5,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212" },
    });
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("conflict");
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
    sb.on("GET", "/rest/v1/company_modules", () => []); // #133 enabled_modules
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
      // #193: with no explicit display name the view resolves the effective
      // caller ID from the company name, platform-wide.
      caller_id_effective: "Acme",
      caller_id_source: "company_name",
    });
  });

  it("selects cancel_at_period_end (and only customer-safe columns) for the view", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/companies", () => [
      { id: COMPANY_ID, cancel_at_period_end: true },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    sb.on("GET", "/rest/v1/company_modules", () => []); // #133 enabled_modules
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
    // #193: a rename while the caller ID defaults re-pushes the listing; with
    // no active numbers the push (and the submitted stamp) is a no-op.
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
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

  it("lets the owner change the pending area code before checkout", async () => {
    const sb = stubWithRole("owner");
    // Pre-checkout precheck: incomplete company in the US.
    sb.on("GET", "/rest/v1/companies", () => [
      { country: "US", subscription_status: "incomplete" },
    ]);
    sb.on("PATCH", "/rest/v1/companies", () => [
      { id: COMPANY_ID, requested_area_code: "212" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { requested_area_code: "212" }, // Manhattan, a US geographic code
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      requested_area_code: "212",
      // An area-code change clears any stale onboarding number pick.
      chosen_number_e164: null,
    });
  });

  it("409s an area-code change once the number has been ordered (past checkout)", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/companies", () => [
      { country: "US", subscription_status: "active" },
    ]);
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { requested_area_code: "212" },
    });
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("conflict");
    // Gated before the write — the area code never reaches the DB.
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("422s an area code that isn't geographic for the company's country", async () => {
    for (const bad of ["416", "800", "999"]) {
      // 416 = Canadian code on a US company; 800 = non-geographic; 999 = unassigned.
      const sb = stubWithRole("owner");
      sb.on("GET", "/rest/v1/companies", () => [
        { country: "US", subscription_status: "incomplete" },
      ]);
      sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { requested_area_code: bad },
      });
      expect(res.status, `area code ${bad}`).toBe(422);
      expect(await errorCodeOf(res)).toBe("validation_failed");
      expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
    }
  });

  it("lets the owner switch country before checkout (with a new area code)", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/companies", () => [
      { country: "US", subscription_status: "incomplete" },
    ]);
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { country: "CA", requested_area_code: "416" }, // Toronto
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      requested_area_code: "416",
      country: "CA",
      // A country change clears any stale onboarding number pick.
      chosen_number_e164: null,
    });
  });

  it("422s a country change without a matching new area code", async () => {
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/companies", () => [
      { country: "US", subscription_status: "incomplete" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { country: "CA" }, // no new area code for the new country
    });
    expect(res.status).toBe(422);
    expect(await errorCodeOf(res)).toBe("validation_failed");
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
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

    // #12 Phase 0.3: "no cap" (null) is no longer allowed — it resolves to the
    // 10x hard ceiling (companies_overage_cap_range), not a disabled cap.
    const remove = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { overage_cap_multiplier: null },
    });
    expect(remove.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[1].body).toEqual({
      overage_cap_multiplier: 10,
    });

    // Above the 10x ceiling is rejected (422) — the cap can't be raised past it.
    const tooHigh = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { overage_cap_multiplier: 25 },
    });
    expect(tooHigh.status).toBe(422);
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

describe("PATCH /v1/company — send-features settings (FEATURE-GAPS Steps 1 & 2)", () => {
  it("admin saves business_hours, away_enabled and away_message (Step 1)", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: {
        business_hours: { mon: { open: "08:00", close: "17:00" }, sun: null },
        away_enabled: true,
        away_message:
          "Thanks — we reply by 8am. For a no-heat emergency reply URGENT.",
      },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      business_hours: { mon: { open: "08:00", close: "17:00" }, sun: null },
      away_enabled: true,
      away_message:
        "Thanks — we reply by 8am. For a no-heat emergency reply URGENT.",
    });
  });

  it("422s malformed business_hours (bad weekday / bad HH:MM)", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    for (const business_hours of [
      { funday: { open: "08:00", close: "17:00" } },
      { mon: { open: "8", close: "17:00" } },
      { mon: { open: "08:00", close: "25:00" } },
    ]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { business_hours },
      });
      expect(res.status, JSON.stringify(business_hours)).toBe(422);
    }
  });

  it("clears away_message with an empty/null value", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { away_message: null },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      away_message: null,
    });
  });

  it("403s a plain member trying to change away settings", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { away_enabled: true },
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /v1/company — missed-call text-back (FEATURE-GAPS voice wave)", () => {
  it("admin saves mctb_enabled + mctb_message and enables voice", async () => {
    const sb = stubWithRole("admin");
    // #134 review: ENABLING call features reads the subscription status (an
    // honest 402 for canceled/pre-checkout beats a silently dead setting).
    sb.on("GET", "/rest/v1/companies", () => [
      { subscription_status: "active" },
    ]);
    sb.on("PATCH", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        mctb_enabled: true,
        mctb_message:
          "Sorry we missed your call — reply with your address and we'll book you in.",
      },
    ]);
    // #134/D42: NO company_modules stub — the settings path never reads
    // module state anymore (a read would fail the test loudly).
    // enableVoiceForCompany lists active numbers; none active → no voice calls,
    // but the settings write still succeeds.
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: {
        mctb_enabled: true,
        mctb_message:
          "Sorry we missed your call — reply with your address and we'll book you in.",
      },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      mctb_enabled: true,
      mctb_message:
        "Sorry we missed your call — reply with your address and we'll book you in.",
    });
    // #192: the echo carries the derived pair — the owner's text is in effect.
    expect(await res.json()).toMatchObject({
      mctb_effective_message:
        "Sorry we missed your call — reply with your address and we'll book you in.",
      mctb_message_is_custom: true,
    });
  });

  it("turning on voice settings needs NO add-on (#134/D42 — calling is included on every plan)", async () => {
    // Pre-#134 this exact request 409'd ("needs the Calling add-on") when the
    // company had no voice module row. The module is retired: the PATCH
    // succeeds with no module read at all, and voice-binds the numbers. The
    // one remaining gate is a LIVE SUBSCRIPTION (#134 review — honest 402
    // instead of a silently dead setting).
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/companies", () => [
      { subscription_status: "active" },
    ]);
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { mctb_enabled: true },
    });
    expect(res.status).toBe(200);
    // The settings write landed…
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      mctb_enabled: true,
    });
    // …no module gate consulted…
    expect(sb.find("GET", "/rest/v1/company_modules")).toHaveLength(0);
    // …and the voice-bind pass ran (idempotent no-op with no active numbers).
    expect(sb.find("GET", "/rest/v1/phone_numbers")).toHaveLength(1);
  });

  it("D43: forward_to_cell is DELETED — a PATCH carrying it is a 422 unknown field", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { forward_to_cell: "+16135559999" },
    });
    // The schema no longer knows the field; with nothing else in the body
    // the "provide at least one field" refinement refuses it.
    expect(res.status).toBe(422);
    expect(await errorCodeOf(res)).toBe("validation_failed");
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("clears mctb_message with an empty value — the PRODUCT DEFAULT takes over (#192)", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [
      { id: COMPANY_ID, mctb_message: null },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { mctb_message: "" },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      mctb_message: null,
    });
    // #192: cleared custom text → the echo reports the default as effective.
    expect(await res.json()).toMatchObject({
      mctb_effective_message: DEFAULT_MCTB_MESSAGE,
      mctb_message_is_custom: false,
    });
  });

  it("403s a plain member trying to change the missed-call text-back", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { mctb_enabled: true },
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /v1/company — call-feature honesty gate (#134 review)", () => {
  it("enabling MCTB/forwarding on a canceled workspace is an honest 402", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/companies", () => [
      { subscription_status: "canceled" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { mctb_enabled: true },
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: "subscription_inactive" },
    });
    // The settings write never happened.
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("DISABLING call features never needs a subscription (cleanup is free)", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { mctb_enabled: false },
    });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /v1/company — #193 caller ID defaults to the company name", () => {
  const TELNYX_PN_ID = "9999999999";

  /** One active Telnyx-purchased number for the outbound listing push. */
  function stubActiveNumber(sb: SupabaseStub): void {
    sb.on("GET", "/rest/v1/phone_numbers", () => [
      { id: "n-1", telnyx_phone_number_id: TELNYX_PN_ID },
    ]);
  }

  /** Captures the Telnyx /voice sub-resource PATCH (the carrier-side push). */
  function telnyxVoicePush(): { calls: unknown[]; route: (url: URL, request: Request) => Promise<Response | undefined> } {
    const calls: unknown[] = [];
    return {
      calls,
      route: async (url: URL, request: Request) => {
        if (
          request.method !== "PATCH" ||
          url.pathname !== `/v2/phone_numbers/${TELNYX_PN_ID}/voice`
        ) {
          return undefined;
        }
        calls.push(JSON.parse(await request.clone().text()));
        return Response.json({ data: {} });
      },
    };
  }

  it("an explicit change saves the override, stamps cnam_submitted_at, and pushes it", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", (call) => [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing",
        cnam_display_name: "ACE PLUMBERS",
        cnam_submitted_at: (call.body as Record<string, unknown>)
          .cnam_submitted_at,
      },
    ]);
    stubActiveNumber(sb);
    const push = telnyxVoicePush();
    stubFetch(jwksRoute(auth), sb.route, push.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { cnam_display_name: "ACE PLUMBERS" },
    });
    expect(res.status).toBe(200);

    // The deliberate change is stamped in the SAME write (the pending state).
    const patchBody = sb.find("PATCH", "/rest/v1/companies")[0]
      .body as Record<string, unknown>;
    expect(patchBody.cnam_display_name).toBe("ACE PLUMBERS");
    expect(typeof patchBody.cnam_submitted_at).toBe("string");

    // The carrier-side listing carries the explicit name.
    expect(push.calls).toEqual([
      {
        cnam_listing: {
          cnam_listing_enabled: true,
          cnam_listing_details: "ACE PLUMBERS",
        },
      },
    ]);

    // The echo resolves the effective value for clients.
    expect(await res.json()).toMatchObject({
      caller_id_effective: "ACE PLUMBERS",
      caller_id_source: "custom",
    });
  });

  it("clearing the override falls back to the company name, NOT to no listing", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing & Co.",
        cnam_display_name: null,
      },
    ]);
    stubActiveNumber(sb);
    const push = telnyxVoicePush();
    stubFetch(jwksRoute(auth), sb.route, push.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { cnam_display_name: null },
    });
    expect(res.status).toBe(200);

    // Server-side fallback rule: the pushed listing is the sanitized company
    // name (carrier alphabet, 15 chars) — never a disabled listing.
    expect(push.calls).toEqual([
      {
        cnam_listing: {
          cnam_listing_enabled: true,
          cnam_listing_details: "Acme Plumbing C",
        },
      },
    ]);
    expect(await res.json()).toMatchObject({
      caller_id_effective: "Acme Plumbing C",
      caller_id_source: "company_name",
    });
  });

  it("a rename while defaulting re-pushes the listing and stamps the submission", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", (call) => {
      const body = call.body as Record<string, unknown>;
      // First write = the rename; second = the background submitted stamp.
      return [
        body.name !== undefined
          ? { id: COMPANY_ID, name: body.name, cnam_display_name: null }
          : { id: COMPANY_ID },
      ];
    });
    stubActiveNumber(sb);
    const push = telnyxVoicePush();
    stubFetch(jwksRoute(auth), sb.route, push.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { name: "Bolt Electric" },
    });
    expect(res.status).toBe(200);

    // The effective caller ID follows the new name out to the carrier side.
    expect(push.calls).toEqual([
      {
        cnam_listing: {
          cnam_listing_enabled: true,
          cnam_listing_details: "Bolt Electric",
        },
      },
    ]);

    // The submission is stamped once the push reached a number.
    const patches = sb.find("PATCH", "/rest/v1/companies");
    expect(patches).toHaveLength(2);
    expect(patches[0].body).toEqual({ name: "Bolt Electric" });
    expect(
      typeof (patches[1].body as Record<string, unknown>).cnam_submitted_at,
    ).toBe("string");
  });

  it("a rename with a CUSTOM caller ID set leaves the listing alone", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        name: "Bolt Electric",
        cnam_display_name: "ACE PLUMBERS",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { name: "Bolt Electric" },
    });
    expect(res.status).toBe(200);
    // No phone_numbers read, no Telnyx push, no second companies write.
    expect(sb.find("GET", "/rest/v1/phone_numbers")).toHaveLength(0);
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(1);
    expect(await res.json()).toMatchObject({
      caller_id_effective: "ACE PLUMBERS",
      caller_id_source: "custom",
    });
  });
});
