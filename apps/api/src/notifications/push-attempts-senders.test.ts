/**
 * D142: what each push send path reports as push_attempt events.
 *
 * Drives the three real fan-outs (ring, call_end, alert) against a stubbed
 * Supabase, a stubbed Web Push service and the FCM double, so the events
 * checked are the ones the senders build rather than ones a test assembled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import { captureEvent } from "../observability/capture";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { eventsCaptured, resetCaptures } from "../test/capture-mock";
import { stubFetch, type FetchRoute } from "../test/support";
import { notifyCallEnd } from "./call-end";
import { deliverPush } from "./deliver";
import { notifyIncomingCall } from "./incoming-call";
import { encodeBase64Url } from "./webpush";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const COMPANY_ID = "c2000000-0000-4000-8000-00000000000c";
const USER = "a2000000-0000-4000-8000-00000000000a";
const SUB_ID = "b2000000-0000-4000-8000-00000000000b";
const DEVICE_ID = "d2000000-0000-4000-8000-00000000000d";
const SESSION = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const CALLER = "+16135550142";
/** Off Google's host, so the FCM double never mistakes a Web Push for its own. */
const WEB_ENDPOINT = `https://updates.push.services.mozilla.com/wpush/v2/${SUB_ID}`;

beforeEach(() => {
  resetCaptures();
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
    /** Answers the device token lookup instead of the one device. */
    devices?: () => unknown;
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
  stubFetch(sb.route, webPush(options.webStatus ?? 201), ...service.routes);
  return { env, sb, service };
}

const attempts = () => eventsCaptured("push_attempt");

describe("the push send paths report what they sent", () => {
  it("a ring reports each channel with the call session, under the workspace", async () => {
    const { env, service } = await world();

    await notifyIncomingCall(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      caller: CALLER,
      callSessionId: SESSION,
    });

    expect(attempts()).toEqual([
      {
        event: "push_attempt",
        distinctId: COMPANY_ID,
        properties: expect.objectContaining({
          user_id: USER, call_session_id: SESSION,
          purpose: "ring", channel: "webpush", platform: "web", priority: "high",
          response_class: "accepted", http_status: 201,
        }),
      },
      {
        event: "push_attempt",
        distinctId: COMPANY_ID,
        properties: expect.objectContaining({
          purpose: "ring", channel: "fcm", platform: "android", priority: "high",
          response_class: "accepted", http_status: 200,
        }),
      },
    ]);
    expect(service.sends).toHaveLength(1);
    // The caller's number is in the push and never in the evidence.
    expect(JSON.stringify(attempts())).not.toContain("5550142");
  });

  it("a ring never waits for PostHog to take its evidence", async () => {
    const { env, service } = await world();
    vi.mocked(captureEvent).mockImplementationOnce(() => new Promise<void>(() => {}));

    const report = await notifyIncomingCall(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      caller: CALLER,
      callSessionId: SESSION,
    });

    expect(report).toEqual({ unreachableUserIds: [] });
    expect(service.sends).toHaveLength(1);
  });

  it("a gone channel is reported as gone and still pruned", async () => {
    const { env, sb } = await world({ webStatus: 410 });

    await notifyIncomingCall(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      caller: CALLER,
      callSessionId: SESSION,
    });

    expect(attempts()[0].properties).toMatchObject({ channel: "webpush", response_class: "gone", http_status: 410 });
    expect(sb.find("DELETE", "/rest/v1/push_subscriptions")).toHaveLength(1);
  });

  it("a call_end reports its own purpose", async () => {
    const { env } = await world();

    await notifyCallEnd(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER],
      callSessionId: SESSION,
      reason: "missed",
      caller: CALLER,
    });

    expect(attempts().map(({ properties }) => [properties.purpose, properties.channel, properties.call_session_id])).toEqual([
      ["call_end", "webpush", SESSION],
      ["call_end", "fcm", SESSION],
    ]);
  });

  it("an alert reports its priority and no call session", async () => {
    const { env } = await world();

    await deliverPush(env, getDb(env), {
      category: "messages_all",
      companyId: COMPANY_ID,
      content: { written: "us" },
      userIds: [USER],
      web: () => ({ title: "Sam", body: "On my way", url: "/inbox/1" }),
      collapseKey: "conversation:1",
      failures: [],
    });

    expect(attempts().map(({ properties }) => [properties.purpose, properties.channel, properties.priority, properties.call_session_id])).toEqual([
      ["alert", "webpush", "normal", null],
      ["alert", "fcm", "normal", null],
    ]);
  });

  it("an alert whose device lookup fails after the web sends still reports them", async () => {
    const { env } = await world({
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

    expect(attempts().map(({ properties }) => [properties.purpose, properties.channel, properties.response_class])).toEqual([
      ["alert", "webpush", "accepted"],
    ]);
  });
});
