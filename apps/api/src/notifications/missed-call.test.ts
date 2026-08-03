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
    assignedUserId?: string | null;
  } = {},
): World {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      id: CONVERSATION_ID,
      assigned_user_id: options.assignedUserId ?? null,
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
  // #480: the audience path asks the INVERSE resolver — every member of this
  // number's company with their level.
  //
  // The default is DERIVED from the same member list this world stubs, at full
  // use, which is what an un-ruled number means. Deriving it rather than naming
  // names keeps a fixture from describing one crew to the member query and a
  // different one to the resolver — the two disagreeing is how a test asserts
  // something nobody intended.
  sb.on("POST", "/rest/v1/rpc/number_member_levels", () =>
    options.accessRules ??
    (options.members ?? [{ user_id: OWNER, role: "owner" }]).map((member) => ({
      ...member,
      level: "text",
    })),
  );
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
    // #480: the INVERSE resolver answers per MEMBER, so the fixture names the
    // whole crew and their outcome — which makes the owner's standing override
    // visible rather than implied. An owner is never denied a number they
    // administer (#106: no self-lockout), so they stay in the audience.
    { user_id: OWNER, role: "owner", level: "text" },
    { user_id: MEMBER, role: "member", level: "none" },
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
        { user_id: MEMBER, role: "member", level: "note" },
      ],
    });
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    const lookup = world.sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${MEMBER})`);
  });

  it("falls back to the team when the assignee lost access to the number", async () => {
    // Access is revoked AFTER a thread is assigned, so an assignee can outlive
    // their own ability to see it. Singling them out first and filtering
    // second left the alert with an empty audience: nobody on the crew learned
    // a customer had called. Access decides who is eligible, THEN the assignee
    // is picked from that set.
    const world = buildWorld({
      phoneNumberId: NUMBER_ID,
      assignedUserId: MEMBER,
      members: [
        { user_id: OWNER, role: "owner" },
        { user_id: MEMBER, role: "member" },
      ],
      accessRules: scopedToTrusted,
    });
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    const lookup = world.sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${OWNER})`);
  });

  it("still alerts only the assignee when they can see the number", async () => {
    const world = buildWorld({
      phoneNumberId: NUMBER_ID,
      assignedUserId: TRUSTED,
      members: [
        { user_id: OWNER, role: "owner" },
        { user_id: TRUSTED, role: "member" },
      ],
      // TRUSTED is the one member the number is scoped to; the owner is never
      // denied a number they administer.
      accessRules: [
        { user_id: OWNER, role: "owner", level: "text" },
        { user_id: TRUSTED, role: "member", level: "text" },
      ],
    });
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    const lookup = world.sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${TRUSTED})`);
  });

  it("sends nothing when every eligible member is denied", async () => {
    const world = buildWorld({
      phoneNumberId: NUMBER_ID,
      members: [{ user_id: MEMBER, role: "member" }],
      // The only member of this crew is denied, so there is nobody to tell. Note
      // the resolver still ANSWERS — with one 'none' row — which is what
      // distinguishes "everybody is denied" from "the query broke".
      accessRules: [{ user_id: MEMBER, role: "member", level: "none" }],
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

    // Audience-scoped, newest-first, #30-style bounded query. The bound is ten
    // devices PER recipient (#267), so a one-person audience asks for ten.
    const lookup = world.sb.find("GET", "/rest/v1/device_push_tokens")[0];
    expect(lookup.url.searchParams.get("user_id")).toBe(`in.(${OWNER})`);
    expect(lookup.url.searchParams.get("limit")).toBe("10");

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

    // `tag` is the shared collapse identity every client coalesces on (#266);
    // `kind` is the only field the service worker must not see.
    const data = service.sends[0].message.data as Record<string, string>;
    expect(Object.keys(data).sort()).toEqual([
      "body",
      "kind",
      "tag",
      "title",
      "url",
    ]);
  });
});

/**
 * #244 — the issue's first acceptance criterion, end to end.
 *
 * "An after-hours missed call notifies the on-call member, not the whole crew."
 * The resolver has its own tests; what these two prove is that this fan-out is
 * actually WIRED to it, and that the wiring is inert during the working day.
 */
describe("notifyMissedCall — after-hours routing (#244)", () => {
  const TECH = "20000000-aaaa-4000-8000-000000000002";
  const THIRD = "30000000-aaaa-4000-8000-000000000003";
  const CREW = [
    { user_id: OWNER, role: "owner" },
    { user_id: TECH, role: "member" },
    { user_id: THIRD, role: "member" },
  ];
  const NINE_TO_FIVE = {
    mon: { open: "09:00", close: "17:00" },
    tue: { open: "09:00", close: "17:00" },
    wed: { open: "09:00", close: "17:00" },
    thu: { open: "09:00", close: "17:00" },
    fri: { open: "09:00", close: "17:00" },
  };

  function nightWorld(onCall: string | null) {
    const world = buildWorld({ members: CREW });
    world.sb.on("GET", "/rest/v1/companies", () => [
      {
        timezone: "America/Toronto",
        business_hours: NINE_TO_FIVE,
        business_hours_exceptions: null,
        on_call_escalate_after_minutes: 10,
      },
    ]);
    world.sb.on("POST", "/rest/v1/rpc/api_on_call_now", () => onCall);
    world.sb.on("POST", "/rest/v1/alert_escalations", () => [{ id: "alert-1" }]);
    world.sb.on("GET", "/rest/v1/device_push_tokens", () => []);
    return world;
  }

  it("wakes only the member holding the phone, and opens an escalation", async () => {
    const world = nightWorld(TECH);
    // 03:40Z on a Sunday = 23:40 Saturday in Toronto, which is the issue's own
    // example of the call that currently wakes four people.
    vi.setSystemTime(new Date("2026-08-02T03:40:00Z"));
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    const lookup = world.sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${TECH})`);

    // And the responsibility is recorded, because narrowing is only safe when
    // something can widen it back.
    const opened = world.sb.calls.find(
      (call) => call.path === "/rest/v1/alert_escalations",
    );
    expect((opened?.body as { on_call_user_id: string }).on_call_user_id).toBe(TECH);

    vi.useRealTimers();
  });

  it("leaves a Wednesday-morning miss reaching the whole crew", async () => {
    const world = nightWorld(TECH);
    vi.setSystemTime(new Date("2026-08-05T15:00:00Z"));
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    const lookup = world.sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    const targeted = lookup?.url.searchParams.get("user_id") ?? "";
    expect(targeted).toContain(OWNER);
    expect(targeted).toContain(THIRD);
    expect(
      world.sb.calls.some((call) => call.path === "/rest/v1/alert_escalations"),
    ).toBe(false);

    vi.useRealTimers();
  });
});
