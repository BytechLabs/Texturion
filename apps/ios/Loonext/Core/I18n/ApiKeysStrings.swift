import Foundation

/// #243 — the words the API keys section says, in both languages.
///
/// Generated from the Android catalogue (`core/i18n/ApiKeysStrings.kt`), which
/// was itself generated from the web's. Third client, and the third time that
/// route has paid for itself: hand-carrying the sentences is what produced the
/// parity gaps this repo keeps paying for, and a crew that switches devices
/// should not meet a different product.
///
/// ## The one place this screen disagrees with its neighbour
///
/// Connections opens its form with every event ticked. This one opens with only
/// the READ scopes ticked, and the copy says so — because the same Smart
/// Default reasoning points the other way when the default is a PERMISSION. A
/// key that can write everything by default is a key nobody chose the reach of.
enum ApiKeysStrings {
    static let section = AppStrings.Section(
        name: "ApiKeysStrings",
        en: [
            "apiKeys.navApiKeys": "API keys",
            "apiKeys.navApiKeysDesc": "Let another app read or update this workspace",
            "apiKeys.title": "API keys",
            "apiKeys.intro":
                "A key lets another app work with this workspace on your behalf — read your "
                + "customers, add jobs, or send a text. You choose what each key can do, and "
                + "you can switch one off at any time.",
            "apiKeys.developerNote": "Your developer will know what to do with this.",
            "apiKeys.empty": "No keys yet.",
            "apiKeys.emptyBody":
                "Create one when an app needs access. Give each app its own, so turning one "
                + "off doesn't affect the others.",
            "apiKeys.createAction": "Create a key",
            "apiKeys.capReached":
                "You've reached the limit of {count} active keys. Switch one off to create "
                + "another.",
            "apiKeys.loadFailed": "Couldn't load your keys. Try again.",
            "apiKeys.scopesCount": "Can do {count} things",
            "apiKeys.lastUsed": "Last used {when}",
            "apiKeys.neverUsed": "Never used",
            "apiKeys.createdOn": "Created {when}",
            "apiKeys.revoked": "Switched off",
            "apiKeys.revokedOn": "Switched off {when}",
            "apiKeys.expires": "Stops working {when}",
            "apiKeys.createTitle": "Create a key",
            "apiKeys.nameLabel": "What is this key for?",
            "apiKeys.namePlaceholder": "Scheduling tool",
            "apiKeys.scopesLabel": "What should it be able to do?",
            "apiKeys.scopesHint":
                "Only reading is turned on to start with. Turn on anything else it actually "
                + "needs, and nothing it doesn't — if this key ever leaks, this list is "
                + "exactly what somebody else could do.",
            "apiKeys.needOneScope": "Pick at least one thing this key can do.",
            "apiKeys.saveAction": "Create key",
            "apiKeys.savingAction": "Creating…",
            "apiKeys.cancelAction": "Cancel",
            "apiKeys.tokenTitle": "Copy your key now",
            "apiKeys.tokenBody":
                "This is the only time we can show it to you. Paste it into the other app "
                + "before you close this. If you lose it, switch this key off and create "
                + "another — there's no way to look it up later.",
            "apiKeys.tokenCopy": "Copy",
            "apiKeys.tokenCopied": "Copied",
            "apiKeys.tokenDone": "I've saved it",
            "apiKeys.revokeAction": "Switch off",
            "apiKeys.revokeTitle": "Switch off this key?",
            "apiKeys.revokeBody":
                "Whatever is using it stops working immediately, and there is no way to "
                + "turn it back on — you'd create a new key and update the other app.",
            "apiKeys.revokeUsedWarning":
                "This key was used {when}, so something is almost certainly still relying "
                + "on it.",
            "apiKeys.revokeConfirm": "Switch it off",
            "apiKeys.keepIt": "Keep it",
            "apiKeys.scope.conversationsRead": "See conversations",
            "apiKeys.scope.messagesRead": "Read messages in a conversation",
            "apiKeys.scope.messagesSend": "Send texts to your customers",
            "apiKeys.scope.contactsRead": "See your customer list",
            "apiKeys.scope.contactsWrite": "Add and update customers",
            "apiKeys.scope.tasksRead": "See jobs",
            "apiKeys.scope.tasksWrite": "Add and update jobs",
        ],
        frCA: [
            "apiKeys.navApiKeys": "Clés API",
            "apiKeys.navApiKeysDesc":
                "Permettez à une autre application de lire ou modifier cet espace",
            "apiKeys.title": "Clés API",
            "apiKeys.intro":
                "Une clé permet à une autre application de travailler avec cet espace en "
                + "votre nom — consulter vos clients, ajouter des tâches, ou envoyer un "
                + "message. Vous choisissez ce que chaque clé peut faire, et vous pouvez en "
                + "désactiver une à tout moment.",
            "apiKeys.developerNote": "Votre développeur saura quoi en faire.",
            "apiKeys.empty": "Aucune clé pour l'instant.",
            "apiKeys.emptyBody":
                "Créez-en une quand une application a besoin d'accès. Donnez-lui la sienne, "
                + "pour qu'en désactiver une n'affecte pas les autres.",
            "apiKeys.createAction": "Créer une clé",
            "apiKeys.capReached":
                "Vous avez atteint la limite de {count} clés actives. Désactivez-en une "
                + "pour en créer une autre.",
            "apiKeys.loadFailed": "Impossible de charger vos clés. Réessayez.",
            "apiKeys.scopesCount": "Peut faire {count} choses",
            "apiKeys.lastUsed": "Dernière utilisation {when}",
            "apiKeys.neverUsed": "Jamais utilisée",
            "apiKeys.createdOn": "Créée {when}",
            "apiKeys.revoked": "Désactivée",
            "apiKeys.revokedOn": "Désactivée {when}",
            "apiKeys.expires": "Cesse de fonctionner {when}",
            "apiKeys.createTitle": "Créer une clé",
            "apiKeys.nameLabel": "À quoi sert cette clé ?",
            "apiKeys.namePlaceholder": "Outil de planification",
            "apiKeys.scopesLabel": "Qu'est-ce qu'elle devrait pouvoir faire ?",
            "apiKeys.scopesHint":
                "Seule la lecture est activée au départ. Activez ce dont elle a vraiment "
                + "besoin, et rien d'autre — si cette clé est un jour dévoilée, cette liste "
                + "est exactement ce que quelqu'un d'autre pourrait faire.",
            "apiKeys.needOneScope": "Choisissez au moins une chose que cette clé peut faire.",
            "apiKeys.saveAction": "Créer la clé",
            "apiKeys.savingAction": "Création…",
            "apiKeys.cancelAction": "Annuler",
            "apiKeys.tokenTitle": "Copiez votre clé maintenant",
            "apiKeys.tokenBody":
                "C'est la seule fois où nous pouvons vous la montrer. Collez-la dans "
                + "l'autre application avant de fermer. Si vous la perdez, désactivez cette "
                + "clé et créez-en une autre — il n'y a aucun moyen de la retrouver plus "
                + "tard.",
            "apiKeys.tokenCopy": "Copier",
            "apiKeys.tokenCopied": "Copiée",
            "apiKeys.tokenDone": "Je l'ai enregistrée",
            "apiKeys.revokeAction": "Désactiver",
            "apiKeys.revokeTitle": "Désactiver cette clé ?",
            "apiKeys.revokeBody":
                "Ce qui l'utilise cesse de fonctionner immédiatement, et il n'y a aucun "
                + "moyen de la réactiver — vous devrez créer une nouvelle clé et mettre à "
                + "jour l'autre application.",
            "apiKeys.revokeUsedWarning":
                "Cette clé a été utilisée {when}, alors quelque chose s'appuie presque "
                + "certainement encore dessus.",
            "apiKeys.revokeConfirm": "La désactiver",
            "apiKeys.keepIt": "La garder",
            "apiKeys.scope.conversationsRead": "Voir les conversations",
            "apiKeys.scope.messagesRead": "Lire les messages d'une conversation",
            "apiKeys.scope.messagesSend": "Envoyer des messages à vos clients",
            "apiKeys.scope.contactsRead": "Voir votre liste de clients",
            "apiKeys.scope.contactsWrite": "Ajouter et modifier des clients",
            "apiKeys.scope.tasksRead": "Voir les tâches",
            "apiKeys.scope.tasksWrite": "Ajouter et modifier des tâches",
        ]
    )
}
