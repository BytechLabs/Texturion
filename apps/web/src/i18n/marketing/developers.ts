import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const developersEn = {
  metadataTitle: "Developers",
  metadataDescription:
    "The Loonext public API: scoped keys, a small REST surface, and signed outbound webhooks — with a stated versioning and deprecation policy.",
  title: "Connect Loonext to whatever else you run.",
  lead:
    "A small REST API and signed outbound webhooks, so your scheduling tool, your books, or a Zap can work with the same conversations your crew does. Keys are scoped, revocable, and can never do more than the person who created them.",
  baseBefore: "Base path",
  baseAfter: "Create a key in Settings → API keys.",
  authTitle: "Authentication, and what a key can reach.",
  authBefore: "Send the key as",
  authAfter:
    "It is shown once, when it is created; we keep a hash and the first twelve characters, and there is no way to look it up afterwards.",
  authDetail:
    "A key acts as the person who created it, narrowed by the scopes they chose. That has two consequences worth designing around: a key never outlives its creator's access — if they leave the workspace, it stops working on the next request — and a key created by someone who cannot see a particular phone number cannot see its conversations either.",
  surfaceTitle: "The whole surface.",
  surfaceLead:
    "Deliberately short. This is the set an integration actually needs, not our internal API with a second door.",
  routeMe: "Which workspace this key reaches, and what it may do. Start here.",
  routeContactsGet: "The customer list, newest first.",
  routeContactsPost:
    "Add a customer. Re-sending one you already sent updates it rather than duplicating.",
  routeConversations: "The thread list.",
  routeMessagesGet: "One thread's messages.",
  routeMessagesPost:
    "Send a text into an existing thread. Requires an Idempotency-Key header.",
  routeTasksGet: "The job list.",
  routeTasksPost: "Turn a message into a job.",
  routeWebhooksPost:
    "Subscribe to events. This is the REST-hook endpoint Zapier and Make use.",
  routeWebhooksDelete:
    "Unsubscribe. A key can only remove a subscription it created.",
  webhooksTitle: "Webhooks, so you are not polling.",
  webhooksBefore:
    "Point an https address at us and we post the moment something happens. Every delivery is signed with HMAC-SHA256 over",
  webhooksMiddle: "sent as",
  webhooksAfterBeforeRetries:
    "and carries the delivery id so a retry is recognisably the same event. A failing address is retried",
  webhooksAfterRetries:
    "times with growing gaps, and one that keeps refusing is switched off so it stops costing you deliveries you are not receiving.",
  promisesTitleBefore: "What",
  promisesTitleAfter: "promises.",
  promisesLead:
    "An API is a promise. Here is ours, so you can decide how much to build on it.",
  whileExistsBefore: "While",
  whileExistsAfter: "exists",
  promiseField:
    "A field we publish will not be removed or change meaning. New fields may be added, so parse permissively — an unknown field is not an error.",
  promiseRoute:
    "A route will not be removed, and its method and path will not change.",
  promiseEvent:
    "An event name will not be removed or repurposed. New ones may be added; ignore names you do not know.",
  promiseSignature:
    "The webhook signature scheme will not change under v1=. A v2= may appear beside it, and a receiver checking v1= keeps working.",
  promiseErrors: "Error codes and their HTTP statuses will not change.",
  notPromisedTitle: "What we do not promise",
  notPromisedOrder:
    "Ordering beyond what a route documents. Lists are newest-first; nothing else about order is stable.",
  notPromisedRateBefore: "Rate limits. Today a key is allowed",
  notPromisedRateAfter: "requests a minute. Handle 429.",
  notPromisedTiming:
    "Timing. Webhook delivery is best-effort with retries; nothing is synchronous with the event that caused it.",
  notPromisedPrivate:
    "Our first-party API. The app's own endpoints are not this API and change whenever the product does.",
  breakingTitle: "If we ever have to break something",
  breakingBefore:
    "A breaking change means a new version path —",
  breakingBeside: "— served",
  breakingStrong: "beside",
  breakingAfter:
    "never replacing it under a running integration. Every response already carries",
  breakingEnd:
    "so a client that pins nothing is still told what answered.",
  retirementBefore: "If",
  retirementMiddle:
    "is ever retired, we announce it and then wait",
  retirementStrong: "at least twelve months",
  retirementAfter:
    "emailing the workspaces whose keys are still calling it at six months and again at one. We know exactly who they are, because we record when each key was last used. Twelve months is chosen to be longer than the gap between an integrator finishing a job and being asked back — a policy measured in weeks is one that breaks somebody's business on a Tuesday.",
} as const;

