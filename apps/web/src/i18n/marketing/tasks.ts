import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 Rule 11 — /features/tasks, the cheapest complete page after the first
 * two, and the third French URL.
 *
 * ## Register notes for this page in particular
 *
 * The page's whole argument is that a promise made in a text should not
 * evaporate, so the French keeps the same plain-spoken register: *tâche* for
 * the thing, *travail* for the work, never *ticket* or *item*. A crew does not
 * say "ticket".
 *
 * `Starter` and `Pro` are plan names and stay. So does `Lou`. The trade words
 * follow the nav's choices, which is why "contractors" is *entrepreneurs* here
 * too — the pages have to agree about what a reader is called.
 *
 * ## The pricing sentence is four fragments
 *
 * It wraps two `<PlanPrice />` components and a link, so it is stored as the
 * pieces between them rather than as one string. That shape is the reason
 * `/canada` shipped five English sentences on its first wiring pass: a sentence
 * cut in half is invisible to a scan that looks for sentences. Stored
 * deliberately here, with the seams named.
 */
export const tasksEn = {
  metaTitle: "Turn a text or a call into a job",
  metaDescription:
    "Promote any customer message or call into a task with an owner, an address and a due date, still linked to what they said. Work it from a list, a board, a calendar or a map. One flat price for the crew.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Tasks",

  dateline: "THE JOB KEEPS ITS RECEIPT",
  h1: "Book the Hendersons for Tuesday. Now it lives somewhere.",
  heroSub:
    "A customer asks for something in a text or on the phone, and right now that promise lives in the head of whoever heard it. Promote the message into a task and it gets an owner, a due date and an address, and it stays linked to the exact words the customer used. Work it from a list, a board, a calendar you can drag, or a map of where everything is.",
  boardCaption: "Thursday's board: what the crew promised, and who owns it.",
  boardAria: "The Loonext task board with to-do and done columns",

  coreEyebrow: "The core idea",
  coreTitle: "A task remembers where it came from.",
  coreBodyOne:
    "Every task keeps a link back to the message or the call that created it. Open the job and you can read what the customer actually wrote, in their words, months later. That is the difference between this and the notes app somebody on the crew is also using: a note is a retyped summary, and a retyped summary is where the gate code turns into the wrong gate code.",
  coreBodyTwo:
    "It works from a call too. Somebody describes a job on the phone, hangs up, and the person who answered turns that call into a task without opening anything else. The task carries the call the way it carries a text.",
  coreBodyThree:
    "And it goes both ways. Task activity shows up inside the conversation, so a teammate reading the thread sees the job was created, assigned, and scheduled without leaving it.",

  viewsEyebrow: "Four ways to look at the same work",
  viewsTitle: "Whichever view matches the question you are asking.",
  viewListTitle: "List and board",
  viewListBody:
    "The flat list for working through, and a to-do and done board for the morning stand-up. Same tasks, same owners; only the arrangement changes.",
  viewCalendarTitle: "Calendar",
  viewCalendarBody:
    "A month or a week of what is due. Drag a job to a different day to reschedule it, which is what actually happens when a van breaks down and Thursday becomes Friday.",
  viewMapBody:
    "Every job with an address, plotted. Two calls on the same street stop being two separate trips, which is the one view that saves fuel rather than time.",
  viewThreadTitle: "In the conversation",
  viewThreadBody:
    "Open a customer's thread and the jobs attached to it are right there as a checklist. You never have to remember whether you promised them something; the thread tells you.",

  factsEyebrow: "The plain facts",
  factsOne:
    "A task is created from a message or a call and stays linked to it. Title, description, owner, due date and address, all editable after the fact.",
  factsTwo:
    "Lou can fill in the address and the due date from what the customer wrote. Two separate switches, both on by default, both switchable off.",
  factsThree:
    "This is the work that comes out of a conversation, not a construction suite. No Gantt charts, no dependencies, no crew dispatch, no time tracking, no invoicing.",
  factsFour:
    "Tasks are included on every plan. There is no per-task charge and no separate project add-on.",

  pricingBefore: "Tasks come with the inbox at one flat price for the whole crew:",
  pricingStarterAfter: "/mo on Starter for up to 3 people,",
  pricingProAfter:
    "/mo on Pro for up to 15. Nothing about tasks is metered, and nothing here is an add-on. If you want the detail on what IS metered, it is texting and calling minutes, both under our",
  fairUseLink: "fair use policy",

  relatedEyebrow: "Where jobs come from",
  relatedTitle:
    "A task is the second half of a conversation. Here is the first half, and the assistant that fills in the boring parts.",
  relatedInboxTitle: "Shared inbox",
  relatedInboxBody: "The texts that become jobs, in one place the crew can see.",
  relatedCallsTitle: "Calls and voicemail",
  relatedCallsBody: "A call becomes a task the same way a message does.",
  relatedAssistantTitle: "Lou, your assistant",
  relatedAssistantBody: "Fills in the address and the due date from their words.",
  relatedContractorsTitle: "Texting for contractors",
  relatedContractorsBody:
    "Change orders, decided in writing and turned into work.",

  faqTitle: "Task questions, straight answers.",
  faqReplacementQ: "Is this a replacement for my job-management software?",
  faqReplacementA:
    "No, and it is not trying to be. There are no Gantt charts, no dependencies between jobs, no crew dispatch or scheduling board, no time tracking and no invoicing. What it does is stop a promise made in a text from evaporating: it becomes a job with an owner and a date, attached to what the customer said. If you run a full estimating and invoicing suite, this sits in front of it, not instead of it.",
  faqDoneQ: "What is the difference between marking a message done and making a task?",
  faqDoneA:
    'Weight. A done-mark is one tap on a message with no owner and no date, which is right for "paint the hall Hale Navy". A task has an owner, a due date and an address, and shows up on the board and the calendar, which is right for something that has to happen on a particular day by a particular person. Most crews use both, and the message is the source either way.',
  faqAssignQ: "Can I assign a job to someone who is not in the conversation?",
  faqAssignA:
    "Yes. Assignment on a task is separate from who owns the conversation, because the person who answers the phone is often not the person who does the work. They get the job with the customer's own words attached, so they are not starting from a summary.",
  faqLeaverQ: "What happens to tasks when a teammate leaves?",
  faqLeaverA:
    "They stay, like the conversations they came from. Deactivate the departing teammate in settings and their jobs remain exactly where they are, ready to be reassigned. Nothing belongs to a person's account.",
  faqPhoneQ: "Do tasks work on a phone?",
  faqPhoneA:
    "Yes, all four views. The map and the calendar are the two that earn their keep on a phone specifically: what is near me, and what is due today, answered from the van without calling the office.",

  ctaTitle: "Stop keeping the schedule in your head.",

  boardSourceHeater: "leaking all over the basement floor",
  boardSourceQuote: "can somebody come out Tuesday?",
  boardSourceDrain: "backing up again",
  boardDueTue: "Tue",
  boardAddressHeater: "114 Bishop St",
  boardToDo: "To do",
  boardDone: "Done",
  boardToday: "Today",
  boardYesterday: "Yesterday",
  boardCardHeater: "Water heater swap, Bishop St",
  boardCardQuote: "Quote the Hendersons",
  boardCardDrain: "Drain clear, Marcus T",
  ctaSubBefore:
    "Texts and calls that turn into jobs with owners and dates,",
  ctaSubAfter: ". See the price.",
} as const;

