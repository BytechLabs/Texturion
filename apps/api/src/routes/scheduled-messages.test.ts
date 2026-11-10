/**
 * How long a scheduled text may stay held is the workspace's setting, with 24
 * hours as the default.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch, type TestAuth } from "../test/support";
import { scheduledMessageRoutes } from "./scheduled-messages";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";

let auth: TestAuth;
const app = buildTestApp(scheduledMessageRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => vi.unstubAllGlobals());

async function schedule(settings: Record<string, unknown>) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
  sb.on("GET", "/rest/v1/conversations", () => [
    { contact_phone_e164: "+16135550142", contacts: { timezone: "America/Toronto" } },
  ]);
  sb.on("GET", "/rest/v1/companies", () => [{ id: COMPANY_ID, ...settings }]);
  sb.on("POST", "/rest/v1/rpc/api_schedule_message", () => ({
    outcome: "scheduled",
    scheduled_message: { id: "x" },
  }));
  sb.on("GET", /\/rest\/v1\//, () => []);
  stubFetch(jwksRoute(auth), sb.route);

  // Mid-afternoon in Toronto, so the quiet-hours question does not interfere.
  const sendAt = new Date(Date.now() + 3 * 24 * 3_600_000);
  sendAt.setUTCHours(18, 0, 0, 0);
  const res = await apiRequest(app, env, await auth.token(), "/v1/scheduled-messages", {
    method: "POST",
    companyId: COMPANY_ID,
    body: { conversation_id: CONVERSATION_ID, body: "Checking in", send_at: sendAt.toISOString() },
  });
  expect(res.status).toBe(201);
  const call = sb.find("POST", "/rest/v1/rpc/api_schedule_message")[0].body as {
    p_expires_at: string;
  };
  return Date.parse(call.p_expires_at) - sendAt.getTime();
}

describe("POST /v1/scheduled-messages expiry", () => {
  it("expires a held text 24 hours after its send time by default", async () => {
    expect(await schedule({})).toBe(24 * 3_600_000);
  });

  it("uses the workspace's own number of hours", async () => {
    expect(await schedule({ scheduled_text_expiry_hours: 72 })).toBe(72 * 3_600_000);
  });
});
