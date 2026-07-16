/**
 * Push-to-wake incoming-call alert (#135). Covers what incoming-call.ts OWNS on
 * top of the shared Web Push crypto (round-tripped in webpush.test.ts): the
 * push_enabled preference filter (#146), the dead-subscription prune, and the
 * Sentry observability on every non-OK outcome (#142). Real RFC 8291 crypto
 * reaches a stubbed push endpoint; Sentry is mocked to assert reporting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";

import { getDb } from "../db";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { encodeBase64Url } from "./webpush";
import { notifyIncomingCall } from "./incoming-call";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PUSH_ORIGIN = "https://push.example.net";

afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(Sentry.captureException).mockClear();
});

/** A stored subscription row with a REAL P-256 key pair (so encryptPushPayload
 *  succeeds and the send reaches the stubbed endpoint). */
async function makeSubRow(userId: string, endpoint: string) {
  const uaKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const uaPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", uaKeys.publicKey)) as ArrayBuffer,
  );
  return {
    id: `sub-${userId}`,
    user_id: userId,
    endpoint,
    p256dh: encodeBase64Url(uaPublic),
    auth: encodeBase64Url(authSecret),
  };
}

/** Stubbed push endpoint: every POST resolves with the given HTTP status. */
function pushEndpoint(status: number): FetchRoute {
  return (url, request) =>
    url.origin === PUSH_ORIGIN && request.method === "POST"
      ? new Response(null, { status })
      : undefined;
}

const INPUT = {
  companyId: COMPANY_ID,
  caller: "+16135551000",
  callSessionId: "sess-1",
} as const;

describe("notifyIncomingCall — push_enabled filter (#146)", () => {
  it("skips a member who disabled push and never queries their subscription", async () => {
    const sb: SupabaseStub = supabaseStub(env);
    let subQueryFilter = "";
    // USER_A has no prefs row (default ON); USER_B explicitly disabled push.
    sb.on("GET", "/rest/v1/notification_prefs", () => [
      { user_id: USER_B, push_enabled: false },
    ]);
    sb.on("GET", "/rest/v1/push_subscriptions", (call) => {
      subQueryFilter = call.url.searchParams.get("user_id") ?? "";
      return []; // no subscriptions — we only assert the audience here
    });
    stubFetch(sb.route);

    await notifyIncomingCall(env, getDb(env), {
      ...INPUT,
      userIds: [USER_A, USER_B],
    });

    // Only the push-enabled member survives to the subscription query.
    expect(subQueryFilter).toContain(USER_A);
    expect(subQueryFilter).not.toContain(USER_B);
  });

  it("does not even query subscriptions when everyone disabled push", async () => {
    const sb = supabaseStub(env);
    let subQueried = false;
    sb.on("GET", "/rest/v1/notification_prefs", () => [
      { user_id: USER_A, push_enabled: false },
    ]);
    sb.on("GET", "/rest/v1/push_subscriptions", () => {
      subQueried = true;
      return [];
    });
    stubFetch(sb.route);

    await notifyIncomingCall(env, getDb(env), { ...INPUT, userIds: [USER_A] });
    expect(subQueried).toBe(false);
  });
});

