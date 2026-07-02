/**
 * §8 notification pipeline suite: audience resolution (assignee vs all active
 * members, deactivated-assignee fallback), per-user notification_prefs
 * filtering (missing rows read as the §6 defaults), one Resend email per
 * trigger, one Web Push per stored subscription, dead-endpoint cleanup on
 * 410, and never-silent failure aggregation. Only global fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { notificationSnippet, notifyInboundMessage } from "./inbound";

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const OWNER = "10000000-aaaa-4000-8000-000000000001";
const MEMBER = "10000000-aaaa-4000-8000-000000000002";
const SUB_ID = "20000000-aaaa-4000-8000-000000000001";
const PUSH_ENDPOINT = "https://push.example.net/send/";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface World {
  sb: SupabaseStub;
  resend: { calls: unknown[] };
  push: { calls: { url: string; status: number }[] };
  routes: FetchRoute[];
}

function buildWorld(options: {
  assignedUserId?: string | null;
  isSpam?: boolean;
  members?: string[];
  prefs?: { user_id: string; email_enabled: boolean; push_enabled: boolean }[];
  subscriptions?: {
    id: string;
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  pushStatus?: number;
}): World {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      id: CONVERSATION_ID,
      assigned_user_id: options.assignedUserId ?? null,
      is_spam: options.isSpam ?? false,
      contacts: { name: "Dana Smith", phone_e164: "+16135551000" },
    },
  ]);
  sb.on("GET", "/rest/v1/company_members", () =>
    (options.members ?? [OWNER, MEMBER]).map((user_id) => ({ user_id })),
  );
  sb.on("GET", "/rest/v1/notification_prefs", () => options.prefs ?? []);
  sb.on("GET", "/rest/v1/push_subscriptions", () => options.subscriptions ?? []);
  sb.on("DELETE", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", /^\/auth\/v1\/admin\/users\//, (call) => {
    const userId = call.path.split("/").pop();
    return { id: userId, email: `${userId}@team.example` };
  });

  const resendCalls: unknown[] = [];
  const resendRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    resendCalls.push(await request.clone().json());
    return Response.json({ id: "email_1" });
  };

  const pushCalls: { url: string; status: number }[] = [];
  const pushRoute: FetchRoute = (url) => {
    if (!url.href.startsWith(PUSH_ENDPOINT)) return undefined;
    const status = options.pushStatus ?? 201;
    pushCalls.push({ url: url.href, status });
    return new Response(null, { status });
  };

  return {
    sb,
    resend: { calls: resendCalls },
    push: { calls: pushCalls },
    routes: [sb.route, resendRoute, pushRoute],
  };
}

/** A structurally valid (real) subscription for a user. */
async function subscriptionFor(userId: string, suffix: string) {
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
    id: SUB_ID,
    user_id: userId,
    endpoint: `${PUSH_ENDPOINT}${suffix}`,
    p256dh: b64u(raw),
    auth: b64u(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const INPUT = {
  companyId: COMPANY_ID,
  conversationId: CONVERSATION_ID,
  body: "Hi, do you do gutters?",
  mediaCount: 0,
};

describe("notificationSnippet", () => {
  it("clips to 80 chars with an ellipsis and collapses whitespace", () => {
    const long = `${"a".repeat(60)} \n\t ${"b".repeat(60)}`;
    const snippet = notificationSnippet(long, 0);
    expect(snippet).toHaveLength(80);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain(`${"a".repeat(60)} b`); // newline run collapsed
    expect(notificationSnippet("short", 0)).toBe("short");
  });

  it("falls back for empty bodies (media vs plain)", () => {
    expect(notificationSnippet("  ", 2)).toBe("Sent a photo");
    expect(notificationSnippet("", 0)).toBe("Sent a message");
  });
});

describe("notifyInboundMessage (§8)", () => {
  it("unassigned: one email to every active member (defaults when prefs rows are missing)", async () => {
    const world = buildWorld({});
    stubFetch(...world.routes);

    await notifyInboundMessage(env, INPUT);

    expect(world.resend.calls).toHaveLength(1);
    const email = world.resend.calls[0] as {
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(email.to.sort()).toEqual(
      [`${OWNER}@team.example`, `${MEMBER}@team.example`].sort(),
    );
    expect(email.subject).toBe("New text from Dana Smith");
    expect(email.text).toContain("Hi, do you do gutters?");
    expect(email.text).toContain(
      `${env.APP_ORIGIN}/conversations/${CONVERSATION_ID}`,
    );
  });

  it("assigned: only the assignee is notified", async () => {
    const world = buildWorld({ assignedUserId: MEMBER });
    stubFetch(...world.routes);

    await notifyInboundMessage(env, INPUT);

    const email = world.resend.calls[0] as { to: string[] };
    expect(email.to).toEqual([`${MEMBER}@team.example`]);
    // Push subscriptions were queried for the assignee only.
    const subsCall = world.sb.find("GET", "/rest/v1/push_subscriptions")[0];
    expect(subsCall.url.searchParams.get("user_id")).toBe(`in.(${MEMBER})`);
  });

  it("a deactivated assignee falls back to all active members", async () => {
    // Assignee not in the active-member set (deactivated_at filter).
    const world = buildWorld({
      assignedUserId: "10000000-aaaa-4000-8000-00000000dead",
      members: [OWNER, MEMBER],
    });
    stubFetch(...world.routes);

    await notifyInboundMessage(env, INPUT);
    const email = world.resend.calls[0] as { to: string[] };
    expect(email.to).toHaveLength(2);
  });

  it("honors per-user prefs: email off → no email; push off → no push", async () => {
    const world = buildWorld({
      members: [OWNER],
      prefs: [{ user_id: OWNER, email_enabled: false, push_enabled: false }],
    });
    stubFetch(...world.routes);

    await notifyInboundMessage(env, INPUT);
    expect(world.resend.calls).toHaveLength(0);
    expect(world.push.calls).toHaveLength(0);
    // With push disabled for the whole audience, subscriptions are not read.
    expect(world.sb.find("GET", "/rest/v1/push_subscriptions")).toHaveLength(0);
  });

  it("sends one Web Push per stored subscription", async () => {
    const world = buildWorld({
      members: [OWNER],
      subscriptions: [
        await subscriptionFor(OWNER, "device-1"),
        { ...(await subscriptionFor(OWNER, "device-2")), id: crypto.randomUUID() },
      ],
    });
    stubFetch(...world.routes);

    await notifyInboundMessage(env, INPUT);
    expect(world.push.calls.map((call) => call.url).sort()).toEqual([
      `${PUSH_ENDPOINT}device-1`,
      `${PUSH_ENDPOINT}device-2`,
    ]);
  });

  it("deletes the subscription row when the push service says 410 Gone", async () => {
    const world = buildWorld({
      members: [OWNER],
      subscriptions: [await subscriptionFor(OWNER, "expired")],
      pushStatus: 410,
    });
    stubFetch(...world.routes);

    await notifyInboundMessage(env, INPUT); // gone is cleanup, not a failure
    const deletes = world.sb.find("DELETE", "/rest/v1/push_subscriptions");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url.searchParams.get("id")).toBe(`eq.${SUB_ID}`);
  });

  it("collects push failures and throws (never silent), after attempting email", async () => {
    const world = buildWorld({
      members: [OWNER],
      subscriptions: [await subscriptionFor(OWNER, "broken")],
      pushStatus: 500,
    });
    stubFetch(...world.routes);

    await expect(notifyInboundMessage(env, INPUT)).rejects.toThrow(
      /delivery step\(s\) failed/,
    );
    expect(world.resend.calls).toHaveLength(1); // email still went out
  });

  it("never notifies for a spam thread", async () => {
    const world = buildWorld({ isSpam: true });
    stubFetch(...world.routes);

    await notifyInboundMessage(env, INPUT);
    expect(world.resend.calls).toHaveLength(0);
    expect(world.push.calls).toHaveLength(0);
    expect(world.sb.find("GET", "/rest/v1/company_members")).toHaveLength(0);
  });
});
