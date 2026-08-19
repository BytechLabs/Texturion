import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /for/contractors, in both languages.
 *
 * One file per trade, for the reason `for-plumbers.ts` states.
 *
 * Two things only this trade has. Its truth strip carries a link mid-sentence,
 * so that line is split around the anchor rather than holding a hole. And its
 * thread marks a message done, so the done-label ("Done · Omar · 8:16 AM") is
 * copy too — it is rendered text, not a timestamp the code formats.
 */
export const contractorsEn = {
  metaTitle: "Texting software for contractors",
  metaDescription:
    "One business line for the client, the GC and the subs: change orders approved in writing, decisions on the record, and the job off your personal cell. Texts, calls and voicemail, one flat monthly price, {claim}.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Contractors",
  displayName: "Contractors",

  dateline: "8:02 AM · CHANGE ORDER",
  h1: "One line for the whole contracting crew.",
  heroSubBefore:
    "The homeowner's change request is worth real money, if it lands where the crew can see it and gets approved in writing. Loonext gives the client, the GC and the subs one business number to text or call, and the crew one shared inbox, so every decision is on the record and every job that comes out of it has an owner.",
  heroSubAfter: "a month.",
  heroTruth: "Job texts off your personal cell · {chip} · Month to month",

  painH2: "The change order is in a text thread on your estimator's phone.",
  painBodyOne:
    "On a job site, everything runs through whoever's number is on the estimate. The homeowner texts a change, the electrician texts a question, the supplier texts that the tile's in, all to one personal cell, in between the family group chat. Miss one and you're redoing an island in the wrong material or holding up a sub for a day.",
  painBodyTwo:
    "The stakes outlast the day, too. When it's time to invoice a change, the “proof” is a text thread on a phone that walks off the job if that person does. Loonext makes the number the business's and the conversation the crew's: the change request gets filed against the job, priced, and approved in writing, where everyone can see it.",

  threadH2: "A change order, approved in writing before the template.",
  threadLede:
    "The homeowner calls at 7:59 AM, before anyone is off the site, and her voicemail arrives written out. The thread texts her back on its own, and she puts the change of heart in writing at 8:02. The office files it against the job, checks the counter schedule, assigns it, and texts back a price. “Approved” lands thirteen minutes later, on the record, and the request is marked done.",
  threadAriaLabel:
    "A contracting conversation: a 7:59 AM voicemail about a homeowner's island change, texted back automatically and confirmed at 8:02 AM, priced at $840 and approved in writing before Thursday's counter template",

  scriptVoicemail:
    "Morning, it's Karen at the Fairview house. We've changed our minds about the island counter and I wanted to catch you before anything gets ordered. Call me back when you get a chance.",
  scriptTextBack:
    "Sorry we missed your call, the crew is on site until 8. Text us right here and we'll pick it up from the office.",
  scriptInbound:
    "Morning! We slept on it and we'd like the island in the walnut butcher block after all, not the laminate. Is it too late to change?",
  scriptNote:
    "That's the Fairview kitchen. Filing this against the job before it gets buried. Counters don't template until Thursday, so we're inside the window",
  scriptAssigned: "{by} assigned this conversation to {to}",
  scriptReply:
    "Hi Karen, not too late. Walnut butcher block for the island adds $840 and two days to the counter schedule. Reply approved and I'll write it up as a change order so it's on the record before Thursday's template.",
  scriptApproved: "Approved! Thank you for making that painless",
  scriptTagged: "{by} added the tag {tag}",
  scriptTagWon: "Won",
  scriptDoneLabel: "Done · Omar · 8:16 AM",

  useCasesH2: "Where a shared inbox earns its keep on a job site.",
  useCaseDecisionsTitle: "Decisions in writing.",
  useCaseDecisionsBody:
    "“Walnut butcher block adds $840. Reply approved and I'll write it up.” The request, the price, and the yes all sit in the thread with names and times. When you invoice the change, the conversation is the record behind it.",
  useCaseSubsTitle: "Sub coordination on the business number.",
  useCaseSubsBody:
    "The electrician's question gets assigned to whoever owns that trade, answered in the thread, and marked done. Nothing waits on you personally, and nothing gets answered twice.",
  useCasePhotosTitle: "Photo documentation, job by job.",
  useCasePhotosBody:
    "Progress shots, the finished cut-in, the thing the client needs to approve before you proceed. All in the conversation, free to receive, visible to whoever picks the job up tomorrow.",
  useCaseCellTitle: "Off your personal cell.",
  useCaseCellBody:
    "The number on the estimate belongs to the business. Take a day off and the crew covers the inbox; your evenings stop belonging to the job.",

  savedRepliesH2: "Six texts every contractor sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the site-access confirm, the change-order write-up, the progress update, in a straight, professional voice. Save each one once and it's two taps forever.",
  replyAccessName: "Site access confirmed",
  replyAccessText:
    "Got the access details, thanks. The crew will be on site Tuesday at 8am. I'll text you a photo once we're rolling.",
  replyChangeName: "Change order",
  replyChangeText:
    "That change is doable. I'll price it today, and if the number works for you, reply approved and I'll write it up as a change order and get it moving.",
  replyProgressName: "Client progress update",
  replyProgressText:
    "Quick update, {first_name}: rough-in is done and drywall starts Monday. Photos attached. Still on track, and I'll flag you the moment anything shifts.",
  replySubName: "Sub coordination",
  replySubText:
    "We'll be ready for you Thursday. Rough-in's complete and the area's cleared. Text me here if the timing moves on your end.",
  replyDecisionName: "Need a decision",
  replyDecisionText:
    "Before we go further we need your call on the counter material. Options and costs are in the next text. Whenever you're ready, we'll hold your spot in the schedule.",
  replyWalkthroughName: "Walkthrough / punch list",
  replyWalkthroughText:
    "We're wrapping up. Want to do a walkthrough Friday to build the punch list together? Anything you spot, we'll knock out before final.",
  savedRepliesCaption:
    "The contracting pack in the composer: the change-order write-up is two taps, not a forgotten promise.",

  featuresH2: "Built for how a contractor actually works.",
  featureDoneTitle: "Mark any message done.",
  featureDoneBody:
    "The address text, the paint spec, the “need a decision.” Tap it done in the thread when it's handled: strikethrough, a check with who and when, synced to the crew. No jobs board, no second app.",
  featureHandoffTitle: "Hand off without dropping the ball.",
  featureHandoffBody:
    "Assign a conversation to whoever's covering that trade or that day. One owner per thread, so a sub's question never sits on “I thought you had it.”",
  featureNotesTitle: "Notes the client never sees.",
  featureNotesBody:
    "“Change orders through me, not the client” or “this sub runs late.” Internal notes on the conversation, visible to the crew, never sent.",
  featureNumberTitle: "The number is the business's.",
  featureNumberBody:
    "A local number on the estimate that stays with the company. When a crew member moves on, the conversations and contacts don't leave with their phone.",

  pricingH2After: "a month for the whole crew.",
  pricingBodyBefore:
    "Starter covers 3 people, 1 local number, and texting sized for a small crew running a couple of jobs on a fair-use basis, not a hard cap, and the composer shows the count before you send. Running a bigger crew with subs, or want the office and the field on separate lines? Pro is",
  pricingBodyAfter: "for up to 15 people and 2 numbers.",

  truthSuiteBefore:
    "Loonext turns conversations into jobs; it is not a construction suite. The",
  truthSuiteLink: "compare pages",
  truthSuiteAfter: "say when a bigger platform fits better.",

  faqH2: "Contractor questions, straight answers.",
  faqPmQ: "Is this a project-management or “jobs” app?",
  faqPmA:
    "Half of one, on purpose. There are real tasks: turn any text or call into a job with an owner, a due date and an address, and work them from a list, a board, a calendar you can drag to reschedule, or a map of where they are. Every task stays linked to the message it came from, so “paint the hall Hale Navy” keeps the customer's exact words attached to it. What you will not find is the rest of a construction suite: no Gantt charts, no dependencies, no crew dispatch or time tracking, and no invoicing. It is the work that comes out of a conversation, not a replacement for your estimating software.",
  faqDoneQ: "So how does “mark done” actually work?",
  faqDoneA:
    "Two ways, and the light one is the one you will use most. Tap any message, whether it's the builder's address, a change request, or a sub's question, and it's marked done: the text gets a line through it, a small check shows who did it and when, and everyone's phone updates. Tap again to un-mark it. When something needs more than a check, promote that same message into a task with an owner and a due date and it appears on the crew's board. The message is still the source either way.",
  faqSeparateQ:
    "Can I keep the client, the subs, and my personal life separate?",
  faqSeparateA:
    "Yes. The business number handles all the job comms in the shared inbox; your personal cell goes back to being personal. Assign conversations so the right person owns each one, and use internal notes for the “this stays between us” details the client never needs to see.",
  faqProofQ: "Where's the proof if a client disputes a change order?",
  faqProofA:
    "In the thread. The request, your price, and their approval are all there in writing, with names and timestamps, and because it's the business's inbox, not one person's phone, it doesn't walk off the job if someone leaves. Loonext doesn't generate the change-order paperwork, but the conversation is the record behind it.",
  faqOutQ: "If I'm out for a day, does the whole job stall?",
  faqOutA:
    "Not when the conversations live in a shared inbox. Hand off the active threads by assigning them, and whoever's covering sees the full history on their own phone: the address, the spec, the open items still marked not done. The job doesn't wait on one person's texts.",
  faqRegisterQ:
    "What do you need from our company to get the number registered?",
  faqRegisterUs:
    "We file the whole thing for you: a couple of minutes at signup and three things, your legal business name, address, and EIN. Operating as a sole proprietor without an EIN? There's a path for that: we text you a verification code and take care of the rest. You can receive texts immediately, and texting US numbers activates in about a week once you're cleared.",
  faqRegisterCa:
    "Nothing to register and no wait. You can text Canadian customers the same day you sign up.",

  finalH2: "Get the job off your personal phone.",
  finalSub:
    "One shared inbox for the client, the GC, and the subs, where every decision lands in writing. {claim}.",
} as const;

