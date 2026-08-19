import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /for/plumbers, in both languages.
 *
 * ## One file per trade, not one for all six
 *
 * The six trade pages share a template and share nothing else: "every sentence
 * is plumbing-specific; nothing is shared with the other five" is the rule the
 * page itself states. A single trades catalogue would put 180 unrelated keys in
 * one file and invite exactly the cross-trade reuse that rule forbids.
 *
 * ## The prices are components, not words
 *
 * `heroSub`, `pricingH2`, `pricingBody` and one FAQ answer quote the plan price
 * mid-sentence, and the page renders it through `<PlanPrice>` so a Canadian
 * reader sees the CAD figure their card is charged. Those sentences are split
 * at the figure here rather than carrying a hole, because the hole is a React
 * node and not a string.
 *
 * ## `{first_name}` stays `{first_name}`
 *
 * The review-ask template carries the product's merge token. Same rule as the
 * templates page: a translated token ships to a customer literally.
 */
export const plumbersEn = {
  metaTitle: "Texting software for plumbers",
  metaDescription:
    "One business line for your plumbing crew: customers text photos or call, anyone on the team answers, nothing gets missed. Texts, calls and voicemail, one flat monthly price for the whole crew, {claim}.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Plumbers",
  displayName: "Plumbers",

  dateline: "9:04 PM · BASEMENT DRAIN",
  h1: "One line for the whole plumbing crew.",
  heroSubBefore:
    "Customers text a photo of the leak, or they call. Either way it reaches every tech at once and whoever is free answers, and the calls nobody can take leave a voicemail you can read between jobs. The owner's personal cell goes back to being a personal cell. A local business number, one shared inbox,",
  heroSubAfter: "a month for the whole crew.",
  heroTruth:
    "Works on the phones your techs already carry · {chip} · Month to month",

  painH2: "You can't quote a water heater with your hands in a drain.",
  painBodyOne:
    "Every plumber knows the cycle: you're mid-job, the phone buzzes, and it's either a new customer you can't answer or a scheduled one asking where you are. Voicemail fills up. Callbacks slip. And every quote, address, and “yes please book me” lives on one personal phone that goes home with one person.",
  painBodyTwo:
    "Texting fixes half of that on its own. Customers would rather text than call anyway. Loonext fixes the other half: the texts stop belonging to one phone and start belonging to the business, so the tech in the crawlspace and the one at the supply house are looking at the same conversation.",

  threadH2: "A Tuesday night, from the missed call on.",
  threadLede:
    "A backed-up floor drain at 9 on a Tuesday night. The call nobody was there to take leaves a voicemail you can read, texts him back on its own, and the photo lands two minutes later. A note to bring the auger, an assignment, a price, a booking. The whole call-out handled in one conversation, and nobody's dinner got ruined.",
  threadAriaLabel:
    "A Reyes Plumbing conversation: a 9 PM voicemail about a backed-up basement floor drain, texted back automatically, assigned to Dale and booked for 8am",

  scriptVoicemail:
    "Yeah, hi, it's Marcus over on Wrenfield. Our basement drain is backing up every time the washer runs. Call me back tonight if you can.",
  scriptTextBack:
    "Sorry we missed your call, this is Reyes Plumbing. Text us right here and someone will get back to you tonight.",
  scriptInbound:
    "Hey, our basement floor drain is backing up when the washing machine runs. How soon could someone look at it?",
  scriptPhotoLabel: "Backed-up floor drain",
  scriptNote:
    "Second backup on that street this month. Dale, bring the auger and the camera",
  scriptAssigned: "{by} assigned this conversation to {to}",
  scriptQuote:
    "Hi Marcus, Dale from Reyes Plumbing. From your photo that looks like a main line clog, we can be there tomorrow at 8am. It's $180 for the auger service, and we'll quote anything bigger before touching it. Want the 8am?",
  scriptBooked: "Booked. See you at 8",
  scriptTagged: "{by} added the tag {tag}",
  scriptTagScheduled: "Scheduled",

  useCasesH2: "Where a shared inbox earns its keep in a plumbing business.",
  useCasePhotoTitle: "Photo triage before you roll a truck.",
  useCasePhotoBody:
    "“Send me a picture of the shutoff” saves more wasted trips than any scheduling app. Photos land right in the conversation, free to receive, visible to the whole crew, so the tech who shows up has already seen the job.",
  useCaseOnMyWayTitle: "On-my-way texts, in two taps.",
  useCaseOnMyWayBody:
    "Save it once: “On my way. Should be there in about 20 minutes.” Type “/”, tap, sent.",
  useCaseQuoteTitle: "Quote follow-ups that actually happen.",
  useCaseQuoteBody:
    "Tag a conversation “Quote sent” and it stays visible until someone closes it. Monday morning, open the Quote sent list and follow up on the water heater swap instead of losing the job to whoever texted back first.",
  useCaseAfterHoursTitle: "After-hours texts, without the after-hours phone.",
  useCaseAfterHoursBody:
    "A 9pm “no hot water” text waits safely in the inbox instead of ruining someone's dinner. Whoever opens up in the morning sees it, replies, and books it. If you do want evening pings, push notifications are per person, so only the on-call tech gets buzzed.",

  savedRepliesH2: "Six texts every plumbing crew sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the on-my-way, the photo request, the quote nudge, written the way a plumber actually talks. Save each one once and it's two taps forever.",
  replyOnMyWayName: "On my way",
  replyOnMyWayText: "On my way. Should be with you in about 20 minutes.",
  replyPhotoName: "Photo request",
  replyPhotoText:
    "Can you text us a photo of the problem, and one of the shutoff valve if you can find it? It helps us bring the right parts.",
  replyQuoteName: "Quote follow-up",
  replyQuoteText:
    "Hi, just checking you received our quote. Happy to answer any questions, and if the timing's not right, no pressure.",
  replyBookingName: "Booking confirmation",
  replyBookingText:
    "You're booked for Thursday between 9 and 11. We'll text you when we're on the way.",
  replyDoneName: "Job done",
  replyDoneText:
    "All done. We've cleared the line and tested it, so you're good to run the washer. Any issues in the next 30 days, text us here.",
  replyReviewName: "Review ask",
  replyReviewText:
    "Glad we could help, {first_name}. If you have a minute, a Google review goes a long way for a small shop like ours.",
  savedRepliesCaption:
    "The plumbing pack in the composer: type / and the on-my-way is two taps from sent.",

  featuresH2: "Built for how a plumbing crew actually works.",
  featureNumberTitle: "Your number on the trucks.",
  featureNumberBody:
    "A local number that belongs to the business. Techs come and go; the number and every conversation stay.",
  featureAssignTitle: "Assign jobs to techs.",
  featureAssignBody:
    "Every conversation has one owner, so two techs never book the same drain and no customer waits on “I thought you had it.”",
  featureNotesTitle: "Notes the customer never sees.",
  featureNotesBody:
    "“Gate code 4482, dog is friendly, quote high, last visit ran long.” Right in the thread, marked internal, never sent.",
  featureCrawlspaceTitle: "Works from the crawlspace.",
  featureCrawlspaceBody:
    "Any phone, no app to install, one-handed. Dark mode for the 6am starts, push notifications when a customer texts.",

  pricingH2After: "a month. The whole crew.",
  pricingBodyBefore:
    "Starter covers 3 people, 1 local number, and texting included on a fair-use basis, not a hard cap: almost every 2 or 3 person shop stays comfortably inside it, and the composer shows the count before you send. Bigger crew? Pro runs",
  pricingBodyAfter:
    ", fits up to 15 people, and adds a second number. Month to month, no contracts.",

  faqH2: "Plumber questions, straight answers.",
  faqPhotosQ: "Can customers text us photos of the job?",
  faqPhotosA:
    "Yes. Photos of the drip, the drain, and the mystery valve all land in the conversation, free to receive. Your crew sees them before anyone rolls a truck.",
  faqTechsQ: "My techs aren't tech people. Will they use it?",
  faqTechsA:
    "If they can text, they can use Loonext. It looks like texting. They open a link on their own phone, and they're in. Nothing to install, no training day.",
  faqNightQ: "What about texts that come in at night?",
  faqNightA:
    "They wait in the inbox. Nothing gets lost and nobody's dinner gets ruined. Notifications are per person, so an on-call tech can get the evening buzz while everyone else sleeps.",
  faqTwoGuysQ: "We're two guys and a van. Is this overkill?",
  faqTwoGuysBefore: "Starter is",
  faqTwoGuysAfter:
    "for up to 3 people. It's built for exactly two guys and a van. You get the business number, the shared history, and the saved replies; when you hire, they're in with a link.",
  faqOnMyWayQ: "Do “on my way” texts eat into our included texting?",
  faqOnMyWayA:
    "Each plain on-my-way text counts as one, and the composer shows the count as you type. Texting is included on a fair-use basis sized for a working crew, so on-my-way texts are exactly what it's for. If a month runs hot, extra texts bill at a small per-text rate, with alerts at 80% and 100% and a spending cap you control, so there are no surprise bills.",
  faqRegisterQ:
    "We're a licensed plumbing company. What's the registration process?",
  faqRegisterUs:
    "We file it all for you. It's about two minutes of plain questions at signup: your legal business name, address, and your EIN. Don't have an EIN? There's a sole proprietor path, where we text you a verification code and handle the rest. You can receive texts right away, and texting US customers turns on once the phone companies clear you, usually 3 to 7 business days.",
  faqRegisterCa:
    "Nothing to register and no wait. You start texting Canadian customers the same day your number is active, usually a minute or two after signup.",

  finalH2: "Get the texts off your personal cell.",
  finalSub: "A local number and a shared inbox for the whole crew, {claim}.",
} as const;

