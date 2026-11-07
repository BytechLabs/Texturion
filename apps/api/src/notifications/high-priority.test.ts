/**
 * #452: HIGH-priority push is a rationed resource, so it gets a counter and a
 * shared ceiling.
 *
 * What this suite pins:
 *   - every HIGH request claims the meter, with the DEVICE count (the unit the
 *     platforms ration) and the reason that asked;
 *   - an ordinary append claims nothing at all;
 *   - a refused claim DEGRADES the native send to NORMAL and still delivers to
 *     every device — never drops it;
 *   - a refused claim does NOT degrade Web Push, which nobody rations;
 *   - a meter failure fails OPEN and is reported, because a counter must never
 *     be the reason a phone does not ring;
 *   - the claim that reaches the ceiling sends one ops notice, and nothing
 *     reaches the owner.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { exceptionsCaptured, noticesCaptured, resetCaptures } from "../test/capture-mock";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { deliverPush } from "./deliver";
import {
  claimHighPriority,
  HIGH_PRIORITY_PUSH_DAILY_LIMIT,
} from "./high-priority";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const env = completeEnv();
const COMPANY = "cccccccc-0000-4000-8000-00000000000c";
const USER = "aaaaaaaa-0000-4000-8000-00000000000a";
const PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/";

// #228: a payload is now composed from the reader's language. This suite is
// about the high-priority BUDGET rather than copy, so it ignores the argument.
const ALERT = () => ({
  title: "Dana Smith",
  body: "Do you do gutters?",
  url: "https://app.example/inbox/1",
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCaptures();
});

/** A structurally valid Web Push subscription, so real RFC 8291 crypto runs. */
async function subscription() {
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
    id: "20000000-aaaa-4000-8000-000000000001",
    user_id: USER,
    endpoint: `${PUSH_ENDPOINT}1`,
    p256dh: b64u(raw),
    auth: b64u(crypto.getRandomValues(new Uint8Array(16))),
  };
}

/**
 * Two Android devices and one Web Push subscription for USER, plus whatever
 * verdict the meter should return.
 */
async function world(options: {
  claim?: unknown;
  claimStatus?: number;
  devices?: number;
} = {}) {
  const sb = supabaseStub(env);
  const deviceCount = options.devices ?? 2;
  // Built up front: the stub's responders are synchronous, so a responder that
  // returned a promise would be JSON-encoded as `{}`.
  const sub = await subscription();
  sb.on("GET", "/rest/v1/push_subscriptions", () => [sub]);
  sb.on("GET", "/rest/v1/device_push_tokens", () =>
    Array.from({ length: deviceCount }, (_, i) => ({
      id: `30000000-aaaa-4000-8000-00000000000${i}`,
      user_id: USER,
      platform: "android",
      token: `tok-${i}`,
    })),
  );
  sb.on("POST", "/rest/v1/rpc/claim_high_priority_push", () =>
    options.claimStatus !== undefined
      ? new Response("boom", { status: options.claimStatus })
      : (options.claim ?? { allowed: true, reached_cap: false }),
  );
  sb.on("GET", "/rest/v1/company_members", () => [{ user_id: USER }]);
  sb.on("GET", /^\/auth\/v1\/admin\/users\//, () => ({
    id: USER,
    email: "owner@team.example",
  }));

  const resend: unknown[] = [];
  const resendRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    resend.push(await request.clone().json());
    return Response.json({ id: "email_1" });
  };

  const webPush: { urgency: string | null }[] = [];
  const pushRoute: FetchRoute = (url, request) => {
    if (!url.href.startsWith(PUSH_ENDPOINT)) return undefined;
    webPush.push({ urgency: request.headers.get("urgency") });
    return new Response(null, { status: 201 });
  };

  return { sb, resend, webPush, routes: [sb.route, resendRoute, pushRoute] };
}

/** The `android.priority` of every native send a delivery produced. */
async function nativePriorities(
  w: Awaited<ReturnType<typeof world>>,
  highPriority: { companyId: string; reason: "lead" | "emergency" } | undefined,
): Promise<string[]> {
  const account = await makeServiceAccount();
  const service = fcmService();
  stubFetch(...w.routes, ...service.routes);
  const fcm = fcmEnv(account);
  await deliverPush(fcm, (await import("../db")).getDb(fcm), {
    category: "messages_all",
    companyId: COMPANY,
    content: { written: "us" },
    userIds: [USER],
    web: ALERT,
    collapseKey: "conversation:1",
    highPriority,
    failures: [],
  });
  return service.sends.map(
    (send) =>
      (send.message as { android?: { priority?: string } }).android?.priority ??
      "",
  );
}

