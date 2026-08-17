/**
 * #228 — the poor-rating escalation, in the language the reader reads.
 *
 * This is the copy for the one alert in #313 with teeth: a finished job came
 * back rated 1 or 2, and somebody has today to do something about it. It is
 * read on a lock screen before anything is opened, which makes it one of the
 * first sentences a French crew meets — and it was composed in English.
 *
 * A TABLE RATHER THAN LITERALS AT THE SITE, so a missing translation is a type
 * error. `Record<Locale, PoorRatingPushCopy>` cannot be built with a language
 * missing, and the interface cannot gain a sentence that only English answers.
 *
 * THE SCORE IS A PLAIN PARAMETER rather than the escalation's `input.score`.
 * Nothing here knows the shape of that argument, so the sentence survives the
 * call site being refactored around it, and the digit itself is data passing
 * through untranslated — 2 is 2 in both languages.
 *
 * GSM-7 DOES NOT BIND HERE, unlike `packages/shared/src/locale.ts`. That file's
 * French avoids circumflexes and typographic apostrophes because its strings
 * cross a carrier and are billed by the segment; these cross APNs and FCM,
 * where an accent costs nothing. So the French below is spelled properly.
 */
import type { Locale } from "@loonext/shared";

interface PoorRatingPushCopy {
  /** The lock-screen headline. */
  title: string;
  /** `score` is the digit the customer replied with — 1 or 2 (`isPoorRating`). */
  body(score: number): string;
}

const EN: PoorRatingPushCopy = {
  title: "A customer was not happy",
  body: (score) =>
    `They rated a finished job ${score} out of 5. ` +
    "Today is when that is still fixable.",
};

const FR_CA: PoorRatingPushCopy = {
  // « satisfait » is the word the French satisfaction card already settled on
  // (`domain.panelSatisfactionNote`). A judgement call on length as well: at 31
  // characters this stays inside what a lock screen shows of a title before it
  // truncates, which is where the shorter of two accurate renderings wins.
  title: "Un client n'était pas satisfait",
  // English "They" is the customer, whose gender we do not know. Resolved as
  // « Le client » — the same generic the timeline already uses for this person
  // (`thread.sysPaymentPaid`) — rather than a guessed pronoun. « sur 5 » and
  // « travail terminé » are the satisfaction card's existing French, so the
  // notification and the screen it links to use one vocabulary.
  body: (score) =>
    `Le client a donné ${score} sur 5 pour un travail terminé. ` +
    "C'est aujourd'hui que ça se rattrape.",
};

export const POOR_RATING_PUSH_COPY: Record<Locale, PoorRatingPushCopy> = {
  en: EN,
  "fr-CA": FR_CA,
};
