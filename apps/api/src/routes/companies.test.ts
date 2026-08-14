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
    "POST",
    "/rest/v1/rpc/api_authorize_request",
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

/**
 * #296 — the landing page a signup came from.
 *
 * The values arrive from `window.location` on a PUBLIC marketing page, so the
 * browser's own allow-list is a courtesy, not a control. Everything below is
 * about the server re-doing that work: what lands in a column has to be safe
 * even when the request was hand-crafted with curl.
 */
/**
 * #303 — screening a new workspace's name against the categories §4 prohibits.
 *
 * SS-2 is the one that matters. This exists to catch a dispensary before a
 * carrier complaint does, and it must never be the reason a real contractor
 * cannot sign up: the screen flags, a person decides, and the workspace is
 * created either way. A signup that failed because an ops mailbox was down
 * would be a far worse bug than the one this prevents.
 */
describe("POST /v1/companies — AUP signup screening (#303)", () => {
  function world() {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({ id: COMPANY_ID }));
    return sb;
  }

  it("SS-1: a name suggesting a prohibited category alerts somebody", async () => {
    const sb = world();
    const sent: unknown[] = [];
    stubFetch(jwksRoute(auth), sb.route, (url, request) => {
      if (!url.href.includes("resend")) return undefined;
      return request.text().then((body) => {
        sent.push(JSON.parse(body));
        return Response.json({ id: "email-1" });
      });
    });

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212", name: "Green Leaf Dispensary" },
    });
    expect(res.status).toBe(201);

    const email = sent[0] as { subject: string; text: string };
    expect(email.subject).toMatch(/cannabis/i);
    // Never a verdict: whoever opens this is about to look at a real business.
    expect(email.subject).not.toMatch(/violation|prohibited business/i);
    expect(email.text).toMatch(/not\s+a finding/i);
  });

  it("SS-2: an ordinary contractor is not alerted on, and never blocked", async () => {
    // THE ONE THAT MATTERS. A screen that fires on real customers trains
    // whoever reads it to dismiss the queue, and one that could block a signup
    // would be a worse bug than the problem it solves.
    const sb = world();
    const sent: unknown[] = [];
    stubFetch(jwksRoute(auth), sb.route, (url, request) => {
      if (!url.href.includes("resend")) return undefined;
      return request.text().then((body) => {
        sent.push(JSON.parse(body));
        return Response.json({ id: "email-1" });
      });
    });

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212", name: "Colt Plumbing & Heating" },
    });
    expect(res.status).toBe(201);
    expect(sent).toEqual([]);
  });

  it("SS-3: the workspace is created even when the alert cannot be sent", async () => {
    // The alert is best-effort by construction. A workspace that exists must
    // not fail to be created because an ops mailbox was unreachable.
    const sb = world();
    stubFetch(jwksRoute(auth), sb.route, (url) =>
      url.href.includes("resend")
        ? new Response("upstream down", { status: 500 })
        : undefined,
    );

    const res = await apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212", name: "Green Leaf Dispensary" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: COMPANY_ID });
  });
});

