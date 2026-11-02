/**
 * The app probe's reads and writes against a stub of the local API, auth and
 * PostgREST: what each request names, and what each answer comes back as.
 * The answers are the shapes apps/api and Supabase send.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numberBook } from "@loonext/rig-robot";
import { describe, expect, it } from "vitest";
import { totpCode } from "../../../../scripts/rig/seed.mjs";
import { AppProbe, MAIL_ACCOUNT_ADDRESS, SIGN_UP_ADDRESS, signUpNumberKey, stableUuid, VOICEMAILS_BUCKET } from "./app-probe.ts";
import { fakeFetch, json, type Recorded, type Route } from "./test-support.ts";

const SUPABASE = "http://127.0.0.1:54321";
const API = "http://127.0.0.1:8787";
const COMPANY = "0f4c7a52-1d1e-4a4b-9c55-3a2b1c0d9e8f";
const OWNER = "11111111-2222-4333-8444-555555555555";
const TECH = "22222222-3333-4444-8555-666666666666";
const SIGN_UP_USER = "33333333-4444-4555-8666-777777777777";
const NOW = Date.UTC(2026, 9, 31, 15);
/** RFC 4226's test key, in base32. */
const rfcSeed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SIGN_UP_EMAIL = "delivered+rig-s35-n0nce@resend.dev";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const rest = (table: string) => `${SUPABASE}/rest/v1/${table}`;
const query = (request: Recorded) => Object.fromEntries(new URL(request.url).searchParams);
const noContent = () => new Response(null, { status: 204 });

function probeWith(routes: Record<string, Route>, stateDir?: string) {
  const { fetch, requests } = fakeFetch({
    [`POST ${SUPABASE}/auth/v1/token`]: () => json({ access_token: jwt({ sub: OWNER, aal: "aal1" }), expires_in: 3600 }),
    [`GET ${SUPABASE}/auth/v1/admin/users`]: () =>
      json({
        users: [
          { id: OWNER, email: "delivered+rig-qa-w-owner@resend.dev" },
          { id: TECH, email: "Delivered+rig-qa-w-technician@resend.dev" },
          { id: SIGN_UP_USER, email: SIGN_UP_EMAIL },
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
          "mfa-member": { email: "delivered+rig-qa-w-mfa-member@resend.dev", password: "pw", totp_secret: rfcSeed },
        },
      },
    },
    numbers: numberBook({ "ROBOT-1": "+14165550101", "ROBOT-2": "+14165550102", "DEV-W1": "+14165550111" }),
    apiBase: API,
    supabaseUrl: SUPABASE,
    serviceRoleKey: "service",
    anonKey: "publishable",
    edgeOrigin: "https://rig-edge.example.workers.dev",
    guardToken: "t",
    robotMailbox: () => "rig-robot@example.invalid",
    fetch,
    now: () => NOW,
    ...(stateDir ? { stateDir } : {}),
  });
  return { probe, requests };
}

/** A thread with ROBOT-1: its contact, then its conversation. */
const THREAD: Record<string, Route> = {
  [`GET ${rest("contacts")}`]: () => json([{ id: "contact-1" }]),
  [`GET ${rest("conversations")}`]: () => json([{ id: "conv-1" }]),
};

