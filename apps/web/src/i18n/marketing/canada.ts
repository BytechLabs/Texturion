import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 Rule 9 — /canada, the page a Quebec buyer is most likely to land on.
 *
 * ## The acronyms are the tell
 *
 * Canada's anti-spam law is CASL in English and **LCAP** in French — Loi
 * canadienne anti-pourriel. The federal privacy act is PIPEDA and **LPRPDE**.
 * A French page that says "CASL" and "PIPEDA" has been translated word by word
 * by somebody who does not work here, and a Quebec business searching for its
 * obligations is searching for the French names. Both appear with the English
 * in brackets on first use, because the English is what the reader will see on
 * a US vendor's site next.
 *
 * Law 25 keeps its number: it is `Loi 25` in French and "Quebec's Law 25" in
 * English, and the number is the name.
 *
 * ## The careful sentence is careful in both
 *
 * "Loonext HELPS YOU FOLLOW CASL, it does not make you CASL-compliant" is a
 * claim the whole page is built around not overstating — SPEC and the page's
 * own docblock both say so. The French has to hold the same line: *vous aide à
 * respecter* rather than *vous rend conforme*. A translation that softened
 * that into "makes you compliant" would be a legal claim we do not make, in a
 * language the person reviewing it may not read.
 *
 * ## Provinces
 *
 * The ledger's row labels are place names with official French forms —
 * Colombie-Britannique, Nouvelle-Écosse, Île-du-Prince-Édouard,
 * Terre-Neuve-et-Labrador. These are not optional stylings; they are the names
 * of the places, and Canada Post uses them.
 */
