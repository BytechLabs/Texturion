import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /for/landscapers, in both languages.
 *
 * One file per trade, for the reason `for-plumbers.ts` states.
 *
 * The closing tag on this thread is "Quote sent", not "Scheduled" like the
 * other trades: the job here ends with a price going out rather than a booking,
 * so the French is "Soumission envoyée" and matches the tag the app ships.
 */
export const landscapersEn = {
  metaTitle: "Texting software for landscapers",
  metaDescription:
    "One business line for your landscaping crew: quote from a photo, send weather reschedules down a whole route, and keep every gate code where the crew can see it. Texts, calls and voicemail, one flat monthly price, {claim}.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Landscapers",
  displayName: "Landscapers",

  dateline: "7:15 AM · GATE LOCKED",
  h1: "One line for the whole landscaping crew.",
  heroSubBefore:
    "The crew is at the gate, the gate is locked, and the code is in a thread on somebody's day off. Loonext puts every gate code, reschedule, and add-on ask on one business number the whole company works from, calls included.",
  heroSubAfter: "a month.",
  heroTruth: "One inbox for every property · {chip} · No busy-season lock-in",

  painH2: "You can't answer the phone from the top of a mower.",
  painBodyOne:
    "Landscaping runs in waves. The first warm week, everyone wants a spring cleanup, a mulch estimate, and a mowing quote, all at once, all by text, all to the number on the truck. If that number is the owner's cell, the owner spends the busiest month of the year as a receptionist instead of running crews.",
  painBodyTwo:
    "And the work is spread out. One crew's on the Alvarez lawn, another's across town, and the gate codes, addresses, and “which corner did they want re-mulched” live in a hundred separate threads on separate phones. Loonext puts every property's conversation in one inbox, so the person quoting and the crew doing the work see the same photos, the same code, the same notes.",

  threadH2: "A locked gate, turned into next week's job.",
  threadLede:
    "The crew's idling at a locked side gate at 7:15 AM. The call to the customer rings out, so one text gets the code instead. The code gets saved to the contact, and the customer's “could you add the back beds?” becomes a priced cleanup folded into Thursday's route.",
  threadAriaLabel:
    "A Greenline landscaping conversation: an unanswered call and a text from a locked side gate at 7:15 AM, the code saved to the contact, and a back-beds cleanup quoted for Thursday",

  scriptGateAsk:
    "Morning Diane, it's Greenline. The crew's at your side gate for the mowing and it's locked. Is there a code we should use?",
  scriptCodeReply:
    "So sorry! Code is 2580. While they're there, could you add the back beds this week? They're getting away from us.",
  scriptNote:
    "Saving 2580 to her contact so nobody's stuck at that gate again. Sofia, walk the back beds after the mow and price the cleanup",
  scriptAssigned: "{by} assigned this conversation to {to}",
  scriptReply:
    "We're in, thanks Diane. I'll look at the back beds once the mowing's done and text you a price this afternoon. If it works for you, we can fold the cleanup into Thursday's visit.",
  scriptTagged: "{by} added the tag {tag}",
  scriptTagQuoteSent: "Quote sent",

  useCasesH2: "Where a shared inbox earns its keep in a landscaping business.",
  useCaseWeatherTitle: "Weather reschedules, in two taps.",
  useCaseWeatherBody:
    "Rain moves the route. Pull up the day's conversations and text each customer the new time with a saved reply. It's a few taps per stop, and everyone knows before they wonder where the crew is.",
  useCasePhotosTitle: "Before-and-after photos, in the thread.",
  useCasePhotosBody:
    "Customers text the overgrown before; you text back the finished after. Every photo sits in the conversation, free to receive, so the quote, the work, and the proof live in one place.",
  useCaseSpringTitle: "Spring-list follow-ups that book the season.",
  useCaseSpringBody:
    "Last year's clients are this year's easiest work. A quick “want back on the every-other-week rotation?” sent down the spring list with a saved reply fills the calendar before the phone starts ringing.",
  useCaseGateTitle: "Gate codes saved where the crew can see them.",
  useCaseGateBody:
    "Save “side gate 2580, dog in the yard Thursdays” to the contact once, and whichever crew pulls up has it on their own phone. Nobody idles in the driveway texting the office.",

  savedRepliesH2: "Six texts every landscaping crew sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the photo ask, the weather bump, the season renewal, in words a homeowner actually reads. Save each one once and it's two taps forever.",
  replyPhotoName: "Photo request",
  replyPhotoText:
    "Happy to quote that. Could you text me a couple photos of the area and the rough size? I can usually get you a price without a site visit.",
  replyQuoteName: "Quote sent",
  replyQuoteText:
    "Hi {first_name}, here's your estimate for the cleanup and mulch: $340. That includes bed edging and hauling away the clippings. Want me to pencil you in?",
  replyWeatherName: "Weather reschedule",
  replyWeatherText:
    "Heads up, rain's moving in, so we're bumping your service from Tuesday to Wednesday. Same crew, same scope. Let me know if that doesn't work.",
  replyOnTheWayName: "On the way",
  replyOnTheWayText:
    "The crew's heading your way now and will be there within the hour. No need to be home; we'll text you a photo when it's done.",
  replySeasonName: "Season renewal",
  replySeasonText:
    "It's almost mowing season again. Want us to put you back on the every-other-week rotation at last year's rate? Reply yes and you're set.",
  replyDoneName: "Job done",
  replyDoneText:
    "All wrapped up: beds edged, mulched, and cleaned up. Photos attached. Anything you'd like tweaked, just text us here.",
  savedRepliesCaption:
    "The landscaping pack in the composer: the weather bump goes down a whole route in a few taps.",

  featuresH2: "Built for how a landscaping company actually works.",
  featurePropertyTitle: "Every property in one place.",
  featurePropertyBody:
    "Addresses, gate codes, and “re-mulch the front only” notes live on the contact, not scattered across five crew members' phones.",
  featureAssignTitle: "Assign to the closest crew.",
  featureAssignBody:
    "One owner per conversation, so the right crew gets the job and nobody double-books the same street.",
  featureSeasonTitle: "Handle the whole season from one inbox.",
  featureSeasonBody:
    "Quote season, recurring visits, and end-of-season renewals in one shared history, with no per-user fee as you add seasonal help.",
  featurePhotosTitle: "Photos in and out.",
  featurePhotosBody:
    "Customers send the before, you send the after. Photos are included both ways on every plan, sending and receiving, and every photo is stored free.",

  pricingH2After: "a month, flat. Even in April.",
  pricingBodyBefore:
    "Starter is 3 people, 1 local number, and texting sized for a working crew on a fair-use basis, not a hard cap. The spring rush is fine: past your included texting, extra texts bill at a small per-text rate with a cap you control, and the composer shows the count before you send. Add seasonal crew on Pro at",
  pricingBodyAfter:
    "for up to 15 people and a second number, then drop back when the season winds down.",

  faqH2: "Landscaper questions, straight answers.",
  faqQuoteQ: "Can I quote a job from photos instead of driving out?",
  faqQuoteA:
    "Yes, that's most of the point. Customers text photos of the yard or beds, receiving them is free, and they sit in the conversation so whoever's quoting and whoever's doing the work both see them. Save the truck rolls for jobs that truly need a walk-through.",
  faqSeatsQ: "We add crew for the season. Do we pay per person?",
  faqSeatsBefore: "No per-user fee, ever. Starter covers 3 people for",
  faqSeatsMiddle: "; when you scale up for the busy months, Pro is",
  faqSeatsAfter:
    "for up to 15. Drop back down between seasons, since it's month to month.",
  faqCodeQ: "Can the whole crew see a property's address and gate code?",
  faqCodeA:
    "Yes. Save it once to the contact or drop it as an internal note in the thread, and every crew member sees it on their own phone. No more texting the code around before every visit.",
  faqWeatherQ:
    "The weather changes our schedule constantly. Does texting help?",
  faqWeatherA:
    "It's the fastest way to reschedule. Pull up the day's conversations, send each affected customer the new time with a saved reply, and everyone knows before the crew doesn't show. Loonext doesn't reschedule for you, but it makes sending 15 updates a two-minute job.",
  faqSeasonalQ:
    "Our customers are seasonal. Will they remember us next spring?",
  faqSeasonalA:
    "The whole conversation history stays in the inbox, so next season you're texting a familiar name, not starting cold. A quick “want back on the rotation?” to last year's clients is often the easiest work you'll book all year.",
  faqRegisterQ: "How much of our time does the texting registration take?",
  faqRegisterUs:
    "About two minutes when you sign up, with your legal business name, address, and EIN. If you run the crew as a sole proprietor with no EIN, we verify you with a texted code instead. We handle the filing. You can receive texts right away, and texting US customers turns on within about a week once you're cleared.",
  faqRegisterCa:
    "None at all. There's no registration and no wait for texting Canadian customers, so you start the same day you sign up.",

  finalH2: "One inbox for every property you service.",
  finalSub:
    "Quote from a photo, dispatch the nearest crew, and keep every gate code in one shared inbox. {claim}.",
} as const;

