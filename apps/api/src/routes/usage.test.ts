/**
 * GET /v1/usage (SPEC §2, §7, §9; D30): included/used/overage/cap/projection
 * from usage_events + plan, plus the D30 `storage` arm (per-company stored
 * bytes for generic attachments and MMS media, via api_storage_usage).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  countResponse,
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
import { usageRoutes } from "./usage";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;
const app = buildTestApp(usageRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const HISTORY = [
  { month: "2026-02", segments: 0 },
  { month: "2026-03", segments: 120 },
  { month: "2026-04", segments: 340 },
  { month: "2026-05", segments: 280 },
  { month: "2026-06", segments: 510 },
  { month: "2026-07", segments: 90 },
];

/** D30 storage arm the api_storage_usage RPC stub reports. */
const STORAGE = { attachments_bytes: 123_456, mms_bytes: 78_900 };

/** #12: inbound-volume the api_period_inbound_segments RPC stub reports. */
const INBOUND_USED = 200;

/** #12/D36: forwarded seconds the api_period_forward_seconds RPC stub reports (3660 = 61 min). */
const VOICE_SECONDS = 3660;


function usageStub(
  company: Record<string, unknown>,
  used: number,
  storage: Record<string, unknown> = STORAGE,
  options: { voiceGrandfathered?: boolean } = {},
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "GET",
    "/rest/v1/company_members",
    membershipResponder(MEMBER_ID, "member"),
  );
  sb.on("GET", "/rest/v1/companies", () => [company]);
  sb.on("POST", "/rest/v1/rpc/api_period_segments", () => used);
  sb.on("POST", "/rest/v1/rpc/api_period_inbound_segments", () => INBOUND_USED);
  sb.on("POST", "/rest/v1/rpc/api_usage_history", () => HISTORY);
  sb.on("POST", "/rest/v1/rpc/api_storage_usage", () => storage);
  sb.on("POST", "/rest/v1/rpc/api_period_forward_seconds", () => VOICE_SECONDS);
  sb.on("POST", "/rest/v1/rpc/api_period_forwarded_calls", () => 0);
  // #85/#93: decideOverage's revenue read still consults company_modules
  // (the #121 storage retirement removed the BUDGET read, not this one);
  // #133: the voice-allowance read shares the endpoint.
  sb.on("GET", "/rest/v1/company_modules", () =>
    options.voiceGrandfathered ? [{ grandfathered: true }] : [],
  );
  // #85/#93: decideOverage also reads egress + the non-released number count.
  sb.on("POST", "/rest/v1/rpc/api_period_egress_bytes", () => 0);
  sb.on("HEAD", "/rest/v1/phone_numbers", () => countResponse(1));
  return sb;
}

const starterCompany = {
  plan: "starter",
  current_period_start: "2026-06-15T00:00:00+00:00",
  current_period_end: "2026-07-15T00:00:00+00:00",
  overage_cap_multiplier: 3,
  us_texting_enabled: true,
};

