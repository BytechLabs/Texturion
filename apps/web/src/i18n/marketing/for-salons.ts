import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /for/salons, in both languages. The sixth and last trade page.
 *
 * One file per trade, for the reason `for-plumbers.ts` states.
 *
 * The confirmation template asks the client to "Reply YES". That word is the
 * one the CLIENT types back, so it is the one the salon has to print: "OUI"
 * in French, because a Quebec client replying to a French text will not type
 * an English word. `START_KEYWORDS` in the API is a separate thing entirely —
 * it governs opting back in after a STOP, not confirming an appointment — so
 * there is no carrier rule pulling this either way.
 */
export const salonsEn = {
  metaTitle: "Texting software for salons",
  metaDescription:
    "One business line for the whole floor: confirm appointments, fill cancellations from the waitlist, and follow up after the big color. Texts, calls and voicemail, one flat monthly price, {claim}.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Salons",
  displayName: "Salons",

  dateline: "11:20 AM · RUNNING LATE",
  h1: "A front desk, even if you don't have one.",
  heroSubBefore:
    "A running-late text only helps if somebody sees it before the chair sits empty, and a booking call only helps if somebody picks it up. Loonext gives the whole floor one line, so confirmations, reschedules and waitlist fills get handled by whoever is free, not whoever's phone it landed on.",
  heroSubAfter: "a month for the whole salon.",
  heroTruth: "One inbox for the whole floor · {chip} · Month to month",

  painH2:
    "The chair is empty and the “running late” text is on someone's personal phone.",
  painBodyOne:
    "At a busy salon the front desk is one person, if it's anyone at all. That person can't answer the phone, check someone out, and confirm tomorrow's column all at once. So confirmations slip, a client forgets, and at 2pm a stylist is standing at an empty chair that was booked solid a week ago.",
  painBodyTwo:
    "Cancellations aren't the problem; unfilled ones are. When a 3pm color cancels, there's almost always someone who'd take it, if you can reach them in the next ten minutes. With the whole floor on one inbox, the running-late text gets seen in time, the slot gets offered, and the day stays full no matter who's at the desk.",

  threadH2: "A running-late text, rescued between stylists.",
  threadLede:
    "A client texts at 11:20 that she's 30 minutes late for her 11:30 color. The desk sees Jess can't absorb it, hands the appointment to Maya, and a short call from the salon's own number settles the shade. The client walks in at noon to the same service at the same price, instead of a cancelled slot.",
  threadAriaLabel:
    "A salon conversation: a client running 30 minutes late at 11:20 AM, moved from Jess to Maya and confirmed by a call, so the color still happens at noon",

  scriptInbound:
    "So sorry, I'm stuck at work and running about 30 minutes late for my 11:30 color with Jess. Should I still come in?",
  scriptNote:
    "Jess has a cut at 12:30, she can't absorb 30 minutes. Maya's open from noon and has done Bri's color before",
  scriptAssigned: "{by} assigned this conversation to {to}",
  scriptReply:
    "Hi Bri, no stress, it's Maya. Jess is booked right after you, so I'll take your color at noon instead. Same service, same price, and I've got the notes from your last visit. See you at 12?",
  scriptThanks: "You're a lifesaver. See you at 12!",
  scriptTagged: "{by} added the tag {tag}",
  scriptTagScheduled: "Scheduled",

  useCasesH2: "Where a shared inbox earns its keep in a salon.",
  useCaseConfirmTitle: "Confirm appointments to cut no-shows.",
  useCaseConfirmBody:
    "The day before, text each client a quick “confirming your 2pm with Jess tomorrow” with a saved reply. A client who taps back yes is a client who shows, and the whole team sees who still needs a nudge.",
  useCaseWaitlistTitle: "Fill a cancellation from the waitlist.",
  useCaseWaitlistBody:
    "A 3pm cancels; you text the two people who wanted that window and give it to whoever answers first. A personal, one-to-one text sent in seconds turns a hole in the day back into revenue.",
  useCaseAftercareTitle: "Aftercare follow-ups that bring them back.",
  useCaseAftercareBody:
    "Two days after a big color, a quick “how's it feeling? remember the sulfate-free wash” keeps the result good and the client loyal, and it's two taps with a saved reply.",
  useCaseConsultTitle: "Talk through the look before the appointment.",
  useCaseConsultBody:
    "Clients text inspo photos ahead of a color or cut. The stylist sees them in the thread, blocks the right amount of time, and sets the price expectation up front. No sticker shock at the chair.",

  savedRepliesH2: "Six texts every salon sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the confirmation, the waitlist offer, the aftercare check-in, in a warm voice your clients will recognize. Save each one once and it's two taps forever.",
  replyConfirmName: "Appointment confirmation",
  replyConfirmText:
    "Hi {first_name}! Confirming your appointment tomorrow at 2pm. Reply YES to confirm, or let us know if you need to change it.",
  replyWaitlistName: "Waitlist offer",
  replyWaitlistText:
    "Good news, {first_name}: a 3pm spot just opened up tomorrow. Want it? First to reply gets it, and I'll lock it in.",
  replyAftercareName: "Aftercare check-in",
  replyAftercareText:
    "Hi {first_name}! Checking in on your color from last week. If anything feels off, text me here and we'll sort it. Remember the sulfate-free wash for the first week!",
  replyBehindName: "Running behind",
  replyBehindText:
    "So sorry, we're running about 15 minutes behind. No need to rush over; we'll text you the moment your chair is ready.",
  replyConsultName: "Consult ask",
  replyConsultText:
    "Love that idea! Before your appointment, could you text a photo or two of the look? It helps us plan the time and give you an accurate price.",
  replyReviewName: "Thank you + review",
  replyReviewText:
    "Thank you for coming in today, {first_name}! If you loved the result, a quick review really helps our little salon.",
  savedRepliesCaption:
    "The salon pack in the composer: tomorrow's column gets confirmed between clients.",

  featuresH2: "Built for how a salon actually runs.",
  featureFloorTitle: "The whole floor, one inbox.",
  featureFloorBody:
    "The front desk and every stylist see the same conversations, so a confirmation or a waitlist fill doesn't depend on who's standing at the desk.",
  featureAssignTitle: "Assign a client to their stylist.",
  featureAssignBody:
    "Each conversation has one owner, so the color question reaches the colorist and nothing gets answered twice or not at all.",
  featureNotesTitle: "Notes only the team sees.",
  featureNotesBody:
    "“Sensitive scalp, always books the 2pm, big lift last time.” Internal notes on the client that never get sent as a text.",
  featureNoAppTitle: "No app, no learning curve.",
  featureNoAppBody:
    "It works like texting on the phone your team already carries. Open a link and you're in, with push notifications when a client replies.",

  pricingH2After: "a month for the whole salon.",
  pricingBodyBefore:
    "Starter covers 3 people, 1 local number, and texting sized for confirming a full book and working a waitlist on a fair-use basis, not a hard cap; a plain confirmation counts as one text, and the composer shows the count before you send. More chairs, or a second location? Pro is",
  pricingBodyAfter:
    "for up to 15 people and a second number to keep two shops separate.",

  faqH2: "Salon questions, straight answers.",
  faqRemindersQ: "Will Loonext send appointment reminders on its own?",
  faqRemindersA:
    "No. You send them, and that's on purpose. Pull up tomorrow's column and text each client a confirmation with a saved reply; it takes a couple of taps per client, keeps a real person in the loop, and stays inside the phone companies' rules on unsolicited blasts. What you get is one shared inbox where the whole team sees who's confirmed and who hasn't.",
  faqNoShowQ: "How does texting actually reduce no-shows?",
  faqNoShowA:
    "A client who's tapped yes to a confirmation is far more likely to show than one who booked a week ago and forgot. Because the confirmations live in a shared inbox, anyone on the team can send them and see who still needs a nudge. It doesn't all fall on the front desk on a busy morning.",
  faqWaitlistQ: "Can we fill a last-minute cancellation from a waitlist?",
  faqWaitlistA:
    "Yes, that's one of the best uses. When a slot opens, text the clients who wanted that window and give it to whoever replies first. It's a personal, one-to-one text sent in seconds, not an automated blast, so it stays warm and stays inside the rules.",
  faqStylistQ:
    "Every stylist has their own clients. Can they each see their own?",
  faqStylistA:
    "Assign each conversation to the right stylist and it has one clear owner, while the front desk still sees everything to help confirm and rebook. One inbox with one owner per conversation, never a free-for-all where two people answer the same client.",
  faqConfirmQ: "Do confirmation texts eat up our included texting?",
  faqConfirmA:
    "A plain confirmation counts as one text, and texting is included on a fair-use basis sized for a full book, so confirmations are exactly what it's for. The composer shows the count before you send, and if a big week runs past your included texting, extra texts bill at a small per-text rate up to a cap you control. No surprise bill.",
  faqRegisterQ: "What does it take to get our salon set up to text?",
  faqRegisterUs:
    "We take care of it: just a couple of minutes at signup with your salon's legal name, address, and EIN. Booth renter or sole proprietor without an EIN? We'll verify you with a texted code instead. You'll be receiving texts right away, and texting US clients begins about a week later once you're approved.",
  faqRegisterCa:
    "Nothing to register and no wait. A Canadian salon texting Canadian clients is texting the same day it signs up.",

  finalH2: "Keep the chairs full.",
  finalSub:
    "Confirm appointments, fill cancellations from the waitlist, and follow up after the big color, all from one inbox the whole floor shares. {claim}.",
} as const;

