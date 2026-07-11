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
  it("admin saves mctb_enabled + mctb_message + forward_to_cell and enables voice", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    // #12: the voice add-on is enabled, so the settings gate lets it through.
    sb.on("GET", "/rest/v1/company_modules", () => [{ module: "voice" }]);
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
        forward_to_cell: "+16135559999",
      },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      mctb_enabled: true,
      mctb_message:
        "Sorry we missed your call — reply with your address and we'll book you in.",
      forward_to_cell: "+16135559999",
    });
  });

  it("without the Call forwarding add-on, turning on voice is a 409 (#12)", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    sb.on("GET", "/rest/v1/company_modules", () => []); // voice module off
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { mctb_enabled: true, forward_to_cell: "+16135559999" },
    });
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("conflict");
    // Blocked before the write — settings untouched.
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("422s an invalid forward_to_cell (not a US/CA number)", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { forward_to_cell: "+447700900000" }, // UK number
    });
    expect(res.status).toBe(422);
    expect(await errorCodeOf(res)).toBe("validation_failed");
  });

  it("clears forward_to_cell with null (and does not enable voice)", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { forward_to_cell: null },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      forward_to_cell: null,
    });
    // No phone_numbers lookup — nothing turned voice on.
    expect(sb.find("GET", "/rest/v1/phone_numbers")).toHaveLength(0);
  });

  it("clears mctb_message with an empty value", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
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