export const plumbersFr: Translated<typeof plumbersEn> = {
  metaTitle: "Logiciel de textos pour plombiers",
  metaDescription:
    "Une seule ligne d'affaires pour votre équipe de plomberie : les clients envoient des photos ou appellent, n'importe qui dans l'équipe répond, rien ne se perd. Textos, appels et messagerie vocale, un seul prix mensuel fixe pour toute l'équipe, {claim}.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Plombiers",
  displayName: "Plombiers",

  dateline: "21 H 04 · DRAIN DE SOUS-SOL",
  h1: "Une seule ligne pour toute l'équipe de plomberie.",
  heroSubBefore:
    "Les clients envoient une photo de la fuite, ou ils appellent. Dans les deux cas, ça rejoint tous les techniciens en même temps et celui qui est libre répond, et les appels que personne ne peut prendre laissent un message vocal que vous lisez entre deux jobs. Le cellulaire personnel du patron redevient un cellulaire personnel. Un numéro d'entreprise local, une seule boîte partagée,",
  heroSubAfter: "par mois pour toute l'équipe.",
  heroTruth:
    "Fonctionne sur les téléphones que vos techniciens ont déjà · {chip} · Au mois",

  painH2:
    "On ne peut pas soumissionner un chauffe-eau les mains dans un drain.",
  painBodyOne:
    "Tous les plombiers connaissent le cycle : vous êtes en pleine job, le téléphone vibre, et c'est soit un nouveau client à qui vous ne pouvez pas répondre, soit un client prévu qui demande où vous êtes. La boîte vocale se remplit. Les rappels glissent. Et chaque soumission, chaque adresse et chaque « oui, réservez-moi » vit sur un seul téléphone personnel qui rentre à la maison avec une seule personne.",
  painBodyTwo:
    "Le texto règle la moitié de ça tout seul. Les clients préfèrent écrire qu'appeler de toute façon. Loonext règle l'autre moitié : les textos arrêtent d'appartenir à un téléphone et commencent à appartenir à l'entreprise, alors le technicien dans le vide sanitaire et celui au comptoir de pièces regardent la même conversation.",

  threadH2: "Un mardi soir, à partir de l'appel manqué.",
  threadLede:
    "Un drain de plancher refoulé à 21 h un mardi soir. L'appel que personne n'était là pour prendre laisse un message vocal que vous pouvez lire, lui répond par texto tout seul, et la photo arrive deux minutes plus tard. Une note pour apporter la tarière, une assignation, un prix, un rendez-vous. Tout l'appel de service réglé dans une seule conversation, et le souper de personne n'a été gâché.",
  threadAriaLabel:
    "Une conversation de Reyes Plumbing : un message vocal à 21 h au sujet d'un drain de plancher de sous-sol refoulé, avec un texto de retour automatique, assigné à Dale et réservé pour 8 h",

  scriptVoicemail:
    "Oui, bonjour, c'est Marcus sur Wrenfield. Notre drain de sous-sol refoule chaque fois que la laveuse fonctionne. Rappelez-moi ce soir si vous pouvez.",
  scriptTextBack:
    "Désolés d'avoir manqué votre appel, ici Reyes Plumbing. Écrivez-nous ici même et quelqu'un vous reviendra ce soir.",
  scriptInbound:
    "Bonjour, notre drain de plancher de sous-sol refoule quand la laveuse fonctionne. Dans combien de temps quelqu'un pourrait regarder ça ?",
  scriptPhotoLabel: "Drain de plancher refoulé",
  scriptNote:
    "Deuxième refoulement sur cette rue ce mois-ci. Dale, apporte la tarière et la caméra",
  scriptAssigned: "{by} a assigné cette conversation à {to}",
  scriptQuote:
    "Bonjour Marcus, Dale de Reyes Plumbing. D'après votre photo, ça ressemble à un bouchon dans la conduite principale ; on peut être là demain à 8 h. C'est 180 $ pour le service de tarière, et on soumissionne tout ce qui est plus gros avant d'y toucher. Vous voulez le 8 h ?",
  scriptBooked: "Réservé. On se voit à 8 h",
  scriptTagged: "{by} a ajouté l'étiquette {tag}",
  scriptTagScheduled: "Planifié",

  useCasesH2:
    "Là où une boîte partagée gagne sa place dans une entreprise de plomberie.",
  useCasePhotoTitle: "Le tri par photo avant de sortir un camion.",
  useCasePhotoBody:
    "« Envoyez-moi une photo de la valve d'arrêt » évite plus de déplacements inutiles que n'importe quelle application d'horaire. Les photos atterrissent directement dans la conversation, gratuites à recevoir, visibles par toute l'équipe, alors le technicien qui se présente a déjà vu la job.",
  useCaseOnMyWayTitle: "Les textos « en route », en deux touches.",
  useCaseOnMyWayBody:
    "Enregistrez-le une fois : « En route. On devrait être là dans une vingtaine de minutes. » Tapez « / », touchez, envoyé.",
  useCaseQuoteTitle: "Des relances de soumission qui se font vraiment.",
  useCaseQuoteBody:
    "Étiquetez une conversation « Soumission envoyée » et elle reste visible jusqu'à ce que quelqu'un la ferme. Le lundi matin, ouvrez la liste Soumission envoyée et relancez le remplacement de chauffe-eau au lieu de perdre la job au profit de celui qui a répondu en premier.",
  useCaseAfterHoursTitle:
    "Les textos après les heures, sans le téléphone de garde.",
  useCaseAfterHoursBody:
    "Un texto « plus d'eau chaude » à 21 h attend en sécurité dans la boîte au lieu de gâcher le souper de quelqu'un. Celui qui ouvre le matin le voit, répond et le réserve. Si vous voulez quand même des alertes le soir, les notifications sont par personne, alors seul le technicien de garde est averti.",

  savedRepliesH2:
    "Six textos que toute équipe de plomberie envoie. Volez-les.",
  savedRepliesIntro:
    "Six réponses enregistrées à installer dès le premier jour : le « en route », la demande de photo, la relance de soumission, écrites comme un plombier parle vraiment. Enregistrez-en chacune une fois et c'est deux touches pour toujours.",
  replyOnMyWayName: "En route",
  replyOnMyWayText:
    "En route. On devrait être chez vous dans une vingtaine de minutes.",
  replyPhotoName: "Demande de photo",
  replyPhotoText:
    "Pouvez-vous nous envoyer une photo du problème, et une de la valve d'arrêt si vous la trouvez ? Ça nous aide à apporter les bonnes pièces.",
  replyQuoteName: "Relance de soumission",
  replyQuoteText:
    "Bonjour, je vérifie simplement que vous avez reçu notre soumission. Content de répondre à vos questions, et si le moment ne convient pas, aucune pression.",
  replyBookingName: "Confirmation de rendez-vous",
  replyBookingText:
    "C'est réservé pour jeudi entre 9 h et 11 h. On vous écrit quand on est en route.",
  replyDoneName: "Job terminée",
  replyDoneText:
    "C'est terminé. On a débouché la conduite et on l'a testée, alors vous pouvez faire rouler la laveuse. Le moindre problème dans les 30 prochains jours, écrivez-nous ici.",
  replyReviewName: "Demande d'avis",
  replyReviewText:
    "Content d'avoir pu aider, {first_name}. Si vous avez une minute, un avis Google fait une grosse différence pour un petit commerce comme le nôtre.",
  savedRepliesCaption:
    "L'ensemble de plomberie dans le champ de saisie : tapez / et le « en route » est à deux touches de partir.",

  featuresH2: "Bâti pour la façon dont une équipe de plomberie travaille vraiment.",
  featureNumberTitle: "Votre numéro sur les camions.",
  featureNumberBody:
    "Un numéro local qui appartient à l'entreprise. Les techniciens vont et viennent ; le numéro et toutes les conversations restent.",
  featureAssignTitle: "Assignez les jobs aux techniciens.",
  featureAssignBody:
    "Chaque conversation a un seul responsable, alors deux techniciens ne réservent jamais le même drain et aucun client n'attend à cause d'un « je pensais que tu l'avais ».",
  featureNotesTitle: "Des notes que le client ne voit jamais.",
  featureNotesBody:
    "« Code de barrière 4482, le chien est gentil, soumissionner haut, la dernière visite a débordé. » Directement dans le fil, marquée interne, jamais envoyée.",
  featureCrawlspaceTitle: "Fonctionne depuis le vide sanitaire.",
  featureCrawlspaceBody:
    "N'importe quel téléphone, aucune application à installer, à une main. Mode sombre pour les départs à 6 h, notifications quand un client écrit.",

  pricingH2After: "par mois. Toute l'équipe.",
  pricingBodyBefore:
    "Starter couvre 3 personnes, 1 numéro local, et les textos inclus sur une base d'utilisation équitable, pas un plafond rigide : presque tous les commerces de 2 ou 3 personnes restent confortablement à l'intérieur, et le champ de saisie montre le compte avant l'envoi. Une plus grosse équipe ? Pro coûte",
  pricingBodyAfter:
    ", convient jusqu'à 15 personnes, et ajoute un deuxième numéro. Au mois, aucun contrat.",

  faqH2: "Questions de plombiers, réponses directes.",
  faqPhotosQ: "Les clients peuvent-ils nous envoyer des photos de la job ?",
  faqPhotosA:
    "Oui. Les photos du dégât, du drain et de la valve mystérieuse atterrissent toutes dans la conversation, gratuites à recevoir. Votre équipe les voit avant que quelqu'un sorte un camion.",
  faqTechsQ:
    "Mes techniciens ne sont pas des gens de technologie. Vont-ils s'en servir ?",
  faqTechsA:
    "S'ils savent texter, ils savent utiliser Loonext. Ça ressemble à des textos. Ils ouvrent un lien sur leur propre téléphone, et ils sont dedans. Rien à installer, aucune journée de formation.",
  faqNightQ: "Et les textos qui arrivent la nuit ?",
  faqNightA:
    "Ils attendent dans la boîte. Rien ne se perd et le souper de personne n'est gâché. Les notifications sont par personne, alors un technicien de garde peut recevoir l'alerte du soir pendant que tous les autres dorment.",
  faqTwoGuysQ: "On est deux gars et une camionnette. Est-ce que c'est exagéré ?",
  faqTwoGuysBefore: "Starter est à",
  faqTwoGuysAfter:
    "pour un maximum de 3 personnes. C'est bâti exactement pour deux gars et une camionnette. Vous avez le numéro d'entreprise, l'historique partagé et les réponses enregistrées ; quand vous embauchez, la personne entre avec un lien.",
  faqOnMyWayQ:
    "Est-ce que les textos « en route » grugent nos textos inclus ?",
  faqOnMyWayA:
    "Chaque texto « en route » simple compte pour un, et le champ de saisie montre le compte pendant que vous tapez. Les textos sont inclus sur une base d'utilisation équitable taillée pour une équipe qui travaille, alors les textos « en route » sont exactement ce à quoi ça sert. Si un mois chauffe, les textos supplémentaires sont facturés à un petit tarif à l'unité, avec des alertes à 80 % et 100 % et un plafond de dépenses que vous contrôlez, alors il n'y a aucune facture surprise.",
  faqRegisterQ:
    "On est une entreprise de plomberie licenciée. C'est quoi le processus d'enregistrement ?",
  faqRegisterUs:
    "On dépose tout pour vous. C'est environ deux minutes de questions simples à l'inscription : votre nom légal d'entreprise, votre adresse et votre EIN. Pas d'EIN ? Il y a un parcours pour travailleur autonome, où on vous envoie un code de vérification par texto et on s'occupe du reste. Vous pouvez recevoir des textos tout de suite, et l'envoi vers les clients américains s'active une fois que les compagnies de téléphone vous approuvent, habituellement de 3 à 7 jours ouvrables.",
  faqRegisterCa:
    "Rien à enregistrer et aucune attente. Vous commencez à écrire à des clients canadiens le jour même où votre numéro est actif, habituellement une minute ou deux après l'inscription.",

  finalH2: "Sortez les textos de votre cellulaire personnel.",
  finalSub:
    "Un numéro local et une boîte partagée pour toute l'équipe, {claim}.",
};

const PLUMBERS_COPY = {
  en: plumbersEn,
  "fr-CA": plumbersFr,
} as const;

export type PlumbersCopy = typeof plumbersEn | typeof plumbersFr;

export function plumbersCopy(locale: MarketingLocale = "en"): PlumbersCopy {
  return PLUMBERS_COPY[locale] ?? plumbersEn;
}
