import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const unsubscribeEn = {
  metadataTitle: "Unsubscribe",
  metadataDescription: "Remove this address from Loonext product email.",
  doneTitle: "Done. You are unsubscribed.",
  workingTitle: "Unsubscribing you",
  working:
    "One moment. You do not need to do anything else.",
  done:
    "We will not email you about the product again. Anything to do with an account you hold with us, like a receipt or a security notice, is separate and keeps working.",
  failed:
    "We could not complete that automatically. Reply to any email from us and a person will take you off the list.",
} as const;

export const unsubscribeFr: Translated<typeof unsubscribeEn> = {
  metadataTitle: "Se désabonner",
  metadataDescription:
    "Retirer cette adresse des courriels de produit Loonext.",
  doneTitle: "C'est fait. Vous êtes désabonné.",
  workingTitle: "Désabonnement en cours",
  working: "Un instant. Vous n'avez rien d'autre à faire.",
  done:
    "Nous ne vous écrirons plus au sujet du produit. Les messages liés à un compte que vous détenez chez nous, comme un reçu ou un avis de sécurité, sont distincts et continueront de fonctionner.",
  failed:
    "Nous n'avons pas pu terminer automatiquement. Répondez à l'un de nos courriels et une personne vous retirera de la liste.",
};

const COPY = { en: unsubscribeEn, "fr-CA": unsubscribeFr } as const;

export function unsubscribeCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? unsubscribeEn;
}
