import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /features/shared-inbox, the product's central claim, in both
 * languages.
 *
 * ## What stays
 *
 * Every name. Priya, Dale, Marcus, Karen, the Nguyen family, the Hendersons,
 * Reyes Plumbing — these are the example crew and their customers, and Quebec
 * has all of these names in it. Translating a person's name is not translating.
 *
 * ## What is not obvious
 *
 * **The statuses are product vocabulary, not prose.** `new`, `open`, `waiting`
 * and `closed` appear in the app itself, and the filter chips on this page
 * illustrate the app's own controls. So the French here has to be the French
 * the app uses — `Ouvert`, `À moi`, `Fermé` — or the page is showing a reader
 * a screenshot of a product they will not recognise when they sign up.
 *
 * **`You:` is a message-list prefix**, not a sentence. French puts a space
 * before the colon: `Vous :`. It is two characters and it is the difference
 * between a page written in French and a page translated into it.
 *
 * The pricing sentence wraps price components again — stored as its seams, for
 * the reason named in `tasks.ts`.
 */
export const sharedInboxEn = {
  metaTitle: "Shared text inbox for the whole crew",
  metaDescription:
    "Every customer text, in one inbox the whole crew can see. Assign one owner per conversation, reply from any phone, search everything. One flat price for the team.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Shared inbox",

  h1: "Every customer text, in one inbox the whole crew can see.",
  heroSub:
    "A customer texts your business number and the conversation shows up on every phone on the team. Whoever is free picks it up, it gets exactly one owner, and nobody has to ask around about who answered the Hendersons. The number, the history, and the customers stay with the business.",
  inboxCaption:
    "The Reyes Plumbing inbox, mid-morning: Priya assigns the new drain call to Dale.",
  inboxAria:
    "The Reyes Plumbing inbox in Loonext, with the assign menu open on a new conversation",

  coreEyebrow: "The core idea",
  coreTitle: "A text stops being one person's problem.",
  coreBodyOne:
    "When a customer texts your business number, Loonext turns that text into a conversation everyone can see. Priya sees it. Dale sees it. Marcus sees it. Whoever is free picks it up, and because the whole crew is looking at the same thread, two people never reply to the same customer, and nobody assumes someone else already did.",
  coreBodyTwo:
    "Every conversation carries one owner and one status: new, open, waiting, or closed. Filter to Open and you're looking at exactly the work that still needs a human. Filter to Mine and you're looking at your own. It's the difference between a phone that buzzes at random and a queue you can actually clear.",
  coreBodyThree:
    "And the inbox is live. When Dale replies, the conversation updates on every other phone: the status changes, the snippet updates, the thread re-sorts. Nobody refreshes, nobody wonders, nobody replies twice.",

  useEyebrow: "Use it like this",
  useTitle: "Three jobs the inbox does every day.",
  useTriageTitle: "Morning triage",
  useTriageBody:
    "Open the inbox with your first coffee. Everything that came in overnight is sitting in one list: assign the urgent one to whoever's closest, reply to the easy ones, and the day starts sorted instead of scattered across three personal phones.",
  useOwnerTitle: "One owner per thread",
  useOwnerBody:
    "Assign a conversation and it shows on every phone: an owner chip on the row, a line in the thread. One owner means no double replies and no silent gaps, and anyone can still step in when they're needed.",
  useSearchTitle: "Search as memory",
  useSearchBody:
    'Every message and contact is searchable. "What did we quote the Nguyens in March?" takes five seconds, not a phone poll around the crew. The answer is in the thread, with the matching text highlighted.',
  useNotesTitle: "Notes stay internal",
  useNotesBody: "Talk about the job without texting the customer.",
  notesBody:
    'Some of what a crew needs to say should never leave the building: gate codes, "quote high, last visit ran long", the quirks of a property. Internal notes live right inside the conversation, drawn in an unmistakable marked card with a lock, and they are never sent to the customer. The next person who opens the thread has the context exactly where they need it.',

  factsEyebrow: "The plain facts",
  factsReceiving:
    "Receiving texts is free and unlimited on every plan. Photos are free to receive and saved for you; storage is free.",
  factsSeats: "Starter seats 3 people, Pro seats 15. Real limits, never per-seat billing.",
  factsCalling:
    "Calling is included on every plan, on the same number: incoming calls ring the whole crew inside Loonext and whoever is free answers, you call customers back from the app on the business number, and callers you miss get a voicemail and an automatic text back. No phone menus, no queues, no desk phones.",

  pricingBefore:
    "The shared inbox is the whole product, at one flat price for the whole crew:",
  pricingUsFee: "US shops also pay a one-time",
  pricingUsFeeAfter: "from your first month on.",
  fairUseLink: "fair use policy",

  relatedEyebrow: "See the shared inbox in your trade",
  relatedTitle:
    "The inbox is the same for every crew, but the way it earns its keep is specific. Here's how it plays out in a few trades, and where the flat price stands next to the per-user tools.",
  relatedPlumbersTitle: "Texting for plumbers",
  relatedPlumbersBody:
    "Photo triage, on-my-way texts, and after-hours texts in one shared inbox.",
  relatedHvacTitle: "Texting for HVAC",
  relatedHvacBody: "The no-heat morning rush, triaged across the whole crew.",
  relatedTemplatesTitle: "Templates and tags",
  relatedTemplatesBody:
    "Saved replies, sell-pipeline tags, and done-marks inside the inbox.",
  relatedCompareTitle: "Loonext vs Heymarket",
  relatedCompareBody:
    "A shared inbox at a flat price, next to a per-user platform.",

  faqTitle: "Shared inbox questions, straight answers.",
  faqSeatsQ: "How many people can share one inbox?",
  faqSeatsA:
    "Three on Starter, fifteen on Pro, a flat price either way, never per seat. Everyone shares the same inbox and the same business number; they just open a link on their own phone. There are no extra charges as you add teammates up to your plan's limit.",
  faqDoubleQ: "Can two people reply to the same customer by accident?",
  faqDoubleA:
    "It's designed against. Every conversation carries one assignee and a status, and the list updates in realtime, so if Dale is replying, the rest of the crew sees the conversation move and knows it's handled. Anyone can still jump in when they need to; the point is that nobody has to guess.",
  faqCustomerQ: "Do customers know it's a shared inbox and not one person's phone?",
  faqCustomerA:
    "No. To the customer it's a normal text conversation with your business. Internal notes and assignments live inside Loonext and are never sent. What the customer sees is a single, consistent business number that always gets answered.",
  faqLeaverQ: "What happens to conversations when a teammate leaves?",
  faqLeaverA:
    "They stay. The number, the contacts, and every conversation belong to the business, not to the person who happened to reply. Deactivate a departing teammate in settings and their conversations remain right where they are, ready for whoever picks them up next.",
  faqLiveQ: "Is the inbox live, or do I have to refresh?",
  faqLiveA:
    "It's live. New messages, status changes, and replies appear across every phone as they happen, with a quiet notification when a text lands in a conversation you're not currently viewing. You never refresh to see what's new.",
  faqSearchQ: "Can I search old conversations?",
  faqSearchA:
    "Yes. Every message and every contact is searchable from the inbox. Type a name, a number, or a phrase like 'water heater' and you get the conversations and contacts that match, with the matching text highlighted.",

  ctaTitle: "Give your crew one inbox to share.",

  listDrainSnippet: "Basement floor drain is backing up again",
  listKarenSnippet: "Tomorrow between 9 and 11 works. Thank you so much",
  listScheduled: "Scheduled",
  listQuoteSnippet: "You: Here's the quote for the water heater swap",
  listQuoteSent: "Quote sent",
  listGateSnippet: "Gate code is 4482, dog is friendly",
  listDoneSnippet: "You: All done, you're good to run the washer.",
  listAssignTo: "Assign to",
  listFilterAll: "All",
  listDueTue: "Tue",
  listFilterOpen: "Open",
  listFilterMine: "Mine",
  listFilterClosed: "Closed",
  ctaSubBefore:
    "A local business number and a shared text inbox the whole team can see,",
  ctaSubAfter: ". See the price.",
} as const;