describe("GET /v1/usage", () => {
  it("starter with overage: 620 used → 120 over, cap 1500, 360¢ projected", async () => {
    const sb = usageStub(starterCompany, 620);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/usage", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      period_start: "2026-06-15T00:00:00+00:00",
      period_end: "2026-07-15T00:00:00+00:00",
      included_segments: 500,
      used_segments: 620,
      inbound_segments: INBOUND_USED,
      overage_segments: 120,
      cap_segments: 1500,
      projected_overage_cents: 360,
      // Extrapolated end-of-period projection (exact value depends on the
      // wall-clock position in the period; the math is pinned in
      // overage-projection.test.ts, so here we assert only the shape).
      overage_projection: {
        trending_over: expect.any(Boolean),
        projected_overage_cents: expect.any(Number),
      },
      history: HISTORY,
      storage: {
        attachments_bytes: 123_456,
        mms_bytes: 78_900,
        // #121 one-release shim: storage is free — the budgets no longer
        // exist, and the fields are pinned to 0 so pre-#121 web bundles hide
        // their meters (nearLimit(x, 0) is false) instead of crashing.
        attachment_budget_bytes: 0,
        mms_budget_bytes: 0,
      },
      // D36: voice mirrors the segment shape — allowance, spending cap
      // (2,500 × 3.00 = 7,500 min), and overage-so-far at 1¢/min.
      voice: {
        used_minutes: 61,
        included_minutes: 2500,
        cap_minutes: 7500,
        overage_minutes: 0,
        projected_overage_cents: 0,
        overage_billed: true,
      },
      // #103 one-release shim for pre-#103 bundles (zeros — no meter, no crash).
      mms: { used_messages: 0, included_messages: 0 },
    });

    const rpc = sb.find("POST", "/rest/v1/rpc/api_period_segments")[0];
    expect(rpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_since: "2026-06-15T00:00:00+00:00",
    });
    // DESIGN G8: 6-month history bars ride along on the same response.
    const historyRpc = sb.find("POST", "/rest/v1/rpc/api_usage_history")[0];
    expect(historyRpc.body).toEqual({
      p_company_id: COMPANY_ID,
      p_months: 6,
    });
    // D30: the storage arm rides along too, from the exact-sum RPC.
    const storageRpc = sb.find("POST", "/rest/v1/rpc/api_storage_usage")[0];
    expect(storageRpc.body).toEqual({ p_company_id: COMPANY_ID });
  });

  it("coerces bigint-as-string sums from the storage RPC to numbers (D30)", async () => {
    const sb = usageStub(starterCompany, 0, {
      attachments_bytes: "5368709120",
      mms_bytes: "42",
    });
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/usage", {
      companyId: COMPANY_ID,
    });
    expect(await res.json()).toMatchObject({
      storage: { attachments_bytes: 5_368_709_120, mms_bytes: 42 },
    });
  });

  it("pro fractional overage rounds to whole cents (2 segments → 5¢)", async () => {
    const sb = usageStub(
      { ...starterCompany, plan: "pro", overage_cap_multiplier: null },
      2502,
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/usage", {
      companyId: COMPANY_ID,
    });
    expect(await res.json()).toMatchObject({
      included_segments: 2500,
      used_segments: 2502,
      overage_segments: 2,
      cap_segments: null, // null multiplier = no cap (owner removed it)
      projected_overage_cents: 5,
    });
  });

  it("under quota: zero overage, zero projection", async () => {
    const sb = usageStub(starterCompany, 137);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/usage", {
      companyId: COMPANY_ID,
    });
    expect(await res.json()).toMatchObject({
      used_segments: 137,
      overage_segments: 0,
      projected_overage_cents: 0,
    });
  });

  it("exposes the extrapolated overage projection (=so-far once the period is complete)", async () => {
    // A period entirely in the past: elapsed >> length, so the extrapolation
    // multiplier clamps to 1 (the stale-period fail-safe) and the projected
    // end-of-period overage equals the overage so far — deterministic without
    // faking the clock. 620 used - 500 included = 120 over * 3c = 360c.
    const sb = usageStub(
      {
        ...starterCompany,
        current_period_start: "2020-06-15T00:00:00+00:00",
        current_period_end: "2020-07-15T00:00:00+00:00",
      },
      620,
    );
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/usage", {
      companyId: COMPANY_ID,
    });
    expect(await res.json()).toMatchObject({
      projected_overage_cents: 360,
      overage_projection: { trending_over: false, projected_overage_cents: 360 },
    });
  });

  it("#133 grandfathered voice: 300-min allowance, cap = allowance, no billed overage", async () => {
    const sb = usageStub(starterCompany, 100, STORAGE, {
      voiceGrandfathered: true,
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/usage", {
      companyId: COMPANY_ID,
    });
    const data = (await res.json()) as {
      voice: Record<string, unknown>;
    };
    // 3660 s = 61 min used of the LEGACY 300 (never the plan's 2,500); the
    // pause line IS the cap; nothing bills.
    expect(data.voice).toEqual({
      used_minutes: 61,
      included_minutes: 300,
      cap_minutes: 300,
      overage_minutes: 0,
      projected_overage_cents: 0,
      overage_billed: false,
    });
  });

  it("never-subscribed company (plan null) reads as zeros without querying usage", async () => {
    const sb = usageStub(
      {
        plan: null,
        current_period_start: null,
        current_period_end: null,
        overage_cap_multiplier: 3,
      },
      0,
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/usage", {
      companyId: COMPANY_ID,
    });
    expect(await res.json()).toEqual({
      period_start: null,
      period_end: null,
      included_segments: 0,
      used_segments: 0,
      inbound_segments: 0,
      overage_segments: 0,
      cap_segments: null,
      projected_overage_cents: 0,
      overage_projection: { trending_over: false, projected_overage_cents: 0 },
      history: [],
      storage: {
        attachments_bytes: 0,
        mms_bytes: 0,
        attachment_budget_bytes: 0,
        mms_budget_bytes: 0,
      },
      voice: {
        used_minutes: 0,
        included_minutes: 0,
        cap_minutes: null,
        overage_minutes: 0,
        projected_overage_cents: 0,
        overage_billed: true,
      },
      mms: { used_messages: 0, included_messages: 0 },
    });
    expect(sb.find("POST", "/rest/v1/rpc/api_period_segments")).toHaveLength(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_period_inbound_segments"),
    ).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/api_usage_history")).toHaveLength(0);
    // Pre-checkout companies can't own files/media — zeros without querying.
    expect(sb.find("POST", "/rest/v1/rpc/api_storage_usage")).toHaveLength(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_period_forward_seconds"),
    ).toHaveLength(0);
  });
});
