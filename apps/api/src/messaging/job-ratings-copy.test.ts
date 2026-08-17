/**
 * #228 — the escalation says the same thing in both languages, and still says
 * exactly what it used to say in English.
 *
 * The English half is the load-bearing one. This sentence is on the lock
 * screens of every crew running today, and #228 is a translation pass, not a
 * rewrite — so it is pinned character for character rather than approximately.
 * The French half is checked for the two ways a translation table goes wrong
 * without anyone noticing: a language quietly stubbed with the English, and an
 * interpolated value that got lost in the rewording.
 */
import { LOCALES, type Locale } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { POOR_RATING_PUSH_COPY } from "./job-ratings-copy";

describe("the poor-rating escalation copy", () => {
  it("says in English exactly what it said before #228", () => {
    const copy = POOR_RATING_PUSH_COPY.en;
    expect(copy.title).toBe("A customer was not happy");
    expect(copy.body(2)).toBe(
      "They rated a finished job 2 out of 5. Today is when that is still fixable.",
    );
  });

  it("answers in French with its own words, not the English ones", () => {
    const fr = POOR_RATING_PUSH_COPY["fr-CA"];
    expect(fr.title).toBe("Un client n'était pas satisfait");
    expect(fr.body(1)).toBe(
      "Le client a donné 1 sur 5 pour un travail terminé. " +
        "C'est aujourd'hui que ça se rattrape.",
    );
    // A table stubbed with the English compiles, passes a "is it a string"
    // check, and ships an untranslated lock screen. Pinning the difference is
    // what makes that a failure rather than a silent no-op.
    expect(fr.title).not.toBe(POOR_RATING_PUSH_COPY.en.title);
    expect(fr.body(1)).not.toBe(POOR_RATING_PUSH_COPY.en.body(1));
  });

  it("carries the score through every language", () => {
    // The digit is the customer's answer, not copy — a rewording that drops it
    // leaves the crew an alert that does not say how bad it was. A count, so
    // "every language" has a number behind it rather than being an empty loop.
    expect(LOCALES).toHaveLength(2);
    for (const locale of LOCALES as readonly Locale[]) {
      const copy = POOR_RATING_PUSH_COPY[locale];
      expect(copy.body(1), locale).toContain("1");
      expect(copy.body(2), locale).toContain("2");
      expect(copy.title.length, locale).toBeGreaterThan(0);
    }
  });
});
