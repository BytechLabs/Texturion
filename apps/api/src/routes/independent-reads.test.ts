/**
 * Reads that do not depend on each other are issued together.
 *
 * A route that waits for one answer before asking the next question pays a
 * full database round trip per read on the contact, task, thread and app-load
 * paths. These tests hold each named read
 * until all of them have arrived. A route that asks them together lets them all
 * through at once; a route that asks one only after another has answered leaves
 * the first held until it gives up, and that read is reported as stalled.
 */
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import type { Env } from "../env";
import { resetFlagCache } from "../flags/evaluate";
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
  type FetchRoute,
  type TestAuth,
} from "../test/support";
import { callsRoutes } from "./calls";
import { contactsRoutes } from "./contacts";
import { meRoutes } from "./me";
import { numbersRoutes } from "./numbers";
import { reportsRoutes } from "./reports";
import { savedViewsRoutes } from "./saved-views";
import { tasksRoutes } from "./tasks";
import { webrtcRoutes } from "./webrtc";

const env: Env = {
  ...completeEnv(),
  TELNYX_WEBRTC_CONNECTION_ID: "3002000000000000000",
};
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONTACT_ID = "dddddddd-1111-4222-8333-444444444444";
const TASK_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const MESSAGE_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const CONVERSATION_ID = "cccccccc-1111-4222-8333-444444444444";
const NUMBER_ID = "eeeeeeee-1111-4222-8333-444444444444";
const VIEW_A = "f0000000-1111-4222-8333-444444444444";
const VIEW_B = "f1111111-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(
  meRoutes,
  new Hono<AppEnv>().route("/numbers", numbersRoutes),
  savedViewsRoutes,
  webrtcRoutes,
  contactsRoutes,
  callsRoutes,
  tasksRoutes,
  reportsRoutes,
);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

beforeEach(() => {
  // A cached flag answer would never reach the network, and so never arrive.
  resetFlagCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface HeldCall {
  method: string;
  path: string;
  params: URLSearchParams;
  body: Record<string, unknown>;
}

/** How long a held read waits for the others before it is called stalled. */
const PATIENCE_MS = 300;

/**
 * Holds the first request matching each name until every name has been seen.
 * `stalled()` names the reads that waited out PATIENCE_MS, which is what a read
 * issued ahead of a serial one does; `missing()` names the reads never issued.
 */
function heldTogether(expected: Record<string, (call: HeldCall) => boolean>): {
  route: FetchRoute;
  stalled: () => string[];
  missing: () => string[];
} {
  const names = Object.keys(expected);
  const arrived = new Set<string>();
  const stalled: string[] = [];
  let release!: () => void;
  const everyoneArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  const route: FetchRoute = async (url, request) => {
    const text = await request.clone().text();
    let body: Record<string, unknown> = {};
    try {
      body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
    } catch {
      // Not JSON, so no matcher reads it.
    }
    const call = { method: request.method, path: url.pathname, params: url.searchParams, body };
    const name = names.find((candidate) => !arrived.has(candidate) && expected[candidate](call));
    if (name === undefined) return undefined;
    arrived.add(name);
    if (arrived.size === names.length) release();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      everyoneArrived.then(() => "together" as const),
      new Promise<"stalled">((resolve) => {
        timer = setTimeout(() => resolve("stalled"), PATIENCE_MS);
      }),
    ]);
    clearTimeout(timer);
    if (outcome === "stalled") stalled.push(name);
    // Held only; the Supabase stub behind this answers it.
    return undefined;
  };

  return {
    route,
    stalled: () => [...stalled],
    missing: () => names.filter((name) => !arrived.has(name)),
  };
}

const read = (path: string) => (call: HeldCall) =>
  call.method === "GET" && call.path === `/rest/v1/${path}`;
const rpc = (name: string) => (call: HeldCall) =>
  call.method === "POST" && call.path === `/rest/v1/rpc/${name}`;

function memberStub(role = "member"): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, role));
  return sb;
}

function expectTogether(probe: ReturnType<typeof heldTogether>): void {
  expect(probe.missing(), "reads the route never issued").toEqual([]);
  expect(probe.stalled(), "reads that waited for another to answer first").toEqual([]);
}

