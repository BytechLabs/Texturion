import type { Translated } from "../translated";

/**
 * D138 Rule 10 — the marketing nav's words, in both languages.
 *
 * The other half of the chrome the footer started. Between them they are what
 * every `/fr` page will need before it can have any content of its own.
 *
 * ## The shape, and why the English constants survive it
 *
 * `nav-links.ts` exports `productMenu`, `PRIMARY_CTA_LABEL` and friends as
 * plain values, and two things read them: the pricing page, and
 * `chrome.test.tsx`, which asserts every feature route appears in the nav.
 * Those exports stay exactly as they are — but they are now BUILT from this
 * file's English half rather than typed beside it, so there is one definition
 * of each sentence and the href-coverage test keeps testing hrefs rather than
 * language.
 *
 * ## What is not translated
 *
 * The product names — Loonext, Lou, Heymarket, Quo — and `HVAC`, for the
 * reasons `footer.ts` gives. The competitor figure in the Heymarket line is a
 * price, and it moves: French Canadian writes it `49 $` with the sign after the
 * number and a space before it, which is the OQLF's rule and what a Quebec
 * reader expects on an invoice.
 */
export const navEn = {
  menuProduct: "Product",
  menuTrades: "Who it's for",
  menuCompare: "Compare",

  sharedInbox: "Shared inbox",
  sharedInboxDesc: "Every text in one inbox the whole crew can see.",
  calls: "Calls and voicemail",
  callsDesc: "Calls ring the whole crew. Missed ones get written down.",
  businessNumber: "Your business number",
  businessNumberDesc: "A local number that belongs to the business, not a phone.",
  assistant: "Lou, your assistant",
  assistantDesc: "Drafts replies and writes voicemails down. Never sends.",
  tasks: "Tasks",
  tasksDesc: "A text or a call becomes a job with an owner and a date.",
  contacts: "Contacts",
  contactsDesc: "Every text, call and job for one customer, on one timeline.",
  compliance: "Compliance built in",
  complianceDesc: "Registration, opt-outs, and consent, handled for you.",
  templatesAndTags: "Templates and tags",
  templatesAndTagsDesc: "Saved replies and tags that match how you sell.",

  plumbers: "Plumbers",
  plumbersDesc: "Photo triage and on-my-way texts, off your personal cell.",
  hvac: "HVAC",
  hvacDesc: "Triage the no-heat rush without missing a booking.",
  landscapers: "Landscapers",
  landscapersDesc: "Gate codes, reschedules, and add-on asks in one thread.",
  cleaners: "Cleaners",
  cleanersDesc: "Access notes, confirmations, and reschedules.",
  salons: "Salons",
  salonsDesc: "Confirmations, waitlist fills, and fewer no-shows.",
  contractors: "Contractors",
  contractorsDesc: "Change orders and decisions, in writing, on the record.",

  compareHeymarket: "Loonext vs Heymarket",
  compareHeymarketDesc: "One flat price for the crew vs $49 a person.",
  compareQuo: "Loonext vs Quo",
  compareQuoDesc: "Flat beats per-user, with texts included.",

  pricing: "Pricing",
  pricingDesc: "One flat price a month for the whole crew.",
  contact: "Contact",
  contactDesc: "Questions before you start? Email us, no sales team.",

  ctaPrimary: "Get your number",
  ctaSecondary: "See pricing",
} as const;

export const navFr: Translated<typeof navEn> = {
  menuProduct: "Produit",
  menuTrades: "Pour qui",
  menuCompare: "Comparer",

  sharedInbox: "Boîte de réception partagée",
  sharedInboxDesc: "Tous les textos dans une boîte que toute l'équipe voit.",
  calls: "Appels et messagerie vocale",
  callsDesc: "Les appels sonnent chez toute l'équipe. Les manqués sont écrits.",
  businessNumber: "Votre numéro d'entreprise",
  businessNumberDesc: "Un numéro local qui appartient à l'entreprise, pas à un téléphone.",
  assistant: "Lou, votre adjoint",
  assistantDesc: "Rédige des réponses et écrit les messages vocaux. N'envoie jamais.",
  tasks: "Tâches",
  tasksDesc: "Un texto ou un appel devient un travail avec un responsable et une date.",
  contacts: "Contacts",
  contactsDesc: "Chaque texto, appel et travail d'un client, sur une seule ligne du temps.",
  compliance: "La conformité intégrée",
  complianceDesc: "L'inscription, les désabonnements et le consentement, gérés pour vous.",
  templatesAndTags: "Modèles et étiquettes",
  templatesAndTagsDesc: "Des réponses enregistrées et des étiquettes qui suivent votre façon de vendre.",

  plumbers: "Plombiers",
  plumbersDesc: "Le tri par photo et les textos « en route », sans votre cellulaire personnel.",
  hvac: "HVAC",
  hvacDesc: "Triez la ruée des pannes de chauffage sans manquer un rendez-vous.",
  landscapers: "Paysagistes",
  landscapersDesc: "Codes de barrière, reports et demandes supplémentaires dans un seul fil.",
  cleaners: "Entreprises de ménage",
  cleanersDesc: "Notes d'accès, confirmations et reports.",
  salons: "Salons",
  salonsDesc: "Confirmations, listes d'attente comblées et moins de rendez-vous manqués.",
  contractors: "Entrepreneurs",
  contractorsDesc: "Les changements et les décisions, par écrit, au dossier.",

  compareHeymarket: "Loonext vs Heymarket",
  compareHeymarketDesc: "Un prix fixe pour toute l'équipe contre 49 $ par personne.",
  compareQuo: "Loonext vs Quo",
  compareQuoDesc: "Le prix fixe bat le prix par personne, textos inclus.",

  pricing: "Tarifs",
  pricingDesc: "Un seul prix fixe par mois pour toute l'équipe.",
  contact: "Nous joindre",
  contactDesc: "Des questions avant de commencer ? Écrivez-nous, sans équipe de vente.",

  ctaPrimary: "Obtenez votre numéro",
  ctaSecondary: "Voir les tarifs",
};

const NAV_COPY = {
  en: navEn,
  "fr-CA": navFr,
} as const;

export type NavCopyLocale = keyof typeof NAV_COPY;
export type NavCopy = typeof navEn | typeof navFr;

/** The nav's words for one locale. */
export function navCopy(locale: NavCopyLocale = "en"): NavCopy {
  return NAV_COPY[locale] ?? navEn;
}
