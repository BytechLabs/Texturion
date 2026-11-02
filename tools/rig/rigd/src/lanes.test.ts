/**
 * The real lanes behind the scenario interfaces, against stub servers and
 * temporary directories: what each sends, and what it makes of the answer.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADER } from "@loonext/rig-protocol";
import { numberBook } from "@loonext/rig-robot";
import { afterEach, describe, expect, it } from "vitest";
import { automationBodies, AppProbe, stableUuid } from "./app-probe.ts";
import { webhookForwarder } from "./forward.ts";
import { GuardClient, PROBE_FOREIGN_CONNECTION } from "./guard-client.ts";
import { MailClient, linksIn } from "./mail-client.ts";
import { dialOnDevice, rigDevices, RigOps } from "./rig-ops.ts";
import { FakeDevices, FakeGuard, FakeApp, FakeHandoff, FakeStripe, FakeTime } from "./scenarios/fakes.ts";
import { FaultFile, HandoffFile } from "./state-files.ts";
import { deleteStripeObject, formEncode, STRIPE_DELETE_UNDO, StripeSandbox } from "./stripe-sandbox.ts";
import { fakeFetch, json, type Route } from "./test-support.ts";
import { bootDevice, CHROME_STABLE_PATH, chromeOf, reinstallDevice, releaseHeldNumber, resetDevice, undoHandlers } from "./wiring.ts";

const SRC = dirname(fileURLToPath(import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rig-lanes-"));
  dirs.push(dir);
  return dir;
}

const EDGE = "https://rig-edge.example.workers.dev";
const SUPABASE = "http://127.0.0.1:54321";
const API = "http://127.0.0.1:8787";
const COMPANY = "0f4c7a52-1d1e-4a4b-9c55-3a2b1c0d9e8f";
const OWNER = "11111111-2222-4333-8444-555555555555";
const TECH = "22222222-3333-4444-8555-666666666666";
const memberJwt = `h.${Buffer.from(JSON.stringify({ sub: OWNER })).toString("base64url")}.s`;

const PARTITION = {
  billing_group_id: "bg",
  owned_e164: ["+14165550101", "+14165550111"],
  standing_e164: ["+14165550101", "+14165550111"],
  connection_ids: { voice: "conn-voice", robot: "conn-robot", webrtc: "conn-webrtc", sentinel: "conn-sentinel" },
  messaging_profile_ids: ["mp-robot", "mp-w"],
  fetched_at: "x",
  standing: [
    { role: "ROBOT-1", e164: "+14165550101", telnyx_phone_number_id: "101", messaging_profile_id: "mp-robot" },
    { role: "DEV-W1", e164: "+14165550111", telnyx_phone_number_id: "111", messaging_profile_id: "mp-w" },
  ],
};

function guardWith(routes: Record<string, Route>) {
  const { fetch, requests } = fakeFetch({ [`GET ${EDGE}/g/partition`]: () => json(PARTITION), ...routes });
  return { guard: new GuardClient({ edgeOrigin: EDGE, robotToken: "robot-token", rigApiToken: "rig-api-token", fetch }), requests };
}

describe("the guard client", () => {
  it("sends each negative probe as the robot under the lease, naming only owned roles and fictional numbers", async () => {
    const refusal = (rule: string) => json({ error: "guard_refused", rule }, 403, { [HEADER.refusedBy]: "guard" });
    const { guard, requests } = guardWith({ [`POST ${EDGE}/g/telnyx/v2/`]: (request) => refusal(JSON.parse(request.body!).to === "+14165550199" ? "dial.to_not_owned" : "x") });
    expect(await guard.probe("dial-to-unowned", "lease-1")).toEqual({ status: 403, refused_by_guard: true, rule: "dial.to_not_owned" });
    await guard.probe("foreign-connection", "lease-1");
    await guard.probe("text-from-outside", "lease-1");
    const sent = requests.filter((r) => r.method === "POST");
    expect(sent.map((r) => [r.url.slice(EDGE.length), r.headers[HEADER.lease], r.headers.authorization])).toEqual([
      ["/g/telnyx/v2/calls", "lease-1", "Bearer robot-token"],
      ["/g/telnyx/v2/calls", "lease-1", "Bearer robot-token"],
      ["/g/telnyx/v2/messages", "lease-1", "Bearer robot-token"],
    ]);
    expect(JSON.parse(sent[0]!.body!)).toMatchObject({ connection_id: "conn-robot", from: "+14165550101", to: "+14165550199" });
    expect(JSON.parse(sent[1]!.body!)).toMatchObject({ connection_id: PROBE_FOREIGN_CONNECTION, to: "+14165550111" });
    expect(JSON.parse(sent[2]!.body!)).toMatchObject({ from: "+14165550198", to: "+14165550111", messaging_profile_id: "mp-robot" });
  });

  it("tells a guard refusal from Telnyx's own answer, and a success from both", async () => {
    const { guard } = guardWith({ [`POST ${EDGE}/g/telnyx/v2/calls`]: () => json({ errors: [{ code: "10001" }] }, 403) });
    expect(await guard.probe("dial-to-unowned", "l")).toEqual({ status: 403, refused_by_guard: false, rule: null });
    const open = guardWith({ [`POST ${EDGE}/g/telnyx/v2/calls`]: () => json({ data: { call_control_id: "c" } }) });
    expect(await open.guard.probe("dial-to-unowned", "l")).toMatchObject({ status: 200, refused_by_guard: false });
  });

  it("reads a held number's status with the robot's token and releases it only with the app's", async () => {
    const { guard, requests } = guardWith({
      [`GET ${EDGE}/g/telnyx/v2/phone_numbers/777`]: () => json({ data: { id: "777" } }),
      [`GET ${EDGE}/g/telnyx/v2/phone_numbers/888`]: () => json({ errors: [] }, 404),
      [`DELETE ${EDGE}/g/telnyx/v2/phone_numbers/111`]: () => json({ error: "guard_refused", rule: "provisioning.number_standing" }, 403, { [HEADER.refusedBy]: "guard" }),
      [`DELETE ${EDGE}/g/telnyx/v2/phone_numbers/777`]: () => json({ data: { id: "777" } }),
    });
    expect(await guard.numberStatus("777")).toEqual({ status: 200, in_group: true });
    expect(await guard.numberStatus("888")).toEqual({ status: 404, in_group: false });
    expect(await guard.releaseNumber("111")).toEqual({ status: 403, rule: "provisioning.number_standing" });
    expect(await guard.releaseNumber("777")).toEqual({ status: 200, rule: null });
    expect(requests.filter((r) => r.method === "DELETE").every((r) => r.headers.authorization === "Bearer rig-api-token")).toBe(true);
    expect(requests.filter((r) => r.method === "GET").every((r) => r.headers.authorization === "Bearer robot-token")).toBe(true);
  });

  it("reads the lease's log and keeps only each delivery's event and each attempt's host and status", async () => {
    const { guard } = guardWith({
      [`GET ${EDGE}/g/lease/lease-1/activity`]: () => json({ lease_id: "lease-1", live: true, activity: { "rig-api GET /v2/available_phone_numbers 200": 1 } }),
      [`GET ${EDGE}/g/telnyx/v2/webhook_deliveries`]: () =>
        json({
          data: [
            {
              id: "d1",
              status: "delivered",
              webhook: { event_type: "call.initiated", id: "event-1", payload: { to: "+14165550111" } },
              attempts: [
                { started_at: "a", http: { request: { url: `${EDGE}/t/v?x=secret` }, response: { status: 503 } } },
                { started_at: "b", http: { request: { url: `${EDGE}/t/v2` }, response: { status: 200 } } },
              ],
            },
          ],
        }),
    });
    expect((await guard.activity("lease-1")).activity).toEqual({ "rig-api GET /v2/available_phone_numbers 200": 1 });
    const [delivery] = await guard.webhookDeliveries({ since: 0 });
    expect(delivery).toEqual({
      id: "d1",
      status: "delivered",
      event_type: "call.initiated",
      event_id: "event-1",
      attempts: [
        { host: "rig-edge.example.workers.dev", http_status: 503, at: "a" },
        { host: "rig-edge.example.workers.dev", http_status: 200, at: "b" },
      ],
    });
    expect(JSON.stringify(delivery)).not.toContain("secret");
    expect(JSON.stringify(delivery)).not.toContain("+1416");
  });
});

function probeWith(routes: Record<string, Route>, stateDir?: string) {
  const { fetch, requests } = fakeFetch({
    [`POST ${SUPABASE}/auth/v1/token`]: () => json({ access_token: memberJwt, expires_in: 3600 }),
    [`GET ${SUPABASE}/auth/v1/admin/users`]: () =>
      json({
        users: [
          { id: OWNER, email: "delivered+rig-qa-w-owner@resend.dev" },
          { id: TECH, email: "delivered+rig-qa-w-technician@resend.dev" },
        ],
      }),
    ...routes,
  });
  const probe = new AppProbe({
    tenants: {
      "qa-w": {
        company_id: COMPANY,
        members: {
          owner: { email: "delivered+rig-qa-w-owner@resend.dev", password: "pw" },
          technician: { email: "delivered+rig-qa-w-technician@resend.dev", password: "pw" },
        },
      },
    },
    numbers: numberBook({ "ROBOT-1": "+14165550101", "DEV-W1": "+14165550111" }),
    apiBase: API,
    supabaseUrl: SUPABASE,
    serviceRoleKey: "service",
    anonKey: "publishable",
    edgeOrigin: EDGE,
    guardToken: "t",
    stateDir,
    fetch,
    now: () => Date.UTC(2026, 9, 31, 15),
  });
  return { probe, requests };
}

const rest = (table: string) => `${SUPABASE}/rest/v1/${table}`;

describe("the app probe", () => {
  it("reads a member's stored Android push tokens by their user id", async () => {
    const { probe, requests } = probeWith({ [`GET ${rest("device_push_tokens")}`]: () => json([{ token: "fcm-a" }, { token: "fcm-b" }]) });
    expect(await probe.pushTokens({ member: "qa-w-technician" })).toEqual(["fcm-a", "fcm-b"]);
    const read = new URL(requests.find((r) => r.url.includes("device_push_tokens"))!.url);
    expect(Object.fromEntries(read.searchParams)).toEqual({ user_id: `eq.${TECH}`, platform: "eq.android", select: "token" });
  });

  it("sends to a fictional number and refuses any other raw destination before a request", async () => {
    // routes/compose.ts files a send the Worker's gate refuses as a failed message, and answers 201 all the same.
    const answers = [
      json({ conversation: { id: "c-1" }, message: { id: "m-1", status: "failed", error_code: "rig_destination_refused" } }, 201),
      json({ error: { code: "internal_error", message: "Something went wrong." } }, 500),
      json({ conversation: { id: "c-1" }, message: { id: "m-2", status: "queued", error_code: null } }, 201),
    ];
    const { probe, requests } = probeWith({ [`POST ${API}/v1/conversations`]: () => answers.shift()! });
    const send = () => probe.sendTextToFictional({ member: "qa-w-owner", fromRole: "DEV-W1", e164: "+14165550199", body: "b" });
    expect(await send()).toEqual({ ok: false, status: 201, code: "rig_destination_refused" });
    expect(await send()).toEqual({ ok: false, status: 500, code: "internal_error" });
    expect(await send()).toEqual({ ok: true, messageId: "m-2" });
    await expect(probe.sendTextToFictional({ member: "qa-w-owner", fromRole: "DEV-W1", e164: "+1416555", body: "b" })).rejects.toThrow(/fictional/);
    expect(requests.filter((r) => r.url.includes("/v1/conversations"))).toHaveLength(3);
  });

  it("authorises a browser call from the tenant's own number and passes a refusal back", async () => {
    // Rig mode's refusal of a stranger reaches the route as an error it does not map, so onError answers 500.
    const { probe, requests } = probeWith({
      [`POST ${API}/v1/calls/browser`]: (request) =>
        JSON.parse(request.body!).to === "+14165550199" ? json({ error: { code: "internal_error", message: "Something went wrong." } }, 500) : json({ session_id: "s-1" }),
    });
    expect(await probe.placeCall({ member: "qa-w-owner", fromRole: "DEV-W1", to: "ROBOT-1" })).toEqual({ ok: true, sessionId: "s-1" });
    expect(await probe.placeCall({ member: "qa-w-owner", fromRole: "DEV-W1", to: { fictional: "+14165550199" } })).toEqual({
      ok: false,
      status: 500,
      code: "internal_error",
    });
    const sent = JSON.parse(requests.find((r) => r.url === `${API}/v1/calls/browser`)!.body!);
    expect(sent).toEqual({ to: "+14165550101", phone_number_id: stableUuid(COMPANY, "DEV-W1") });
  });

  it("changes only allow-listed company settings, and hands back what was there", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ ring_seconds: 20, away_enabled: false }]),
      [`PATCH ${rest("companies")}`]: () => new Response(null, { status: 204 }),
    });
    expect(await probe.patchCompany({ tenant: "QA-W", values: { ring_seconds: 30, away_enabled: true } })).toEqual({ ring_seconds: 20, away_enabled: false });
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).toBe(`${rest("companies")}?id=eq.${COMPANY}`);
    expect(JSON.parse(patch.body!)).toEqual({ ring_seconds: 30, away_enabled: true });
    await expect(probe.patchCompany({ tenant: "QA-W", values: { subscription_status: "active" } as never })).rejects.toThrow(/not a company setting/);
  });

  it("widens a ring audience for one member and resolves with the level before", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("number_access")}`]: () => json([]),
      [`DELETE ${rest("number_access")}`]: () => new Response(null, { status: 204 }),
      [`POST ${rest("number_access")}`]: () => new Response(null, { status: 201 }),
    });
    expect(await probe.setRingAudience({ tenant: "QA-W", role: "DEV-W1", member: "qa-w-technician", level: "text" })).toBeNull();
    const insert = requests.find((r) => r.method === "POST" && r.url.startsWith(rest("number_access")))!;
    expect(JSON.parse(insert.body!)).toEqual({
      company_id: COMPANY,
      phone_number_id: stableUuid(COMPANY, "DEV-W1"),
      principal_kind: "user",
      principal: TECH,
      level: "text",
    });
  });

  it("seeds usage that counts against a cap but is already marked reported, and clears it by its marker only", async () => {
    const { probe, requests } = probeWith({
      [`POST ${rest("usage_events")}`]: () => new Response(null, { status: 201 }),
      [`DELETE ${SUPABASE}/rest/v1/`]: () => new Response(null, { status: 204 }),
    });
    const { marker } = await probe.seedUsage({ tenant: "QA-W", type: "sms", quantity: 5 });
    const row = JSON.parse(requests.find((r) => r.method === "POST")!.body!);
    expect(row).toMatchObject({ company_id: COMPANY, type: "sms", quantity: 5, meter_identifier: marker });
    expect(row.stripe_reported_at).toBeTruthy();
    await probe.clearSeededUsage(marker);
    expect(requests.filter((r) => r.method === "DELETE").map((r) => decodeURIComponent(r.url.slice(`${SUPABASE}/rest/v1/`.length)))).toEqual([
      `usage_events?meter_identifier=eq.${marker}`,
      `call_records?call_session_id=eq.${marker}`,
      `messages?idempotency_key=eq.${marker}&direction=eq.outbound`,
    ]);
    await expect(probe.clearSeededUsage("real-meter")).rejects.toThrow(/seeded/);
  });

  it("reads the voice gates' period usage through the RPCs apps/api's gates call", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ plan: "pro", overage_cap_multiplier: "3.00", current_period_start: "2026-10-15T00:00:00+00:00" }]),
      [`POST ${SUPABASE}/rest/v1/rpc/api_period_forward_seconds`]: () => json(1200),
      [`POST ${SUPABASE}/rest/v1/rpc/api_period_forwarded_calls`]: () => json("40"),
    });
    expect(await probe.voiceCapState({ tenant: "QA-W" })).toEqual({ plan: "pro", overage_cap_multiplier: 3, forward_seconds: 1200, forwarded_calls: 40 });
    for (const rpc of requests.filter((r) => r.url.includes("/rpc/"))) {
      expect(JSON.parse(rpc.body!)).toEqual({ p_company_id: COMPANY, p_since: "2026-10-15T00:00:00+00:00" });
    }

    const unpaid = probeWith({ [`GET ${rest("companies")}`]: () => json([{ plan: null, overage_cap_multiplier: null, current_period_start: null }]) });
    expect(await unpaid.probe.voiceCapState({ tenant: "QA-W" })).toEqual({ plan: null, overage_cap_multiplier: null, forward_seconds: 0, forwarded_calls: 0 });
    expect(unpaid.requests.some((r) => r.url.includes("/rpc/"))).toBe(false);
  });

  it("seeds call records in batches under one marker, already reported, each leg its own", async () => {
    const { probe, requests } = probeWith({ [`POST ${rest("call_records")}`]: () => new Response(null, { status: 201 }) });
    const { marker } = await probe.seedCallRecords({ tenant: "QA-W", leg: "out_customer", rows: 2_500, billableSeconds: 0 });
    const batches = requests.filter((r) => r.method === "POST").map((r) => JSON.parse(r.body!) as Record<string, unknown>[]);
    expect(batches.map((batch) => batch.length)).toEqual([1_000, 1_000, 500]);
    const rows = batches.flat();
    expect(new Set(rows.map((row) => row.call_leg_id)).size).toBe(2_500);
    expect(rows.every((row) => row.call_session_id === marker && row.leg === "out_customer" && row.company_id === COMPANY && row.stripe_reported_at)).toBe(true);
    await expect(probe.seedCallRecords({ tenant: "QA-W", leg: "in_browser", rows: 0, billableSeconds: 60 })).rejects.toThrow(/1 to/);
  });

  it("seeds one delivered outbound message of many segments in the thread with a role, sent as the owner", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("contacts")}`]: () => json([{ id: "contact-1" }]),
      [`GET ${rest("conversations")}`]: () => json([{ id: "conv-1" }]),
      [`POST ${rest("messages")}`]: () => new Response(null, { status: 201 }),
    });
    const { marker } = await probe.seedOutboundSegments({ tenant: "QA-W", role: "ROBOT-1", segments: 1_600, body: "Rig seeded" });
    expect(JSON.parse(requests.find((r) => r.method === "POST" && r.url.startsWith(rest("messages")))!.body!)).toEqual({
      company_id: COMPANY,
      conversation_id: "conv-1",
      direction: "outbound",
      body: "Rig seeded",
      status: "delivered",
      segments: 1_600,
      sent_by_user_id: OWNER,
      idempotency_key: marker,
    });
  });

  it("reads company settings without writing, and takes a shift id the runner chose", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ ring_seconds: 20 }]),
      [`POST ${rest("on_call_shifts")}`]: (request) => json([{ id: JSON.parse(request.body!).id }], 201),
    });
    expect(await probe.companySettings({ tenant: "QA-W", fields: ["ring_seconds", "timezone"] })).toEqual({ ring_seconds: 20, timezone: null });
    await expect(probe.companySettings({ tenant: "QA-W", fields: ["plan" as never] })).rejects.toThrow(/not a company setting/);
    expect(await probe.addOnCallShift({ tenant: "QA-W", member: "qa-w-technician", role: "DEV-W1", startsAt: 0, endsAt: 1, id: "shift-chosen" })).toEqual({ id: "shift-chosen" });
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(JSON.parse(requests.find((r) => r.url.startsWith(rest("on_call_shifts")))!.body!)).toMatchObject({ id: "shift-chosen", user_id: TECH, created_by: OWNER });
  });

  it("rings a member's devices for a call that does not exist, with the caller the ring shows", async () => {
    const { probe, requests } = probeWith({ [`POST ${API}/v1/rig/simulate-incoming`]: () => json({ session_id: "synthetic-1", reachable: true }, 201) });
    expect(await probe.simulateIncoming({ member: "qa-w-owner", target: "qa-w-technician", caller: "Rig n0nce" })).toEqual({
      status: 201,
      body: { session_id: "synthetic-1", reachable: true },
    });
    expect(JSON.parse(requests.find((r) => r.url.endsWith("/v1/rig/simulate-incoming"))!.body!)).toEqual({ user_id: TECH, caller: "Rig n0nce" });
    expect(await probe.userIdOf("qa-w-owner")).toBe(OWNER);
  });

  it("cancels a workspace a number of days back, suspends its numbers, and reads it through grace", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ subscription_status: "active", canceled_at: null }]),
      [`PATCH ${rest("companies")}`]: () => new Response(null, { status: 204 }),
      [`PATCH ${rest("phone_numbers")}`]: () => new Response(null, { status: 204 }),
    });
    expect(await probe.backdateCancellation({ tenant: "QA-W", daysAgo: 31 })).toEqual({ subscription_status: "active", canceled_at: null });
    const [company, numbers] = requests.filter((r) => r.method === "PATCH");
    expect(JSON.parse(company!.body!)).toEqual({ subscription_status: "canceled", canceled_at: "2026-09-30T15:00:00.000Z" });
    expect(numbers!.url).toContain("status=eq.active");
    expect(JSON.parse(numbers!.body!)).toMatchObject({ status: "suspended" });

    const grace = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ subscription_status: "canceled", canceled_at: "2026-09-30T15:00:00+00:00" }]),
      [`GET ${rest("grace_notices")}`]: () => json([{ threshold_day: 30 }, { threshold_day: 1 }, { threshold_day: 27 }, { threshold_day: 15 }]),
      [`GET ${rest("messaging_registrations")}`]: () => json([]),
      [`GET ${rest("phone_numbers")}`]: () => json([{ id: "n", status: "released" }]),
    });
    expect(await grace.probe.graceState({ tenant: "QA-W" })).toMatchObject({ notices: [1, 15, 27, 30], live_campaigns: 0, numbers: [{ status: "released" }] });
    const noticeRead = grace.requests.find((r) => r.url.startsWith(rest("grace_notices")))!;
    expect(decodeURIComponent(noticeRead.url)).toContain("canceled_at=eq.2026-09-30T15:00:00+00:00");
  });

  it("buys a number in the company's own area code through the app's provisioning route", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ requested_area_code: "416" }]),
      // routes/numbers.ts answers with the sanitized row itself.
      [`POST ${API}/v1/numbers/provision`]: () => json({ id: "row-1", status: "pending", number_e164: null }, 201),
    });
    expect(await probe.provisionNumber({ member: "qa-w-owner" })).toMatchObject({ status: 201, body: { id: "row-1" } });
    const order = requests.find((r) => r.url === `${API}/v1/numbers/provision`)!;
    expect(JSON.parse(order.body!)).toEqual({ requested_area_code: "416" });
    expect(order.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("arms S25 in the thread with ROBOT-1, reads what came of it, and disarms back to what was there", async () => {
    const stateDir = tempDir();
    const bodies = automationBodies("n0nce");
    const { probe, requests } = probeWith(
      {
        [`GET ${rest("contacts")}`]: () => json([{ id: "contact-1" }]),
        [`GET ${rest("conversations")}`]: () => json([{ id: "conv-1" }]),
        [`GET ${rest("companies")}`]: () => json([{ away_enabled: false, away_message: null, business_hours: { mon: { open: "09:00", close: "17:00" } } }]),
        [`PATCH ${rest("companies")}`]: () => new Response(null, { status: 204 }),
        [`POST ${rest("scheduled_messages")}`]: () => new Response("[]", { status: 201 }),
        [`PATCH ${rest("scheduled_messages")}`]: () => new Response(null, { status: 204 }),
        [`GET ${rest("messages")}`]: () => json([{ body: bodies.away_reply, status: "delivered", direction: "outbound" }]),
        [`GET ${rest("scheduled_messages")}`]: () =>
          json([
            { body: bodies.scheduled_send, status: "held" },
            { body: bodies.reminder, status: "pending" },
          ]),
      },
      stateDir,
    );
    await probe.armAutomations({ tenant: "QA-W", toRole: "ROBOT-1", nonce: "n0nce" });
    const armed = JSON.parse(requests.find((r) => r.method === "PATCH" && r.url.startsWith(rest("companies")))!.body!);
    expect(armed).toMatchObject({ away_enabled: true, away_message: bodies.away_reply, emergency_keywords: ["RIG"] });
    expect(armed.business_hours).toEqual({});
    const scheduled = requests.filter((r) => r.method === "POST" && r.url.startsWith(rest("scheduled_messages"))).map((r) => JSON.parse(r.body!));
    expect(scheduled.map((row) => [row.origin, row.body, row.conversation_id, row.created_by])).toEqual([
      ["human", bodies.scheduled_send, "conv-1", OWNER],
      ["reminder", bodies.reminder, "conv-1", OWNER],
    ]);

    const texts = await probe.automatedTexts({ tenant: "QA-W", nonce: "n0nce" });
    expect(texts.map((t) => [t.kind, t.state, t.reply])).toEqual([
      ["away_reply", "sent", true],
      ["emergency_ack", "pending", true],
      ["scheduled_send", "held", false],
      ["reminder", "pending", false],
    ]);

    await probe.disarmAutomations({ tenant: "QA-W", nonce: "n0nce" });
    const patches = requests.filter((r) => r.method === "PATCH" && r.url.startsWith(rest("companies")));
    expect(JSON.parse(patches.at(-1)!.body!)).toMatchObject({ away_enabled: false, away_message: null, business_hours: { mon: { open: "09:00", close: "17:00" } } });
    const cancel = requests.find((r) => r.method === "PATCH" && r.url.startsWith(rest("scheduled_messages")))!;
    expect(decodeURIComponent(cancel.url)).toContain("status=in.(pending,held)");
    expect(await probe.automatedTexts({ tenant: "QA-W", nonce: "n0nce" })).toEqual([]);
  });

  it("refuses to arm S25 where there is no thread to arm it in", async () => {
    const { probe } = probeWith({ [`GET ${rest("contacts")}`]: () => json([]) }, tempDir());
    await expect(probe.armAutomations({ tenant: "QA-W", toRole: "ROBOT-1", nonce: "n0nce" })).rejects.toThrow(/no thread with ROBOT-1/);
  });
});

describe("the hand-off and the fault file", () => {
  it("keeps S28's record by Telnyx id and never by number", async () => {
    const handoff = new HandoffFile(tempDir());
    expect(await handoff.read()).toBeNull();
    const record = { tenant: "QA-G", run_id: "S28-r", telnyx_phone_number_id: "2345678901", phone_number_id: "row", bought_at: "t", state: "bought" as const };
    await handoff.write(record);
    expect(await handoff.read()).toEqual(record);
    await expect(handoff.write({ ...record, telnyx_phone_number_id: "+14165550120" })).rejects.toThrow(/never a number/);
    await handoff.clear();
    expect(await handoff.read()).toBeNull();
  });

  it("answers exactly one call event with the armed status, and never a text", async () => {
    const faults = new FaultFile(tempDir());
    const { fetch, requests } = fakeFetch({ [`POST ${API}/webhooks/telnyx`]: () => new Response("{}", { status: 200 }) });
    const forward = webhookForwarder({ apiBase: API, robotBase: "http://127.0.0.1:7311", robotToken: "r", takeFault: () => faults.take(), fetch });
    const frame = (kind: "call" | "message") => ({ t: "webhook" as const, id: "1", kind, path: "/t/v", headers: {}, body: "{}", attempt: 1 });
    faults.arm(503);
    expect((await forward(frame("message"))).status).toBe(200);
    expect((await forward(frame("call"))).status).toBe(503);
    expect((await forward(frame("call"))).status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(() => faults.arm(200)).toThrow(/5xx/);
  });

  it("disarms a fault no call event took, so a later run's event is answered by the API", () => {
    const faults = new FaultFile(tempDir());
    faults.arm(503);
    faults.disarm();
    expect(faults.take()).toBeUndefined();
    faults.disarm();
  });

  it("drops a fault nothing took within a lease's length", () => {
    let now = 0;
    const faults = new FaultFile(tempDir(), () => now);
    faults.arm(503);
    now = 16 * 60 * 1000;
    expect(faults.take()).toBeUndefined();
  });
});

describe("the undo handlers", () => {
  /** Every kind rigd's own code registers, by its literal or the one constant that names one. */
  function registeredKinds(): Map<string, string[]> {
    const kinds = new Map<string, string[]>();
    const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
    for (const path of sources) {
      const text = readFileSync(join(SRC, path), "utf8");
      const found = [...text.matchAll(/\bkind: "([a-z]+\.[a-z-]+)"/g)]
        .map((match) => match[1]!)
        // A PostgREST filter on a column named kind, such as `kind: "eq.campaign"`, is not an undo.
        .filter((kind) => !/^(eq|neq|in|is|gt|gte|lt|lte|like|ilike)\./.test(kind));
      if (/\bkind: STRIPE_DELETE_UNDO\b/.test(text)) found.push(STRIPE_DELETE_UNDO);
      for (const kind of found) kinds.set(kind, [...(kinds.get(kind) ?? []), path]);
    }
    return kinds;
  }

  it("cover every kind a runner or the app probe registers, so no release fails for want of one", () => {
    const unused = () => {
      throw new Error("not built in this test");
    };
    const handlers = undoHandlers({ robot: { sms: unused }, app: unused, guard: unused, handoff: new FakeHandoff(), devices: unused, rig: unused, stripe: unused });
    const kinds = registeredKinds();
    expect(kinds.size).toBeGreaterThanOrEqual(20);
    const missing = [...kinds].filter(([kind]) => !(kind in handlers)).map(([kind, paths]) => `${kind} (${paths.join(", ")})`);
    expect(missing).toEqual([]);
  });
});