export const landscapersFr: Translated<typeof landscapersEn> = {
  metaTitle: "Logiciel de textos pour paysagistes",
  metaDescription:
    "Une seule ligne d'affaires pour votre équipe de paysagement : soumissionnez à partir d'une photo, envoyez les reports pour la météo à toute une tournée, et gardez chaque code de barrière là où l'équipe le voit. Textos, appels et messagerie vocale, un seul prix mensuel fixe, {claim}.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Paysagistes",
  displayName: "Paysagistes",

  dateline: "7 H 15 · BARRIÈRE VERROUILLÉE",
  h1: "Une seule ligne pour toute l'équipe de paysagement.",
  heroSubBefore:
    "L'équipe est à la barrière, la barrière est verrouillée, et le code est dans un fil sur le téléphone de quelqu'un en congé. Loonext met chaque code de barrière, chaque report et chaque demande d'extra sur un seul numéro d'entreprise avec lequel toute la compagnie travaille, appels compris.",
  heroSubAfter: "par mois.",
  heroTruth:
    "Une seule boîte pour chaque propriété · {chip} · Aucun engagement de haute saison",

  painH2: "On ne peut pas répondre au téléphone du haut d'une tondeuse.",
  painBodyOne:
    "Le paysagement fonctionne par vagues. La première semaine de chaleur, tout le monde veut un grand ménage de printemps, une estimation de paillis et une soumission de tonte, tout ça en même temps, tout ça par texto, tout ça au numéro sur le camion. Si ce numéro est le cellulaire du patron, le patron passe le mois le plus occupé de l'année comme réceptionniste au lieu de diriger les équipes.",
  painBodyTwo:
    "Et le travail est éparpillé. Une équipe est sur le terrain des Alvarez, une autre est à l'autre bout de la ville, et les codes de barrière, les adresses et le « quel coin voulaient-ils faire repailler » vivent dans une centaine de fils séparés sur des téléphones séparés. Loonext met la conversation de chaque propriété dans une seule boîte, alors la personne qui soumissionne et l'équipe qui fait le travail voient les mêmes photos, le même code, les mêmes notes.",

  threadH2: "Une barrière verrouillée, transformée en job de la semaine prochaine.",
  threadLede:
    "L'équipe attend à une barrière latérale verrouillée à 7 h 15. L'appel à la cliente sonne dans le vide, alors un texto obtient le code à la place. Le code est enregistré sur le contact, et le « pourriez-vous ajouter les plates-bandes en arrière ? » de la cliente devient un grand ménage chiffré, intégré à la tournée de jeudi.",
  threadAriaLabel:
    "Une conversation de paysagement Greenline : un appel sans réponse et un texto depuis une barrière latérale verrouillée à 7 h 15, le code enregistré sur le contact, et un ménage des plates-bandes arrière soumissionné pour jeudi",

  scriptGateAsk:
    "Bonjour Diane, ici Greenline. L'équipe est à votre barrière latérale pour la tonte et elle est verrouillée. Y a-t-il un code qu'on devrait utiliser ?",
  scriptCodeReply:
    "Désolée ! Le code est 2580. Pendant qu'ils y sont, pourriez-vous ajouter les plates-bandes en arrière cette semaine ? Elles nous échappent.",
  scriptNote:
    "J'enregistre le 2580 sur son contact pour que personne ne reste pris à cette barrière. Sofia, fais le tour des plates-bandes arrière après la tonte et chiffre le ménage",
  scriptAssigned: "{by} a assigné cette conversation à {to}",
  scriptReply:
    "On est entrés, merci Diane. Je vais regarder les plates-bandes arrière une fois la tonte finie et je vous écris un prix cet après-midi. Si ça vous convient, on peut intégrer le ménage à la visite de jeudi.",
  scriptTagged: "{by} a ajouté l'étiquette {tag}",
  scriptTagQuoteSent: "Soumission envoyée",

  useCasesH2:
    "Là où une boîte partagée gagne sa place dans une entreprise de paysagement.",
  useCaseWeatherTitle: "Les reports pour la météo, en deux touches.",
  useCaseWeatherBody:
    "La pluie déplace la tournée. Sortez les conversations de la journée et écrivez à chaque client la nouvelle heure avec une réponse enregistrée. C'est quelques touches par arrêt, et tout le monde le sait avant de se demander où est l'équipe.",
  useCasePhotosTitle: "Les photos avant-après, dans le fil.",
  useCasePhotosBody:
    "Les clients envoient le « avant » tout en broussailles ; vous renvoyez le « après » terminé. Chaque photo reste dans la conversation, gratuite à recevoir, alors la soumission, le travail et la preuve vivent au même endroit.",
  useCaseSpringTitle:
    "Des relances de liste printanière qui remplissent la saison.",
  useCaseSpringBody:
    "Les clients de l'an dernier sont le travail le plus facile de cette année. Un rapide « voulez-vous revenir sur la rotation aux deux semaines ? » envoyé à toute la liste printanière avec une réponse enregistrée remplit le calendrier avant même que le téléphone se mette à sonner.",
  useCaseGateTitle:
    "Des codes de barrière enregistrés là où l'équipe les voit.",
  useCaseGateBody:
    "Enregistrez « barrière latérale 2580, chien dans la cour le jeudi » sur le contact une fois, et l'équipe qui se présente l'a sur son propre téléphone. Personne n'attend dans l'entrée à écrire au bureau.",

  savedRepliesH2:
    "Six textos que toute équipe de paysagement envoie. Volez-les.",
  savedRepliesIntro:
    "Six réponses enregistrées à installer dès le premier jour : la demande de photo, le report pour la météo, le renouvellement de saison, dans des mots qu'un propriétaire lit vraiment. Enregistrez-en chacune une fois et c'est deux touches pour toujours.",
  replyPhotoName: "Demande de photo",
  replyPhotoText:
    "Content de chiffrer ça. Pourriez-vous m'envoyer quelques photos de la zone et la grandeur approximative ? Je peux habituellement vous donner un prix sans visite sur place.",
  replyQuoteName: "Soumission envoyée",
  replyQuoteText:
    "Bonjour {first_name}, voici votre estimation pour le ménage et le paillis : 340 $. Ça comprend le bordage des plates-bandes et le ramassage des résidus. Voulez-vous que je vous inscrive ?",
  replyWeatherName: "Report pour la météo",
  replyWeatherText:
    "Petit avis : la pluie s'en vient, alors on déplace votre service de mardi à mercredi. Même équipe, même travail. Dites-moi si ça ne fonctionne pas.",
  replyOnTheWayName: "En route",
  replyOnTheWayText:
    "L'équipe s'en va chez vous et sera là dans l'heure. Pas besoin d'être à la maison ; on vous enverra une photo quand ce sera fait.",
  replySeasonName: "Renouvellement de saison",
  replySeasonText:
    "C'est presque la saison de la tonte. Voulez-vous qu'on vous remette sur la rotation aux deux semaines au tarif de l'an dernier ? Répondez oui et c'est réglé.",
  replyDoneName: "Job terminée",
  replyDoneText:
    "Tout est fini : plates-bandes bordées, paillées et nettoyées. Photos en pièce jointe. Si vous voulez qu'on ajuste quelque chose, écrivez-nous ici.",
  savedRepliesCaption:
    "L'ensemble de paysagement dans le champ de saisie : le report pour la météo part à toute une tournée en quelques touches.",

  featuresH2:
    "Bâti pour la façon dont une entreprise de paysagement travaille vraiment.",
  featurePropertyTitle: "Chaque propriété au même endroit.",
  featurePropertyBody:
    "Les adresses, les codes de barrière et les notes « repailler seulement le devant » vivent sur le contact, pas éparpillées sur les téléphones de cinq personnes.",
  featureAssignTitle: "Assignez à l'équipe la plus proche.",
  featureAssignBody:
    "Un seul responsable par conversation, alors la bonne équipe obtient la job et personne ne double-réserve la même rue.",
  featureSeasonTitle: "Gérez toute la saison depuis une seule boîte.",
  featureSeasonBody:
    "La saison des soumissions, les visites récurrentes et les renouvellements de fin de saison dans un seul historique partagé, sans frais par personne quand vous ajoutez de l'aide saisonnière.",
  featurePhotosTitle: "Des photos dans les deux sens.",
  featurePhotosBody:
    "Les clients envoient le avant, vous envoyez le après. Les photos sont incluses dans les deux sens sur tous les forfaits, à l'envoi comme à la réception, et chaque photo est stockée gratuitement.",

  pricingH2After: "par mois, prix fixe. Même en avril.",
  pricingBodyBefore:
    "Starter, c'est 3 personnes, 1 numéro local, et des textos taillés pour une équipe qui travaille sur une base d'utilisation équitable, pas un plafond rigide. La ruée du printemps ne pose aucun problème : au-delà de vos textos inclus, les textos supplémentaires sont facturés à un petit tarif à l'unité avec un plafond que vous contrôlez, et le champ de saisie montre le compte avant l'envoi. Ajoutez de l'équipe saisonnière sur Pro à",
  pricingBodyAfter:
    "pour un maximum de 15 personnes et un deuxième numéro, puis redescendez quand la saison ralentit.",

  faqH2: "Questions de paysagistes, réponses directes.",
  faqQuoteQ:
    "Puis-je soumissionner une job à partir de photos au lieu de me déplacer ?",
  faqQuoteA:
    "Oui, c'est en grande partie le but. Les clients envoient des photos du terrain ou des plates-bandes, les recevoir est gratuit, et elles restent dans la conversation pour que celui qui soumissionne et celui qui fait le travail les voient tous les deux. Gardez les déplacements pour les jobs qui exigent vraiment une visite.",
  faqSeatsQ:
    "On ajoute de l'équipe pour la saison. Paie-t-on par personne ?",
  faqSeatsBefore: "Aucuns frais par personne, jamais. Starter couvre 3 personnes pour",
  faqSeatsMiddle: "; quand vous montez pour les mois occupés, Pro est à",
  faqSeatsAfter:
    "pour un maximum de 15. Redescendez entre les saisons, puisque c'est au mois.",
  faqCodeQ:
    "Est-ce que toute l'équipe peut voir l'adresse et le code de barrière d'une propriété ?",
  faqCodeA:
    "Oui. Enregistrez-le une fois sur le contact ou laissez-le comme note interne dans le fil, et chaque membre de l'équipe le voit sur son propre téléphone. Fini d'envoyer le code à tout le monde avant chaque visite.",
  faqWeatherQ:
    "La météo change notre horaire constamment. Est-ce que le texto aide ?",
  faqWeatherA:
    "C'est la façon la plus rapide de reporter. Sortez les conversations de la journée, envoyez à chaque client touché la nouvelle heure avec une réponse enregistrée, et tout le monde le sait avant que l'équipe ne se présente pas. Loonext ne reporte pas à votre place, mais il transforme l'envoi de 15 mises à jour en une job de deux minutes.",
  faqSeasonalQ:
    "Nos clients sont saisonniers. Vont-ils se souvenir de nous au printemps prochain ?",
  faqSeasonalA:
    "Tout l'historique de conversation reste dans la boîte, alors la saison suivante vous écrivez à un nom familier, vous ne repartez pas de zéro. Un rapide « voulez-vous revenir sur la rotation ? » aux clients de l'an dernier est souvent le travail le plus facile que vous réserverez de toute l'année.",
  faqRegisterQ:
    "Combien de notre temps l'enregistrement pour texter prend-il ?",
  faqRegisterUs:
    "Environ deux minutes à l'inscription, avec votre nom légal d'entreprise, votre adresse et votre EIN. Si vous menez l'équipe comme travailleur autonome sans EIN, on vous vérifie plutôt avec un code envoyé par texto. On s'occupe du dépôt. Vous pouvez recevoir des textos tout de suite, et l'envoi vers les clients américains s'active en environ une semaine une fois que vous êtes approuvé.",
  faqRegisterCa:
    "Aucun. Il n'y a aucun enregistrement et aucune attente pour écrire à des clients canadiens, alors vous commencez le jour même de votre inscription.",

  finalH2: "Une seule boîte pour chaque propriété que vous entretenez.",
  finalSub:
    "Soumissionnez à partir d'une photo, envoyez l'équipe la plus proche, et gardez chaque code de barrière dans une seule boîte partagée. {claim}.",
};

const LANDSCAPERS_COPY = {
  en: landscapersEn,
  "fr-CA": landscapersFr,
} as const;

export type LandscapersCopy = typeof landscapersEn | typeof landscapersFr;

export function landscapersCopy(
  locale: MarketingLocale = "en",
): LandscapersCopy {
  return LANDSCAPERS_COPY[locale] ?? landscapersEn;
}
