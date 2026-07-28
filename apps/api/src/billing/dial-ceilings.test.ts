/**
 * #448 — the ceiling on the one voice cost the spending cap cannot reach.
 *
 * The spending cap is denominated in SECONDS. A dial costs ~10c whatever
 * happens next, so a run of very short calls accrues almost nothing against
 * the cap and real money against us. These are the two lines that bound it.
 */
import { describe, expect, it } from "vitest";

import { UNIT_COST_CENTS } from "./costs";
import {
  DIAL_STOP_MULTIPLE,
  PLAN_VOICE_MINUTES,
  dialCeilings,
} from "./plans";

describe("the dial ceilings are derived, not invented", () => {
  it("sets the alert where dial fees match what capped minutes could cost us", () => {
    // starter at 1x: 2500 min x 1.2c = $30 of minute cost at the cap; at 10c
    // a dial that is 300 dials. The point of the derivation is that nobody
    // picks a number — the customer's own cap choice picks it.
    expect(dialCeilings("starter", 1).alertAt).toBe(300);
    expect(dialCeilings("pro", 1).alertAt).toBe(720);
  });

  it("scales both lines with the cap the customer chose", () => {
    // A tenant who raised their cap to 3x must not be alerted at a third of
    // the point where dialing actually stops.
    expect(dialCeilings("starter", 3).alertAt).toBe(900);
    expect(dialCeilings("starter", 3).stopAt).toBe(900 * DIAL_STOP_MULTIPLE);
  });

  it("stops well above the alert, because refusing a real call is worse", () => {
    const { alertAt, stopAt } = dialCeilings("starter", 1);
    expect(stopAt).toBe(alertAt * DIAL_STOP_MULTIPLE);
    // 1500 dials on a starter plan is fifty outbound calls a day, every day.
    // A crew cannot do that by hand; a loop can.
    expect(stopAt).toBe(1500);
  });

  it("fails toward the HARD ceiling on a garbage multiplier", () => {
    // Same posture as the minute cap: a null/NaN multiplier must never read
    // as "no cap", and must never read as the tightest cap either — that
    // would refuse calls for a broken column.
    for (const bad of [null, 0, -1, Number.NaN, "not a number"]) {
      expect(dialCeilings("starter", bad as never).alertAt).toBe(
        dialCeilings("starter", 10).alertAt,
      );
    }
    // ...and a multiplier past the hard maximum is clamped to it.
    expect(dialCeilings("starter", 99).alertAt).toBe(
      dialCeilings("starter", 10).alertAt,
    );
  });

  it("never returns a zero ceiling", () => {
    // A ceiling of 0 would refuse the FIRST call of the period.
    for (const plan of ["starter", "pro"] as const) {
      expect(dialCeilings(plan, 1).alertAt).toBeGreaterThan(0);
    }
  });

  it("still matches the cost model it was derived from", () => {
    // plans.ts inlines 1.2c and 10c to stay dependency-free. If either unit
    // cost moves in costs.ts, this fails rather than letting the ceiling
    // quietly stop meaning what its comment says it means.
    expect(UNIT_COST_CENTS.voiceMinute).toBe(1.2);
    expect(UNIT_COST_CENTS.voiceTransfer).toBe(10);
    for (const plan of ["starter", "pro"] as const) {
      const expected = Math.floor(
        (PLAN_VOICE_MINUTES[plan] * UNIT_COST_CENTS.voiceMinute) /
          UNIT_COST_CENTS.voiceTransfer,
      );
      expect(dialCeilings(plan, 1).alertAt).toBe(expected);
    }
  });
});
