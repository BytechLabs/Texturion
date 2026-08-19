import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /features/templates-and-tags, in both languages.
 *
 * ## The variables are tokens, not words
 *
 * `{first_name}` and `{business_name}` are substituted by the product at send
 * time. They appear inside the example templates on this page, and they must
 * survive translation **byte for byte**: a French `{prénom}` would render
 * literally in a customer's text, which is the exact failure the page's own FAQ
 * promises never happens ("so 'Hi {first_name}' never goes out literally").
 * Translating the token would make the page a demonstration of the bug it
 * denies.
 *
 * ## The `/` shortcut is a keystroke
 *
 * "Type / in the composer" is an instruction about a key, not a word. It stays
 * `/` in both languages, and the dateline keeps it.
 *
 * ## The tag names are product vocabulary
 *
 * Quote sent, Scheduled, Won, Lost ship in the app. The French here has to be
 * the French the app uses, for the reason `shared-inbox.ts` gives: a page that
 * names them differently is showing a reader controls they will not find.
 */
export const templatesEn = {
  metaTitle: "Saved replies and tags that match how you sell",
  metaDescription:
    "Write your on-my-way and quote-follow-up texts once, send them in two taps with the / shortcut. Tag conversations quote sent, scheduled, won. Mark texts done in the thread.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Templates and tags",

  dateline: "TYPE / · TAP · SENT",
  h1: "Stop retyping the same five texts.",
  heroSub:
    "The texts a crew sends all day, on my way, here's your quote, you're booked, get written once and sent in two taps. Then tag conversations the way you actually sell, mark the little things done right in the thread, and find any old message in seconds.",
  repliesCaption:
    "Type / in the composer and the saved replies open, with the preview showing what actually ships.",
  repliesAria:
    "The Loonext saved-replies picker open over the composer, with a template preview",

  repliesEyebrow: "Saved replies",
  repliesTitle: "Write it once. Send it in two taps.",
  repliesBodyOne:
    "Every service crew sends the same handful of texts on repeat: the on-my-way, the photo request, the quote follow-up, the booking confirmation. Saved replies let you write each one once and reuse it forever. In the composer, type / and your templates pop up; pick one and it drops into the message, ready to send or tweak.",
  repliesBodyTwo:
    "Templates can carry variables, the customer's first name and your business name, which fill in at send time, and the editor shows you a preview of exactly what will ship. They belong to the business, not to one person: everyone works from the same set, so the whole team sounds consistent, and every template is editable to sound like you.",

  tagsEyebrow: "Tags and done-marks",
  tagsTitle: "Tag it the way you sell. Check off what's handled.",
  tagsCaption:
    "A conversation tagged Scheduled, and a question checked off right in the thread.",
  tagsAria: "Loonext pipeline tags on a conversation and a message marked done",
  tagsBodyOne:
    'A conversation carries a status for its state (new, open, waiting, closed) and tags for how it fits your pipeline. Loonext ships with a sell-ready set, quote sent, scheduled, won, lost, and every one is editable to match the words your shop actually uses. Tag a thread "Quote sent" and Monday morning you can pull up your open quotes and follow up, instead of losing the job to whoever replied first.',
  tagsBodyTwo:
    'And inside a long thread, some messages are little tasks: "can you send someone this week?" Tap the message to mark it done. It draws a strikethrough and a check, notes who checked it off and when, and the whole crew sees it\'s handled. No separate to-do app.',

  importEyebrow: "Contacts and search",
  importTitle: "Your customer list, imported and searchable.",
  importBodyOne:
    "Bring your existing customers in with a CSV. The import shows you a dry-run preview, exactly which rows will import and which will be skipped, and why, before anything is written, and it makes an opted-out column explicit so you never accidentally text someone who asked you not to. Each contact carries a notes field for the things worth remembering: gate codes, preferences, the quirks of a property.",
  importBodyTwo:
    'Everything is searchable. Type a name, a number, or a phrase like "water heater" and Loonext pulls up the matching conversations and contacts with the matching text highlighted, so "what did we quote the Nguyens in March?" is a five-second question.',

  useEyebrow: "Use it like this",
  useTitle: "The workflow layer, on a normal Tuesday.",
  useOnMyWayTitle: "The on-my-way, in two taps",
  useOnMyWayBody:
    'Save it once: "On my way. Should be there in about 20 minutes." Type /, tap, sent. The customer knows you\'re coming and nobody typed a word from behind the wheel of a parked truck.',
  useQuotesTitle: "Monday's open quotes",
  useQuotesBody:
    "Every quote you sent last week is tagged Quote sent. Open that list Monday morning, send the saved follow-up to each one, and the quiet jobs come back to life before lunch.",
  useThreadTitle: "The tidy long thread",
  useThreadBody:
    "A three-week renovation thread piles up questions. Mark each one done as it's handled and the thread reads like a checklist the whole crew can trust, right where the conversation lives.",

  factsEyebrow: "The plain facts",
  factsEditable:
    "Templates are per-business and editable, and every plan includes them.",
  factsNeverAuto:
    "A template never auto-sends. No drip sequences, no scheduled sends: you send every text.",
  factsDoneMark:
    "A done-mark is the light version: one tap on a message, no due date, no owner. When something needs those, promote it to a task instead. Neither is a construction suite: no Gantt, no dependencies, no dispatch.",

  edgesEyebrow: "The precise edges",
  edgesTitle:
    "These are texting-workflow tools, and it's worth being exact about where they stop.",
  edgesShortcutTitle: "Saved replies are shortcuts, not automation.",
  edgesShortcutBody:
    "A template is a text you send with one tap; it never sends on its own, and there are no drip campaigns or scheduled sends. Two things do send by themselves, both in words you wrote: your after-hours auto-reply and your missed-call text back. Everything else is one tap away because it is a shortcut, not because the app is texting customers for you.",
  edgesDoneTitle: "Done-marks are on messages, not jobs.",
  edgesDoneBody:
    "Marking a text done checks off a single message inside a thread, with a record of who did it and when. It keeps a conversation tidy; it isn't a task list, a job board, or a scheduler, and it won't pretend to be.",
  edgesImportTitle: "Import is your list, with consent.",
  edgesImportBody:
    "CSV import is for customers you already have permission to text. Purchased or scraped lists are banned by our acceptable use policy, and the import preview surfaces opt-out status so you don't message someone who's already out.",

  pricingBefore:
    "Saved replies, tags, statuses, done-marks, search, CSV import, and contact notes are included on every plan. There's no workflow upsell: Starter is",
  pricingStarterAfter: "/mo for up to 3 people, Pro is",
  pricingProAfter: "/mo for up to 15 and a second number.",
  pricingUsBefore: "US shops pay a one-time",
  pricingUsMiddle:
    "to register with the phone companies, once, ever, so the first month is",
  pricingUsAnd: "and every month after is",
  pricingCaBefore:
    "Texting Canadian customers has no registration and no setup fee, so",
  pricingUsIs: "is",
  pricingUsAfter: "from your first month on.",

  relatedEyebrow: "Templates that fit your trade",
  relatedTitle:
    "The best saved-replies pack is the one written for your work. Here's how templates and tags play out for a couple of trades, and where they live.",
  relatedCleanersTitle: "Texting for cleaners",
  relatedCleanersBody:
    "Recurring confirmations and access instructions, saved and sent in two taps.",
  relatedPlumbersTitle: "Texting for plumbers",
  relatedPlumbersBody:
    "The on-my-way, photo-request, and quote-follow-up pack, ready to edit.",
  relatedInboxTitle: "The shared inbox",
  relatedInboxBody:
    "Where saved replies, tags, and done-marks live: one inbox, the whole crew.",
  relatedCompareTitle: "Loonext vs Quo",
  relatedCompareBody: "Workflow tools included, next to a per-user phone system.",

  faqTitle: "Template and tag questions, straight answers.",
  faqUseQ: "How do I use a saved reply?",
  faqUseA:
    "In the composer, type / to open your template list, then pick one; it drops into the message ready to send or edit. You can also open the picker from the composer toolbar. Templates are shared across the crew, so everyone sends from the same set.",
  faqNameQ: "Do templates support the customer's name?",
  faqNameA:
    "Yes. A template can include the customer's first name and your business name as variables, which fill in automatically at send time, and the editor shows a preview of exactly what will ship, so 'Hi {first_name}' never goes out literally.",
  faqTagsQ: "Can I edit the built-in tags?",
  faqTagsA:
    "Yes. Quote sent, Scheduled, Won, and Lost ship ready to use, and you can rename them, add your own, or remove ones you don't need, so the tags match how your shop actually talks about a job.",
  faqAutoQ: "Do templates send automatically?",
  faqAutoA:
    "No. A saved reply is a text you send with one tap; it never sends on its own, and there is no drip sequencing or scheduled sending. Two automatic messages do exist and both are yours: the after-hours auto-reply and the missed-call text back, sent in words you wrote yourself. Separately, you can ask to be reminded to chase a thread, which nudges YOU rather than texting the customer.",
  faqDoneQ: "What exactly does marking a text done do?",
  faqDoneA:
    "It checks off a single message in a thread, drawing a strikethrough and a check, with a note of who did it and when. It keeps a long conversation tidy and lets the crew see what's been handled. It's not a job, a task, or a to-do list; it's a message-level done-mark.",
  faqImportQ: "How does CSV import work?",
  faqImportA:
    "Upload your file, map the columns (we auto-detect the obvious ones), and review a dry-run preview showing exactly what will import and what will be skipped, including opt-out status, before anything is written. It's built to bring in customers you already have consent to text.",

  ctaTitle: "Give your crew the shortcuts they'll actually use.",
  ctaSubBefore:
    "Saved replies, sell-pipeline tags, done-marks, and search, the workflow layer on your shared inbox,",
  ctaSubAfter: ".",

  visualSearch: "Search saved replies…",
  visualHeading: "Saved replies",
  visualPreview: "Preview",
  visualPreviewBody:
    "Hi Karen, it's Reyes Plumbing. On my way, should be with you in about 20 minutes.",
  visualSend: "Send",
  visualOnMyWay: "On my way",
  visualOnMyWayBody:
    "Hi {first_name}, it's {business_name}. On my way, should be with you in about 20 minutes.",
  visualPhoto: "Photo request",
  visualPhotoBody:
    "Can you text us a photo of the problem, and one of the space around it?",
  visualFollowUp: "Quote follow-up",
  visualFollowUpBody:
    "Hi {first_name}, just checking you received our quote. Any questions, text us here.",
  visualJobDone: "Job done",
  visualJobDoneBody:
    "All done. We've cleared the line and tested it. Text us if anything comes up.",

  tagQuoteSent: "Quote sent",
  tagScheduled: "Scheduled",
  tagWon: "Won",
  tagLost: "Lost",
  tagsVisualHeading: "Tags on this conversation",
  tagsVisualNote: "Scheduled is applied. Rename any of them to match how you sell.",
  doneVisualHeading: "Mark a text done",
  doneVisualMessage:
    "Can you send someone to look at the water heater this week?",
  doneVisualStamp: "Done · Priya · 2:14 PM",
  doneVisualNote: "Checked off right in the thread. The whole crew sees it's handled.",
} as const;

