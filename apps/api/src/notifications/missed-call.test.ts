/**
 * Missed-call crew alert suite (email path). Mirrors the §8 inbound-message
 * pipeline: audience resolution and per-user prefs are shared primitives and
 * covered there, so this focuses on what missed-call.ts OWNS — the truthful
 * "we texted them" vs "call them back" copy, the recurring-alert opt-out
 * footer + List-Unsubscribe header, and HTML escaping of the contact name.
 * Only global fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("notifyMissedCall (email)", () => {
  it("emails the crew and carries the opt-out footer + List-Unsubscribe header", async () => {
    const world = buildWorld();
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    expect(world.resend.calls).toHaveLength(1);
    const email = world.resend.calls[0] as {
      to: string[];
      subject: string;
      text: string;
      html: string;
      headers?: Record<string, string>;
    };
    expect(email.to).toEqual([`${OWNER}@team.example`]);
    expect(email.subject).toBe("Missed call from Dana Smith");
    expect(email.text).toContain(
      "We sent them a text so they can book by reply.",
    );
    const settingsUrl = `${env.APP_ORIGIN}/settings/notifications`;
    expect(email.text).toContain(`Turn these alerts off: ${settingsUrl}`);
    // The opt-out link is present (styled by the #88 branded layout).
    expect(email.html).toContain(`href="${settingsUrl}"`);
    expect(email.html).toContain("Turn these alerts off");
    // The whole email is framed by the shared branded layout.
    expect(email.html).toContain("max-width:560px");
    expect(email.headers).toEqual({ "List-Unsubscribe": `<${settingsUrl}>` });
  });

  it("tells the crew to call back when the auto text did not go through", async () => {
    const world = buildWorld();
    stubFetch(...world.routes);

    await notifyMissedCall(env, { ...INPUT, textStatus: "failed" });

    const email = world.resend.calls[0] as { text: string };
    expect(email.text).toContain(
      "We tried to text them but the message didn't go through",
    );
    expect(email.text).not.toContain("We sent them a text");
  });

  it("never claims a text was tried when none was attempted (#132)", async () => {
    const world = buildWorld();
    stubFetch(...world.routes);

    await notifyMissedCall(env, { ...INPUT, textStatus: "none" });

    const email = world.resend.calls[0] as { text: string };
    expect(email.text).toContain(
      "They haven't been texted back — call them back when you can.",
    );
    expect(email.text).not.toContain("We sent them a text");
    expect(email.text).not.toContain("We tried to text them");
  });

  it("escapes an injected contact name in the email HTML", async () => {
    const world = buildWorld({ contactName: "Smith & Sons <Plumbing>" });
    stubFetch(...world.routes);

    await notifyMissedCall(env, INPUT);

    const email = world.resend.calls[0] as { subject: string; html: string };
    expect(email.html).toContain("Smith &amp; Sons &lt;Plumbing&gt;");
    expect(email.html).not.toContain("<Plumbing>");
    // The subject is a header value (not HTML), so it stays raw.
    expect(email.subject).toBe("Missed call from Smith & Sons <Plumbing>");
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

    expect(world.resend.calls).toHaveLength(1);
    const email = world.resend.calls[0] as { to: string[] };
    expect(email.to).toEqual([`${OWNER}@team.example`]);
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

    expect(world.resend.calls).toHaveLength(1);
    const email = world.resend.calls[0] as { to: string[] };
    expect(email.to).toEqual([`${MEMBER}@team.example`]);
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
  });
});
