import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /features/business-number, in both languages.
 *
 * ## The page is mostly about limits, and the limits are dated
 *
 * A port takes days to two weeks. US texting turns on after 3 to 7 business
 * days. A sole proprietor without an EIN gets one number whatever they pay.
 * Every one of those is a constraint somebody else imposes on us, and the page
 * exists to state them before a buyer discovers them. The French says each as
 * plainly: *personne ne peut honnêtement promettre un transfert instantané,
 * alors nous ne le faisons pas*.
 *
 * `EIN` stays. It is the name of a US federal number a Canadian reader will
 * either not need or will meet spelled that way on the IRS's own forms.
 *
 * ## Three sentences are cut by price components
 *
 * The pricing block wraps `<PlanPrice />`, `<RegistrationFee />` and
 * `<FirstMonthTotal />`, and the Canadian branch wraps two more. Stored as the
 * pieces between them, seams named, for the reason `tasks.ts` gives.
 */
export const businessNumberEn = {
  metaTitle: "A local business number for texting, and it's yours",
  metaDescription:
    "Pick a local number in the area code you choose, usually live in a minute or two, or bring the number on your trucks. Porting is free. Two numbers on Pro. One flat monthly price.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Your business number",

  dateline: "THE NUMBER BELONGS TO THE BUSINESS",
  h1: "A local number that belongs to the business, not to somebody's phone.",
  heroSub:
    "Pick a local number in the area code you choose, usually live in a minute or two, and give your customers one place to text. Your personal cell goes back to being personal, and the number, the contacts, and every conversation stay with the company when a tech moves on.",
  visualCaption:
    "Two numbers on Pro: an office line and a field line, each with its own inbox.",
  visualAria:
    "The Loonext numbers settings showing two active business numbers with their unread counts",

  localEyebrow: "Local, on purpose",
  localTitle: "Type a city. Get a local number.",
  localBodyOne:
    "When you sign up, you tell Loonext where your customers are, a city or an area code, and we find you a local number to match. A shop in Toronto gets a (416) or a (647); a shop in Austin gets a (512). The picker here runs on the same numbering data the app uses to choose your number, so what you see is what you'd get.",
  localBodyTwo:
    "Local matters for a plain, common-sense reason: people answer a number that looks like it's from around the corner. A neighbourhood area code reads as a real local business, which is exactly what you are. We won't quote an invented answer-rate statistic; we'll just let you pick the code your customers already trust.",

  portEyebrow: "Bring your number",
  portTitle: "Keep the number on your trucks. Porting is free.",
  portBodyOne:
    'Already have a number your customers know, the one on your trucks, your yard signs, and your Google listing? Bring it. Porting is free and self-serve: choose "Bring my number" at signup or start it later from settings, answer a few questions about your current carrier, and we handle the carrier paperwork and show you where the transfer is the whole way.',
  portBodyTwo:
    "Your number keeps working on your old carrier while it moves, usually a few days to two weeks for US numbers and often faster in Canada, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change, and if you want to start texting today, get a new local number now and port your existing one alongside it.",

  fixesEyebrow: "What the number fixes",
  fixesTitle: "Three problems that end the day the business owns its number.",
  fixesQuoteTitle: "The buried quote",
  fixesQuoteBody:
    "Quotes and bookings stop landing in one person's private messages, between the family group chat and the dentist reminder. They land on the business number, where the whole crew can see and answer them.",
  fixesTechTitle: "The tech who moved on",
  fixesTechBody:
    "When a number lives on someone's personal phone, their conversations, their contacts, and sometimes their customers leave with them. A company-owned number keeps the history where it belongs.",
  fixesTwoTitle: "Two front doors, on Pro",
  fixesTwoBody:
    "Pro includes 2 local numbers, each with its own inbox: two locations, or an office line the front desk watches and a field line for the trucks. One crew, one workspace, no bleed between them.",

  weekUsTitle: "The first week, stated plainly",
  weekUsDayOne: "Your number is live and receiving texts on day one.",
  weekUsApproval:
    "Texting US customers turns on in about a week, 3 to 7 business days, once the phone companies approve you. We file everything the minute you pay.",
  weekUsScope:
    "Numbers are US and Canada only, and a number is provisioned after you subscribe, usually in a minute or two.",
  weekCaTitle: "Day one, stated plainly",
  weekCaDayOne:
    "Your number is live and you can text Canadian customers the same day it goes active, usually a minute or two after signup.",
  weekCaNoWait:
    "No registration, no fee, and no approval wait to text Canadian customers.",

  edgesEyebrow: "The precise edges",
  edgesTitle:
    "A phone number is a serious thing to hand your customers, so here is exactly how Loonext numbers work, including the limits.",
  edgesPortTitle: "A port takes days, not minutes.",
  edgesPortBody:
    "Moving a number between carriers is a real telecom process, usually a few days to two weeks for US numbers and often faster in Canada. Your number keeps working on your current carrier the whole time and switches to Loonext on the scheduled transfer date. Nobody can truthfully promise an instant port, so we don't.",
  edgesPaidTitle: "A number requires a paid plan.",
  edgesPaidBody:
    "The phone companies charge for every number, and free numbers attract the spam that wrecks delivery for everyone. A number is provisioned only after you subscribe, usually within a minute or two.",
  edgesSoleTitle: "Sole proprietors get one number.",
  edgesSoleBody:
    "If you register without an EIN through the sole-proprietor path, US carrier rules cap you at a single number regardless of plan. Register with an EIN to use Pro's second number.",

  pricingStarterBefore: "One local number comes with Starter at",
  pricingStarterAfter: "/mo for up to 3 people; a second number comes with Pro at",
  pricingProAfter:
    "/mo for up to 15. Both are flat, month to month, with receiving texts always free and unlimited. Porting a number in is free.",
  pricingUsBefore: "US shops pay a one-time",
  pricingUsMiddle:
    "to register the business with the phone companies, once, ever, so the first month is",
  pricingUsAnd: "and every month after is",
  pricingCaBefore:
    "Texting Canadian customers needs no registration and no one-time fee, so your first month is the same flat",
  pricingCaOr: "or",
  pricingCaAfter: "as every month after.",

  relatedEyebrow: "Where a business number does the most work",
  relatedTitle:
    "A dedicated number matters most for crews spread across jobs. Here's where it fits, and how the flat price compares to tools that charge for every extra number.",
  relatedContractorsTitle: "Texting for contractors",
  relatedContractorsBody:
    "Keep subs, GCs, and clients off one personal cell, on the company's number.",
  relatedLandscapersTitle: "Texting for landscapers",
  relatedLandscapersBody:
    "Crews spread across sites, all reachable at the same local number.",
  relatedCanadaTitle: "Loonext in Canada",
  relatedCanadaBody: "How Loonext works for Canadian crews.",
  relatedCompareTitle: "Loonext vs Quo",
  relatedCompareBody:
    "Two numbers included on Pro, next to a tool that charges $5/mo per extra number.",

  faqTitle: "Number questions, straight answers.",
  faqAreaQ: "Can I choose my area code?",
  faqAreaA:
    "Yes. Tell us a city or an area code when you sign up and we find you a local number to match, drawn from real numbering data. If the exact code you asked for has no inventory at that moment, we fall back to another local number in the same region.",
  faqPortQ: "Can I keep the number already on my trucks and my Google listing?",
  faqPortA:
    "Yes. Porting is free and self-serve: choose 'Bring my number' at signup or start it later from settings, answer a few questions, and we handle the carrier paperwork and show you where the transfer is the whole way. Your number keeps working on your old carrier while it moves, usually a few days to two weeks for US numbers and often faster in Canada, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change.",
  faqTwoQ: "What do the two numbers on Pro actually get me?",
  faqTwoA:
    "Two separate local numbers, each with its own inbox thread inside the same shared workspace. Common setups are an office line and a field line, or one number per location. Your whole team still works from one inbox; the conversations stay grouped by which number they came in on.",
  faqOwnQ: "Is the number really the business's, not mine personally?",
  faqOwnA:
    "Yes. The number is owned by the company account and shared by the crew. Teammates open a link to join and reply from their own phones, but the number, the contacts, and every conversation stay with the business when someone leaves.",
  faqReadyQ: "How fast is a new number ready?",
  faqReadyUs:
    "Texting US customers turns on after carrier approval, typically 3 to 7 business days.",
  faqReadyCa:
    "You can text Canadian customers the same day, with no registration and no approval wait.",

  ctaTitle: "Get a number your customers can text.",

  visualOfficeLine: "Office line",
  visualFieldLine: "Field line",
  visualHeading: "Your business numbers",
  visualActive: "Active",
  ctaSubBefore:
    "Pick your local area code or bring the number you have, keep your personal cell private, and give the whole crew a business number they share.",
  ctaSubAfter: ".",
} as const;

