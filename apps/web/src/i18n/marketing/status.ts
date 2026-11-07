import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const statusEn = {
  metadataTitle: "Status",
  metadataDescription:
    "Where Loonext publishes service status for texting, the inbox, and notifications: incident reports as they happen, plus the two things that can look like an outage but aren't.",
  home: "Home",
  breadcrumb: "Status",
  title: "Status.",
  intro:
    "Service status for texting, the inbox, and notifications is published on this page.",
  manualBefore:
    "This page is written by a person, not by an automatic monitor, so it shows what we have posted rather than a live reading. If something looks wrong to you right now and there is nothing here about it,",
  writeToUs: "write to us",
  manualAfter: "That reaches us whether or not this page has caught up.",
  happeningNow: "Happening now",
  happeningNote:
    "Written by hand as we learn more. A full report goes below once it's resolved.",
  reports: "Incident reports",
  lastPosted: "LAST POSTED",
  lastPostedDisplay: "JULY 7, 2026",
  nonePosted: "No incidents posted.",
  reportsNote:
    "When texting, the inbox, or notifications have a problem, the report goes here: what's affected, what we know, and when it's resolved.",
  confirmedBefore:
    "A person last checked texting, the inbox and notifications on",
  stale:
    "Nobody has checked recently enough for us to tell you the service is fine right now, and we would rather say that than show you a date that answers a different question. If something looks wrong to you, write to us.",
  outageHeading: "Looks like an outage, usually isn't",
  usApprovalBefore: "US texting activates after carrier approval, typically",
  usApprovalDays: "3 to 7",
  usApprovalAfter:
    "business days after you pay. If your US texts aren't sending yet, that's the approval wait, not an outage; receiving texts work the whole time.",
  caApproval:
    "Texting Canadian customers works the same day your number is active, with no registration to wait on, so there's no approval delay to mistake for an outage. Receiving texts work right away too.",
  carrier:
    "Delivery depends on the phone companies and carriers, which we don't control. When they have trouble, texts can be delayed even though Loonext is up.",
  brokenBefore: "Seeing something broken that this page doesn't mention? Email",
  brokenAfter: "and a person will take a look.",
  incidentFallback:
    "A service incident is in progress. We are updating this page as we learn more.",
} as const;

export const statusFr: Translated<typeof statusEn> = {
  metadataTitle: "État du service",
  metadataDescription:
    "La page où Loonext publie l'état des textos, de la boîte de réception et des notifications, avec les rapports d'incident et les situations qui peuvent ressembler à une panne.",
  home: "Accueil",
  breadcrumb: "État du service",
  title: "État du service.",
  intro:
    "L'état des textos, de la boîte de réception et des notifications est publié sur cette page.",
  manualBefore:
    "Cette page est rédigée par une personne, pas par un système de surveillance automatique. Elle montre donc ce que nous avons publié, et non une lecture en direct. Si quelque chose semble brisé maintenant et que rien ici n'en parle,",
  writeToUs: "écrivez-nous",
  manualAfter: "Votre message nous parvient même si cette page n'est pas encore à jour.",
  happeningNow: "En cours maintenant",
  happeningNote:
    "Nous mettons ce texte à jour à la main à mesure que nous en apprenons davantage. Un rapport complet paraîtra ci-dessous une fois l'incident réglé.",
  reports: "Rapports d'incident",
  lastPosted: "DERNIÈRE PUBLICATION",
  lastPostedDisplay: "7 JUILLET 2026",
  nonePosted: "Aucun incident publié.",
  reportsNote:
    "Lorsqu'un problème touche les textos, la boîte de réception ou les notifications, le rapport paraît ici : ce qui est touché, ce que nous savons et le moment où le problème est réglé.",
  confirmedBefore:
    "Une personne a vérifié les textos, la boîte de réception et les notifications pour la dernière fois le",
  stale:
    "Personne n'a fait de vérification assez récemment pour que nous affirmions que le service fonctionne bien maintenant. Nous préférons le dire plutôt que d'afficher une date qui répond à une autre question. Si quelque chose semble brisé, écrivez-nous.",
  outageHeading: "Ça ressemble à une panne, mais ce n'en est généralement pas une",
  usApprovalBefore:
    "Les textos vers les États-Unis s'activent après l'approbation des fournisseurs, habituellement",
  usApprovalDays: "3 à 7",
  usApprovalAfter:
    "jours ouvrables après le paiement. Si vos textos américains ne partent pas encore, il s'agit du délai d'approbation, pas d'une panne; la réception fonctionne pendant toute l'attente.",
  caApproval:
    "Les textos aux clients canadiens fonctionnent le jour même où votre numéro devient actif, sans inscription à attendre. Il n'y a donc aucun délai d'approbation à confondre avec une panne. La réception fonctionne tout de suite aussi.",
  carrier:
    "La livraison dépend des compagnies de téléphone et des fournisseurs, que nous ne contrôlons pas. Lorsqu'ils éprouvent un problème, les textos peuvent être retardés même si Loonext fonctionne.",
  brokenBefore: "Vous voyez un problème absent de cette page? Écrivez à",
  brokenAfter: "et une personne vérifiera.",
  incidentFallback:
    "Un incident de service est en cours. Nous mettons cette page à jour à mesure que nous en apprenons davantage.",
};

const COPY = { en: statusEn, "fr-CA": statusFr } as const;

export function statusCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? statusEn;
}
