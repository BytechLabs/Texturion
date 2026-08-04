/**
 * #278 — what an inbound call does outside business hours.
 *
 * AH-R1 is the deploy-day guarantee and the one that matters most. Every
 * workspace in production is `ring_everyone` the moment this ships, and #278's
 * own devil's-advocate section is why: a badly-built phone tree makes a small
 * business sound like a call centre, which is the opposite of what our
 * customers buy from us. So this must be inert until somebody asks for it,
 * whatever their hours say.
 *
 * AH-R5 is the second. Every uncertainty widens — an unknown clock, a failed
 * on-call read, an on-call member nobody can reach — because the two mistakes
 * are not symmetrical: ringing four phones that did not need it is a bad
 * night, and ringing nobody is a customer who calls a competitor and a
 * business that never learns why. That is #244's rule, applied to the call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { createSessionRuntime } from "./runtime";

const env: Env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NUMBER_ID = "11111111-1111-4111-8111-111111111111";
const ALICE = "aaaaaaaa-1111-4111-8111-000000000001";
const BOB = "bbbbbbbb-1111-4111-8111-000000000002";

/** Weekdays 8–5, Toronto. Nothing on Saturday or Sunday. */
const NINE_TO_FIVE = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
  wed: { open: "08:00", close: "17:00" },
  thu: { open: "08:00", close: "17:00" },
  fri: { open: "08:00", close: "17:00" },
};

interface World {
  /** null = the column is unset, i.e. inherit / never configured. */
  afterHoursCalls?: string | null;
  businessHours?: unknown;
  timezone?: string | null;
  /** What api_on_call_now answers. null = nobody is holding the phone. */
  onCall?: string | null;
  /** Make the on-call RPC fail, which must widen rather than narrow. */
  onCallFails?: boolean;
  /** Members who hold a telephony credential and can be rung. */
  crew?: string[];
}

function world(w: World) {
  const crew = w.crew ?? [ALICE, BOB];
  return stubRoute(
    () => true,
    (call) => {
      const path = call.url.pathname;
      if (path.includes("/rpc/api_on_call_now")) {
        return w.onCallFails
          ? Response.json({ message: "on-call read failed" }, { status: 500 })
          : Response.json(w.onCall ?? null);
      }
      if (path.includes("/rpc/number_member_levels")) {
        return Response.json(crew.map((user_id) => ({ user_id, level: "text" })));
      }
      if (path.includes("/rpc/api_claim_inbound_line")) return Response.json(false);
      if (path.includes("/rpc/")) return Response.json(null);
      if (path.includes("/phone_numbers")) {
        return Response.json([
          {
            id: NUMBER_ID,
            company_id: COMPANY_ID,
            status: "active",
            label: null,
            voicemail_greeting: null,
            timezone: null,
            business_hours: null,
            business_hours_exceptions: null,
            after_hours_calls: null,
            after_hours_greeting_id: null,
          },
        ]);
      }
      if (path.includes("/companies")) {
        return Response.json([
          {
            id: COMPANY_ID,
            name: "Reed Roofing",
            voicemail_greeting: null,
            call_screening: "off",
            subscription_status: "active",
            timezone: w.timezone === undefined ? "America/Toronto" : w.timezone,
            business_hours:
              w.businessHours === undefined ? NINE_TO_FIVE : w.businessHours,
            business_hours_exceptions: null,
            after_hours_calls: w.afterHoursCalls ?? "ring_everyone",
            after_hours_greeting_id: null,
          },
        ]);
      }
      if (path.includes("/member_telephony_credentials")) {
        return Response.json(
          crew.map((user_id) => ({ user_id, sip_username: `sip-${user_id}` })),
        );
      }
      if (path.includes("/company_members")) {
        return Response.json(
          crew.map((user_id) => ({ user_id, role: "member" })),
        );
      }
      if (path.includes("/push_subscriptions")) {
        return Response.json(crew.map((user_id) => ({ user_id })));
      }
      if (path.includes("/device_push_tokens")) return Response.json([]);
      if (path.includes("/notification_prefs")) {
        return Response.json(
          crew.map((user_id) => ({ user_id, push_enabled: true })),
        );
      }
      if (path.includes("/calls")) return Response.json([]);
      return Response.json([]);
    },
  );
}

/** Two instants in July, company-local Toronto (UTC-4 in summer). */
const EVENING = new Date(Date.UTC(2026, 6, 15, 1, 0)); // 21:00 Tue 14 — closed
const MIDDAY = new Date(Date.UTC(2026, 6, 15, 14, 0)); // 10:00 Wed 15 — open

async function contextAt(at: Date, w: World) {
  vi.useFakeTimers();
  vi.setSystemTime(at);
  try {
    stubFetch(world(w).route);
    const rt = createSessionRuntime(env);
    const ctx = await rt.loadInitiatedContext({
      call_session_id: "sess-278",
      call_control_id: "ccid-278",
      from: "+14155559001",
      to: "+14155550001",
    } as never);
    if (typeof ctx === "string") throw new Error(`expected a context, got ${ctx}`);
    return ctx;
  } finally {
    vi.useRealTimers();
  }
}

