/**
 * #243 — the words the webhooks section says, in both languages.
 *
 * Its own file rather than another block in `settingsMore`, for the reason
 * that file's own header gives: one file per surface, so a translator working
 * through a screen sees its strings adjacent rather than sorted by concept.
 *
 * `fr` is typed as `en`'s exact shape, so a key added to one and forgotten in
 * the other fails `tsc` rather than surfacing as its own name to a French
 * reader.
 *
 * A note on register. This screen has two readers — the owner who was told to
 * "connect it to the scheduling app", and the integrator they hired — and the
 * copy is written for the first. So it says "your other apps" rather than
 * "consumers", "address" rather than "URL" where it can, and it explains the
 * signing secret as what it is for rather than what it is.
 */
import type { Translated } from "../translated";

export const webhooksEn = {
  navWebhooks: "Connections",
  navWebhooksDesc: "Send what happens here to your other apps",

  title: "Connections",
  intro:
    "Send what happens in this workspace to your other apps — a scheduling " +
    "tool, an accounting package, or anything that can accept a web address. " +
    "We post the details the moment they happen.",
  developerNote: "Setting this up usually takes a developer a few minutes.",

  /* The list */
  empty: "Nothing is connected yet.",
  emptyBody:
    "Add an address and we'll start sending events to it. You can test it " +
    "before anything real goes out.",
  addAction: "Add a connection",
  capReached:
    "You've reached the limit of {count} connections. Remove one to add another.",
  loadFailed: "Couldn't load your connections. Try again.",

  /* One endpoint */
  eventsCount: "{count} events",
  statusHealthy: "Working",
  statusNeverUsed: "Not used yet",
  statusFailing: "Failing",
  statusPaused: "Paused by you",
  statusStopped: "We stopped sending",
  lastSuccess: "Last delivered {when}",
  lastFailure: "Last failed {when}",
  failingBody:
    "The last {count} attempts were refused. We're still trying, with " +
    "longer gaps between each one.",
  stoppedBody:
    "This address refused too many deliveries in a row, so we stopped " +
    "sending to it. Everything since then has been missed. Fix the address " +
    "and turn it back on to start receiving again.",
  resumeAction: "Turn back on",
  pauseAction: "Pause",

  /* Add / edit */
  addTitle: "Add a connection",
  editTitle: "Edit connection",
  urlLabel: "Where should we send it?",
  urlHint: "Must start with https://",
  nameLabel: "What is this? (optional)",
  namePlaceholder: "Scheduling tool",
  eventsLabel: "What should we send?",
  eventsHint: "All of them, unless you know you want fewer.",
  saveAction: "Save",
  cancelAction: "Cancel",
  savingAction: "Saving…",
  needOneEvent: "Pick at least one thing to send.",

  /* The one-time secret */
  secretTitle: "Copy your signing key now",
  secretBody:
    "This is how your app checks that a delivery really came from us. We " +
    "cannot show it to you again — if you lose it, you can create a new one, " +
    "which stops the old one working.",
  secretCopy: "Copy",
  secretCopied: "Copied",
  secretDone: "I've saved it",

  /* Test */
  testAction: "Send a test",
  testSending: "Sending…",
  testOk: "Your app answered. This connection works.",
  testRefused: "Your app answered {status}. It's reachable, but it refused this.",
  testUnreachable: "We couldn't reach that address at all.",
  testTimeout: "That address took too long to answer.",

  /* Rotate */
  rotateAction: "Create a new signing key",
  rotateTitle: "Create a new signing key?",
  rotateBody:
    "The current key stops working immediately, and deliveries will be " +
    "refused until your app is updated with the new one.",
  rotateConfirm: "Create a new key",

  /* Delete */
  deleteAction: "Remove",
  deleteTitle: "Remove this connection?",
  deleteBody:
    "We'll stop sending to {url}. Anything that app does with these events " +
    "will stop happening.",
  deleteConfirm: "Remove it",
  keepIt: "Keep it",

  /* Deliveries */
  deliveriesAction: "Recent deliveries",
  deliveriesTitle: "Recent deliveries",
  deliveriesEmpty: "Nothing has been sent to this address yet.",
  deliveryPending: "Waiting to retry",
  deliverySucceeded: "Delivered",
  deliveryFailed: "Gave up",
  deliveryDelivering: "Sending",
  deliveryAttempts: "{count} attempts",

  /* Event names */
  "event.messageReceived": "A customer texts you",
  "event.messageSent": "You text a customer",
  "event.messageFailed": "A text doesn't go through",
  "event.callCompleted": "A call ends",
  "event.voicemailReceived": "Somebody leaves a voicemail",
  "event.taskCreated": "A job is added",
  "event.taskCompleted": "A job is finished",
  "event.contactCreated": "A new customer is added",

  /* Why an address was refused */
  "urlError.notAUrl": "That doesn't look like a web address.",
  "urlError.notHttps": "The address has to start with https:// — http isn't secure enough to send your customers' messages over.",
  "urlError.privateHost": "That address is inside a private network, so we can't reach it from the internet.",
  "urlError.loopbackHost": "That address points back at the machine making the request, so nothing would receive it.",
  "urlError.ourOwnHost": "That address points back at us.",
  "urlError.hasCredentials": "Take the username and password out of the address — the signing key is how we prove it's us.",
  "urlError.tooLong": "That address is too long.",

  /* Why we stopped */
  "disabled.tooManyFailures": "Too many failed deliveries in a row",
} as const;

