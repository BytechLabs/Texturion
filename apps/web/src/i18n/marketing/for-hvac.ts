import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /for/hvac, in both languages.
 *
 * One file per trade, for the reason `for-plumbers.ts` states.
 *
 * "HVAC" stays "HVAC" in Quebec: it is the term the trade uses on its own
 * trucks and in its own job postings, and "CVCA" — the formal French acronym —
 * is not what a shop owner searching for this software would type.
 */
export const hvacEn = {
  metaTitle: "Texting software for HVAC companies",
  metaDescription:
    "One business line for your HVAC crew: triage the cold-snap surge, read the fault before you dispatch, and keep install quotes from going cold. Texts, calls and voicemail, one flat monthly price, {claim}.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "HVAC",
  displayName: "HVAC",

  dateline: "6:48 AM · NO HEAT",
  h1: "One line for the whole HVAC crew.",
  heroSubBefore:
    "It's 6:48 in the morning, the house is cold, and the customer used the only number they had. Whether they texted it or rang it, whoever is up answers, the right part rides the van, and the no-heat call is booked before the shop opens. A local business number for texts and calls,",
  heroSubAfter: "a month for the whole crew.",
  heroTruth:
    "Works on the phones your techs already carry · {chip} · No busy-season contract",

  painH2: "You can't quote a furnace swap from the top of a ladder.",
  painBodyOne:
    "HVAC demand doesn't trickle in; it spikes. The first morning of a cold snap, a dozen no-heat texts and calls hit before 8am, and the same thing happens in reverse the first heat wave of July. Route all of that through one owner's cell and you get a full voicemail box, a stressed dispatcher, and customers trying the next company because nobody answered.",
  painBodyTwo:
    "The rest of the year is the slow bleed: the furnace quote from three weeks ago that never got a follow-up, the maintenance-plan customer nobody reminded. Those are real dollars, and they slip because the follow-up lives on a sticky note. Loonext keeps the surge triaged and the follow-ups visible, the whole team working one inbox instead of one phone.",

  threadH2: "A no-heat morning, booked before the coffee.",
  threadLede:
    "A 6:46 AM call the shop was too early to answer, texted back on its own. Two minutes later the customer sends a photo of the thermostat error. The office reads the code, drops a note to bring the capacitor, and assigns the tech whose van has the part, who texts back a window and a diagnostic price before the shop even opens.",
  threadAriaLabel:
    "A Northline Heating conversation: a 6:46 AM missed call answered by an automatic text back, then a no-heat text with a thermostat error photo at 6:48 AM, assigned to Tariq and booked for 9",

  scriptTextBack:
    "Sorry we missed your call, this is Northline Heating. The shop opens at 7. Text us right here and we'll get straight back to you.",
  scriptInbound:
    "Furnace's been off since last night and the thermostat is showing E4. It's 12 degrees in the house. Can someone come today?",
  scriptPhotoLabel: "Thermostat error E4",
  scriptNote:
    "E4 on that model is almost always the blower capacitor. Tariq, bring the capacitor kit and a filter while you're in there",
  scriptAssigned: "{by} assigned this conversation to {to}",
  scriptReply:
    "Morning Greg, Tariq from Northline Heating. That error usually points to the blower, and I've got the likely part on the van already. I can be there by 9. The diagnostic is $120 and it applies to the repair. In the meantime, leave the system off rather than resetting it. Okay to head over?",
  scriptConfirm: "Yes please, 9 works. We're bundling up till then",
  scriptTagged: "{by} added the tag {tag}",
  scriptTagScheduled: "Scheduled",

  useCasesH2: "Where a shared inbox earns its keep in an HVAC business.",
  useCaseTriageTitle: "Triage the surge instead of drowning in it.",
  useCaseTriageBody:
    "When the cold-snap texts pile up, the shared inbox is a queue: read the fault, note the likely part, assign the tech whose van has it, send a window. Nothing sits in a voicemail box while a house freezes.",
  useCaseFaultTitle: "Read the fault before you dispatch.",
  useCaseFaultBody:
    "Ask for a photo of the thermostat error or the model plate. E4 versus a flashing light changes what part rides on the truck, and a photo in the thread means the tech rolls up with the capacitor already loaded.",
  useCaseQuoteTitle: "Follow up on install quotes before they go cold.",
  useCaseQuoteBody:
    "A furnace or AC swap rarely closes the same day. Tag it “Quote sent” and it stays on the list until someone checks back in, instead of the job quietly going to whoever called them back first.",
  useCaseMaintenanceTitle: "Send maintenance reminders yourself, on time.",
  useCaseMaintenanceBody:
    "Twice a year, text your plan customers to book the tune-up. You send it with a saved reply, so it's fast but it's a real person deciding who to contact, and the whole team sees who's been reminded and who's booked.",

  savedRepliesH2: "Six texts every HVAC company sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the on-my-way, the filter reminder, the tune-up ask, in the plain, reassuring tone a cold customer needs. Save each one once and it's two taps forever.",
  replyOnMyWayName: "On my way",
  replyOnMyWayText:
    "On the way now, should be with you in about 30 minutes. If the system is off, leave it off until I get there.",
  replyFilterName: "Filter reminder",
  replyFilterText:
    "Quick reminder to swap your filter this month. It keeps the system efficient and the warranty happy. Want us to drop off the right size?",
  replyQuoteName: "Quote follow-up",
  replyQuoteText:
    "Hi {first_name}, just checking in on the furnace quote we sent. Happy to answer questions or walk through financing. No rush, no pressure.",
  replyBookingName: "Booking confirmation",
  replyBookingText:
    "You're booked for Tuesday between 8 and 10. We'll text you when the tech is on the way.",
  replySeasonName: "Maintenance-season ask",
  replySeasonText:
    "It's tune-up season. Want us to check your system before the rush? Reply with a day that works and we'll set it up.",
  replyReviewName: "Review ask",
  replyReviewText:
    "Glad we got the heat back on, {first_name}. If you have a minute, a Google review helps a small shop like ours.",
  savedRepliesCaption:
    "The HVAC pack in the composer: the tune-up ask goes out in two taps, not ten minutes.",

  featuresH2: "Built for how an HVAC company actually works.",
  featureDispatchTitle: "A dispatch queue the whole team shares.",
  featureDispatchBody:
    "Assign each call to a tech and the surge becomes an ordered list with one owner per job. No two techs rolling to the same house.",
  featureSeasonalTitle: "Seasonal, without seasonal lock-in.",
  featureSeasonalBody:
    "Step up to Pro for the busy season and drop back when it slows. Flat pricing, month to month, so you're never paying for July capacity in October.",
  featureFollowUpTitle: "Follow-ups that stay visible.",
  featureFollowUpBody:
    "Tag the install quotes and the tune-up reminders; they sit on the list until they're closed, so the money doesn't leak while everyone's busy.",
  featureMechanicalTitle: "Works from the mechanical room.",
  featureMechanicalBody:
    "Any phone, one-handed, no app to install. Push notifications for a new no-heat text, and a dark mode for the pre-dawn cold-snap starts.",

  pricingH2After: "a month, flat. Cold snap or slow week.",
  pricingBodyBefore:
    "Starter covers 3 people, 1 local number, and texting sized for a small service shop on a fair-use basis, not a hard cap. A surge week is fine: past your included texting, extra texts bill at a small per-text rate up to a cap you set, and the composer shows the count before you send. Want to split the service line from the install line? Pro is",
  pricingBodyAfter:
    ", covers up to 15 people, and includes a second number for exactly that.",

  faqH2: "HVAC questions, straight answers.",
  faqRemindersQ: "Does Loonext send maintenance reminders automatically?",
  faqRemindersA:
    "No. Reminders are something you send, fast, with a saved reply: pull up your plan customers and text the tune-up nudge in a couple of taps. That keeps a real person deciding who to contact, and it keeps you inside the phone companies' rules on unsolicited blasts. What Loonext gives you is the shared inbox where the whole team sees who's been reminded and who's booked.",
  faqSurgeQ:
    "The calls all hit at once in a cold snap. How does a shared inbox help?",
  faqSurgeA:
    "It turns the pile-up into a queue. Every no-heat text becomes a conversation the whole team can triage: read the fault, note the likely part, assign the closest tech, send a window. Nothing rots in a voicemail box while a furnace is down.",
  faqPhotosQ: "Can customers text photos of the fault code or model plate?",
  faqPhotosA:
    "Yes, and receiving them is free. A photo of the thermostat error or the data plate often tells you the part before anyone drives out, so the right capacitor or board is already on the van.",
  faqSeatsQ: "We add techs for the busy season. Do we pay per person?",
  faqSeatsBefore: "No per-user fees. Starter is",
  faqSeatsMiddle: "for 3 people; scale to Pro at",
  faqSeatsAfter:
    "for up to 15 during the surge, then drop back when it quiets down. It's month to month.",
  faqQuotesQ: "How do we keep install quotes from going cold?",
  faqQuotesA:
    "Tag the conversation “Quote sent.” It stays on the list until someone closes it, so a big furnace or AC quote gets a real follow-up instead of slipping while everyone's chasing service calls.",
  faqRegisterQ:
    "What do you need from our company to get us approved for texting?",
  faqRegisterUs:
    "We file it for you: two minutes at signup with your legal business name, address, and EIN. No EIN because you run as a sole proprietor? We verify you with a texted code instead. Receiving texts works from day one, and texting US customers turns on in about a week, typically 3 to 7 business days, once the phone companies sign off.",
  faqRegisterCa:
    "Nothing to register and no wait. A Canadian shop texting Canadian customers is texting the same day it signs up.",

  finalH2: "Turn the cold-snap pile-up into a queue.",
  finalSub:
    "One shared inbox to triage the surge, read the fault, and keep the follow-ups from leaking. {claim}.",
} as const;

