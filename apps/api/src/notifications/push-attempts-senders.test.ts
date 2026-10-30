/**
 * D142: what each push send path writes to push_attempts.
 *
 * Drives the three real fan-outs (ring, call_end, alert) against a stubbed
 * Supabase, a stubbed Web Push service and the FCM double, so the rows checked
 * are the ones the senders build rather than ones a test assembled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { resetSentryCaptures } from "../test/sentry-mock";
import { stubFetch, type FetchRoute } from "../test/support";
import { notifyCallEnd } from "./call-end";
import { deliverPush } from "./deliver";
import { notifyIncomingCall } from "./incoming-call";
import { resetPushAttemptAlertsForTest, pushAttemptsSettled } from "./push-attempts";
import { encodeBase64Url } from "./webpush";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const COMPANY_ID = "c2000000-0000-4000-8000-00000000000c";
const USER = "a2000000-0000-4000-8000-00000000000a";
const SUB_ID = "b2000000-0000-4000-8000-00000000000b";
const DEVICE_ID = "d2000000-0000-4000-8000-00000000000d";
const SESSION = "v3:7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const CALLER = "+16135550142";
/** Off Google's host, so the FCM double never mistakes a Web Push for its own. */
const WEB_ENDPOINT = `https://updates.push.services.mozilla.com/wpush/v2/${SUB_ID}`;

beforeEach(() => {
  resetSentryCaptures();
  resetPushAttemptAlertsForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function subscriptionRow() {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer,
  );
  return {
    id: SUB_ID,
    user_id: USER,
    endpoint: WEB_ENDPOINT,
    p256dh: encodeBase64Url(raw),
    auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    locale: null,
  };
}

const DEVICE = { id: DEVICE_ID, user_id: USER, platform: "android", token: "device-token", locale: null };

function webPush(status: number): FetchRoute {
  return (url) =>
    url.href.startsWith("https://updates.push.services.mozilla.com/")
      ? new Response(null, { status })
      : undefined;
}

async function world(
  options: {
    webStatus?: number;
    ledgerStatus?: number;
    /** Answers the device token lookup instead of the one device. */
    devices?: () => unknown;
    /** Sees every request first, so a test can hold the ledger write open. */
    before?: FetchRoute;
  } = {},
) {
  const account = await makeServiceAccount();
  const env: Env = fcmEnv(account);
  const service = fcmService();
  const sb: SupabaseStub = supabaseStub(env);
  const subscription = await subscriptionRow();
  sb.on("GET", "/rest/v1/push_subscriptions", () => [subscription]);
  sb.on("DELETE", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", options.devices ?? (() => [DEVICE]));
  sb.on("DELETE", "/rest/v1/device_push_tokens", () => []);
  sb.on("GET", "/rest/v1/companies", () => [{ push_include_content: true, locale: "en" }]);
  sb.on("POST", "/rest/v1/push_attempts", () =>
    new Response(null, { status: options.ledgerStatus ?? 201 }),
  );
  const before: FetchRoute = options.before ?? (() => undefined);
  stubFetch(before, sb.route, webPush(options.webStatus ?? 201), ...service.routes);
  return { env, sb, service };
}

/** The ring and call_end write in the background, so wait for them first. */
async function ledgerRows(sb: SupabaseStub): Promise<Record<string, unknown>[]> {
  await pushAttemptsSettled();
  const inserts = sb.find("POST", "/rest/v1/push_attempts");
  expect(inserts, "one ledger insert per fan-out").toHaveLength(1);
  return inserts[0].body as Record<string, unknown>[];
}

describe("the push send paths record what they sent", () => {
  it("a ring records each channel with the call session, after the sends", async () => {
    const { env, sb, service } = await world();

    await notifyIncomingCall(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      caller: CALLER,
      callSessionId: SESSION,
    });

    const rows = await ledgerRows(sb);
    expect(rows).toEqual([
      expect.objectContaining({
        company_id: COMPANY_ID, user_id: USER, call_session_id: SESSION,
        purpose: "ring", channel: "webpush", platform: "web", priority: "high",
        response_class: "accepted", http_status: 201, target_id: SUB_ID,
      }),
      expect.objectContaining({
        purpose: "ring", channel: "fcm", platform: "android", priority: "high",
        response_class: "accepted", http_status: 200, target_id: DEVICE_ID,
      }),
    ]);
    expect(service.sends).toHaveLength(1);
    // The ledger write comes after every send it describes.
    const order = sb.calls.map((call) => `${call.method} ${call.path}`);
    expect(order.at(-1)).toBe("POST /rest/v1/push_attempts");
    // The caller's number is in the push and never in the evidence.
    expect(JSON.stringify(rows)).not.toContain("5550142");
  });

  it("a gone channel is recorded as gone and still pruned", async () => {
    const { env, sb } = await world({ webStatus: 410 });

    await notifyIncomingCall(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      caller: CALLER,
      callSessionId: SESSION,
    });

    expect((await ledgerRows(sb))[0]).toMatchObject({ channel: "webpush", response_class: "gone", http_status: 410 });
    expect(sb.find("DELETE", "/rest/v1/push_subscriptions")).toHaveLength(1);
  });

  it("a call_end records its own purpose", async () => {
    const { env, sb } = await world();

    await notifyCallEnd(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      callSessionId: SESSION,
      reason: "missed",
      caller: CALLER,
    });

    const rows = await ledgerRows(sb);
    expect(rows.map((row) => [row.purpose, row.channel, row.call_session_id])).toEqual([
      ["call_end", "webpush", SESSION],
      ["call_end", "fcm", SESSION],
    ]);
  });

  it("an alert records its priority and no call session", async () => {
    const { env, sb } = await world();

    await deliverPush(env, getDb(env), {
      category: "messages_all",
      companyId: COMPANY_ID,
      content: { written: "us" },
      userIds: [USER],
      web: () => ({ title: "Sam", body: "On my way", url: "/inbox/1" }),
      collapseKey: "conversation:1",
      failures: [],
    });

    const rows = await ledgerRows(sb);
    expect(rows.map((row) => [row.purpose, row.channel, row.priority, row.call_session_id])).toEqual([
      ["alert", "webpush", "normal", null],
      ["alert", "fcm", "normal", null],
    ]);
  });

  it("a ledger the database refuses changes nothing about the ring", async () => {
    const { env, sb, service } = await world({ ledgerStatus: 400 });

    const report = await notifyIncomingCall(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      caller: CALLER,
      callSessionId: SESSION,
    });

    expect(report).toEqual({ unreachableUserIds: [] });
    expect(service.sends).toHaveLength(1);
    await pushAttemptsSettled();
    expect(sb.find("POST", "/rest/v1/push_attempts")).toHaveLength(1);
  });

  it("an alert whose device lookup fails after the web sends still records them", async () => {
    const { env, sb } = await world({
      // A 500, not a 503: the client retries a 503 on a read.
      devices: () => Response.json({ message: "pooler went away" }, { status: 500 }),
    });

    await expect(
      deliverPush(env, getDb(env), {
        category: "messages_all",
        companyId: COMPANY_ID,
        content: { written: "us" },
        userIds: [USER],
        web: () => ({ title: "Sam", body: "On my way", url: "/inbox/1" }),
        collapseKey: "conversation:1",
        failures: [],
      }),
    ).rejects.toThrow("device push tokens lookup failed");

    const rows = await ledgerRows(sb);
    expect(rows.map((row) => [row.purpose, row.channel, row.response_class])).toEqual([
      ["alert", "webpush", "accepted"],
    ]);
  });
});