describe("#452 — the meter on high-priority push", () => {
  it("claims the DEVICE count, not the recipient count, with its reason", async () => {
    // The device is what Google and Apple ration; a crew of one carrying three
    // phones spends three.
    const w = await world({ devices: 3 });
    await nativePriorities(w, { companyId: COMPANY, reason: "lead" });

    const claims = w.sb.find("POST", "/rest/v1/rpc/claim_high_priority_push");
    expect(claims).toHaveLength(1);
    expect(claims[0].body).toMatchObject({
      p_company_id: COMPANY,
      p_reason: "lead",
      p_sends: 3,
      p_default_limit: HIGH_PRIORITY_PUSH_DAILY_LIMIT,
    });
  });

  it("never claims for an ordinary append", async () => {
    // The whole point of the #391 split: the tenth message in a live
    // back-and-forth spends nothing, because it asks for nothing.
    const w = await world();
    const priorities = await nativePriorities(w, undefined);

    expect(w.sb.find("POST", "/rest/v1/rpc/claim_high_priority_push")).toEqual(
      [],
    );
    expect(priorities).toEqual(["NORMAL", "NORMAL"]);
  });

  it("degrades to NORMAL past the ceiling and still reaches every device", async () => {
    // The one cost centre where cap-and-drop is wrong: dropping the alert
    // loses the lead, degrading it loses only the Doze wake.
    const w = await world({ claim: { allowed: false, reached_cap: false } });
    const priorities = await nativePriorities(w, {
      companyId: COMPANY,
      reason: "lead",
    });

    expect(priorities).toEqual(["NORMAL", "NORMAL"]);
  });

  it("does not degrade Web Push, which nobody rations", async () => {
    // RFC 8030 urgency is not a budget with anyone. Degrading it would save
    // nothing and cost a wake.
    const w = await world({ claim: { allowed: false, reached_cap: false } });
    await nativePriorities(w, { companyId: COMPANY, reason: "lead" });

    expect(w.webPush.map((p) => p.urgency)).toEqual(["high"]);
  });

  it("fails OPEN when the meter is unreachable, and reports it", async () => {
    // The bound shapes spend across days, not milliseconds. Degrading every
    // lead in the country because a counter was unreachable is plainly worse
    // than being briefly unbounded — but it must not be silent.
    const w = await world({ claimStatus: 500 });
    const priorities = await nativePriorities(w, {
      companyId: COMPANY,
      reason: "lead",
    });

    expect(priorities).toEqual(["HIGH", "HIGH"]);
    const [failure] = exceptionsCaptured();
    expect(failure.context).toMatchObject({
      level: "warning",
      company_id: COMPANY,
      extra: { reason: "lead" },
    });
  });

  it("sends one notice when the claim reaches the ceiling, and no email to anyone", async () => {
    // Our standing with Google is our cost, not the customer's bill, and
    // there is nothing an owner could do about it — the #448 posture.
    const w = await world({ claim: { allowed: true, reached_cap: true } });
    await nativePriorities(w, { companyId: COMPANY, reason: "lead" });

    const notices = noticesCaptured("high-priority-push-ceiling");
    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe("error");
    expect(notices[0].summary).toContain("reached the daily high-priority push ceiling");
    expect(notices[0].detail).toContain(COMPANY);
    expect(notices[0].detail).toContain("NORMAL priority");
    expect(notices[0].detail).not.toContain("owner@team.example");
    expect(w.resend).toEqual([]);
  });

  it("sends nothing for a claim that did not reach the ceiling", async () => {
    const w = await world({ claim: { allowed: true, reached_cap: false } });
    await nativePriorities(w, { companyId: COMPANY, reason: "emergency" });

    expect(noticesCaptured()).toEqual([]);
    expect(w.resend).toEqual([]);
  });
});

describe("claimHighPriority", () => {
  it("is a no-op for an empty fan-out", async () => {
    // A pipeline can legitimately find zero registered devices; that is not a
    // claim and must not cost a round trip.
    const w = await world();
    stubFetch(...w.routes);
    const claim = await claimHighPriority(
      (await import("../db")).getDb(env),
      { companyId: COMPANY, reason: "ring" },
      0,
    );
    expect(claim).toEqual({ allowed: true, reachedCap: false });
    expect(w.sb.find("POST", "/rest/v1/rpc/claim_high_priority_push")).toEqual(
      [],
    );
  });

  it("reads an absent verdict as allowed", async () => {
    // An older database that does not know the RPC's shape must not silently
    // degrade every lead.
    const w = await world({ claim: {} });
    stubFetch(...w.routes);
    const claim = await claimHighPriority(
      (await import("../db")).getDb(env),
      { companyId: COMPANY, reason: "lead" },
      4,
    );
    expect(claim.allowed).toBe(true);
  });
});