describe("the held number's undo", () => {
  const record = { tenant: "QA-G", run_id: "S28-r", telnyx_phone_number_id: "777", phone_number_id: "row-777", bought_at: "t" };

  it("leaves a number S28 handed off, and releases one it did not", async () => {
    const guard = new FakeGuard();
    const app = new FakeApp(new FakeTime());
    const handoff = new FakeHandoff();
    guard.held.add("777");
    app.numbers.set("QA-G", [{ id: "row-777", status: "active", telnyx_phone_number_id: "777", voice_connection_id: null, label: null, suspended_at: null, released_at: null }]);
    const params = { telnyx_phone_number_id: "777", phone_number_id: "row-777", unless_handed_off: true };

    handoff.record = { ...record, state: "handed_off" };
    await releaseHeldNumber(params, { guard, app, handoff });
    expect(guard.released).toEqual([]);

    handoff.record = { ...record, state: "bought" };
    await releaseHeldNumber(params, { guard, app, handoff });
    expect(guard.released).toEqual(["777"]);
    expect(app.numbers.get("QA-G")![0]!.status).toBe("released");
    expect(handoff.record).toBeNull();
  });

  it("counts a number already gone as released, and fails on a guard refusal", async () => {
    const app = new FakeApp(new FakeTime());
    const handoff = new FakeHandoff();
    await releaseHeldNumber({ telnyx_phone_number_id: "999", phone_number_id: "r" }, { guard: new FakeGuard(), app, handoff });
    const refusing = { releaseNumber: async () => ({ status: 403, rule: "provisioning.number_standing" }) };
    await expect(releaseHeldNumber({ telnyx_phone_number_id: "111", phone_number_id: "r" }, { guard: refusing, app, handoff })).rejects.toThrow(
      /403 \(provisioning.number_standing\)/,
    );
  });

  it("puts a device back at rest", async () => {
    const devices = new FakeDevices();
    const pixel = devices.pixelDevice;
    await pixel.forceDoze();
    await pixel.lock();
    await resetDevice(devices, "pixel");
    expect(pixel.actions.slice(2)).toEqual(["exit doze", "battery saver off", "bucket active", "hibernate off", "notifications allowed", "call permissions allowed", "unlock"]);
    await expect(resetDevice(devices, "phone")).rejects.toThrow(/device: pixel/);
  });

  it("runs every step of a device reset when one fails, and then fails naming it", async () => {
    const devices = new FakeDevices();
    const pixel = devices.pixelDevice;
    await pixel.lock();
    pixel.batterySaver = async () => {
      throw new Error("adb: device offline");
    };
    await expect(resetDevice(devices, "pixel")).rejects.toThrow(/battery saver off: adb: device offline/);
    expect(pixel.actions.slice(1)).toEqual(["exit doze", "bucket active", "hibernate off", "notifications allowed", "call permissions allowed", "unlock"]);
  });

  it("puts the current build back, its notifications allowed and its member signed in", async () => {
    const devices = new FakeDevices();
    await reinstallDevice(devices, { device: "pixel", build: "current", member: "qa-a-technician" });
    expect(devices.pixelDevice.actions).toEqual(["install current", "notifications allowed", "call permissions allowed", "sign in qa-a-technician"]);
    await expect(reinstallDevice(devices, { device: "pixel", build: "nightly", member: "qa-a-technician" })).rejects.toThrow(/build and member/);
    await expect(reinstallDevice(devices, { device: "pixel", build: "current" })).rejects.toThrow(/build and member/);
  });

  it("boots an emulator a run shut down, and only one nothing else has booted", async () => {
    const devices = new FakeDevices();
    devices.emulator(35).reachableNow = false;
    await bootDevice(devices, "emulator-35");
    await bootDevice(devices, "emulator-36");
    expect(devices.actions).toEqual(["boot 35"]);
    await expect(bootDevice(devices, "pixel")).rejects.toThrow(/for emulators/);
  });
});

