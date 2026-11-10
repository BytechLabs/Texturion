import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalAupEn = {
  metaTitle: "Acceptable use policy",
  metaDescription:
    "The rules for texting on Loonext: consent required, no purchased or harvested lists, no SHAFT content, immediate opt-out. At least as strict as our carrier's, because those rules flow down to you.",
  title: "Acceptable use policy",
  breadcrumbLabel: "Acceptable use",
  lastUpdated: "July 2, 2026",
  summary:
    "Text only people who have agreed to hear from you. No purchased or harvested lists, no SHAFT content (sex, hate, alcohol, firearms, tobacco), and every opt-out is honored immediately. These rules are at least as strict as the carrier obligations that flow down to us, and breaking them can end your account, because one bad sender hurts delivery for every business on the network.",

  sectionWhy: "Why this exists",
  sectionConsent: "Consent is required",
  sectionNoLists: "No purchased or harvested lists",
  sectionShaft: "Prohibited content (SHAFT and more)",
  sectionOptOut: "Opt-out is immediate",
  sectionIdentification: "Identify yourself",
  sectionNoAbuse: "No abuse of the network",
  sectionEnforcement: "Enforcement",
  sectionContact: "Contact",

  termsLink: "terms of service",

  why:
    "When you text through Loonext, you text through the phone companies and carriers we rely on. Their rules pass through to you, and breaking them hurts delivery for everyone. You accept this policy when you sign up (there's a checkbox), and it is part of our {terms}.",
  consent:
    "Only text people who have agreed to hear from you, because they texted you first, or asked you in person or by phone to text them. Consent cannot be bought, sold, rented, or transferred from one business to another. If you didn't get the consent yourself, you don't have it.",
  noLists:
    "You may not upload or text numbers from purchased, rented, scraped, or otherwise harvested lists. Importing your own customers whom you have consent to text is fine; importing a list you bought is not. This ban is explicit and non-negotiable.",
  shaftIntro:
    "You may not use Loonext to send content related to **SHAFT**, sex, hate, alcohol, firearms, or tobacco (including cannabis and vaping), or any of the following:",
  shaftOne: "High-risk financial offers, payday or short-term loans, debt relief",
  shaftTwo: "Illegal products or services, or content promoting illegal activity",
  shaftThree: "Deceptive, fraudulent, phishing, or \"get rich quick\" messaging",
  shaftFour: "Gambling where prohibited, and prescription-drug marketing",
  shaftFive: "Malware, or links intended to deceive or harm the recipient",
  shaftSix: "Harassment, threats, or hateful content toward any person or group",
  shaftEnd:
    "Loonext is a conversational customer-service inbox for service businesses. It is not a platform for bulk marketing blasts, and we don't offer those tools.",
  optOut:
    "Every recipient can opt out at any time by replying STOP (or a similar keyword). Loonext records the opt-out and blocks any further sends to that number until the person opts back in. You may not try to evade opt-outs, no texting from a second number, no \"are you sure\" follow-ups, no re-adding an opted-out contact.",
  identification:
    "Your business must be identifiable in your messages. When you start a conversation with a new contact, include your business name so the recipient knows who is texting them. Don't hide or obscure your identity, and don't impersonate another business or person.",
  noAbuse:
    "Don't attempt to send spam, don't try to route around our rate limits or spending caps, and don't use Loonext to text destinations outside the United States and Canada. We enforce per-account rate limits and destination restrictions to protect the network; working around them is a violation.",
  enforcementIntro:
    "We may investigate suspected violations to protect recipients, the network, and our carrier standing. This section says how, because an enforcement power without a written process is one you cannot plan around.",
  enforcementLookHeading: "What we look at, and what we do not",
  enforcementLookOne:
    "Our monitoring is behavioural. It looks at the shape of sending: how far a workspace is above its own ordinary day, how much of that volume goes to numbers it has never contacted before, and whether recipients are opting out at an unusual rate. It does not read your messages for meaning, and we do not use message content to decide any of the steps below.",
  enforcementLookTwo:
    "A signal is not a verdict. A roofer after a storm looks a great deal like a mass marketer, so an unusual pattern raises the case with a person at Loonext. It never triggers an automatic penalty on its own.",
  enforcementStepsHeading: "The steps, in order",
  stepAsk:
    "**We ask.** We contact the workspace owner describing what we saw and what we need to understand. Most cases end here, because most unusual weeks are just unusual weeks.",
  stepRateLimit:
    "**We rate-limit.** If sending continues in a pattern we cannot reconcile with the policy, we may slow it while we work it out. Existing conversations keep working.",
  stepSuspend:
    "**We suspend sending.** Outbound stops; your inbox, history, and number stay yours and you can still receive. This is a pause, not an ending.",
  stepTerminate:
    "**We terminate.** For violations that are deliberate, repeated after contact, or unlawful. Usage already incurred is not refunded.",
  enforcementPerson:
    "Each step is decided by a person, on the evidence described above plus whatever you tell us, and we record every action we take. You can reach a human at any step using the contact below, and a suspension we got wrong is lifted.",
  enforcementSkipHeading: "When we skip steps",
  enforcementSkip:
    "We move straight to suspension or termination when a carrier or regulator requires it, when we are given a court order, or when the conduct is unambiguously illegal or is actively harming recipients. We will still tell you what happened and why.",
  contactOne: "Not sure whether something is allowed? Ask first: {supportEmail}.",
  contactTwo:
    "**Reporting abuse of a Loonext number.** Whether you received the message, or you are a carrier acting on a complaint, email the same address with the number and what it sent. Reports are read before ordinary enquiries, and they are not subject to the contact form’s daily limit: one number behaving badly affects delivery for every business on the network, so we would rather hear about it twice than not at all.",
} as const;