describe("POST /v1/companies — how did you hear about us (#288)", () => {
  function createStub(): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({ id: COMPANY_ID }));
    return sb;
  }

  async function create(body: Record<string, unknown>): Promise<Response> {
    return apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212", ...body },
    });
  }

  it("records the answer on the company", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await create({ signup_source: "another_business" });
    expect(res.status).toBe(201);

    const [update] = sb.find("PATCH", "/rest/v1/companies");
    expect(update.body).toEqual({ signup_source: "another_business" });
    expect(update.url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("writes nothing at all when the question was skipped", async () => {
    // NULL means never answered, and that has to stay distinguishable from
    // every answer. A skipped question stored as "other" would quietly become
    // the largest source we have.
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await create({});
    expect(res.status).toBe(201);
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("carries the crew size in the SAME write rather than a second one", async () => {
    // #370 and #288 are one follow-up update. Two PATCHes for two optional
    // segmentation fields is two round trips on the signup path.
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    await create({ signup_source: "search", crew_size: "solo" });
    const updates = sb.find("PATCH", "/rest/v1/companies");
    expect(updates).toHaveLength(1);
    expect(updates[0].body).toEqual({
      crew_size: "solo",
      signup_source: "search",
    });
  });

  it("refuses an answer that is not one of the four", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);
    const res = await create({ signup_source: "billboard" });
    expect(res.status).toBe(422);
  });

  it("still creates the workspace when the answer cannot be stored", async () => {
    // THE ONE THAT MATTERS. This is a question asked for our benefit, and it
    // must never be able to cost somebody their signup.
    const sb = createStub();
    sb.on("PATCH", "/rest/v1/companies", () => {
      throw new Error("column is having a bad day");
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await create({ signup_source: "another_business" });
    expect(res.status).toBe(201);
    // And it was genuinely attempted — otherwise this passes because the write
    // never happened rather than because the failure was swallowed.
    expect(sb.find("PATCH", "/rest/v1/companies").length).toBeGreaterThan(0);
  });
});

describe("POST /v1/companies — first-touch attribution (#296)", () => {
  function createStub(): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_create_company", () => ({ id: COMPANY_ID }));
    return sb;
  }

  async function create(body: Record<string, unknown>): Promise<Response> {
    return apiRequest(app, env, await auth.token(), "/v1/companies", {
      method: "POST",
      companyId: null,
      body: { ...validBody, requested_area_code: "212", ...body },
    });
  }

  it("records the landing page, referrer and campaign on the company", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await create({
      first_touch: {
        landing_path: "/for/plumbers",
        referrer_host: "www.google.com",
        params: { utm_source: "google", utm_campaign: "spring" },
      },
    });
    expect(res.status).toBe(201);

    const [update] = sb.find("PATCH", "/rest/v1/companies");
    expect(update.body).toEqual({
      signup_landing_path: "/for/plumbers",
      signup_first_touch: {
        referrer_host: "www.google.com",
        params: { utm_source: "google", utm_campaign: "spring" },
      },
    });
    expect(update.url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("drops parameters that are not on the allow-list", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    // `phone` and `email` are exactly what the web scrubber exists to cut, and
    // a caller that skips the browser can put them here directly.
    await create({
      first_touch: {
        landing_path: "/pricing",
        params: {
          utm_source: "google",
          phone: "+14165551234",
          email: "owner@example.ca",
        },
      },
    });

    const [update] = sb.find("PATCH", "/rest/v1/companies");
    expect(update.body).toEqual({
      signup_landing_path: "/pricing",
      signup_first_touch: { referrer_host: null, params: { utm_source: "google" } },
    });
  });

  it("rejects a landing path that is really an off-site redirect", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    await create({
      first_touch: { landing_path: "//evil.example.com/phish" },
    });

    // Nothing worth storing survived, so no write happened at all.
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("strips a query string smuggled inside the landing path", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    await create({
      first_touch: { landing_path: "/for/plumbers?email=owner@example.ca" },
    });

    const [update] = sb.find("PATCH", "/rest/v1/companies");
    expect(update.body).toMatchObject({ signup_landing_path: "/for/plumbers" });
  });

  it("does not write when the touch carries nothing usable", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    await create({ first_touch: { params: {} } });

    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("still creates the workspace when the attribution write fails", async () => {
    const sb = createStub();
    sb.on("PATCH", "/rest/v1/companies", () => {
      throw new Error("column disappeared");
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await create({
      first_touch: { landing_path: "/for/plumbers", params: {} },
    });

    // Attribution is a measurement. It must never cost somebody a signup.
    expect(res.status).toBe(201);
  });

  it("creates the workspace normally when no touch was recorded", async () => {
    const sb = createStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await create({});

    expect(res.status).toBe(201);
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
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
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []); // #106 gate → unrestricted
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

  it("#106: filters numbers hidden from a restricted member out of the view", async () => {
    const VISIBLE = "11111111-0000-4000-8000-000000000001";
    const HIDDEN = "22222222-0000-4000-8000-000000000002";
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/companies", () => [
      { id: COMPANY_ID, name: "Acme", plan: "pro" },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => [
      { id: VISIBLE, number_e164: "+14165550111", status: "active" },
      { id: HIDDEN, number_e164: "+14165550222", status: "active" },
    ]);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    sb.on("GET", "/rest/v1/company_modules", () => []);
    // One admins-only rule the member can't match → HIDDEN resolves to 'none';
    // the un-ruled VISIBLE number stays visible.
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: HIDDEN, level: "none" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { numbers: { id: string }[] };
    expect(body.numbers.map((n) => n.id)).toEqual([VISIBLE]);
  });

  it("selects cancel_at_period_end (and only customer-safe columns) for the view", async () => {
    // #515: the caller is an OWNER here on purpose. The column is still
    // SELECTED for everybody — the redaction happens in the projection, not the
    // query — but it only leaves the API for a caller who holds billing.manage,
    // so asserting the value needs a role that is told it.
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/companies", () => [
      { id: COMPANY_ID, cancel_at_period_end: true },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    sb.on("GET", "/rest/v1/company_modules", () => []); // #133 enabled_modules
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []); // #106 gate → unrestricted
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

/**
 * #515 — the money picture is not everybody's.
 *
 * A member could not see /settings/billing in the nav and could read every
 * number on it by typing the URL, because the page's data is this route and
 * this route is `workspace.access`. The gate is right (the app BOOTS on it);
 * the payload was not. These tests hold both halves of that: the workspace's
 * commercial state leaves only for a caller with `billing.manage`, and a plain
 * member still gets everything the app needs to run.
 *
 * GET /v1/me is not exercised here (different sub-app) but inherits the same
 * fix: both routes hydrate through `loadCompanyView`, which is the whole reason
 * the redaction lives there rather than at a route gate — /v1/me is
 * company-exempt and has no role for a gate to read.
 */
describe("#232 the widget key", () => {
  it("is readable by somebody who can manage settings", async () => {
    // The key ends up in a page's source, so it is public in effect — but it
    // is behind `settings.manage` because the person who reads it is the
    // person installing the widget, and the rotate beside it is destructive.
    const sb = stubWithRole("owner");
    sb.on("GET", "/rest/v1/companies", () => [
      { widget_key: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company/widget-key", {
      companyId: COMPANY_ID,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      widget_key: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    });
  });

  it("is not readable by a member who cannot manage settings", async () => {
    // A bookkeeper or a tech has no reason to hold the key that identifies the
    // workspace's embeds, and the rotate on the same capability is an outage.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company/widget-key", {
      companyId: COMPANY_ID,
    });

    expect(res.status).toBe(403);
  });

  it("returns the NEW key when rotated, so the snippet on screen is the live one", async () => {
    // The one thing somebody must do immediately after rotating is paste the
    // new snippet. Returning the key means the screen can update without a
    // refetch that might race the write.
    const sb = stubWithRole("owner");
    let updated: unknown = null;
    sb.on("PATCH", "/rest/v1/companies", (call) => {
      updated = call.body;
      return [{ widget_key: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb" }];
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/company/widget-key/rotate",
      { companyId: COMPANY_ID, method: "POST" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      widget_key: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
    });
    // The new key is minted SERVER-side. A client-supplied one would let a
    // caller choose a key somebody else's embed already carries.
    expect(updated).toHaveProperty("widget_key");
    expect(String((updated as { widget_key: string }).widget_key)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe("GET /v1/company — billing fields follow billing.manage (#515)", () => {
  /** Every money column, populated, so redaction has something to remove. */
  const COMMERCIAL_ROW = {
    billing_currency: "cad",
    current_period_start: "2026-07-01T00:00:00Z",
    current_period_end: "2026-08-01T00:00:00Z",
    overage_cap_multiplier: "3.00",
    registration_fee_paid_at: "2026-06-01T00:00:00Z",
    canceled_at: "2026-07-20T00:00:00Z",
    cancel_at_period_end: true,
    offramp_message: "We've moved to 555-0123 — call or text us there.",
    offramp_opted_in_at: "2026-07-20T00:00:00Z",
  };

  const BILLING_FIELDS = Object.keys(COMMERCIAL_ROW);

  async function companyAs(role: string): Promise<Record<string, unknown>> {
    const sb = stubWithRole(role);
    sb.on("GET", "/rest/v1/companies", () => [
      {
        id: COMPANY_ID,
        name: "Acme",
        country: "CA",
        us_texting_enabled: false,
        timezone: "America/Toronto",
        plan: "pro",
        subscription_status: "active",
        mfa_grace_until: "2026-09-01T00:00:00Z",
        ...COMMERCIAL_ROW,
      },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => [
      { id: "n-1", number_e164: "+14165550111", status: "active" },
    ]);
    sb.on("GET", "/rest/v1/messaging_registrations", () => [
      { kind: "brand", status: "approved" },
    ]);
    sb.on("GET", "/rest/v1/company_modules", () => [{ module: "voice" }]);
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      companyId: COMPANY_ID,
    });
    expect(res.status, role).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    vi.unstubAllGlobals();
    return body;
  }

  it("withholds the workspace's commercial state from a member", async () => {
    const body = await companyAs("member");
    for (const field of BILLING_FIELDS) {
      expect(body, field).not.toHaveProperty(field);
    }
  });

  it("OMITS them rather than nulling them — a null would be an answer", async () => {
    // `canceled_at: null` states this workspace is not winding down and
    // `cancel_at_period_end: false` that no cancellation is scheduled. Both
    // would be false here. An absent key says only "you were not told", which
    // is the only honest thing a redaction can say.
    const body = await companyAs("member");
    expect(Object.keys(body)).not.toContain("canceled_at");
    expect(Object.keys(body)).not.toContain("cancel_at_period_end");
  });

  it("still hands a member everything the app boots on", async () => {
    // The point of fixing this in the projection instead of the route gate:
    // the app-wide status banner, the MFA gate and every composer banner read
    // this route for EVERY role. A member who cannot load it cannot work.
    const body = await companyAs("member");
    expect(body).toMatchObject({
      id: COMPANY_ID,
      name: "Acme",
      country: "CA",
      us_texting_enabled: false,
      timezone: "America/Toronto",
      // Deliberately NOT redacted: the "this workspace can't send" banner and
      // the composer gate need it, and /v1/me publishes it per membership with
      // no gate at all — hiding it here would blind a member and reveal nothing.
      subscription_status: "active",
      // A tier name is not money, and seat_limit discloses it anyway.
      plan: "pro",
      seat_limit: 15,
      // The member's "waiting on approval" banner is derived from this.
      registration: { brand: { status: "approved" } },
      // #314: a deadline you meet as a wall was never given to you.
      mfa_grace_until: "2026-09-01T00:00:00Z",
      // #133: every calling surface gates on this.
      enabled_modules: ["voice"],
      // A client that misses this decodes it as TRUE and restores the very
      // controls the kill switch exists to hide.
      billing_writes_enabled: true,
      // #192/#193: the derived, server-resolved effective values.
      caller_id_effective: "Acme",
    });
    expect((body.numbers as unknown[]).length).toBe(1);
  });

  it("withholds them from a read-only observer too", async () => {
    // #315's outside accountant or consultant: sees the work, not the books.
    const body = await companyAs("read_only");
    for (const field of BILLING_FIELDS) {
      expect(body, field).not.toHaveProperty(field);
    }
  });

  it("gives the BOOKKEEPER the lot — the preset exists for exactly this", async () => {
    // The #315 trap in one test: a rank check (`owner || admin`) would refuse
    // the one role built to do the books, and that refusal is what sends an
    // owner back to sharing their login.
    const body = await companyAs("bookkeeper");
    expect(body).toMatchObject(COMMERCIAL_ROW);
  });

  it("gives an admin and an owner the lot", async () => {
    for (const role of ["admin", "owner"]) {
      const body = await companyAs(role);
      expect(body, role).toMatchObject(COMMERCIAL_ROW);
    }
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

  it("keeps per-member response times off limits to an admin (#239)", async () => {
    // An admin can already change the shop's hours and its away message. Deciding
    // that every tech's median reply time is visible to the whole crew is a
    // different kind of decision — motivating in some crews and toxic in others —
    // and #239 asks for it to be the owner's, so it sits beside the overage cap
    // rather than with the ordinary settings.
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { response_stats_per_member: true },
    });
    expect(res.status).toBe(403);
    // Refused before the write, not after it.
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("lets the owner turn per-member response times on and off (#239)", async () => {
    for (const value of [true, false]) {
      const sb = stubWithRole("owner");
      sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
      sb.on("GET", "/rest/v1/phone_numbers", () => []);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { response_stats_per_member: value },
      });
      expect(res.status, String(value)).toBe(200);
      expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
        response_stats_per_member: value,
      });
      vi.unstubAllGlobals();
    }
  });

  it("echoes the billing kill switch, so a merge cannot restore billing controls", async () => {
    // The switch is a runtime setting rather than a column, so it is absent
    // from the updated row. Clients merge this echo into their cached company,
    // and a missing flag decodes to enabled: saving an unrelated setting would
    // silently bring back the in-app plan and module controls it exists to
    // hide.
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [
      { id: COMPANY_ID, name: "New Name" },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      { ...env, BILLING_WRITES_DISABLED: "1" },
      await auth.token(),
      "/v1/company",
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "New Name" } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { billing_writes_enabled: boolean };
    expect(body.billing_writes_enabled).toBe(false);
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

    // A positive-but-tiny cap (0.004) rounds to 0 at 2dp and would otherwise
    // trip the DB CHECK (> 0) as a raw 500 — it's now a clean 422 pre-DB.
    const roundsToZero = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { overage_cap_multiplier: 0.004 },
    });
    expect(roundsToZero.status).toBe(422);
    expect(await errorCodeOf(roundsToZero)).toBe("validation_failed");
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

describe("PATCH /v1/company — the language automated texts go out in (#228)", () => {
  it("saves a supported locale", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { locale: "fr-CA" },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      locale: "fr-CA",
    });
  });

  it("422s a locale nothing is written in", async () => {
    // The check constraint would refuse it anyway, but a 422 names the field
    // while a constraint violation arrives as a 500 nobody can act on. And a
    // locale that reached the send path unrecognised would silently fall back
    // to English, which looks like the feature not working.
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    for (const locale of ["fr", "FR-CA", "fr_CA", "de", ""]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { locale },
      });
      expect(res.status, locale).toBe(422);
    }
  });

  it("refuses to null it: a business always works in some language", async () => {
    // Unlike the per-contact override, where null means "follow the company",
    // there is nothing above a company to follow.
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { locale: null },
    });
    expect(res.status).toBe(422);
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

describe("PATCH /v1/company — the quiet-hours confirmation switch (#225 ask 5)", () => {
  it("an admin switches the confirmation step off", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { quiet_hours_confirm_enabled: false },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      quiet_hours_confirm_enabled: false,
    });
  });

  it("a member cannot: it is company config with a liability attached", async () => {
    // The whole point of ask 5 is that an ADMIN consciously accepts something.
    // A tech dismissing a dialog they find annoying is not that.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { quiet_hours_confirm_enabled: false },
    });
    expect(res.status).toBe(403);
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("counts as a field, so it alone satisfies the at-least-one-field rule", async () => {
    // The refine() clause enumerates fields by hand, and a boolean left out of
    // it 422s a body that is perfectly valid — the failure mode is invisible
    // until somebody flips only this switch.
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { quiet_hours_confirm_enabled: true },
    });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /v1/company — the tag creation lock (#298)", () => {
  it("an admin locks the tag list", async () => {
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { tags_locked: true },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/companies")[0].body).toEqual({
      tags_locked: true,
    });
  });

  it("counts as a field, so it alone satisfies the at-least-one-field rule", async () => {
    // The refine() clause enumerates fields by hand, and a boolean left out of
    // it 422s a body that is perfectly valid — the failure mode is invisible
    // until somebody flips only this switch.
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { tags_locked: false },
    });
    expect(res.status).toBe(200);
  });

  it("a member cannot decide the shop's vocabulary is fixed", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { tags_locked: true },
    });
    expect(res.status).toBe(403);
    expect(sb.find("PATCH", "/rest/v1/companies")).toHaveLength(0);
  });

  it("is admin's, NOT owner-only", async () => {
    // The owner-only settings on this route have one thing in common: they
    // reach a customer (the off-ramp message) or name an individual (per-member
    // response times). Which words a crew may invent for its own filing does
    // neither — it is the same class of housekeeping as curating templates,
    // which #461 already made an admin's.
    const sb = stubWithRole("admin");
    sb.on("PATCH", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/company", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { tags_locked: true },
    });
    expect(res.status).toBe(200);
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