describe("mail", () => {
  it("finds every link in a quoted-printable body", () => {
    expect(linksIn("Open https://app.rig.internal/invite?token=3D=\nabc and https://x.example/a.")).toEqual([
      "https://app.rig.internal/invite?token=abc",
      "https://x.example/a",
    ]);
  });

  it("reads the robot's mail by tag and Mailpit's by address, and follows a link without following its redirect", async () => {
    const { fetch, requests } = fakeFetch({
      "GET http://127.0.0.1:54324/api/v1/search": () =>
        json({ messages: [{ ID: "m1", Created: "2026-10-31T15:01:00Z", Subject: "Confirm", To: [{ Address: "a@resend.dev" }] }] }),
      "GET http://127.0.0.1:54324/api/v1/message/m1": () => json({ Text: "Confirm: https://app.rig.internal/auth/confirm?t=1" }),
      "GET https://app.rig.internal/auth/confirm": () => new Response(null, { status: 303, headers: { location: "/inbox" } }),
    });
    const mail = new MailClient({
      robotMailbox: "rig-robot@example.invalid",
      storedMail: () => [
        { id: "1", to: "rig-robot+s34@example.invalid", from: "f", subject: "Invite", raw: "Subject: Invite\r\n\r\nJoin https://app.rig.internal/join", received_at: "2026-10-31T15:00:00Z" },
        { id: "2", to: "rig-robot+other@example.invalid", from: "f", subject: "x", raw: "\r\n\r\nx", received_at: "2026-10-31T15:00:00Z" },
      ],
      mailpitUrl: "http://127.0.0.1:54324",
      fetch,
    });
    expect(mail.robotAddress("s34")).toBe("rig-robot+s34@example.invalid");
    expect((await mail.robotMail({ since: 0, tag: "s34" })).map((m) => m.links)).toEqual([["https://app.rig.internal/join"]]);
    const [confirm] = await mail.mailpit({ to: "a@resend.dev", since: Date.UTC(2026, 9, 31, 15) });
    expect(confirm!.links).toEqual(["https://app.rig.internal/auth/confirm?t=1"]);
    expect(await mail.openLink(confirm!.links[0]!)).toEqual({ status: 303, location: "/inbox" });
    expect(decodeURIComponent(requests[0]!.url)).toContain('to:"a@resend.dev"');
  });
});

