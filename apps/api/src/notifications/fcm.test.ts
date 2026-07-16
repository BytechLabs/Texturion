/**
 * FCM HTTP v1 sender suite (#151): REAL RS256 crypto round-tripped — the test
 * plays Google (a throwaway RSA service-account key + stubbed OAuth/FCM
 * endpoints), verifies the OAuth assertion against the generated public key,
 * and asserts the per-platform message shapes, TTL/urgency mapping, the
 * access-token cache, and the UNREGISTERED prune signal. Only the network
 * edge is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fcmEnv,
  fcmService,
  makeServiceAccount,
} from "../test/fcm-account";
import { completeEnv, stubFetch } from "../test/support";
import { decodeBase64Url } from "./webpush";
import { isFcmConfigured, sendFcm } from "./fcm";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The §8 message-push payload contract, verbatim. */
const MESSAGE_PAYLOAD = JSON.stringify({
  title: "Dana Smith",
  body: "Hi, do you do gutters?",
  url: "https://app.loonext.com/inbox/bbbbbbbb-0000-4000-8000-00000000000b",
});

/** The #135 call-wake payload contract, verbatim. */
const CALL_PAYLOAD = JSON.stringify({
  kind: "call",
  title: "Incoming call",
  body: "+16135551000",
  url: "/calls?call=sess-1",
});

describe("isFcmConfigured", () => {
  it("is false without the secret and true with it", async () => {
    expect(isFcmConfigured(completeEnv())).toBe(false);
    const account = await makeServiceAccount();
    expect(isFcmConfigured(fcmEnv(account))).toBe(true);
  });
});

describe("sendFcm — unconfigured no-op", () => {
  it("skips with a single log line, touches no network, reports a non-gone success", async () => {
    stubFetch(); // any fetch would fail the test loudly
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await sendFcm(
      completeEnv(),
      { platform: "android", token: "tok-1" },
      MESSAGE_PAYLOAD,
    );

    expect(result).toEqual({ ok: true, status: 0, gone: false, errorBody: "" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("FCM_SERVICE_ACCOUNT_JSON unset");
  });
});

describe("sendFcm — service-account OAuth (RS256 JWT)", () => {
  it("asserts a Google-verifiable RS256 JWT with the right claims", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);

    await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "tok-1" },
      MESSAGE_PAYLOAD,
    );

    expect(service.assertions).toHaveLength(1);
    const [header, claims, signature] = service.assertions[0].split(".");

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      account.publicKey,
      decodeBase64Url(signature) as BufferSource,
      encoder.encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);

    expect(JSON.parse(decoder.decode(decodeBase64Url(header)))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const decodedClaims = JSON.parse(decoder.decode(decodeBase64Url(claims)));
    expect(decodedClaims.iss).toBe(account.clientEmail);
    expect(decodedClaims.scope).toBe(
      "https://www.googleapis.com/auth/firebase.messaging",
    );
    expect(decodedClaims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(decodedClaims.exp - decodedClaims.iat).toBe(3600);
    const now = Math.floor(Date.now() / 1000);
    expect(decodedClaims.iat).toBeGreaterThan(now - 60);
    expect(decodedClaims.iat).toBeLessThanOrEqual(now);
  });

  it("sends Bearer-authorized to the service account's own project", async () => {
    const account = await makeServiceAccount(undefined, "loonext-live");
    const service = fcmService({ accessToken: "ya29.project-scoped" });
    stubFetch(...service.routes);

    await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "tok-1" },
      MESSAGE_PAYLOAD,
    );

    expect(service.sends).toHaveLength(1);
    expect(service.sends[0].url.pathname).toBe(
      "/v1/projects/loonext-live/messages:send",
    );
    expect(service.sends[0].authorization).toBe("Bearer ya29.project-scoped");
  });

  it("caches the access token: two sends mint ONE token", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);
    const env = fcmEnv(account);

    await sendFcm(env, { platform: "android", token: "tok-1" }, MESSAGE_PAYLOAD);
    await sendFcm(env, { platform: "ios", token: "tok-2" }, MESSAGE_PAYLOAD);

    expect(service.assertions).toHaveLength(1);
    expect(service.sends).toHaveLength(2);
  });

  it("throws loudly on a malformed service account (never a silent drop)", async () => {
    stubFetch(); // must not reach the network
    const env = {
      ...completeEnv(),
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "x" }),
    };
    await expect(
      sendFcm(env, { platform: "android", token: "tok-1" }, MESSAGE_PAYLOAD),
    ).rejects.toThrow(/service-account/);
  });
});

