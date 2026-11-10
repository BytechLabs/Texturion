import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalDpaEn = {
  metaTitle: "Data processing agreement",
  metaDescription:
    "The Loonext DPA: roles, sub-processors, breach notification within 72 hours, deletion, and the three things we do not promise because the product cannot deliver them.",
  title: "Data processing agreement",
  breadcrumbLabel: "Data processing agreement",
  lastUpdated: "August 16, 2026",
  summary:
    "We act as a processor for the customer content your workspace sends and receives. This says what we do with it, who else touches it, what happens when you delete it, and how quickly we tell you if something goes wrong. It has not been reviewed by outside counsel, and it deliberately does not promise a data residency guarantee, complete deletion, or an audit right, because the product cannot deliver those and a contract that says otherwise is worse than none.",
  sectionContact: "Contact",
  contact:
    "Questions about this agreement, or a redline from your legal team, go to {supportEmail}. A buyer whose counsel wants to mark this up is welcome to; the facts in it are checkable and will survive the exercise.",
} as const;

export const legalDpaFr: Translated<typeof legalDpaEn> = {
  metaTitle: "Entente de traitement des données",
  metaDescription:
    "L'entente de traitement des données de Loonext : rôles, sous-traitants ultérieurs, avis de violation dans les 72 heures, suppression, et les trois choses que nous ne promettons pas parce que le produit ne peut pas les offrir.",
  title: "Entente de traitement des données",
  breadcrumbLabel: "Entente de traitement des données",
  lastUpdated: "16 août 2026",
  summary:
    "Nous agissons à titre de sous-traitant à l'égard du contenu client que votre espace de travail envoie et reçoit. Cette entente dit ce que nous en faisons, qui d'autre y touche, ce qui se passe lorsque vous le supprimez et en combien de temps nous vous avisons si quelque chose tourne mal. Elle n'a pas été révisée par un conseiller juridique externe, et elle ne promet délibérément ni garantie de résidence des données, ni suppression complète, ni droit d'audit, parce que le produit ne peut pas les offrir et qu'un contrat qui affirme le contraire est pire que l'absence de contrat.",
  sectionContact: "Nous joindre",
  contact:
    "Les questions sur la présente entente, ou une version annotée de votre service juridique, sont à envoyer à {supportEmail}. L'acheteur dont les conseillers juridiques veulent l'annoter est le bienvenu; les faits qu'elle contient sont vérifiables et résisteront à l'exercice.",
};

const COPY = { en: legalDpaEn, "fr-CA": legalDpaFr } as const;

export function legalDpaCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalDpaEn;
}
