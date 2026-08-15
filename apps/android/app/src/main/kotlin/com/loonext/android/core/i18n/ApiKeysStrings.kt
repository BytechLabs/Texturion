package com.loonext.android.core.i18n

/**
 * #243 — the words the API keys section says, in both languages.
 *
 * Generated from the web catalogue (`apps/web/src/i18n/sections/apiKeys.ts`)
 * rather than hand-carried, for the reason the webhooks section records:
 * three clients saying almost the same thing in slightly different words is
 * how a customer on two devices ends up unsure they are looking at the same
 * feature, and how a translator ends up reviewing one sentence three times.
 *
 * ## The one place this screen disagrees with its neighbour
 *
 * Connections opens its form with every event ticked. This one opens with only
 * the READ scopes ticked, and the copy says so — because the same Smart
 * Default reasoning points the other way when the default is a PERMISSION. A
 * key that can write everything by default is a key nobody chose the reach of.
 */
object ApiKeysStrings : AppStrings.Section {
    override val en = mapOf(
        "apiKeys.navApiKeys" to "API keys",
        "apiKeys.navApiKeysDesc" to "Let another app read or update this workspace",
        "apiKeys.title" to "API keys",
        "apiKeys.intro" to
            "A key lets another app work with this workspace on your behalf — read " +
            "your customers, add jobs, or send a text. You choose what each key can " +
            "do, and you can switch one off at any time.",
        "apiKeys.developerNote" to "Your developer will know what to do with this.",
        "apiKeys.empty" to "No keys yet.",
        "apiKeys.emptyBody" to
            "Create one when an app needs access. Give each app its own, so turning " +
            "one off doesn't affect the others.",
        "apiKeys.createAction" to "Create a key",
        "apiKeys.capReached" to
            "You've reached the limit of {count} active keys. Switch one off to " +
            "create another.",
        "apiKeys.loadFailed" to "Couldn't load your keys. Try again.",
        "apiKeys.scopesCount" to "Can do {count} things",
        "apiKeys.lastUsed" to "Last used {when}",
        "apiKeys.neverUsed" to "Never used",
        "apiKeys.createdOn" to "Created {when}",
        "apiKeys.revoked" to "Switched off",
        "apiKeys.revokedOn" to "Switched off {when}",
        "apiKeys.expires" to "Stops working {when}",
        "apiKeys.createTitle" to "Create a key",
        "apiKeys.nameLabel" to "What is this key for?",
        "apiKeys.namePlaceholder" to "Scheduling tool",
        "apiKeys.scopesLabel" to "What should it be able to do?",
        "apiKeys.scopesHint" to
            "Only reading is turned on to start with. Turn on anything else it " +
            "actually needs, and nothing it doesn't — if this key ever leaks, this " +
            "list is exactly what somebody else could do.",
        "apiKeys.needOneScope" to "Pick at least one thing this key can do.",
        "apiKeys.saveAction" to "Create key",
        "apiKeys.savingAction" to "Creating…",
        "apiKeys.cancelAction" to "Cancel",
        "apiKeys.tokenTitle" to "Copy your key now",
        "apiKeys.tokenBody" to
            "This is the only time we can show it to you. Paste it into the other " +
            "app before you close this. If you lose it, switch this key off and " +
            "create another — there's no way to look it up later.",
        "apiKeys.tokenCopy" to "Copy",
        "apiKeys.tokenCopied" to "Copied",
        "apiKeys.tokenDone" to "I've saved it",
        "apiKeys.revokeAction" to "Switch off",
        "apiKeys.revokeTitle" to "Switch off this key?",
        "apiKeys.revokeBody" to
            "Whatever is using it stops working immediately, and there is no way to " +
            "turn it back on — you'd create a new key and update the other app.",
        "apiKeys.revokeUsedWarning" to
            "This key was used {when}, so something is almost certainly still " +
            "relying on it.",
        "apiKeys.revokeConfirm" to "Switch it off",
        "apiKeys.keepIt" to "Keep it",
        "apiKeys.scope.conversationsRead" to "See conversations",
        "apiKeys.scope.messagesRead" to "Read messages in a conversation",
        "apiKeys.scope.messagesSend" to "Send texts to your customers",
        "apiKeys.scope.contactsRead" to "See your customer list",
        "apiKeys.scope.contactsWrite" to "Add and update customers",
        "apiKeys.scope.tasksRead" to "See jobs",
        "apiKeys.scope.tasksWrite" to "Add and update jobs",
    )