describe("#278 after-hours call routing", () => {
  it("AH-R1: a workspace that never asked rings exactly as it always did", async () => {
    // THE DEPLOY-DAY GUARANTEE. Hours are set, it IS after hours, and nothing
    // changes — because `ring_everyone` is what every existing row says.
    const ctx = await contextAt(EVENING, { afterHoursCalls: "ring_everyone" });
    expect(ctx.afterHours).toBe(true);
    expect(ctx.afterHoursVoicemail).toBe(false);
    expect(ctx.dialTargets.map((t) => t.userId).sort()).toEqual([ALICE, BOB].sort());
    expect(ctx.pushAudience.sort()).toEqual([ALICE, BOB].sort());
  });

  it("AH-R2: inside hours, nothing is narrowed whatever the setting says", async () => {
    // The whole crew seeing a call during the working day is coverage, not
    // noise. The problem this feature solves is specifically 9pm.
    const ctx = await contextAt(MIDDAY, {
      afterHoursCalls: "voicemail",
      onCall: ALICE,
    });
    expect(ctx.afterHours).toBe(false);
    expect(ctx.afterHoursVoicemail).toBe(false);
    expect(ctx.dialTargets).toHaveLength(2);
  });

  it("AH-R3: after hours, only the person holding the phone rings", async () => {
    // #278's emergency path, and the reason it lives INSIDE the routing
    // options rather than beside them: hours-based routing with no hole in it
    // is how a 3am burst pipe reaches nobody.
    const ctx = await contextAt(EVENING, {
      afterHoursCalls: "on_call_only",
      onCall: ALICE,
    });
    expect(ctx.dialTargets.map((t) => t.userId)).toEqual([ALICE]);
    expect(ctx.pushAudience).toEqual([ALICE]);
    // And it is still a ring — nobody was sent to voicemail.
    expect(ctx.afterHoursVoicemail).toBe(false);
  });

  it("AH-R4: with nobody on call, the two settings finally differ", async () => {
    // This is the ONLY case where `on_call_only` and `voicemail` disagree, and
    // it is the whole difference between them: one wakes the crew anyway, the
    // other takes a message.
    const ringing = await contextAt(EVENING, {
      afterHoursCalls: "on_call_only",
      onCall: null,
    });
    expect(ringing.afterHoursVoicemail).toBe(false);
    expect(ringing.dialTargets).toHaveLength(2);

    const message = await contextAt(EVENING, {
      afterHoursCalls: "voicemail",
      onCall: null,
    });
    expect(message.afterHoursVoicemail).toBe(true);
  });

  it("AH-R5: every uncertainty rings the whole crew", async () => {
    // THE ONE THAT MATTERS. Ringing four phones that did not need it is a bad
    // night; ringing nobody is a customer who calls a competitor, and it is a
    // failure only they ever find out about. So each of these widens.

    // No hours configured — which is most workspaces, on day one.
    const noHours = await contextAt(EVENING, {
      afterHoursCalls: "voicemail",
      businessHours: null,
      onCall: null,
    });
    expect(noHours.afterHours).toBe(false);
    expect(noHours.afterHoursVoicemail).toBe(false);
    expect(noHours.dialTargets).toHaveLength(2);

    // A timezone we cannot place: we do not get to decide it is night.
    const noZone = await contextAt(EVENING, {
      afterHoursCalls: "voicemail",
      timezone: null,
      onCall: null,
    });
    expect(noZone.afterHours).toBe(false);
    expect(noZone.dialTargets).toHaveLength(2);

    // The on-call read failed. Narrowing a live call on a lookup that did not
    // work is the one thing this must never do — and note it does NOT fall to
    // voicemail either, because a failed read says nothing about whether
    // somebody is holding the phone.
    const readFailed = await contextAt(EVENING, {
      afterHoursCalls: "voicemail",
      onCallFails: true,
    });
    expect(readFailed.dialTargets).toHaveLength(2);
    expect(readFailed.afterHoursVoicemail).toBe(true);
  });

  it("AH-R6: an on-call member nobody can reach does not silence the call", async () => {
    // The shift names somebody who holds no credential and no push channel —
    // a member who has never opened the app. Narrowing to them would ring
    // nothing at all and dump the caller into voicemail on the strength of a
    // roster entry, so the crew rings instead.
    const ctx = await contextAt(EVENING, {
      afterHoursCalls: "on_call_only",
      onCall: "cccccccc-1111-4111-8111-000000000003",
    });
    expect(ctx.dialTargets).toHaveLength(2);
    expect(ctx.pushAudience).toHaveLength(2);
  });

  it("AH-R7: the caller is told when, and only in OUR words", async () => {
    // #518 settled that a sentence of ours appended to an owner's greeting —
    // in our voice, on every call — is not an improvement anybody asked for.
    // So the timing only ever reaches the DEFAULT greeting, which exists
    // because the workspace never wrote one.
    const rt = createSessionRuntime(env);
    const base = {
      companyName: "Reed Roofing",
      greeting: null,
      afterHours: true,
      nextOpenLabel: "tomorrow at 8am",
    };
    const spoken = rt.greetingText(base as never);
    expect(spoken).toContain("closed right now");
    expect(spoken).toContain("tomorrow at 8am");

    // No honest answer available: the sentence is simply absent, never a
    // guess. A caller told "back Monday at 8" who rings on Monday at 8 and
    // gets voicemail again has been lied to by a machine.
    const noWhen = rt.greetingText({ ...base, nextOpenLabel: null } as never);
    expect(noWhen).toContain("closed right now");
    expect(noWhen).not.toContain("we're back");

    // And an owner's own words are theirs, after hours or not.
    const own = rt.greetingText({
      ...base,
      greeting: "Reed Roofing. Leave a message.",
    } as never);
    expect(own).toBe("Reed Roofing. Leave a message.");
  });
});