export const webhooksFr: Translated<typeof webhooksEn> = {
  navWebhooks: "Connexions",
  navWebhooksDesc: "Envoyez ce qui se passe ici à vos autres applications",

  title: "Connexions",
  intro:
    "Envoyez ce qui se passe dans cet espace de travail à vos autres " +
    "applications — un outil de planification, un logiciel comptable, ou " +
    "tout ce qui peut recevoir une adresse web. Nous transmettons les " +
    "détails dès que ça arrive.",
  developerNote:
    "La configuration prend habituellement quelques minutes à un développeur.",

  empty: "Rien n'est connecté pour l'instant.",
  emptyBody:
    "Ajoutez une adresse et nous commencerons à y envoyer les événements. " +
    "Vous pouvez faire un test avant que quoi que ce soit de réel ne parte.",
  addAction: "Ajouter une connexion",
  capReached:
    "Vous avez atteint la limite de {count} connexions. Retirez-en une pour " +
    "en ajouter une autre.",
  loadFailed: "Impossible de charger vos connexions. Réessayez.",

  eventsCount: "{count} événements",
  statusHealthy: "Fonctionne",
  statusNeverUsed: "Pas encore utilisée",
  statusFailing: "En échec",
  statusPaused: "Mise en pause par vous",
  statusStopped: "Nous avons arrêté d'envoyer",
  lastSuccess: "Dernière livraison {when}",
  lastFailure: "Dernier échec {when}",
  failingBody:
    "Les {count} dernières tentatives ont été refusées. Nous continuons " +
    "d'essayer, avec des intervalles plus longs entre chacune.",
  stoppedBody:
    "Cette adresse a refusé trop de livraisons d'affilée, alors nous avons " +
    "arrêté d'y envoyer. Tout ce qui a suivi a été manqué. Corrigez " +
    "l'adresse et réactivez-la pour recommencer à recevoir.",
  resumeAction: "Réactiver",
  pauseAction: "Mettre en pause",

  addTitle: "Ajouter une connexion",
  editTitle: "Modifier la connexion",
  urlLabel: "Où devons-nous l'envoyer ?",
  urlHint: "Doit commencer par https://",
  nameLabel: "De quoi s'agit-il ? (facultatif)",
  namePlaceholder: "Outil de planification",
  eventsLabel: "Qu'est-ce qu'on envoie ?",
  eventsHint: "Tout, sauf si vous savez que vous en voulez moins.",
  saveAction: "Enregistrer",
  cancelAction: "Annuler",
  savingAction: "Enregistrement…",
  needOneEvent: "Choisissez au moins un élément à envoyer.",

  secretTitle: "Copiez votre clé de signature maintenant",
  secretBody:
    "C'est ainsi que votre application vérifie qu'une livraison vient bien " +
    "de nous. Nous ne pourrons plus vous la montrer — si vous la perdez, " +
    "vous pouvez en créer une nouvelle, ce qui rend l'ancienne inutilisable.",
  secretCopy: "Copier",
  secretCopied: "Copiée",
  secretDone: "Je l'ai enregistrée",

  testAction: "Envoyer un test",
  testSending: "Envoi…",
  testOk: "Votre application a répondu. Cette connexion fonctionne.",
  testRefused:
    "Votre application a répondu {status}. Elle est joignable, mais elle a " +
    "refusé ceci.",
  testUnreachable: "Nous n'avons pas pu joindre cette adresse du tout.",
  testTimeout: "Cette adresse a mis trop de temps à répondre.",

  rotateAction: "Créer une nouvelle clé de signature",
  rotateTitle: "Créer une nouvelle clé de signature ?",
  rotateBody:
    "La clé actuelle cesse de fonctionner immédiatement, et les livraisons " +
    "seront refusées tant que votre application n'aura pas la nouvelle.",
  rotateConfirm: "Créer une nouvelle clé",

  deleteAction: "Retirer",
  deleteTitle: "Retirer cette connexion ?",
  deleteBody:
    "Nous cesserons d'envoyer à {url}. Tout ce que cette application fait " +
    "avec ces événements cessera de se produire.",
  deleteConfirm: "La retirer",
  keepIt: "La garder",

  deliveriesAction: "Livraisons récentes",
  deliveriesTitle: "Livraisons récentes",
  deliveriesEmpty: "Rien n'a encore été envoyé à cette adresse.",
  deliveryPending: "En attente de reprise",
  deliverySucceeded: "Livré",
  deliveryFailed: "Abandonné",
  deliveryDelivering: "Envoi en cours",
  deliveryAttempts: "{count} tentatives",

  "event.messageReceived": "Un client vous écrit",
  "event.messageSent": "Vous écrivez à un client",
  "event.messageFailed": "Un message ne passe pas",
  "event.callCompleted": "Un appel se termine",
  "event.voicemailReceived": "Quelqu'un laisse un message vocal",
  "event.taskCreated": "Une tâche est ajoutée",
  "event.taskCompleted": "Une tâche est terminée",
  "event.contactCreated": "Un nouveau client est ajouté",

  "urlError.notAUrl": "Ça ne ressemble pas à une adresse web.",
  "urlError.notHttps":
    "L'adresse doit commencer par https:// — http n'est pas assez sécuritaire " +
    "pour transmettre les messages de vos clients.",
  "urlError.privateHost":
    "Cette adresse se trouve dans un réseau privé, alors nous ne pouvons pas " +
    "la joindre depuis Internet.",
  "urlError.loopbackHost":
    "Cette adresse pointe vers la machine qui fait la demande, alors " +
    "personne ne recevrait rien.",
  "urlError.ourOwnHost": "Cette adresse pointe vers nous.",
  "urlError.hasCredentials":
    "Retirez le nom d'utilisateur et le mot de passe de l'adresse — la clé " +
    "de signature est ce qui prouve que c'est bien nous.",
  "urlError.tooLong": "Cette adresse est trop longue.",

  "disabled.tooManyFailures": "Trop de livraisons échouées d'affilée",
};
