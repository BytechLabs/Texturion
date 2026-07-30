/**
 * #388 — the unanswered-lead ladder, from the Worker's side.
 *
 * The deadline arithmetic, the exactly-once claim and the anti-klaxon rules
 * live in SQL and are covered by supabase/tests/lead_response_clock.test.sql.
 * What this suite owns is everything the RPC cannot decide:
 *
 *   - business hours, which is a HARD gate and the one whose failure is a
 *     customer's phone going off at 2am;
 *   - that a row the hours gate drops is NOT claimed, so its rung survives to
 *     be sent when the shop opens rather than being silently burnt at 08:59;
 *   - the audience rule per rung;
 *   - push-only, so the ladder can never spend the #343 email budget;
 *   - notification_prefs, which the ladder must not route around.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { inBusinessHours, runLeadChaseJob } from "./lead-chase";

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const OWNER = "10000000-aaaa-4000-8000-000000000001";
const TECH = "20000000-aaaa-4000-8000-000000000002";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Mon 2026-07-27 14:00 UTC = 10:00 in Toronto — squarely inside 9–17. */
const OPEN = new Date("2026-07-27T14:00:00Z");
/** Same Monday, 06:00 UTC = 02:00 in Toronto. */
const CLOSED = new Date("2026-07-27T06:00:00Z");

// Three-letter keys, which is what BusinessHours actually uses. Spelling them
// out ("monday") makes isValidBusinessHours reject the whole map, and this
// module reads a rejected map as "no hours configured" — i.e. always open. A
// fixture with the wrong key names would pass every assertion for the wrong
// reason and prove nothing about the gate.
const NINE_TO_FIVE = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
};

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    company_id: COMPANY_ID,
    assigned_user_id: null,
    phone_number_id: null,
    contact_name: "Dana Smith",
    contact_phone: "+16135551000",
    awaiting_since: "2026-07-27T13:55:00Z",
    from_level: 0,
    to_level: 1,
    timezone: "America/Toronto",
    business_hours: NINE_TO_FIVE,
    ...overrides,
  };
}

interface World {
  sb: SupabaseStub;
  claims: Record<string, unknown>[];
  pushes: Record<string, unknown>[];
  resend: Record<string, unknown>[];
  routes: FetchRoute[];
}

function buildWorld(
  due: Record<string, unknown>[],
  options: { members?: { user_id: string; role: string }[]; prefs?: unknown[] } = {},
): World {
  const sb = supabaseStub(env);
  const claims: Record<string, unknown>[] = [];

  sb.on("POST", "/rest/v1/rpc/api_due_lead_chases", () => due);
  sb.on("POST", "/rest/v1/rpc/api_claim_lead_chases", (call) => {
    const body = call.body as { p_conversation_ids: string[] };
    claims.push(call.body as Record<string, unknown>);
    // The happy path: everything offered is claimed.
    return body.p_conversation_ids;
  });
  sb.on("GET", "/rest/v1/company_members", () =>
    options.members ?? [
      { user_id: OWNER, role: "owner" },
      { user_id: TECH, role: "member" },
    ],
  );
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  sb.on("GET", "/rest/v1/notification_prefs", () => options.prefs ?? []);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);

  const pushes: Record<string, unknown>[] = [];
  const resend: Record<string, unknown>[] = [];
  const extra: FetchRoute = async (url, request) => {
    if (url.href === "https://api.resend.com/emails") {
      resend.push((await request.clone().json()) as Record<string, unknown>);
      return Response.json({ id: "email_1" });
    }
    if (url.hostname.endsWith("googleapis.com")) {
      pushes.push((await request.clone().json()) as Record<string, unknown>);
      return Response.json({ name: "sent" });
    }
    return undefined;
  };

  return { sb, claims, pushes, resend, routes: [sb.route, extra] };
}

