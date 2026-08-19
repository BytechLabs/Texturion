import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /for/cleaners, in both languages.
 *
 * One file per trade, for the reason `for-plumbers.ts` states: the six trade
 * pages share a template and share no sentences, so a single catalogue would
 * invite exactly the cross-trade reuse the pages forbid.
 *
 * `{first_name}` in the visit-confirmation template stays as it is: the product
 * substitutes it at send time, and a translated token ships to a customer
 * literally.
 */
export const cleanersEn = {
  metaTitle: "Texting software for cleaning companies",
  metaDescription:
    "One business line for your cleaning team: access notes, reschedules and add-ons on one timeline the whole crew can see. Texts, calls and voicemail, one flat monthly price, {claim}.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Cleaners",
  displayName: "Cleaners",

  dateline: "5:56 PM · KEY UNDER MAT?",
  h1: "One line for the whole cleaning crew.",
  heroSubBefore:
    "Key under the mat, dog in the crate, oven this time, and Friday moved to Monday. Half of cleaning is what the client told you last week, and it can't live on one phone. Loonext keeps every access note, reschedule and add-on on one timeline the whole team can see, whether the client texted it or said it on the phone.",
  heroSubAfter: "a month.",
  heroTruth: "Access notes saved to the client · {chip} · Month to month",

  painH2: "Every key, code, and reschedule lives in somebody's texts.",
  painBodyOne:
    "Cleaning is a relationship business built on repetition: the same homes and offices, week after week, and every one of them has a way in. A door code, a lockbox, a “key's under the mat this Friday.” When that lives in one owner's text history, the cleaner covering a shift is locked out on the porch, texting “what's the code again?” to a phone that's busy.",
  painBodyTwo:
    "Then there are the reschedules. A client pushes Friday to Monday, someone says yes, and now two cleaners think they're covering it, or nobody does. With one shared inbox, the access notes sit on the client, the reschedule is visible to everyone, and whoever shows up already knows the code, the dog, and what the client asked for last time.",

  threadH2: "A key under the mat, and a Friday moved to Monday.",
  threadLede:
    "A regular calls just before six and the office picks up, then texts the entry instructions so they are in writing. The key note goes on her contact, the team's Friday opens up, and Monday's visit is confirmed with a window, all before dinner. The call and the text are one conversation.",
  threadAriaLabel:
    "A cleaning company conversation: an answered call just before 6 PM, new key instructions at 5:56 PM, and a Friday clean rescheduled to Monday between 10 and noon",

  scriptInbound:
    "Thanks for taking my call. Putting it in writing like you asked: we're away Friday, so the key will be under the mat, the door code stopped working. And could we move Friday's clean to Monday instead?",
  scriptNote:
    "Saving the key note to her contact. Rosa, your Friday just opened up. Can you and Ana take her Monday between 10 and noon?",
  scriptAssigned: "{by} assigned this conversation to {to}",
  scriptReply:
    "Hi Nadia, Monday's no problem. Ana and I will be there between 10 and noon, key under the mat, and we'll lock up and text you when we're done. Anything you want us to focus on this visit?",
  scriptConfirm: "Perfect. Just the oven if you have time. Thank you!",
  scriptTagged: "{by} added the tag {tag}",
  scriptTagScheduled: "Scheduled",

  useCasesH2: "Where a shared inbox earns its keep in a cleaning business.",
  useCaseEntryTitle: "Entry notes the customer never sees.",
  useCaseEntryBody:
    "“Code 4482, lockbox on the left, dog stays crated.” Save it once as an internal note and every cleaner sees it before they arrive. Internal notes are marked, locked, and never sent as a text.",
  useCaseConfirmTitle: "Recurring-visit confirmations, in two taps.",
  useCaseConfirmBody:
    "The night before, send your regulars a quick “we're on for tomorrow between 10 and noon” with a saved reply. Fewer surprised clients, fewer wasted trips to a house nobody's home at.",
  useCaseAddOnTitle: "Add-on requests, on the record.",
  useCaseAddOnBody:
    "“Just the oven if you have time” lands in the thread, where the team doing the visit actually sees it, and where you can price the deep clean in writing before you show up.",
  useCaseRescheduleTitle: "Reschedules everyone can see.",
  useCaseRescheduleBody:
    "A client moves Friday to Monday and the whole team sees the change in one thread. No double-coverage, no gap, and the history shows which week you skipped.",

  savedRepliesH2: "Six texts every cleaning team sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the confirm-the-recurring, the access check, the add-on ask, in the warm, brief tone clients expect from you. Save each one once and it's two taps forever.",
  replyVisitName: "Visit confirmation",
  replyVisitText:
    "Hi {first_name}! Confirming your clean tomorrow between 10 and noon. Reply here if anything's changed; otherwise, see you then.",
  replyAccessName: "Access check",
  replyAccessText:
    "Before we come by, is the entry still the same (code or lockbox), and anything we should know about pets or areas to skip?",
  replyOnOurWayName: "On our way",
  replyOnOurWayText:
    "The team's heading over now and will be there shortly. We'll text you when we lock up.",
  replyAddOnName: "Add-on offer",
  replyAddOnText:
    "We've got a little extra time this visit. Want us to add the oven or inside the windows? It'd be $40 on top of the usual.",
  replyRescheduleName: "Reschedule",
  replyRescheduleText:
    "No problem moving your clean. We can do Monday between 10 and noon instead. Does that work? Same team, same rate.",
  replyDoneName: "All done",
  replyDoneText:
    "All finished and locked up. Left everything as you like it. If anything's not quite right, text us here and we'll make it good.",
  savedRepliesCaption:
    "The cleaning pack in the composer: tomorrow's confirmations go out in a couple of taps each.",

  featuresH2: "Built for how a cleaning company actually works.",
  featureNotesTitle: "Access notes the customer never sees.",
  featureNotesBody:
    "Codes, quirks, “skip the office upstairs.” Kept as internal notes on the client, visible to the team, never sent as a text.",
  featureDispatchTitle: "Dispatch the right team.",
  featureDispatchBody:
    "Assign each visit to the cleaners covering it, so there's one owner and no double-coverage on a reschedule.",
  featureHistoryTitle: "One history per client.",
  featureHistoryBody:
    "Every visit, every add-on, every note in one thread, so a fill-in cleaner is never starting from zero.",
  featureApronTitle: "Works on the phone in their apron.",
  featureApronBody:
    "No app to install, one-handed replies between houses, push notifications when a client texts. If they can text, they can use it.",

  pricingH2After: "a month for the whole team.",
  pricingBodyBefore:
    "Starter is 3 people, 1 local number, and texting sized for confirming a route of recurring clients on a fair-use basis, not a hard cap; a plain confirmation counts as one text, and the composer shows the count before you send. Growing past three cleaners, or running residential and commercial lines separately? Pro is",
  pricingBodyAfter: "for up to 15 people and a second number.",

  faqH2: "Cleaner questions, straight answers.",
  faqCodeQ:
    "Can the whole team see a client's gate code without me texting it around?",
  faqCodeA:
    "Yes. Save the code and access notes to the client as an internal note, and every cleaner sees it on their own phone before they arrive. Customers never see internal notes; it's not a text, it's a note attached to the conversation.",
  faqRescheduleQ:
    "We reschedule a lot. Will two cleaners end up covering the same house?",
  faqRescheduleA:
    "Not when the reschedule is in one shared inbox. Assign the visit to one owner and the whole team sees who's got it and when. No double-coverage, no gap. Loonext doesn't move appointments for you, but everyone's looking at the same thread instead of separate phones.",
  faqRegularsQ:
    "Most of our clients are weekly or biweekly regulars. Does texting help?",
  faqRegularsA:
    "That's exactly where it shines. The full history of a recurring client, with the access notes, the add-ons, and that one thing they always want done, sits in one thread, so any cleaner you send is up to speed, and confirming the next visit is a two-tap saved reply.",
  faqOfficeQ: "Our cleaners aren't office people. Is this hard to use?",
  faqOfficeA:
    "It looks and works like texting, on the phone they already have. They open a link, and they're in. Nothing to install, no training day. Access notes and assignments just appear in the conversation.",
  faqConfirmQ: "Do confirmation texts use up our included texting?",
  faqConfirmA:
    "A plain confirmation counts as one text, and texting is included on a fair-use basis sized for exactly this, so a route of “see you tomorrow” messages is fine. The composer shows the count before you send, and if a busy stretch runs past your included texting, extra texts bill at a small per-text rate with a cap you control, so there's no surprise bill.",
  faqRegisterQ:
    "What's involved in getting our cleaning business registered to text?",
  faqRegisterUs:
    "We handle it. At signup you'll enter your legal business name, address, and EIN, and if you clean as a sole proprietor without an EIN, there's a path for that too: we text you a code to verify and take it from there. We file the paperwork. Receiving texts works immediately, and texting US clients switches on within about a week once you're approved.",
  faqRegisterCa:
    "Nothing to register and no wait. If you clean Canadian homes for Canadian customers, you start texting the same day you sign up.",

  finalH2: "Get every gate code off one person's phone.",
  finalSub:
    "One shared inbox for recurring clients, access notes, and reschedules, so whoever shows up knows how to get in. {claim}.",
} as const;

