import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /features/calls, in both languages.
 *
 * ## The refusals are the argument
 *
 * This page is unusual: most of what it promises is what the product will NOT
 * do. No forwarding, no desk phones, no menus, no queues, no agent scoring, no
 * call recording. The French keeps every one of them as a flat negative rather
 * than a softened one — *aucun renvoi*, *aucun menu*, *les appels ne sont pas
 * enregistrés* — because each is a limit a buyer is being asked to accept on
 * purpose, and a limit stated vaguely reads as a limit being hidden.
 *
 * The recording answer is the sharpest: we do not ship it rather than ship it
 * against consent rules that vary by province. That sentence has to survive
 * translation intact.
 *
 * ## Minutes, again with the separator
 *
 * 2,500 and 6,000 become `2 500` and `6 000`. A comma is a decimal point to a
 * French reader, and these are the numbers a buyer compares against their bill.
 */
export const callsEn = {
  metaTitle: "Calls and voicemail on your business number",
  metaDescription:
    "Incoming calls ring your whole crew in the app, so whoever is free answers. Missed callers leave a voicemail you can read and get a text back. Included on every plan, at one flat price for the team.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Calls and voicemail",

  dateline: "WHOEVER IS FREE PICKS UP",
  h1: "Your number rings the whole crew, not one person's pocket.",
  heroSub:
    "A customer calls the number on your van. Every teammate's Loonext rings at once and whoever is free takes it. Nobody picks up because you're all under a sink? They leave a voicemail, we write it down so you can read it between jobs, and they get a text back before they call the next business. Calling is included on every plan, with nothing to switch on.",
  visualCaption:
    "Karen calls the shop line at 4:40, and the 8:52 voicemail nobody could take.",
  visualAria:
    "An incoming call in Loonext ringing three teammates, above a voicemail with its transcript",

  coreEyebrow: "The core idea",
  coreTitle: "The app is the phone.",
  coreBodyOne:
    "There is no forwarding, no bridge to somebody's cell, and no handset to buy. The call arrives inside Loonext on every phone and computer the crew is signed in on, and the first person to hit Answer gets it. The rest stop ringing. That is the whole mechanism, and it is why a call no longer depends on one person being free.",
  coreBodyTwo:
    "When you call a customer back, it goes out from your business number, never from the phone in your hand. They see the same number they called, they can call it again, and no tech ever hands out a personal mobile to get a job done.",
  coreBodyThree:
    "A call is a first-class part of the conversation, not a separate log. It sits in the customer's thread beside their texts, so the person who picks up next reads what was said last time instead of starting over.",

  useEyebrow: "Use it like this",
  useTitle: "Three calls a week that used to go somewhere else.",
  useMissedTitle: "The one nobody could take",
  useMissedBody:
    "Four of you are on jobs at 8:52 pm. The caller leaves a voicemail, Loonext writes it down, and it arrives as something you can read at a red light instead of a badge you have to find somewhere quiet to listen to. They get a text back in your own words, so the job is still yours in the morning.",
  useOfficeTitle: "The one the office should take",
  useOfficeBody:
    "Screening tells you who is calling before you commit to the conversation, and caller ID name goes out with your calls as well as arriving with theirs. If it turns out to be a job for someone else, transfer it to them mid-call rather than asking the customer to hang up and dial again.",
  useTaskTitle: "The one that becomes work",
  useTaskBody:
    'The customer describes a job on the phone. Turn that call into a task with an owner, an address and a due date, linked back to the call it came from, so "book the Hendersons for Tuesday" stops living in the head of whoever answered.',

  notEyebrow: "What it is not",
  notTitle: "A shared line, not a call center.",
  notBodyOne:
    "There are no phone menus, no press-one-for-service, no hold queues, and no agent scoring. A caller does not meet a robot; they meet whoever on your crew is free. That is a deliberate limit, and it is the right one for a business where the person who answers is often the person who does the work.",
  notBodyTwo:
    "There is no desk phone and no SIP handset to configure, and calls do not forward to a cell. Loonext needs microphone permission on the device you answer from, and a phone with the app closed is reached by a push notification rather than a ring, so the calls that matter most are the ones you have notifications turned on for.",
  notBodyThree:
    "Calls are not recorded. Voicemails are, because the caller chose to leave one, and the recording plus its transcript live in the conversation like any other message.",

  factsEyebrow: "The plain facts",
  factsIncluded:
    "Calling is included on every plan, both directions, with nothing to turn on and no add-on to buy.",
  factsMinutes:
    "Starter includes 2,500 calling minutes a month and Pro includes 6,000, shared across incoming and outgoing. A minute counts only when somebody actually talked; ringing never does.",
  factsTranscripts:
    "Voicemail transcripts are written by Lou, our assistant, and are capped at 500 a month per workspace. Past the cap the recording still arrives, just without the write-up.",
  factsNoHardware:
    "No cell forwarding, no desk phones, no phone menus or queues. The app is the phone, and it needs microphone permission to be one.",

  pricingBefore: "Calling costs nothing extra:",
  fairUseLink: "fair use policy",

  relatedEyebrow: "The rest of the line",
  relatedTitle:
    "Calls are one half of what arrives on your business number. Here is the other half, and where the flat price stands next to the per-user tools.",
  relatedInboxTitle: "Shared inbox",
  relatedInboxBody: "Every customer text in one inbox the whole crew can see.",
  relatedNumberTitle: "Your business number",
  relatedNumberBody: "A local number that belongs to the business, ported in free.",
  relatedMissedTitle: "Missed calls, lost jobs",
  relatedMissedBody: "What a good text-back actually says, with lines to steal.",
  relatedCompareTitle: "Loonext vs Quo",
  relatedCompareBody: "Where a full phone system genuinely beats a shared line.",

  faqTitle: "Call questions, straight answers.",
  faqCellQ: "Does the call ring my actual cell phone?",
  faqCellA:
    "No, and that is deliberate. It rings inside Loonext on whatever device you are signed in on, which is usually your cell. There is no call forwarding: forwarding meant the call left the product, so the crew could not see it, the transcript did not exist, and it landed on one person again. If the app is closed, a push notification brings you to it.",
  faqNoAnswerQ: "What happens when nobody answers?",
  faqNoAnswerA:
    "The caller reaches your voicemail, the recording lands in their conversation, and Lou writes it down so you can read it instead of listening. They also get an automatic text back in words you wrote yourself, which is usually what turns a missed call into a booked job rather than a lost one.",
  faqTwoQ: "Can two people answer the same call?",
  faqTwoA:
    "No. Everyone's phone rings, the first person to answer gets the call, and everyone else stops ringing. The call then shows in the shared conversation, so the rest of the crew can see it happened and who took it without anyone having to say so.",
  faqOutboundQ: "What number do customers see when we call them?",
  faqOutboundA:
    "Your business number, every time, from every teammate and every device. Caller ID name goes out with it where the carriers support it. Nobody's personal mobile is ever presented, so a customer cannot start calling a tech directly by accident.",
  faqTransferQ: "Can I transfer a call to someone else on the crew?",
  faqTransferA:
    "Yes. Put the caller on hold and transfer to a teammate mid-call, so the customer is handed over rather than asked to hang up and dial again. Screening tells you who is calling before you take it, which is usually what decides whether you answer or let it go to voicemail.",
  faqRecordQ: "Are calls recorded?",
  faqRecordA:
    "No. Only voicemails, because the caller chose to leave one. Call recording brings consent rules that vary by state and province, and we would rather not ship it than ship it in a way that quietly puts you on the wrong side of them.",
  faqHardwareQ: "Do I need a desk phone or a special headset?",
  faqHardwareA:
    "Neither. Any phone or computer with a microphone and the app open is the phone. That is the whole hardware list, and there is nothing to configure, register, or plug in.",

  ctaTitle: "Stop losing the calls nobody could take.",

  visualVoicemailTime: "8:52 pm",
  visualVoicemailLength: "0:31",
  visualVoicemailTranscript:
    "“Hi, it’s Ray over on Bishop Street. My hot water’s gone completely and I’ve got family in Friday. Any chance somebody could come out Thursday? Same number back, thanks.”",
  visualCallerName: "Karen Mullins",
  visualIncoming: "Incoming call",
  visualRinging: "Ringing all three · whoever answers first takes it",
  visualAnswer: "Answer",
  visualDecline: "Decline",
  visualVoicemailFrom: "Voicemail from Ray Delgado",
  visualVoicemailNote:
    "Written down automatically · texted back: “Sorry we missed you, we’ll call first thing.”",
  ctaSubBefore:
    "Calls and texts on one business number, answered by whoever is free,",
  ctaSubAfter: ". See the price.",
} as const;

