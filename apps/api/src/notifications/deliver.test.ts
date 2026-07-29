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
import { deliverPush, newestPerUser } from "./deliver";
import { pushTopic } from "./webpush";

const env = completeEnv();
const USER = "10000000-aaaa-4000-8000-000000000001";
const SUB_ID = "50000000-0000-4000-8000-000000000001";
const PUSH_ENDPOINT = "https://push.example.net/send/";
/** Minimum viable notification content for the mechanics under test. */
const ALERT = { title: "Sam", body: "On my way", url: "https://app.test/inbox/t1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A subscription with real P-256 material, so the encryption path runs. */
async function subscription(id: string, userId: string = USER) {
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
    user_id: userId,
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

interface PushSend {
  endpoint: string;
  topic: string | null;
}

function world(
  options: {
    subscriptions?: Record<string, unknown>[];
    pushStatus?: number;
  } = {},
): { sb: SupabaseStub; routes: FetchRoute[]; sends: PushSend[] } {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/push_subscriptions", () => options.subscriptions ?? []);
  sb.on("DELETE", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => []);
  const sends: PushSend[] = [];
  const pushRoute: FetchRoute = (url, request) => {
    if (!url.href.startsWith(PUSH_ENDPOINT)) return undefined;
    sends.push({ endpoint: url.href, topic: request.headers.get("topic") });
    return new Response(null, { status: options.pushStatus ?? 201 });
  };
  return { sb, routes: [sb.route, pushRoute], sends };
}

describe("deliverPush", () => {
  it("asks for nothing when there is nobody to reach", async () => {
    // A pipeline whose audience filtered down to nobody must not spend two
    // queries proving it.
    const { sb, routes } = world();
    stubFetch(...routes);

    await deliverPush(env, getDb(env), {
      content: { written: "us" },
      userIds: [],
      web: ALERT,
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
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
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
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
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
      content: { written: "us" },
      userIds: [USER],
      web: { ...ALERT, title: "Web" },
      collapseKey: "conversation:x",
      failures: [],
    });
    await deliverPush(fcm, getDb(fcm), {
      content: { written: "us" },
      userIds: [USER],
      web: { ...ALERT, title: "Web" },
      // Only the native clients see the discriminator that picks a channel.
      native: { ...ALERT, title: "Web", kind: "missed_call" },
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

  // --- #266: one collapse identity, on every client ---

  it("puts the collapse key in the payload both clients read", async () => {
    // Web and Android coalesce on the payload tag. Letting them derive it from
    // the deep link instead rewrote every key to "per thread", so a second
    // mention on a note — or a customer's text — replaced the first alert.
    const account = await makeServiceAccount();
    const fcm = fcmEnv(account);
    const service = fcmService();
    const sb = supabaseStub(fcm);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => [DEVICE]);
    stubFetch(sb.route, ...service.routes);

    await deliverPush(fcm, getDb(fcm), {
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
      collapseKey: "mention:note-7",
      failures: [],
    });

    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.tag).toBe("mention:note-7");
    // iOS can't retag a remote alert, so it coalesces on the header instead.
    const apns = service.sends[0].message.apns as
      | { headers?: Record<string, string> }
      | undefined;
    expect(apns?.headers?.["apns-collapse-id"] ?? data.tag).toBe(
      "mention:note-7",
    );
  });

  it("collapses queued web pushes on the same subject, not on others", async () => {
    // RFC 8030 Topic: a phone that was off all morning wakes to one alert per
    // subject. Two subjects must never share a topic — hence the hash, not a
    // truncation of `conversation:<uuid>`.
    const { routes, sends } = world({ subscriptions: [await subscription(SUB_ID)] });
    stubFetch(...routes);

    await deliverPush(env, getDb(env), {
      content: { written: "us" },
      userIds: [USER],
      web: ALERT,
      collapseKey: "conversation:abc",
      failures: [],
    });

    expect(sends[0].topic).toBe(await pushTopic("conversation:abc"));
    expect(sends[0].topic).not.toBe(await pushTopic("conversation:abd"));
    // The header's alphabet is fixed: ≤32 chars of base64url.
    expect(sends[0].topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  // --- #267: the bound is per recipient, not per fan-out ---

  it("reaches everyone when one member has registered many devices", async () => {
    // A single ceiling across the audience cut the same longest-tenured
    // members every time, because the sort is newest-first: a permanent silent
    // blackout, not an occasional miss.
    const crowded = "10000000-aaaa-4000-8000-000000000002";
    const oldest = "10000000-aaaa-4000-8000-000000000003";
    const rows = [];
    for (let index = 0; index < 12; index += 1) {
      rows.push(
        await subscription(`50000000-0000-4000-8000-00000000010${index}`, crowded),
      );
    }
    // Newest-first, so the longest-tenured member's row sorts last.
    const oldestRow = await subscription(
      "50000000-0000-4000-8000-000000000999",
      oldest,
    );
    rows.push(oldestRow);
    const { sb, routes, sends } = world({ subscriptions: rows });
    stubFetch(...routes);

    await deliverPush(env, getDb(env), {
      content: { written: "us" },
      userIds: [crowded, oldest],
      web: ALERT,
      collapseKey: "conversation:x",
      failures: [],
    });

    // The window scales with the audience...
    expect(
      sb.find("GET", "/rest/v1/push_subscriptions")[0].url.searchParams.get(
        "limit",
      ),
    ).toBe("20");
    // ...the noisy member is still capped at their own 10...
    expect(sends).toHaveLength(11);
    // ...and the quiet, longest-tenured member is reached.
    expect(sends.some((send) => send.endpoint === oldestRow.endpoint)).toBe(true);
  });
});

describe("newestPerUser", () => {
  it("gives every recipient their own quota", () => {
    const rows = [
      { user_id: "a", id: "a1" },
      { user_id: "a", id: "a2" },
      { user_id: "a", id: "a3" },
      { user_id: "b", id: "b1" },
    ];

    // Newest-first in, newest-first out: `a` keeps its two most recent, and
    // `b` is never crowded out by a teammate's device count.
    expect(newestPerUser(rows, 2).map((row) => row.id)).toEqual([
      "a1",
      "a2",
      "b1",
    ]);
  });
});
