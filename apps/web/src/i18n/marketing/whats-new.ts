import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const whatsNewEn = {
  metadataTitle: "What's new",
  metadataDescription:
    "What shipped in Loonext recently, in plain English: saved views, quote reporting, voicemail transcripts, calling in the app.",
  home: "Home",
  breadcrumb: "What's new",
  title: "What's new",
  intro:
    "Everything here has already shipped and is in the product now. We do not list what we are planning: a roadmap dressed up as news is how a page like this stops being worth reading.",
  closing:
    "Smaller repairs ship most days and are not listed here. If you reported something and want to know where it got to, reply to the thread you reported it on and we will tell you.",
} as const;

export const whatsNewFr: Translated<typeof whatsNewEn> = {
  metadataTitle: "Nouveautés",
  metadataDescription:
    "Les nouveautés récemment livrées dans Loonext : vues enregistrées, rapports de soumissions, transcription de messages vocaux et appels dans l'application.",
  home: "Accueil",
  breadcrumb: "Nouveautés",
  title: "Nouveautés",
  intro:
    "Tout ce qui se trouve ici est déjà livré et offert dans le produit. Nous n'énumérons pas nos projets : une feuille de route déguisée en nouvelles finit par rendre une page comme celle-ci inutile.",
  closing:
    "De petites réparations sont livrées presque chaque jour et ne figurent pas ici. Si vous avez signalé un problème et voulez savoir où il en est, répondez au fil où vous l'avez signalé et nous vous le dirons.",
};

const COPY = { en: whatsNewEn, "fr-CA": whatsNewFr } as const;

export function whatsNewCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? whatsNewEn;
}
