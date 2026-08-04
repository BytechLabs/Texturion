/**
 * #303 — screening a business name against the categories §4 prohibits.
 *
 * PC-3 is the one that decides whether this ships at all. A screen that flags
 * ordinary contractors is worse than no screen: whoever reads the alerts
 * learns to dismiss them, and the one real dispensary arrives in a queue
 * nobody trusts. Every name in that test is the kind this product's actual
 * customers use.
 */
import { describe, expect, it } from "vitest";

import {
  allTerms,
  screenBusinessName,
  screeningSummary,
} from "./prohibited-categories";

describe("#303 screening a business name", () => {
  it("PC-1: catches the categories §4 prohibits outright", () => {
    const cases: [string, string][] = [
      ["Green Leaf Dispensary", "cannabis"],
      ["QuickCash Payday Loans LLC", "high_interest_lending"],
      ["Riverside Vape & Smoke Shop", "tobacco_vaping"],
      ["Northgate Gunsmith", "firearms"],
      ["Lucky Star Casino", "gambling"],
      ["Elite Escorts", "adult"],
      ["Statewide Debt Collection Services", "high_interest_lending"],
    ];
    for (const [name, category] of cases) {
      const found = screenBusinessName(name).map((m) => m.category);
      expect(found, name).toContain(category);
    }
  });

  it("PC-2: reports EVERY category a name suggests, not the first", () => {
    // Two categories is stronger evidence than one, and a reviewer should see
    // both rather than whichever the loop reached first.
    const found = screenBusinessName("Cannabis & Vape Superstore");
    expect(found.map((m) => m.category).sort()).toEqual(["cannabis", "tobacco_vaping"]);
  });

  it("PC-3: does NOT flag the businesses this product is for", () => {
    // THE ONE THAT DECIDES IT. A screen that fires on real customers is worse
    // than none: the alerts get dismissed, and the one real case arrives in a
    // queue nobody trusts. Each of these contains a word that a lazier list
    // would have matched — colt, blazing, smoke, arms, cash, green, bar.
    const realCustomers = [
      "Colt Plumbing & Heating",
      "Blazing Trails Landscaping",
      "The Smoke House BBQ Catering",
      "Armstrong Roofing",
      "Cashmere Advanced Cleaning",
      "Green Valley Lawn Care",
      "Barlow & Sons Electrical",
      "Reed Roofing",
      "Ace Garage Door Repair",
      "Titan Concrete",
      "Firehouse Chimney Sweep",
      "Sharpshooter Window Cleaning",
      "High Country Excavation",
      "Weeding & Feeding Garden Services",
    ];
    for (const name of realCustomers) {
      expect(screenBusinessName(name), name).toEqual([]);
    }
  });

  it("PC-4: a term only matches as its own words", () => {
    // "Quick Cash Advanced Cleaning" is the case that proves it. Normalised,
    // it contains the literal string "cash advance" — as a prefix of "cash
    // advanced" — so a substring match flags a cleaning company as a payday
    // lender. Only word-boundary matching gets this right, and the first
    // fixture here ("Cashmere Advanced") did NOT collide, so the break sweep
    // reported the space-padding as decorative.
    expect(screenBusinessName("Quick Cash Advanced Cleaning")).toEqual([]);
    expect(screenBusinessName("Cashmere Advanced Cleaning")).toEqual([]);
    expect(screenBusinessName("Same Day Cash Advance")).toHaveLength(1);
  });

  it("PC-8: no term is a word an ordinary trade name contains", () => {
    // The module's docblock lists the words it deliberately leaves out, and
    // until now that was prose. This is the same claim as an assertion.
    //
    // A single common word in this list is the failure mode that kills the
    // whole feature: it fires on real customers, whoever reads the alerts
    // learns to dismiss them, and the one real dispensary lands in a queue
    // nobody trusts. Multi-word terms are exempt — "weed shop" is unambiguous
    // where "weed" is a gardener.
    const TOO_COMMON = [
      "gun", "guns", "arms", "shot", "shots", "bar", "pub", "smoke", "smokes",
      "leaf", "green", "cash", "loan", "loans", "weed", "fire", "blaze",
      "colt", "high", "bud", "pot", "roll", "joint", "bet", "chance",
    ];
    const offenders = allTerms().filter(
      (term) => !term.includes(" ") && TOO_COMMON.includes(term),
    );

    expect(
      offenders,
      "These single-word terms appear in ordinary contractor names far more " +
        "often than in a prohibited one. Either qualify them into a phrase " +
        '("weed shop", "cash advance") or drop them: ' +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("PC-5: punctuation and case do not hide a match", () => {
    // Somebody registering a dispensary is not required to be tidy about it.
    for (const name of ["GREEN-LEAF DISPENSARY!", "green.leaf.dispensary", "Green  Leaf   Dispensary"]) {
      expect(screenBusinessName(name).map((m) => m.category), name).toContain("cannabis");
    }
  });

  it("PC-6: the alert names its evidence and refuses to reach a verdict", () => {
    // A reviewer needs the matched term to judge it themselves, and the copy
    // has to say plainly that this is a keyword hit rather than a finding —
    // otherwise the flag reads as a decision already taken.
    const matches = screenBusinessName("Green Leaf Dispensary");
    const summary = screeningSummary("Green Leaf Dispensary", matches);

    expect(summary).toContain("dispensary");
    expect(summary).toMatch(/not\s+a finding/i);
    expect(summary).toMatch(/look before\s+acting/i);
    // No verdict language anywhere.
    for (const verdict of ["violation", "prohibited business", "must be", "confirmed"]) {
      expect(summary.toLowerCase()).not.toContain(verdict);
    }
  });

  it("PC-7: a clean name produces a summary that says so", () => {
    expect(screeningSummary("Reed Roofing", [])).toMatch(/matched nothing/);
  });
});