export const cleanersFr: Translated<typeof cleanersEn> = {
  metaTitle: "Logiciel de textos pour entreprises de ménage",
  metaDescription:
    "Une seule ligne d'affaires pour votre équipe de ménage : les notes d'accès, les changements d'horaire et les extras sur une seule ligne du temps que toute l'équipe voit. Textos, appels et messagerie vocale, un seul prix mensuel fixe, {claim}.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Entreprises de ménage",
  displayName: "Entreprises de ménage",

  dateline: "17 H 56 · CLÉ SOUS LE PAILLASSON ?",
  h1: "Une seule ligne pour toute l'équipe de ménage.",
  heroSubBefore:
    "La clé sous le paillasson, le chien dans la cage, le four cette fois-ci, et le vendredi déplacé au lundi. La moitié du ménage, c'est ce que la cliente vous a dit la semaine dernière, et ça ne peut pas vivre sur un seul téléphone. Loonext garde chaque note d'accès, chaque changement d'horaire et chaque extra sur une seule ligne du temps que toute l'équipe voit, que la cliente l'ait écrit ou dit au téléphone.",
  heroSubAfter: "par mois.",
  heroTruth:
    "Notes d'accès enregistrées sur le client · {chip} · Au mois",

  painH2:
    "Chaque clé, chaque code et chaque changement d'horaire vit dans les textos de quelqu'un.",
  painBodyOne:
    "Le ménage est un métier de relations bâti sur la répétition : les mêmes maisons et les mêmes bureaux, semaine après semaine, et chacun a sa façon d'entrer. Un code de porte, une boîte à clé, un « la clé est sous le paillasson ce vendredi ». Quand ça vit dans l'historique de textos d'une seule personne, celle qui remplace un quart reste barrée dehors sur le perron, à écrire « c'est quoi le code déjà ? » à un téléphone occupé.",
  painBodyTwo:
    "Puis il y a les changements d'horaire. Une cliente repousse vendredi à lundi, quelqu'un dit oui, et là deux personnes pensent le couvrir, ou personne. Avec une seule boîte partagée, les notes d'accès sont sur la cliente, le changement est visible pour tout le monde, et celle qui se présente sait déjà le code, le chien, et ce que la cliente a demandé la dernière fois.",

  threadH2: "Une clé sous le paillasson, et un vendredi déplacé au lundi.",
  threadLede:
    "Une habituée appelle juste avant six heures et le bureau répond, puis elle écrit les instructions d'entrée pour qu'elles soient par écrit. La note de clé va sur son contact, le vendredi de l'équipe se libère, et la visite du lundi est confirmée avec une plage horaire, le tout avant le souper. L'appel et le texto sont une seule conversation.",
  threadAriaLabel:
    "Une conversation d'entreprise de ménage : un appel répondu juste avant 18 h, de nouvelles instructions de clé à 17 h 56, et un ménage du vendredi reporté au lundi entre 10 h et midi",

  scriptInbound:
    "Merci d'avoir pris mon appel. Je le mets par écrit comme vous l'avez demandé : on est partis vendredi, alors la clé sera sous le paillasson, le code de porte a arrêté de fonctionner. Et est-ce qu'on pourrait déplacer le ménage du vendredi au lundi ?",
  scriptNote:
    "J'enregistre la note de clé sur son contact. Rosa, ton vendredi vient de se libérer. Est-ce que toi et Ana pouvez la prendre lundi entre 10 h et midi ?",
  scriptAssigned: "{by} a assigné cette conversation à {to}",
  scriptReply:
    "Bonjour Nadia, lundi ça ne pose aucun problème. Ana et moi serons là entre 10 h et midi, la clé sous le paillasson, et on barrera en partant et on vous écrira quand ce sera fait. Y a-t-il quelque chose sur quoi vous voulez qu'on se concentre cette visite ?",
  scriptConfirm: "Parfait. Juste le four si vous avez le temps. Merci !",
  scriptTagged: "{by} a ajouté l'étiquette {tag}",
  scriptTagScheduled: "Planifié",

  useCasesH2:
    "Là où une boîte partagée gagne sa place dans une entreprise de ménage.",
  useCaseEntryTitle: "Des notes d'entrée que le client ne voit jamais.",
  useCaseEntryBody:
    "« Code 4482, boîte à clé à gauche, le chien reste dans sa cage. » Enregistrez-la une fois comme note interne et chaque personne de l'équipe la voit avant d'arriver. Les notes internes sont marquées, verrouillées, et ne partent jamais comme texto.",
  useCaseConfirmTitle: "Les confirmations de visite récurrente, en deux touches.",
  useCaseConfirmBody:
    "La veille, envoyez à vos habitués un rapide « on est confirmés pour demain entre 10 h et midi » avec une réponse enregistrée. Moins de clients surpris, moins de déplacements inutiles vers une maison où personne n'est là.",
  useCaseAddOnTitle: "Les demandes d'extra, au dossier.",
  useCaseAddOnBody:
    "« Juste le four si vous avez le temps » atterrit dans le fil, là où l'équipe qui fait la visite le voit vraiment, et là où vous pouvez chiffrer le grand ménage par écrit avant de vous présenter.",
  useCaseRescheduleTitle: "Des changements d'horaire que tout le monde voit.",
  useCaseRescheduleBody:
    "Une cliente déplace vendredi au lundi et toute l'équipe voit le changement dans un seul fil. Aucun doublon, aucun trou, et l'historique montre quelle semaine vous avez sautée.",

  savedRepliesH2:
    "Six textos que toute équipe de ménage envoie. Volez-les.",
  savedRepliesIntro:
    "Six réponses enregistrées à installer dès le premier jour : la confirmation du récurrent, la vérification d'accès, la proposition d'extra, dans le ton chaleureux et bref que vos clients attendent de vous. Enregistrez-en chacune une fois et c'est deux touches pour toujours.",
  replyVisitName: "Confirmation de visite",
  replyVisitText:
    "Bonjour {first_name} ! Je confirme votre ménage demain entre 10 h et midi. Répondez ici si quelque chose a changé ; sinon, à demain.",
  replyAccessName: "Vérification d'accès",
  replyAccessText:
    "Avant qu'on passe, est-ce que l'entrée est toujours la même (code ou boîte à clé), et y a-t-il quelque chose à savoir sur les animaux ou les pièces à éviter ?",
  replyOnOurWayName: "En route",
  replyOnOurWayText:
    "L'équipe s'en va maintenant et sera là sous peu. On vous écrit quand on barre en partant.",
  replyAddOnName: "Proposition d'extra",
  replyAddOnText:
    "On a un peu de temps de plus cette visite. Voulez-vous qu'on ajoute le four ou l'intérieur des fenêtres ? Ce serait 40 $ de plus que d'habitude.",
  replyRescheduleName: "Changement d'horaire",
  replyRescheduleText:
    "Aucun problème pour déplacer votre ménage. On peut faire lundi entre 10 h et midi à la place. Est-ce que ça vous convient ? Même équipe, même tarif.",
  replyDoneName: "Terminé",
  replyDoneText:
    "Tout est fini et barré. On a laissé les choses comme vous les aimez. Si quelque chose ne va pas, écrivez-nous ici et on va le corriger.",
  savedRepliesCaption:
    "L'ensemble de ménage dans le champ de saisie : les confirmations de demain partent en deux touches chacune.",

  featuresH2:
    "Bâti pour la façon dont une entreprise de ménage travaille vraiment.",
  featureNotesTitle: "Des notes d'accès que le client ne voit jamais.",
  featureNotesBody:
    "Les codes, les particularités, « sautez le bureau en haut ». Gardées comme notes internes sur le client, visibles par l'équipe, jamais envoyées comme texto.",
  featureDispatchTitle: "Répartissez la bonne équipe.",
  featureDispatchBody:
    "Assignez chaque visite aux personnes qui la couvrent, pour qu'il y ait un seul responsable et aucun doublon lors d'un changement d'horaire.",
  featureHistoryTitle: "Un seul historique par client.",
  featureHistoryBody:
    "Chaque visite, chaque extra, chaque note dans un seul fil, pour qu'un remplaçant ne parte jamais de zéro.",
  featureApronTitle: "Fonctionne sur le téléphone dans leur tablier.",
  featureApronBody:
    "Aucune application à installer, des réponses à une main entre deux maisons, des notifications quand un client écrit. S'ils savent texter, ils savent s'en servir.",

  pricingH2After: "par mois pour toute l'équipe.",
  pricingBodyBefore:
    "Starter, c'est 3 personnes, 1 numéro local, et des textos taillés pour confirmer une tournée de clients récurrents sur une base d'utilisation équitable, pas un plafond rigide ; une confirmation simple compte pour un texto, et le champ de saisie montre le compte avant l'envoi. Vous dépassez trois personnes, ou vous séparez le résidentiel et le commercial ? Pro est à",
  pricingBodyAfter: "pour un maximum de 15 personnes et un deuxième numéro.",

  faqH2: "Questions d'entreprises de ménage, réponses directes.",
  faqCodeQ:
    "Est-ce que toute l'équipe peut voir le code de barrière d'un client sans que je l'envoie par texto à tout le monde ?",
  faqCodeA:
    "Oui. Enregistrez le code et les notes d'accès sur le client comme note interne, et chaque personne de l'équipe la voit sur son propre téléphone avant d'arriver. Les clients ne voient jamais les notes internes ; ce n'est pas un texto, c'est une note attachée à la conversation.",
  faqRescheduleQ:
    "On change souvent l'horaire. Est-ce que deux personnes vont finir par couvrir la même maison ?",
  faqRescheduleA:
    "Pas quand le changement est dans une seule boîte partagée. Assignez la visite à un seul responsable et toute l'équipe voit qui l'a et quand. Aucun doublon, aucun trou. Loonext ne déplace pas les rendez-vous à votre place, mais tout le monde regarde le même fil au lieu de téléphones séparés.",
  faqRegularsQ:
    "La plupart de nos clients sont hebdomadaires ou aux deux semaines. Est-ce que le texto aide ?",
  faqRegularsA:
    "C'est exactement là que ça brille. L'historique complet d'un client récurrent, avec les notes d'accès, les extras et cette chose qu'il veut toujours qu'on fasse, tient dans un seul fil, alors n'importe qui vous envoyez est à jour, et confirmer la prochaine visite est une réponse enregistrée à deux touches.",
  faqOfficeQ:
    "Nos employés ne sont pas des gens de bureau. Est-ce que c'est difficile à utiliser ?",
  faqOfficeA:
    "Ça ressemble et ça fonctionne comme des textos, sur le téléphone qu'ils ont déjà. Ils ouvrent un lien, et ils sont dedans. Rien à installer, aucune journée de formation. Les notes d'accès et les assignations apparaissent simplement dans la conversation.",
  faqConfirmQ:
    "Est-ce que les textos de confirmation grugent nos textos inclus ?",
  faqConfirmA:
    "Une confirmation simple compte pour un texto, et les textos sont inclus sur une base d'utilisation équitable taillée exactement pour ça, alors une tournée de « à demain » ne pose aucun problème. Le champ de saisie montre le compte avant l'envoi, et si une période occupée dépasse vos textos inclus, les textos supplémentaires sont facturés à un petit tarif à l'unité avec un plafond que vous contrôlez, alors il n'y a aucune facture surprise.",
  faqRegisterQ:
    "Qu'est-ce que ça implique de faire enregistrer notre entreprise de ménage pour texter ?",
  faqRegisterUs:
    "On s'en occupe. À l'inscription, vous entrez votre nom légal d'entreprise, votre adresse et votre EIN, et si vous faites du ménage comme travailleur autonome sans EIN, il y a un parcours pour ça aussi : on vous envoie un code par texto pour vérifier et on prend le relais. On dépose la paperasse. La réception des textos fonctionne immédiatement, et l'envoi vers les clients américains s'active en environ une semaine une fois que vous êtes approuvé.",
  faqRegisterCa:
    "Rien à enregistrer et aucune attente. Si vous nettoyez des maisons canadiennes pour des clients canadiens, vous commencez à texter le jour même de votre inscription.",

  finalH2: "Sortez chaque code de barrière du téléphone d'une seule personne.",
  finalSub:
    "Une seule boîte partagée pour les clients récurrents, les notes d'accès et les changements d'horaire, pour que celui qui se présente sache comment entrer. {claim}.",
};

const CLEANERS_COPY = {
  en: cleanersEn,
  "fr-CA": cleanersFr,
} as const;

export type CleanersCopy = typeof cleanersEn | typeof cleanersFr;

export function cleanersCopy(locale: MarketingLocale = "en"): CleanersCopy {
  return CLEANERS_COPY[locale] ?? cleanersEn;
}