    override val frCA = mapOf(
        "apiKeys.navApiKeys" to "Clés API",
        "apiKeys.navApiKeysDesc" to
            "Permettez à une autre application de lire ou modifier cet espace",
        "apiKeys.title" to "Clés API",
        "apiKeys.intro" to
            "Une clé permet à une autre application de travailler avec cet espace " +
            "en votre nom — consulter vos clients, ajouter des tâches, ou envoyer " +
            "un message. Vous choisissez ce que chaque clé peut faire, et vous " +
            "pouvez en désactiver une à tout moment.",
        "apiKeys.developerNote" to "Votre développeur saura quoi en faire.",
        "apiKeys.empty" to "Aucune clé pour l'instant.",
        "apiKeys.emptyBody" to
            "Créez-en une quand une application a besoin d'accès. Donnez-lui la " +
            "sienne, pour qu'en désactiver une n'affecte pas les autres.",
        "apiKeys.createAction" to "Créer une clé",
        "apiKeys.capReached" to
            "Vous avez atteint la limite de {count} clés actives. Désactivez-en une " +
            "pour en créer une autre.",
        "apiKeys.loadFailed" to "Impossible de charger vos clés. Réessayez.",
        "apiKeys.scopesCount" to "Peut faire {count} choses",
        "apiKeys.lastUsed" to "Dernière utilisation {when}",
        "apiKeys.neverUsed" to "Jamais utilisée",
        "apiKeys.createdOn" to "Créée {when}",
        "apiKeys.revoked" to "Désactivée",
        "apiKeys.revokedOn" to "Désactivée {when}",
        "apiKeys.expires" to "Cesse de fonctionner {when}",
        "apiKeys.createTitle" to "Créer une clé",
        "apiKeys.nameLabel" to "À quoi sert cette clé ?",
        "apiKeys.namePlaceholder" to "Outil de planification",
        "apiKeys.scopesLabel" to "Qu'est-ce qu'elle devrait pouvoir faire ?",
        "apiKeys.scopesHint" to
            "Seule la lecture est activée au départ. Activez ce dont elle a " +
            "vraiment besoin, et rien d'autre — si cette clé est un jour dévoilée, " +
            "cette liste est exactement ce que quelqu'un d'autre pourrait faire.",
        "apiKeys.needOneScope" to "Choisissez au moins une chose que cette clé peut faire.",
        "apiKeys.saveAction" to "Créer la clé",
        "apiKeys.savingAction" to "Création…",
        "apiKeys.cancelAction" to "Annuler",
        "apiKeys.tokenTitle" to "Copiez votre clé maintenant",
        "apiKeys.tokenBody" to
            "C'est la seule fois où nous pouvons vous la montrer. Collez-la dans " +
            "l'autre application avant de fermer. Si vous la perdez, désactivez " +
            "cette clé et créez-en une autre — il n'y a aucun moyen de la retrouver " +
            "plus tard.",
        "apiKeys.tokenCopy" to "Copier",
        "apiKeys.tokenCopied" to "Copiée",
        "apiKeys.tokenDone" to "Je l'ai enregistrée",
        "apiKeys.revokeAction" to "Désactiver",
        "apiKeys.revokeTitle" to "Désactiver cette clé ?",
        "apiKeys.revokeBody" to
            "Ce qui l'utilise cesse de fonctionner immédiatement, et il n'y a aucun " +
            "moyen de la réactiver — vous devrez créer une nouvelle clé et mettre à " +
            "jour l'autre application.",
        "apiKeys.revokeUsedWarning" to
            "Cette clé a été utilisée {when}, alors quelque chose s'appuie presque " +
            "certainement encore dessus.",
        "apiKeys.revokeConfirm" to "La désactiver",
        "apiKeys.keepIt" to "La garder",
        "apiKeys.scope.conversationsRead" to "Voir les conversations",
        "apiKeys.scope.messagesRead" to "Lire les messages d'une conversation",
        "apiKeys.scope.messagesSend" to "Envoyer des messages à vos clients",
        "apiKeys.scope.contactsRead" to "Voir votre liste de clients",
        "apiKeys.scope.contactsWrite" to "Ajouter et modifier des clients",
        "apiKeys.scope.tasksRead" to "Voir les tâches",
        "apiKeys.scope.tasksWrite" to "Ajouter et modifier des tâches",
    )
}