describe("the Stripe sandbox", () => {
  it("encodes nested parameters the way Stripe reads them", () => {
    expect(formEncode({ customer: "cus_1", items: [{ price: "price_1" }], metadata: { rig: "s29" } })).toEqual([
      "customer=cus_1",
      "items%5B0%5D%5Bprice%5D=price_1",
      "metadata%5Brig%5D=s29",
    ]);
  });

  it("sends only with a test key and only on the paths the rig uses", async () => {
    const { fetch, requests } = fakeFetch({ "POST https://api.stripe.com/v1/test_helpers/test_clocks": () => json({ id: "clock_1", livemode: false }) });
    const sandbox = (key: string) => new StripeSandbox({ key: () => key, subscriptionIdOf: async () => null, checkoutSubscriptionOf: async () => null, fetch });
    expect(await sandbox("sk_test_x").request("POST", "/v1/test_helpers/test_clocks", { frozen_time: 1 })).toMatchObject({ id: "clock_1" });
    expect(requests[0]!.body).toBe("frozen_time=1");
    await expect(sandbox("sk_live_x").request("POST", "/v1/test_helpers/test_clocks")).rejects.toThrow(/not a test-mode key/);
    await expect(sandbox("sk_test_x").request("POST", "/v1/transfers")).rejects.toThrow(/not a path the rig uses/);
    expect(requests).toHaveLength(1);
  });

  it("stops at a live-mode answer", async () => {
    const { fetch } = fakeFetch({ "GET https://api.stripe.com/v1/subscriptions/sub_1": () => json({ id: "sub_1", status: "active", livemode: true }) });
    const sandbox = new StripeSandbox({ key: () => "sk_test_x", subscriptionIdOf: async () => "sub_1", checkoutSubscriptionOf: async () => null, fetch });
    await expect(sandbox.subscriptionOf("QA-W")).rejects.toThrow(/live mode/);
  });

  it("tags what it creates: metadata on a customer or subscription, a name prefix on a named clock", async () => {
    const { fetch, requests } = fakeFetch({ "POST https://api.stripe.com/v1/": () => json({ id: "x_1", livemode: false }) });
    const sandbox = new StripeSandbox({ key: () => "sk_test_x", subscriptionIdOf: async () => null, checkoutSubscriptionOf: async () => null, fetch });
    await sandbox.request("POST", "/v1/customers", { email: "a@resend.dev", metadata: { rig: "s29" } });
    await sandbox.request("POST", "/v1/subscriptions", { customer: "cus_1" });
    await sandbox.request("POST", "/v1/test_helpers/test_clocks", { frozen_time: 1, name: "S29 run" });
    await sandbox.request("POST", "/v1/test_helpers/test_clocks", { frozen_time: 1, name: "loonext_rig S29 run" });
    expect(requests.map((r) => decodeURIComponent(r.body ?? ""))).toEqual([
      "email=a@resend.dev&metadata[rig]=s29&metadata[loonext_rig]=1",
      "customer=cus_1&metadata[loonext_rig]=1",
      "frozen_time=1&name=loonext_rig S29 run",
      "frozen_time=1&name=loonext_rig S29 run",
    ]);
  });

  it("deletes or advances only what carries the tag, reading it first", async () => {
    const objects: Record<string, unknown> = {
      sub_ours: { id: "sub_ours", metadata: { loonext_rig: "1" } },
      sub_dev: { id: "sub_dev", metadata: {} },
      clock_ours: { id: "clock_ours", name: "loonext_rig S29" },
      clock_dev: { id: "clock_dev", name: "S29" },
      clock_unnamed: { id: "clock_unnamed" },
    };
    const { fetch, requests } = fakeFetch({
      "GET https://api.stripe.com/v1/": (r) => json(objects[r.url.split("/").pop()!] ?? {}),
      "DELETE https://api.stripe.com/v1/": () => json({ deleted: true }),
      "POST https://api.stripe.com/v1/": () => json({}),
    });
    const sandbox = new StripeSandbox({ key: () => "sk_test_x", subscriptionIdOf: async () => null, checkoutSubscriptionOf: async () => null, fetch });
    await sandbox.request("DELETE", "/v1/subscriptions/sub_ours");
    await sandbox.request("POST", "/v1/test_helpers/test_clocks/clock_ours/advance", { frozen_time: 2 });
    await sandbox.request("DELETE", "/v1/test_helpers/test_clocks/clock_ours");
    await expect(sandbox.request("DELETE", "/v1/subscriptions/sub_dev")).rejects.toThrow(/not tagged as the rig's/);
    await expect(sandbox.request("DELETE", "/v1/test_helpers/test_clocks/clock_dev")).rejects.toThrow(/not tagged as the rig's/);
    await expect(sandbox.request("POST", "/v1/test_helpers/test_clocks/clock_unnamed/advance", { frozen_time: 2 })).rejects.toThrow(/not tagged/);
    expect(requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url.replace("https://api.stripe.com", "")}`)).toEqual([
      "DELETE /v1/subscriptions/sub_ours",
      "POST /v1/test_helpers/test_clocks/clock_ours/advance",
      "DELETE /v1/test_helpers/test_clocks/clock_ours",
    ]);
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(6);
  });

  it("adopts only the Checkout subscription the rig's database gives a sign-up address", async () => {
    const tag = "POST https://api.stripe.com/v1/subscriptions/sub_s32";
    const { fetch, requests } = fakeFetch({
      "GET https://api.stripe.com/v1/subscriptions/sub_s32": () => json({ id: "sub_s32", metadata: {} }),
      [tag]: () => json({ id: "sub_s32", metadata: { loonext_rig: "1" } }),
    });
    const owner = "delivered+rig-s32-run-1@resend.dev";
    const sandbox = new StripeSandbox({
      key: () => "sk_test_x",
      subscriptionIdOf: async () => null,
      checkoutSubscriptionOf: async (email) => (email === owner ? "sub_s32" : null),
      fetch,
    });
    await expect(sandbox.adoptCheckoutSubscription({ ownerEmail: "dev@example.test", subscriptionId: "sub_s32" })).rejects.toThrow(/sign-up scenario/);
    await expect(sandbox.adoptCheckoutSubscription({ ownerEmail: owner, subscriptionId: "sub_other" })).rejects.toThrow(/does not give/);
    expect(requests).toEqual([]);
    await sandbox.adoptCheckoutSubscription({ ownerEmail: owner, subscriptionId: "sub_s32" });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET https://api.stripe.com/v1/subscriptions/sub_s32", tag]);
    expect(decodeURIComponent(requests[1]!.body ?? "")).toBe("metadata[loonext_rig]=1");
  });

  it("deletes a run's subscription or test clock once, and leaves one already gone", async () => {
    const stripe = new FakeStripe();
    const deletes = () => stripe.requests.filter((r) => r.method === "DELETE").map((r) => r.path);
    stripe.answers.set("GET /v1/subscriptions/sub_1", { id: "sub_1", status: "active" });
    await deleteStripeObject(stripe, { path: "/v1/subscriptions/sub_1" });
    expect(deletes()).toEqual(["/v1/subscriptions/sub_1"]);

    stripe.answers.set("GET /v1/subscriptions/sub_1", { id: "sub_1", status: "canceled" });
    await deleteStripeObject(stripe, { path: "/v1/subscriptions/sub_1" });
    stripe.answers.set("GET /v1/test_helpers/test_clocks/clock_1", { id: "clock_1", deleted: true });
    await deleteStripeObject(stripe, { path: "/v1/test_helpers/test_clocks/clock_1" });
    expect(deletes()).toHaveLength(1);

    const gone = new FakeStripe();
    gone.request = async () => {
      throw new Error("stripe sandbox: GET answered 404 resource_missing");
    };
    await expect(deleteStripeObject(gone, { path: "/v1/test_helpers/test_clocks/clock_1" })).resolves.toBeUndefined();
  });

  it("deletes nothing but a subscription or a test clock", async () => {
    const stripe = new FakeStripe();
    await expect(deleteStripeObject(stripe, { path: "/v1/customers/cus_1" })).rejects.toThrow(/subscription or test clock/);
    await expect(deleteStripeObject(stripe, {})).rejects.toThrow(/subscription or test clock/);
    expect(stripe.requests).toEqual([]);
  });
});

describe("the rig box", () => {
  it("reads the local API's events from the relay's record, oldest first", async () => {
    const dir = tempDir();
    const relayState = join(dir, "relay.json");
    writeFileSync(relayState, JSON.stringify({ apiSeen: { a: { at: 30, message: "late" }, b: 10, c: { at: 20, message: "carrier ceiling 80%" } } }));
    const rig = new RigOps({ stateDir: dir, rigBin: "rig.mjs", relayState, faults: new FaultFile(dir) });
    expect((await rig.apiEvents(15)).map((event) => event.message)).toEqual(["carrier ceiling 80%", "late"]);
  });

  it("runs rig health and reads the report it writes, even when a check failed", async () => {
    const dir = tempDir();
    const ran: string[][] = [];
    const rig = new RigOps({
      stateDir: dir,
      rigBin: "/tools/rig/bin/rig.mjs",
      relayState: join(dir, "relay.json"),
      faults: new FaultFile(dir),
      exec: async (file, args) => {
        ran.push([file, ...args]);
        writeFileSync(join(dir, "health.json"), JSON.stringify({ at: "t", sha: "abc1234", results: [{ name: "api", pass: false, reason: "down" }] }));
      },
    });
    expect((await rig.health()).results).toEqual([{ name: "api", pass: false, reason: "down" }]);
    expect(ran).toEqual([[process.execPath, "/tools/rig/bin/rig.mjs", "health"]]);
  });

  /** The contract's devices behind a fake hostd, with adb answering for the serials that are up. */
  function hostdDevices(options: { up: string[]; locked?: boolean; pins?: Record<string, unknown> }) {
    const up = new Set(options.up);
    const calls: string[] = [];
    const hostd: string[] = [];
    const serialOf = (name: string) => ({ pixel: "emulator-5560", "emulator-34": "emulator-5554", "emulator-35": "emulator-5556", "emulator-36": "emulator-5558" })[name]!;
    const devices = rigDevices({
      pkg: "com.loonext.android.nonprod",
      apks: { current: "current.apk", previous: "previous.apk" },
      pin: () => "2468",
      hostd: {
        async boot(name, boot) {
          hostd.push(`boot ${name} ${JSON.stringify(boot)}`);
          up.add(serialOf(name));
        },
        async kill(name, kill) {
          hostd.push(`kill ${name} ${JSON.stringify(kill)}`);
          up.delete(serialOf(name));
        },
        async tokens() {
          return { console: "c0nsoleT0ken", grpc: "grpcT0ken" };
        },
        async health() {
          return { whpx_usable: true, tunnel_up: true, reboot_pending: false };
        },
      },
      audioProof: () => undefined,
      playServicesPins: () => {
        if (!options.pins) throw new Error("rig secrets: play-services-pins.json is not in the store (/rig/secrets)");
        return options.pins;
      },
      numbers: numberBook({}),
      credentials: () => undefined,
      portCheck: async () => true,
      exec: async (file, args) => {
        const line = [file, ...args].join(" ");
        calls.push(line);
        const serial = args[args.indexOf("-s") + 1]!;
        if (line.endsWith("getprop sys.boot_completed")) return up.has(serial) ? "1\n" : "";
        if (line.endsWith("dumpsys window")) return options.locked ? "mShowingLockscreen=true" : "";
        return "";
      },
    });
    return { devices, calls, hostd, up };
  }

  it("builds every device the host contract lists, adb through the tunnel and the device lane's serial overridable", async () => {
    const { devices, calls } = hostdDevices({ up: [] });
    for (const device of [devices.pixel(), devices.emulator(34), devices.emulator(35), devices.emulator(36)]) await device.reachable();
    expect(calls).toEqual(
      ["emulator-5560", "emulator-5554", "emulator-5556", "emulator-5558"].map((serial) => `adb -H 127.0.0.1 -P 15037 -s ${serial} shell getprop sys.boot_completed`),
    );
    expect(devices.pixel().name).toBe("pixel");
    expect(devices.emulator(35).name).toBe("emulator-35");
    expect(await devices.pixel().audio.proven()).toBe(false);
    await expect(devices.pixel().audio.playCode("pixel")).rejects.toThrow("emulator-audio-unproven");

  });

  it("boots an emulator through hostd only when adb finds it down, and settles it: unlocked, Doze enabled", async () => {
    const world = hostdDevices({ up: ["emulator-5560", "emulator-5556"], locked: true });
    await world.devices.bootEmulator(35);
    expect(world.hostd).toEqual([]);
    await world.devices.bootEmulator(34);
    expect(world.hostd).toEqual(['boot emulator-34 {"cold":false,"wipe":false}']);
    const after = world.calls.slice(world.calls.indexOf("adb -H 127.0.0.1 -P 15037 -s emulator-5554 wait-for-device"));
    expect(after).toEqual([
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 wait-for-device",
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 shell getprop sys.boot_completed",
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 shell dumpsys window",
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 shell input keyevent KEYCODE_WAKEUP",
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 shell wm dismiss-keyguard",
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 shell input text 2468",
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 shell input keyevent KEYCODE_ENTER",
      "adb -H 127.0.0.1 -P 15037 -s emulator-5554 shell dumpsys deviceidle enable all",
    ]);
    expect(world.calls.some((line) => /\bemulator\b.*-avd/.test(line))).toBe(false);
  });

  it("stops another E01 AVD to stay within max_booted, never the device lane's", async () => {
    const world = hostdDevices({ up: ["emulator-5560", "emulator-5554", "emulator-5558"] });
    await world.devices.bootEmulator(35);
    expect(world.hostd).toEqual(['kill emulator-34 {"hard":false}', 'boot emulator-35 {"cold":false,"wipe":false}']);
    expect(world.up).toEqual(new Set(["emulator-5560", "emulator-5558", "emulator-5556"]));
  });

  it("cold-restarts a device: hostd kills it hard and boots it cold, then the PIN and Doze", async () => {
    const world = hostdDevices({ up: ["emulator-5560"], locked: true });
    await world.devices.coldRestart("pixel");
    expect(world.hostd).toEqual(['kill pixel {"hard":true}', 'boot pixel {"cold":true,"wipe":false}']);
    expect(world.calls).toContain("adb -H 127.0.0.1 -P 15037 -s emulator-5560 shell input text 2468");
    expect(world.calls.at(-1)).toBe("adb -H 127.0.0.1 -P 15037 -s emulator-5560 shell dumpsys deviceidle enable all");
    await world.devices.shutdownEmulator(36);
    expect(world.hostd.at(-1)).toBe('kill emulator-36 {"hard":false}');
  });

  it("reads the pinned Play services version by device, and fails without the store's pins", () => {
    expect(hostdDevices({ up: [], pins: { pixel: "25.0.0", "emulator-34": 7 } }).devices.playServicesPin("pixel")).toBe("25.0.0");
    expect(hostdDevices({ up: [], pins: { pixel: "25.0.0", "emulator-34": 7 } }).devices.playServicesPin("emulator-34")).toBeUndefined();
    expect(() => hostdDevices({ up: [] }).devices.playServicesPin("pixel")).toThrow(/play-services-pins\.json/);
  });

  it("clears the device lane's console shaping on rig.network-clear", async () => {
    const devices = new FakeDevices();
    await devices.pixelDevice.network.shape({ delayMs: 80, speedKbps: { up: 256, down: 1_024 } });
    const unused = () => {
      throw new Error("not built in this test");
    };
    const handlers = undoHandlers({ robot: { sms: unused }, app: unused, guard: unused, handoff: new FakeHandoff(), devices: () => devices, rig: unused, stripe: unused });
    await handlers["rig.network-clear"]!({});
    expect(devices.pixelDevice.network.shaped).toBeNull();
    expect(devices.pixelDevice.network.clears).toHaveLength(1);
  });
});

describe("the app's dialer", () => {
  const numbers = numberBook({ "ROBOT-1": "+14165550111" });

  /** A device whose screens show the controls in `present`, as a list the test edits. */
  function dialerDevice(present: Set<string>, onReset: () => void = () => undefined) {
    const actions: string[] = [];
    return {
      actions,
      device: {
        async launch(path?: string) {
          actions.push(`launch ${path ?? ""}`.trim());
        },
        async tapText(text: string) {
          if (!present.has(text)) return false;
          actions.push(`tap ${text}`);
          return true;
        },
        async resetUi() {
          actions.push("reset ui");
          onReset();
          return { crashPrompt: false };
        },
      },
    };
  }

  it("types the number's digits and presses Call, with no reset when the calls screen is as it should be", async () => {
    const { device, actions } = dialerDevice(new Set(["Dial a number", ..."4165550111".split(""), "Call"]));
    await dialOnDevice(device, "ROBOT-1", numbers);
    expect(actions).toEqual(["launch /calls", "tap Dial a number", ...[..."4165550111"].map((d) => `tap ${d}`), "tap Call"]);
  });

  it("resets the app once and asks again when a sheet the last run left open hides the dialer's button", async () => {
    const present = new Set(["Call", ..."4165550111".split("")]);
    const { device, actions } = dialerDevice(present, () => present.add("Dial a number"));
    await dialOnDevice(device, "ROBOT-1", numbers);
    expect(actions.slice(0, 4)).toEqual(["launch /calls", "reset ui", "launch /calls", "tap Dial a number"]);
    expect(actions.at(-1)).toBe("tap Call");
  });

  it("says the calls screen offered no dialer when a reset does not bring it back, and never presses Call", async () => {
    const { device, actions } = dialerDevice(new Set(["Call"]));
    await expect(dialOnDevice(device, "ROBOT-1", numbers)).rejects.toThrow("the app's calls screen offered no dialer");
    expect(actions).toEqual(["launch /calls", "reset ui", "launch /calls"]);
  });
});

describe("the Chrome the browser lane opens push pages in", () => {
  it("is the one RIG_CHROME_BIN names, else the one bootstrap.sh installs, else none", () => {
    expect(chromeOf({ RIG_CHROME_BIN: "/opt/chrome" }, () => true)).toEqual({ executablePath: "/opt/chrome" });
    expect(chromeOf({}, (path) => path === CHROME_STABLE_PATH)).toEqual({ executablePath: "/usr/bin/google-chrome-stable" });
    expect(chromeOf({}, () => false)).toBeUndefined();
  });
});