export const callsFr: Translated<typeof callsEn> = {
  metaTitle: "Appels et messagerie vocale sur votre numéro d'entreprise",
  metaDescription:
    "Les appels entrants sonnent chez toute votre équipe dans l'application, alors la personne libre répond. Ceux que vous manquez laissent un message vocal que vous pouvez lire et reçoivent un texto de retour. Inclus dans tous les forfaits, à un seul prix fixe pour l'équipe.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Appels et messagerie vocale",

  dateline: "LA PERSONNE LIBRE RÉPOND",
  h1: "Votre numéro sonne chez toute l'équipe, pas dans la poche d'une seule personne.",
  heroSub:
    "Un client appelle le numéro sur votre camionnette. Le Loonext de chaque membre de l'équipe sonne en même temps et la personne libre le prend. Personne ne répond parce que vous êtes tous sous un évier ? Le client laisse un message vocal, nous l'écrivons pour que vous puissiez le lire entre deux travaux, et il reçoit un texto de retour avant d'appeler l'entreprise suivante. Les appels sont inclus dans tous les forfaits, sans rien à activer.",
  visualCaption:
    "Karen appelle la ligne de l'atelier à 16 h 40, et le message vocal de 20 h 52 que personne n'a pu prendre.",
  visualAria:
    "Un appel entrant dans Loonext qui sonne chez trois membres de l'équipe, au-dessus d'un message vocal avec sa transcription",

  coreEyebrow: "L'idée de départ",
  coreTitle: "L'application est le téléphone.",
  coreBodyOne:
    "Il n'y a aucun renvoi d'appel, aucun pont vers le cellulaire de quelqu'un, et aucun combiné à acheter. L'appel arrive dans Loonext sur chaque téléphone et chaque ordinateur où l'équipe est connectée, et la première personne à appuyer sur Répondre l'obtient. Les autres cessent de sonner. C'est tout le mécanisme, et c'est pourquoi un appel ne dépend plus d'une seule personne libre.",
  coreBodyTwo:
    "Quand vous rappelez un client, l'appel part de votre numéro d'entreprise, jamais du téléphone que vous avez en main. Le client voit le même numéro qu'il a appelé, il peut le rappeler, et aucun technicien ne donne jamais son cellulaire personnel pour faire une job.",
  coreBodyThree:
    "Un appel fait pleinement partie de la conversation, ce n'est pas un journal à part. Il se trouve dans le fil du client à côté de ses textos, alors la personne qui répond la prochaine fois lit ce qui a été dit la dernière fois au lieu de repartir de zéro.",

  useEyebrow: "Voici comment s'en servir",
  useTitle: "Trois appels par semaine qui allaient ailleurs avant.",
  useMissedTitle: "Celui que personne ne pouvait prendre",
  useMissedBody:
    "Vous êtes quatre sur des chantiers à 20 h 52. La personne laisse un message vocal, Loonext l'écrit, et il arrive sous une forme que vous pouvez lire à un feu rouge au lieu d'une pastille qu'il faut aller écouter au calme. Elle reçoit un texto de retour dans vos propres mots, alors la job est encore à vous le lendemain matin.",
  useOfficeTitle: "Celui que le bureau devrait prendre",
  useOfficeBody:
    "Le filtrage vous dit qui appelle avant que vous vous engagiez dans la conversation, et votre nom d'afficheur part avec vos appels autant qu'il arrive avec les leurs. Si c'est finalement une job pour quelqu'un d'autre, transférez-la-lui en cours d'appel plutôt que de demander au client de raccrocher et de recomposer.",
  useTaskTitle: "Celui qui devient du travail",
  useTaskBody:
    "Le client décrit une job au téléphone. Transformez cet appel en tâche avec un responsable, une adresse et une échéance, reliée à l'appel d'où elle vient, pour que « réserver les Henderson pour mardi » cesse de vivre dans la tête de celui qui a répondu.",

  notEyebrow: "Ce que ce n'est pas",
  notTitle: "Une ligne partagée, pas un centre d'appels.",
  notBodyOne:
    "Il n'y a aucun menu téléphonique, aucun « faites le 1 pour le service », aucune file d'attente et aucune évaluation d'agents. Une personne qui appelle ne tombe pas sur un robot ; elle tombe sur celui de votre équipe qui est libre. C'est une limite délibérée, et c'est la bonne pour une entreprise où celui qui répond est souvent celui qui fait le travail.",
  notBodyTwo:
    "Il n'y a aucun téléphone de bureau ni combiné SIP à configurer, et les appels ne sont pas renvoyés vers un cellulaire. Loonext a besoin de la permission du micro sur l'appareil d'où vous répondez, et un téléphone dont l'application est fermée est joint par une notification poussée plutôt que par une sonnerie : les appels qui comptent le plus sont donc ceux pour lesquels vous avez activé les notifications.",
  notBodyThree:
    "Les appels ne sont pas enregistrés. Les messages vocaux le sont, parce que la personne a choisi d'en laisser un, et l'enregistrement ainsi que sa transcription vivent dans la conversation comme n'importe quel autre message.",

  factsEyebrow: "Les faits, simplement",
  factsIncluded:
    "Les appels sont inclus dans tous les forfaits, dans les deux sens, sans rien à activer et sans supplément à acheter.",
  factsMinutes:
    "Starter comprend 2 500 minutes d'appel par mois et Pro en comprend 6 000, partagées entre les appels entrants et sortants. Une minute ne compte que si quelqu'un a vraiment parlé ; la sonnerie ne compte jamais.",
  factsTranscripts:
    "Les transcriptions de messages vocaux sont écrites par Lou, notre adjoint, et sont plafonnées à 500 par mois par espace de travail. Passé le plafond, l'enregistrement arrive quand même, simplement sans la mise par écrit.",
  factsNoHardware:
    "Aucun renvoi vers un cellulaire, aucun téléphone de bureau, aucun menu ni file d'attente. L'application est le téléphone, et il lui faut la permission du micro pour en être un.",

  pricingBefore: "Les appels ne coûtent rien de plus :",
  fairUseLink: "politique d'utilisation équitable",

  relatedEyebrow: "Le reste de la ligne",
  relatedTitle:
    "Les appels sont une moitié de ce qui arrive sur votre numéro d'entreprise. Voici l'autre moitié, et où se situe le prix fixe à côté des outils facturés par personne.",
  relatedInboxTitle: "Boîte de réception partagée",
  relatedInboxBody:
    "Chaque texto de client dans une seule boîte que toute l'équipe voit.",
  relatedNumberTitle: "Votre numéro d'entreprise",
  relatedNumberBody:
    "Un numéro local qui appartient à l'entreprise, transféré gratuitement.",
  relatedMissedTitle: "Appels manqués, jobs perdues",
  relatedMissedBody:
    "Ce que dit vraiment un bon texto de retour, avec des formules à reprendre.",
  relatedCompareTitle: "Loonext vs Quo",
  relatedCompareBody:
    "Là où un vrai système téléphonique bat réellement une ligne partagée.",

  faqTitle: "Questions sur les appels, réponses directes.",
  faqCellQ: "Est-ce que l'appel fait sonner mon vrai cellulaire ?",
  faqCellA:
    "Non, et c'est délibéré. Il sonne dans Loonext sur l'appareil où vous êtes connecté, qui est en général votre cellulaire. Il n'y a aucun renvoi d'appel : le renvoi faisait sortir l'appel du produit, alors l'équipe ne le voyait pas, la transcription n'existait pas, et il retombait sur une seule personne. Si l'application est fermée, une notification poussée vous y amène.",
  faqNoAnswerQ: "Qu'arrive-t-il quand personne ne répond ?",
  faqNoAnswerA:
    "La personne tombe sur votre messagerie vocale, l'enregistrement arrive dans sa conversation, et Lou l'écrit pour que vous puissiez le lire au lieu de l'écouter. Elle reçoit aussi un texto de retour automatique dans des mots que vous avez écrits vous-même, ce qui transforme habituellement un appel manqué en job réservée plutôt qu'en job perdue.",
  faqTwoQ: "Deux personnes peuvent-elles répondre au même appel ?",
  faqTwoA:
    "Non. Le téléphone de tout le monde sonne, la première personne à répondre obtient l'appel, et tous les autres cessent de sonner. L'appel apparaît ensuite dans la conversation partagée, alors le reste de l'équipe voit qu'il a eu lieu et qui l'a pris sans que personne ait à le dire.",
  faqOutboundQ: "Quel numéro les clients voient-ils quand on les appelle ?",
  faqOutboundA:
    "Votre numéro d'entreprise, chaque fois, de chaque membre de l'équipe et de chaque appareil. Votre nom d'afficheur part avec, là où les transporteurs le prennent en charge. Le cellulaire personnel de personne n'est jamais présenté, alors un client ne peut pas se mettre à appeler un technicien directement par accident.",
  faqTransferQ: "Puis-je transférer un appel à quelqu'un d'autre de l'équipe ?",
  faqTransferA:
    "Oui. Mettez la personne en attente et transférez à un collègue en cours d'appel, pour que le client soit passé à quelqu'un plutôt qu'invité à raccrocher et à recomposer. Le filtrage vous dit qui appelle avant que vous preniez l'appel, ce qui décide habituellement si vous répondez ou si vous laissez aller à la messagerie.",
  faqRecordQ: "Les appels sont-ils enregistrés ?",
  faqRecordA:
    "Non. Seulement les messages vocaux, parce que la personne a choisi d'en laisser un. L'enregistrement des appels amène des règles de consentement qui varient d'un État et d'une province à l'autre, et nous préférons ne pas le livrer plutôt que de le livrer d'une façon qui vous mettrait discrètement du mauvais côté de ces règles.",
  faqHardwareQ: "Ai-je besoin d'un téléphone de bureau ou d'un casque spécial ?",
  faqHardwareA:
    "Ni l'un ni l'autre. N'importe quel téléphone ou ordinateur avec un micro et l'application ouverte est le téléphone. C'est toute la liste du matériel, et il n'y a rien à configurer, à inscrire ou à brancher.",

  ctaTitle: "Cessez de perdre les appels que personne ne pouvait prendre.",

  visualVoicemailTime: "20 h 52",
  visualVoicemailLength: "0:31",
  visualVoicemailTranscript:
    "« Bonjour, c'est Ray, sur la rue Bishop. Je n'ai plus d'eau chaude du tout et j'ai de la visite vendredi. Est-ce que quelqu'un pourrait passer jeudi ? Rappelez à ce numéro, merci. »",
  visualCallerName: "Karen Mullins",
  visualIncoming: "Appel entrant",
  visualRinging: "Sonne chez les trois · la première personne à répondre le prend",
  visualAnswer: "Répondre",
  visualDecline: "Refuser",
  visualVoicemailFrom: "Message vocal de Ray Delgado",
  visualVoicemailNote:
    "Écrit automatiquement · texto de retour : « Désolé de vous avoir manqué, on vous rappelle à la première heure. »",
  ctaSubBefore:
    "Les appels et les textos sur un seul numéro d'entreprise, pris par qui est libre,",
  ctaSubAfter: ". Voyez le prix.",
};

const CALLS_COPY = {
  en: callsEn,
  "fr-CA": callsFr,
} as const;

export type CallsCopy = typeof callsEn | typeof callsFr;

export function callsCopy(locale: MarketingLocale = "en"): CallsCopy {
  return CALLS_COPY[locale] ?? callsEn;
}