export const developersFr: Translated<typeof developersEn> = {
  metadataTitle: "Développeurs",
  metadataDescription:
    "L'API publique de Loonext : clés à portée limitée, petite surface REST et webhooks sortants signés, avec une politique claire de versions et de retrait.",
  title: "Reliez Loonext aux autres outils de votre entreprise.",
  lead:
    "Une petite API REST et des webhooks sortants signés permettent à votre outil de planification, à votre comptabilité ou à un Zap de travailler avec les mêmes conversations que votre équipe. Les clés ont une portée limitée, peuvent être révoquées et ne peuvent jamais faire plus que la personne qui les a créées.",
  baseBefore: "Chemin de base",
  baseAfter: "Créez une clé dans Réglages → Clés d'API.",
  authTitle: "L'authentification et ce qu'une clé peut atteindre.",
  authBefore: "Envoyez la clé sous la forme",
  authAfter:
    "Elle n'est affichée qu'une fois, au moment de sa création; nous conservons un condensat et les douze premiers caractères, sans aucun moyen de la consulter ensuite.",
  authDetail:
    "Une clé agit comme la personne qui l'a créée, dans les limites des portées choisies. Deux conséquences sont importantes : une clé ne survit jamais à l'accès de sa créatrice ou de son créateur. Si cette personne quitte l'espace de travail, la clé cesse de fonctionner dès la requête suivante. De plus, une clé créée par une personne qui ne voit pas un numéro donné ne peut pas voir les conversations de ce numéro.",
  surfaceTitle: "Toute la surface.",
  surfaceLead:
    "Elle est courte exprès. C'est l'ensemble dont une intégration a réellement besoin, pas notre API interne munie d'une deuxième porte.",
  routeMe:
    "Indique l'espace de travail atteint par la clé et ce qu'elle peut faire. Commencez ici.",
  routeContactsGet: "La liste des clients, du plus récent au plus ancien.",
  routeContactsPost:
    "Ajoute un client. Renvoyer un client déjà transmis le met à jour au lieu de le dupliquer.",
  routeConversations: "La liste des fils de discussion.",
  routeMessagesGet: "Les messages d'un fil de discussion.",
  routeMessagesPost:
    "Envoie un texto dans un fil existant. L'en-tête Idempotency-Key est obligatoire.",
  routeTasksGet: "La liste des travaux.",
  routeTasksPost: "Transforme un message en travail.",
  routeWebhooksPost:
    "S'abonne aux événements. C'est le point REST-hook utilisé par Zapier et Make.",
  routeWebhooksDelete:
    "Se désabonne. Une clé peut seulement retirer un abonnement qu'elle a créé.",
  webhooksTitle: "Des webhooks pour éviter l'interrogation répétée.",
  webhooksBefore:
    "Donnez-nous une adresse https et nous publions dès qu'un événement survient. Chaque livraison est signée avec HMAC-SHA256 sur",
  webhooksMiddle: "envoyée sous la forme",
  webhooksAfterBeforeRetries:
    "et comprend l'identifiant de livraison pour qu'une nouvelle tentative soit reconnaissable comme le même événement. Une adresse en échec est réessayée",
  webhooksAfterRetries:
    "fois, avec des délais croissants. Une adresse qui refuse toujours est désactivée afin qu'elle ne vous coûte plus des livraisons que vous ne recevez pas.",
  promisesTitleBefore: "Ce que",
  promisesTitleAfter: "promet.",
  promisesLead:
    "Une API est une promesse. Voici la nôtre, pour que vous puissiez décider jusqu'où bâtir dessus.",
  whileExistsBefore: "Tant que",
  whileExistsAfter: "existe",
  promiseField:
    "Un champ publié ne sera ni retiré ni changé de sens. De nouveaux champs peuvent être ajoutés : analysez donc les réponses avec souplesse, car un champ inconnu n'est pas une erreur.",
  promiseRoute:
    "Une route ne sera pas retirée, et sa méthode comme son chemin ne changeront pas.",
  promiseEvent:
    "Un nom d'événement ne sera ni retiré ni réaffecté. De nouveaux noms peuvent être ajoutés; ignorez ceux que vous ne connaissez pas.",
  promiseSignature:
    "Le mécanisme de signature des webhooks ne changera pas sous v1=. Une signature v2= pourra apparaître à côté, sans empêcher un destinataire qui vérifie v1= de fonctionner.",
  promiseErrors:
    "Les codes d'erreur et leurs états HTTP ne changeront pas.",
  notPromisedTitle: "Ce que nous ne promettons pas",
  notPromisedOrder:
    "L'ordre au-delà de ce que documente une route. Les listes vont du plus récent au plus ancien; rien d'autre sur leur ordre n'est stable.",
  notPromisedRateBefore: "Les limites de débit. Aujourd'hui, une clé peut faire",
  notPromisedRateAfter: "requêtes par minute. Traitez l'état 429.",
  notPromisedTiming:
    "Le moment exact. Les webhooks sont livrés au mieux avec de nouvelles tentatives; rien n'est synchrone avec l'événement qui les déclenche.",
  notPromisedPrivate:
    "Notre API interne. Les points utilisés par l'application ne font pas partie de cette API et changent avec le produit.",
  breakingTitle: "Si nous devons un jour briser la compatibilité",
  breakingBefore:
    "Une modification incompatible exige un nouveau chemin de version :",
  breakingBeside: ", servi",
  breakingStrong: "à côté de",
  breakingAfter:
    "sans jamais le remplacer sous une intégration en marche. Chaque réponse porte déjà",
  breakingEnd:
    "de sorte que même un client qui n'épingle rien sait quelle version lui a répondu.",
  retirementBefore: "Si",
  retirementMiddle:
    "doit un jour être retirée, nous l'annonçons puis attendons",
  retirementStrong: "au moins douze mois",
  retirementAfter:
    "en écrivant après six mois puis après onze mois aux espaces de travail dont les clés l'appellent encore. Nous savons lesquels joindre puisque nous enregistrons la dernière utilisation de chaque clé. Douze mois dépassent volontairement le délai entre la fin du mandat d'une personne qui intègre un système et son retour éventuel. Une politique mesurée en semaines finit par briser l'entreprise de quelqu'un un mardi.",
};

const COPY = { en: developersEn, "fr-CA": developersFr } as const;

export function developersCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? developersEn;
}
