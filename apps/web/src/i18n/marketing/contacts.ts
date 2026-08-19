import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /features/contacts, in both languages.
 *
 * ## The dates and the money, again
 *
 * The timeline reads `Mar 2026`, `Oct 2025`, `Aug 2024`. French Canadian writes
 * the month lowercase and abbreviates only where the word is long enough to
 * need it — `mars` does not abbreviate, `oct.` and `août` do differently. And
 * the quoted price is `340 $`, sign after the number with a space, which is the
 * OQLF's rule and the third page on this site to need it.
 *
 * ## The claim this page is careful about
 *
 * "Not in the sales sense" — the page goes out of its way to say this is not a
 * CRM, and the French keeps that distance rather than reaching for *CRM* as a
 * loanword. It also says plainly that merging duplicates does not exist yet,
 * and the French says so as plainly: a translation that softened *not yet* into
 * something vaguer would be making a promise the product does not keep.
 */
export const contactsEn = {
  metaTitle: "One history for every customer",
  metaDescription:
    "Every text, call, voicemail and photo you have exchanged with a customer, on one timeline, with their address and your private notes. Import your list with a CSV. One flat price for the crew.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Contacts",

  dateline: "BEFORE YOU KNOCK",
  h1: "What have we done for this customer? One screen, six years.",
  heroSub:
    "A furnace serviced every autumn is six separate jobs, and it should be. But the question you ask in the van outside their house is not about one job, it is about all of them. Every text, call, voicemail and photo you have ever exchanged with somebody sits on one timeline, with their address, your private notes, and what they agreed to.",
  timelineCaption:
    "Karen Mullins, four years of work, assembled from four separate conversations.",
  timelineAria:
    "A customer's history in Loonext, mixing texts, a call and a voicemail on one timeline",

  coreEyebrow: "The core idea",
  coreTitle: "Conversations end. Customers do not.",
  coreBodyOne:
    "A conversation closes when a job is done, and the next time that customer texts, a new one starts. That is right: an annual furnace service genuinely is a new job, not a continuation of last October's. But it means the person who has served them six times has six records and no history.",
  coreBodyTwo:
    "The contact is where those come back together. Texts, calls, voicemails with their transcripts, photos, and the jobs that came out of them, in one time-ordered stream. Nothing is copied or summarized to build it; it is assembled the moment you open it, from the same records the inbox is showing.",
  coreBodyThree:
    "The practical version: the tech standing on the porch knows the dog is in the crate, the key is under the mat, and last year's part was the wrong one, without phoning the office to ask.",

  holdsEyebrow: "What a contact holds",
  holdsTitle: "The things you would otherwise keep on a phone.",
  holdsAddressTitle: "The address, and what is at it",
  holdsAddressBody:
    "Where the job is, plus the notes only your crew sees: gate code, dog, parking, the quirk that cost an hour last time. Private by construction, never sent to the customer.",
  holdsConsentTitle: "What they agreed to",
  holdsConsentBody:
    'How consent was recorded and when, so the question "are we allowed to text this person?" has an answer with a date on it rather than a shrug. If they have opted out, the contact says so and says which kind, because only some can be undone from inside the app.',
  holdsHistoryTitle: "Their whole history",
  holdsHistoryBody:
    'Every conversation, call and job in one stream. Search it the way you search everything else: a name, a number, or a phrase like "water heater".',
  holdsImportTitle: "Your list, brought in",
  holdsImportBody:
    "Import from a CSV with a dry run that shows exactly what will be created before anything is, and export the whole list back out whenever you want. Your customers are not hostage to us.",

  factsEyebrow: "The plain facts",
  factsAssembled:
    "The history is assembled when you open it, from the conversations, calls and tasks that already exist. Nothing is duplicated into a second store that can drift.",
  factsNotes:
    "Internal notes on a contact are never sent and never visible to the customer, the same way notes inside a conversation are not.",
  factsDuplicates:
    "Duplicates are not merged yet. If the same person exists twice, they stay twice for now; import will not create a second copy of somebody it recognises, but two records that already exist do not combine.",
  factsCsv: "Import and export are both CSV, both included, with no row cap and no charge.",

  pricingBefore: "Contacts come with the inbox:",
  fairUseLink: "fair use policy",

  relatedEyebrow: "What fills a contact",
  relatedTitle:
    "A contact is not something you maintain. It is what the rest of the product leaves behind.",
  relatedInboxTitle: "Shared inbox",
  relatedInboxBody: "The conversations that become the history.",
  relatedCallsTitle: "Calls and voicemail",
  relatedCallsBody: "Calls and their transcripts land on the same timeline.",
  relatedTasksTitle: "Tasks",
  relatedTasksBody: "The jobs that came out of those conversations.",
  relatedComplianceTitle: "Compliance built in",
  relatedComplianceBody: "Where the consent record on a contact comes from.",

  faqTitle: "Contact questions, straight answers.",
  faqCrmQ: "Is this a CRM?",
  faqCrmA:
    "Not in the sales sense. There are no deal stages, no pipelines with forecast values, no lead scoring and no email sequences. It is the record of a customer you already serve: who they are, where they are, what you have said to each other, and what you agreed. If you need a sales CRM, keep it; this is the operational half.",
  faqMergeQ: "Can I merge two contacts that are the same person?",
  faqMergeA:
    "Not yet, and we would rather say so than imply otherwise on the page about having one record per customer. Import will not create a second copy of a number it already knows, so bringing your list in does not make the problem worse. Merging two that already exist is on the list.",
  faqNotesQ: "Who can see the private notes?",
  faqNotesA:
    "Your crew, and only your crew. Notes on a contact are internal in the same way notes inside a conversation are: they are never sent, never appear in a text, and the customer has no way to see them. They are drawn differently in the app for exactly that reason.",
  faqExportQ: "Can I get my contacts back out?",
  faqExportA:
    "Yes, as a CSV, whenever you want, without asking anybody. Leaving is stated up front here rather than made difficult: your customer list is yours, and an export button is the least a product can do about that.",
  faqCallsQ: "Does the history include calls, or only texts?",
  faqCallsA:
    "Both, plus voicemails with their transcripts and any photos or files. That is the whole point of assembling it: a customer who rang twice and texted once has three things in their history, in the order they happened, not two lists you merge by eye.",

  ctaTitle: "Know the customer before you knock.",

  timelineName: "Karen Mullins",
  timelineHeading: "History",
  timelineVoicemailWhen: "Oct 2025",
  timelineVoicemailItem: "“It is making that noise again”",
  timelineCallWhen: "Aug 2024",
  timelineCallItem: "12 minutes, Priya, booked the install",
  timelineMar: "Mar 2026",
  timelineMarItem: "New tap for the ensuite, quoted $340",
  timelineOct: "Oct 2025",
  timelineOctItem: "Furnace service, done by Dale",
  timelineAug: "Aug 2024",
  timelineAugItem: "Photo of the old unit",
} as const;