export const businessNumberFr: Translated<typeof businessNumberEn> = {
  metaTitle: "Un numéro d'entreprise local pour les textos, et il est à vous",
  metaDescription:
    "Choisissez un numéro local dans l'indicatif régional de votre choix, actif en général en une minute ou deux, ou apportez le numéro qui est sur vos camions. Le transfert est gratuit. Deux numéros sur Pro. Un seul prix fixe par mois.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Votre numéro d'entreprise",

  dateline: "LE NUMÉRO APPARTIENT À L'ENTREPRISE",
  h1: "Un numéro local qui appartient à l'entreprise, pas au téléphone de quelqu'un.",
  heroSub:
    "Choisissez un numéro local dans l'indicatif régional de votre choix, actif en général en une minute ou deux, et donnez à vos clients un seul endroit où écrire. Votre cellulaire personnel redevient personnel, et le numéro, les contacts et chaque conversation restent à l'entreprise quand un technicien s'en va.",
  visualCaption:
    "Deux numéros sur Pro : une ligne de bureau et une ligne de terrain, chacune avec sa propre boîte.",
  visualAria:
    "Les réglages des numéros Loonext montrant deux numéros d'entreprise actifs avec leurs compteurs de non-lus",

  localEyebrow: "Local, volontairement",
  localTitle: "Tapez une ville. Obtenez un numéro local.",
  localBodyOne:
    "À l'inscription, vous dites à Loonext où sont vos clients, une ville ou un indicatif régional, et nous vous trouvons un numéro local correspondant. Un commerce de Toronto obtient un (416) ou un (647) ; un commerce d'Austin obtient un (512). Le sélecteur ici fonctionne avec les mêmes données de numérotation que l'application utilise pour choisir votre numéro : ce que vous voyez est ce que vous auriez.",
  localBodyTwo:
    "Le local compte pour une raison simple et de gros bon sens : les gens répondent à un numéro qui a l'air de venir du coin de la rue. Un indicatif du quartier se lit comme une vraie entreprise locale, ce que vous êtes exactement. Nous ne citerons pas une statistique inventée sur les taux de réponse ; nous vous laissons simplement choisir l'indicatif auquel vos clients font déjà confiance.",

  portEyebrow: "Apportez votre numéro",
  portTitle: "Gardez le numéro sur vos camions. Le transfert est gratuit.",
  portBodyOne:
    "Vous avez déjà un numéro que vos clients connaissent, celui qui est sur vos camions, vos pancartes et votre fiche Google ? Apportez-le. Le transfert est gratuit et se fait tout seul : choisissez « Apporter mon numéro » à l'inscription ou lancez-le plus tard dans les réglages, répondez à quelques questions sur votre transporteur actuel, et nous nous occupons de la paperasse et vous montrons où en est le transfert tout du long.",
  portBodyTwo:
    "Votre numéro continue de fonctionner chez votre ancien transporteur pendant le déménagement, en général de quelques jours à deux semaines pour les numéros américains et souvent plus vite au Canada, puis il bascule chez Loonext à une date prévue. Rien sur vos camions ni sur votre fiche n'a à changer, et si vous voulez commencer à écrire aujourd'hui, prenez un nouveau numéro local maintenant et transférez le vôtre à côté.",

  fixesEyebrow: "Ce que le numéro règle",
  fixesTitle: "Trois problèmes qui finissent le jour où l'entreprise possède son numéro.",
  fixesQuoteTitle: "La soumission enterrée",
  fixesQuoteBody:
    "Les soumissions et les réservations cessent d'atterrir dans les messages privés d'une seule personne, entre la conversation de famille et le rappel du dentiste. Elles arrivent sur le numéro d'entreprise, où toute l'équipe peut les voir et y répondre.",
  fixesTechTitle: "Le technicien qui est parti",
  fixesTechBody:
    "Quand un numéro vit sur le téléphone personnel de quelqu'un, ses conversations, ses contacts et parfois ses clients partent avec lui. Un numéro qui appartient à l'entreprise garde l'historique là où il doit être.",
  fixesTwoTitle: "Deux portes d'entrée, sur Pro",
  fixesTwoBody:
    "Pro comprend 2 numéros locaux, chacun avec sa propre boîte : deux adresses, ou une ligne de bureau que la réception surveille et une ligne de terrain pour les camions. Une équipe, un espace de travail, aucun mélange entre les deux.",

  weekUsTitle: "La première semaine, dite clairement",
  weekUsDayOne: "Votre numéro est actif et reçoit des textos dès le premier jour.",
  weekUsApproval:
    "Écrire à des clients américains s'active en environ une semaine, de 3 à 7 jours ouvrables, une fois que les compagnies de téléphone vous approuvent. Nous déposons tout à la minute où vous payez.",
  weekUsScope:
    "Les numéros sont offerts aux États-Unis et au Canada seulement, et un numéro est attribué après votre abonnement, en général en une minute ou deux.",
  weekCaTitle: "Le premier jour, dit clairement",
  weekCaDayOne:
    "Votre numéro est actif et vous pouvez écrire à des clients canadiens le jour même où il le devient, en général une minute ou deux après l'inscription.",
  weekCaNoWait:
    "Aucune inscription, aucuns frais et aucune attente d'approbation pour écrire à des clients canadiens.",

  edgesEyebrow: "Les limites précises",
  edgesTitle:
    "Un numéro de téléphone est une chose sérieuse à donner à vos clients, alors voici exactement comment fonctionnent les numéros Loonext, limites comprises.",
  edgesPortTitle: "Un transfert prend des jours, pas des minutes.",
  edgesPortBody:
    "Déplacer un numéro d'un transporteur à l'autre est un vrai processus de télécom, en général de quelques jours à deux semaines pour les numéros américains et souvent plus vite au Canada. Votre numéro continue de fonctionner chez votre transporteur actuel tout ce temps et bascule chez Loonext à la date de transfert prévue. Personne ne peut honnêtement promettre un transfert instantané, alors nous ne le faisons pas.",
  edgesPaidTitle: "Un numéro exige un forfait payant.",
  edgesPaidBody:
    "Les compagnies de téléphone facturent chaque numéro, et les numéros gratuits attirent le pourriel qui ruine la livraison pour tout le monde. Un numéro n'est attribué qu'après votre abonnement, en général en une minute ou deux.",
  edgesSoleTitle: "Les travailleurs autonomes ont un seul numéro.",
  edgesSoleBody:
    "Si vous vous inscrivez sans EIN par la voie du travailleur autonome, les règles des transporteurs américains vous limitent à un seul numéro, quel que soit le forfait. Inscrivez-vous avec un EIN pour utiliser le deuxième numéro de Pro.",

  pricingStarterBefore: "Un numéro local vient avec Starter à",
  pricingStarterAfter:
    "/mois pour un maximum de 3 personnes ; un deuxième numéro vient avec Pro à",
  pricingProAfter:
    "/mois pour un maximum de 15. Les deux sont fixes, de mois en mois, et recevoir des textos est toujours gratuit et illimité. Transférer un numéro est gratuit.",
  pricingUsBefore: "Les commerces américains paient des frais uniques de",
  pricingUsMiddle:
    "pour inscrire l'entreprise auprès des compagnies de téléphone, une seule fois, à vie, alors le premier mois est de",
  pricingUsAnd: "et chaque mois par la suite est de",
  pricingCaBefore:
    "Écrire à des clients canadiens n'exige aucune inscription ni frais uniques, alors votre premier mois est le même prix fixe de",
  pricingCaOr: "ou",
  pricingCaAfter: "que tous les mois suivants.",

  relatedEyebrow: "Là où un numéro d'entreprise travaille le plus",
  relatedTitle:
    "Un numéro dédié compte le plus pour les équipes dispersées sur des chantiers. Voici où il s'insère, et comment le prix fixe se compare aux outils qui facturent chaque numéro supplémentaire.",
  relatedContractorsTitle: "Les textos pour les entrepreneurs",
  relatedContractorsBody:
    "Gardez les sous-traitants, les entrepreneurs généraux et les clients hors d'un cellulaire personnel, sur le numéro de l'entreprise.",
  relatedLandscapersTitle: "Les textos pour les paysagistes",
  relatedLandscapersBody:
    "Des équipes dispersées sur plusieurs chantiers, toutes joignables au même numéro local.",
  relatedCanadaTitle: "Loonext au Canada",
  relatedCanadaBody: "Comment Loonext fonctionne pour les équipes canadiennes.",
  relatedCompareTitle: "Loonext vs Quo",
  relatedCompareBody:
    "Deux numéros inclus sur Pro, à côté d'un outil qui facture 5 $/mois par numéro supplémentaire.",

  faqTitle: "Questions sur les numéros, réponses directes.",
  faqAreaQ: "Puis-je choisir mon indicatif régional ?",
  faqAreaA:
    "Oui. Dites-nous une ville ou un indicatif régional à l'inscription et nous vous trouvons un numéro local correspondant, tiré de vraies données de numérotation. Si l'indicatif exact que vous avez demandé n'a aucun numéro libre à ce moment-là, nous prenons un autre numéro local de la même région.",
  faqPortQ:
    "Puis-je garder le numéro déjà sur mes camions et sur ma fiche Google ?",
  faqPortA:
    "Oui. Le transfert est gratuit et se fait tout seul : choisissez « Apporter mon numéro » à l'inscription ou lancez-le plus tard dans les réglages, répondez à quelques questions, et nous nous occupons de la paperasse et vous montrons où en est le transfert tout du long. Votre numéro continue de fonctionner chez votre ancien transporteur pendant le déménagement, en général de quelques jours à deux semaines pour les numéros américains et souvent plus vite au Canada, puis il bascule chez Loonext à une date prévue. Rien sur vos camions ni sur votre fiche n'a à changer.",
  faqTwoQ: "Que me donnent vraiment les deux numéros de Pro ?",
  faqTwoA:
    "Deux numéros locaux distincts, chacun avec son propre fil dans le même espace de travail partagé. Les montages courants sont une ligne de bureau et une ligne de terrain, ou un numéro par adresse. Toute votre équipe travaille encore depuis une seule boîte ; les conversations restent groupées selon le numéro par lequel elles sont arrivées.",
  faqOwnQ: "Le numéro est-il vraiment à l'entreprise, et non à moi personnellement ?",
  faqOwnA:
    "Oui. Le numéro appartient au compte de l'entreprise et est partagé par l'équipe. Les collègues ouvrent un lien pour se joindre et répondent depuis leur propre téléphone, mais le numéro, les contacts et chaque conversation restent à l'entreprise quand quelqu'un part.",
  faqReadyQ: "En combien de temps un nouveau numéro est-il prêt ?",
  faqReadyUs:
    "Écrire à des clients américains s'active après l'approbation des transporteurs, généralement de 3 à 7 jours ouvrables.",
  faqReadyCa:
    "Vous pouvez écrire à des clients canadiens le jour même, sans inscription et sans attente d'approbation.",

  ctaTitle: "Obtenez un numéro auquel vos clients peuvent écrire.",

  visualOfficeLine: "Ligne de bureau",
  visualFieldLine: "Ligne de terrain",
  visualHeading: "Vos numéros d'entreprise",
  visualActive: "Actif",
  ctaSubBefore:
    "Choisissez votre indicatif régional ou amenez le numéro que vous avez, gardez votre cellulaire personnel privé, et donnez à toute l'équipe un numéro d'entreprise qu'elle partage.",
  ctaSubAfter: ".",
};

const BUSINESS_NUMBER_COPY = {
  en: businessNumberEn,
  "fr-CA": businessNumberFr,
} as const;

export type BusinessNumberCopy = typeof businessNumberEn | typeof businessNumberFr;

export function businessNumberCopy(
  locale: MarketingLocale = "en",
): BusinessNumberCopy {
  return BUSINESS_NUMBER_COPY[locale] ?? businessNumberEn;
}
