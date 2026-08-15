import { describe, expect, it } from "vitest";

import {
  CONTACT_RELATIONSHIP_CASES,
  CONTACT_REPEAT_BADGE_CASES,
  contactRelationshipLine,
  contactRepeatBadge,
  monthYear,
  REPEAT_CUSTOMER_MINIMUM,
} from "./contact-relationship";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/*
 * #228 — the module says its copy through the reader's resolver now.
 *
 * The CASES above stay English and are checked with an English resolver: what
 * they pin is the RULE — when a line appears, which half it drops, where the
 * month boundaries land — and both native ports check the same table the same
 * way. The French is asserted separately, at the bottom, where it belongs.
 */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);


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
      expect(contactRelationshipLine(count, first, sayEn)).toBe(expected);
    });
  }

  it("says nothing rather than guessing when there is no history", () => {
    // A contact with no conversations is one somebody typed in, or one whose
    // history sits entirely on numbers this member cannot see. Both honestly
    // mean "nothing to tell you"; neither means "new customer".
    expect(contactRelationshipLine(0, "2026-03-04T10:00:00Z", sayEn)).toBeNull();
    expect(contactRelationshipLine(undefined, undefined, sayEn)).toBeNull();
  });

  it("reads the month off the string, not through a Date", () => {
    // A Date-based port shifts a midnight UTC timestamp into the previous
    // month west of Greenwich, so the same customer would read "December" on
    // one client and "January" on another.
    expect(monthYear("2026-01-01T00:00:00Z", sayEn)).toBe("January 2026");
    expect(monthYear("2026-01-01T00:00:00-08:00", sayEn)).toBe("January 2026");
    expect(monthYear("2026-12-31T23:59:59+13:00", sayEn)).toBe("December 2026");
  });

  it("degrades to null on anything it cannot read", () => {
    for (const bad of [null, undefined, "", "yesterday", "2026", "26-03-04"]) {
      expect(monthYear(bad, sayEn)).toBeNull();
    }
  });

  it("gets the singular right", () => {
    // "1 conversations" is the kind of detail that makes a product feel
    // unfinished on the exact screen it is trying to build confidence.
    expect(contactRelationshipLine(1, null, sayEn)).toBe("1 conversation");
    expect(contactRelationshipLine(2, null, sayEn)).toBe("2 conversations");
  });
});

describe("contactRepeatBadge (#505)", () => {
  it.each(CONTACT_REPEAT_BADGE_CASES)(
    "count %s renders %s",
    (count, expected) => {
      expect(contactRepeatBadge(count, sayEn)).toBe(expected);
    },
  );

  // The property the whole placement decision rests on. If a first-timer ever
  // got a badge, the header would decorate every thread and distinguish none.
  it("says nothing for a first-time caller, whose only conversation is this one", () => {
    expect(contactRepeatBadge(1, sayEn)).toBeNull();
    expect(contactRepeatBadge(REPEAT_CUSTOMER_MINIMUM, sayEn)).not.toBeNull();
  });

  // Header and panel must never disagree about the number itself — only about
  // how much they say around it.
  it("agrees with the panel line on the count, for every repeat case", () => {
    for (const [count] of CONTACT_REPEAT_BADGE_CASES) {
      const badge = contactRepeatBadge(count, sayEn);
      if (badge === null) continue;
      const line = contactRelationshipLine(count, "2026-03-04T10:00:00Z", sayEn);
      expect(line).toContain(badge);
    }
  });
});

describe("#228 the relationship line in French", () => {
  it("says the month in French, in lower case", () => {
    // "Client depuis mars 2026" — a capitalised "Mars" mid-sentence is the
    // tell of a table that was translated word-for-word without being read.
    expect(monthYear("2026-03-04T10:00:00Z", sayFr)).toBe("mars 2026");
    expect(monthYear("2026-08-01T00:00:00Z", sayFr)).toBe("août 2026");
    expect(monthYear("2026-03-04T10:00:00Z", sayEn)).toBe("March 2026");
  });

  it("names all twelve months in both languages, each one distinct", () => {
    // A catalogue with two months translated the same way is a line that says
    // the wrong date half the year, and every assertion above would pass.
    const months = Array.from({ length: 12 }, (_, i) =>
      monthYear(`2026-${String(i + 1).padStart(2, "0")}-15T00:00:00Z`, sayFr),
    );
    expect(months.every((m) => m !== null)).toBe(true);
    expect(new Set(months).size).toBe(12);
    for (const month of months) expect(month).not.toMatch(/^domain\./);
  });

  it("builds the whole line in French", () => {
    const line = contactRelationshipLine(7, "2026-03-04T10:00:00Z", sayFr);
    expect(line).toBe("Client depuis mars 2026 · 7 conversations");
    expect(line, "a variable survived the fill").not.toMatch(/\{/);
  });

  it("keeps one and many apart", () => {
    // Separate keys, so a language that agrees the noun with the number has
    // somewhere to put the difference. French happens to match English here;
    // the keys exist so the next language does not have to.
    expect(contactRelationshipLine(1, null, sayFr)).toBe("1 conversation");
    expect(contactRelationshipLine(4, null, sayFr)).toBe("4 conversations");
  });
});