export const canadaEn = {
  timelineDayZero: "Day 0",
  heroPriceAfter: "a month for the whole team, flat.",
  truthPlansBefore: "The same flat plans as everyone:",
  truthFeeBefore:
    "A Canadian business texting Canadian customers pays no registration fee and waits for nothing. The one-time",
  truthFeeAfter:
    "fee and the 3 to 7 business day approval only ever apply if you choose to enable US texting later. A Canadian workspace is billed in Canadian dollars, plus sales tax where it applies.",
  metaTitle: "Business texting in Canada: text customers today",
  metaDescription:
    "Canadian crews text customers the day they sign up. No US carrier registration to wait on, local numbers in every province, CASL-aware consent records. Billed in Canadian dollars, one flat price for the crew.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Canada",

  dateline: "DAY ONE · NO WAIT",
  h1: "In Canada? You can text customers today.",

  timelineLiveTitle: "You're live. That's the whole timeline.",
  timelineLiveBody:
    "Your number is up. Receiving texts works. Texting Canadian customers works. Invite the crew and start today.",
  timelineReviewTitle: "Days 1 to 7 · US carrier review",
  timelineReviewBody:
    "Doesn't apply here. A Canadian business texting Canadian customers has no registration to wait on, so this segment does not exist.",

  heroBody:
    "The US phone-company registration that makes American shops wait about a week doesn't apply to a Canadian business texting Canadian customers. So on Loonext, you pick a local number, invite the crew, and start texting the same day you sign up. One shared inbox,",

  noWaitEyebrow: "Why there's no wait",
  noWaitTitle: "No registration wait. Just text.",
  noWaitBodyOne:
    "Here's the whole reason, in one plain sentence: the phone-company registration that US texting requires, the thing that adds 3 to 7 business days for American shops, isn't required for a Canadian business texting Canadian customers. No brand-and-campaign approval to sit through, no carrier review, no countdown banner. Your number is live, and it can send.",
  noWaitBodyTwo:
    "That's not a workaround or a trial mode; it's how the rules work north of the border, and Loonext is built to take advantage of it. Pick your number, add your crew, put “call or text” on your trucks, and you're in business the same afternoon.",

  numbersEyebrow: "Local numbers",
  numbersTitle: "A local number, in every province.",
  numbersBodyOne:
    "Type your city at signup and Loonext finds you a matching local number: a (416) or a (647) in Toronto, a (604) in Vancouver, a (403) in Calgary, a (902) in Halifax. A customer in your city sees a number that looks like it's from their city, because it is.",
  numbersBodyTwo:
    "Local numbers are available across every province, and the ledger here is generated from the same numbering data the app assigns from, so it stays true as codes are added.",
  ledgerCaption:
    "Area codes from the North American Numbering Plan, the same table the app picks your number from.",
  ledgerProvinceHeading: "Province",
  ledgerCodesHeading: "Local area codes",

  caslEyebrow: "CASL-aware",
  caslTitle: "Built to help you follow CASL.",
  caslBody:
    "CASL is Canada's anti-spam law, and Loonext is built with it in mind. A customer who texts you first is recorded as having consented the moment their text arrives. Starting a new conversation stamps a consent record with a name and a date. And when a customer texts STOP, they're opted out instantly, with any future send to that number blocked before it leaves the app.",
  caslCarefulBefore: "We're careful with the words here: Loonext",
  caslCarefulEmphasis: "helps you follow",
  caslCarefulAfter:
    "CASL, it doesn't make you “CASL-compliant”, because staying within the law also depends on you only texting people who actually agreed to hear from you. We keep the records and enforce the opt-outs; you bring the real list.",
  consentPanelCaption:
    "The consent record on each contact: how it came to be, who recorded it, and when.",
  consentPanelAlt:
    "Two Loonext contacts showing their CASL-relevant consent records",

  usEyebrow: "Texting the US later",
  usTitle: "Want to text US customers too? Turn it on any time.",
  usBodyBefore:
    "Plenty of Canadian shops have customers, suppliers, or a second location across the border. When you're ready, enable US texting from settings: the one-time",
  usBodyAfter:
    "registration fee and the 3 to 7 business day carrier approval apply then, the same wait US shops have. Until you enable it, you never pay the fee and never wait, and everything you've built stays exactly as it is.",
  dataBody:
    "And a plain word about where your data lives: it's stored and processed in the United States, and our privacy policy discloses the cross-border transfer the way PIPEDA and Quebec's Law 25 expect. Message content stays out of our analytics and error logs.",

  truthEyebrow: "Stated plainly",
  truthDayOne:
    "Texting Canadian customers works day one. No registration, no fee, no wait.",
  truthBilling:
    "A Canadian workspace is billed in Canadian dollars, plus tax. The price doesn't move with the exchange rate, and a Canadian card picks up no foreign-transaction fee.",
  truthData:
    "Your data is stored in the United States, and the privacy policy says so plainly.",

  relatedTitle: "A shared inbox for Canadian crews",
  relatedBody:
    "Day-one texting is the headline; the shared inbox, the numbers, and the compliance handling are what you use every day.",
  relatedNumberTitle: "Your business number",
  relatedNumberBody:
    "Local Canadian numbers in every province, from the same numbering data.",
  relatedComplianceTitle: "Compliance built in",
  relatedComplianceBody: "Consent records and opt-out enforcement, in depth.",
  relatedCleanersTitle: "Texting for cleaners",
  relatedCleanersBody:
    "Recurring confirmations and reschedules, for Canadian cleaning crews.",
  relatedLandscapersTitle: "Texting for landscapers",
  relatedLandscapersBody:
    "Seasonal quote volume across sites, texting the same day you sign up.",

  faqTitle: "Canada questions, straight answers.",
  faqSameDayQ: "Can I really text customers the same day I sign up?",
  faqSameDayA:
    "Yes, if you're a Canadian business texting Canadian customers. The US carrier registration that makes American shops wait about a week doesn't apply to Canada-to-Canada texting, so your number can send as soon as it's active, usually a minute or two after you subscribe.",
  faqNumberQ: "Do I get a real Canadian number?",
  faqNumberA:
    "Yes, a local number in the area code you choose, available across every province. The ledger on this page comes from the same numbering data the app assigns your number from.",
  faqCaslQ: "Does Loonext make me CASL-compliant?",
  faqCaslA:
    "It helps you follow CASL; that's the accurate phrasing. Loonext records consent and enforces opt-outs, which are the mechanics CASL cares about. Staying compliant also depends on you only texting people who agreed to hear from you, which is on you, not the tool.",
  faqDataQ: "Where is my data stored?",
  faqDataA:
    "In the United States. We state this plainly and disclose the cross-border transfer in our privacy policy, the way PIPEDA and Quebec's Law 25 expect. Message content is also kept out of our analytics and error logs; the details are on our security page.",
  faqCurrencyQ: "I bill in Canada. Can I pay in Canadian dollars?",
  faqCurrencyA:
    "Yes. A Canadian workspace is billed in Canadian dollars, so the amount on your statement is the amount on the page, your bank isn't converting anything, and the bill doesn't drift up and down with the exchange rate. The currency comes from your country when you subscribe and is fixed on the subscription from then on, so switching it later is a support conversation rather than a setting.",

  ctaTitle: "Text your Canadian customers today.",
  ctaBody:
    "Pick a local number, invite the crew, and start texting the same afternoon. No registration wait, no sales call, month to month.",

  provinceBc: "British Columbia",
  provinceAb: "Alberta",
  provinceSk: "Saskatchewan",
  provinceMb: "Manitoba",
  provinceOn: "Ontario",
  provinceQc: "Quebec",
  provinceNb: "New Brunswick",
  provinceNs: "Nova Scotia",
  provincePe: "Prince Edward Island",
  provinceNl: "Newfoundland and Labrador",
  provinceTerritories: "Yukon, Northwest Territories, Nunavut",
} as const;

