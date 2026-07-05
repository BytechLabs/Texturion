/**
 * GET /v1/usage (SPEC §2, §7, §9; D30): included/used/overage/cap/projection
 * from usage_events + plan, plus the D30 `storage` arm (per-company stored
 * bytes for generic attachments and MMS media, via api_storage_usage).
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

/** #12: voice seconds the api_period_voice_seconds RPC stub reports (3660 = 61 min). */
const VOICE_SECONDS = 3660;

function usageStub(
  company: Record<string, unknown>,
  used: number,
  storage: Record<string, unknown> = STORAGE,
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
  sb.on("POST", "/rest/v1/rpc/api_period_voice_seconds", () => VOICE_SECONDS);
  return sb;
}

const starterCompany = {
  plan: "starter",
  current_period_start: "2026-06-15T00:00:00+00:00",
  current_period_end: "2026-07-15T00:00:00+00:00",
  overage_cap_multiplier: 3,
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
      history: HISTORY,
      storage: { attachments_bytes: 123_456, mms_bytes: 78_900 },
      voice: { used_minutes: 61, included_minutes: 500 },
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
      history: [],
      storage: { attachments_bytes: 0, mms_bytes: 0 },
      voice: { used_minutes: 0, included_minutes: 0 },
    });
    expect(sb.find("POST", "/rest/v1/rpc/api_period_segments")).toHaveLength(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_period_inbound_segments"),
    ).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/api_usage_history")).toHaveLength(0);
    // Pre-checkout companies can't own files/media — zeros without querying.
    expect(sb.find("POST", "/rest/v1/rpc/api_storage_usage")).toHaveLength(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_period_voice_seconds"),
    ).toHaveLength(0);
  });
});
