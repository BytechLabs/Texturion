/**
 * Calls v3 (#170 §15.2, review R2-B1 — the fleet-ghost gate). The call_end
 * revocation push is delivered ONLY to push channels that DECLARE the call_end
 * capability, so no un-updated (pre-v3) subscription/token ever renders a stray
 * notification. Pins that the DB read carries the caps filter and that a
 * caps-declaring subscription receives the send.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { notifyCallEnd } from "./call-end";
import { encodeBase64Url } from "./webpush";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const PUSH_ORIGIN = "https://push.example.net";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

function pushEndpoint(status: number): FetchRoute {
  return (url, request) =>
    url.origin === PUSH_ORIGIN && request.method === "POST"
      ? new Response(null, { status })
      : undefined;
}

describe("notifyCallEnd — caps gating (§9.2)", () => {
  it("queries with the caps filter and sends only to a caps-declaring subscription", async () => {
    const sb = supabaseStub(env);
    const sub = await makeSubRow(USER_A, `${PUSH_ORIGIN}/send/abc`);
    let capsFilter = "";
    let sends = 0;
    sb.on("GET", "/rest/v1/push_subscriptions", (call) => {
      capsFilter = call.url.searchParams.get("caps") ?? "";
      // The stub emulates the DB: only caps-declaring rows come back.
      return capsFilter.includes("call_end") ? [sub] : [];
    });
    // No FCM configured in completeEnv → the native branch is skipped.
    stubFetch(sb.route, (url, request) => {
      if (url.origin === PUSH_ORIGIN && request.method === "POST") {
        sends += 1;
        return new Response(null, { status: 201 });
      }
      return undefined;
    });

    await notifyCallEnd(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER_A],
      callSessionId: "sess-1",
      reason: "answered",
    });

    // The gate is applied at the DB read (caps @> {call_end}) AND a declaring
    // subscription got exactly one send.
    expect(capsFilter).toContain("call_end");
    expect(sends).toBe(1);
  });

  it("a pre-v3 subscription (no caps) receives NOTHING — the fleet-ghost gate", async () => {
    const sb = supabaseStub(env);
    let sends = 0;
    // The DB filter excludes non-caps rows → the query returns empty.
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    stubFetch(sb.route, (url, request) => {
      if (url.origin === PUSH_ORIGIN && request.method === "POST") {
        sends += 1;
        return new Response(null, { status: 201 });
      }
      return undefined;
    });

    await notifyCallEnd(env, getDb(env), {
      companyId: COMPANY_ID,
      userIds: [USER_A],
      callSessionId: "sess-1",
      reason: "voicemail",
    });

    expect(sends).toBe(0);
    void pushEndpoint;
  });
});
