import type { Translated } from "../translated";

/**
 * D138 Rule 10 — the marketing site's words, in both languages.
 *
 * ## Why marketing has its own catalogue rather than a section in the app's
 *
 * They answer different questions. The app's catalogue is read by ONE signed-in
 * member and follows their setting; this one is read by whoever a link was sent
 * to and follows the URL. Same shape, same completeness type, different source
 * of truth — and merging them would mean the app's bundle carries the trade
 * pages' vocabulary on every screen a crew opens.
 *
 * ## The footer first, and that is deliberate
 *
 * D138 Rule 10 notes that the first page translated also pays for the chrome
 * every later page then gets free. The footer is the cheapest half of that
 * chrome and the easiest to verify: it is a list of labels with no layout
 * judgement in it, so it proves the mechanism without a design argument
 * attached.
 *
 * ## What is NOT translated, and why
 *
 * Product names — Loonext, Heymarket, Quo, Lou — stay as they are. A name
 * somebody has to type into a support email, or search for, must be the name we
 * shipped. `HVAC` stays: it is the trade's name in Quebec too, and "CVC" is the
 * engineering discipline rather than what a crew calls itself.
 *
 * The register is `CommonStrings`': Quebec French, VOUVOIEMENT, accents spelled
 * normally. "Témoins" for cookies, which is the OQLF's word and the one a
 * Quebec reader expects on a legal footer.
 */
export const footerEn = {
  brandLine: "The shared line for your crew.",
  homeAria: "Loonext home",

  headingProduct: "Product",
  headingWhoItsFor: "Who it's for",
  headingCompare: "Compare",
  headingCompanyLegal: "Company and legal",

  sharedInbox: "Shared inbox",
  calls: "Calls and voicemail",
  tasks: "Tasks",
  contacts: "Contacts",
  assistant: "Lou, your assistant",
  businessNumber: "Your business number",
  compliance: "Compliance built in",
  templatesAndTags: "Templates and tags",
  pricing: "Pricing",
  security: "Security",
  accessibility: "Accessibility",
  dpa: "Data processing agreement",
  vulnerability: "Report a vulnerability",
  canada: "Loonext in Canada",

  plumbers: "Plumbers",
  landscapers: "Landscapers",
  cleaners: "Cleaners",
  hvac: "HVAC",
  salons: "Salons",
  contractors: "Contractors",

  compareHeymarket: "Loonext vs Heymarket",
  compareQuo: "Loonext vs Quo",

  blog: "Blog",
  terms: "Terms of service",
  privacy: "Privacy policy",
  cookies: "Cookies",
  aup: "Acceptable use",
  fairUse: "Fair use",
  messaging: "SMS messaging policy",
  subprocessors: "Sub-processors",
  deleteData: "Delete your data",
  guarantee: "30-day guarantee",
  status: "Status",
  contact: "Contact us",

  monthToMonth: "Month to month. No sales calls, ever.",
  rights: "© {year} Loonext. All rights reserved.",
} as const;

export const footerFr: Translated<typeof footerEn> = {
  brandLine: "La ligne partagée de votre équipe.",
  homeAria: "Accueil Loonext",

  headingProduct: "Produit",
  headingWhoItsFor: "Pour qui",
  headingCompare: "Comparer",
  headingCompanyLegal: "L'entreprise et le juridique",

  sharedInbox: "Boîte de réception partagée",
  calls: "Appels et messagerie vocale",
  tasks: "Tâches",
  contacts: "Contacts",
  assistant: "Lou, votre adjoint",
  businessNumber: "Votre numéro d'entreprise",
  compliance: "La conformité intégrée",
  templatesAndTags: "Modèles et étiquettes",
  pricing: "Tarifs",
  security: "Sécurité",
  accessibility: "Accessibilité",
  dpa: "Entente de traitement des données",
  vulnerability: "Signaler une vulnérabilité",
  canada: "Loonext au Canada",

  plumbers: "Plombiers",
  landscapers: "Paysagistes",
  cleaners: "Entreprises de ménage",
  hvac: "HVAC",
  salons: "Salons",
  contractors: "Entrepreneurs",

  compareHeymarket: "Loonext vs Heymarket",
  compareQuo: "Loonext vs Quo",

  blog: "Blogue",
  terms: "Conditions d'utilisation",
  privacy: "Politique de confidentialité",
  cookies: "Témoins",
  aup: "Utilisation acceptable",
  fairUse: "Utilisation équitable",
  messaging: "Politique sur les textos",
  subprocessors: "Sous-traitants",
  deleteData: "Supprimer vos données",
  guarantee: "Garantie de 30 jours",
  status: "État du service",
  contact: "Nous joindre",

  monthToMonth: "De mois en mois. Jamais d'appels de vente.",
  rights: "© {year} Loonext. Tous droits réservés.",
};

/** The two catalogues, by locale. */
export const FOOTER_COPY = {
  en: footerEn,
  "fr-CA": footerFr,
} as const;

export type MarketingLocale = keyof typeof FOOTER_COPY;

/**
 * The footer's words for one locale, with `{year}` substituted.
 *
 * A plain function rather than a context: the footer is a SERVER component
 * rendered by the marketing layout, and the layout knows the language from the
 * route it is serving. A context would mean a client boundary around the one
 * piece of chrome that has no interactivity in it at all.
 */
export function footerCopy(locale: MarketingLocale = "en") {
  return FOOTER_COPY[locale] ?? footerEn;
}