export const salonsFr: Translated<typeof salonsEn> = {
  metaTitle: "Logiciel de textos pour salons de coiffure",
  metaDescription:
    "Une seule ligne d'affaires pour tout le plancher : confirmez les rendez-vous, remplissez les annulations à partir de la liste d'attente, et faites un suivi après la grosse coloration. Textos, appels et messagerie vocale, un seul prix mensuel fixe, {claim}.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Salons de coiffure",
  displayName: "Salons de coiffure",

  dateline: "11 H 20 · EN RETARD",
  h1: "Une réception, même si vous n'en avez pas.",
  heroSubBefore:
    "Un texto « je suis en retard » n'aide que si quelqu'un le voit avant que la chaise reste vide, et un appel pour un rendez-vous n'aide que si quelqu'un le prend. Loonext donne à tout le plancher une seule ligne, alors les confirmations, les changements d'horaire et les places de liste d'attente sont pris en charge par qui est libre, pas par celui sur le téléphone de qui c'est tombé.",
  heroSubAfter: "par mois pour tout le salon.",
  heroTruth:
    "Une seule boîte pour tout le plancher · {chip} · Au mois",

  painH2:
    "La chaise est vide et le texto « je suis en retard » est sur le téléphone personnel de quelqu'un.",
  painBodyOne:
    "Dans un salon occupé, la réception, c'est une personne, quand il y a quelqu'un. Cette personne ne peut pas répondre au téléphone, encaisser un client et confirmer la colonne de demain en même temps. Alors les confirmations glissent, une cliente oublie, et à 14 h une coiffeuse est debout devant une chaise vide qui était pleine il y a une semaine.",
  painBodyTwo:
    "Les annulations ne sont pas le problème ; celles qu'on ne remplit pas le sont. Quand une coloration de 15 h annule, il y a presque toujours quelqu'un qui la prendrait, si vous pouvez le joindre dans les dix prochaines minutes. Avec tout le plancher sur une seule boîte, le texto de retard est vu à temps, la place est offerte, et la journée reste pleine peu importe qui est à la réception.",

  threadH2: "Un texto de retard, sauvé entre deux coiffeuses.",
  threadLede:
    "Une cliente écrit à 11 h 20 qu'elle a 30 minutes de retard pour sa coloration de 11 h 30. La réception voit que Jess ne peut pas absorber ça, confie le rendez-vous à Maya, et un court appel depuis le numéro du salon règle la teinte. La cliente entre à midi pour le même service au même prix, au lieu d'une place annulée.",
  threadAriaLabel:
    "Une conversation de salon : une cliente en retard de 30 minutes à 11 h 20, transférée de Jess à Maya et confirmée par un appel, alors la coloration a quand même lieu à midi",

  scriptInbound:
    "Désolée, je suis coincée au travail et j'ai environ 30 minutes de retard pour ma coloration de 11 h 30 avec Jess. Est-ce que je viens quand même ?",
  scriptNote:
    "Jess a une coupe à 12 h 30, elle ne peut pas absorber 30 minutes. Maya est libre à partir de midi et a déjà fait la coloration de Bri",
  scriptAssigned: "{by} a assigné cette conversation à {to}",
  scriptReply:
    "Bonjour Bri, pas de stress, c'est Maya. Jess est réservée juste après vous, alors je prends votre coloration à midi à la place. Même service, même prix, et j'ai les notes de votre dernière visite. On se voit à midi ?",
  scriptThanks: "Vous me sauvez la vie. À midi !",
  scriptTagged: "{by} a ajouté l'étiquette {tag}",
  scriptTagScheduled: "Planifié",

  useCasesH2: "Là où une boîte partagée gagne sa place dans un salon.",
  useCaseConfirmTitle: "Confirmez les rendez-vous pour réduire les absences.",
  useCaseConfirmBody:
    "La veille, écrivez à chaque cliente un rapide « je confirme votre 14 h avec Jess demain » avec une réponse enregistrée. Une cliente qui répond oui est une cliente qui se présente, et toute l'équipe voit qui a encore besoin d'un rappel.",
  useCaseWaitlistTitle:
    "Remplissez une annulation à partir de la liste d'attente.",
  useCaseWaitlistBody:
    "Un 15 h annule ; vous écrivez aux deux personnes qui voulaient cette plage et vous la donnez à celle qui répond en premier. Un texto personnel, un à un, envoyé en quelques secondes transforme un trou dans la journée en revenus.",
  useCaseAftercareTitle: "Des suivis d'entretien qui les font revenir.",
  useCaseAftercareBody:
    "Deux jours après une grosse coloration, un rapide « comment ça se passe ? n'oubliez pas le shampooing sans sulfates » garde le résultat beau et la cliente fidèle, et c'est deux touches avec une réponse enregistrée.",
  useCaseConsultTitle: "Discutez du look avant le rendez-vous.",
  useCaseConsultBody:
    "Les clientes envoient des photos d'inspiration avant une coloration ou une coupe. La coiffeuse les voit dans le fil, bloque le bon temps, et fixe l'attente de prix d'avance. Aucun choc à la chaise.",

  savedRepliesH2: "Six textos que tout salon envoie. Volez-les.",
  savedRepliesIntro:
    "Six réponses enregistrées à installer dès le premier jour : la confirmation, l'offre de liste d'attente, le suivi d'entretien, dans une voix chaleureuse que vos clientes reconnaîtront. Enregistrez-en chacune une fois et c'est deux touches pour toujours.",
  replyConfirmName: "Confirmation de rendez-vous",
  replyConfirmText:
    "Bonjour {first_name} ! Je confirme votre rendez-vous demain à 14 h. Répondez OUI pour confirmer, ou dites-nous si vous devez le changer.",
  replyWaitlistName: "Offre de liste d'attente",
  replyWaitlistText:
    "Bonne nouvelle, {first_name} : une place de 15 h vient de se libérer demain. La voulez-vous ? La première à répondre l'obtient, et je la réserve.",
  replyAftercareName: "Suivi d'entretien",
  replyAftercareText:
    "Bonjour {first_name} ! Je prends des nouvelles de votre coloration de la semaine dernière. Si quelque chose ne va pas, écrivez-moi ici et on va arranger ça. N'oubliez pas le shampooing sans sulfates la première semaine !",
  replyBehindName: "En retard",
  replyBehindText:
    "Désolés, on a environ 15 minutes de retard. Pas besoin de vous presser ; on vous écrit dès que votre chaise est prête.",
  replyConsultName: "Demande de consultation",
  replyConsultText:
    "J'adore cette idée ! Avant votre rendez-vous, pourriez-vous m'envoyer une photo ou deux du look ? Ça nous aide à planifier le temps et à vous donner un prix juste.",
  replyReviewName: "Merci + avis",
  replyReviewText:
    "Merci d'être venue aujourd'hui, {first_name} ! Si vous avez adoré le résultat, un petit avis aide vraiment notre petit salon.",
  savedRepliesCaption:
    "L'ensemble de salon dans le champ de saisie : la colonne de demain se confirme entre deux clientes.",

  featuresH2: "Bâti pour la façon dont un salon fonctionne vraiment.",
  featureFloorTitle: "Tout le plancher, une seule boîte.",
  featureFloorBody:
    "La réception et chaque coiffeuse voient les mêmes conversations, alors une confirmation ou une place remplie ne dépend pas de qui est debout à la réception.",
  featureAssignTitle: "Assignez une cliente à sa coiffeuse.",
  featureAssignBody:
    "Chaque conversation a un seul responsable, alors la question de coloration rejoint la coloriste et rien n'obtient deux réponses ni aucune.",
  featureNotesTitle: "Des notes que seule l'équipe voit.",
  featureNotesBody:
    "« Cuir chevelu sensible, réserve toujours le 14 h, gros éclaircissement la dernière fois. » Des notes internes sur la cliente qui ne partent jamais comme texto.",
  featureNoAppTitle: "Aucune application, aucune courbe d'apprentissage.",
  featureNoAppBody:
    "Ça fonctionne comme des textos sur le téléphone que votre équipe a déjà. Ouvrez un lien et vous êtes dedans, avec des notifications quand une cliente répond.",

  pricingH2After: "par mois pour tout le salon.",
  pricingBodyBefore:
    "Starter couvre 3 personnes, 1 numéro local, et des textos taillés pour confirmer un carnet complet et travailler une liste d'attente sur une base d'utilisation équitable, pas un plafond rigide ; une confirmation simple compte pour un texto, et le champ de saisie montre le compte avant l'envoi. Plus de chaises, ou un deuxième emplacement ? Pro est à",
  pricingBodyAfter:
    "pour un maximum de 15 personnes et un deuxième numéro pour garder deux salons séparés.",

  faqH2: "Questions de salons, réponses directes.",
  faqRemindersQ:
    "Est-ce que Loonext envoie les rappels de rendez-vous tout seul ?",
  faqRemindersA:
    "Non. C'est vous qui les envoyez, et c'est voulu. Sortez la colonne de demain et écrivez à chaque cliente une confirmation avec une réponse enregistrée ; ça prend deux touches par cliente, ça garde une vraie personne dans la boucle, et ça reste à l'intérieur des règles des compagnies de téléphone sur les envois non sollicités. Ce que vous obtenez, c'est une seule boîte partagée où toute l'équipe voit qui a confirmé et qui ne l'a pas fait.",
  faqNoShowQ: "Comment le texto réduit-il concrètement les absences ?",
  faqNoShowA:
    "Une cliente qui a répondu oui à une confirmation est bien plus susceptible de se présenter qu'une cliente qui a réservé il y a une semaine et a oublié. Comme les confirmations vivent dans une boîte partagée, n'importe qui dans l'équipe peut les envoyer et voir qui a encore besoin d'un rappel. Tout ne retombe pas sur la réception un matin occupé.",
  faqWaitlistQ:
    "Peut-on remplir une annulation de dernière minute à partir d'une liste d'attente ?",
  faqWaitlistA:
    "Oui, c'est un des meilleurs usages. Quand une place se libère, écrivez aux clientes qui voulaient cette plage et donnez-la à celle qui répond en premier. C'est un texto personnel, un à un, envoyé en quelques secondes, pas un envoi automatisé, alors ça reste chaleureux et ça reste dans les règles.",
  faqStylistQ:
    "Chaque coiffeuse a ses propres clientes. Peuvent-elles voir seulement les leurs ?",
  faqStylistA:
    "Assignez chaque conversation à la bonne coiffeuse et elle a un responsable clair, pendant que la réception voit quand même tout pour aider à confirmer et à replanifier. Une seule boîte avec un seul responsable par conversation, jamais une mêlée générale où deux personnes répondent à la même cliente.",
  faqConfirmQ:
    "Est-ce que les textos de confirmation grugent nos textos inclus ?",
  faqConfirmA:
    "Une confirmation simple compte pour un texto, et les textos sont inclus sur une base d'utilisation équitable taillée pour un carnet complet, alors les confirmations sont exactement ce à quoi ça sert. Le champ de saisie montre le compte avant l'envoi, et si une grosse semaine dépasse vos textos inclus, les textos supplémentaires sont facturés à un petit tarif à l'unité jusqu'à un plafond que vous contrôlez. Aucune facture surprise.",
  faqRegisterQ:
    "Qu'est-ce que ça prend pour installer notre salon pour texter ?",
  faqRegisterUs:
    "On s'en occupe : juste deux minutes à l'inscription avec le nom légal de votre salon, votre adresse et votre EIN. Vous louez une chaise ou vous êtes travailleuse autonome sans EIN ? On vous vérifie plutôt avec un code envoyé par texto. Vous recevrez des textos tout de suite, et l'envoi vers les clientes américaines commence environ une semaine plus tard, une fois que vous êtes approuvée.",
  faqRegisterCa:
    "Rien à enregistrer et aucune attente. Un salon canadien qui écrit à des clientes canadiennes texte le jour même de son inscription.",

  finalH2: "Gardez les chaises pleines.",
  finalSub:
    "Confirmez les rendez-vous, remplissez les annulations à partir de la liste d'attente, et faites un suivi après la grosse coloration, le tout depuis une seule boîte que tout le plancher partage. {claim}.",
};

const SALONS_COPY = {
  en: salonsEn,
  "fr-CA": salonsFr,
} as const;

export type SalonsCopy = typeof salonsEn | typeof salonsFr;

export function salonsCopy(locale: MarketingLocale = "en"): SalonsCopy {
  return SALONS_COPY[locale] ?? salonsEn;
}