export const contactsFr: Translated<typeof contactsEn> = {
  metaTitle: "Un seul historique par client",
  metaDescription:
    "Chaque texto, appel, message vocal et photo échangés avec un client, sur une seule ligne du temps, avec son adresse et vos notes privées. Importez votre liste par CSV. Un seul prix fixe pour toute l'équipe.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Contacts",

  dateline: "AVANT DE COGNER",
  h1: "Qu'est-ce qu'on a fait pour ce client ? Un écran, six ans.",
  heroSub:
    "Une fournaise entretenue chaque automne, ce sont six travaux distincts, et c'est correct ainsi. Mais la question que vous vous posez dans la camionnette devant chez le client ne porte pas sur un travail, elle porte sur tous. Chaque texto, appel, message vocal et photo que vous avez échangés avec quelqu'un se trouve sur une seule ligne du temps, avec son adresse, vos notes privées et ce qu'il a accepté.",
  timelineCaption:
    "Karen Mullins, quatre ans de travail, rassemblés à partir de quatre conversations distinctes.",
  timelineAria:
    "L'historique d'un client dans Loonext, mêlant des textos, un appel et un message vocal sur une seule ligne du temps",

  coreEyebrow: "L'idée de départ",
  coreTitle: "Les conversations se terminent. Les clients, non.",
  coreBodyOne:
    "Une conversation se ferme quand un travail est fait, et la prochaine fois que ce client écrit, une nouvelle commence. C'est juste : un entretien annuel de fournaise est vraiment un nouveau travail, pas la suite de celui d'octobre dernier. Mais ça veut dire que la personne qui les a servis six fois a six dossiers et aucun historique.",
  coreBodyTwo:
    "Le contact, c'est là que tout se rassemble. Les textos, les appels, les messages vocaux avec leur transcription, les photos, et les travaux qui en sont sortis, dans un seul fil classé dans le temps. Rien n'est copié ni résumé pour le construire ; il est assemblé au moment où vous l'ouvrez, à partir des mêmes dossiers que la boîte de réception affiche.",
  coreBodyThree:
    "La version pratique : le technicien debout sur le perron sait que le chien est dans sa cage, que la clé est sous le tapis et que la pièce de l'an dernier n'était pas la bonne, sans appeler le bureau pour demander.",

  holdsEyebrow: "Ce que contient un contact",
  holdsTitle: "Les choses que vous garderiez autrement sur un téléphone.",
  holdsAddressTitle: "L'adresse, et ce qui s'y trouve",
  holdsAddressBody:
    "Où est le travail, plus les notes que seule votre équipe voit : code de barrière, chien, stationnement, la particularité qui a coûté une heure la dernière fois. Privées par construction, jamais envoyées au client.",
  holdsConsentTitle: "Ce qu'il a accepté",
  holdsConsentBody:
    "Comment le consentement a été noté et quand, pour que la question « a-t-on le droit d'écrire à cette personne ? » ait une réponse datée plutôt qu'un haussement d'épaules. En cas de retrait, le contact le dit et dit de quel type, parce que seuls certains peuvent être annulés depuis l'application.",
  holdsHistoryTitle: "Tout son historique",
  holdsHistoryBody:
    "Chaque conversation, appel et travail dans un seul fil. Cherchez-y comme vous cherchez partout ailleurs : un nom, un numéro, ou une expression comme « chauffe-eau ».",
  holdsImportTitle: "Votre liste, importée",
  holdsImportBody:
    "Importez depuis un CSV avec un essai à blanc qui montre exactement ce qui sera créé avant que quoi que ce soit le soit, et réexportez toute la liste quand vous voulez. Vos clients ne sont pas nos otages.",

  factsEyebrow: "Les faits, simplement",
  factsAssembled:
    "L'historique est assemblé quand vous l'ouvrez, à partir des conversations, des appels et des tâches qui existent déjà. Rien n'est dupliqué dans un deuxième entrepôt qui pourrait dériver.",
  factsNotes:
    "Les notes internes sur un contact ne sont jamais envoyées ni visibles par le client, exactement comme les notes dans une conversation.",
  factsDuplicates:
    "Les doublons ne sont pas encore fusionnés. Si la même personne existe deux fois, elle reste deux fois pour l'instant ; l'importation ne créera pas une deuxième copie de quelqu'un qu'elle reconnaît, mais deux dossiers qui existent déjà ne se combinent pas.",
  factsCsv:
    "L'importation et l'exportation se font toutes deux en CSV, toutes deux incluses, sans plafond de lignes et sans frais.",

  pricingBefore: "Les contacts viennent avec la boîte de réception :",
  fairUseLink: "politique d'utilisation équitable",

  relatedEyebrow: "Ce qui remplit un contact",
  relatedTitle:
    "Un contact n'est pas quelque chose que vous entretenez. C'est ce que le reste du produit laisse derrière lui.",
  relatedInboxTitle: "Boîte de réception partagée",
  relatedInboxBody: "Les conversations qui deviennent l'historique.",
  relatedCallsTitle: "Appels et messagerie vocale",
  relatedCallsBody:
    "Les appels et leurs transcriptions arrivent sur la même ligne du temps.",
  relatedTasksTitle: "Tâches",
  relatedTasksBody: "Les travaux sortis de ces conversations.",
  relatedComplianceTitle: "La conformité intégrée",
  relatedComplianceBody: "D'où vient le consentement noté sur un contact.",

  faqTitle: "Questions sur les contacts, réponses directes.",
  faqCrmQ: "Est-ce un logiciel de gestion des ventes ?",
  faqCrmA:
    "Pas au sens des ventes. Il n'y a aucune étape de vente, aucun entonnoir avec des valeurs prévues, aucun pointage de clients potentiels et aucune séquence de courriels. C'est le dossier d'un client que vous servez déjà : qui il est, où il est, ce que vous vous êtes dit, et ce qu'il a accepté. Si vous avez besoin d'un logiciel de ventes, gardez-le ; ceci en est la moitié opérationnelle.",
  faqMergeQ: "Puis-je fusionner deux contacts qui sont la même personne ?",
  faqMergeA:
    "Pas encore, et nous préférons le dire plutôt que de laisser entendre le contraire sur la page qui parle d'avoir un seul dossier par client. L'importation ne créera pas une deuxième copie d'un numéro qu'elle connaît déjà, alors importer votre liste n'aggrave pas le problème. Fusionner deux dossiers qui existent déjà est sur la liste à faire.",
  faqNotesQ: "Qui peut voir les notes privées ?",
  faqNotesA:
    "Votre équipe, et seulement votre équipe. Les notes sur un contact sont internes de la même façon que celles dans une conversation : elles ne sont jamais envoyées, n'apparaissent jamais dans un texto, et le client n'a aucun moyen de les voir. Elles sont dessinées différemment dans l'application exactement pour cette raison.",
  faqExportQ: "Puis-je récupérer mes contacts ?",
  faqExportA:
    "Oui, en CSV, quand vous voulez, sans rien demander à personne. Partir se dit ici d'emblée plutôt que d'être rendu difficile : votre liste de clients vous appartient, et un bouton d'exportation est le minimum qu'un produit puisse faire à ce sujet.",
  faqCallsQ: "L'historique comprend-il les appels, ou seulement les textos ?",
  faqCallsA:
    "Les deux, en plus des messages vocaux avec leur transcription et de toutes les photos ou tous les fichiers. C'est tout l'intérêt de l'assembler : un client qui a appelé deux fois et écrit une fois a trois éléments dans son historique, dans l'ordre où ils sont arrivés, et non deux listes à recouper à l'œil.",

  ctaTitle: "Connaissez le client avant de cogner.",

  timelineName: "Karen Mullins",
  timelineHeading: "Historique",
  timelineVoicemailWhen: "oct. 2025",
  timelineVoicemailItem: "« Ça refait ce bruit-là »",
  timelineCallWhen: "août 2024",
  timelineCallItem: "12 minutes, Priya, a réservé l'installation",
  timelineMar: "mars 2026",
  timelineMarItem: "Nouveau robinet pour la salle de bain, soumission de 340 $",
  timelineOct: "oct. 2025",
  timelineOctItem: "Entretien de la fournaise, fait par Dale",
  timelineAug: "août 2024",
  timelineAugItem: "Photo de l'ancien appareil",
};

const CONTACTS_COPY = {
  en: contactsEn,
  "fr-CA": contactsFr,
} as const;

export type ContactsCopy = typeof contactsEn | typeof contactsFr;

export function contactsCopy(locale: MarketingLocale = "en"): ContactsCopy {
  return CONTACTS_COPY[locale] ?? contactsEn;
}
