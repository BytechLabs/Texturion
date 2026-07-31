/**
 * #464. These vectors are shared with the Kotlin port
 * (NumbersSection.extraNumberBlockedReason) — a client that disagrees with the
 * server either hides a purchase the server would allow, or offers one it
 * would refuse and turns a tap into an error.
 */
import { describe, expect, it } from "vitest";

import {
  canBuyExtraNumber,
  extraNumberBlockedReason,
  STARTER_MAX_TOTAL_NUMBERS,
} from "./extra-numbers";

describe("extraNumberBlockedReason", () => {
  it("lets a Canadian workspace buy one, with no registration wait", () => {
    // The bug: Canada has no 10DLC equivalent, so `usTextingEnabled` is never
    // true for a CA workspace — and the old rule required it, which refused
    // every Canadian customer forever.
    expect(
      extraNumberBlockedReason({
        plan: "pro",
        currentCount: 2,
        country: "CA",
        usTextingEnabled: false,
      }),
    ).toBeNull();
  });

  it("makes a US workspace wait for carrier approval", () => {
    const reason = extraNumberBlockedReason({
      plan: "pro",
      currentCount: 2,
      country: "US",
      usTextingEnabled: false,
    });
    expect(reason).toBe(
      "An extra number needs US texting turned on for your workspace first.",
    );
  });

  it("lets an approved US workspace buy one", () => {
    expect(
      canBuyExtraNumber({
        plan: "pro",
        currentCount: 2,
        country: "US",
        usTextingEnabled: true,
      }),
    ).toBe(true);
  });

  it("keeps Starter's hard total cap, in both countries", () => {
    for (const country of ["US", "CA"] as const) {
      const reason = extraNumberBlockedReason({
        plan: "starter",
        currentCount: STARTER_MAX_TOTAL_NUMBERS,
        country,
        usTextingEnabled: true,
      });
      expect(reason, `${country} should still hit the Starter cap`).toContain(
        "Starter tops out",
      );
    }
  });

  it("lets Starter buy its ONE extra", () => {
    expect(
      canBuyExtraNumber({
        plan: "starter",
        currentCount: 1,
        country: "CA",
        usTextingEnabled: false,
      }),
    ).toBe(true);
  });

  it("never returns an empty explanation", () => {
    // The string is the only thing the customer is told, so a blocked case
    // that says nothing is worse than no gate at all.
    const blocked = [
      { plan: "us-unapproved", args: { plan: "pro" as const, currentCount: 2, country: "US" as const, usTextingEnabled: false } },
      { plan: "starter-capped", args: { plan: "starter" as const, currentCount: 2, country: "CA" as const, usTextingEnabled: false } },
    ];
    for (const { plan, args } of blocked) {
      const reason = extraNumberBlockedReason(args);
      expect(reason, `${plan} must explain itself`).toBeTruthy();
      expect(reason!.length, `${plan} must explain itself`).toBeGreaterThan(20);
    }
  });
});
