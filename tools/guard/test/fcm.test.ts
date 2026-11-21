import { createVerify, generateKeyPairSync } from "node:crypto";

import { HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { rewriteMessage } from "../src/vendors/fcm";
import { harness, ruleOf } from './support';
import type { Harness } from './support';

// Generated per run, never committed: a key in the tree would read as a leak.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "loonext-test",
  client_email: "fcm-rig-sender@loonext-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

/** What production's sender builds for an iOS alert (apps/api/src/notifications/fcm.ts). */
const IOS_SHAPED = {
  token: "device-token",
  notification: { title: "Incoming call", body: "DEV-W1" },
  data: { kind: "call", session: "s1" },
  apns: { headers: { "apns-priority": "10" }, payload: { aps: {} } },
  webpush: { headers: { Urgency: "high" } },
};

function send(h: Harness, message: unknown, path = "/fcm/v1/projects/rig-dummy/messages:send") {
  return h.call(path, { body: { message } });
}

const fcmCalls = (h: Harness) => h.outbound.filter((item) => item.url.startsWith("https://fcm.googleapis.com/"));

describe("Chrome Web Push", () => {
  const path = "/fcm/web-push/fcm/send/chrome-token:part";
  const vapid = "vapid t=header.claims.signature, k=rig-vapid-public";

  function webPush(h: Harness, route = path, authorization = vapid, caller = "rig-api") {
    return h.guard.handle(new Request(`https://guard.internal${route}`, {
      method: "POST",
      headers: {
        [HEADER.callerClass]: caller,
        "x-web-push-authorization": authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "60",
        urgency: "high",
        topic: "test-topic",
      },
      body: "ciphertext",
    }));
  }

  it("forwards the ciphertext and VAPID authentication to Google's subscription endpoint", async () => {
    const h = harness({ env: { RIG_WEB_PUSH_VAPID_PUBLIC_KEY: "rig-vapid-public" } });
    expect((await webPush(h)).status).toBe(200);
    const [sent] = fcmCalls(h);
    expect(sent.url).toBe("https://fcm.googleapis.com/fcm/send/chrome-token:part");
    expect(sent.body).toBe("ciphertext");
    expect(sent.headers.get("authorization")).toBe(vapid);
    expect(sent.headers.get("x-web-push-authorization")).toBeNull();
    expect(sent.headers.get("ttl")).toBe("60");
    expect(sent.headers.get("topic")).toBe("test-topic");
  });

  it("refuses an unconfigured key, other credentials, callers and paths", async () => {
    const missing = harness();
    const h = harness({ env: { RIG_WEB_PUSH_VAPID_PUBLIC_KEY: "rig-vapid-public" } });
    await expect(ruleOf(await webPush(missing))).resolves.toBe("fcm.key_missing");
    await expect(ruleOf(await webPush(h, path, "vapid t=a.b.c, k=other-pub"))).resolves.toBe("fcm.web_push_key_mismatch");
    await expect(ruleOf(await webPush(h, path, vapid, "robot"))).resolves.toBe("class.not_allowed");
    await expect(ruleOf(await webPush(h, `${path}?destination=other`))).resolves.toBe("fcm.path_refused");
    expect(fcmCalls(h)).toEqual([]);
    expect(fcmCalls(missing)).toEqual([]);
  });
});

describe("FCM rewrite", () => {
  it("moves the notification into the Android block and drops iOS and web", () => {
    expect(rewriteMessage(IOS_SHAPED)).toEqual({
      token: "device-token",
      data: { kind: "call", session: "s1" },
      android: {
        notification: { title: "Incoming call", body: "DEV-W1" },
        restricted_package_name: "com.loonext.android.nonprod",
      },
    });
  });

  it("forces the nonprod package over any package the caller named", () => {
    const out = rewriteMessage({
      token: "t",
      android: { priority: "HIGH", ttl: "30s", restricted_package_name: "com.loonext.android" },
    });
    expect(out.android).toEqual({ priority: "HIGH", ttl: "30s", restricted_package_name: "com.loonext.android.nonprod" });
  });

  it("keeps the Android block's own notification fields over the top-level ones", () => {
    const out = rewriteMessage({ token: "t", notification: { title: "a" }, android: { notification: { title: "b" } } });
    expect((out.android as { notification: unknown }).notification).toEqual({ title: "b" });
  });

  it("refuses a topic or condition send, which would reach every subscribed app", () => {
    for (const message of [{ topic: "all" }, { condition: "'a' in topics" }, { token: "t", topic: "all" }, {}]) {
      expect(() => rewriteMessage(message), JSON.stringify(message)).toThrow(/fcm\.target_not_token/);
    }
  });
});

describe("FCM route", () => {
  it("mints its own token and sends the rewrite to its own project", async () => {
    const h = harness({ env: { FCM_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT } });
    expect((await send(h, IOS_SHAPED)).status).toBe(200);

    const exchange = h.outbound.find((item) => item.url === "https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(exchange?.body).get("assertion") ?? "";
    const [header, claims, signature] = assertion.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: "fcm-rig-sender@loonext-test.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });

    const [sent] = fcmCalls(h);
    expect(sent.url).toBe("https://fcm.googleapis.com/v1/projects/loonext-test/messages:send");
    expect(sent.headers.get("authorization")).toBe("Bearer google-access");
    const body = JSON.parse(sent.body) as { message: Record<string, unknown> };
    expect(body.message.apns).toBeUndefined();
    expect(body.message.webpush).toBeUndefined();
    expect(body.message.notification).toBeUndefined();
    expect((body.message.android as Record<string, unknown>).restricted_package_name).toBe("com.loonext.android.nonprod");
  });

  it("reuses the access token while it lives", async () => {
    const h = harness({ env: { FCM_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT } });
    await send(h, IOS_SHAPED);
    await send(h, IOS_SHAPED);
    expect(h.outbound.filter((item) => item.url === "https://oauth2.googleapis.com/token")).toHaveLength(1);
  });

  it("fails closed without a service account, and on any other path", async () => {
    const h = harness();
    await expect(ruleOf(await send(h, IOS_SHAPED))).resolves.toBe("fcm.key_missing");
    const keyed = harness({ env: { FCM_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT } });
    await expect(ruleOf(await send(keyed, IOS_SHAPED, "/fcm/v1/projects/p/messages:batchSend"))).resolves.toBe("fcm.path_refused");
    await expect(ruleOf(await keyed.call("/fcm/v1/projects/p/messages:send"))).resolves.toBe("fcm.path_refused");
  });

  it("answers the token route with a placeholder and asks Google for nothing", async () => {
    const h = harness();
    const response = await h.call("/fcm-token", { method: "POST", body: "grant_type=x" });
    await expect(response.json()).resolves.toMatchObject({ access_token: "rig-guard-placeholder", token_type: "Bearer" });
    expect(h.outbound).toEqual([]);
  });
});