describe("notifyIncomingCall — observability + prune (#142)", () => {
  it("prunes a gone (410) subscription and reports it to Sentry (info)", async () => {
    const sb = supabaseStub(env);
    const sub = await makeSubRow(USER_A, `${PUSH_ORIGIN}/send/abc`);
    let deletedId = "";
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("GET", "/rest/v1/push_subscriptions", () => [sub]);
    sb.on("DELETE", "/rest/v1/push_subscriptions", (call) => {
      deletedId = call.url.searchParams.get("id") ?? "";
      return new Response(null, { status: 204 });
    });
    stubFetch(sb.route, pushEndpoint(410));

    await notifyIncomingCall(env, getDb(env), { ...INPUT, userIds: [USER_A] });

    expect(deletedId).toBe(`eq.${sub.id}`);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, level] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(level).toBe("info");
    expect(msg).toContain("push.example.net");
    expect(msg).toContain("410");
    // The host only — never the per-device token in the endpoint path.
    expect(msg).not.toContain("/send/abc");
  });

  it("reports a non-OK delivery (403) as a warning WITHOUT pruning, never throws", async () => {
    const sb = supabaseStub(env);
    const sub = await makeSubRow(USER_A, `${PUSH_ORIGIN}/send/xyz`);
    let deleteCalled = false;
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("GET", "/rest/v1/push_subscriptions", () => [sub]);
    sb.on("DELETE", "/rest/v1/push_subscriptions", () => {
      deleteCalled = true;
      return new Response(null, { status: 204 });
    });
    stubFetch(sb.route, pushEndpoint(403));

    await expect(
      notifyIncomingCall(env, getDb(env), { ...INPUT, userIds: [USER_A] }),
    ).resolves.toBeUndefined();

    expect(deleteCalled).toBe(false);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, level] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(level).toBe("warning");
    expect(msg).toContain("403");
  });

  it("stays silent (no Sentry) on a clean 201 delivery", async () => {
    const sb = supabaseStub(env);
    const sub = await makeSubRow(USER_A, `${PUSH_ORIGIN}/send/ok`);
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("GET", "/rest/v1/push_subscriptions", () => [sub]);
    stubFetch(sb.route, pushEndpoint(201));

    await notifyIncomingCall(env, getDb(env), { ...INPUT, userIds: [USER_A] });

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #151 native device push: the call wake reaches registered Android/iOS
// devices as an FCM HIGH-priority, 30s-TTL send with the same kind:'call'
// payload. Shapes are covered in fcm.test.ts; this asserts the wiring, the
// prune, and that the token value never leaks into Sentry.
// ---------------------------------------------------------------------------

const DEVICE_ROW_ID = "50000000-aaaa-4000-8000-000000000001";
const DEVICE_TOKEN = "secret-device-token-abc";

function nativeWorld(tokens: unknown[]): {
  sb: SupabaseStub;
  deleted: string[];
} {
  const sb = supabaseStub(env);
  const deleted: string[] = [];
  sb.on("GET", "/rest/v1/notification_prefs", () => []);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => tokens);
  sb.on("DELETE", "/rest/v1/device_push_tokens", (call) => {
    deleted.push(call.url.searchParams.get("id") ?? "");
    return new Response(null, { status: 204 });
  });
  return { sb, deleted };
}

describe("notifyIncomingCall — native device push (#151)", () => {
  it("skips the token query entirely when FCM is not configured", async () => {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    stubFetch(sb.route); // an unstubbed device_push_tokens GET would throw

    await notifyIncomingCall(env, getDb(env), { ...INPUT, userIds: [USER_A] });
    expect(sb.find("GET", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("delivers the kind:'call' wake payload at HIGH priority with the 30s ring TTL", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const world = nativeWorld([
      {
        id: DEVICE_ROW_ID,
        user_id: USER_A,
        platform: "android",
        token: DEVICE_TOKEN,
      },
    ]);
    stubFetch(world.sb.route, ...service.routes);
    const env2 = fcmEnv(account);

    await notifyIncomingCall(env2, getDb(env2), { ...INPUT, userIds: [USER_A] });

    expect(service.sends).toHaveLength(1);
    const message = service.sends[0].message as {
      token: string;
      data: Record<string, string>;
      android: { priority: string; ttl: string };
    };
    expect(message.token).toBe(DEVICE_TOKEN);
    expect(message.android).toEqual({ priority: "HIGH", ttl: "30s" });
    expect(message.data.kind).toBe("call");
    expect(message.data.title).toBe("Incoming call");
    expect(message.data.url).toBe("/calls?call=sess-1");
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("prunes an UNREGISTERED token and reports it to Sentry WITHOUT the token value", async () => {
    const account = await makeServiceAccount();
    const service = fcmService({
      sendStatus: 404,
      sendBody: JSON.stringify({
        error: { code: 404, details: [{ errorCode: "UNREGISTERED" }] },
      }),
    });
    const world = nativeWorld([
      {
        id: DEVICE_ROW_ID,
        user_id: USER_A,
        platform: "ios",
        token: DEVICE_TOKEN,
      },
    ]);
    stubFetch(world.sb.route, ...service.routes);
    const env2 = fcmEnv(account);

    await notifyIncomingCall(env2, getDb(env2), { ...INPUT, userIds: [USER_A] });

    expect(world.deleted).toEqual([`eq.${DEVICE_ROW_ID}`]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, level] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(level).toBe("info");
    expect(msg).toContain("ios");
    expect(msg).toContain("404");
    // The token is a per-device push credential — never logged.
    expect(msg).not.toContain(DEVICE_TOKEN);
  });

  it("reports a non-OK native delivery as a warning WITHOUT pruning, never throws", async () => {
    const account = await makeServiceAccount();
    const service = fcmService({ sendStatus: 429 });
    const world = nativeWorld([
      {
        id: DEVICE_ROW_ID,
        user_id: USER_A,
        platform: "android",
        token: DEVICE_TOKEN,
      },
    ]);
    stubFetch(world.sb.route, ...service.routes);
    const env2 = fcmEnv(account);

    await expect(
      notifyIncomingCall(env2, getDb(env2), { ...INPUT, userIds: [USER_A] }),
    ).resolves.toBeUndefined();

    expect(world.deleted).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, level] = vi.mocked(Sentry.captureMessage).mock.calls[0];
    expect(level).toBe("warning");
    expect(msg).toContain("429");
    expect(msg).not.toContain(DEVICE_TOKEN);
  });
});