export const tasksFr: Translated<typeof tasksEn> = {
  metaTitle: "Transformez un texto ou un appel en travail",
  metaDescription:
    "Transformez n'importe quel message ou appel de client en tâche avec un responsable, une adresse et une échéance, toujours liée à ce qu'il a dit. Travaillez-la depuis une liste, un tableau, un calendrier ou une carte. Un seul prix fixe pour toute l'équipe.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Tâches",

  dateline: "LE TRAVAIL GARDE SON REÇU",
  h1: "Réservez les Henderson pour mardi. Maintenant, ça existe quelque part.",
  heroSub:
    "Un client demande quelque chose par texto ou au téléphone, et pour l'instant cette promesse vit dans la tête de celui qui l'a entendue. Transformez le message en tâche et elle obtient un responsable, une échéance et une adresse, et elle reste liée aux mots exacts qu'a employés le client. Travaillez-la depuis une liste, un tableau, un calendrier que vous pouvez glisser, ou une carte de tout ce qu'il y a à faire.",
  boardCaption:
    "Le tableau de jeudi : ce que l'équipe a promis, et qui en est responsable.",
  boardAria: "Le tableau des tâches Loonext avec les colonnes à faire et terminé",

  coreEyebrow: "L'idée de départ",
  coreTitle: "Une tâche se souvient d'où elle vient.",
  coreBodyOne:
    "Chaque tâche garde un lien vers le message ou l'appel qui l'a créée. Ouvrez le travail et vous pouvez lire ce que le client a vraiment écrit, dans ses mots, des mois plus tard. C'est la différence entre ceci et l'application de notes que quelqu'un dans l'équipe utilise aussi : une note est un résumé retapé, et un résumé retapé, c'est là que le code de la barrière devient le mauvais code.",
  coreBodyTwo:
    "Ça marche aussi à partir d'un appel. Quelqu'un décrit un travail au téléphone, raccroche, et la personne qui a répondu transforme cet appel en tâche sans rien ouvrir d'autre. La tâche porte l'appel comme elle porte un texto.",
  coreBodyThree:
    "Et ça va dans les deux sens. L'activité d'une tâche apparaît dans la conversation, alors un collègue qui lit le fil voit que le travail a été créé, attribué et planifié sans avoir à le quitter.",

  viewsEyebrow: "Quatre façons de regarder le même travail",
  viewsTitle: "La vue qui correspond à la question que vous posez.",
  viewListTitle: "Liste et tableau",
  viewListBody:
    "La liste simple pour avancer, et un tableau à faire et terminé pour la réunion du matin. Mêmes tâches, mêmes responsables ; seule la disposition change.",
  viewCalendarTitle: "Calendrier",
  viewCalendarBody:
    "Un mois ou une semaine de ce qui est dû. Glissez un travail vers un autre jour pour le reporter, ce qui arrive vraiment quand une camionnette brise et que jeudi devient vendredi.",
  viewMapBody:
    "Chaque travail avec une adresse, placé sur la carte. Deux appels sur la même rue cessent d'être deux déplacements distincts, et c'est la seule vue qui économise du carburant plutôt que du temps.",
  viewThreadTitle: "Dans la conversation",
  viewThreadBody:
    "Ouvrez le fil d'un client et les travaux qui y sont rattachés sont là, en liste à cocher. Vous n'avez jamais à vous rappeler si vous leur avez promis quelque chose ; le fil vous le dit.",

  factsEyebrow: "Les faits, simplement",
  factsOne:
    "Une tâche est créée à partir d'un message ou d'un appel et y reste liée. Titre, description, responsable, échéance et adresse, tout se modifie après coup.",
  factsTwo:
    "Lou peut remplir l'adresse et l'échéance à partir de ce qu'a écrit le client. Deux interrupteurs distincts, tous deux activés par défaut, tous deux désactivables.",
  factsThree:
    "C'est le travail qui sort d'une conversation, pas une suite de gestion de chantier. Aucun diagramme de Gantt, aucune dépendance, aucune répartition d'équipe, aucun suivi du temps, aucune facturation.",
  factsFour:
    "Les tâches sont incluses dans tous les forfaits. Aucuns frais par tâche et aucun supplément de projet distinct.",

  pricingBefore:
    "Les tâches viennent avec la boîte de réception à un seul prix fixe pour toute l'équipe :",
  pricingStarterAfter: "/mois sur Starter pour un maximum de 3 personnes,",
  pricingProAfter:
    "/mois sur Pro pour un maximum de 15. Rien dans les tâches n'est facturé à l'usage, et rien ici n'est un supplément. Si vous voulez le détail de ce QUI est mesuré, ce sont les textos et les minutes d'appel, tous deux visés par notre",
  fairUseLink: "politique d'utilisation équitable",

  relatedEyebrow: "D'où viennent les travaux",
  relatedTitle:
    "Une tâche est la deuxième moitié d'une conversation. Voici la première moitié, et l'adjoint qui remplit les parties ennuyeuses.",
  relatedInboxTitle: "Boîte de réception partagée",
  relatedInboxBody:
    "Les textos qui deviennent des travaux, dans un seul endroit que l'équipe voit.",
  relatedCallsTitle: "Appels et messagerie vocale",
  relatedCallsBody: "Un appel devient une tâche de la même façon qu'un message.",
  relatedAssistantTitle: "Lou, votre adjoint",
  relatedAssistantBody: "Remplit l'adresse et l'échéance à partir de leurs mots.",
  relatedContractorsTitle: "Les textos pour les entrepreneurs",
  relatedContractorsBody:
    "Les changements, décidés par écrit et transformés en travail.",

  faqTitle: "Questions sur les tâches, réponses directes.",
  faqReplacementQ: "Est-ce que ça remplace mon logiciel de gestion de chantier ?",
  faqReplacementA:
    "Non, et ça n'essaie pas de le faire. Il n'y a aucun diagramme de Gantt, aucune dépendance entre les travaux, aucune répartition d'équipe ni tableau de planification, aucun suivi du temps et aucune facturation. Ce que ça fait, c'est empêcher une promesse faite dans un texto de s'évaporer : elle devient un travail avec un responsable et une date, rattaché à ce que le client a dit. Si vous utilisez une suite complète de soumissions et de facturation, ceci se place devant elle, pas à sa place.",
  faqDoneQ:
    "Quelle est la différence entre marquer un message comme terminé et créer une tâche ?",
  faqDoneA:
    "Le poids. Marquer comme terminé, c'est une seule touche sur un message, sans responsable ni date, ce qui convient à « peindre le corridor en Hale Navy ». Une tâche a un responsable, une échéance et une adresse, et elle apparaît sur le tableau et le calendrier, ce qui convient à quelque chose qui doit se faire un jour précis par une personne précise. La plupart des équipes utilisent les deux, et le message reste la source dans les deux cas.",
  faqAssignQ: "Puis-je attribuer un travail à quelqu'un qui n'est pas dans la conversation ?",
  faqAssignA:
    "Oui. L'attribution d'une tâche est distincte de qui possède la conversation, parce que la personne qui répond au téléphone n'est souvent pas celle qui fait le travail. Elle reçoit le travail avec les mots mêmes du client, alors elle ne part pas d'un résumé.",
  faqLeaverQ: "Qu'arrive-t-il aux tâches quand un collègue part ?",
  faqLeaverA:
    "Elles restent, comme les conversations d'où elles viennent. Désactivez le collègue qui part dans les réglages et ses travaux demeurent exactement où ils sont, prêts à être réattribués. Rien n'appartient au compte d'une personne.",
  faqPhoneQ: "Est-ce que les tâches fonctionnent sur un téléphone ?",
  faqPhoneA:
    "Oui, les quatre vues. La carte et le calendrier sont les deux qui valent particulièrement leur place sur un téléphone : ce qui est près de moi, et ce qui est dû aujourd'hui, répondus depuis la camionnette sans appeler le bureau.",

  ctaTitle: "Arrêtez de garder l'horaire dans votre tête.",

  boardSourceHeater: "ça coule partout sur le plancher du sous-sol",
  boardSourceQuote: "quelqu'un peut passer mardi ?",
  boardSourceDrain: "ça refoule encore",
  boardDueTue: "mar.",
  boardAddressHeater: "114, rue Bishop",
  boardToDo: "À faire",
  boardDone: "Terminé",
  boardToday: "Aujourd'hui",
  boardYesterday: "Hier",
  boardCardHeater: "Remplacement de chauffe-eau, rue Bishop",
  boardCardQuote: "Faire la soumission des Henderson",
  boardCardDrain: "Débouchage de drain, Marcus T",
  ctaSubBefore:
    "Des textos et des appels qui deviennent des jobs avec un responsable et une date,",
  ctaSubAfter: ". Voyez le prix.",
};

const TASKS_COPY = {
  en: tasksEn,
  "fr-CA": tasksFr,
} as const;

export type TasksCopy = typeof tasksEn | typeof tasksFr;

export function tasksCopy(locale: MarketingLocale = "en"): TasksCopy {
  return TASKS_COPY[locale] ?? tasksEn;
}
