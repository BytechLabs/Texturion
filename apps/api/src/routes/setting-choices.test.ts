import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch, type TestAuth } from "../test/support";
import { REVENUE_SETTING_KEYS } from "@loonext/shared";

import { REVENUE_SETTING_COLUMNS, settingChoicesRoutes } from "./setting-choices";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

/** Every revenue setting at its default. */
const AT_DEFAULTS = {
  after_hours_calls: "ring_everyone",
  ring_strategy: "all",
  ring_seconds: 45,
  away_enabled: false,
  call_screening: "flag",
  emergency_keyword_enabled: true,
  emergency_reply_enabled: true,
  overage_cap_multiplier: 3,
};

let auth: TestAuth;
const app = buildTestApp(settingChoicesRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function request(role: "owner" | "member", company: Record<string, unknown>) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, role));
  sb.on("GET", "/rest/v1/companies", () => [company]);
  const latest = vi.fn(() => [
    {
      key: "after_hours_calls",
      actor_user_id: MEMBER_ID,
      actor_name: "Dana Whitcomb",
      occurred_at: "2026-08-08T03:31:13.340885+00:00",
    },
  ]);
  sb.on("POST", "/rest/v1/rpc/api_latest_setting_changes", latest);
  stubFetch(jwksRoute(auth), sb.route);
  const res = await apiRequest(app, env, await auth.token(), "/v1/company/setting-choices", {
    companyId: COMPANY_ID,
  });
  return { res, latest };
}

describe("who chose a setting that can lose a customer (#749)", () => {
  it("reads exactly the settings the shared table attributes", () => {
    expect(REVENUE_SETTING_COLUMNS.split(",").sort()).toEqual([...REVENUE_SETTING_KEYS].sort());
  });

  it("names who moved after-hours calls off the default, and when", async () => {
    const { res } = await request("owner", { ...AT_DEFAULTS, after_hours_calls: "voicemail" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        {
          key: "after_hours_calls",
          value: "voicemail",
          default_value: "ring_everyone",
          chosen_by: "Dana Whitcomb",
          chosen_at: "2026-08-08T03:31:13.340885+00:00",
        },
      ],
    });
  });

  it("says nothing, and asks the log nothing, when every setting is at its default", async () => {
    const { res, latest } = await request("owner", AT_DEFAULTS);
    expect(await res.json()).toEqual({ data: [] });
    expect(latest).not.toHaveBeenCalled();
  });

  it("leaves who chose it empty when no change on record touched it", async () => {
    const { res } = await request("owner", { ...AT_DEFAULTS, away_enabled: true });
    expect(await res.json()).toEqual({
      data: [
        { key: "away_enabled", value: true, default_value: false, chosen_by: null, chosen_at: null },
      ],
    });
  });

  it("is only for people who can change settings", async () => {
    const { res } = await request("member", { ...AT_DEFAULTS, after_hours_calls: "voicemail" });
    expect(res.status).toBe(403);
  });
});
