/**
 * #244 — the routing decision, which is the one that decides whether a phone
 * rings at 2am.
 *
 * Every test here is a case where narrowing would be WRONG, plus the one case
 * where it is right. That balance is deliberate: the damage from narrowing
 * incorrectly is a customer nobody called back, and it is silent — the crew
 * cannot notice a notification that never arrived. The damage from failing to
 * narrow is a bad night somebody complains about immediately.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { routeAfterHoursAlert } from "./on-call";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ON_CALL = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const THIRD = "55555555-5555-4555-8555-555555555555";

/** Mon–Fri 09:00–17:00 in Toronto. */
const NINE_TO_FIVE = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
};

/** A Saturday at 23:40 Toronto — the issue's own example. */
const SATURDAY_NIGHT = new Date("2026-08-02T03:40:00Z");
/** A Wednesday at 11:00 Toronto. */
const WEDNESDAY_MIDDAY = new Date("2026-08-05T15:00:00Z");

interface Options {
  timezone?: string | null;
  businessHours?: Record<string, { open: string; close: string }> | null;
  escalateAfter?: number;
  onCall?: string | null;
}

function world(options: Options = {}) {
  const env = completeEnv();
  const sb = supabaseStub(env);

  sb.on("GET", "/rest/v1/companies", () => [
    {
      timezone: options.timezone === undefined ? "America/Toronto" : options.timezone,
      business_hours:
        options.businessHours === undefined ? NINE_TO_FIVE : options.businessHours,
      business_hours_exceptions: null,
      on_call_escalate_after_minutes: options.escalateAfter ?? 10,
    },
  ]);
  sb.on("POST", "/rest/v1/rpc/api_on_call_now", () => options.onCall ?? null);
  sb.on("POST", "/rest/v1/alert_escalations", () => [{ id: "alert-1" }]);

  stubFetch(sb.route);
  return { sb, db: getDb(env) };
}

const CREW = [ON_CALL, OTHER, THIRD];

function route(db: ReturnType<typeof getDb>, now: Date, audience = CREW) {
  return routeAfterHoursAlert(db, {
    companyId: COMPANY,
    conversationId: CONVERSATION,
    phoneNumberId: null,
    kind: "missed_call",
    audience,
    now,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routeAfterHoursAlert", () => {
  it("OC-A: a Saturday night call goes to the one person holding the phone", async () => {
    const { db } = world({ onCall: ON_CALL });

    const result = await route(db, SATURDAY_NIGHT);

    expect(result.userIds).toEqual([ON_CALL]);
    expect(result.reason).toBe("narrowed");
    // The alert id rides along so the push can carry an Acknowledge action —
    // without it the notification is just quieter, not answerable.
    expect(result.alertId).toBe("alert-1");
  });

  it("OC-B: during working hours the whole crew still sees it", async () => {
    // Not an oversight. In the middle of a Wednesday, four people seeing a
    // missed call is coverage rather than noise, and narrowing it would make
    // the product worse at the time of day it is used most.
    const { db } = world({ onCall: ON_CALL });

    const result = await route(db, WEDNESDAY_MIDDAY);

    expect(result.userIds).toEqual(CREW);
    expect(result.reason).toBe("within_hours");
    expect(result.alertId).toBeNull();
  });

  it("OC-C: nobody on call means everybody, exactly as before", async () => {
    // The commonest state in the product: most crews will never set a shift.
    // This feature must be invisible to them.
    const { db } = world({ onCall: null });

    const result = await route(db, SATURDAY_NIGHT);

    expect(result.userIds).toEqual(CREW);
    expect(result.reason).toBe("nobody_on_call");
  });

  it("OC-D: an on-call member who cannot see the thread does not get it alone", async () => {
    // #106: on call for the workspace is not access to this number. Paging
    // somebody who opens the app to a permission error is worse than waking
    // the team — they cannot act, and now nobody else knows.
    const { db } = world({ onCall: "99999999-9999-4999-8999-999999999999" });

    const result = await route(db, SATURDAY_NIGHT);

    expect(result.userIds).toEqual(CREW);
    expect(result.reason).toBe("on_call_cannot_see_thread");
  });

  it("OC-E: an unknown clock wakes everybody", async () => {
    // We cannot claim it is night, so we do not get to decide somebody should
    // sleep through this. Both halves: no timezone, and no configured hours.
    const noZone = world({ timezone: null, onCall: ON_CALL });
    expect((await route(noZone.db, SATURDAY_NIGHT)).reason).toBe("unknown_clock");

    const noHours = world({ businessHours: null, onCall: ON_CALL });
    expect((await route(noHours.db, SATURDAY_NIGHT)).reason).toBe("unknown_clock");
  });

  it("OC-F: zero minutes means tell everybody at once, not page then page again", async () => {
    // A legitimate setting for a crew of two. Honoured by not narrowing at all
    // — narrowing and immediately widening would page the on-call member twice
    // for one call.
    const { sb, db } = world({ onCall: ON_CALL, escalateAfter: 0 });

    const result = await route(db, SATURDAY_NIGHT);

    expect(result.userIds).toEqual(CREW);
    expect(result.reason).toBe("escalates_immediately");
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/alert_escalations"),
    ).toBe(false);
  });

  it("OC-G: a crew of one is never narrowed, and never asks", async () => {
    // There is nobody to protect from the noise and nobody to widen to. Worth
    // its own branch because it is the shape of most new workspaces, and a
    // lookup per missed call for a question with one possible answer is pure
    // cost.
    const { sb, db } = world({ onCall: ON_CALL });

    const result = await route(db, SATURDAY_NIGHT, [ON_CALL]);

    expect(result.userIds).toEqual([ON_CALL]);
    expect(sb.calls).toHaveLength(0);
  });

  it("OC-H: the escalation deadline is the workspace's own number", async () => {
    const { sb, db } = world({ onCall: ON_CALL, escalateAfter: 25 });

    await route(db, SATURDAY_NIGHT);

    const insert = sb.calls.find(
      (call) => call.path === "/rest/v1/alert_escalations",
    );
    const body = insert?.body as { escalate_at: string; kind: string };
    expect(new Date(body.escalate_at).getTime()).toBe(
      SATURDAY_NIGHT.getTime() + 25 * 60_000,
    );
    // The kind travels with it, so the sweep's widening push can say what it
    // is widening about rather than "something happened earlier".
    expect(body.kind).toBe("missed_call");
  });
});
