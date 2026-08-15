import { describe, expect, it } from "vitest";

import {
  SIGNUP_SOURCES,
  SIGNUP_SOURCE_HINT,
  SIGNUP_SOURCE_LABELS,
  SIGNUP_SOURCE_PROMPT,
  isSignupSource,
} from "./signup-source";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the copy assertions resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

describe("#288 signup source", () => {
  it("keeps the list inside what a person will read", () => {
    // Chunking: three to four. A longer list produces better taxonomy and worse
    // data, because the cost of answering rises and the skip rate with it.
    expect(SIGNUP_SOURCES.length).toBeLessThanOrEqual(4);
  });

  it("has a label for every source, and no blank ones", () => {
    // A missing label renders an empty chip — a control with nothing on it,
    // which is worse than the question not being asked.
    for (const source of SIGNUP_SOURCES) {
      expect(SIGNUP_SOURCE_LABELS[source]?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(Object.keys(SIGNUP_SOURCE_LABELS)).toHaveLength(SIGNUP_SOURCES.length);
  });

  it("can see word of mouth, which is the entire reason it exists", () => {
    // Without this bucket the question answers nothing #296 could not already
    // answer passively.
    expect(SIGNUP_SOURCES).toContain("another_business");
  });

  it("does not use the word 'referral' in front of the owner", () => {
    // It would invite them to answer about our programme — "did I use a link?"
    // — when what is being asked is whether a human recommended us at all.
    // #228: resolved, not read off the constant. Left pointed at the key this
    // would have passed for the wrong reason forever — "onboarding.signup
    // SourceAnotherBusiness" does not contain "referral" either.
    expect(
      look(WEB_EN, SIGNUP_SOURCE_LABELS.another_business).toLowerCase(),
    ).not.toContain("referral");
    // And the French equivalents of the word, which carry the same problem:
    // "recommandation" and "parrainage" both name the PROGRAMME rather than
    // the human who mentioned us.
    expect(
      look(WEB_FR, SIGNUP_SOURCE_LABELS.another_business).toLowerCase(),
    ).not.toMatch(/recommandation|parrainage/);
  });

  it("#228: offers four answers that differ, in both languages", () => {
    // Two buckets reading the same way is a question whose answers cannot be
    // acted on, and it would pass every other assertion here.
    for (const table of [WEB_EN, WEB_FR]) {
      const labels = SIGNUP_SOURCES.map((source) =>
        look(table, SIGNUP_SOURCE_LABELS[source]),
      );
      expect(new Set(labels).size).toBe(SIGNUP_SOURCES.length);
    }
  });

  it("says out loud that answering is optional", () => {
    // An optional question in a signup flow reads as required unless it says
    // otherwise, and a required one here is friction on the screen that can
    // least afford it.
    expect(look(WEB_EN, SIGNUP_SOURCE_HINT).toLowerCase()).toContain("optional");
    expect(look(WEB_FR, SIGNUP_SOURCE_HINT).toLowerCase()).toContain("facultatif");
    // A question mark in both. French puts a space before it, which is why
    // this checks the last CHARACTER rather than the last two.
    expect(look(WEB_EN, SIGNUP_SOURCE_PROMPT).endsWith("?")).toBe(true);
    expect(look(WEB_FR, SIGNUP_SOURCE_PROMPT).endsWith("?")).toBe(true);
  });

  it("rejects a value it does not know rather than storing it", () => {
    expect(isSignupSource("another_business")).toBe(true);
    expect(isSignupSource("Another_Business")).toBe(false);
    expect(isSignupSource("")).toBe(false);
    expect(isSignupSource("billboard")).toBe(false);
  });
});
