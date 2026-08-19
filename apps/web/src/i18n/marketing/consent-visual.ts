import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — the two consent records the compliance illustration shows.
 *
 * ## Shared, so translating it once pays for two pages
 *
 * `/canada` and `/features/compliance` both render this. It is the first piece
 * of evidence for Rule 10's claim that the first page translated is the
 * expensive one and every page after it is cheaper — `/features/compliance`
 * now needs no work here at all.
 *
 * ## What stays as it is
 *
 * The names and the phone numbers. Karen, Priya and the Nguyen family are
 * example people, and a name is not a word to translate — Quebec has all three
 * of these names in it. The numbers are 555 reservations in real Canadian area
 * codes (416 Toronto, 647 Toronto), which is the point of them.
 *
 * ## What does change, beyond the sentences
 *
 * The dates. `Jun 12` is an English abbreviation; French Canadian writes
 * `12 juin` — day first, month lowercase, and `juil.` is the only one of the
 * two that abbreviates. Getting this wrong is the tell that a date was pasted
 * rather than translated.
 */
export const consentVisualEn = {
  firstRecordLine: "Texted you first · Jun 12",
  firstRecordDetail: "Recorded automatically when her first text arrived.",
  secondRecordLine: "Consent recorded by Priya · Jul 2",
  secondRecordDetail: "Stamped when Priya started the conversation.",
} as const;

export const consentVisualFr: Translated<typeof consentVisualEn> = {
  firstRecordLine: "Vous a écrit en premier · 12 juin",
  firstRecordDetail: "Enregistré automatiquement à l'arrivée de son premier texto.",
  secondRecordLine: "Consentement noté par Priya · 2 juil.",
  secondRecordDetail: "Horodaté quand Priya a lancé la conversation.",
};

const CONSENT_VISUAL_COPY = {
  en: consentVisualEn,
  "fr-CA": consentVisualFr,
} as const;

export type ConsentVisualCopy = typeof consentVisualEn | typeof consentVisualFr;

export function consentVisualCopy(locale: MarketingLocale = "en"): ConsentVisualCopy {
  return CONSENT_VISUAL_COPY[locale] ?? consentVisualEn;
}