/**
 * The call engine awaits the ring and call_end fan-outs inside the call's
 * serialized queue, so whatever they await, the answer claim and the hangup
 * queued behind them wait for too. The ledger write must not be one of those
 * things: held open here, it must not hold the fan-out with it.
 */
describe("the call engine's fan-outs do not wait for their evidence", () => {
  const HELD_FOR_MS = 1_000;

  const alert = (recordAttemptsInBackground?: boolean) => (env: Env) =>
    deliverPush(env, getDb(env), {
      category: "missed_calls",
      companyId: COMPANY_ID,
      content: { written: "us" },
      userIds: [USER],
      web: () => ({ title: "Missed call", body: "Call back", url: "/inbox/1" }),
      collapseKey: "conversation:1",
      recordAttemptsInBackground,
      failures: [],
    });

  /** Runs the fan-out against a ledger write held open until it is released. */
  async function againstHeldLedger(fanOut: (env: Env) => Promise<unknown>) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ledger: { rows: Record<string, unknown>[] | null } = { rows: null };
    const { env } = await world({
      before: async (url, request) => {
        if (request.method !== "POST" || url.pathname !== "/rest/v1/push_attempts") {
          return undefined;
        }
        await held;
        ledger.rows = (await request.clone().json()) as Record<string, unknown>[];
        return new Response(null, { status: 201 });
      },
    });
    const running = fanOut(env);
    const returned = await Promise.race([
      running.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), HELD_FOR_MS)),
    ]);
    release();
    await running;
    await pushAttemptsSettled();
    return { returned, ledger };
  }

  it.each([
    [
      "ring",
      (env: Env) =>
        notifyIncomingCall(env, getDb(env), {
          companyId: COMPANY_ID,
          userIds: [USER],
          caller: CALLER,
          callSessionId: SESSION,
        }),
    ],
    [
      "call_end",
      (env: Env) =>
        notifyCallEnd(env, getDb(env), {
          companyId: COMPANY_ID,
          userIds: [USER],
          callSessionId: SESSION,
          reason: "answered",
          caller: CALLER,
        }),
    ],
    // The missed-call alert a call engine sends from its terminal merge.
    ["alert", alert(true)],
  ] as const)("%s returns while the ledger write is still open", async (purpose, fanOut) => {
    const { returned, ledger } = await againstHeldLedger(fanOut);

    expect(returned, `the ${purpose} fan-out waited on its own evidence`).toBe(true);
    expect(
      ledger.rows?.map((row) => row.purpose),
      "the write still lands once the database answers",
    ).toEqual([purpose, purpose]);
  });

  it("an alert sent from a Worker request waits for its evidence, which could otherwise be cut off", async () => {
    const { returned, ledger } = await againstHeldLedger(alert());

    expect(returned, "the alert returned before its evidence was written").toBe(false);
    expect(ledger.rows?.map((row) => row.purpose)).toEqual(["alert", "alert"]);
  });
});