describe("sendFcm — message shapes + TTL/urgency mapping", () => {
  it("android: DATA-ONLY message (no notification), HIGH priority + short ttl for a call wake", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);

    await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "android-tok" },
      CALL_PAYLOAD,
      30,
      "high",
    );

    const message = service.sends[0].message;
    expect(message).toEqual({
      token: "android-tok",
      data: {
        kind: "call",
        title: "Incoming call",
        body: "+16135551000",
        url: "/calls?call=sess-1",
      },
      android: { priority: "HIGH", ttl: "30s" },
    });
    // Data-only by design: an OS-rendered notification would rob the app of
    // the call-wake path.
    expect(message).not.toHaveProperty("notification");
    expect(message).not.toHaveProperty("apns");
  });

  it("android: a normal message rides NORMAL priority with the default 24h ttl", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);

    await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "android-tok" },
      MESSAGE_PAYLOAD,
    );

    const message = service.sends[0].message as {
      android: { priority: string; ttl: string };
    };
    expect(message.android).toEqual({
      priority: "NORMAL",
      ttl: `${24 * 60 * 60}s`,
    });
  });

  it("ios: alert push (notification + data) with apns-priority 10 and apns-expiration = now + ttl for a call", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);

    const before = Math.floor(Date.now() / 1000);
    await sendFcm(
      fcmEnv(account),
      { platform: "ios", token: "ios-tok" },
      CALL_PAYLOAD,
      30,
      "high",
    );
    const after = Math.floor(Date.now() / 1000);

    const message = service.sends[0].message as {
      token: string;
      notification: { title: string; body: string };
      data: Record<string, string>;
      apns: { headers: Record<string, string> };
      android?: unknown;
    };
    expect(message.token).toBe("ios-tok");
    expect(message.notification).toEqual({
      title: "Incoming call",
      body: "+16135551000",
    });
    expect(message.data.url).toBe("/calls?call=sess-1");
    expect(message.data.kind).toBe("call");
    expect(message.apns.headers["apns-priority"]).toBe("10");
    const expiration = Number(message.apns.headers["apns-expiration"]);
    expect(expiration).toBeGreaterThanOrEqual(before + 30);
    expect(expiration).toBeLessThanOrEqual(after + 30);
    expect(message.android).toBeUndefined();
  });

  it("ios: a normal message rides apns-priority 5 (power-considerate)", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);

    await sendFcm(
      fcmEnv(account),
      { platform: "ios", token: "ios-tok" },
      MESSAGE_PAYLOAD,
    );

    const message = service.sends[0].message as {
      apns: { headers: Record<string, string> };
    };
    expect(message.apns.headers["apns-priority"]).toBe("5");
    // No coalescing tag given — no collapse header (never an empty one).
    expect(message.apns.headers).not.toHaveProperty("apns-collapse-id");
  });

  it("ios: the caller's coalescing tag rides apns-collapse-id, bounded to APNs' 64 bytes (#162)", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);
    const env = fcmEnv(account);

    await sendFcm(
      env,
      { platform: "ios", token: "ios-tok" },
      MESSAGE_PAYLOAD,
      undefined,
      undefined,
      "conversation:bbbbbbbb-0000-4000-8000-00000000000b",
    );
    await sendFcm(
      env,
      { platform: "ios", token: "ios-tok" },
      MESSAGE_PAYLOAD,
      undefined,
      undefined,
      `conversation:${"x".repeat(100)}`,
    );

    const headersOf = (index: number) =>
      (service.sends[index].message as { apns: { headers: Record<string, string> } })
        .apns.headers;
    expect(headersOf(0)["apns-collapse-id"]).toBe(
      "conversation:bbbbbbbb-0000-4000-8000-00000000000b",
    );
    expect(headersOf(1)["apns-collapse-id"]).toHaveLength(64);
  });

  it("android: the coalescing tag changes NOTHING (client-side tags own coalescing there)", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);

    await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "android-tok" },
      MESSAGE_PAYLOAD,
      undefined,
      undefined,
      "conversation:bbbbbbbb-0000-4000-8000-00000000000b",
    );

    const message = service.sends[0].message;
    expect(message).not.toHaveProperty("apns");
    expect(message).not.toHaveProperty("notification");
    expect(JSON.stringify(message)).not.toContain("collapse");
  });
});

describe("sendFcm — delivery outcomes", () => {
  it("maps FCM 404 UNREGISTERED to gone (the caller prunes the row)", async () => {
    const account = await makeServiceAccount();
    const service = fcmService({
      sendStatus: 404,
      sendBody: JSON.stringify({
        error: {
          code: 404,
          status: "NOT_FOUND",
          details: [{ errorCode: "UNREGISTERED" }],
        },
      }),
    });
    stubFetch(...service.routes);

    const result = await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "dead-tok" },
      MESSAGE_PAYLOAD,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.gone).toBe(true);
  });

  it("treats an UNREGISTERED error body as gone even off a non-404 status", async () => {
    const account = await makeServiceAccount();
    const service = fcmService({
      sendStatus: 400,
      sendBody: JSON.stringify({
        error: { code: 400, details: [{ errorCode: "UNREGISTERED" }] },
      }),
    });
    stubFetch(...service.routes);

    const result = await sendFcm(
      fcmEnv(account),
      { platform: "ios", token: "dead-tok" },
      MESSAGE_PAYLOAD,
    );
    expect(result.gone).toBe(true);
  });

  it("reports other failures ok:false, not gone, with a bounded diagnostic snippet", async () => {
    const account = await makeServiceAccount();
    const longReason = "QUOTA_EXCEEDED: message rate exceeded. ".repeat(20);
    const service = fcmService({ sendStatus: 429, sendBody: longReason });
    stubFetch(...service.routes);

    const result = await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "tok-1" },
      MESSAGE_PAYLOAD,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.gone).toBe(false);
    expect(result.errorBody).toContain("QUOTA_EXCEEDED");
    expect(result.errorBody.length).toBeLessThanOrEqual(300);
  });

  it("reports a clean 200 as ok with an empty errorBody", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    stubFetch(...service.routes);

    const result = await sendFcm(
      fcmEnv(account),
      { platform: "android", token: "tok-1" },
      MESSAGE_PAYLOAD,
    );
    expect(result).toEqual({ ok: true, status: 200, gone: false, errorBody: "" });
  });
});
