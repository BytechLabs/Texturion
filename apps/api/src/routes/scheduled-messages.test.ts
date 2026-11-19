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
import { completeEnv, createTestAuth, jwksRoute, stubFetch } from '../test/support';
import type { TestAuth } from '../test/support';
import { scheduledMessageRoutes } from "./scheduled-messages";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const SCHEDULED_ID = "cccccccc-0000-4000-8000-00000000000c";

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
    await expect(schedule({})).resolves.toBe(24 * 3_600_000);
  });

  it("uses the workspace's own number of hours", async () => {
    await expect(schedule({ scheduled_text_expiry_hours: 72 })).resolves.toBe(72 * 3_600_000);
  });
});

it("returns a scheduled text on replay even when the destination clock now asks for confirmation", async () => {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
  sb.on("GET", "/rest/v1/conversations", () => [
    { contact_phone_e164: "+16135550142", contacts: { timezone: "America/Toronto" } },
  ]);
  sb.on("POST", "/rest/v1/rpc/api_schedule_message", () => ({
    outcome: "replayed",
    scheduled_message: { id: SCHEDULED_ID },
  }));
  sb.on("GET", /\/rest\/v1\//, () => []);
  stubFetch(jwksRoute(auth), sb.route);

  const sendAt = new Date(Date.now() + 3 * 24 * 3_600_000);
  sendAt.setUTCHours(7, 0, 0, 0);
  const response = await apiRequest(app, env, await auth.token(), "/v1/scheduled-messages", {
    method: "POST",
    companyId: COMPANY_ID,
    headers: { "Idempotency-Key": "schedule-1" },
    body: { conversation_id: CONVERSATION_ID, body: "Checking in", send_at: sendAt.toISOString() },
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ scheduled_message: { id: SCHEDULED_ID } });
  expect(sb.find("POST", "/rest/v1/rpc/api_schedule_message")[0].body).toMatchObject({
    p_idempotency_key: "schedule-1",
    p_needs_quiet_confirmation: true,
  });
});

describe("GET /v1/scheduled-messages allowed actions (#722)", () => {
  async function listAs(role: string) {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, role));
    sb.on("GET", "/rest/v1/scheduled_messages", () => [
      { id: "s1", status: "pending" },
      { id: "s2", status: "held" },
      { id: "s3", status: "sent" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/scheduled-messages?status=all", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = await res.json<{
      scheduled_messages: { id: string; allowed_actions: string[] }[];
    }>();
    return Object.fromEntries(body.scheduled_messages.map((row) => [row.id, row.allowed_actions]));
  }

  it("lets a member edit and cancel a live text, and nothing on a sent one", async () => {
    await expect(listAs("member")).resolves.toEqual({ s1: ["edit", "cancel"], s2: ["edit", "cancel"], s3: [] });
  });

  it("offers a view-only member nothing", async () => {
    await expect(listAs("read_only")).resolves.toEqual({ s1: [], s2: [], s3: [] });
  });
});

describe("PATCH /v1/scheduled-messages/:id follows the machine (#722)", () => {
  async function patchRow(status: string) {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
    sb.on("GET", "/rest/v1/scheduled_messages", () => ({
      status,
      conversation_id: CONVERSATION_ID,
      conversations: null,
    }));
    sb.on("PATCH", "/rest/v1/scheduled_messages", () => [{ id: "s1", status, body: "New words" }]);
    stubFetch(jwksRoute(auth), sb.route);
    return apiRequest(app, env, await auth.token(), `/v1/scheduled-messages/${SCHEDULED_ID}`, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { body: "New words" },
    });
  }

  it("edits a pending text", async () => {
    expect((await patchRow("pending")).status).toBe(200);
  });

  it("reschedules a held text against the latest reply and releases the old claim", async () => {
    const sb = supabaseStub(env);
    const lastInbound = new Date().toISOString();
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
    sb.on("GET", "/rest/v1/scheduled_messages", () => ({
      status: "held",
      conversation_id: CONVERSATION_ID,
      conversations: null,
    }));
    sb.on("GET", "/rest/v1/messages", () => [{ created_at: lastInbound }]);
    sb.on("GET", "/rest/v1/companies", () => [{ id: COMPANY_ID }]);
    sb.on("PATCH", "/rest/v1/scheduled_messages", () => [{ id: SCHEDULED_ID, status: "pending" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const sendAt = new Date(Date.now() + 3_600_000).toISOString();
    const response = await apiRequest(app, env, await auth.token(), `/v1/scheduled-messages/${SCHEDULED_ID}`, {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { send_at: sendAt },
    });

    expect(response.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/scheduled_messages")[0].body).toMatchObject({
      status: "pending",
      send_at: sendAt,
      inbound_watermark: lastInbound,
      claimed_at: null,
      held_reason_key: null,
      next_attempt_at: null,
    });
  });

  it("refuses an edit on a text the machine allows no edit on", async () => {
    for (const status of ["sent", "canceled", "expired", "failed"]) {
      expect((await patchRow(status)).status, status).toBe(422);
    }
  });
});

it("returns a cancellation receipt and restores only the cancellation it identifies", async () => {
  const sb = supabaseStub(env);
  const canceledAt = new Date().toISOString();
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
  sb.on("GET", "/rest/v1/scheduled_messages", () => ({ conversations: null }));
  sb.on("POST", "/rest/v1/rpc/api_cancel_scheduled_message", () => ({
    outcome: "canceled",
    scheduled_message: { canceled_at: canceledAt },
  }));
  sb.on("POST", "/rest/v1/rpc/api_restore_scheduled_message", () => true);
  stubFetch(jwksRoute(auth), sb.route);

  const token = await auth.token();
  const path = `/v1/scheduled-messages/${SCHEDULED_ID}`;
  const canceled = await apiRequest(app, env, token, `${path}?undo_receipt=1`, {
    method: "DELETE",
    companyId: COMPANY_ID,
  });
  await expect(canceled.json()).resolves.toEqual({ canceled_at: canceledAt });

  const restored = await apiRequest(app, env, token, `${path}/restore`, {
    method: "POST",
    companyId: COMPANY_ID,
    body: { canceled_at: canceledAt },
  });
  expect(restored.status).toBe(200);
  expect(sb.find("POST", "/rest/v1/rpc/api_restore_scheduled_message")[0].body).toEqual({
    p_id: SCHEDULED_ID,
    p_company_id: COMPANY_ID,
    p_user_id: auth.subject,
    p_canceled_at: canceledAt,
  });
});

describe("a scheduled text or thread that is not here is a 404, not a failure", () => {
  function stubs() {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
    // What PostgREST returns when no row matches.
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("GET", "/rest/v1/scheduled_messages", () => []);
    stubFetch(jwksRoute(auth), sb.route);
  }

  it("POST for a thread in another workspace", async () => {
    stubs();
    const res = await apiRequest(app, env, await auth.token(), "/v1/scheduled-messages", {
      method: "POST",
      companyId: COMPANY_ID,
      body: {
        conversation_id: CONVERSATION_ID,
        body: "Checking in",
        send_at: new Date(Date.now() + 3 * 24 * 3_600_000).toISOString(),
      },
    });
    expect(res.status).toBe(404);
  });

  it("PATCH for a text that does not exist", async () => {
    stubs();
    const res = await apiRequest(app, env, await auth.token(), "/v1/scheduled-messages/s1", {
      method: "PATCH",
      companyId: COMPANY_ID,
      body: { body: "New words" },
    });
    expect(res.status).toBe(404);
  });
});