describe("the app probe's messages", () => {
  it("confirms the quiet-hours prompt so a text sent in the Toronto night still goes", async () => {
    const { probe, requests } = probeWith({
      [`POST ${API}/v1/conversations`]: () => json({ message: { id: "m-1", status: "queued", error_code: null } }, 201),
    });
    expect(await probe.sendText({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1", body: "Rig night" })).toEqual({ ok: true, messageId: "m-1" });
    const sent = requests.find((r) => r.url === `${API}/v1/conversations`)!;
    expect(JSON.parse(sent.body!)).toMatchObject({ body: "Rig night", quiet_hours_confirmed: true });
  });

  it("sends a picture into the thread with the role, and reads a filed-then-failed send as refused", async () => {
    const answers = [
      json({ message: { id: "m-1", status: "queued", error_code: null } }, 201),
      json({ message: { id: "m-2", status: "failed", error_code: "40008" } }, 201),
      json({ error: { code: "recipient_opted_out" } }, 403),
    ];
    const { probe, requests } = probeWith({ ...THREAD, [`POST ${API}/v1/messages/send`]: () => answers.shift()! });
    const send = () =>
      probe.sendMms({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1", body: "Rig pic", media: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" } });
    expect(await send()).toEqual({ ok: true, messageId: "m-1" });
    expect(await send()).toEqual({ ok: false, status: 201, code: "40008" });
    expect(await send()).toEqual({ ok: false, status: 403, code: "recipient_opted_out" });
    const sent = requests.find((r) => r.url === `${API}/v1/messages/send`)!;
    expect(JSON.parse(sent.body!)).toEqual({ conversation_id: "conv-1", body: "Rig pic", media: [{ content_type: "image/jpeg", base64: "AQID" }] });
    expect(sent.headers["x-company-id"]).toBe(COMPANY);
    expect(query(requests.find((r) => r.url.startsWith(rest("contacts")))!)).toMatchObject({ company_id: `eq.${COMPANY}`, phone_e164: "eq.+14165550101" });
  });

  it("refuses to send a picture where there is no thread, before any send", async () => {
    const { probe, requests } = probeWith({ [`GET ${rest("contacts")}`]: () => json([]) });
    await expect(
      probe.sendMms({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1", body: "x", media: { bytes: new Uint8Array(), contentType: "image/jpeg" } }),
    ).rejects.toThrow(/no thread with ROBOT-1/);
    expect(requests.some((r) => r.url.startsWith(API))).toBe(false);
  });

  it("reads every message in the threads with a role since a time, and none when there is no thread", async () => {
    const { probe, requests } = probeWith({ ...THREAD, [`GET ${rest("messages")}`]: () => json([{ id: "m-1" }]) });
    expect(await probe.messagesWith({ tenant: "QA-W", role: "ROBOT-1", since: NOW })).toEqual([{ id: "m-1" }]);
    expect(query(requests.find((r) => r.url.startsWith(rest("messages")))!)).toMatchObject({
      company_id: `eq.${COMPANY}`,
      conversation_id: "in.(conv-1)",
      created_at: `gte.${new Date(NOW).toISOString()}`,
      order: "created_at.asc",
    });

    const none = probeWith({ [`GET ${rest("contacts")}`]: () => json([]) });
    expect(await none.probe.messagesWith({ tenant: "QA-W", role: "ROBOT-1", since: NOW })).toEqual([]);
    expect(none.requests.some((r) => r.url.startsWith(rest("messages")))).toBe(false);
  });

  it("reads a message's attachments and the stored bytes, refusing a path that climbs out of its bucket", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("message_attachments")}`]: () => json([{ storage_path: "c/m/a.jpg", content_type: "image/jpeg", size_bytes: 3, quarantined_at: null }]),
      [`GET ${SUPABASE}/storage/v1/object/authenticated/mms-media/c/m/a%20b.jpg`]: () => new Response(new Uint8Array([7, 8, 9])),
      [`GET ${SUPABASE}/storage/v1/object/authenticated/mms-media/gone.jpg`]: () => new Response("not found", { status: 404 }),
    });
    expect(await probe.attachments("m-1")).toHaveLength(1);
    expect(query(requests[0]!)).toMatchObject({ message_id: "eq.m-1" });
    expect([...(await probe.storedObject({ bucket: "mms-media", path: "c/m/a b.jpg" }))]).toEqual([7, 8, 9]);
    expect(requests.at(-1)!.headers.authorization).toBe("Bearer service");
    await expect(probe.storedObject({ bucket: "mms-media", path: "gone.jpg" })).rejects.toThrow(/returned 404/);
    const before = requests.length;
    await expect(probe.storedObject({ bucket: "mms-media", path: "../secrets/key" })).rejects.toThrow(/not a storage object/);
    await expect(probe.storedObject({ bucket: "../auth", path: "x" })).rejects.toThrow(/not a storage object/);
    expect(requests).toHaveLength(before);
  });
});

describe("the app probe's calls", () => {
  it("reads a tenant's ring beacons since a time, a member's by their user id", async () => {
    const { probe, requests } = probeWith({ [`GET ${rest("ring_beacons")}`]: () => json([]) });
    await probe.ringBeacons({ tenant: "QA-W", since: NOW, member: "qa-w-technician" });
    await probe.ringBeacons({ tenant: "QA-W", since: NOW });
    const [mine, all] = requests.filter((r) => r.url.startsWith(rest("ring_beacons"))).map(query);
    expect(mine).toMatchObject({ company_id: `eq.${COMPANY}`, occurred_at: `gte.${new Date(NOW).toISOString()}`, user_id: `eq.${TECH}`, order: "occurred_at.asc" });
    expect(all).not.toHaveProperty("user_id");
  });

  it("names a call's legs by member key, matching auth's address whatever its case, and an unknown user as nobody", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("call_member_legs")}`]: () =>
        json([
          { user_id: TECH, state: "answered", kind: "web" },
          { user_id: "99999999-0000-4000-8000-000000000000", state: "cancelled", kind: "android" },
          { user_id: null, state: "failed", kind: null },
        ]),
    });
    expect(await probe.callLegs({ tenant: "QA-W", callSessionId: "session-1" })).toEqual([
      { member: "qa-w-technician", state: "answered", kind: "web" },
      { member: null, state: "cancelled", kind: "android" },
      { member: null, state: "failed", kind: null },
    ]);
    expect(query(requests[0]!)).toMatchObject({ company_id: `eq.${COMPANY}`, call_session_id: "eq.session-1" });
  });

  it("mints a voice token on the probe's session, keeping only the status, and signs that session out", async () => {
    const answers = [json({ token: "voice-credential" }), json({ ok: true }), json({ error: { code: "unauthorized" } }, 401), json({ token: "again" })];
    const { probe, requests } = probeWith({
      [`POST ${API}/v1/webrtc/token`]: () => answers.shift()!,
      [`POST ${API}/v1/sessions/revoke`]: () => answers.shift()!,
    });
    expect(await probe.voiceToken({ member: "qa-w-technician" })).toEqual({ status: 200 });
    expect(await probe.signOutSession({ member: "qa-w-technician" })).toMatchObject({ status: 200 });
    expect(JSON.parse(requests.find((r) => r.url.endsWith("/v1/sessions/revoke"))!.body!)).toEqual({ self: true });
    expect(await probe.voiceToken({ member: "qa-w-technician" })).toEqual({ status: 401, code: "unauthorized" });
    expect(await probe.voiceToken({ member: "qa-w-technician", fresh: true })).toEqual({ status: 200 });
    // One sign-in for the session that was signed out, and one more for the fresh one.
    expect(requests.filter((r) => r.url.startsWith(`${SUPABASE}/auth/v1/token`))).toHaveLength(2);
  });

  it("reads the escalations opened and the Telnyx events recorded since a time", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("alert_escalations")}`]: () => json([]),
      [`GET ${rest("webhook_events")}`]: () => json([{ event_id: "e-1", event_type: "call.initiated", processed_at: null, attempts: 1 }]),
    });
    await probe.escalations({ tenant: "QA-W", since: NOW });
    expect(await probe.webhookEvents({ since: NOW, type: "call.initiated" })).toHaveLength(1);
    await probe.webhookEvents({ since: NOW });
    const [escalations, typed, any] = requests.map(query);
    expect(escalations).toMatchObject({ company_id: `eq.${COMPANY}`, created_at: `gte.${new Date(NOW).toISOString()}` });
    expect(typed).toMatchObject({ provider: "eq.telnyx", received_at: `gte.${new Date(NOW).toISOString()}`, event_type: "eq.call.initiated" });
    expect(any).not.toHaveProperty("event_type");
  });

  it("asks the API to call a robot line for a greeting, and reads the greetings saved since", async () => {
    const { probe, requests } = probeWith({
      [`POST ${API}/v1/voicemail-greetings/capture-call`]: () => json({ ok: true }, 202),
      [`GET ${rest("voicemail_greetings")}`]: () => json([{ id: "g-1" }]),
    });
    expect(await probe.startGreetingCapture({ member: "qa-w-owner", toRole: "ROBOT-2", name: "Rig S15 n0nce" })).toMatchObject({ status: 202 });
    expect(JSON.parse(requests.find((r) => r.url.endsWith("/capture-call"))!.body!)).toEqual({ name: "Rig S15 n0nce", to: "+14165550102" });
    expect(await probe.greetings({ tenant: "QA-W", since: NOW })).toEqual([{ id: "g-1" }]);
    expect(query(requests.at(-1)!)).toMatchObject({ company_id: `eq.${COMPANY}`, created_at: `gte.${new Date(NOW).toISOString()}`, order: "created_at.asc" });
  });
});

describe("the app probe's copied voicemail", () => {
  it("stores the bucket and path apps/api stores a voicemail at", () => {
    const ring = readFileSync(new URL("../../../../apps/api/src/messaging/inbound-ring.ts", import.meta.url), "utf8");
    expect(ring).toContain(`export const VOICEMAILS_BUCKET = "${VOICEMAILS_BUCKET}";`);
    expect(ring).toContain("const path = `${resolved.companyId}/${sessionId}.mp3`;");
  });

  it("copies the caller's newest voicemail, audio and transcript, into a call row on the tenant's number", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("calls")}`]: () => json([{ voicemail_path: "company-w/s04-session.mp3", voicemail_seconds: 6, voicemail_transcript: "hello this is the rig robot" }]),
      [`GET ${SUPABASE}/storage/v1/object/authenticated/voicemails/company-w/s04-session.mp3`]: () => new Response(new Uint8Array([1, 2, 3])),
      [`POST ${SUPABASE}/storage/v1/object/voicemails/`]: () => json({ Key: "x" }),
      [`POST ${rest("calls")}`]: noContent,
    });
    expect(await probe.copyVoicemail({ from: "QA-W", tenant: "QA-W", role: "DEV-W1", callerRole: "ROBOT-1", sessionId: "rig-d14-n0nce" })).toBe(true);
    expect(query(requests.find((r) => r.method === "GET" && r.url.startsWith(rest("calls")))!)).toMatchObject({
      company_id: `eq.${COMPANY}`,
      caller_e164: "eq.+14165550101",
      voicemail_path: "not.is.null",
      order: "started_at.desc",
      limit: "1",
    });
    const upload = requests.find((r) => r.url.startsWith(`${SUPABASE}/storage/v1/object/voicemails/`))!;
    expect(upload.url).toBe(`${SUPABASE}/storage/v1/object/voicemails/${COMPANY}/rig-d14-n0nce.mp3`);
    expect([upload.headers["content-type"], upload.headers.authorization, upload.body]).toEqual(["audio/mpeg", "Bearer service", "\u0001\u0002\u0003"]);
    expect(JSON.parse(requests.find((r) => r.method === "POST" && r.url.startsWith(rest("calls")))!.body!)).toEqual({
      company_id: COMPANY,
      phone_number_id: stableUuid(COMPANY, "DEV-W1"),
      call_session_id: "rig-d14-n0nce",
      caller_e164: "+14165550101",
      direction: "inbound",
      outcome: "voicemail",
      forward_seconds: 0,
      started_at: new Date(NOW).toISOString(),
      ended_at: new Date(NOW).toISOString(),
      voicemail_path: `${COMPANY}/rig-d14-n0nce.mp3`,
      voicemail_seconds: 6,
      voicemail_transcript: "hello this is the rig robot",
      voicemail_transcript_attempted_at: new Date(NOW).toISOString(),
    });
  });

  it("copies nothing when there is no voicemail, and clears only a copy, row then audio", async () => {
    const none = probeWith({ [`GET ${rest("calls")}`]: () => json([]) });
    expect(await none.probe.copyVoicemail({ from: "QA-W", tenant: "QA-W", role: "DEV-W1", callerRole: "ROBOT-1", sessionId: "rig-d14-n0nce" })).toBe(false);
    expect(none.requests.map((r) => r.method)).toEqual(["GET"]);

    const { probe, requests } = probeWith({
      [`DELETE ${rest("calls")}`]: noContent,
      [`DELETE ${SUPABASE}/storage/v1/object/voicemails/`]: () => json({ error: "not_found" }, 404),
    });
    await probe.clearSeededVoicemail({ tenant: "QA-W", sessionId: "rig-d14-n0nce" });
    expect(requests.map((r) => [r.method, r.url.split("?")[0]])).toEqual([
      ["DELETE", rest("calls")],
      ["DELETE", `${SUPABASE}/storage/v1/object/voicemails/${COMPANY}/rig-d14-n0nce.mp3`],
    ]);
    expect(query(requests[0]!)).toEqual({ company_id: `eq.${COMPANY}`, call_session_id: "eq.rig-d14-n0nce" });
    // A real call's session, or a path, is never a copy.
    for (const sessionId of ["v3:abc-real-session", "rig-d14-x/../../other"]) {
      await expect(probe.clearSeededVoicemail({ tenant: "QA-W", sessionId })).rejects.toThrow(/copied voicemail/);
      await expect(probe.copyVoicemail({ from: "QA-W", tenant: "QA-W", role: "DEV-W1", callerRole: "ROBOT-1", sessionId })).rejects.toThrow(/copied voicemail/);
    }
    expect(requests).toHaveLength(2);
  });
});

