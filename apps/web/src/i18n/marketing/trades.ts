import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — the shared trade-page template, in both languages.
 *
 * ## What is here and what is not
 *
 * Six trade pages render through one template, and this file holds the words
 * the TEMPLATE owns: the picker instructions, the fair-use footnote, the two
 * standard truth lines, the pricing link. Each trade's own content object
 * (its H1, its thread, its saved-replies pack) is that trade's copy and lives
 * with it.
 *
 * ## The call sentences are NOT here
 *
 * `trade-thread.tsx` carried its own `callSentence` and its own copy of the
 * missed-call line, duplicating `thread-demo/thread-primitives.tsx` word for
 * word. Both files say, in a comment, that the wording is the app's own from
 * `system-line.tsx` — which is three copies of one rule, and translating them
 * would have made it four in two languages.
 *
 * They come from `thread-demo.ts` now. That is the consolidation this
 * translation forced rather than an incidental cleanup: a sentence a reader
 * sees in two places has to be the same sentence, and the only way to
 * guarantee that is for it to be one string.
 */
export const tradesEn = {
  pickerBefore: "Type",
  pickerAfter:
    "in the composer, tap one, send. Every template is editable before it goes out, and",
  pickerFillsIn: "fills in the customer's name by itself.",
  pickerHeading: "Saved replies",
  pickerSearch: "Search saved replies…",

  doneNote:
    "Tap any message to mark it done. The whole crew sees what's handled.",

  truthReceiving:
    "Receiving texts is free and unlimited on every plan. Photos are free to receive and saved for you; storage is free.",

  fairUseBefore:
    "Texting and pictures are included under an automated fair-use policy, and almost every crew stays well inside it. The concrete numbers live in our",
  fairUseLink: "fair use policy",
  seePricing: "See full pricing. Every cost is on that page.",
} as const;

export const tradesFr: Translated<typeof tradesEn> = {
  pickerBefore: "Tapez",
  pickerAfter:
    "dans le champ de saisie, touchez-en un, envoyez. Chaque modèle se modifie avant de partir, et",
  pickerFillsIn: "remplit le nom du client tout seul.",
  pickerHeading: "Réponses enregistrées",
  pickerSearch: "Chercher dans les réponses enregistrées…",

  doneNote:
    "Touchez n'importe quel message pour le marquer terminé. Toute l'équipe voit ce qui est réglé.",

  truthReceiving:
    "La réception des textos est gratuite et illimitée sur tous les forfaits. Les photos sont gratuites à recevoir et conservées pour vous ; le stockage est gratuit.",

  fairUseBefore:
    "Les textos et les photos sont inclus sous une politique d'utilisation équitable automatisée, et presque toutes les équipes restent bien à l'intérieur. Les chiffres concrets vivent dans notre",
  fairUseLink: "politique d'utilisation équitable",
  seePricing: "Voir tous les prix. Chaque coût est sur cette page.",
};

const TRADES_COPY = {
  en: tradesEn,
  "fr-CA": tradesFr,
} as const;

export type TradesCopy = typeof tradesEn | typeof tradesFr;

export function tradesCopy(locale: MarketingLocale = "en"): TradesCopy {
  return TRADES_COPY[locale] ?? tradesEn;
}
