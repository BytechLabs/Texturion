import { describe, expect, it } from "vitest";

import {
  isOnCallNow,
  onCallSilenceWarning,
} from "./on-call-notifications";

const ME = "u-me";
const SOMEBODY = "u-else";

function shift(
  user_id: string,
  starts_at: string,
  ends_at: string,
): { user_id: string; starts_at: string; ends_at: string } {
  return { user_id, starts_at, ends_at };
}

/** Inside the shifts below. */
const NOW = new Date("2026-08-11T18:00:00Z");

describe("isOnCallNow (#538 audit)", () => {
  it("is true inside my own shift", () => {
    expect(
      isOnCallNow(
        [shift(ME, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")],
        ME,
        NOW,
      ),
    ).toBe(true);
  });

  it("is false for somebody else's shift", () => {
    // The warning is about the person holding the phone, not about the workspace
    // having a rota at all.
    expect(
      isOnCallNow(
        [shift(SOMEBODY, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")],
        ME,
        NOW,
      ),
    ).toBe(false);
  });

  it("is false before it starts and after it ends", () => {
    expect(
      isOnCallNow([shift(ME, "2026-08-11T19:00:00Z", "2026-08-12T00:00:00Z")], ME, NOW),
    ).toBe(false);
    expect(
      isOnCallNow([shift(ME, "2026-08-11T06:00:00Z", "2026-08-11T12:00:00Z")], ME, NOW),
    ).toBe(false);
  });

  it("treats the end as exclusive, so back-to-back shifts do not overlap", () => {
    // Two people handing over at 18:00 must not both count as on call for that
    // instant, or the handover minute warns the wrong person.
    const handover = new Date("2026-08-11T18:00:00Z");
    expect(
      isOnCallNow([shift(ME, "2026-08-11T12:00:00Z", "2026-08-11T18:00:00Z")], ME, handover),
    ).toBe(false);
    expect(
      isOnCallNow([shift(ME, "2026-08-11T18:00:00Z", "2026-08-12T00:00:00Z")], ME, handover),
    ).toBe(true);
  });

  it("ignores a shift with an unreadable stamp rather than assuming it covers now", () => {
    // A warning that fires wrongly is one people learn to dismiss, which costs more
    // than the one it was meant to prevent.
    expect(isOnCallNow([shift(ME, "not a date", "also not")], ME, NOW)).toBe(false);
  });

  it("is false with no shifts at all", () => {
    expect(isOnCallNow([], ME, NOW)).toBe(false);
  });
});

describe("onCallSilenceWarning (#538 audit)", () => {
  it("warns when somebody on call switches a channel off", () => {
    const warning = onCallSilenceWarning(true, true, "push")!;
    expect(warning).toContain("on call right now");
    // Says what is actually lost — the pages reach nothing — and that nobody else
    // finds out, which is the part that makes it a customer problem.
    expect(warning).toContain("go nowhere");
    expect(warning).toContain("no one else is told");
    // And offers the way out rather than only the objection.
    expect(warning).toContain("Hand the shift over");
  });

  it("names the channel being switched off", () => {
    expect(onCallSilenceWarning(true, true, "push")).toContain("Push alerts");
    expect(onCallSilenceWarning(true, true, "email")).toContain("Emails");
  });

  it("says nothing when I am not on call", () => {
    expect(onCallSilenceWarning(false, true, "push")).toBeNull();
  });

  it("says nothing when I am switching something ON", () => {
    // Turning notifications back on is the good outcome. A dialog there would be
    // punishing the fix.
    expect(onCallSilenceWarning(true, false, "push")).toBeNull();
  });
});