describe("the app probe's settings and seeds", () => {
  it("reads and sets a flag, removing its row for null, and refuses a key that is not one", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("feature_flags")}`]: () => json([{ enabled: false }]),
      [`POST ${rest("feature_flags")}`]: noContent,
      [`DELETE ${rest("feature_flags")}`]: noContent,
    });
    expect(await probe.flag("kill:ai")).toBe(false);
    await probe.setFlag("kill:ai", true);
    await probe.setFlag("kill:ai", null);
    const [, upsert, remove] = requests;
    expect(query(upsert!)).toEqual({ on_conflict: "key" });
    expect(upsert!.headers.prefer).toBe("resolution=merge-duplicates,return=minimal");
    expect(JSON.parse(upsert!.body!)).toMatchObject({ key: "kill:ai", enabled: true });
    expect(query(remove!)).toEqual({ key: "eq.kill:ai" });
    await expect(probe.setFlag("kill:ai&key=neq.x", false)).rejects.toThrow(/not a flag key/);
    expect(requests).toHaveLength(3);

    const unset = probeWith({ [`GET ${rest("feature_flags")}`]: () => json([]) });
    expect(await unset.probe.flag("kill:calls")).toBeNull();
  });

  it("reads and sets a standing number's row by the seed's id, stamping when it went down", async () => {
    const statuses = ["active", "suspended"];
    const { probe, requests } = probeWith({
      [`GET ${rest("phone_numbers")}`]: () => json([{ status: statuses.shift() }]),
      [`PATCH ${rest("phone_numbers")}`]: noContent,
    });
    expect(await probe.numberStatusOf({ tenant: "QA-W", role: "DEV-W1" })).toBe("active");
    expect(await probe.setNumberStatus({ tenant: "QA-W", role: "DEV-W1", status: "released" })).toBe("suspended");
    const id = stableUuid(COMPANY, "DEV-W1");
    expect(requests.map((r) => [r.method, query(r).id])).toEqual([
      ["GET", `eq.${id}`],
      ["GET", `eq.${id}`],
      ["PATCH", `eq.${id}`],
    ]);
    expect(JSON.parse(requests[2]!.body!)).toEqual({ status: "released", suspended_at: null, released_at: new Date(NOW).toISOString() });

    const missing = probeWith({ [`GET ${rest("phone_numbers")}`]: () => json([]) });
    await expect(missing.probe.setNumberStatus({ tenant: "QA-W", role: "DEV-W1", status: "suspended" })).rejects.toThrow(/no number row/);
    expect(missing.requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("reads a member's level on a number without writing, null when no row names them", async () => {
    const levels = [[{ level: "note" }], []];
    const { probe, requests } = probeWith({ [`GET ${rest("number_access")}`]: () => json(levels.shift()) });
    expect(await probe.ringAudience({ tenant: "QA-W", role: "DEV-W1", member: "qa-w-technician" })).toBe("note");
    expect(await probe.ringAudience({ tenant: "QA-W", role: "DEV-W1", member: "qa-w-technician" })).toBeNull();
    expect(query(requests.find((r) => r.url.startsWith(rest("number_access")))!)).toMatchObject({
      phone_number_id: `eq.${stableUuid(COMPANY, "DEV-W1")}`,
      principal_kind: "eq.user",
      principal: `eq.${TECH}`,
    });
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("removes an on-call shift by its id only", async () => {
    const { probe, requests } = probeWith({ [`DELETE ${rest("on_call_shifts")}`]: noContent });
    await probe.removeOnCallShift("shift-1");
    expect(query(requests[0]!)).toEqual({ id: "eq.shift-1" });
  });

  it("reads this month's AI usage, and seeds one feature's count or removes it, resolving with the count before", async () => {
    const before = [[{ request_count: 7 }], []];
    const { probe, requests } = probeWith({
      [`GET ${rest("company_ai_usage")}`]: () => json(before.shift() ?? []),
      [`POST ${rest("company_ai_usage")}`]: noContent,
      [`DELETE ${rest("company_ai_usage")}`]: noContent,
    });
    expect(await probe.seedAiUsage({ tenant: "QA-W", feature: "suggest_reply", requestCount: 1500 })).toBe(7);
    expect(await probe.seedAiUsage({ tenant: "QA-W", feature: "suggest_reply", requestCount: null })).toBeNull();
    await probe.aiUsage({ tenant: "QA-W" });
    const upsert = requests.find((r) => r.method === "POST")!;
    expect(query(upsert)).toEqual({ on_conflict: "company_id,period,feature" });
    expect(JSON.parse(upsert.body!)).toEqual({ company_id: COMPANY, period: "2026-10", feature: "suggest_reply", request_count: 1500 });
    expect(query(requests.find((r) => r.method === "DELETE")!)).toEqual({ company_id: `eq.${COMPANY}`, period: "eq.2026-10", feature: "eq.suggest_reply" });
    expect(query(requests.at(-1)!)).toMatchObject({ company_id: `eq.${COMPANY}`, period: "eq.2026-10" });
  });

  it("asks Lou for drafts in the thread with a role and hands back the reason with an empty list", async () => {
    const { probe, requests } = probeWith({
      ...THREAD,
      [`POST ${API}/v1/conversations/conv-1/reply-suggestions`]: () => json({ suggestions: [], reason: "over_cap" }),
    });
    expect(await probe.replySuggestions({ member: "qa-w-owner", withRole: "ROBOT-1" })).toEqual({ status: 200, body: { suggestions: [], reason: "over_cap" } });
    expect(requests.at(-1)!.headers["x-company-id"]).toBe(COMPANY);

    const none = probeWith({ [`GET ${rest("contacts")}`]: () => json([]) });
    await expect(none.probe.replySuggestions({ member: "qa-w-owner", withRole: "ROBOT-1" })).rejects.toThrow(/no thread/);
  });
});

describe("the app probe's public widget", () => {
  it("starts with the company's widget key and no session, sending a Turnstile token only when it has one", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ widget_key: "wk-1" }]),
      [`POST ${API}/widget/start`]: () => json({ verificationId: "v-1" }, 202),
      [`POST ${API}/widget/verify`]: () => json({ error: { code: "validation_failed" } }, 422),
      [`GET ${rest("widget_verifications")}`]: () => json([{ id: "a" }, { id: "b" }]),
    });
    expect(await probe.widgetStart({ tenant: "QA-W", phoneRole: "ROBOT-1", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" })).toEqual({ status: 202, body: { verificationId: "v-1" } });
    await probe.widgetStart({ tenant: "QA-W", phoneRole: "ROBOT-1" });
    const [withToken, without] = requests.filter((r) => r.url === `${API}/widget/start`);
    expect(JSON.parse(withToken!.body!)).toEqual({ widgetKey: "wk-1", phone: "+14165550101", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(JSON.parse(without!.body!)).toEqual({ widgetKey: "wk-1", phone: "+14165550101" });
    expect(withToken!.headers.authorization).toBeUndefined();
    expect(await probe.widgetVerify({ verificationId: "v-1", code: "123456", message: "hi" })).toMatchObject({ status: 422, code: "validation_failed" });
    expect(await probe.widgetVerifications({ tenant: "QA-W", since: NOW })).toBe(2);
  });
});

describe("the app probe's kept sign-ins", () => {
  const logins = (requests: Recorded[]) => requests.filter((r) => r.url.startsWith(`${SUPABASE}/auth/v1/token`));
  const inState = async (body: (stateDir: string) => Promise<void>) => {
    const root = mkdtempSync(join(tmpdir(), "rig-probe-"));
    try {
      await body(join(root, "rigd"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("signs a member in once for every process that shares the state directory", async () => {
    await inState(async (stateDir) => {
      const route = { [`POST ${API}/v1/webrtc/token`]: () => json({ token: "voice" }) };
      const first = probeWith(route, stateDir);
      await first.probe.voiceToken({ member: "qa-w-owner" });
      const second = probeWith(route, stateDir);
      await second.probe.voiceToken({ member: "qa-w-owner" });
      expect(logins(first.requests)).toHaveLength(1);
      expect(logins(second.requests)).toHaveLength(0);
    });
  });

  it("signs in once more when the kept session was made before a reset and the API refuses it", async () => {
    await inState(async (stateDir) => {
      const route = { [`POST ${API}/v1/webrtc/token`]: () => json({ token: "voice" }) };
      await probeWith(route, stateDir).probe.voiceToken({ member: "qa-w-owner" });
      const refused = [json({ error: { code: "unauthorized" } }, 401), json({ token: "voice" })];
      const later = probeWith({ [`POST ${API}/v1/webrtc/token`]: () => refused.shift()! }, stateDir);
      expect(await later.probe.voiceToken({ member: "qa-w-owner" })).toEqual({ status: 200 });
      expect(logins(later.requests)).toHaveLength(1);
    });
  });

  it("hands a later process nothing of a session it signed out", async () => {
    await inState(async (stateDir) => {
      const route = {
        [`POST ${API}/v1/webrtc/token`]: () => json({ token: "voice" }),
        [`POST ${API}/v1/sessions/revoke`]: () => json({ ok: true }),
      };
      const first = probeWith(route, stateDir);
      await first.probe.signOutSession({ member: "qa-w-technician" });
      const second = probeWith(route, stateDir);
      await second.probe.voiceToken({ member: "qa-w-technician" });
      expect(logins(second.requests)).toHaveLength(1);
    });
  });
});

describe("the app probe's sign-ins and mail", () => {
  /** Supabase's MFA steps: the factor, a challenge, and a verify that answers a second-level session. */
  function totpRoutes(verified: Response) {
    return {
      [`GET ${SUPABASE}/auth/v1/user`]: () => json({ factors: [{ id: "f-1", factor_type: "totp", status: "verified" }] }),
      [`POST ${SUPABASE}/auth/v1/factors/f-1/challenge`]: () => json({ id: "c-1" }),
      [`POST ${SUPABASE}/auth/v1/factors/f-1/verify`]: () => verified,
      [`GET ${API}/v1/me`]: () => json({ user: {} }),
    };
  }

  it("signs in with the password and the seed's TOTP code, and asks the API with the second-level session", async () => {
    const second = jwt({ sub: OWNER, aal: "aal2" });
    const { probe, requests } = probeWith(totpRoutes(json({ access_token: second })));
    expect(await probe.signInWithTotp({ member: "qa-w-mfa-member" })).toEqual({ aal: "aal2", meStatus: 200 });
    const verify = requests.find((r) => r.url.endsWith("/factors/f-1/verify"))!;
    expect(JSON.parse(verify.body!)).toEqual({ challenge_id: "c-1", code: totpCode(rfcSeed, NOW) });
    expect(requests.find((r) => r.url === `${API}/v1/me`)!.headers.authorization).toBe(`Bearer ${second}`);
  });

  it("reports a refused code as no level, and refuses a member with no secret or no factor", async () => {
    const refused = probeWith(totpRoutes(json({ error: "invalid code" }, 422)));
    expect(await refused.probe.signInWithTotp({ member: "qa-w-mfa-member" })).toEqual({ aal: null, meStatus: 422 });
    expect(refused.requests.some((r) => r.url === `${API}/v1/me`)).toBe(false);

    await expect(probeWith({}).probe.signInWithTotp({ member: "qa-w-owner" })).rejects.toThrow(/no TOTP secret/);
    const factorless = probeWith({ [`GET ${SUPABASE}/auth/v1/user`]: () => json({ factors: [] }) });
    await expect(factorless.probe.signInWithTotp({ member: "qa-w-mfa-member" })).rejects.toThrow(/no verified TOTP factor/);
  });

  it("asks local auth to mail a member's reset to the seed's address", async () => {
    const { probe, requests } = probeWith({ [`POST ${SUPABASE}/auth/v1/recover`]: () => json({}, 200) });
    expect(await probe.sendPasswordReset({ member: "qa-w-technician" })).toBe(200);
    expect(JSON.parse(requests[0]!.body!)).toEqual({ email: "delivered+rig-qa-w-technician@resend.dev" });
    expect(requests[0]!.headers.apikey).toBe("publishable");
  });

  it("invites as the owner and reads the invite's id from the row routes/team.ts answers with, then revokes it", async () => {
    const { probe, requests } = probeWith({
      [`POST ${API}/v1/invites`]: () => json({ id: "inv-1", email: "x@example.invalid", role: "member", email_sent: true }, 201),
      [`DELETE ${API}/v1/invites/inv-1`]: noContent,
    });
    expect(await probe.invite({ member: "qa-w-owner", email: "x@example.invalid" })).toMatchObject({ status: 201, body: { id: "inv-1" } });
    expect(JSON.parse(requests.find((r) => r.method === "POST" && r.url.endsWith("/v1/invites"))!.body!)).toEqual({ email: "x@example.invalid", role: "member" });
    await probe.revokeInvite({ member: "qa-w-owner", inviteId: "inv-1" });
    const revoke = requests.at(-1)!;
    expect([revoke.method, revoke.url, revoke.body]).toEqual(["DELETE", `${API}/v1/invites/inv-1`, undefined]);
  });
});

describe("the app probe's workspaces", () => {
  it("finds a sign-up's workspace by its owner's address, and none for an address auth does not know", async () => {
    const { probe, requests } = probeWith({
      [`GET ${rest("companies")}`]: () => json([{ id: "company-new", subscription_status: "trialing", stripe_subscription_id: null, stripe_customer_id: null }]),
    });
    expect(await probe.workspaceOf({ ownerEmail: SIGN_UP_EMAIL.toUpperCase() })).toEqual({
      company_id: "company-new",
      subscription_status: "trialing",
      stripe_subscription_id: null,
      stripe_customer_id: null,
    });
    expect(query(requests.find((r) => r.url.startsWith(rest("companies")))!)).toMatchObject({ owner_user_id: `eq.${SIGN_UP_USER}`, deleted_at: "is.null" });
    expect(await probe.workspaceOf({ ownerEmail: "nobody@example.invalid" })).toBeNull();
  });

  it("removes only a sign-up scenario's own user and workspace, never a seeded member", async () => {
    expect(SIGN_UP_ADDRESS.test("delivered+rig-qa-w-owner@resend.dev")).toBe(false);
    expect(SIGN_UP_ADDRESS.test("delivered+rig-s32-x@resend.dev.evil.example")).toBe(false);
    const seeded = probeWith({});
    await expect(seeded.probe.deleteSignUp({ email: "delivered+rig-qa-w-owner@resend.dev" })).rejects.toThrow(/sign-up scenario's own address/);
    expect(seeded.requests).toEqual([]);

    const workspace: Record<string, Route> = {
      [`DELETE ${rest("email_suppressions")}`]: noContent,
      [`GET ${rest("companies")}`]: () => json([{ id: "company-new" }]),
      [`GET ${rest("phone_numbers")}`]: () => json([{ id: "fixture-1", provisioning_key: signUpNumberKey("n0nce") }]),
      [`PATCH ${rest("companies")}`]: noContent,
    };
    const { probe, requests } = probeWith({ ...workspace, [`DELETE ${SUPABASE}/auth/v1/admin/users/${SIGN_UP_USER}`]: () => json({}, 200) });
    await probe.deleteSignUp({ email: SIGN_UP_EMAIL });
    const [, , held, close, remove, unmute] = requests;
    expect([unmute!.method, query(unmute!)]).toEqual(["DELETE", { email: `eq.${SIGN_UP_EMAIL}` }]);
    expect(query(held!)).toEqual({ company_id: "in.(company-new)", status: "neq.released", select: "id,provisioning_key" });
    expect(query(close!)).toEqual({ owner_user_id: `eq.${SIGN_UP_USER}`, deleted_at: "is.null" });
    expect(JSON.parse(close!.body!)).toEqual({ deleted_at: new Date(NOW).toISOString() });
    expect([remove!.method, remove!.url, remove!.headers.authorization]).toEqual(["DELETE", `${SUPABASE}/auth/v1/admin/users/${SIGN_UP_USER}`, "Bearer service"]);
    expect(JSON.parse(remove!.body!)).toEqual({ should_soft_delete: true });

    const gone = probeWith({ [`DELETE ${rest("email_suppressions")}`]: noContent });
    await gone.probe.deleteSignUp({ email: "delivered+rig-s35-other@resend.dev" });
    expect(gone.requests.map((r) => r.method)).toEqual(["GET", "DELETE"]);

    const failed = probeWith({ ...workspace, [`DELETE ${SUPABASE}/auth/v1/admin/users/`]: () => json({}, 500) });
    await expect(failed.probe.deleteSignUp({ email: SIGN_UP_EMAIL })).rejects.toThrow(/returned 500/);
    expect(failed.requests.some((r) => r.url.startsWith(rest("email_suppressions")))).toBe(false);
  });

  it("makes and removes a confirmed account only at S34's own sub-address, never a seeded member's", async () => {
    const mine = "rig-robot+s34-acct-n0nce@example.invalid";
    expect(MAIL_ACCOUNT_ADDRESS.test(mine)).toBe(true);
    for (const other of ["delivered+rig-qa-w-owner@resend.dev", SIGN_UP_EMAIL, "rig-robot@example.invalid", "rig-robot+s34-acct-x@example.invalid.", "a+s34-acct-x@localhost"]) {
      expect(MAIL_ACCOUNT_ADDRESS.test(other)).toBe(false);
    }
    const seeded = probeWith({});
    const elsewhere = ["delivered+rig-qa-w-owner@resend.dev", "someone+s34-acct-x@example.invalid", "rig-robot+s34-acct-x@other.invalid", "rig-robot+s34-acct-x@sub.example.invalid"];
    for (const email of elsewhere) {
      await expect(seeded.probe.createMailAccount({ email })).rejects.toThrow(/own sub-address/);
      await expect(seeded.probe.deleteMailAccount({ email })).rejects.toThrow(/own sub-address/);
    }
    expect(seeded.requests).toEqual([]);

    const { probe, requests } = probeWith({ [`POST ${SUPABASE}/auth/v1/admin/users`]: () => json({ id: "new" }, 200) });
    expect(await probe.createMailAccount({ email: mine })).toBe(200);
    const create = requests.find((r) => r.method === "POST")!;
    expect(create.headers.authorization).toBe("Bearer service");
    const body = JSON.parse(create.body!);
    expect(body).toMatchObject({ email: mine, email_confirm: true });
    expect(String(body.password).length).toBeGreaterThanOrEqual(20);
  });

  it("does not make a second account for an address that has one, and removes the one it made", async () => {
    const mine = "rig-robot+s34-acct-n0nce@example.invalid";
    const known = fakeFetch({
      [`GET ${SUPABASE}/auth/v1/admin/users`]: () => json({ users: [{ id: "acct-1", email: mine.toUpperCase() }] }),
      [`DELETE ${SUPABASE}/auth/v1/admin/users/acct-1`]: () => json({}, 200),
    });
    const probe = new AppProbe({
      tenants: {},
      numbers: numberBook({}),
      apiBase: API,
      supabaseUrl: SUPABASE,
      serviceRoleKey: "service",
      anonKey: "publishable",
      edgeOrigin: "https://rig-edge.example.workers.dev",
      guardToken: "t",
      robotMailbox: () => "rig-robot@example.invalid",
      fetch: known.fetch,
      now: () => NOW,
    });
    expect(await probe.createMailAccount({ email: mine })).toBe(200);
    expect(known.requests.map((r) => r.method)).toEqual(["GET"]);
    await probe.deleteMailAccount({ email: mine });
    expect(known.requests.at(-1)).toMatchObject({ method: "DELETE", url: `${SUPABASE}/auth/v1/admin/users/acct-1` });

    const gone = probeWith({});
    await gone.probe.deleteMailAccount({ email: mine });
    expect(gone.requests.map((r) => r.method)).toEqual(["GET"]);

    const failed = probeWith({ [`GET ${SUPABASE}/auth/v1/admin/users`]: () => json({ users: [{ id: "acct-2", email: mine }] }), [`DELETE ${SUPABASE}/auth/v1/admin/users/acct-2`]: () => json({}, 500) });
    await expect(failed.probe.deleteMailAccount({ email: mine })).rejects.toThrow(/returned 500/);
  });

  it("refuses to delete a sign-up whose workspace holds a number the rig did not assign", async () => {
    const { probe, requests } = probeWith({
      [`DELETE ${rest("email_suppressions")}`]: noContent,
      [`GET ${rest("companies")}`]: () => json([{ id: "company-new" }]),
      [`GET ${rest("phone_numbers")}`]: () => json([{ id: "bought-1", provisioning_key: "cs_test_1" }]),
    });
    await expect(probe.deleteSignUp({ email: SIGN_UP_EMAIL })).rejects.toThrow(/number row bought-1/);
    expect(requests.some((r) => r.method === "PATCH" || r.url.includes("/admin/users/"))).toBe(false);
    expect(requests.some((r) => r.url.startsWith(rest("email_suppressions")))).toBe(false);
  });

  it("gives an unpaid Canadian sign-up a fictional fixture number, trying the next on a clash", async () => {
    const owner = "delivered+rig-s32-run-1@resend.dev";
    let posts = 0;
    const company = { id: "company-new", subscription_status: "incomplete", stripe_subscription_id: null, stripe_customer_id: null, country: "CA", requested_area_code: "416" };
    const { probe, requests } = probeWith({
      [`GET ${SUPABASE}/auth/v1/admin/users`]: () => json({ users: [{ id: SIGN_UP_USER, email: owner }] }),
      [`GET ${rest("companies")}`]: () => json([company]),
      [`GET ${rest("phone_numbers")}`]: () => json([]),
      [`POST ${rest("phone_numbers")}`]: () => (posts++ === 0 ? json({ code: "23505" }, 409) : json([{ id: "fixture-1" }], 201)),
    });
    const fixture = await probe.assignSignUpNumber({ ownerEmail: owner, nonce: "Run 1" });
    expect(fixture.row_id).toBe("fixture-1");
    expect(fixture.provisioning_key).toBe("rig-signup-s32-run-1");
    expect(fixture.number_e164).toMatch(/^\+141655501\d\d$/);
    const inserts = requests.filter((r) => r.method === "POST" && r.url.startsWith(rest("phone_numbers"))).map((r) => JSON.parse(r.body!));
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).toMatchObject({ company_id: "company-new", status: "active", country: "CA", telnyx_phone_number_id: null, provisioning_key: signUpNumberKey("Run 1") });
    expect(inserts[0].number_e164).not.toBe(inserts[1].number_e164);

    await expect(probe.assignSignUpNumber({ ownerEmail: "delivered+rig-qa-w-owner@resend.dev", nonce: "x" })).rejects.toThrow(/sign-up scenario/);
    for (const changed of [{ subscription_status: "active" }, { country: "US" }]) {
      const refused = probeWith({
        [`GET ${SUPABASE}/auth/v1/admin/users`]: () => json({ users: [{ id: SIGN_UP_USER, email: owner }] }),
        [`GET ${rest("companies")}`]: () => json([{ ...company, ...changed }]),
      });
      await expect(refused.probe.assignSignUpNumber({ ownerEmail: owner, nonce: "x" })).rejects.toThrow();
      expect(refused.requests.some((r) => r.method === "POST")).toBe(false);
    }
  });

  it("releases only a fixture row, in the database, and reports fixtures and foreign rows left held", async () => {
    const { probe, requests } = probeWith({ [`PATCH ${rest("phone_numbers")}`]: noContent });
    await expect(probe.releaseSignUpNumber({ provisioningKey: "cs_test_1" })).rejects.toThrow(/fixture number/);
    await probe.releaseSignUpNumber({ provisioningKey: signUpNumberKey("run-1") });
    expect(query(requests.at(-1)!)).toEqual({ provisioning_key: `eq.${signUpNumberKey("run-1")}`, status: "neq.released" });
    expect(JSON.parse(requests.at(-1)!.body!)).toEqual({ status: "released", released_at: new Date(NOW).toISOString() });

    const leak = probeWith({
      [`GET ${rest("phone_numbers")}?provisioning_key`]: () => json([{ id: "fixture-left" }]),
      [`GET ${rest("companies")}`]: () => json([{ id: "company-new" }]),
      [`GET ${rest("phone_numbers")}?company_id`]: () => json([{ id: "fixture-left", provisioning_key: signUpNumberKey("x") }, { id: "bought-1", provisioning_key: "cs_test_1" }]),
    });
    expect(await leak.probe.signUpNumberLeak()).toEqual({ fixtures: 1, foreign: ["bought-1"] });
    expect(query(leak.requests.find((r) => r.url.startsWith(rest("companies")))!)).toMatchObject({ owner_user_id: `in.(${SIGN_UP_USER})` });
  });

  it("mutes only a sign-up's address, and reads the Checkout's ledger row by the workspace", async () => {
    const { probe, requests } = probeWith({
      [`POST ${rest("email_suppressions")}`]: noContent,
      [`GET ${rest("companies")}`]: () => json([{ id: "company-new" }]),
      [`GET ${rest("webhook_events")}`]: () => json([{ session_id: "cs_test_1", processed_at: "2026-10-31T15:00:00Z", last_error: null }]),
    });
    await expect(probe.muteSignUpMail({ email: "delivered+rig-qa-w-owner@resend.dev" })).rejects.toThrow(/sign-up scenario/);
    await probe.muteSignUpMail({ email: SIGN_UP_EMAIL });
    expect(JSON.parse(requests.at(-1)!.body!)).toEqual({ email: SIGN_UP_EMAIL, reason: "hard_bounce", cleared_at: null });
    expect(await probe.checkoutEvent({ ownerEmail: SIGN_UP_EMAIL })).toEqual({ session_id: "cs_test_1", processed: true, last_error: null });
    expect(query(requests.at(-1)!)).toMatchObject({ event_type: "eq.checkout.session.completed", "payload->data->object->>client_reference_id": "eq.company-new" });
  });

  it("marks a number released only if it is not already, and puts a canceled workspace back with its numbers", async () => {
    const { probe, requests } = probeWith({ [`PATCH ${SUPABASE}/rest/v1/`]: noContent });
    await probe.markNumberReleased({ phoneNumberId: "row-1" });
    expect(query(requests[0]!)).toEqual({ id: "eq.row-1", status: "neq.released" });
    expect(JSON.parse(requests[0]!.body!)).toEqual({ status: "released", released_at: new Date(NOW).toISOString() });

    await probe.restoreWorkspace({ tenant: "QA-W", state: { subscription_status: "active", canceled_at: null } });
    const [company, numbers] = requests.slice(1);
    expect([company!.url.startsWith(rest("companies")), JSON.parse(company!.body!)]).toEqual([true, { subscription_status: "active", canceled_at: null }]);
    expect(query(numbers!)).toEqual({ company_id: `eq.${COMPANY}`, status: "eq.suspended" });
    expect(JSON.parse(numbers!.body!)).toEqual({ status: "active", suspended_at: null });

    // A workspace that was canceled before the run keeps its numbers suspended.
    await probe.restoreWorkspace({ tenant: "QA-W", state: { subscription_status: "canceled", canceled_at: "2026-10-01T00:00:00.000Z" } });
    expect(requests.slice(3).map((r) => r.url.startsWith(rest("phone_numbers")))).toEqual([false]);
  });

  it("reads the subscription the company row names", async () => {
    const answers = [[{ stripe_subscription_id: "sub_1" }], []];
    const { probe } = probeWith({ [`GET ${rest("companies")}`]: () => json(answers.shift()) });
    expect(await probe.stripeSubscriptionId("QA-W")).toBe("sub_1");
    expect(await probe.stripeSubscriptionId("QA-W")).toBeNull();
  });
});