export const templatesFr: Translated<typeof templatesEn> = {
  metaTitle: "Réponses enregistrées et étiquettes qui suivent votre façon de vendre",
  metaDescription:
    "Écrivez une fois vos textos « en route » et vos relances de soumission, envoyez-les en deux touches avec le raccourci /. Étiquetez les conversations soumission envoyée, planifié, gagné. Marquez les textos comme terminés dans le fil.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "Modèles et étiquettes",

  dateline: "TAPEZ / · TOUCHEZ · ENVOYÉ",
  h1: "Arrêtez de retaper les cinq mêmes textos.",
  heroSub:
    "Les textos qu'une équipe envoie toute la journée — en route, voici votre soumission, c'est réservé — s'écrivent une fois et s'envoient en deux touches. Ensuite, étiquetez les conversations selon votre façon de vendre, cochez les petites choses réglées directement dans le fil, et retrouvez n'importe quel vieux message en quelques secondes.",
  repliesCaption:
    "Tapez / dans le champ de saisie et les réponses enregistrées s'ouvrent, avec l'aperçu de ce qui part vraiment.",
  repliesAria:
    "Le sélecteur de réponses enregistrées de Loonext ouvert au-dessus du champ de saisie, avec un aperçu du modèle",

  repliesEyebrow: "Réponses enregistrées",
  repliesTitle: "Écrivez-le une fois. Envoyez-le en deux touches.",
  repliesBodyOne:
    "Chaque équipe de service envoie la même poignée de textos en boucle : le « en route », la demande de photo, la relance de soumission, la confirmation de rendez-vous. Les réponses enregistrées vous permettent d'écrire chacun une fois et de le réutiliser pour toujours. Dans le champ de saisie, tapez / et vos modèles apparaissent ; choisissez-en un et il se glisse dans le message, prêt à envoyer ou à retoucher.",
  repliesBodyTwo:
    "Les modèles peuvent porter des variables — le prénom du client et le nom de votre entreprise — qui se remplissent au moment de l'envoi, et l'éditeur vous montre un aperçu exact de ce qui partira. Ils appartiennent à l'entreprise, pas à une personne : tout le monde travaille avec le même ensemble, alors toute l'équipe sonne pareil, et chaque modèle se modifie pour sonner comme vous.",

  tagsEyebrow: "Étiquettes et marques « terminé »",
  tagsTitle: "Étiquetez selon votre façon de vendre. Cochez ce qui est réglé.",
  tagsCaption:
    "Une conversation étiquetée Planifié, et une question cochée directement dans le fil.",
  tagsAria:
    "Les étiquettes de suivi Loonext sur une conversation et un message marqué comme terminé",
  tagsBodyOne:
    "Une conversation porte un état (nouveau, ouvert, en attente, fermé) et des étiquettes pour sa place dans votre suivi des ventes. Loonext arrive avec un ensemble prêt à vendre — soumission envoyée, planifié, gagné, perdu — et chacune se modifie pour coller aux mots que votre commerce emploie vraiment. Étiquetez un fil « Soumission envoyée » et le lundi matin vous sortez vos soumissions ouvertes et faites vos relances, au lieu de perdre la job au profit de celui qui a répondu en premier.",
  tagsBodyTwo:
    "Et dans un long fil, certains messages sont de petites tâches : « pouvez-vous envoyer quelqu'un cette semaine ? » Touchez le message pour le marquer terminé. Ça trace une rature et un crochet, note qui l'a coché et quand, et toute l'équipe voit que c'est réglé. Aucune application de tâches à part.",

  importEyebrow: "Contacts et recherche",
  importTitle: "Votre liste de clients, importée et cherchable.",
  importBodyOne:
    "Amenez vos clients existants avec un CSV. L'importation vous montre un aperçu à blanc — exactement quelles lignes seront importées et lesquelles seront sautées, et pourquoi — avant que quoi que ce soit soit écrit, et elle rend explicite une colonne de retrait pour que vous n'écriviez jamais par accident à quelqu'un qui vous l'a demandé. Chaque contact porte un champ de notes pour ce qui vaut la peine d'être retenu : codes de barrière, préférences, particularités d'une propriété.",
  importBodyTwo:
    "Tout est cherchable. Tapez un nom, un numéro ou une expression comme « chauffe-eau » et Loonext sort les conversations et les contacts qui correspondent, avec le texte trouvé surligné : « combien a-t-on soumissionné aux Nguyen en mars ? » devient une question de cinq secondes.",

  useEyebrow: "Voici comment s'en servir",
  useTitle: "La couche de méthode, un mardi ordinaire.",
  useOnMyWayTitle: "Le « en route », en deux touches",
  useOnMyWayBody:
    "Enregistrez-le une fois : « En route. On devrait être là dans une vingtaine de minutes. » Tapez /, touchez, envoyé. Le client sait que vous arrivez et personne n'a tapé un mot au volant d'un camion stationné.",
  useQuotesTitle: "Les soumissions ouvertes du lundi",
  useQuotesBody:
    "Chaque soumission envoyée la semaine dernière est étiquetée Soumission envoyée. Ouvrez cette liste le lundi matin, envoyez la relance enregistrée à chacune, et les jobs tranquilles reprennent vie avant le dîner.",
  useThreadTitle: "Le long fil bien tenu",
  useThreadBody:
    "Un fil de rénovation de trois semaines accumule les questions. Marquez chacune terminée à mesure qu'elle est réglée et le fil se lit comme une liste à cocher à laquelle toute l'équipe peut se fier, là même où vit la conversation.",

  factsEyebrow: "Les faits, simplement",
  factsEditable:
    "Les modèles appartiennent à l'entreprise et se modifient, et tous les forfaits les comprennent.",
  factsNeverAuto:
    "Un modèle ne s'envoie jamais tout seul. Aucune séquence automatisée, aucun envoi programmé : c'est vous qui envoyez chaque texto.",
  factsDoneMark:
    "Une marque « terminé » est la version légère : une touche sur un message, sans échéance ni responsable. Quand quelque chose a besoin de ceux-là, transformez-le en tâche. Ni l'un ni l'autre n'est une suite de gestion de chantier : aucun Gantt, aucune dépendance, aucune répartition.",

  edgesEyebrow: "Les limites précises",
  edgesTitle:
    "Ce sont des outils de méthode pour les textos, et il vaut la peine d'être exact sur là où ils s'arrêtent.",
  edgesShortcutTitle:
    "Les réponses enregistrées sont des raccourcis, pas de l'automatisation.",
  edgesShortcutBody:
    "Un modèle est un texto que vous envoyez d'une touche ; il ne part jamais tout seul, et il n'y a ni campagne automatisée ni envoi programmé. Deux choses partent d'elles-mêmes, toutes deux dans des mots que vous avez écrits : votre réponse automatique après les heures et votre texto de retour d'appel manqué. Tout le reste est à une touche parce que c'est un raccourci, pas parce que l'application écrit à vos clients à votre place.",
  edgesDoneTitle: "Les marques « terminé » portent sur des messages, pas sur des jobs.",
  edgesDoneBody:
    "Marquer un texto comme terminé coche un seul message dans un fil, avec la trace de qui l'a fait et quand. Ça garde une conversation bien tenue ; ce n'est pas une liste de tâches, un tableau de jobs ni un planificateur, et ça ne prétendra pas l'être.",
  edgesImportTitle: "L'importation, c'est votre liste, avec le consentement.",
  edgesImportBody:
    "L'importation CSV sert aux clients à qui vous avez déjà la permission d'écrire. Les listes achetées ou récoltées sont interdites par notre politique d'utilisation acceptable, et l'aperçu d'importation fait ressortir l'état de retrait pour que vous n'écriviez pas à quelqu'un qui s'est déjà retiré.",

  pricingBefore:
    "Les réponses enregistrées, les étiquettes, les états, les marques « terminé », la recherche, l'importation CSV et les notes de contact sont comprises dans tous les forfaits. Il n'y a aucun supplément de méthode : Starter est à",
  pricingStarterAfter: "/mois pour un maximum de 3 personnes, Pro est à",
  pricingProAfter: "/mois pour un maximum de 15 et un deuxième numéro.",
  pricingUsBefore: "Les commerces américains paient des frais uniques de",
  pricingUsMiddle:
    "pour s'enregistrer auprès des compagnies de téléphone, une seule fois, à vie, alors le premier mois est de",
  pricingUsAnd: "et chaque mois ensuite est de",
  pricingCaBefore:
    "Écrire à des clients canadiens n'exige aucun enregistrement et aucuns frais d'installation, alors",
  pricingUsIs: "est de",
  pricingUsAfter: "à partir de votre premier mois.",

  relatedEyebrow: "Des modèles taillés pour votre métier",
  relatedTitle:
    "Le meilleur ensemble de réponses enregistrées est celui écrit pour votre travail. Voici comment les modèles et les étiquettes se vivent dans quelques métiers, et où ils habitent.",
  relatedCleanersTitle: "Les textos pour les entreprises de ménage",
  relatedCleanersBody:
    "Confirmations récurrentes et instructions d'accès, enregistrées et envoyées en deux touches.",
  relatedPlumbersTitle: "Les textos pour les plombiers",
  relatedPlumbersBody:
    "L'ensemble « en route », demande de photo et relance de soumission, prêt à modifier.",
  relatedInboxTitle: "La boîte de réception partagée",
  relatedInboxBody:
    "Là où vivent les réponses enregistrées, les étiquettes et les marques « terminé » : une boîte, toute l'équipe.",
  relatedCompareTitle: "Loonext vs Quo",
  relatedCompareBody:
    "Les outils de méthode inclus, à côté d'un système téléphonique facturé par personne.",

  faqTitle: "Questions sur les modèles et les étiquettes, réponses directes.",
  faqUseQ: "Comment utiliser une réponse enregistrée ?",
  faqUseA:
    "Dans le champ de saisie, tapez / pour ouvrir votre liste de modèles, puis choisissez-en un ; il se glisse dans le message, prêt à envoyer ou à modifier. Vous pouvez aussi ouvrir le sélecteur depuis la barre d'outils. Les modèles sont partagés par toute l'équipe, alors tout le monde envoie à partir du même ensemble.",
  faqNameQ: "Les modèles prennent-ils le nom du client ?",
  faqNameA:
    "Oui. Un modèle peut inclure le prénom du client et le nom de votre entreprise comme variables, qui se remplissent automatiquement au moment de l'envoi, et l'éditeur montre un aperçu exact de ce qui partira, alors « Bonjour {first_name} » ne part jamais tel quel.",
  faqTagsQ: "Puis-je modifier les étiquettes fournies ?",
  faqTagsA:
    "Oui. Soumission envoyée, Planifié, Gagné et Perdu arrivent prêtes à servir, et vous pouvez les renommer, ajouter les vôtres ou retirer celles dont vous n'avez pas besoin, pour que les étiquettes collent à la façon dont votre commerce parle vraiment d'une job.",
  faqAutoQ: "Les modèles s'envoient-ils automatiquement ?",
  faqAutoA:
    "Non. Une réponse enregistrée est un texto que vous envoyez d'une touche ; elle ne part jamais toute seule, et il n'y a ni séquence automatisée ni envoi programmé. Deux messages automatiques existent et ils sont tous deux à vous : la réponse automatique après les heures et le texto de retour d'appel manqué, envoyés dans des mots que vous avez écrits vous-même. Séparément, vous pouvez demander qu'on vous rappelle de relancer un fil, ce qui vous pousse VOUS plutôt que d'écrire au client.",
  faqDoneQ: "Que fait exactement le fait de marquer un texto comme terminé ?",
  faqDoneA:
    "Ça coche un seul message dans un fil, en traçant une rature et un crochet, avec une note de qui l'a fait et quand. Ça garde une longue conversation bien tenue et laisse l'équipe voir ce qui a été réglé. Ce n'est ni une job, ni une tâche, ni une liste de choses à faire ; c'est une marque « terminé » au niveau du message.",
  faqImportQ: "Comment fonctionne l'importation CSV ?",
  faqImportA:
    "Téléversez votre fichier, associez les colonnes (nous détectons les évidentes), et passez en revue un aperçu à blanc montrant exactement ce qui sera importé et ce qui sera sauté, y compris l'état de retrait, avant que quoi que ce soit soit écrit. C'est bâti pour amener des clients à qui vous avez déjà le consentement d'écrire.",

  ctaTitle: "Donnez à votre équipe les raccourcis qu'elle utilisera vraiment.",
  ctaSubBefore:
    "Les réponses enregistrées, les étiquettes de suivi, les marques « terminé » et la recherche : la couche de méthode sur votre boîte partagée,",
  ctaSubAfter: ".",

  visualSearch: "Chercher dans les réponses enregistrées…",
  visualHeading: "Réponses enregistrées",
  visualPreview: "Aperçu",
  visualPreviewBody:
    "Bonjour Karen, ici Reyes Plumbing. En route, on devrait être chez vous dans une vingtaine de minutes.",
  visualSend: "Envoyer",
  visualOnMyWay: "En route",
  visualOnMyWayBody:
    "Bonjour {first_name}, ici {business_name}. En route, on devrait être chez vous dans une vingtaine de minutes.",
  visualPhoto: "Demande de photo",
  visualPhotoBody:
    "Pouvez-vous nous envoyer une photo du problème, et une de l'espace autour ?",
  visualFollowUp: "Relance de soumission",
  visualFollowUpBody:
    "Bonjour {first_name}, je vérifie simplement que vous avez reçu notre soumission. Des questions ? Écrivez-nous ici.",
  visualJobDone: "Job terminée",
  visualJobDoneBody:
    "C'est terminé. On a débouché la ligne et on l'a testée. Écrivez-nous si quoi que ce soit survient.",

  tagQuoteSent: "Soumission envoyée",
  tagScheduled: "Planifié",
  tagWon: "Gagné",
  tagLost: "Perdu",
  tagsVisualHeading: "Étiquettes sur cette conversation",
  tagsVisualNote:
    "Planifié est appliquée. Renommez-en n'importe laquelle pour coller à votre façon de vendre.",
  doneVisualHeading: "Marquer un texto comme terminé",
  doneVisualMessage:
    "Pouvez-vous envoyer quelqu'un regarder le chauffe-eau cette semaine ?",
  doneVisualStamp: "Terminé · Priya · 14 h 14",
  doneVisualNote:
    "Coché directement dans le fil. Toute l'équipe voit que c'est réglé.",
};

const TEMPLATES_COPY = {
  en: templatesEn,
  "fr-CA": templatesFr,
} as const;

export type TemplatesCopy = typeof templatesEn | typeof templatesFr;

export function templatesCopy(locale: MarketingLocale = "en"): TemplatesCopy {
  return TEMPLATES_COPY[locale] ?? templatesEn;
}
