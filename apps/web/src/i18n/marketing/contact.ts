import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — the contact page and its form, in both languages.
 *
 * ## Why this page is the first one translated
 *
 * The chrome came first because every page needs it. This is the first page
 * whose own content is translated, and it is the one a Quebec buyer reaches
 * when they want to ask something before they commit — which is the moment
 * being addressed in the wrong language costs the most.
 *
 * ## The validation messages are copy, not plumbing
 *
 * Half the sentences below never appear until something goes wrong: a missing
 * name, an address with no `@`, a message too short, a rate limit. Those are
 * exactly the sentences a half-done translation leaves in English, because
 * nobody sees them while checking the page looks right. They are here for that
 * reason, and `contact-form-logic.ts` now takes them as an argument rather
 * than owning them.
 *
 * ## Register
 *
 * Quebec French, VOUVOIEMENT, and the typographic spaces French punctuation
 * takes — a narrow no-break space before `?` and `:`. The address placeholder
 * is a business name and stays as it is; a translated example name would be
 * inventing a different company.
 */
export const contactEn = {
  breadcrumbHome: "Home",
  breadcrumbSelf: "Contact",
  dateline: "GET IN TOUCH",
  title: "Email us. We answer.",
  intro:
    "No sales team, no runaround. You'll get a reply from one of the people who built Loonext.",

  supportHeading: "Support",
  supportBody: "Questions, billing, anything about your account.",
  securityHeading: "Security and responsible disclosure",
  securityBodyBefore: "Found a vulnerability? See our",
  securityPageLink: "security page",
  securityBodyAfter: ", or email",
  statusHeading: "Service status",
  statusBodyBefore: "Check whether it's us on our",
  statusPageLink: "status page",
  addressHeading: "Mailing address",

  sentHeading: "Thanks, your message was sent.",
  sentBody:
    "We read every message and reply within one business day. If it is urgent, you can also email us at",

  nameLabel: "Your name",
  emailLabel: "Your email",
  businessLabel: "Your business",
  optional: "(optional)",
  businessPlaceholder: "Reyes Plumbing",
  messageLabel: "How can we help?",
  websiteLabel: "Website",
  submit: "Send message",
  submitting: "Sending...",

  mailtoBefore: "Prefer your own email app?",
  mailtoLink: "Write to {email}",
  mailtoAfter: "instead.",

  formError: "Please fix the highlighted fields and try again.",
  nameRequired: "Please enter your name.",
  emailRequired: "Please enter your email address.",
  emailInvalid: "Please enter a valid email address.",
  messageTooShort: "Please write at least {count} characters so we can help.",
  networkError:
    "Your message did not send. Please check your connection and try again.",
  rateLimited:
    "We have received a lot of messages recently. Please try again in a little while.",
  validationFailed:
    "Some of the details need another look. Please check the fields and try again.",
  serverError:
    "Something went wrong on our end and your message did not send. Please try again, or email us at {email}.",
} as const;

export const contactFr: Translated<typeof contactEn> = {
  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Nous joindre",
  dateline: "ÉCRIVEZ-NOUS",
  title: "Écrivez-nous. Nous répondons.",
  intro:
    "Pas d'équipe de vente, pas de détour. Vous aurez une réponse de l'une des personnes qui ont bâti Loonext.",

  supportHeading: "Soutien",
  supportBody: "Questions, facturation, tout ce qui touche votre compte.",
  securityHeading: "Sécurité et divulgation responsable",
  securityBodyBefore: "Vous avez trouvé une vulnérabilité ? Consultez notre",
  securityPageLink: "page sur la sécurité",
  securityBodyAfter: ", ou écrivez à",
  statusHeading: "État du service",
  statusBodyBefore: "Vérifiez si le problème vient de nous sur notre",
  statusPageLink: "page d'état",
  addressHeading: "Adresse postale",

  sentHeading: "Merci, votre message est parti.",
  sentBody:
    "Nous lisons chaque message et répondons en un jour ouvrable. Si c'est urgent, vous pouvez aussi nous écrire à",

  nameLabel: "Votre nom",
  emailLabel: "Votre courriel",
  businessLabel: "Votre entreprise",
  optional: "(facultatif)",
  businessPlaceholder: "Reyes Plumbing",
  messageLabel: "Comment pouvons-nous aider ?",
  websiteLabel: "Site web",
  submit: "Envoyer le message",
  submitting: "Envoi en cours...",

  mailtoBefore: "Vous préférez votre propre application de courriel ?",
  mailtoLink: "Écrivez à {email}",
  mailtoAfter: "plutôt.",

  formError: "Corrigez les champs indiqués et réessayez.",
  nameRequired: "Entrez votre nom.",
  emailRequired: "Entrez votre adresse courriel.",
  emailInvalid: "Entrez une adresse courriel valide.",
  messageTooShort: "Écrivez au moins {count} caractères pour que nous puissions aider.",
  networkError:
    "Votre message n'est pas parti. Vérifiez votre connexion et réessayez.",
  rateLimited:
    "Nous avons reçu beaucoup de messages récemment. Réessayez dans un moment.",
  validationFailed:
    "Certains détails sont à revoir. Vérifiez les champs et réessayez.",
  serverError:
    "Une erreur s'est produite de notre côté et votre message n'est pas parti. Réessayez, ou écrivez-nous à {email}.",
};

const CONTACT_COPY = {
  en: contactEn,
  "fr-CA": contactFr,
} as const;

export type ContactCopy = typeof contactEn | typeof contactFr;

/** The contact page's words for one locale. */
export function contactCopy(locale: MarketingLocale = "en"): ContactCopy {
  return CONTACT_COPY[locale] ?? contactEn;
}
