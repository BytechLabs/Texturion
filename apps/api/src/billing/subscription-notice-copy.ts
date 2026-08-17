/**
 * #228 — the two subscription notices that reach a phone, in the reader's
 * language.
 *
 * Both ride `pushConsequentialNotice`, and both are about the same asset: the
 * business number. One says a person cancelled and the clock has started
 * (`cancellation-notice.ts`, #421); the other says the plan they came back on
 * covers fewer numbers than they hold, so some are held rather than live
 * (`webhooks/stripe.ts`, #523). They share a table because they share a reader
 * — an owner, on a lock screen, deciding whether to open the app tonight.
 *
 * A MISSING TRANSLATION IS A TYPE ERROR: `Record<Locale, …>` over an interface,
 * so a notice cannot gain a sentence that only English answers.
 *
 * THE EMAILS THESE PAIR WITH ARE STILL ENGLISH, and deliberately: an address is
 * not a person whose `profiles.locale` we have resolved, so an email has no
 * reader language to compose in. #228 types the PUSH payload as a function of
 * `Locale` and stops there. Where the same English sentence therefore exists
 * twice — `heldNumbersCopy`'s subject and `numbersHeldTitle` below — the copy
 * next door explains why, and `subscription-notice-copy.test.ts` is the check
 * that keeps them one sentence.
 */
import type { Locale } from "@loonext/shared";

interface SubscriptionNoticeCopy {
  /**
   * #421/#252 — the FIRST number-loss warning, and the only one with thirty
   * days of runway still on it.
   */
  cancellationTitle: string;
  /** What can still be done about it, which is the only actionable half. */
  cancellationBody: string;
  /**
   * #523 — numbers came back HELD rather than live. The one-vs-many branch
   * lives inside the translation because it is a rule of the language rather
   * than of the call site: English breaks on "number is"/"numbers are", French
   * on « numéro est »/« numéros sont », and the next language to arrive will
   * not be trusted to break where either of them does.
   *
   * The English is word for word `heldNumbersCopy`'s subject — see the module
   * docblock.
   */
  numbersHeldTitle(count: number): string;
  /** Where to see WHICH number, and the ways back. */
  numbersHeldBody: string;
}

const EN: SubscriptionNoticeCopy = {
  cancellationTitle: "Your subscription was cancelled — your number goes in 30 days",
  cancellationBody: "You can undo this yourself. Open Loonext to keep your number.",
  numbersHeldTitle: (count) =>
    count === 1
      ? "One of your numbers is on hold"
      : `${count} of your numbers are on hold`,
  numbersHeldBody: "Open Loonext to see which number, and how to bring it back.",
};

const FR: SubscriptionNoticeCopy = {
  // SHORTER THAN THE ENGLISH ON PURPOSE. A lock screen shows around forty
  // characters of a title; the English runs to sixty-one and loses its tail,
  // and the natural French (« Abonnement annulé — votre numéro part dans 30
  // jours ») is longer still, which would have cut « 30 jours » — the entire
  // point of the notice. At exactly forty the deadline survives.
  //
  // WHAT THE TITLE GIVES UP IS THE SUBJECT, and the body takes it back. The
  // English title names it outright ("Your subscription was cancelled"); a
  // French title that fits cannot, and « Annulé » alone reads as though the
  // NUMBER were the thing cancelled — the opposite of the truth, in a notice
  // whose whole job is that the number is still recoverable. So the French
  // body opens by naming it. A body is not truncated, which is exactly why
  // the fact that will not fit above belongs there.
  cancellationTitle: "Annulé : votre numéro part dans 30 jours",
  // « revenir en arrière » rather than « annuler l'annulation », which is what
  // a literal reading produces and is unreadable. Loonext is a product name.
  cancellationBody:
    "Votre abonnement est annulé. Vous pouvez revenir en arrière vous-même : ouvrez Loonext pour garder votre numéro.",
  // « en attente » is the settled French for a held number
  // (settingsMore.numberHoldOverAllowanceOne, « En attente — votre forfait
  // couvre… »), so the push and the billing screen it links to name one state.
  numbersHeldTitle: (count) =>
    count === 1
      ? "Un de vos numéros est en attente"
      : `${count} de vos numéros sont en attente`,
  // « rétablir » is the verb the French hold card already uses for this exact
  // action (settingsMore.numberHoldBringBackLink, « Voyez comment le rétablir »).
  numbersHeldBody: "Ouvrez Loonext pour voir lequel, et comment le rétablir.",
};

export const SUBSCRIPTION_NOTICE_COPY: Record<Locale, SubscriptionNoticeCopy> = {
  en: EN,
  "fr-CA": FR,
};
