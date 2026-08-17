/**
 * #228 — the four notices about a workspace's own line say the same thing in
 * both languages, and still say exactly what they used to say in English.
 *
 * The English half is the load-bearing one. Every one of these sentences is on
 * a lock screen today, and three of them are ALSO the subject line of an email
 * that has already been sent to real customers — #228 is a translation pass,
 * not a rewrite, so the English is pinned character for character rather than
 * approximately.
 *
 * The French half is checked for the two ways a translation table goes wrong
 * without anyone noticing: a language quietly stubbed with the English, and an
 * interpolated value that got lost in the rewording. The number and the day
 * count are DATA — a French rendering that drops either leaves a crew an alert
 * that does not say which line, or how long they have.
 */
import { LOCALES, type Locale } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { NUMBER_NOTICE_COPY } from "./number-copy";

const NUMBER = "+14165550142";

describe("the number-notice copy", () => {
  it("says in English exactly what it said before #228", () => {
    const copy = NUMBER_NOTICE_COPY.en;
    expect(copy.portCompletedTitle).toBe("Your number is live");
    expect(copy.portCompletedBody(NUMBER)).toBe(
      `${NUMBER} is on Loonext now. Text your customers from your inbox.`,
    );
    expect(copy.registrationApprovedTitle).toBe("Your texting is live");
    expect(copy.registrationApprovedBody).toBe(
      "Carrier approval came through. You can text customers now.",
    );
    expect(copy.registrationApprovedPausedTitle).toBe(
      "Your US registration is approved",
    );
    expect(copy.registrationApprovedPausedBody).toBe(
      "Carrier approval came through. Texts send once you resume your plan.",
    );
    // The three warning rungs are the email subjects `grace.ts` has been
    // sending since #54, reused as the push title. Changing one changes both.
    expect(copy.graceDay1Title(29)).toBe(
      "Your Loonext subscription was canceled. Your number is safe for 29 more days",
    );
    expect(copy.graceDay15Title(15)).toBe(
      "15 days left before your Loonext business number is released",
    );
    expect(copy.graceDay27Title(3)).toBe(
      "Final notice: your Loonext business number is released in 3 days",
    );
    expect(copy.graceBody).toBe("Open Loonext to keep your number.");
    expect(copy.numberReleasedTitle).toBe(
      "Your Loonext business number has been released",
    );
    expect(copy.numberReleasedBody).toBe(
      "Open Loonext to see what this means and what you can still do.",
    );
  });

  it("answers in French with its own words, not the English ones", () => {
    const fr = NUMBER_NOTICE_COPY["fr-CA"];
    expect(fr.portCompletedTitle).toBe("Votre numéro est en service");
    expect(fr.portCompletedBody(NUMBER)).toBe(
      `${NUMBER} est en service sur Loonext. ` +
        "Écrivez à vos clients depuis votre boîte de réception.",
    );
    expect(fr.registrationApprovedTitle).toBe("Vos textos sont en service");
    expect(fr.registrationApprovedBody).toBe(
      "Les fournisseurs vous ont approuvé. Vous pouvez texter vos clients dès maintenant.",
    );
    expect(fr.registrationApprovedPausedTitle).toBe(
      "Inscription américaine approuvée",
    );
    expect(fr.registrationApprovedPausedBody).toBe(
      "Les fournisseurs vous ont approuvé. Les textos partiront à la reprise de votre forfait.",
    );
    expect(fr.graceDay1Title(29)).toBe(
      "Abonnement Loonext annulé. Votre numéro est conservé encore 29 jours",
    );
    expect(fr.graceDay15Title(15)).toBe(
      "Plus que 15 jours avant la libération de votre numéro Loonext",
    );
    expect(fr.graceDay27Title(3)).toBe(
      "Dernier avis : votre numéro Loonext est libéré dans 3 jours",
    );
    expect(fr.graceBody).toBe("Ouvrez Loonext pour garder votre numéro.");
    expect(fr.numberReleasedTitle).toBe(
      "Votre numéro d'entreprise Loonext a été libéré",
    );
    expect(fr.numberReleasedBody).toBe(
      "Ouvrez Loonext pour voir ce que ça veut dire et ce que vous pouvez encore faire.",
    );
  });

  it("PROVES THE TABLE: no entry is quietly the English one", () => {
    // A table stubbed with the English compiles, passes an "is it a string"
    // check, and ships an untranslated lock screen. Pinning the difference on
    // EVERY entry is what makes that a failure rather than a silent no-op, and
    // the count is here so "every entry" is a number rather than an impression
    // of a loop that visited nothing.
    const en = NUMBER_NOTICE_COPY.en;
    const fr = NUMBER_NOTICE_COPY["fr-CA"];
    const pairs: [string, string, string][] = [
      ["portCompletedTitle", en.portCompletedTitle, fr.portCompletedTitle],
      [
        "portCompletedBody",
        en.portCompletedBody(NUMBER),
        fr.portCompletedBody(NUMBER),
      ],
      [
        "registrationApprovedTitle",
        en.registrationApprovedTitle,
        fr.registrationApprovedTitle,
      ],
      [
        "registrationApprovedBody",
        en.registrationApprovedBody,
        fr.registrationApprovedBody,
      ],
      [
        "registrationApprovedPausedTitle",
        en.registrationApprovedPausedTitle,
        fr.registrationApprovedPausedTitle,
      ],
      [
        "registrationApprovedPausedBody",
        en.registrationApprovedPausedBody,
        fr.registrationApprovedPausedBody,
      ],
      ["graceDay1Title", en.graceDay1Title(29), fr.graceDay1Title(29)],
      ["graceDay15Title", en.graceDay15Title(15), fr.graceDay15Title(15)],
      ["graceDay27Title", en.graceDay27Title(3), fr.graceDay27Title(3)],
      ["graceBody", en.graceBody, fr.graceBody],
      ["numberReleasedTitle", en.numberReleasedTitle, fr.numberReleasedTitle],
      ["numberReleasedBody", en.numberReleasedBody, fr.numberReleasedBody],
    ];
    expect(pairs).toHaveLength(12);
    for (const [name, english, french] of pairs) {
      expect(french, name).not.toBe(english);
    }
  });

  it("carries the number and the day count through every language", () => {
    // Both are somebody's facts rather than our words: the E.164 line is the
    // workspace's own, and a rewording that drops the count leaves a deadline
    // notice with no deadline in it.
    expect(LOCALES).toHaveLength(2);
    for (const locale of LOCALES as readonly Locale[]) {
      const copy = NUMBER_NOTICE_COPY[locale];
      // Untranslated and unreformatted, so the reader can match it against the
      // line they are porting.
      expect(copy.portCompletedBody(NUMBER), locale).toContain(NUMBER);
      expect(copy.graceDay1Title(29), locale).toContain("29");
      expect(copy.graceDay15Title(15), locale).toContain("15");
      expect(copy.graceDay27Title(3), locale).toContain("3");
    }
  });

  it("keeps Law 6 in both languages: no em or en dashes", () => {
    for (const locale of LOCALES as readonly Locale[]) {
      const copy = NUMBER_NOTICE_COPY[locale];
      const lines = [
        copy.portCompletedTitle,
        copy.portCompletedBody(NUMBER),
        copy.registrationApprovedTitle,
        copy.registrationApprovedBody,
        copy.registrationApprovedPausedTitle,
        copy.registrationApprovedPausedBody,
        copy.graceDay1Title(29),
        copy.graceDay15Title(15),
        copy.graceDay27Title(3),
        copy.graceBody,
        copy.numberReleasedTitle,
        copy.numberReleasedBody,
      ];
      expect(lines, locale).toHaveLength(12);
      for (const line of lines) {
        expect(line, `${locale}: ${line}`).not.toContain("—");
        expect(line, `${locale}: ${line}`).not.toContain("–");
      }
    }
  });
});
