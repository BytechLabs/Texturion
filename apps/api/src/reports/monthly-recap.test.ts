/**
 * #482 / #239 — the monthly recap.
 *
 * The copy IS the feature, and the way it fails is by drifting into
 * congratulation. So most of what is pinned here is what it must be willing to
 * say on a bad month, and what it must refuse to say at all.
 */
import { describe, expect, it } from "vitest";

import {
  MEANINGFUL_CHANGE_RATIO,
  RECAP_WINDOW_DAYS,
  recapDirection,
  recapText,
} from "./monthly-recap";

const base = {
  companyName: "Bright Spark Electrical",
  current: { leads: 40, answered: 38, unanswered: 2, median_seconds: 300 },
  baselineMedian: 900,
};

describe("recapDirection", () => {
  it("calls a real improvement an improvement", () => {
    expect(recapDirection(300, 900)).toBe("faster");
  });

  it("calls a real regression a regression", () => {
    // The guard that matters most. A recap that only ever congratulates is an
    // advertisement, and people stop reading advertisements.
    expect(recapDirection(900, 300)).toBe("slower");
  });

  it("refuses to dress a wobble as a change", () => {
    // Without a floor, a median that moved two seconds would be reported as an
    // improvement — noise dressed as an insight, and the fastest way to teach
    // somebody that this email means nothing.
    const baseline = 600;
    const wobble = baseline * (MEANINGFUL_CHANGE_RATIO / 2);
    expect(recapDirection(baseline - wobble, baseline)).toBe("steady");
    expect(recapDirection(baseline + wobble, baseline)).toBe("steady");
  });

  it("says NOTHING rather than steady when there is no arc", () => {
    // #239's rule: a workspace with no baseline does not get an invented one.
    // Null is distinct from "steady" because the caller sends no email at all
    // in this case — "we have nothing to say" and "nothing changed" are
    // different emails.
    expect(recapDirection(300, null)).toBeNull();
    expect(recapDirection(null, 900)).toBeNull();
    expect(recapDirection(null, null)).toBeNull();
    // A zero baseline would divide the threshold into nonsense.
    expect(recapDirection(300, 0)).toBeNull();
  });
});

describe("recapText", () => {
  it("leads with the number and the window", () => {
    const text = recapText(base);
    expect(text).toContain("Bright Spark Electrical");
    expect(text).toContain("5 min");
    expect(text).toContain(`last ${RECAP_WINDOW_DAYS} days`);
  });

  it("tells a crew that got SLOWER, in plain words", () => {
    const text = recapText({ ...base, current: { ...base.current, median_seconds: 1800 }, baselineMedian: 300 });
    expect(text).toContain("slower than when you started");
    // And without a scold. The owner knows their month was busy; what they
    // need is the number, not our opinion of it.
    for (const scold of ["should", "need to", "must", "unacceptable", "worse"]) {
      expect(text.toLowerCase(), `copy must not say "${scold}"`).not.toContain(scold);
    }
  });

  it("names the unanswered leak", () => {
    // A workspace can improve this median by ignoring more leads, so a recap
    // reporting only the median would reward exactly the behaviour it exists
    // to discourage.
    expect(recapText(base)).toContain("2 of 40 new customers never got an answer");
  });

  it("says nothing about the leak when there is none", () => {
    const text = recapText({
      ...base,
      current: { leads: 40, answered: 40, unanswered: 0, median_seconds: 300 },
    });
    expect(text).not.toContain("never got an answer");
  });

  it("counts one unanswered customer as a person", () => {
    const text = recapText({
      ...base,
      current: { leads: 1, answered: 0, unanswered: 1, median_seconds: 300 },
    });
    expect(text).toContain("1 of 1 new customer never got an answer");
    expect(text).not.toContain("1 customers");
  });

  it("always says how to stop receiving it", () => {
    // It is an unsolicited monthly send. An opt-out somebody has to hunt for
    // is an opt-out that becomes a spam report.
    expect(recapText(base)).toContain("Settings → Notifications");
  });

  it("carries no customer content", () => {
    // SPEC §10. Everything in this email is a count, a duration or the
    // workspace's own name — there is no path here to a message, a contact or
    // a number, and this pins that the shape stays that way.
    const text = recapText(base);
    expect(text).not.toMatch(/\+\d{7,}/);
    expect(text).not.toContain("@");
  });
});
