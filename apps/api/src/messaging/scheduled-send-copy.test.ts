/**
 * #228 — the lock screen and the scheduled list say the same thing.
 *
 * A held message is disclosed twice to the same person: once as a push composed
 * by the server, and once as the reason under the row when they open the app,
 * which the client renders from its own catalogue. Those are two files in two
 * packages holding one sentence, and nothing but this connects them.
 *
 * Two copies with no check between them is how #389 happened. It matters more
 * here than for most copy, because every sentence below is the product telling
 * somebody a text they wrote is not going to their customer — and a push that
 * says something softer, or shorter, than the row it links to teaches them not
 * to trust either.
 *
 * Read as TEXT rather than imported: `apps/api` does not import `apps/web`
 * source and should not start. Same move the client-parity guards make with
 * Kotlin and Swift.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LOCALES, SCHEDULED_HOLD_REASONS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { SCHEDULED_DISCLOSURE_COPY } from "./scheduled-send-copy";

/** The domain catalogue, split at the language boundary. */
function catalogue(): { en: string; fr: string } {
  const file = readFileSync(
    join(import.meta.dirname, "../../../../apps/web/src/i18n/sections/domain.ts"),
    "utf8",
  );
  const start = file.indexOf("export const domainEn");
  const boundary = file.indexOf("export const domainFr");
  if (start < 0 || boundary < 0) {
    throw new Error("domain.ts no longer has both language blocks");
  }
  return { en: file.slice(start, boundary), fr: file.slice(boundary) };
}

describe("#228 the scheduled disclosure a push goes out in", () => {
  it("says word for word what the catalogue says, in both languages", () => {
    const { en, fr } = catalogue();
    const reasons = Object.keys(SCHEDULED_HOLD_REASONS);
    // A count, so "they all match" is a claim with a number behind it. An
    // empty table would otherwise pass this loop in silence.
    expect(reasons.length).toBe(10);
    for (const reason of reasons) {
      const key = reason as keyof typeof SCHEDULED_HOLD_REASONS;
      for (const [locale, block] of [
        ["en", en],
        ["fr-CA", fr],
      ] as const) {
        const sentence = SCHEDULED_DISCLOSURE_COPY[locale].reason[key];
        expect(
          block.includes(JSON.stringify(sentence)),
          `${reason} differs between the push and the ${locale} catalogue. ` +
            `The push says:\n  ${sentence}`,
        ).toBe(true);
      }
    }
  });

  it("has a sentence for every reason in every language", () => {
    // The compiler already refuses a missing one. This is the runtime half:
    // an entry that exists and is empty would buzz a phone and say nothing.
    for (const locale of LOCALES) {
      const copy = SCHEDULED_DISCLOSURE_COPY[locale];
      expect(Object.keys(copy.reason).sort()).toEqual(
        Object.keys(SCHEDULED_HOLD_REASONS).sort(),
      );
      for (const [reason, sentence] of Object.entries(copy.reason)) {
        expect(sentence.length, `${locale} ${reason} has no copy`).toBeGreaterThan(
          20,
        );
      }
    }
  });

  it("reads the English off the shared roster rather than repeating it", () => {
    // Identity, not equality. The stored `held_reason`, the ten sentences the
    // parity test rosters across Kotlin and Swift, and this push body are ONE
    // definition — a copy that merely matched today would drift the first time
    // somebody edited the one they happened to find.
    expect(SCHEDULED_DISCLOSURE_COPY.en.reason).toBe(SCHEDULED_HOLD_REASONS);
  });
});

describe("#228 the two titles", () => {
  it("keeps the English exactly as it shipped", () => {
    // People read these today and the parity fixtures assert them. The point
    // of this change was to add a language, not to reword the one that works.
    expect(SCHEDULED_DISCLOSURE_COPY.en.waitingTitle).toBe(
      "A scheduled text is waiting",
    );
    expect(SCHEDULED_DISCLOSURE_COPY.en.notSentTitle).toBe(
      "A scheduled text was not sent",
    );
  });

  it("tells held and dead apart in every language", () => {
    // The distinction the whole disclosure rests on: a hold means the message
    // is still going, a failure means it never will. A table answering one
    // title for both states would promise a retry against a STOP.
    for (const locale of LOCALES) {
      const copy = SCHEDULED_DISCLOSURE_COPY[locale];
      expect(copy.waitingTitle, `${locale} has no waiting title`).toBeTruthy();
      expect(
        copy.notSentTitle,
        `${locale} says the same thing whether or not it is coming`,
      ).not.toBe(copy.waitingTitle);
    }
  });

  it("does not leave the French reader the English titles", () => {
    // The failure this replaces: the push was composed in English at a site
    // that already had the reader's language in hand, so a French member got a
    // French reason under an English headline.
    const fr = SCHEDULED_DISCLOSURE_COPY["fr-CA"];
    const en = SCHEDULED_DISCLOSURE_COPY.en;
    expect(fr.waitingTitle).not.toBe(en.waitingTitle);
    expect(fr.notSentTitle).not.toBe(en.notSentTitle);
  });
});
