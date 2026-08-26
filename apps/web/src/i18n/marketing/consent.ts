import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const consentEn = {
  bannerAria: "Cookie choices",
  bannerTitle: "Cookies, your call.",
  bannerBody:
    "We would like to set cookies that show us how people find Loonext and help our ads reach the right folks. Say no and we set none of them. The signed-in app never uses tracking cookies either way.",
  policyLink: "Cookie policy",
  allow: "Allow cookies",
  deny: "No thanks",
  preferencesGranted: "Your current choice: cookies allowed.",
  preferencesDenied: "Your current choice: no optional cookies.",
  preferencesUnset:
    "You have not made a choice yet, so no optional cookies are set.",
} as const;

export const consentFr: Translated<typeof consentEn> = {
  bannerAria: "Choix concernant les témoins",
  bannerTitle: "Les témoins, c'est votre choix.",
  bannerBody:
    "Nous aimerions utiliser des témoins pour savoir comment les gens trouvent Loonext et aider nos publicités à joindre les bonnes personnes. Dites non et nous n'en plaçons aucun. L'application avec ouverture de session n'utilise jamais de témoins de suivi, peu importe votre choix.",
  policyLink: "Politique sur les témoins",
  allow: "Autoriser les témoins",
  deny: "Non merci",
  preferencesGranted: "Votre choix actuel : témoins autorisés.",
  preferencesDenied: "Votre choix actuel : aucun témoin facultatif.",
  preferencesUnset:
    "Vous n'avez pas encore fait de choix; aucun témoin facultatif n'est donc utilisé.",
};

const COPY = { en: consentEn, "fr-CA": consentFr } as const;

export function consentCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? consentEn;
}
