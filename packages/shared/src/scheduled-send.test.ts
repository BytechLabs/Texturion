/**
 * #233 — the parts of send later that are wrong silently.
 *
 * "Tomorrow 8am" landing at 7am is not an error anybody sees in a log. It is a
 * text arriving an hour before a customer is awake, twice a year, in one
 * timezone. So the DST cases are pinned with real instants rather than a
 * property nobody can check by reading.
 */
import { describe, expect, it } from "vitest";

import {
  SCHEDULED_HOLD_REASONS,
  SCHEDULED_MESSAGE_STATUSES,
  isScheduledMessageLive,
  schedulePresets,
  scheduledClockProvenance,
  scheduledReasonRecovers,
} from "./scheduled-send";

/** The local wall-clock hour of an instant, in a zone. */
function hourIn(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(instant),
  ) % 24;
}

function weekdayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    instant,
  );
}

describe("#233 presets land on the destination's wall clock", () => {
  it("means 8am where the customer is, not 8am here", () => {
    // Mid-afternoon UTC, which is still the morning in Los Angeles — the case
    // where "tomorrow" is ambiguous if you do the arithmetic in the wrong zone.
    const now = new Date("2026-06-15T21:00:00Z");
    const [tomorrow] = schedulePresets(now, "America/Los_Angeles");
    expect(tomorrow.at).not.toBeNull();
    expect(hourIn(tomorrow.at as Date, "America/Los_Angeles")).toBe(8);
  });

  it("is still 8am across the spring-forward boundary", () => {
    // 2026-03-08 is when US clocks jump 2am -> 3am. A fixed-offset
    // implementation returns 9am here and nobody notices until a customer does.
    const now = new Date("2026-03-07T12:00:00Z");
    const [tomorrow] = schedulePresets(now, "America/New_York");
    expect(hourIn(tomorrow.at as Date, "America/New_York")).toBe(8);
  });

  it("is still 8am across the fall-back boundary", () => {
    // 2026-11-01, clocks go back. The mirror of the case above, and the one
    // that produces a 7am text.
    const now = new Date("2026-10-31T12:00:00Z");
    const [tomorrow] = schedulePresets(now, "America/New_York");
    expect(hourIn(tomorrow.at as Date, "America/New_York")).toBe(8);
  });

  it("lands Monday on a Monday, in that zone", () => {
    const now = new Date("2026-06-17T15:00:00Z"); // a Wednesday
    const monday = schedulePresets(now, "America/New_York")[1];
    expect(weekdayIn(monday.at as Date, "America/New_York")).toBe("Mon");
    expect(hourIn(monday.at as Date, "America/New_York")).toBe(8);
  });

  it("means NEXT Monday when today is already Monday", () => {
    // Otherwise "Monday 8am" on a Monday afternoon is a time that has passed,
    // which the API would reject as in_the_past — a preset that cannot be used.
    const now = new Date("2026-06-15T18:00:00Z"); // Monday
    const monday = schedulePresets(now, "America/New_York")[1];
    expect(weekdayIn(monday.at as Date, "America/New_York")).toBe("Mon");
    expect((monday.at as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  it("never offers a preset that is already in the past", () => {
    // Every hour of one day, in a zone well behind UTC. A preset the API would
    // refuse is worse than no preset.
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 5, 15, hour));
      for (const preset of schedulePresets(now, "America/Los_Angeles")) {
        if (preset.at) expect(preset.at.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });

  it("offers two presets and a way out, in that order", () => {
    // Two, not five: a list long enough to read is slower than the picker it
    // replaced.
    const presets = schedulePresets(new Date("2026-06-15T12:00:00Z"), "UTC");
    expect(presets.map((p) => p.id)).toEqual(["tomorrow", "monday", "custom"]);
    expect(presets[2].at).toBeNull();
  });
});

describe("#233 what we tell somebody when it did not send", () => {
  it("has copy for every reason, and none of it is a code", () => {
    for (const [reason, copy] of Object.entries(SCHEDULED_HOLD_REASONS)) {
      expect(copy.length, `${reason} has no copy`).toBeGreaterThan(20);
      expect(copy, `${reason} reads like a code`).toMatch(/[a-z] [a-z]/);
      expect(copy.trim()).toBe(copy);
    }
  });

  it("does not promise a retry against something that will never change", () => {
    // The distinction that matters: a recoverable reason means the firing job
    // holds and tries again. Marking an opt-out recoverable would retry against
    // a STOP forever — and the copy would be promising to send a message that
    // must never go.
    expect(scheduledReasonRecovers("recipient_opted_out")).toBe(false);
    expect(scheduledReasonRecovers("invalid_destination")).toBe(false);
    expect(scheduledReasonRecovers("expired")).toBe(false);
    expect(scheduledReasonRecovers("workspace_closed")).toBe(false);

    expect(scheduledReasonRecovers("subscription_inactive")).toBe(true);
    expect(scheduledReasonRecovers("registration_pending")).toBe(true);
    expect(scheduledReasonRecovers("service_unavailable")).toBe(true);
    expect(scheduledReasonRecovers("customer_replied")).toBe(true);
  });

  it("offers no remedy for the one that has none", () => {
    // Binding: an opt-out can only be lifted by the customer. Copy that hinted
    // otherwise would be teaching an owner to try to work around a STOP.
    expect(SCHEDULED_HOLD_REASONS.recipient_opted_out).toMatch(/only they can/i);
  });

  it("classifies every status as live or done, with none missed", () => {
    const live = SCHEDULED_MESSAGE_STATUSES.filter(isScheduledMessageLive);
    expect([...live].sort()).toEqual(["held", "pending"]);
  });
});

describe("#233 whose clock it was", () => {
  it("admits the weakest rung is our own clock", () => {
    // Scheduling "Monday 8am" against a non-geographic number with no contact
    // override is the SHOP's 8am. A UI that hides that implies a precision the
    // product does not have.
    expect(scheduledClockProvenance("company")).toMatch(/we don't know theirs/);
    expect(scheduledClockProvenance("contact")).toMatch(/their time/);
    expect(scheduledClockProvenance("area_code")).toMatch(/area code/);
  });

  it("uses the same words as the thread's own time line", () => {
    // One vocabulary for one fact. `their-time.tsx` says "from their area code"
    // and "your workspace's timezone — we don't know theirs"; a second phrasing
    // here would be the product describing the same rung two ways.
    expect(scheduledClockProvenance("area_code")).toContain(
      "from their area code",
    );
    expect(scheduledClockProvenance("company")).toContain(
      "we don't know theirs",
    );
  });
});
