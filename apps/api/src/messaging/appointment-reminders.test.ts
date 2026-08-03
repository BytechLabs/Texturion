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
import { describe, expect, it } from "vitest";

import { planReminders, type ReminderRule } from "./appointment-reminders";

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
        { offset_minutes: 40320, body: "four weeks out", enabled: true },
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