export const sharedInboxFr: Translated<typeof sharedInboxEn> = {
  metaTitle: "Boîte de réception partagée pour toute l'équipe",
  metaDescription:
    "Chaque texto de client, dans une seule boîte que toute l'équipe voit. Attribuez un responsable par conversation, répondez depuis n'importe quel téléphone, cherchez dans tout. Un seul prix fixe pour l'équipe.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Boîte de réception partagée",

  h1: "Chaque texto de client, dans une boîte que toute l'équipe voit.",
  heroSub:
    "Un client écrit à votre numéro d'entreprise et la conversation apparaît sur tous les téléphones de l'équipe. La personne libre s'en occupe, la conversation obtient exactement un responsable, et personne n'a à demander qui a répondu aux Henderson. Le numéro, l'historique et les clients restent à l'entreprise.",
  inboxCaption:
    "La boîte de Reyes Plumbing, en milieu d'avant-midi : Priya attribue le nouvel appel de drain à Dale.",
  inboxAria:
    "La boîte de Reyes Plumbing dans Loonext, avec le menu d'attribution ouvert sur une nouvelle conversation",

  coreEyebrow: "L'idée de départ",
  coreTitle: "Un texto cesse d'être le problème d'une seule personne.",
  coreBodyOne:
    "Quand un client écrit à votre numéro d'entreprise, Loonext transforme ce texto en une conversation que tout le monde voit. Priya la voit. Dale la voit. Marcus la voit. La personne libre s'en occupe, et comme toute l'équipe regarde le même fil, deux personnes ne répondent jamais au même client, et personne ne suppose que quelqu'un d'autre l'a déjà fait.",
  coreBodyTwo:
    "Chaque conversation porte un responsable et un état : nouveau, ouvert, en attente ou fermé. Filtrez sur Ouvert et vous regardez exactement le travail qui a encore besoin d'une personne. Filtrez sur À moi et vous regardez le vôtre. C'est la différence entre un téléphone qui vibre au hasard et une file que vous pouvez vraiment vider.",
  coreBodyThree:
    "Et la boîte est en direct. Quand Dale répond, la conversation se met à jour sur tous les autres téléphones : l'état change, l'extrait change, le fil se replace. Personne n'actualise, personne ne se demande, personne ne répond en double.",

  useEyebrow: "Voici comment s'en servir",
  useTitle: "Trois travaux que la boîte fait tous les jours.",
  useTriageTitle: "Le tri du matin",
  useTriageBody:
    "Ouvrez la boîte avec votre premier café. Tout ce qui est entré pendant la nuit se trouve dans une seule liste : attribuez l'urgent à la personne la plus proche, répondez aux faciles, et la journée commence triée plutôt qu'éparpillée sur trois téléphones personnels.",
  useOwnerTitle: "Un responsable par fil",
  useOwnerBody:
    "Attribuez une conversation et ça paraît sur tous les téléphones : une pastille de responsable sur la ligne, une mention dans le fil. Un seul responsable, ça veut dire aucune réponse en double et aucun silence, et n'importe qui peut quand même intervenir au besoin.",
  useSearchTitle: "La recherche comme mémoire",
  useSearchBody:
    "Chaque message et chaque contact se cherchent. « Combien a-t-on soumissionné aux Nguyen en mars ? » prend cinq secondes, pas un tour de téléphone dans l'équipe. La réponse est dans le fil, avec le texte trouvé surligné.",
  useNotesTitle: "Les notes restent internes",
  useNotesBody: "Parlez du travail sans écrire au client.",
  notesBody:
    "Une partie de ce qu'une équipe doit se dire ne devrait jamais sortir : les codes de barrière, « soumissionner haut, la dernière visite a débordé », les particularités d'une propriété. Les notes internes vivent dans la conversation même, dessinées dans une carte marquée sans équivoque avec un cadenas, et elles ne sont jamais envoyées au client. La prochaine personne qui ouvre le fil a le contexte exactement là où elle en a besoin.",

  factsEyebrow: "Les faits, simplement",
  factsReceiving:
    "Recevoir des textos est gratuit et illimité dans tous les forfaits. Les photos sont gratuites à recevoir et conservées pour vous ; le stockage est gratuit.",
  factsSeats:
    "Starter accueille 3 personnes, Pro en accueille 15. De vraies limites, jamais de facturation par personne.",
  factsCalling:
    "Les appels sont inclus dans tous les forfaits, sur le même numéro : les appels entrants sonnent chez toute l'équipe dans Loonext et la personne libre répond, vous rappelez les clients depuis l'application avec le numéro d'entreprise, et ceux que vous manquez laissent un message vocal et reçoivent un texto automatique. Aucun menu téléphonique, aucune file d'attente, aucun téléphone de bureau.",

  pricingBefore:
    "La boîte de réception partagée est tout le produit, à un seul prix fixe pour toute l'équipe :",
  pricingUsFee: "Les commerces américains paient aussi des frais uniques de",
  pricingUsFeeAfter: "à partir de votre premier mois.",
  fairUseLink: "politique d'utilisation équitable",

  relatedEyebrow: "La boîte partagée dans votre métier",
  relatedTitle:
    "La boîte est la même pour toutes les équipes, mais la façon dont elle gagne sa place est particulière. Voici comment ça se passe dans quelques métiers, et où se situe le prix fixe à côté des outils facturés par personne.",
  relatedPlumbersTitle: "Les textos pour les plombiers",
  relatedPlumbersBody:
    "Le tri par photo, les textos « en route » et les textos après les heures, dans une seule boîte partagée.",
  relatedHvacTitle: "Les textos pour le HVAC",
  relatedHvacBody:
    "La ruée du matin sans chauffage, triée par toute l'équipe.",
  relatedTemplatesTitle: "Modèles et étiquettes",
  relatedTemplatesBody:
    "Réponses enregistrées, étiquettes de suivi des ventes et marques « terminé » dans la boîte.",
  relatedCompareTitle: "Loonext vs Heymarket",
  relatedCompareBody:
    "Une boîte partagée à prix fixe, à côté d'une plateforme facturée par personne.",

  faqTitle: "Questions sur la boîte partagée, réponses directes.",
  faqSeatsQ: "Combien de personnes peuvent partager une boîte ?",
  faqSeatsA:
    "Trois sur Starter, quinze sur Pro, un prix fixe dans les deux cas, jamais par personne. Tout le monde partage la même boîte et le même numéro d'entreprise ; ils ouvrent simplement un lien sur leur propre téléphone. Il n'y a aucuns frais supplémentaires à mesure que vous ajoutez des collègues jusqu'à la limite de votre forfait.",
  faqDoubleQ: "Deux personnes peuvent-elles répondre au même client par accident ?",
  faqDoubleA:
    "C'est conçu pour l'éviter. Chaque conversation porte un responsable et un état, et la liste se met à jour en direct : si Dale répond, le reste de l'équipe voit la conversation bouger et sait que c'est réglé. N'importe qui peut quand même intervenir au besoin ; l'idée, c'est que personne n'ait à deviner.",
  faqCustomerQ:
    "Les clients savent-ils que c'est une boîte partagée et non le téléphone d'une personne ?",
  faqCustomerA:
    "Non. Pour le client, c'est une conversation par texto normale avec votre entreprise. Les notes internes et les attributions vivent dans Loonext et ne sont jamais envoyées. Ce que le client voit, c'est un seul numéro d'entreprise constant à qui on répond toujours.",
  faqLeaverQ: "Qu'arrive-t-il aux conversations quand un collègue part ?",
  faqLeaverA:
    "Elles restent. Le numéro, les contacts et chaque conversation appartiennent à l'entreprise, pas à la personne qui a répondu. Désactivez le collègue qui part dans les réglages et ses conversations demeurent exactement où elles sont, prêtes pour la prochaine personne.",
  faqLiveQ: "La boîte est-elle en direct, ou dois-je actualiser ?",
  faqLiveA:
    "Elle est en direct. Les nouveaux messages, les changements d'état et les réponses apparaissent sur tous les téléphones au fur et à mesure, avec une notification discrète quand un texto arrive dans une conversation que vous ne regardez pas. Vous n'actualisez jamais pour voir ce qui est nouveau.",
  faqSearchQ: "Puis-je chercher dans les anciennes conversations ?",
  faqSearchA:
    "Oui. Chaque message et chaque contact se cherchent depuis la boîte. Tapez un nom, un numéro ou une expression comme « chauffe-eau » et vous obtenez les conversations et les contacts qui correspondent, avec le texte trouvé surligné.",

  ctaTitle: "Donnez à votre équipe une boîte à partager.",

  listDrainSnippet: "Le drain de plancher du sous-sol refoule encore",
  listKarenSnippet: "Demain entre 9 h et 11 h, ça marche. Merci beaucoup",
  listScheduled: "Planifié",
  listQuoteSnippet: "Vous : Voici la soumission pour le remplacement du chauffe-eau",
  listQuoteSent: "Soumission envoyée",
  listGateSnippet: "Le code de la barrière est 4482, le chien est gentil",
  listDoneSnippet: "Vous : C'est terminé, vous pouvez faire fonctionner la laveuse.",
  listAssignTo: "Attribuer à",
  listFilterAll: "Tous",
  listDueTue: "mar.",
  listFilterOpen: "Ouvert",
  listFilterMine: "À moi",
  listFilterClosed: "Fermé",
  ctaSubBefore:
    "Un numéro d'entreprise local et une boîte de textos partagée que toute l'équipe voit,",
  ctaSubAfter: ". Voyez le prix.",
};

const SHARED_INBOX_COPY = {
  en: sharedInboxEn,
  "fr-CA": sharedInboxFr,
} as const;

export type SharedInboxCopy = typeof sharedInboxEn | typeof sharedInboxFr;

export function sharedInboxCopy(locale: MarketingLocale = "en"): SharedInboxCopy {
  return SHARED_INBOX_COPY[locale] ?? sharedInboxEn;
}
