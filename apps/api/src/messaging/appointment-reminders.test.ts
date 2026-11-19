/**
 * #237 — which reminders a job gets, and when.
 *
 * `planReminders` is the whole of the timing decision, and the cases below are
 * the ones that put a text in front of a customer at the wrong moment. Each is
 * pure, so none of them needs a database — which is why the function takes
 * `now` and a renderer rather than reaching for either.
 *
 * The DST case is the one worth reading. It is tempting to think of "the day
 * before at 9am" and do calendar arithmetic in the customer's timezone; that is
 * how a Monday job's reminder lands on Saturday night when the clocks change.
 * An offset in minutes off an absolute instant has no such failure mode, and
 * the test below is what says this code took that route.
 */
import { copyFor } from "@loonext/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { planReminders, syncTaskReminders } from './appointment-reminders';
import type { ReminderRule } from './appointment-reminders';
import { resolveSendMergeFields } from "./merge";

const DAY_BEFORE: ReminderRule = {
  offset_minutes: 1440,
  body: "Reminder: booked for {job_day}.",
  enabled: true,
};
const TWO_HOURS: ReminderRule = {
  offset_minutes: 120,
  body: "On our way in about two hours.",
  enabled: true,
};

const render = (body: string) => body.replace("{job_day}", "Thursday");

describe(syncTaskReminders, () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { locale: null, expected: "mardi a 14 h", greeting: "Bonjour Jo" },
    { locale: "en", expected: "Tuesday at 2:00", greeting: "Hi Jo" },
  ])("uses the booked task and the stock reminder for $locale", async ({ locale, expected, greeting }) => {
    const env = completeEnv();
    const sb = supabaseStub(env);
    const taskId = "5e3f1a2b-7c4d-4e6f-8a9b-0c1d2e3f4a5b";
    const dueAt = "2026-12-01T19:00:00.000Z";
    const companyId = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
    sb.on("GET", "/rest/v1/tasks", ({ url }) => {
      const params = url.searchParams;
      if (params.get("select") === "due_at") {
        return [{ due_at: params.get("id") === `eq.${taskId}` ? dueAt : "2026-11-30T19:00:00Z" }];
      }
      return [{
        due_at: dueAt,
        reminders_off: false,
        conversation_id: "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a",
        companies: { name: "Acme", locale: "fr-CA" },
        conversations: { contact_phone_e164: "+14165550100", contacts: { name: "Jo", timezone: "America/Toronto", locale } },
      }];
    });
    sb.on("GET", "/rest/v1/companies", () => []);
    sb.on("GET", "/rest/v1/appointment_reminder_rules", () => [{
      ...copyFor("fr-CA").appointmentReminders[0], enabled: true,
    }]);
    sb.on("POST", "/rest/v1/rpc/api_sync_task_reminders", () => ({ outcome: "synced", added: 1 }));
    stubFetch(sb.route);

    await syncTaskReminders(getDb(env), {
      companyId,
      taskId,
      userId: "eedcc567-40cc-43a0-93fd-92914be593ec",
      now: new Date("2026-11-28T14:00:00Z"),
    });

    const lookup = sb.find("GET", "/rest/v1/tasks")[1].url.searchParams;
    expect(lookup.get("deleted_at")).toBe("is.null");
    expect(lookup.get("company_id")).toBe(`eq.${companyId}`);
    const args = sb.find("POST", "/rest/v1/rpc/api_sync_task_reminders")[0].body as { p_reminders: { body: string }[] };
    expect(args.p_reminders).toHaveLength(1);
    const reminder = args.p_reminders[0].body;
    expect(reminder).toContain(`${greeting},`);
    expect(reminder).toContain("Acme");
    expect(reminder).toContain(expected);
    expect(reminder).not.toMatch(/[\u00A0\u202F]/);
  });

  it("adds a date to the weekday when the visit is more than six days away", async () => {
    const env = completeEnv();
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/tasks", () => [{ due_at: "2026-12-08T19:00:00.000Z" }]);
    stubFetch(sb.route);

    const fields = await resolveSendMergeFields(getDb(env), "{job_day} at {job_time}", {
      companyId: "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d",
      conversationId: "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a",
      now: new Date("2026-11-28T14:00:00Z"),
    });

    expect(fields.jobDay).toContain("Tuesday");
    expect(fields.jobDay).toMatch(/\d/);
  });
});

