/**
 * #243 — the words the API keys section says, in both languages.
 *
 * ## The one place this screen deliberately disagrees with its neighbour
 *
 * Connections opens its form with every event ticked, because subscribing to
 * nothing is a mistake and eight empty boxes is where somebody gives up. This
 * screen opens with only the READ scopes ticked, and the copy says so out loud
 * — because the same Smart Default reasoning points the other way when the
 * default is a permission. A key that can write everything by default is a
 * key nobody chose the reach of.
 *
 * The reads are still a default rather than an empty form: reporting and
 * syncing are what a first integration does, and somebody who needs writing
 * knows they do.
 *
 * ## Register
 *
 * Written for the owner who was told to "get an API key", not the developer
 * they hired. So: "key", "what it can do", "last used" — and the token is
 * explained by what happens if it leaks rather than by what it is.
 */
import type { Translated } from "../translated";

export const apiKeysEn = {
  navApiKeys: "API keys",
  navApiKeysDesc: "Let another app read or update this workspace",

  title: "API keys",
  intro:
    "A key lets another app work with this workspace on your behalf — read " +
    "your customers, add jobs, or send a text. You choose what each key can " +
    "do, and you can switch one off at any time.",
  developerNote: "Your developer will know what to do with this.",

  /* The list */
  empty: "No keys yet.",
  emptyBody:
    "Create one when an app needs access. Give each app its own, so turning " +
    "one off doesn't affect the others.",
  createAction: "Create a key",
  capReached:
    "You've reached the limit of {count} active keys. Switch one off to " +
    "create another.",
  loadFailed: "Couldn't load your keys. Try again.",

  /* One key */
  scopesCount: "Can do {count} things",
  lastUsed: "Last used {when}",
  neverUsed: "Never used",
  createdOn: "Created {when}",
  revoked: "Switched off",
  revokedOn: "Switched off {when}",
  expires: "Stops working {when}",

  /* Create */
  createTitle: "Create a key",
  nameLabel: "What is this key for?",
  namePlaceholder: "Scheduling tool",
  scopesLabel: "What should it be able to do?",
  scopesHint:
    "Only reading is turned on to start with. Turn on anything else it " +
    "actually needs, and nothing it doesn't — if this key ever leaks, this " +
    "list is exactly what somebody else could do.",
  needOneScope: "Pick at least one thing this key can do.",
  saveAction: "Create key",
  savingAction: "Creating…",
  cancelAction: "Cancel",

  /* The one-time token */
  tokenTitle: "Copy your key now",
  tokenBody:
    "This is the only time we can show it to you. Paste it into the other " +
    "app before you close this. If you lose it, switch this key off and " +
    "create another — there's no way to look it up later.",
  tokenCopy: "Copy",
  tokenCopied: "Copied",
  tokenDone: "I've saved it",

  /* Revoke */
  revokeAction: "Switch off",
  revokeTitle: "Switch off this key?",
  revokeBody:
    "Whatever is using it stops working immediately, and there is no way to " +
    "turn it back on — you'd create a new key and update the other app.",
  revokeUsedWarning:
    "This key was used {when}, so something is almost certainly still relying " +
    "on it.",
  revokeConfirm: "Switch it off",
  keepIt: "Keep it",

  /* Scope names, said as what the key can do */
  "scope.conversationsRead": "See conversations",
  "scope.messagesRead": "Read messages in a conversation",
  "scope.messagesSend": "Send texts to your customers",
  "scope.contactsRead": "See your customer list",
  "scope.contactsWrite": "Add and update customers",
  "scope.tasksRead": "See jobs",
  "scope.tasksWrite": "Add and update jobs",
} as const;

export const apiKeysFr: Translated<typeof apiKeysEn> = {
  navApiKeys: "Clés API",
  navApiKeysDesc: "Permettez à une autre application de lire ou modifier cet espace",

  title: "Clés API",
  intro:
    "Une clé permet à une autre application de travailler avec cet espace en " +
    "votre nom — consulter vos clients, ajouter des tâches, ou envoyer un " +
    "message. Vous choisissez ce que chaque clé peut faire, et vous pouvez " +
    "en désactiver une à tout moment.",
  developerNote: "Votre développeur saura quoi en faire.",

  empty: "Aucune clé pour l'instant.",
  emptyBody:
    "Créez-en une quand une application a besoin d'accès. Donnez-lui la " +
    "sienne, pour qu'en désactiver une n'affecte pas les autres.",
  createAction: "Créer une clé",
  capReached:
    "Vous avez atteint la limite de {count} clés actives. Désactivez-en une " +
    "pour en créer une autre.",
  loadFailed: "Impossible de charger vos clés. Réessayez.",

  scopesCount: "Peut faire {count} choses",
  lastUsed: "Dernière utilisation {when}",
  neverUsed: "Jamais utilisée",
  createdOn: "Créée {when}",
  revoked: "Désactivée",
  revokedOn: "Désactivée {when}",
  expires: "Cesse de fonctionner {when}",

  createTitle: "Créer une clé",
  nameLabel: "À quoi sert cette clé ?",
  namePlaceholder: "Outil de planification",
  scopesLabel: "Qu'est-ce qu'elle devrait pouvoir faire ?",
  scopesHint:
    "Seule la lecture est activée au départ. Activez ce dont elle a vraiment " +
    "besoin, et rien d'autre — si cette clé est un jour dévoilée, cette liste " +
    "est exactement ce que quelqu'un d'autre pourrait faire.",
  needOneScope: "Choisissez au moins une chose que cette clé peut faire.",
  saveAction: "Créer la clé",
  savingAction: "Création…",
  cancelAction: "Annuler",

  tokenTitle: "Copiez votre clé maintenant",
  tokenBody:
    "C'est la seule fois où nous pouvons vous la montrer. Collez-la dans " +
    "l'autre application avant de fermer. Si vous la perdez, désactivez cette " +
    "clé et créez-en une autre — il n'y a aucun moyen de la retrouver plus " +
    "tard.",
  tokenCopy: "Copier",
  tokenCopied: "Copiée",
  tokenDone: "Je l'ai enregistrée",

  revokeAction: "Désactiver",
  revokeTitle: "Désactiver cette clé ?",
  revokeBody:
    "Ce qui l'utilise cesse de fonctionner immédiatement, et il n'y a aucun " +
    "moyen de la réactiver — vous devrez créer une nouvelle clé et mettre à " +
    "jour l'autre application.",
  revokeUsedWarning:
    "Cette clé a été utilisée {when}, alors quelque chose s'appuie presque " +
    "certainement encore dessus.",
  revokeConfirm: "La désactiver",
  keepIt: "La garder",

  "scope.conversationsRead": "Voir les conversations",
  "scope.messagesRead": "Lire les messages d'une conversation",
  "scope.messagesSend": "Envoyer des messages à vos clients",
  "scope.contactsRead": "Voir votre liste de clients",
  "scope.contactsWrite": "Ajouter et modifier des clients",
  "scope.tasksRead": "Voir les tâches",
  "scope.tasksWrite": "Ajouter et modifier des tâches",
};
