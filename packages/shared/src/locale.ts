/**
 * #228 - which language an automated message goes out in.
 *
 * # The resolution order, and why the null matters
 *
 * A contact's own setting wins; otherwise the company's. `contacts.locale` is
 * nullable and the null means "whatever the business works in", not English -
 * so an owner who switches the company to fr-CA moves every customer they have
 * not said otherwise about, including the ones added years earlier. Resolving
 * eagerly and storing the answer per contact would freeze those rows and the
 * owner would watch the setting do nothing.
 *
 * # Why the copy lives here rather than in a translation file
 *
 * These are not UI strings. They are message bodies that go over a carrier and
 * are billed by the segment, and that makes them subject to a constraint no
 * translation tool knows about: the GSM-7 alphabet. One character outside it
 * drops the whole message to UCS-2 at 67 units per segment instead of 153.
 *
 * GSM-7 contains `è é ù ì ò ç à É` and the German umlauts, which is exactly
 * enough to make French look safe and not be. It does NOT contain the
 * circumflex vowels (`â ê î ô û`), `ë ï`, the ligature `œ`, the guillemets
 * `« »`, the typographic apostrophe `’`, or any accented capital except `É`.
 *
 * So the French below is written to a real editorial restriction, and the
 * choices it forced are worth naming rather than leaving to look like poor
 * French:
 *
 *   "vous etes"      would be `êtes`. Rewritten to avoid the word entirely.
 *   "s'il vous plait" would be `plaît`. Avoided.
 *   "bientot"        would be `bientôt`. Avoided.
 *   "A bientot"      would be `À`. Sentences are restructured so no accented
 *                    capital ever begins one.
 *   "l'equipe"       the apostrophe is the ASCII one, never `’`.
 *
 * `sms-copy-encoding.test.ts` asserts every string here is GSM-7 encodable, so
 * a later edit that reaches for the natural spelling fails the build instead of
 * quietly doubling the cost of every message it appears in.
 *
 * # What is deliberately not translated
 *
 * The carrier keyword itself. "Reply STOP to opt out" keeps STOP in English
 * because STOP is what Telnyx's network listens for; a French customer told to
 * send a word the carrier does not recognise would be worse off than one told
 * to send an English word that works. `ARRET` is honoured on our side
 * (`keywords.ts`) but it is not carrier-handled, so it is not what we instruct.
 */

import { DEFAULT_REMINDER_RULES } from "./appointment-reminders";
import { DEFAULT_AWAY_MESSAGE } from "./away";
import { DEFAULT_EMERGENCY_MESSAGE, EMERGENCY_SAFETY_LINE } from "./emergency";
import { IDENTIFICATION_SUFFIX_TEMPLATE } from "./first-message-identification";
import { RATING_ASK_BODY } from "./job-ratings";
import { DEFAULT_MCTB_MESSAGE } from "./mctb";

/** The languages an automated message can be sent in. */
export const LOCALES = ["en", "fr-CA"] as const;

export type Locale = (typeof LOCALES)[number];

/** The language a business works in until it says otherwise. */
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The language THIS message goes out in.
 *
 * Anything unrecognised on either side falls back rather than throwing. This
 * runs on the send path, and a row carrying a locale some future migration
 * added must not stop a text reaching a customer.
 */
export function resolveLocale(
  contactLocale: string | null | undefined,
  companyLocale: string | null | undefined,
): Locale {
  if (isLocale(contactLocale)) return contactLocale;
  if (isLocale(companyLocale)) return companyLocale;
  return DEFAULT_LOCALE;
}

/** How each language names itself, for a picker. Never translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "fr-CA": "Francais (Canada)",
};

/**
 * The automated bodies, per language.
 *
 * The English side is imported from the modules that own each string rather
 * than copied, so there is exactly one definition of the English default and
 * this file cannot drift from it.
 */
