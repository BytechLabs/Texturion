/**
 * The real lanes behind the scenario interfaces, against stub servers and
 * temporary directories: what each sends, and what it makes of the answer.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEADER } from "@loonext/rig-protocol";
import { numberBook } from "@loonext/rig-robot";
import { afterEach, describe, expect, it } from "vitest";
import { automationBodies, AppProbe, stableUuid } from "./app-probe.ts";
import { webhookForwarder } from "./forward.ts";
import { GuardClient, PROBE_FOREIGN_CONNECTION } from "./guard-client.ts";
import { MailClient, linksIn } from "./mail-client.ts";
import { RigOps } from "./rig-ops.ts";
import { FakeDevices, FakeGuard, FakeApp, FakeHandoff, FakeTime } from "./scenarios/fakes.ts";
import { FaultFile, HandoffFile } from "./state-files.ts";
import { formEncode, StripeSandbox } from "./stripe-sandbox.ts";
import { fakeFetch, json, type Route } from "./test-support.ts";
import { releaseHeldNumber, resetDevice } from "./wiring.ts";

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

  it("reads the lease's log and keeps only each delivery attempt's host and status", async () => {
    const { guard } = guardWith({
      [`GET ${EDGE}/g/lease/lease-1/activity`]: () => json({ lease_id: "lease-1", live: true, activity: { "rig-api GET /v2/available_phone_numbers 200": 1 } }),
      [`GET ${EDGE}/g/telnyx/v2/webhook_deliveries`]: () =>
        json({
          data: [
            {
              id: "d1",
              status: "delivered",
              webhook: { event_type: "call.initiated" },
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
      attempts: [
        { host: "rig-edge.example.workers.dev", http_status: 503, at: "a" },
        { host: "rig-edge.example.workers.dev", http_status: 200, at: "b" },
      ],
    });
    expect(JSON.stringify(delivery)).not.toContain("secret");
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
  it("sends to a fictional number and refuses any other raw destination before a request", async () => {
    const { probe, requests } = probeWith({ [`POST ${API}/v1/conversations`]: () => json({ error: { code: "rig_destination_refused" } }, 422) });
    expect(await probe.sendTextToFictional({ member: "qa-w-owner", fromRole: "DEV-W1", e164: "+14165550199", body: "b" })).toEqual({
      ok: false,
      status: 422,
      code: "rig_destination_refused",
    });
    await expect(probe.sendTextToFictional({ member: "qa-w-owner", fromRole: "DEV-W1", e164: "+1416555", body: "b" })).rejects.toThrow(/fictional/);
    expect(requests.filter((r) => r.url.includes("/v1/conversations"))).toHaveLength(1);
  });

  it("authorises a browser call from the tenant's own number and passes a refusal back", async () => {
    const { probe, requests } = probeWith({
      [`POST ${API}/v1/calls/browser`]: (request) =>
        JSON.parse(request.body!).to === "+14165550199" ? json({ error: { code: "rig_destination_refused" } }, 422) : json({ session_id: "s-1" }),
    });
    expect(await probe.placeCall({ member: "qa-w-owner", fromRole: "DEV-W1", to: "ROBOT-1" })).toEqual({ ok: true, sessionId: "s-1" });
    expect(await probe.placeCall({ member: "qa-w-owner", fromRole: "DEV-W1", to: { fictional: "+14165550199" } })).toEqual({
      ok: false,
      status: 422,
      code: "rig_destination_refused",
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
      [`DELETE ${rest("usage_events")}`]: () => new Response(null, { status: 204 }),
    });
    const { marker } = await probe.seedUsage({ tenant: "QA-W", type: "sms", quantity: 5 });
    const row = JSON.parse(requests.find((r) => r.method === "POST")!.body!);
    expect(row).toMatchObject({ company_id: COMPANY, type: "sms", quantity: 5, meter_identifier: marker });
    expect(row.stripe_reported_at).toBeTruthy();
    await probe.clearSeededUsage(marker);
    expect(requests.find((r) => r.method === "DELETE")!.url).toContain(`meter_identifier=eq.${marker}`);
    await expect(probe.clearSeededUsage("real-meter")).rejects.toThrow(/seeded/);
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
      [`POST ${API}/v1/numbers/provision`]: () => json({ number: { id: "row-1" } }, 201),
    });
    expect(await probe.provisionNumber({ member: "qa-w-owner" })).toMatchObject({ status: 201, body: { number: { id: "row-1" } } });
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

  it("drops a fault nothing took within a lease's length", () => {
    let now = 0;
    const faults = new FaultFile(tempDir(), () => now);
    faults.arm(503);
    now = 16 * 60 * 1000;
    expect(faults.take()).toBeUndefined();
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
    expect(pixel.actions.slice(2)).toEqual(["exit doze", "battery saver off", "bucket active", "hibernate off", "notifications allowed", "unlock"]);
    await expect(resetDevice(devices, "phone")).rejects.toThrow(/device: pixel/);
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
    const sandbox = (key: string) => new StripeSandbox({ key: () => key, subscriptionIdOf: async () => null, fetch });
    expect(await sandbox("sk_test_x").request("POST", "/v1/test_helpers/test_clocks", { frozen_time: 1 })).toMatchObject({ id: "clock_1" });
    expect(requests[0]!.body).toBe("frozen_time=1");
    await expect(sandbox("sk_live_x").request("POST", "/v1/test_helpers/test_clocks")).rejects.toThrow(/not a test-mode key/);
    await expect(sandbox("sk_test_x").request("POST", "/v1/transfers")).rejects.toThrow(/not a path the rig uses/);
    expect(requests).toHaveLength(1);
  });

  it("stops at a live-mode answer", async () => {
    const { fetch } = fakeFetch({ "GET https://api.stripe.com/v1/subscriptions/sub_1": () => json({ id: "sub_1", status: "active", livemode: true }) });
    const sandbox = new StripeSandbox({ key: () => "sk_test_x", subscriptionIdOf: async () => "sub_1", fetch });
    await expect(sandbox.subscriptionOf("QA-W")).rejects.toThrow(/live mode/);
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
});
