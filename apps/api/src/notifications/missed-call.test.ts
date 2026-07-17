/**
 * Missed-call crew alert suite. Audience resolution and per-user prefs are
 * shared §8 primitives covered in the inbound suite, so this focuses on what
 * missed-call.ts OWNS: push-only delivery (D45 — NO email for missed calls),
 * the #106 audience gate, and the truthful native/web push payloads.
 * Only global fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { notifyMissedCall } from "./missed-call";

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const OWNER = "10000000-aaaa-4000-8000-000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface World {
  sb: SupabaseStub;
  resend: { calls: Record<string, unknown>[] };
  routes: FetchRoute[];
}

function buildWorld(
  options: {
    contactName?: string | null;
    phoneNumberId?: string | null;
    accessRules?: Record<string, unknown>[];
    members?: { user_id: string; role: string }[];
  } = {},
): World {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      id: CONVERSATION_ID,
      assigned_user_id: null,
      phone_number_id: options.phoneNumberId ?? null,
      contacts: {
        name: options.contactName === undefined ? "Dana Smith" : options.contactName,
        phone_e164: "+16135551000",
      },
    },
  ]);
  sb.on("GET", "/rest/v1/company_members", () =>
    options.members ?? [{ user_id: OWNER, role: "owner" }],
  );
  sb.on("GET", "/rest/v1/number_access", () => options.accessRules ?? []);
  sb.on("GET", "/rest/v1/notification_prefs", () => []);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", /^\/auth\/v1\/admin\/users\//, (call) => {
    const userId = call.path.split("/").pop();
    return { id: userId, email: `${userId}@team.example` };
  });

  const resendCalls: Record<string, unknown>[] = [];
  const resendRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    resendCalls.push((await request.clone().json()) as Record<string, unknown>);
    return Response.json({ id: "email_1" });
  };

  return { sb, resend: { calls: resendCalls }, routes: [sb.route, resendRoute] };
}

const INPUT = {
  companyId: COMPANY_ID,
  conversationId: CONVERSATION_ID,
  callerE164: "+16135551000",
  textStatus: "sent",
} as const;

describe("notifyMissedCall — push-only (D45)", () => {
  it("sends NO email — the miss reaches the crew via push/bell/For You only", async () => {
    const world = buildWorld();
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    // D45 (founder call 2026-07-17): a per-miss email to every email-enabled
    // member was pure noise. The resend route stays stubbed to PROVE nothing
    // reaches it, and member emails are not even resolved anymore.
    expect(world.resend.calls).toHaveLength(0);
    expect(
      world.sb.calls.filter((call) => call.path.startsWith("/auth/v1/admin/users")),
    ).toHaveLength(0);
  });
});

/**
 * #106/#133: the alert audience honors number access exactly like the bell
 * arm reading the same event — a member with level 'none' on the number must
 * never receive the caller's name or the deep link by email/push.
 */
describe("notifyMissedCall — #106 number access", () => {
  const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
  const MEMBER = "20000000-aaaa-4000-8000-000000000002";
  const TRUSTED = "30000000-aaaa-4000-8000-000000000003";

  // A REAL deny configuration (#133 review: rules never store level 'none' —
  // deny is the RESOLVED level when rules exist and none match): the number
  // is scoped to one specific user, so every other plain member resolves to
  // 'none'.
  const scopedToTrusted = [
    {
      phone_number_id: NUMBER_ID,
      principal_kind: "user",
      principal: TRUSTED,
      level: "text",
    },
  ];

  it("drops unmatched members and keeps owners", async () => {
    const world = buildWorld({
      phoneNumberId: NUMBER_ID,
      members: [
        { user_id: OWNER, role: "owner" },
        { user_id: MEMBER, role: "member" },
      ],
      accessRules: scopedToTrusted,
    });
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    // Audience observed at the push-subscription lookup (D45: no email leg).
    const lookup = world.sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${OWNER})`);
  });

  it("keeps a notes-only member (they can read the thread)", async () => {
    const world = buildWorld({
      phoneNumberId: NUMBER_ID,
      members: [{ user_id: MEMBER, role: "member" }],
      accessRules: [
        {
          phone_number_id: NUMBER_ID,
          principal_kind: "user",
          principal: MEMBER,
          level: "note",
        },
      ],
    });
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    const lookup = world.sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${MEMBER})`);
  });

  it("sends nothing when every eligible member is denied", async () => {
    const world = buildWorld({
      phoneNumberId: NUMBER_ID,
      members: [{ user_id: MEMBER, role: "member" }],
      accessRules: scopedToTrusted,
    });
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    expect(world.resend.calls).toHaveLength(0);
    expect(
      world.sb.calls.some((call) => call.path === "/rest/v1/push_subscriptions"),
    ).toBe(false);
  });
});