export interface AutomatedCopy {
  /** Sent when a call is missed. `{business_name}` is substituted. */
  missedCallTextBack: string;
  /** Sent outside business hours. */
  awayReply: string;
  /** Sent when a customer's reply is flagged urgent. */
  emergencyAck: string;
  /**
   * Appended to the emergency reply, and removable by no setting.
   *
   * The one sentence here with a safety property. Everything else degrades to
   * "the customer reads English" when a translation is missing; this degrades
   * to somebody in danger being told what to do in a language they may not
   * read. A French body with an English safety line keeps the appearance of the
   * guarantee and loses the guarantee.
   */
  emergencySafetyLine: string;
  /** Sent after a job is marked done. `{business_name}` is substituted. */
  ratingAsk: string;
  /** Appended once per contact when sender identification is on. */
  identificationSuffix: string;
  /** The default reminder ladder. Offsets are the language-independent half. */
  appointmentReminders: readonly { offset_minutes: number; body: string }[];
}

/**
 * French copy for the automated sends.
 *
 * Written inside GSM-7 (see the header). Tutoiement is avoided throughout: a
 * trades business texting a customer it has not met uses vous, and the copy
 * reads as a business rather than a friend.
 */
export const FR_CA_COPY: AutomatedCopy = {
  missedCallTextBack:
    "Desole, nous avons manque votre appel. Ici {business_name}. " +
    "Repondez ici avec votre adresse et ce dont vous avez besoin, " +
    "et nous vous trouverons une place.",
  awayReply:
    "Merci de nous avoir ecrit. Nous sommes absents pour le moment et " +
    "nous repondrons des notre retour. En cas d'urgence, repondez URGENT " +
    "et nous vous appellerons.",
  emergencyAck:
    "Signale comme urgent - toute l'equipe vient d'etre alertee. " +
    "Ne restez pas sans nouvelles.",
  // 911 is the emergency number in both Canada and the US, so this stays as
  // region-neutral in French as the English line is.
  emergencySafetyLine: "Si quelqu'un est en danger, composez le 911.",
  ratingAsk:
    "Merci d'avoir fait appel a {business_name}. Comment cela s'est-il passe? " +
    "Repondez avec un chiffre de 1 a 5 - 5 est excellent.",
  // STOP stays English: it is the word the carrier listens for. See the header.
  identificationSuffix: " - {business_name}. Repondez STOP pour vous desabonner",
  appointmentReminders: [
    {
      offset_minutes: 1440,
      body:
        "Bonjour {first_name}, rappel: {business_name} est prevu chez vous " +
        "{job_day} a {job_time}. Repondez C pour confirmer, ou dites-nous " +
        "si un autre moment vous convient mieux.",
    },
    {
      offset_minutes: 120,
      body:
        "{business_name} ici - tout est en ordre pour {job_time} aujourd'hui. " +
        "Repondez C pour confirmer.",
    },
  ],
};

/**
 * The English copy, READ from the modules that own each string rather than
 * repeated here.
 *
 * A second literal would be a second definition of the product default, and the
 * two would drift the first time somebody edited the one they happened to find.
 * That is #414's failure exactly, and it is cheap to make impossible.
 */
export const EN_COPY: AutomatedCopy = {
  missedCallTextBack: DEFAULT_MCTB_MESSAGE,
  awayReply: DEFAULT_AWAY_MESSAGE,
  emergencyAck: DEFAULT_EMERGENCY_MESSAGE,
  emergencySafetyLine: EMERGENCY_SAFETY_LINE,
  ratingAsk: RATING_ASK_BODY,
  identificationSuffix: IDENTIFICATION_SUFFIX_TEMPLATE,
  appointmentReminders: DEFAULT_REMINDER_RULES.map((rule) => ({
    offset_minutes: rule.offset_minutes,
    body: rule.body,
  })),
};

const COPY: Record<Locale, AutomatedCopy> = {
  en: EN_COPY,
  "fr-CA": FR_CA_COPY,
};

/** The automated bodies for a language. */
export function copyFor(locale: Locale): AutomatedCopy {
  return COPY[locale] ?? EN_COPY;
}

/**
 * The automated bodies for a contact, resolving the language first.
 *
 * The single entry point the send paths use, so no caller has to remember that
 * a null contact locale means the company's rather than English.
 */
export function copyForContact(
  contactLocale: string | null | undefined,
  companyLocale: string | null | undefined,
): AutomatedCopy {
  return copyFor(resolveLocale(contactLocale, companyLocale));
}