describe("#237 planReminders", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  it("queues one reminder per enabled rule, at due minus the offset", () => {
    const dueAt = new Date("2026-08-06T14:00:00Z");
    const planned = planReminders({
      dueAt,
      rules: [DAY_BEFORE, TWO_HOURS],
      now,
      render,
    });

    expect(planned.map((p) => p.offset_minutes)).toEqual([1440, 120]);
    expect(planned[0].send_at).toBe("2026-08-05T14:00:00.000Z");
    expect(planned[1].send_at).toBe("2026-08-06T12:00:00.000Z");
    // Rendered here, not at fire time, so the thread strip shows what will go.
    expect(planned[0].body).toBe("Reminder: booked for Thursday.");
  });

  it("does not queue a reminder whose moment has already passed", () => {
    // A job booked for two hours from now must get the day-before reminder
    // NEVER — not late, and not immediately. Firing it on creation would text
    // somebody "booked for tomorrow" about an appointment happening today,
    // which is the most confusing possible version of this feature.
    const dueAt = new Date("2026-08-03T14:00:00Z"); // two hours away
    const planned = planReminders({
      dueAt,
      rules: [DAY_BEFORE, TWO_HOURS],
      now,
      render,
    });

    expect(planned.map((p) => p.offset_minutes)).toEqual([]);
  });

  it("keeps the offsets that are still ahead and drops the ones that are not", () => {
    const dueAt = new Date("2026-08-03T20:00:00Z"); // eight hours away
    const planned = planReminders({
      dueAt,
      rules: [DAY_BEFORE, TWO_HOURS],
      now,
      render,
    });

    expect(planned.map((p) => p.offset_minutes)).toEqual([120]);
  });

  it("queues nothing for a job with no date", () => {
    expect(
      planReminders({ dueAt: null, rules: [DAY_BEFORE], now, render }),
    ).toEqual([]);
  });

  it("queues nothing for a job already in the past", () => {
    expect(
      planReminders({
        dueAt: new Date("2026-08-01T09:00:00Z"),
        rules: [DAY_BEFORE, TWO_HOURS],
        now,
        render,
      }),
    ).toEqual([]);
  });

  it("skips a rule that is switched off, without losing the others", () => {
    const planned = planReminders({
      dueAt: new Date("2026-08-06T14:00:00Z"),
      rules: [{ ...DAY_BEFORE, enabled: false }, TWO_HOURS],
      now,
      render,
    });
    expect(planned.map((p) => p.offset_minutes)).toEqual([120]);
  });

  it("refuses an offset outside the window the column accepts", () => {
    // A rule the database would reject must not reach it as a queued row: the
    // insert would fail mid-sync and take the valid reminders with it.
    const planned = planReminders({
      dueAt: new Date("2026-09-30T14:00:00Z"),
      rules: [
        { offset_minutes: 5, body: "too close", enabled: true },
        { offset_minutes: 40_320, body: "four weeks out", enabled: true },
        TWO_HOURS,
      ],
      now,
      render,
    });
    expect(planned.map((p) => p.offset_minutes)).toEqual([120]);
  });

  it("measures the offset from the instant, so a DST change cannot move it", () => {
    // The US fall-back is 2026-11-01 at 06:00Z, when America/New_York goes
    // UTC-4 → UTC-5. The two instants have to STRADDLE that, which is fussier
    // than it looks: a job and its day-before reminder both sitting after the
    // change (say 9am Monday) are an hour apart in neither direction and prove
    // nothing. So the job is 8am EST on the Sunday itself, and its reminder
    // falls on the Saturday, still EDT.
    const dueAt = new Date("2026-11-01T13:00:00Z"); // 8am EST, after the change
    const planned = planReminders({
      dueAt,
      rules: [DAY_BEFORE],
      now: new Date("2026-10-25T12:00:00Z"),
      render,
    });

    const sent = new Date(planned[0].send_at);
    expect(dueAt.getTime() - sent.getTime()).toBe(1440 * 60_000);
    // ...and it really did straddle the change: the local hour differs by one
    // on either side, which is exactly the discrepancy a naive implementation
    // would have "corrected" into the wrong instant.
    const localHour = (at: Date) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(at);
    expect(Number(localHour(dueAt))).toBe(8);   // EST
    expect(Number(localHour(sent))).toBe(9);    // EDT, the day before
  });
});