export const canadaFr: Translated<typeof canadaEn> = {
  timelineDayZero: "Jour 0",
  heroPriceAfter: "par mois pour toute l'équipe, prix fixe.",
  truthPlansBefore: "Les mêmes forfaits fixes que tout le monde :",
  truthFeeBefore:
    "Une entreprise canadienne qui écrit à des clients canadiens ne paie aucuns frais d'inscription et n'attend rien. Les frais uniques de",
  truthFeeAfter:
    "et l'approbation des transporteurs de 3 à 7 jours ouvrables ne s'appliquent que si vous choisissez d'activer la messagerie texte américaine plus tard. Un espace de travail canadien est facturé en dollars canadiens, plus les taxes de vente là où elles s'appliquent.",
  metaTitle: "Textos d'entreprise au Canada : écrivez à vos clients dès aujourd'hui",
  metaDescription:
    "Les équipes canadiennes écrivent à leurs clients le jour de leur inscription. Aucune inscription auprès des transporteurs américains à attendre, des numéros locaux dans chaque province, des consentements notés selon la LCAP. Facturé en dollars canadiens, un seul prix fixe pour toute l'équipe.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Canada",

  dateline: "JOUR UN · AUCUNE ATTENTE",
  h1: "Au Canada ? Vous pouvez écrire à vos clients aujourd'hui.",

  timelineLiveTitle: "Vous êtes en ligne. C'est tout l'échéancier.",
  timelineLiveBody:
    "Votre numéro est actif. La réception des textos fonctionne. Écrire à des clients canadiens fonctionne. Invitez l'équipe et commencez aujourd'hui.",
  timelineReviewTitle: "Jours 1 à 7 · examen des transporteurs américains",
  timelineReviewBody:
    "Ne s'applique pas ici. Une entreprise canadienne qui écrit à des clients canadiens n'a aucune inscription à attendre, alors cette étape n'existe pas.",

  heroBody:
    "L'inscription auprès des compagnies de téléphone américaines, celle qui fait attendre environ une semaine aux commerces des États-Unis, ne s'applique pas à une entreprise canadienne qui écrit à des clients canadiens. Sur Loonext, vous choisissez un numéro local, vous invitez l'équipe et vous commencez à écrire le jour même de votre inscription. Une seule boîte de réception partagée,",

  noWaitEyebrow: "Pourquoi il n'y a pas d'attente",
  noWaitTitle: "Aucune attente d'inscription. Écrivez, tout simplement.",
  noWaitBodyOne:
    "Voici toute la raison, en une phrase simple : l'inscription auprès des compagnies de téléphone qu'exige la messagerie texte américaine, celle qui ajoute de 3 à 7 jours ouvrables pour les commerces des États-Unis, n'est pas exigée d'une entreprise canadienne qui écrit à des clients canadiens. Aucune approbation de marque et de campagne à subir, aucun examen des transporteurs, aucune bannière de compte à rebours. Votre numéro est actif, et il peut envoyer.",
  noWaitBodyTwo:
    "Ce n'est ni un contournement ni un mode d'essai : c'est ainsi que fonctionnent les règles au nord de la frontière, et Loonext est bâti pour en profiter. Choisissez votre numéro, ajoutez votre équipe, écrivez « appelez ou textez » sur vos camions, et vous êtes en affaires le jour même.",

  numbersEyebrow: "Numéros locaux",
  numbersTitle: "Un numéro local, dans chaque province.",
  numbersBodyOne:
    "Tapez votre ville à l'inscription et Loonext vous trouve un numéro local correspondant : un (416) ou un (647) à Toronto, un (604) à Vancouver, un (403) à Calgary, un (902) à Halifax. Un client de votre ville voit un numéro qui a l'air de venir de sa ville, parce que c'est le cas.",
  numbersBodyTwo:
    "Des numéros locaux sont offerts dans chaque province, et le tableau ci-dessous est généré à partir des mêmes données de numérotation que l'application utilise pour vous attribuer un numéro, alors il reste exact à mesure que des indicatifs s'ajoutent.",
  ledgerCaption:
    "Indicatifs régionaux tirés du Plan de numérotation nord-américain, la même table que l'application utilise pour choisir votre numéro.",
  ledgerProvinceHeading: "Province",
  ledgerCodesHeading: "Indicatifs régionaux locaux",

  caslEyebrow: "Pensé pour la LCAP",
  caslTitle: "Bâti pour vous aider à respecter la LCAP.",
  caslBody:
    "La LCAP (CASL) est la loi canadienne anti-pourriel, et Loonext est bâti en tenant compte d'elle. Un client qui vous écrit en premier est noté comme ayant consenti dès l'arrivée de son texto. Lancer une nouvelle conversation appose un consentement avec un nom et une date. Et quand un client texte STOP, il est retiré immédiatement, et tout envoi futur à ce numéro est bloqué avant de quitter l'application.",
  caslCarefulBefore: "Nous choisissons nos mots ici : Loonext",
  caslCarefulEmphasis: "vous aide à respecter",
  caslCarefulAfter:
    "la LCAP, il ne vous rend pas « conforme à la LCAP », parce que rester dans la légalité dépend aussi de vous : n'écrire qu'aux gens qui ont vraiment accepté d'avoir de vos nouvelles. Nous gardons les registres et appliquons les retraits ; vous apportez la vraie liste.",
  consentPanelCaption:
    "Le consentement noté sur chaque contact : comment il est né, qui l'a noté, et quand.",
  consentPanelAlt:
    "Deux contacts Loonext montrant leurs consentements pertinents pour la LCAP",

  usEyebrow: "Écrire aux États-Unis plus tard",
  usTitle: "Vous voulez aussi écrire à des clients américains ? Activez-le quand vous voulez.",
  usBodyBefore:
    "Beaucoup de commerces canadiens ont des clients, des fournisseurs ou une deuxième adresse de l'autre côté de la frontière. Quand vous serez prêt, activez la messagerie texte américaine dans les réglages : les frais d'inscription uniques de",
  usBodyAfter:
    "et l'approbation des transporteurs de 3 à 7 jours ouvrables s'appliquent alors, la même attente que les commerces américains. Tant que vous ne l'activez pas, vous ne payez jamais ces frais et vous n'attendez jamais, et tout ce que vous avez bâti reste exactement tel quel.",
  dataBody:
    "Et un mot simple sur l'endroit où vivent vos données : elles sont stockées et traitées aux États-Unis, et notre politique de confidentialité divulgue le transfert transfrontalier comme la LPRPDE (PIPEDA) et la Loi 25 du Québec l'exigent. Le contenu des messages reste à l'écart de nos statistiques et de nos journaux d'erreurs.",

  truthEyebrow: "Dit clairement",
  truthDayOne:
    "Écrire à des clients canadiens fonctionne dès le premier jour. Aucune inscription, aucuns frais, aucune attente.",
  truthBilling:
    "Un espace de travail canadien est facturé en dollars canadiens, plus les taxes. Le prix ne bouge pas avec le taux de change, et une carte canadienne n'attrape aucuns frais de transaction à l'étranger.",
  truthData:
    "Vos données sont stockées aux États-Unis, et la politique de confidentialité le dit clairement.",

  relatedTitle: "Une boîte de réception partagée pour les équipes canadiennes",
  relatedBody:
    "Écrire dès le premier jour, c'est le titre ; la boîte partagée, les numéros et la gestion de la conformité, c'est ce qui sert tous les jours.",
  relatedNumberTitle: "Votre numéro d'entreprise",
  relatedNumberBody:
    "Des numéros canadiens locaux dans chaque province, à partir des mêmes données de numérotation.",
  relatedComplianceTitle: "La conformité intégrée",
  relatedComplianceBody:
    "Les consentements notés et les retraits appliqués, en détail.",
  relatedCleanersTitle: "Les textos pour les entreprises de ménage",
  relatedCleanersBody:
    "Confirmations récurrentes et reports, pour les équipes de ménage canadiennes.",
  relatedLandscapersTitle: "Les textos pour les paysagistes",
  relatedLandscapersBody:
    "Le volume de soumissions saisonnier sur plusieurs chantiers, en écrivant le jour même de votre inscription.",

  faqTitle: "Questions sur le Canada, réponses directes.",
  faqSameDayQ: "Puis-je vraiment écrire à des clients le jour de mon inscription ?",
  faqSameDayA:
    "Oui, si vous êtes une entreprise canadienne qui écrit à des clients canadiens. L'inscription auprès des transporteurs américains, celle qui fait attendre environ une semaine aux commerces des États-Unis, ne s'applique pas aux textos du Canada vers le Canada. Votre numéro peut donc envoyer dès qu'il est actif, en général une minute ou deux après votre abonnement.",
  faqNumberQ: "Est-ce que j'obtiens un vrai numéro canadien ?",
  faqNumberA:
    "Oui, un numéro local dans l'indicatif régional de votre choix, offert dans chaque province. Le tableau de cette page provient des mêmes données de numérotation que l'application utilise pour vous attribuer votre numéro.",
  faqCaslQ: "Est-ce que Loonext me rend conforme à la LCAP ?",
  faqCaslA:
    "Il vous aide à respecter la LCAP ; c'est la formulation exacte. Loonext note les consentements et applique les retraits, ce sont les mécanismes qui intéressent la LCAP. Rester conforme dépend aussi de vous : n'écrire qu'aux gens qui ont accepté d'avoir de vos nouvelles, ce qui vous revient, pas à l'outil.",
  faqDataQ: "Où sont stockées mes données ?",
  faqDataA:
    "Aux États-Unis. Nous le disons clairement et nous divulguons le transfert transfrontalier dans notre politique de confidentialité, comme la LPRPDE (PIPEDA) et la Loi 25 du Québec l'exigent. Le contenu des messages est aussi tenu à l'écart de nos statistiques et de nos journaux d'erreurs ; les détails se trouvent sur notre page sur la sécurité.",
  faqCurrencyQ: "Je facture au Canada. Puis-je payer en dollars canadiens ?",
  faqCurrencyA:
    "Oui. Un espace de travail canadien est facturé en dollars canadiens : le montant sur votre relevé est le montant affiché sur la page, votre banque ne convertit rien, et la facture ne monte ni ne descend avec le taux de change. La devise vient de votre pays au moment de l'abonnement et reste fixée sur l'abonnement par la suite, alors en changer plus tard passe par le soutien plutôt que par un réglage.",

  ctaTitle: "Écrivez à vos clients canadiens dès aujourd'hui.",
  ctaBody:
    "Choisissez un numéro local, invitez l'équipe et commencez à écrire le jour même. Aucune attente d'inscription, aucun appel de vente, de mois en mois.",

  provinceBc: "Colombie-Britannique",
  provinceAb: "Alberta",
  provinceSk: "Saskatchewan",
  provinceMb: "Manitoba",
  provinceOn: "Ontario",
  provinceQc: "Québec",
  provinceNb: "Nouveau-Brunswick",
  provinceNs: "Nouvelle-Écosse",
  provincePe: "Île-du-Prince-Édouard",
  provinceNl: "Terre-Neuve-et-Labrador",
  provinceTerritories: "Yukon, Territoires du Nord-Ouest, Nunavut",
};

const CANADA_COPY = {
  en: canadaEn,
  "fr-CA": canadaFr,
} as const;

export type CanadaCopy = typeof canadaEn | typeof canadaFr;

export function canadaCopy(locale: MarketingLocale = "en"): CanadaCopy {
  return CANADA_COPY[locale] ?? canadaEn;
}