export const contractorsFr: Translated<typeof contractorsEn> = {
  metaTitle: "Logiciel de textos pour entrepreneurs",
  metaDescription:
    "Une seule ligne d'affaires pour le client, l'entrepreneur général et les sous-traitants : des ordres de changement approuvés par écrit, des décisions au dossier, et la job sortie de votre cellulaire personnel. Textos, appels et messagerie vocale, un seul prix mensuel fixe, {claim}.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Entrepreneurs",
  displayName: "Entrepreneurs",

  dateline: "8 H 02 · ORDRE DE CHANGEMENT",
  h1: "Une seule ligne pour toute l'équipe de construction.",
  heroSubBefore:
    "La demande de changement du propriétaire vaut de vrais dollars, si elle atterrit là où l'équipe la voit et qu'elle est approuvée par écrit. Loonext donne au client, à l'entrepreneur général et aux sous-traitants un seul numéro d'entreprise pour écrire ou appeler, et à l'équipe une seule boîte partagée, pour que chaque décision soit au dossier et que chaque job qui en sort ait un responsable.",
  heroSubAfter: "par mois.",
  heroTruth:
    "Les textos de chantier hors de votre cellulaire personnel · {chip} · Au mois",

  painH2:
    "L'ordre de changement est dans un fil de textos sur le téléphone de votre estimateur.",
  painBodyOne:
    "Sur un chantier, tout passe par celui dont le numéro est sur la soumission. Le propriétaire écrit un changement, l'électricien écrit une question, le fournisseur écrit que la tuile est arrivée, tout ça sur un seul cellulaire personnel, entre deux messages du groupe familial. Manquez-en un et vous refaites un îlot dans le mauvais matériau ou vous retenez un sous-traitant une journée.",
  painBodyTwo:
    "Les enjeux durent plus longtemps que la journée, aussi. Quand vient le temps de facturer un changement, la « preuve » est un fil de textos sur un téléphone qui quitte le chantier si cette personne le fait. Loonext rend le numéro celui de l'entreprise et la conversation celle de l'équipe : la demande de changement est classée sous la job, chiffrée et approuvée par écrit, là où tout le monde la voit.",

  threadH2:
    "Un ordre de changement, approuvé par écrit avant la prise de mesures.",
  threadLede:
    "La propriétaire appelle à 7 h 59, avant que quiconque ait quitté le chantier, et son message vocal arrive mis par écrit. Le fil lui répond par texto tout seul, et elle met son changement d'idée par écrit à 8 h 02. Le bureau le classe sous la job, vérifie l'horaire des comptoirs, l'assigne, et répond par texto avec un prix. « Approuvé » arrive treize minutes plus tard, au dossier, et la demande est marquée terminée.",
  threadAriaLabel:
    "Une conversation d'entrepreneur : un message vocal à 7 h 59 au sujet d'un changement d'îlot par la propriétaire, avec un texto de retour automatique et une confirmation à 8 h 02, chiffré à 840 $ et approuvé par écrit avant la prise de mesures des comptoirs le jeudi",

  scriptVoicemail:
    "Bonjour, c'est Karen de la maison sur Fairview. On a changé d'idée pour le comptoir de l'îlot et je voulais vous joindre avant que quoi que ce soit soit commandé. Rappelez-moi quand vous pourrez.",
  scriptTextBack:
    "Désolés d'avoir manqué votre appel, l'équipe est sur le chantier jusqu'à 8 h. Écrivez-nous ici même et on prendra le relais depuis le bureau.",
  scriptInbound:
    "Bonjour ! On y a repensé et on aimerait finalement l'îlot en bloc de boucher en noyer, pas en stratifié. Est-il trop tard pour changer ?",
  scriptNote:
    "C'est la cuisine sur Fairview. Je classe ça sous la job avant que ça se perde. Les comptoirs ne se mesurent pas avant jeudi, alors on est dans la fenêtre",
  scriptAssigned: "{by} a assigné cette conversation à {to}",
  scriptReply:
    "Bonjour Karen, il n'est pas trop tard. Le bloc de boucher en noyer pour l'îlot ajoute 840 $ et deux jours à l'horaire des comptoirs. Répondez « approuvé » et je le rédige comme ordre de changement pour que ce soit au dossier avant la prise de mesures de jeudi.",
  scriptApproved: "Approuvé ! Merci d'avoir rendu ça facile",
  scriptTagged: "{by} a ajouté l'étiquette {tag}",
  scriptTagWon: "Gagné",
  scriptDoneLabel: "Terminé · Omar · 8 h 16",

  useCasesH2: "Là où une boîte partagée gagne sa place sur un chantier.",
  useCaseDecisionsTitle: "Des décisions par écrit.",
  useCaseDecisionsBody:
    "« Le bloc de boucher en noyer ajoute 840 $. Répondez approuvé et je le rédige. » La demande, le prix et le oui sont tous dans le fil avec les noms et les heures. Quand vous facturez le changement, la conversation est la preuve derrière.",
  useCaseSubsTitle:
    "La coordination des sous-traitants sur le numéro d'entreprise.",
  useCaseSubsBody:
    "La question de l'électricien est assignée à celui qui gère ce métier, répondue dans le fil, et marquée terminée. Rien n'attend après vous personnellement, et rien n'obtient deux réponses.",
  useCasePhotosTitle: "La documentation photo, job par job.",
  useCasePhotosBody:
    "Les photos d'avancement, la découpe finie, la chose que le client doit approuver avant que vous continuiez. Tout dans la conversation, gratuit à recevoir, visible pour celui qui reprend la job demain.",
  useCaseCellTitle: "Hors de votre cellulaire personnel.",
  useCaseCellBody:
    "Le numéro sur la soumission appartient à l'entreprise. Prenez une journée de congé et l'équipe couvre la boîte ; vos soirées arrêtent d'appartenir au chantier.",

  savedRepliesH2: "Six textos que tout entrepreneur envoie. Volez-les.",
  savedRepliesIntro:
    "Six réponses enregistrées à installer dès le premier jour : la confirmation d'accès au chantier, la rédaction d'ordre de changement, la mise à jour d'avancement, d'une voix directe et professionnelle. Enregistrez-en chacune une fois et c'est deux touches pour toujours.",
  replyAccessName: "Accès au chantier confirmé",
  replyAccessText:
    "J'ai bien reçu les détails d'accès, merci. L'équipe sera sur le chantier mardi à 8 h. Je vous enverrai une photo une fois qu'on sera parti.",
  replyChangeName: "Ordre de changement",
  replyChangeText:
    "Ce changement est faisable. Je le chiffre aujourd'hui, et si le montant vous convient, répondez « approuvé » et je le rédige comme ordre de changement et je le mets en marche.",
  replyProgressName: "Mise à jour d'avancement au client",
  replyProgressText:
    "Petite mise à jour, {first_name} : la plomberie brute est finie et le gypse commence lundi. Photos en pièce jointe. Toujours dans les temps, et je vous préviens dès que quelque chose bouge.",
  replySubName: "Coordination avec un sous-traitant",
  replySubText:
    "On sera prêts pour vous jeudi. La partie brute est finie et la zone est dégagée. Écrivez-moi ici si le moment change de votre côté.",
  replyDecisionName: "Décision nécessaire",
  replyDecisionText:
    "Avant qu'on aille plus loin, on a besoin de votre décision sur le matériau du comptoir. Les options et les coûts sont dans le prochain texto. Quand vous serez prêt, on garde votre place à l'horaire.",
  replyWalkthroughName: "Visite finale / liste de déficiences",
  replyWalkthroughText:
    "On termine. Voulez-vous faire une visite vendredi pour bâtir la liste de déficiences ensemble ? Tout ce que vous remarquez, on le règle avant la fin.",
  savedRepliesCaption:
    "L'ensemble de construction dans le champ de saisie : la rédaction d'ordre de changement est à deux touches, pas une promesse oubliée.",

  featuresH2: "Bâti pour la façon dont un entrepreneur travaille vraiment.",
  featureDoneTitle: "Marquez n'importe quel message terminé.",
  featureDoneBody:
    "Le texto d'adresse, la spécification de peinture, le « décision nécessaire ». Touchez-le pour le marquer terminé dans le fil quand c'est réglé : une rature, un crochet avec qui et quand, synchronisé à l'équipe. Aucun tableau de jobs, aucune deuxième application.",
  featureHandoffTitle: "Passez le relais sans échapper la balle.",
  featureHandoffBody:
    "Assignez une conversation à celui qui couvre ce métier ou cette journée. Un seul responsable par fil, alors la question d'un sous-traitant ne reste jamais coincée sur un « je pensais que tu l'avais ».",
  featureNotesTitle: "Des notes que le client ne voit jamais.",
  featureNotesBody:
    "« Les ordres de changement passent par moi, pas par le client » ou « ce sous-traitant est souvent en retard ». Des notes internes sur la conversation, visibles par l'équipe, jamais envoyées.",
  featureNumberTitle: "Le numéro appartient à l'entreprise.",
  featureNumberBody:
    "Un numéro local sur la soumission qui reste avec la compagnie. Quand un membre de l'équipe s'en va, les conversations et les contacts ne partent pas avec son téléphone.",

  pricingH2After: "par mois pour toute l'équipe.",
  pricingBodyBefore:
    "Starter couvre 3 personnes, 1 numéro local, et des textos taillés pour une petite équipe qui mène quelques chantiers sur une base d'utilisation équitable, pas un plafond rigide, et le champ de saisie montre le compte avant l'envoi. Vous menez une plus grosse équipe avec des sous-traitants, ou vous voulez le bureau et le terrain sur des lignes séparées ? Pro est à",
  pricingBodyAfter: "pour un maximum de 15 personnes et 2 numéros.",

  truthSuiteBefore:
    "Loonext transforme les conversations en jobs ; ce n'est pas une suite de gestion de chantier. Les",
  truthSuiteLink: "pages de comparaison",
  truthSuiteAfter: "disent quand une plus grosse plateforme convient mieux.",

  faqH2: "Questions d'entrepreneurs, réponses directes.",
  faqPmQ: "Est-ce une application de gestion de projet ou de « jobs » ?",
  faqPmA:
    "À moitié, volontairement. Il y a de vraies tâches : transformez n'importe quel texto ou appel en job avec un responsable, une échéance et une adresse, et travaillez-les depuis une liste, un tableau, un calendrier que vous glissez pour reporter, ou une carte de leur emplacement. Chaque tâche reste liée au message dont elle vient, alors « peindre le corridor en Hale Navy » garde les mots exacts du client attachés. Ce que vous ne trouverez pas, c'est le reste d'une suite de construction : aucun diagramme de Gantt, aucune dépendance, aucune répartition d'équipe ni suivi du temps, et aucune facturation. C'est le travail qui sort d'une conversation, pas un remplacement pour votre logiciel d'estimation.",
  faqDoneQ: "Alors comment fonctionne « marquer terminé », concrètement ?",
  faqDoneA:
    "De deux façons, et la légère est celle que vous utiliserez le plus. Touchez n'importe quel message — l'adresse du constructeur, une demande de changement, la question d'un sous-traitant — et il est marqué terminé : le texte se fait raturer, un petit crochet montre qui l'a fait et quand, et le téléphone de tout le monde se met à jour. Touchez encore pour l'annuler. Quand quelque chose a besoin de plus qu'un crochet, transformez ce même message en tâche avec un responsable et une échéance et elle apparaît sur le tableau de l'équipe. Le message reste la source dans les deux cas.",
  faqSeparateQ:
    "Puis-je garder le client, les sous-traitants et ma vie personnelle séparés ?",
  faqSeparateA:
    "Oui. Le numéro d'entreprise gère toutes les communications de chantier dans la boîte partagée ; votre cellulaire personnel redevient personnel. Assignez les conversations pour que la bonne personne soit responsable de chacune, et utilisez les notes internes pour les détails « ça reste entre nous » que le client n'a jamais besoin de voir.",
  faqProofQ:
    "Où est la preuve si un client conteste un ordre de changement ?",
  faqProofA:
    "Dans le fil. La demande, votre prix et son approbation sont tous là par écrit, avec les noms et les heures, et parce que c'est la boîte de l'entreprise et non le téléphone d'une personne, ça ne quitte pas le chantier si quelqu'un s'en va. Loonext ne génère pas la paperasse d'ordre de changement, mais la conversation est la preuve derrière.",
  faqOutQ: "Si je suis absent une journée, est-ce que toute la job arrête ?",
  faqOutA:
    "Pas quand les conversations vivent dans une boîte partagée. Passez les fils actifs en les assignant, et celui qui remplace voit tout l'historique sur son propre téléphone : l'adresse, la spécification, les points ouverts encore non terminés. La job n'attend pas après les textos d'une seule personne.",
  faqRegisterQ:
    "De quoi avez-vous besoin de notre entreprise pour faire enregistrer le numéro ?",
  faqRegisterUs:
    "On dépose tout pour vous : quelques minutes à l'inscription et trois choses, votre nom légal d'entreprise, votre adresse et votre EIN. Vous opérez comme travailleur autonome sans EIN ? Il y a un parcours pour ça : on vous envoie un code de vérification par texto et on s'occupe du reste. Vous pouvez recevoir des textos immédiatement, et l'envoi vers des numéros américains s'active en environ une semaine une fois que vous êtes approuvé.",
  faqRegisterCa:
    "Rien à enregistrer et aucune attente. Vous pouvez écrire à des clients canadiens le jour même de votre inscription.",

  finalH2: "Sortez la job de votre téléphone personnel.",
  finalSub:
    "Une seule boîte partagée pour le client, l'entrepreneur général et les sous-traitants, où chaque décision atterrit par écrit. {claim}.",
};

const CONTRACTORS_COPY = {
  en: contractorsEn,
  "fr-CA": contractorsFr,
} as const;

export type ContractorsCopy = typeof contractorsEn | typeof contractorsFr;

export function contractorsCopy(
  locale: MarketingLocale = "en",
): ContractorsCopy {
  return CONTRACTORS_COPY[locale] ?? contractorsEn;
}
