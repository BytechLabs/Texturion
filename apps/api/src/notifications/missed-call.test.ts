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

function buildWorld(options: { contactName?: string | null } = {}): World {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/conversations", () => [
    {
      id: CONVERSATION_ID,
      assigned_user_id: null,
      contacts: {
        name: options.contactName === undefined ? "Dana Smith" : options.contactName,
        phone_e164: "+16135551000",
      },
    },
  ]);
  sb.on("GET", "/rest/v1/company_members", () => [{ user_id: OWNER }]);
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