describe("independent reads are issued together", () => {
  it("GET /v1/me reads the workspace, its numbers and its client flags in one round trip", async () => {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/profiles", () => [{ display_name: "Casey Owner", locale: null }]);
    sb.on("POST", "/rest/v1/rpc/api_user_has_password", () => true);
    sb.on("POST", "/rest/v1/rpc/api_user_email_state", () => null);
    sb.on("GET", "/rest/v1/company_members", () => [
      {
        company_id: COMPANY_ID,
        role: "owner",
        companies: { name: "Acme Plumbing", subscription_status: "active" },
      },
    ]);
    sb.on("POST", "/rest/v1/rpc/company_mfa_posture", () => ({
      required: false,
      grace_until: null,
      enforcing: false,
    }));
    sb.on("POST", "/rest/v1/rpc/user_has_verified_mfa", () => false);
    sb.on("GET", "/rest/v1/companies", () => [
      { id: COMPANY_ID, name: "Acme Plumbing", plan: "starter", subscription_status: "active" },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("GET", "/rest/v1/messaging_registrations", () => []);
    sb.on("GET", "/rest/v1/company_modules", () => []);
    const probe = heldTogether({
      company: (call) => read("companies")(call) && call.params.get("deleted_at") === "is.null",
      numbers: read("phone_numbers"),
      flags: rpc("api_evaluate_flags"),
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/me", { companyId: COMPANY_ID });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { company?: unknown; flags?: unknown };
    expect(body.company).toBeDefined();
    expect(body.flags).toEqual({ "kill:realtime": true });
    expectTogether(probe);
  });

  it("GET /v1/numbers reads the numbers, the caller's access and their health together", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("POST", "/rest/v1/rpc/api_number_health", () => []);
    const probe = heldTogether({
      numbers: read("phone_numbers"),
      access: rpc("member_number_levels"),
      health: rpc("api_number_health"),
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/numbers", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expectTogether(probe);
  });

  it("GET /v1/saved-views reads the views and the caller's landing choice together", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/saved_views", () => []);
    sb.on("GET", "/rest/v1/company_members", () => [
      { default_conversation_view_id: null, default_task_view_id: null },
    ]);
    const probe = heldTogether({
      views: read("saved_views"),
      defaults: read("company_members"),
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/saved-views", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expectTogether(probe);
  });

  it("GET /v1/saved-views/counts counts every view at once", async () => {
    const sb = memberStub();
    const view = (id: string, status: string) => ({
      id,
      surface: "conversations",
      name: status,
      filters: { status },
      position: 0,
      owner_user_id: null,
      created_by: auth.subject,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    });
    sb.on("GET", "/rest/v1/saved_views", () => [view(VIEW_A, "open"), view(VIEW_B, "closed")]);
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", (call) =>
      (call.body as { p_status: string }).p_status === "open" ? [{ id: "1" }] : [],
    );
    const probe = heldTogether({
      open: (call) => rpc("api_list_conversations")(call) && call.body.p_status === "open",
      closed: (call) => rpc("api_list_conversations")(call) && call.body.p_status === "closed",
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/saved-views/counts?surface=conversations&ids=${VIEW_A},${VIEW_B}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counts: { [VIEW_A]: 1, [VIEW_B]: 0 } });
    expectTogether(probe);
  });

  it("POST /v1/webrtc/token reads the switch, the subscription and the credential together", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/companies", () => [{ subscription_status: "active" }]);
    sb.on("GET", "/rest/v1/member_telephony_credentials", () => [
      { telnyx_credential_id: "cred_existing", sip_username: "gencredBBB" },
    ]);
    const mint: FetchRoute = (url) =>
      /\/v2\/telephony_credentials\/cred_existing\/token$/.test(url.pathname)
        ? new Response("jwt-token-abc", { status: 201 })
        : undefined;
    const probe = heldTogether({
      flags: rpc("api_evaluate_flags"),
      subscription: read("companies"),
      credential: read("member_telephony_credentials"),
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route, mint);

    const res = await apiRequest(app, env, await auth.token(), "/v1/webrtc/token", {
      companyId: COMPANY_ID,
      method: "POST",
      body: {},
    });
    expect(res.status).toBe(200);
    expectTogether(probe);
  });

  it("GET /v1/contacts/:id reads everything about the contact in one round trip", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/contacts", (call) =>
      call.url.searchParams.has("merged_into")
        ? []
        : [
            {
              id: CONTACT_ID,
              phone_e164: "+14165550199",
              name: "Jo Smith",
              timezone: null,
              created_by_user_id: auth.subject,
              updated_by_user_id: null,
              deleted_at: null,
              created_at: "2026-07-01T09:00:00+00:00",
              updated_at: "2026-07-01T09:00:00+00:00",
            },
          ],
    );
    sb.on("GET", "/rest/v1/contact_addresses", () => []);
    sb.on("GET", "/rest/v1/contact_phones", () => []);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/profiles", () => [{ user_id: auth.subject, display_name: "Sam" }]);
    const probe = heldTogether({
      addresses: read("contact_addresses"),
      phones: read("contact_phones"),
      optOuts: read("opt_outs"),
      tags: read("contact_tags"),
      mergedFrom: (call) => read("contacts")(call) && call.params.has("merged_into"),
      actors: read("profiles"),
      access: rpc("member_number_levels"),
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route);

    const res = await apiRequest(app, env, await auth.token(), `/v1/contacts/${CONTACT_ID}`, {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: CONTACT_ID, created_by_name: "Sam" });
    expectTogether(probe);
  });

  it("GET /v1/calls/:sessionId checks access and names who answered together", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/calls", () => [
      {
        id: "11111111-1111-4222-8333-444444444444",
        call_session_id: "v3:session-1",
        caller_e164: "+14165550199",
        contact_id: null,
        caller_name: null,
        phone_number_id: NUMBER_ID,
        conversation_id: null,
        outcome: "answered",
        state: "ended",
        answered_by_user_id: auth.subject,
        voicemail_path: null,
        voicemail_deleted_at: null,
        started_at: "2026-07-01T09:00:00+00:00",
        ended_at: "2026-07-01T09:05:00+00:00",
        direction: "inbound",
        contacts: null,
      },
    ]);
    sb.on("GET", "/rest/v1/profiles", () => [{ user_id: auth.subject, display_name: "Sam" }]);
    const probe = heldTogether({
      access: rpc("member_number_levels"),
      answeredBy: read("profiles"),
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calls/v3:session-1", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answered_by_name: "Sam" });
    expectTogether(probe);
  });

  it("GET /v1/tasks/:id reads everything after the task row in one round trip", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/tasks", () => [
      {
        id: TASK_ID,
        company_id: COMPANY_ID,
        message_id: MESSAGE_ID,
        conversation_id: CONVERSATION_ID,
        title: "Fix the leak",
        assigned_user_id: null,
        created_by_user_id: auth.subject,
        created_at: "2026-07-02T12:00:00.000Z",
        updated_at: "2026-07-02T12:00:00.000Z",
        messages: { id: MESSAGE_ID, body: "fix the sink", done_at: null },
      },
    ]);
    sb.on("GET", "/rest/v1/profiles", () => [{ user_id: auth.subject, display_name: "Sam" }]);
    sb.on("GET", "/rest/v1/task_subscribers", () => []);
    sb.on("GET", "/rest/v1/task_tags", () => []);
    sb.on("GET", "/rest/v1/task_assignees", () => []);
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    sb.on("GET", "/rest/v1/messages", () => []);
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("GET", "/rest/v1/conversation_events", () => []);
    const probe = heldTogether({
      names: read("profiles"),
      following: read("task_subscribers"),
      labels: read("task_tags"),
      access: rpc("member_number_levels"),
      mms: read("message_attachments"),
      noteLinks: (call) =>
        read("messages")(call) && (call.params.get("task_id") ?? "").startsWith("in."),
      legacyFiles: read("attachments"),
      events: read("conversation_events"),
      notes: (call) =>
        read("messages")(call) && (call.params.get("task_id") ?? "").startsWith("eq."),
    });
    stubFetch(jwksRoute(auth), probe.route, sb.route);

    const res = await apiRequest(app, env, await auth.token(), `/v1/tasks/${TASK_ID}`, {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: TASK_ID,
      viewer_level: "text",
      created_by: { display_name: "Sam" },
    });
    expectTogether(probe);
  });

  it("GET /v1/tasks decorates the page with directions and labels together", async () => {
    const sb = memberStub();
    sb.on("GET", "/rest/v1/messages", () => [{ id: MESSAGE_ID, direction: "note" }]);
    sb.on("GET", "/rest/v1/task_tags", () => []);
    sb.on("GET", "/rest/v1/task_assignees", () => []);
    // Answered ahead of the stub, whose column check reads the calendar-hold
    // anti-join (`calendar_hold=is.null`) as a column on tasks.
    const list: FetchRoute = (url) =>
      url.pathname === "/rest/v1/tasks"
        ? Response.json([
            {
              id: TASK_ID,
              message_id: MESSAGE_ID,
              conversation_id: CONVERSATION_ID,
              title: "Fix the leak",
              priority: "normal",
              due_at: null,
              done_state: null,
              created_at: "2026-07-02T12:00:00.000Z",
              updated_at: "2026-07-02T12:00:00.000Z",
            },
          ])
        : undefined;
    const probe = heldTogether({
      directions: read("messages"),
      labels: read("task_tags"),
    });
    stubFetch(jwksRoute(auth), probe.route, list, sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/tasks", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { source: unknown; labels: unknown }[] };
    // Both decorations land on the same row.
    expect(body.data[0]).toMatchObject({
      source: { kind: "message", id: MESSAGE_ID, direction: "note" },
      labels: [],
    });
    expectTogether(probe);
  });

  it("GET /v1/reports/response-time reads access with the workspace, then both windows together", async () => {
    const createdAt = "2025-01-01T00:00:00Z";
    const sb = memberStub();
    sb.on("GET", "/rest/v1/companies", () => [
      {
        created_at: createdAt,
        timezone: "America/Toronto",
        business_hours: null,
        business_hours_exceptions: null,
        response_stats_per_member: false,
      },
    ]);
    sb.on("GET", "/rest/v1/phone_numbers", () => []);
    sb.on("POST", "/rest/v1/rpc/api_response_time_stats", () => ({
      leads: 0,
      answered: 0,
      median_seconds: null,
      p90_seconds: null,
      by_number: [],
      by_member: [],
      rows: [],
      row_limit: 5000,
      truncated: false,
    }));
    const isBaseline = (call: HeldCall) =>
      call.body.p_since === new Date(createdAt).toISOString();
    const first = heldTogether({
      access: rpc("member_number_levels"),
      company: read("companies"),
    });
    const windows = heldTogether({
      current: (call) => rpc("api_response_time_stats")(call) && !isBaseline(call),
      baseline: (call) => rpc("api_response_time_stats")(call) && isBaseline(call),
    });
    stubFetch(jwksRoute(auth), first.route, windows.route, sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/reports/response-time", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expectTogether(first);
    expectTogether(windows);
  });
});