export const legalAupFr: Translated<typeof legalAupEn> = {
  metaTitle: "Politique d'utilisation acceptable",
  metaDescription:
    "Les règles pour écrire des textos avec Loonext : consentement obligatoire, aucune liste achetée ou récoltée, aucun contenu SHAFT, retrait immédiat. Au moins aussi strictes que celles de notre fournisseur, parce que ces règles s'appliquent aussi à vous.",
  title: "Politique d'utilisation acceptable",
  breadcrumbLabel: "Utilisation acceptable",
  lastUpdated: "2 juillet 2026",
  summary:
    "N'envoyez des textos qu'aux personnes qui ont accepté d'en recevoir. Aucune liste achetée ou récoltée, aucun contenu SHAFT (sexe, haine, alcool, armes à feu, tabac), et chaque retrait est respecté immédiatement. Ces règles sont au moins aussi strictes que les obligations des fournisseurs qui nous sont transmises, et les enfreindre peut mettre fin à votre compte, parce qu'un seul mauvais expéditeur nuit à la livraison de toutes les entreprises du réseau.",

  sectionWhy: "Pourquoi cette politique existe",
  sectionConsent: "Le consentement est obligatoire",
  sectionNoLists: "Aucune liste achetée ou récoltée",
  sectionShaft: "Contenu interdit (SHAFT et plus)",
  sectionOptOut: "Le retrait est immédiat",
  sectionIdentification: "Identifiez-vous",
  sectionNoAbuse: "Aucun abus du réseau",
  sectionEnforcement: "Application",
  sectionContact: "Nous joindre",

  termsLink: "conditions d'utilisation",

  why:
    "Lorsque vous envoyez des textos avec Loonext, vous passez par les compagnies de téléphone et les fournisseurs sur lesquels nous nous appuyons. Leurs règles s'appliquent aussi à vous, et les enfreindre nuit à la livraison de tout le monde. Vous acceptez la présente politique lors de votre inscription (il y a une case à cocher), et elle fait partie de nos {terms}.",
  consent:
    "N'envoyez des textos qu'aux personnes qui ont accepté d'en recevoir, parce qu'elles vous ont d'abord écrit, ou vous ont demandé, en personne ou par téléphone, de leur écrire. Le consentement ne peut être ni acheté, ni vendu, ni loué, ni transféré d'une entreprise à une autre. Si vous n'avez pas obtenu le consentement vous-même, vous ne l'avez pas.",
  noLists:
    "Vous ne pouvez pas téléverser ni écrire à des numéros provenant de listes achetées, louées, extraites ou autrement récoltées. Importer vos propres clients, que vous avez le consentement de joindre par texto, est permis; importer une liste que vous avez achetée ne l'est pas. Cette interdiction est explicite et non négociable.",
  shaftIntro:
    "Vous ne pouvez pas utiliser Loonext pour envoyer du contenu lié à **SHAFT**, soit le sexe, la haine, l'alcool, les armes à feu ou le tabac (y compris le cannabis et le vapotage), ni l'un des contenus suivants :",
  shaftOne: "Offres financières à risque élevé, prêts sur salaire ou à court terme, allègement de dette",
  shaftTwo: "Produits ou services illégaux, ou contenu faisant la promotion d'une activité illégale",
  shaftThree: "Messages trompeurs, frauduleux, d'hameçonnage ou du type « devenez riche rapidement »",
  shaftFour: "Jeux de hasard là où ils sont interdits, et publicité de médicaments sur ordonnance",
  shaftFive: "Maliciels, ou liens destinés à tromper ou à nuire au destinataire",
  shaftSix: "Harcèlement, menaces ou contenu haineux à l'endroit d'une personne ou d'un groupe",
  shaftEnd:
    "Loonext est une boîte de réception conversationnelle de service à la clientèle pour les entreprises de services. Ce n'est pas une plateforme d'envois massifs de marketing, et nous n'offrons pas ces outils.",
  optOut:
    "Chaque destinataire peut se retirer en tout temps en répondant STOP (ou un mot-clé semblable). Loonext consigne le retrait et bloque tout autre envoi vers ce numéro tant que la personne ne consent pas de nouveau. Vous ne pouvez pas tenter de contourner un retrait : pas d'envoi à partir d'un deuxième numéro, pas de relance du type « êtes-vous certain? », pas de réajout d'un contact qui s'est retiré.",
  identification:
    "Votre entreprise doit être identifiable dans vos messages. Lorsque vous amorcez une conversation avec un nouveau contact, indiquez le nom de votre entreprise pour que le destinataire sache qui lui écrit. Ne cachez pas et ne masquez pas votre identité, et ne vous faites pas passer pour une autre entreprise ou une autre personne.",
  noAbuse:
    "N'essayez pas d'envoyer du pourriel, ne tentez pas de contourner nos limites de débit ou nos plafonds de dépenses, et n'utilisez pas Loonext pour écrire à des destinations situées hors des États-Unis et du Canada. Nous appliquons des limites de débit par compte et des restrictions de destination pour protéger le réseau; les contourner constitue une violation.",
  enforcementIntro:
    "Nous pouvons enquêter sur des violations présumées afin de protéger les destinataires, le réseau et notre relation avec les fournisseurs. La présente section explique comment, parce qu'un pouvoir d'application sans processus écrit est un pouvoir sur lequel vous ne pouvez pas planifier.",
  enforcementLookHeading: "Ce que nous examinons, et ce que nous n'examinons pas",
  enforcementLookOne:
    "Notre surveillance est comportementale. Elle examine la forme des envois : de combien un espace de travail dépasse sa journée habituelle, quelle part de ce volume est destinée à des numéros jamais joints auparavant, et si les destinataires se retirent à un rythme inhabituel. Elle ne lit pas le sens de vos messages, et nous n'utilisons pas le contenu des messages pour décider de l'une des étapes ci-dessous.",
  enforcementLookTwo:
    "Un signal n'est pas un verdict. Un couvreur après une tempête ressemble beaucoup à un vendeur de masse; un comportement inhabituel soumet donc le cas à une personne chez Loonext. Il ne déclenche jamais de sanction automatique à lui seul.",
  enforcementStepsHeading: "Les étapes, dans l'ordre",
  stepAsk:
    "**Nous demandons.** Nous communiquons avec le propriétaire de l'espace de travail pour décrire ce que nous avons observé et ce que nous avons besoin de comprendre. La plupart des cas s'arrêtent ici, parce que la plupart des semaines inhabituelles ne sont que des semaines inhabituelles.",
  stepRateLimit:
    "**Nous limitons le débit.** Si les envois se poursuivent selon un modèle que nous ne pouvons concilier avec la politique, nous pouvons les ralentir le temps de faire la lumière. Les conversations existantes continuent de fonctionner.",
  stepSuspend:
    "**Nous suspendons les envois.** Les envois sortants cessent; votre boîte de réception, votre historique et votre numéro restent les vôtres et vous pouvez toujours recevoir des messages. C'est une pause, pas une fin.",
  stepTerminate:
    "**Nous résilions.** En cas de violations délibérées, répétées après un contact, ou illégales. L'utilisation déjà engagée n'est pas remboursée.",
  enforcementPerson:
    "Chaque étape est décidée par une personne, d'après les éléments décrits ci-dessus et tout ce que vous nous dites, et nous consignons chaque mesure que nous prenons. Vous pouvez joindre un humain à chaque étape en utilisant les coordonnées ci-dessous, et une suspension imposée à tort est levée.",
  enforcementSkipHeading: "Quand nous sautons des étapes",
  enforcementSkip:
    "Nous passons directement à la suspension ou à la résiliation lorsqu'un fournisseur ou un organisme de réglementation l'exige, lorsqu'une ordonnance d'un tribunal nous est remise, ou lorsque la conduite est manifestement illégale ou nuit activement aux destinataires. Nous vous dirons quand même ce qui s'est passé et pourquoi.",
  contactOne: "Vous ne savez pas si quelque chose est permis? Demandez d'abord : {supportEmail}.",
  contactTwo:
    "**Signaler un abus d'un numéro Loonext.** Que vous ayez reçu le message ou que vous soyez un fournisseur donnant suite à une plainte, écrivez à la même adresse en indiquant le numéro et ce qu'il a envoyé. Les signalements sont lus avant les demandes ordinaires et ne sont pas soumis à la limite quotidienne du formulaire de contact : un seul numéro qui se comporte mal nuit à la livraison de toutes les entreprises du réseau, et nous préférons en entendre parler deux fois plutôt que pas du tout.",
};

const COPY = { en: legalAupEn, "fr-CA": legalAupFr } as const;

export function legalAupCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalAupEn;
}
