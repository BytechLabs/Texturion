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
  subscribeHeading: "Get told instead of checking",
  subscribeIntro:
    "We'll email you when there's an incident and again when it's resolved. That's all it is: no newsletter, and one-click unsubscribe on every message.",
  emailAddress: "Email address",
  emailPlaceholder: "you@company.com",
  sending: "Sending...",
  emailMe: "Email me",
  confirmFallback: "Check your email for a link to confirm.",
  errorFallback: "That didn't go through. Try again in a moment.",
  invalidEmail: "That doesn't look like an email address.",
  unavailable: "Status updates by email aren't available right now.",
  listFull: "The status list is full right now. Email support and we'll add you.",
  incidentFallback:
    "A service incident is in progress. We are updating this page as we learn more.",
  confirmEmailSubject: "Confirm your Loonext status updates",
  confirmEmailIntro:
    "You asked to be emailed when Loonext has a service incident.",
  confirmEmailAction: "Confirm that here:",
  confirmEmailIgnore:
    "If that wasn't you, ignore this email — nothing happens until the link is\nopened, and the request expires on its own within a day.",
  incidentEmailSubject: "Loonext service incident",
  incidentEmailBody:
    "This is what's on our status page right now, written by hand as we learn\nmore. We'll email again when it's resolved.",
  resolvedEmailSubject: "Loonext incident resolved",
  resolvedEmailBody:
    "The incident we emailed you about is over. The written report goes on the\nstatus page once we've finished it.",
  unsubscribeLabel: "Unsubscribe",
  subscribedMetadataTitle: "You're subscribed",
  subscribedMetadataDescription:
    "You'll get an email when Loonext has a service incident.",
  subscribedTitle: "You're on the list.",
  subscribedBody:
    "We'll email you when there's a service incident, and again when it's resolved. Nothing else: no newsletter, no product announcements.",
  subscribedDetailBefore:
    "Every one of those emails has an unsubscribe link, and it works in one click with nothing to confirm. If you'd rather we took you off now, email",
  unsubscribedMetadataTitle: "Unsubscribed",
  unsubscribedMetadataDescription: "You're off the Loonext status email list.",
  unsubscribedTitle: "Unsubscribed.",
  unsubscribedBody:
    "You won't get status emails from us again. Your address is gone, not flagged.",
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
  subscribeHeading: "Soyez avisé plutôt que de vérifier",
  subscribeIntro:
    "Nous vous écrirons lorsqu'un incident survient, puis lorsqu'il est réglé. Rien d'autre : aucune infolettre et un désabonnement en un clic dans chaque message.",
  emailAddress: "Adresse courriel",
  emailPlaceholder: "vous@entreprise.ca",
  sending: "Envoi...",
  emailMe: "M'aviser par courriel",
  confirmFallback: "Vérifiez votre courriel pour confirmer votre abonnement.",
  errorFallback: "L'envoi n'a pas fonctionné. Réessayez dans un instant.",
  invalidEmail: "Cette adresse courriel ne semble pas valide.",
  unavailable:
    "Les avis d'état du service par courriel ne sont pas offerts pour le moment.",
  listFull:
    "La liste d'état du service est pleine pour le moment. Écrivez au soutien et nous vous ajouterons.",
  incidentFallback:
    "Un incident de service est en cours. Nous mettons cette page à jour à mesure que nous en apprenons davantage.",
  confirmEmailSubject: "Confirmez vos avis d'état du service Loonext",
  confirmEmailIntro:
    "Vous avez demandé à recevoir un courriel lorsqu'un incident touche le service Loonext.",
  confirmEmailAction: "Confirmez votre abonnement ici :",
  confirmEmailIgnore:
    "Si vous n'avez pas fait cette demande, ignorez ce courriel : rien ne se passe tant que le lien n'est pas ouvert, et la demande expire d'elle-même dans un jour.",
  incidentEmailSubject: "Incident de service Loonext",
  incidentEmailBody:
    "Voici ce qui est affiché sur notre page d'état du service en ce moment. Le texte est mis à jour à la main à mesure que nous en apprenons davantage. Nous vous écrirons de nouveau lorsque l'incident sera réglé.",
  resolvedEmailSubject: "Incident Loonext réglé",
  resolvedEmailBody:
    "L'incident au sujet duquel nous vous avons écrit est terminé. Le rapport écrit sera publié sur la page d'état du service lorsqu'il sera prêt.",
  unsubscribeLabel: "Se désabonner",
  subscribedMetadataTitle: "Abonnement confirmé",
  subscribedMetadataDescription:
    "Vous recevrez un courriel lors d'un incident de service Loonext.",
  subscribedTitle: "Vous êtes sur la liste.",
  subscribedBody:
    "Nous vous écrirons lorsqu'un incident de service survient, puis lorsqu'il est réglé. Rien d'autre : aucune infolettre ni annonce de produit.",
  subscribedDetailBefore:
    "Chacun de ces courriels contient un lien de désabonnement qui fonctionne en un clic, sans confirmation. Si vous préférez que nous vous retirions maintenant, écrivez à",
  unsubscribedMetadataTitle: "Désabonnement confirmé",
  unsubscribedMetadataDescription:
    "Votre adresse a été retirée de la liste d'état du service Loonext.",
  unsubscribedTitle: "Vous êtes désabonné.",
  unsubscribedBody:
    "Vous ne recevrez plus nos courriels sur l'état du service. Votre adresse a été supprimée, pas simplement marquée.",
};

const COPY = { en: statusEn, "fr-CA": statusFr } as const;

export function statusCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? statusEn;
}
