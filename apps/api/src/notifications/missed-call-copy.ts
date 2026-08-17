/**
 * #228 — what a missed-call alert says, in the language its reader chose.
 *
 * The payload is composed per reader now (`PushDelivery.web` takes a `Locale`),
 * so these sentences cannot stay at the call site: a literal there is an
 * English lock screen on a French member's phone, and a lock screen is the
 * half of this product somebody reads before they have opened anything.
 *
 * Shaped so a MISSING TRANSLATION IS A TYPE ERROR. `Record<Locale, …>` over an
 * interface means a new language fails to compile until every sentence exists
 * in it, and a new sentence fails to compile until every language has it —
 * which is the only version of this that survives the next feature.
 *
 * The contact's NAME is not copy. It is theirs, it goes out untranslated, and
 * it is a parameter here for exactly that reason.
 */
import type { Locale } from "@loonext/shared";

interface MissedCallCopy {
  /**
   * Lock-screen title. `contactName` is the contact's own name, falling back to
   * their E.164 number — somebody else's word, passed straight through.
   */
  title(contactName: string): string;
  /** Telnyx accepted the auto text-back: the caller has already been reached. */
  bodyTexted: string;
  /** We tried and the send failed, so nobody has reached the caller. */
  bodyTextFailed: string;
  /**
   * No text-back was ever attempted — MCTB off, caller opted out, or throttled.
   * A separate sentence from the failure on purpose: nothing was sent at all.
   */
  bodyNoText: string;
}

const EN: MissedCallCopy = {
  title: (contactName) => `Missed call from ${contactName}`,
  bodyTexted: "We texted them so they can book by reply.",
  bodyTextFailed: "Their text-back failed. Call them back.",
  bodyNoText: "No text-back went out. Call them back.",
};

/**
 * Quebec French.
 *
 * "réserver en répondant" and "texto de rappel" are the house renderings of
 * "book by reply" and "text-back" (apps/web/src/i18n/sections/appShell.ts), so
 * the notification and the screen it opens speak one vocabulary. The title
 * matches misc.ts `notifMissedCall`, which is the bell-feed line for this same
 * event — two renderings of one fact would read as two facts.
 *
 * One caller is "leur / ils / les" throughout, following thread.ts
 * `callThemInstead` ("Appelez-les plutôt"): the three bodies of a single alert
 * have to agree with each other before they agree with a grammar book. And
 * "n'est parti" rather than "a échoué" in the last one carries the whole
 * distinction — nothing was attempted, as against something that failed.
 */
const FR_CA: MissedCallCopy = {
  title: (contactName) => `Appel manqué de ${contactName}`,
  bodyTexted:
    "Nous leur avons envoyé un texto pour qu'ils puissent réserver en répondant.",
  bodyTextFailed: "Le texto de rappel a échoué. Rappelez-les.",
  bodyNoText: "Aucun texto de rappel n'est parti. Rappelez-les.",
};

export const MISSED_CALL_COPY: Record<Locale, MissedCallCopy> = {
  en: EN,
  "fr-CA": FR_CA,
};