describe("business hours are a hard gate", () => {
  it("does not chase outside the company's hours", async () => {
    // Escalating a 2am text to five phones would be indefensible, and the
    // after-hours auto-reply already answers that case honestly.
    const world = buildWorld([dueRow()]);
    stubFetch(...world.routes);

    const result = await runLeadChaseJob(env, CLOSED);

    expect(result).toEqual({ sent: 0, skipped: 1 });
  });

  it("does NOT claim a rung it is not going to send", async () => {
    // The rung has to survive the night. Claiming before the hours filter
    // would advance chase_level for a notification nobody received, so the
    // 09:00 lead would silently skip straight past rung 1 — a feature that
    // looks like it ran and did nothing, which is the #387 failure shape.
    const world = buildWorld([dueRow()]);
    stubFetch(...world.routes);

    await runLeadChaseJob(env, CLOSED);

    expect(world.claims).toHaveLength(0);
  });

  it("chases inside them", async () => {
    const world = buildWorld([dueRow()]);
    stubFetch(...world.routes);

    const result = await runLeadChaseJob(env, OPEN);

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(world.claims).toHaveLength(1);
  });

  it("treats a company that never set hours as always open", async () => {
    // `{}` reads as closed-every-day to isAfterHours, which is right for the
    // away reply (no hours configured → no after-hours rule to apply) and
    // would be catastrophic here: it would silently disable the ladder for
    // every workspace that skipped the setting, which is most of them.
    expect(inBusinessHours(dueRow({ business_hours: {} }) as never, CLOSED)).toBe(true);
    expect(inBusinessHours(dueRow({ business_hours: null }) as never, CLOSED)).toBe(true);
  });

  it("reads the hours in the COMPANY's timezone, not the server's", async () => {
    // 14:00 UTC is 07:00 in Vancouver — before a 9-to-5 opens, while the same
    // instant is mid-morning in Toronto. A server-local reading would chase
    // two hours before the crew is awake.
    expect(inBusinessHours(dueRow({ timezone: "America/Vancouver" }) as never, OPEN)).toBe(
      false,
    );
    expect(inBusinessHours(dueRow() as never, OPEN)).toBe(true);
  });
});

describe("who hears about it", () => {
  it("widens to everyone who can see the thread", async () => {
    // The entire purpose of the surviving rung (#463): the assignee has
    // demonstrably not got to it, so the only remaining move is to ask
    // somebody else. It fires from level 0 now — there is no longer a
    // two-minute nudge for it to be a child of.
    const world = buildWorld([dueRow({ assigned_user_id: TECH, from_level: 0, to_level: 2 })]);
    stubFetch(...world.routes);

    await runLeadChaseJob(env, OPEN);

    const prefLookup = world.sb.calls.find((call) =>
      call.path.startsWith("/rest/v1/notification_prefs"),
    );
    expect(prefLookup?.url.href).toContain(TECH);
    expect(prefLookup?.url.href).toContain(OWNER);
  });

  it("never routes around a member who turned push off", async () => {
    // A ladder that ignores the preference is not a feature within the
    // notification system, it is a way around it — and the member who muted
    // us cannot mute us again.
    const world = buildWorld([dueRow()], {
      prefs: [
        { user_id: OWNER, push_enabled: false },
        { user_id: TECH, push_enabled: false },
      ],
    });
    stubFetch(...world.routes);

    const result = await runLeadChaseJob(env, OPEN);

    expect(result.sent).toBe(1); // the rung was spent
    expect(world.pushes).toHaveLength(0); // and reached nobody who said no
  });
});

describe("push only", () => {
  it("sends no email at any rung", async () => {
    // Email is the slow channel and this feature exists because of a
    // five-minute window. Keeping the ladder off email also keeps it outside
    // the #343 daily budget, so chasing a lead can never spend a workspace's
    // Resend allowance on the least useful copy it sends all day.
    const world = buildWorld([
      dueRow({ assigned_user_id: TECH, from_level: 0, to_level: 2 }),
    ]);
    stubFetch(...world.routes);

    await runLeadChaseJob(env, OPEN);

    expect(world.resend).toHaveLength(0);
  });
});

describe("claiming", () => {
  it("sends nothing for a conversation the claim did not return", async () => {
    // Another run took the rung, or the crew replied in the milliseconds
    // between the scan and the update — which is the outcome the whole
    // feature wanted, and must not be followed by "nobody has replied".
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_due_lead_chases", () => [dueRow()]);
    sb.on("POST", "/rest/v1/rpc/api_claim_lead_chases", () => []);
    sb.on("GET", "/rest/v1/company_members", () => [{ user_id: OWNER, role: "owner" }]);
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    sb.on("GET", "/rest/v1/notification_prefs", () => []);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    stubFetch(sb.route);

    const result = await runLeadChaseJob(env, OPEN);

    expect(result.sent).toBe(0);
    expect(
      sb.calls.filter((call) => call.path.startsWith("/rest/v1/notification_prefs")),
    ).toHaveLength(0);
  });

  it("claims on the level it advances FROM, which is now only zero", async () => {
    // #463 left one rung, and the claim is still a conditional update keyed on
    // the level being advanced from — that is what makes two concurrent runs
    // send one push rather than two.
    const world = buildWorld([
      dueRow({ assigned_user_id: TECH, from_level: 0, to_level: 2 }),
    ]);
    stubFetch(...world.routes);

    await runLeadChaseJob(env, OPEN);

    expect(world.claims.map((claim) => claim.p_from_level)).toEqual([0]);
  });

  it("does nothing at all when no clock is due", async () => {
    const world = buildWorld([]);
    stubFetch(...world.routes);

    expect(await runLeadChaseJob(env, OPEN)).toEqual({ sent: 0, skipped: 0 });
    expect(world.claims).toHaveLength(0);
  });
});