export const hvacFr: Translated<typeof hvacEn> = {
  metaTitle: "Logiciel de textos pour entreprises de CVCA",
  metaDescription:
    "Une seule ligne d'affaires pour votre équipe de CVCA : triez la pointe des grands froids, lisez le code d'erreur avant de répartir, et empêchez les soumissions d'installation de refroidir. Textos, appels et messagerie vocale, un seul prix mensuel fixe, {claim}.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "CVCA",
  displayName: "CVCA",

  dateline: "6 H 48 · PLUS DE CHAUFFAGE",
  h1: "Une seule ligne pour toute l'équipe de CVCA.",
  heroSubBefore:
    "Il est 6 h 48 du matin, la maison est froide, et le client a utilisé le seul numéro qu'il avait. Qu'il ait écrit ou appelé, celui qui est debout répond, la bonne pièce monte dans la camionnette, et l'appel « plus de chauffage » est réservé avant l'ouverture de l'atelier. Un numéro d'entreprise local pour les textos et les appels,",
  heroSubAfter: "par mois pour toute l'équipe.",
  heroTruth:
    "Fonctionne sur les téléphones que vos techniciens ont déjà · {chip} · Aucun contrat de haute saison",

  painH2: "On ne peut pas soumissionner un changement de fournaise du haut d'une échelle.",
  painBodyOne:
    "La demande en CVCA n'arrive pas au compte-gouttes ; elle explose. Le premier matin d'un grand froid, une douzaine de textos et d'appels « plus de chauffage » entrent avant 8 h, et la même chose se produit à l'inverse à la première canicule de juillet. Faites passer tout ça par le cellulaire d'une seule personne et vous obtenez une boîte vocale pleine, un répartiteur stressé, et des clients qui essaient la compagnie suivante parce que personne n'a répondu.",
  painBodyTwo:
    "Le reste de l'année, c'est l'hémorragie lente : la soumission de fournaise d'il y a trois semaines qui n'a jamais eu de relance, le client au plan d'entretien que personne n'a rappelé. Ce sont de vrais dollars, et ils glissent parce que la relance vit sur un papillon adhésif. Loonext garde la pointe triée et les relances visibles, toute l'équipe travaillant une seule boîte au lieu d'un seul téléphone.",

  threadH2: "Un matin sans chauffage, réservé avant le café.",
  threadLede:
    "Un appel à 6 h 46 que l'atelier était trop tôt pour prendre, avec un texto de retour automatique. Deux minutes plus tard, le client envoie une photo de l'erreur au thermostat. Le bureau lit le code, laisse une note pour apporter le condensateur, et assigne le technicien dont la camionnette a la pièce, qui répond par texto avec une plage horaire et un prix de diagnostic avant même l'ouverture.",
  threadAriaLabel:
    "Une conversation de Northline Heating : un appel manqué à 6 h 46 auquel un texto automatique répond, puis un texto « plus de chauffage » avec une photo d'erreur de thermostat à 6 h 48, assigné à Tariq et réservé pour 9 h",

  scriptTextBack:
    "Désolés d'avoir manqué votre appel, ici Northline Heating. L'atelier ouvre à 7 h. Écrivez-nous ici même et on vous revient tout de suite.",
  scriptInbound:
    "La fournaise est éteinte depuis hier soir et le thermostat affiche E4. Il fait 12 degrés dans la maison. Est-ce que quelqu'un peut venir aujourd'hui ?",
  scriptPhotoLabel: "Erreur de thermostat E4",
  scriptNote:
    "Un E4 sur ce modèle, c'est presque toujours le condensateur du ventilateur. Tariq, apporte la trousse de condensateurs et un filtre pendant que tu y es",
  scriptAssigned: "{by} a assigné cette conversation à {to}",
  scriptReply:
    "Bonjour Greg, Tariq de Northline Heating. Cette erreur pointe habituellement vers le ventilateur, et j'ai déjà la pièce probable dans la camionnette. Je peux être là pour 9 h. Le diagnostic est de 120 $ et il s'applique à la réparation. En attendant, laissez le système éteint plutôt que de le réinitialiser. Je peux passer ?",
  scriptConfirm: "Oui s'il vous plaît, 9 h ça marche. On s'emmitoufle en attendant",
  scriptTagged: "{by} a ajouté l'étiquette {tag}",
  scriptTagScheduled: "Planifié",

  useCasesH2: "Là où une boîte partagée gagne sa place dans une entreprise de CVCA.",
  useCaseTriageTitle: "Triez la pointe au lieu de vous y noyer.",
  useCaseTriageBody:
    "Quand les textos de grand froid s'empilent, la boîte partagée est une file : lire le code d'erreur, noter la pièce probable, assigner le technicien dont la camionnette l'a, envoyer une plage horaire. Rien ne dort dans une boîte vocale pendant qu'une maison gèle.",
  useCaseFaultTitle: "Lisez le code d'erreur avant de répartir.",
  useCaseFaultBody:
    "Demandez une photo de l'erreur au thermostat ou de la plaque signalétique. Un E4 plutôt qu'une lumière clignotante change la pièce qui monte dans le camion, et une photo dans le fil veut dire que le technicien arrive avec le condensateur déjà chargé.",
  useCaseQuoteTitle:
    "Relancez les soumissions d'installation avant qu'elles refroidissent.",
  useCaseQuoteBody:
    "Un changement de fournaise ou de climatiseur se conclut rarement le jour même. Étiquetez-le « Soumission envoyée » et il reste sur la liste jusqu'à ce que quelqu'un fasse un suivi, au lieu que la job parte tranquillement chez celui qui a rappelé en premier.",
  useCaseMaintenanceTitle: "Envoyez vos rappels d'entretien vous-même, à temps.",
  useCaseMaintenanceBody:
    "Deux fois par année, écrivez à vos clients au plan pour réserver la mise au point. Vous l'envoyez avec une réponse enregistrée, alors c'est rapide, mais c'est une vraie personne qui décide qui contacter, et toute l'équipe voit qui a été rappelé et qui est réservé.",

  savedRepliesH2: "Six textos que toute entreprise de CVCA envoie. Volez-les.",
  savedRepliesIntro:
    "Six réponses enregistrées à installer dès le premier jour : le « en route », le rappel de filtre, la demande de mise au point, dans le ton simple et rassurant dont un client qui a froid a besoin. Enregistrez-en chacune une fois et c'est deux touches pour toujours.",
  replyOnMyWayName: "En route",
  replyOnMyWayText:
    "En route maintenant, je devrais être chez vous dans une trentaine de minutes. Si le système est éteint, laissez-le éteint jusqu'à mon arrivée.",
  replyFilterName: "Rappel de filtre",
  replyFilterText:
    "Petit rappel de changer votre filtre ce mois-ci. Ça garde le système efficace et la garantie valide. Voulez-vous qu'on vous dépose le bon format ?",
  replyQuoteName: "Relance de soumission",
  replyQuoteText:
    "Bonjour {first_name}, je fais un suivi sur la soumission de fournaise qu'on vous a envoyée. Content de répondre à vos questions ou de vous expliquer le financement. Aucune urgence, aucune pression.",
  replyBookingName: "Confirmation de rendez-vous",
  replyBookingText:
    "C'est réservé pour mardi entre 8 h et 10 h. On vous écrit quand le technicien est en route.",
  replySeasonName: "Demande de saison d'entretien",
  replySeasonText:
    "C'est la saison des mises au point. Voulez-vous qu'on vérifie votre système avant la ruée ? Répondez avec une journée qui vous convient et on organise ça.",
  replyReviewName: "Demande d'avis",
  replyReviewText:
    "Content d'avoir remis le chauffage, {first_name}. Si vous avez une minute, un avis Google aide un petit commerce comme le nôtre.",
  savedRepliesCaption:
    "L'ensemble CVCA dans le champ de saisie : la demande de mise au point part en deux touches, pas en dix minutes.",

  featuresH2: "Bâti pour la façon dont une entreprise de CVCA travaille vraiment.",
  featureDispatchTitle: "Une file de répartition que toute l'équipe partage.",
  featureDispatchBody:
    "Assignez chaque appel à un technicien et la pointe devient une liste ordonnée avec un seul responsable par job. Jamais deux techniciens vers la même maison.",
  featureSeasonalTitle: "Saisonnier, sans enfermement saisonnier.",
  featureSeasonalBody:
    "Montez à Pro pour la haute saison et redescendez quand ça ralentit. Prix fixe, au mois, alors vous ne payez jamais en octobre pour la capacité de juillet.",
  featureFollowUpTitle: "Des relances qui restent visibles.",
  featureFollowUpBody:
    "Étiquetez les soumissions d'installation et les rappels de mise au point ; ils restent sur la liste jusqu'à ce qu'ils soient fermés, alors l'argent ne fuit pas pendant que tout le monde est occupé.",
  featureMechanicalTitle: "Fonctionne depuis la salle mécanique.",
  featureMechanicalBody:
    "N'importe quel téléphone, à une main, aucune application à installer. Des notifications pour un nouveau texto « plus de chauffage », et un mode sombre pour les départs d'avant l'aube pendant les grands froids.",

  pricingH2After: "par mois, prix fixe. Grand froid ou semaine tranquille.",
  pricingBodyBefore:
    "Starter couvre 3 personnes, 1 numéro local, et des textos taillés pour un petit atelier de service sur une base d'utilisation équitable, pas un plafond rigide. Une semaine de pointe ne pose aucun problème : au-delà de vos textos inclus, les textos supplémentaires sont facturés à un petit tarif à l'unité jusqu'à un plafond que vous fixez, et le champ de saisie montre le compte avant l'envoi. Vous voulez séparer la ligne de service de la ligne d'installation ? Pro est à",
  pricingBodyAfter:
    ", couvre jusqu'à 15 personnes, et comprend un deuxième numéro exactement pour ça.",

  faqH2: "Questions de CVCA, réponses directes.",
  faqRemindersQ:
    "Est-ce que Loonext envoie les rappels d'entretien automatiquement ?",
  faqRemindersA:
    "Non. Les rappels, c'est quelque chose que vous envoyez, rapidement, avec une réponse enregistrée : sortez vos clients au plan et envoyez le rappel de mise au point en deux touches. Ça garde une vraie personne qui décide qui contacter, et ça vous garde à l'intérieur des règles des compagnies de téléphone sur les envois non sollicités. Ce que Loonext vous donne, c'est la boîte partagée où toute l'équipe voit qui a été rappelé et qui est réservé.",
  faqSurgeQ:
    "Les appels arrivent tous en même temps lors d'un grand froid. En quoi une boîte partagée aide-t-elle ?",
  faqSurgeA:
    "Ça transforme l'empilement en file. Chaque texto « plus de chauffage » devient une conversation que toute l'équipe peut trier : lire le code d'erreur, noter la pièce probable, assigner le technicien le plus proche, envoyer une plage horaire. Rien ne pourrit dans une boîte vocale pendant qu'une fournaise est en panne.",
  faqPhotosQ:
    "Les clients peuvent-ils envoyer des photos du code d'erreur ou de la plaque signalétique ?",
  faqPhotosA:
    "Oui, et les recevoir est gratuit. Une photo de l'erreur au thermostat ou de la plaque vous dit souvent quelle pièce apporter avant que quelqu'un prenne la route, alors le bon condensateur ou la bonne carte est déjà dans la camionnette.",
  faqSeatsQ:
    "On ajoute des techniciens pour la haute saison. Paie-t-on par personne ?",
  faqSeatsBefore: "Aucuns frais par personne. Starter est à",
  faqSeatsMiddle: "pour 3 personnes ; montez à Pro à",
  faqSeatsAfter:
    "pour un maximum de 15 pendant la pointe, puis redescendez quand ça se calme. C'est au mois.",
  faqQuotesQ:
    "Comment empêcher les soumissions d'installation de refroidir ?",
  faqQuotesA:
    "Étiquetez la conversation « Soumission envoyée ». Elle reste sur la liste jusqu'à ce que quelqu'un la ferme, alors une grosse soumission de fournaise ou de climatiseur obtient une vraie relance au lieu de glisser pendant que tout le monde court après les appels de service.",
  faqRegisterQ:
    "De quoi avez-vous besoin de notre entreprise pour nous faire approuver pour texter ?",
  faqRegisterUs:
    "On le dépose pour vous : deux minutes à l'inscription avec votre nom légal d'entreprise, votre adresse et votre EIN. Pas d'EIN parce que vous êtes travailleur autonome ? On vous vérifie plutôt avec un code envoyé par texto. La réception des textos fonctionne dès le premier jour, et l'envoi vers les clients américains s'active en environ une semaine, généralement de 3 à 7 jours ouvrables, une fois que les compagnies de téléphone donnent leur accord.",
  faqRegisterCa:
    "Rien à enregistrer et aucune attente. Un atelier canadien qui écrit à des clients canadiens texte le jour même de son inscription.",

  finalH2: "Transformez l'empilement des grands froids en file d'attente.",
  finalSub:
    "Une seule boîte partagée pour trier la pointe, lire le code d'erreur, et empêcher les relances de fuir. {claim}.",
};

const HVAC_COPY = {
  en: hvacEn,
  "fr-CA": hvacFr,
} as const;

export type HvacCopy = typeof hvacEn | typeof hvacFr;

export function hvacCopy(locale: MarketingLocale = "en"): HvacCopy {
  return HVAC_COPY[locale] ?? hvacEn;
}
