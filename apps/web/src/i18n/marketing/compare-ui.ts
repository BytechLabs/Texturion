import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const compareUiEn = {
  perMonth: "/mo",
  person: "person",
  people: "people",
  startForBefore: "Start for",
  startForAfter: "flat →",
  sliderSourceRate: "The {rival} plan shown costs {rate} per person per month {asOf}.",
  sliderSourceLink: "See the comparison.",
  lineItem: "Line item",
  ctaMicrocopy: "$29/MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK",
  formInvalid: "Enter an email address we can send it to.",
  formConsent: "Tick the box so we know you are happy to be emailed.",
  formBusy:
    "We have had a lot of these today. Try again tomorrow.",
  formError: "That did not go through. Try again in a moment.",
  formSent:
    "Sent. It should be in your inbox in a moment, and every message we send has a one-click unsubscribe.",
  formRecorded:
    "Noted, and thank you. We are not sending marketing email yet, so you will hear from us only once there is something worth sending.",
  formLabel: "Send these numbers to",
  formPlaceholder: "you@yourbusiness.com",
  formSending: "Sending...",
  formSubmit: "Email it to me",
  formWebsite: "Website",
  consent:
    "Email me this comparison. I understand Loonext may email me about the product, and I can unsubscribe from any message.",
} as const;

export const compareUiFr: Translated<typeof compareUiEn> = {
  perMonth: "/mois",
  person: "personne",
  people: "personnes",
  startForBefore: "Commencez à",
  startForAfter: "au prix fixe →",
  sliderSourceRate: "Le forfait {rival} présenté coûte {rate} par personne par mois {asOf}.",
  sliderSourceLink: "Voir la comparaison.",
  lineItem: "Poste",
  ctaMicrocopy: "29 $ US/MOIS · DE MOIS EN MOIS · REMBOURSÉ SOUS 30 JOURS",
  formInvalid: "Entrez une adresse courriel où nous pouvons l'envoyer.",
  formConsent: "Cochez la case pour confirmer que vous acceptez ce courriel.",
  formBusy:
    "Nous avons reçu beaucoup de demandes aujourd'hui. Réessayez demain.",
  formError: "L'envoi n'a pas fonctionné. Réessayez dans un instant.",
  formSent:
    "Envoyé. Le message devrait arriver sous peu, et chacun de nos courriels contient un lien de désabonnement en un clic.",
  formRecorded:
    "C'est noté, merci. Nous n'envoyons pas encore de courriels de marketing; vous aurez de nos nouvelles seulement lorsqu'il y aura quelque chose d'utile à envoyer.",
  formLabel: "Envoyer ces chiffres à",
  formPlaceholder: "vous@votreentreprise.ca",
  formSending: "Envoi...",
  formSubmit: "Me l'envoyer",
  formWebsite: "Site Web",
  consent:
    "Envoyez-moi cette comparaison. Je comprends que Loonext peut m'écrire au sujet du produit et que je peux me désabonner de chaque message.",
};

const COPY = { en: compareUiEn, "fr-CA": compareUiFr } as const;

export function compareUiCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? compareUiEn;
}
