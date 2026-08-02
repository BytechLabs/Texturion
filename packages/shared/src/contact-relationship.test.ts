import { describe, expect, it } from "vitest";

import {
  CONTACT_RELATIONSHIP_CASES,
  CONTACT_REPEAT_BADGE_CASES,
  contactRelationshipLine,
  contactRepeatBadge,
  monthYear,
  REPEAT_CUSTOMER_MINIMUM,
} from "./contact-relationship";

/**
 * #410 — the canonical cases, and the fixture the two native ports copy.
 *
 *   apps/android/.../features/contacts/ContactRelationshipTest.kt
 *   apps/ios/LoonextTests/ContactRelationshipTests.swift
 *
 * Adding a case here means adding it there. That is the same deal
 * `seats.test.ts` and `mentions.test.ts` already keep, and it matters for the
 * same reason: a drifted copy does not degrade a feature, it tells one
 * platform's crew a different thing about the same customer.
 */
describe("#410 the relationship line", () => {
  for (const [count, first, expected] of CONTACT_RELATIONSHIP_CASES) {
    it(`${count ?? "null"} / ${first ?? "null"} -> ${expected ?? "nothing"}`, () => {
      expect(contactRelationshipLine(count, first)).toBe(expected);
    });
  }

  it("says nothing rather than guessing when there is no history", () => {
    // A contact with no conversations is one somebody typed in, or one whose
    // history sits entirely on numbers this member cannot see. Both honestly
    // mean "nothing to tell you"; neither means "new customer".
    expect(contactRelationshipLine(0, "2026-03-04T10:00:00Z")).toBeNull();
    expect(contactRelationshipLine(undefined, undefined)).toBeNull();
  });

  it("reads the month off the string, not through a Date", () => {
    // A Date-based port shifts a midnight UTC timestamp into the previous
    // month west of Greenwich, so the same customer would read "December" on
    // one client and "January" on another.
    expect(monthYear("2026-01-01T00:00:00Z")).toBe("January 2026");
    expect(monthYear("2026-01-01T00:00:00-08:00")).toBe("January 2026");
    expect(monthYear("2026-12-31T23:59:59+13:00")).toBe("December 2026");
  });

  it("degrades to null on anything it cannot read", () => {
    for (const bad of [null, undefined, "", "yesterday", "2026", "26-03-04"]) {
      expect(monthYear(bad)).toBeNull();
    }
  });

  it("gets the singular right", () => {
    // "1 conversations" is the kind of detail that makes a product feel
    // unfinished on the exact screen it is trying to build confidence.
    expect(contactRelationshipLine(1, null)).toBe("1 conversation");
    expect(contactRelationshipLine(2, null)).toBe("2 conversations");
  });
});

describe("contactRepeatBadge (#505)", () => {
  it.each(CONTACT_REPEAT_BADGE_CASES)(
    "count %s renders %s",
    (count, expected) => {
      expect(contactRepeatBadge(count)).toBe(expected);
    },
  );

  // The property the whole placement decision rests on. If a first-timer ever
  // got a badge, the header would decorate every thread and distinguish none.
  it("says nothing for a first-time caller, whose only conversation is this one", () => {
    expect(contactRepeatBadge(1)).toBeNull();
    expect(contactRepeatBadge(REPEAT_CUSTOMER_MINIMUM)).not.toBeNull();
  });

  // Header and panel must never disagree about the number itself — only about
  // how much they say around it.
  it("agrees with the panel line on the count, for every repeat case", () => {
    for (const [count] of CONTACT_REPEAT_BADGE_CASES) {
      const badge = contactRepeatBadge(count);
      if (badge === null) continue;
      const line = contactRelationshipLine(count, "2026-03-04T10:00:00Z");
      expect(line).toContain(badge);
    }
  });
});
