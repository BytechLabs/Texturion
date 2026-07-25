/**
 * The shared push fan-out. The inbound and missed-call suites already exercise
 * it through their pipelines; this pins the mechanics that must hold for every
 * caller, including ones that do not exist yet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { deliverPush } from "./deliver";

const env = completeEnv();
const USER = "10000000-aaaa-4000-8000-000000000001";
const SUB_ID = "50000000-0000-4000-8000-000000000001";
const PUSH_ENDPOINT = "https://push.example.net/send/";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A subscription with real P-256 material, so the encryption path runs. */
async function subscription(id: string) {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer,
  );
  const b64u = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return {
    id,
    user_id: USER,
    endpoint: `${PUSH_ENDPOINT}${id}`,
    p256dh: b64u(raw),
    auth: b64u(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const DEVICE = {
  id: "60000000-0000-4000-8000-000000000001",
  user_id: USER,
  platform: "android" as const,
  token: "device-token-1",
};

function world(
  options: {
    subscriptions?: Record<string, unknown>[];
    pushStatus?: number;
  } = {},
): { sb: SupabaseStub; routes: FetchRoute[] } {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/push_subscriptions", () => options.subscriptions ?? []);
  sb.on("DELETE", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => []);
  const pushRoute: FetchRoute = (url) =>
    url.href.startsWith(PUSH_ENDPOINT)
      ? new Response(null, { status: options.pushStatus ?? 201 })
      : undefined;
  return { sb, routes: [sb.route, pushRoute] };
}

describe("deliverPush", () => {
  it("asks for nothing when there is nobody to reach", async () => {
    // A pipeline whose audience filtered down to nobody must not spend two
    // queries proving it.
    const { sb, routes } = world();
    stubFetch(...routes);

    await deliverPush(env, getDb(env), {
      userIds: [],
      webPayload: "{}",
      collapseKey: "conversation:x",
      failures: [],
    });

    expect(sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("prunes a subscription the push service says is gone", async () => {
    const { sb, routes } = world({
      subscriptions: [await subscription(SUB_ID)],
      pushStatus: 410,
    });
    stubFetch(...routes);
    const failures: unknown[] = [];

    await deliverPush(env, getDb(env), {
      userIds: [USER],
      webPayload: "{}",
      collapseKey: "conversation:x",
      failures,
    });

    // An unsubscribed or expired endpoint is cleanup, not a delivery failure.
    const deletes = sb.find("DELETE", "/rest/v1/push_subscriptions");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url.searchParams.get("id")).toBe(`eq.${SUB_ID}`);
    expect(failures).toEqual([]);
  });

  it("collects a delivery failure instead of stopping the fan-out", async () => {
    // One unhealthy push service must not cost the other recipients their
    // alert, so a failure is recorded and the loop carries on.
    const { routes } = world({
      subscriptions: [
        await subscription(SUB_ID),
        await subscription("50000000-0000-4000-8000-000000000002"),
      ],
      pushStatus: 500,
    });
    stubFetch(...routes);
    const failures: unknown[] = [];

    await deliverPush(env, getDb(env), {
      userIds: [USER],
      webPayload: "{}",
      collapseKey: "conversation:x",
      failures,
    });

    expect(failures).toHaveLength(2);
  });

  it("sends the web payload natively unless a native one is given", async () => {
    const account = await makeServiceAccount();
    const fcm = fcmEnv(account);
    const service = fcmService();
    const sb = supabaseStub(fcm);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => [DEVICE]);
    stubFetch(sb.route, ...service.routes);

    await deliverPush(fcm, getDb(fcm), {
      userIds: [USER],
      webPayload: '{"title":"Web"}',
      collapseKey: "conversation:x",
      failures: [],
    });
    await deliverPush(fcm, getDb(fcm), {
      userIds: [USER],
      webPayload: '{"title":"Web"}',
      // Only the native clients see the discriminator that picks a channel.
      nativePayload: '{"kind":"missed_call","title":"Web"}',
      collapseKey: "conversation:x",
      failures: [],
    });

    const data = service.sends.map(
      (send) => send.message.data as Record<string, string>,
    );
    expect(data[0].kind).toBeUndefined();
    expect(data[1].kind).toBe("missed_call");
    expect(data.map((entry) => entry.title)).toEqual(["Web", "Web"]);
  });
});
