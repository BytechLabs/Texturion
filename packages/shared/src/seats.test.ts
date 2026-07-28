/**
 * #392 — the canonical seat cases.
 *
 * THIS TABLE IS THE FIXTURE all four surfaces are pinned against. The API and
 * web import `seatUsage` from this package, so they cannot disagree. Android
 * and iOS hand-port the function, so they hand-port THIS TABLE too, case for
 * case, and fail loudly when they drift:
 *
 *   apps/android/.../features/settings/SettingsLogicTest.kt
 *   apps/ios/LoonextTests/SettingsLogicTests.swift
 *
 * Adding a case here means adding it there. That is the deal, and it is the
 * same one `mentions.test.ts` / `MentionLogicTest.kt` / `MentionLogicTests.swift`
 * already keep.
 *
 * Why this matters more than ordinary duplication: the seat ceiling IS the
 * Starter-to-Pro upgrade trigger, and it has already moved twice. A drifted
 * copy does not degrade a feature, it misprices the product on one platform —
 * and in the direction that shows an owner room the API will refuse, it does
 * so at the exact moment they are trying to add a person.
 */
import { describe, expect, it } from "vitest";

import { PLAN_SEATS, canUpgradeSeats, seatLimit, seatUsage } from "./seats";

/** [members, invites, plan, servedLimit, used, limit, full, canUpgrade, line] */
export const SEAT_CASES = [
  // Room to grow on each plan.
  [1, 0, "starter", null, 1, 3, false, false, "1 of 3 seats"],
  [2, 0, "pro", null, 2, 15, false, false, "2 of 15 seats"],
  // A pending invite holds a seat — the case that stops two invites
  // oversubscribing a plan the moment both are accepted.
  [2, 1, "starter", null, 3, 3, true, true, "3 of 3 seats. Upgrade for more"],
  // At capacity on Starter: the nudge, and the CTA behind it.
  [3, 0, "starter", null, 3, 3, true, true, "3 of 3 seats. Upgrade for more"],
  // At capacity on Pro: NO nudge. Unlimited seats are the contact-sales tier,
  // not a button, so pointing at an upgrade path that does not exist would be
  // a dead end dressed as an offer.
  [15, 0, "pro", null, 15, 15, true, false, "15 of 15 seats"],
  // No plan yet reads as Starter, so a team can be assembled before payment
  // without exceeding what the smallest plan permits.
  [3, 0, null, null, 3, 3, true, true, "3 of 3 seats. Upgrade for more"],
  // Over capacity (a plan downgrade leaves more members than seats). Still
  // full, and the arithmetic stays honest rather than clamping.
  [5, 0, "starter", null, 5, 3, true, true, "5 of 3 seats. Upgrade for more"],
  // The served limit wins over the local formula — pricing moved and this
  // client has not shipped yet.
  [16, 0, "pro", 20, 16, 20, false, false, "16 of 20 seats"],
  // A nonsensical served limit falls back rather than rendering. Zero would
  // make every workspace read as full and block every invite in the product.
  [1, 0, "starter", 0, 1, 3, false, false, "1 of 3 seats"],
] as const;

describe("seat cases (the fixture Android and iOS are pinned against)", () => {
  it.each(SEAT_CASES)(
    "%i members + %i invites on %s (served %s)",
    (members, invites, plan, served, used, limit, full, canUpgrade, line) => {
      const usage = seatUsage(members, invites, plan, served);
      expect(usage.used).toBe(used);
      expect(usage.limit).toBe(limit);
      expect(usage.full).toBe(full);
      expect(usage.canUpgrade).toBe(canUpgrade);
      expect(usage.line).toBe(line);
    },
  );
});

describe("the allowance itself", () => {
  it("reads a null plan as Starter, never as Pro", () => {
    // Defaulting to Pro would let an unpaid workspace build a 15-person crew
    // and then be told at checkout that twelve of them have to go.
    expect(seatLimit(null)).toBe(PLAN_SEATS.starter);
    expect(seatLimit(undefined)).toBe(PLAN_SEATS.starter);
    expect(seatLimit("starter")).toBe(PLAN_SEATS.starter);
    expect(seatLimit("pro")).toBe(PLAN_SEATS.pro);
  });

  it("treats an unknown plan as Starter rather than throwing", () => {
    // A plan string this build has never heard of (a tier added server-side
    // first) must not crash a settings screen. The smallest allowance is the
    // safe wrong answer: it under-promises rather than over-promising.
    expect(seatLimit("enterprise")).toBe(PLAN_SEATS.starter);
  });

  it("knows Pro is the top self-serve plan", () => {
    expect(canUpgradeSeats("starter")).toBe(true);
    expect(canUpgradeSeats(null)).toBe(true);
    expect(canUpgradeSeats("pro")).toBe(false);
  });
});