/**
 * #151 native device push: the FCM branch rides the same audience as the Web
 * Push one. Shapes/TTL/urgency live in fcm.test.ts; this asserts the wiring —
 * the truthful missed-call payload reaches every registered device.
 */
describe("notifyMissedCall — native device push (#151)", () => {
  it("skips the token query entirely when FCM is not configured", async () => {
    const world = buildWorld();
    stubFetch(...world.routes); // an unstubbed device_push_tokens GET would throw

    await notifyMissedCall(env, INPUT);
    expect(world.sb.find("GET", "/rest/v1/device_push_tokens")).toHaveLength(0);
  });

  it("sends the truthful missed-call payload to each registered device", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const world = buildWorld();
    world.sb.on("GET", "/rest/v1/device_push_tokens", () => [
      {
        id: "40000000-aaaa-4000-8000-000000000001",
        user_id: OWNER,
        platform: "android",
        token: "tok-a",
      },
      {
        id: "40000000-aaaa-4000-8000-000000000002",
        user_id: OWNER,
        platform: "ios",
        token: "tok-b",
      },
    ]);
    stubFetch(...world.routes, ...service.routes);

    await notifyMissedCall(fcmEnv(account), INPUT);

    // Audience-scoped, newest-first, #30-style bounded query.
    const lookup = world.sb.find("GET", "/rest/v1/device_push_tokens")[0];
    expect(lookup.url.searchParams.get("user_id")).toBe(`in.(${OWNER})`);
    expect(lookup.url.searchParams.get("limit")).toBe("50");

    expect(service.sends).toHaveLength(2);
    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.title).toBe("Missed call from Dana Smith");
    expect(data.body).toBe("We texted them so they can book by reply.");
    expect(data.url).toBe(`${env.APP_ORIGIN}/inbox/${CONVERSATION_ID}`);
    // #165: the NATIVE payload carries the structural discriminator so the
    // Android client routes it to its dedicated missed-calls channel.
    expect(data.kind).toBe("missed_call");

    // #162 iOS coalescing: missed-call alerts tag per conversation too — the
    // client contract keys them on `conversation:<id>` (PushPayload parity).
    const iosSend = service.sends.find(
      (send) => (send.message as { token: string }).token === "tok-b",
    );
    const headers = (
      iosSend?.message as { apns: { headers: Record<string, string> } }
    ).apns.headers;
    expect(headers["apns-collapse-id"]).toBe(`conversation:${CONVERSATION_ID}`);
  });

  it("keeps the Web Push payload kind-less (#165: discriminator is native-only)", async () => {
    // The Web Push body is aes128gcm-encrypted on the wire, so assert at the
    // seam both senders share: the FCM message is the web payload + kind and
    // nothing else — proving `kind` was ADDED for native, not moved into the
    // shared payload (which would change the service worker's input shape).
    const account = await makeServiceAccount();
    const service = fcmService();
    const world = buildWorld();
    world.sb.on("GET", "/rest/v1/device_push_tokens", () => [
      {
        id: "40000000-aaaa-4000-8000-000000000001",
        user_id: OWNER,
        platform: "android",
        token: "tok-a",
      },
    ]);
    stubFetch(...world.routes, ...service.routes);

    await notifyMissedCall(fcmEnv(account), INPUT);

    const data = service.sends[0].message.data as Record<string, string>;
    expect(Object.keys(data).sort()).toEqual(["body", "kind", "title", "url"]);
  });
});
