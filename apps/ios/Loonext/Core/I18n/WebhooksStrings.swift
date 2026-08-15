import Foundation

/// #243 — the words the Connections section says, in both languages.
///
/// Derived mechanically from the Android catalogue
/// (`core/i18n/WebhooksStrings.kt`) rather than hand-ported, and its English is
/// character-for-character the web's. Hand-carrying 130 sentences to a third
/// client is exactly the shape that produced the parity gaps this repo keeps
/// paying for — a crew that switches devices should not meet a different
/// product, and a translator should not review one sentence three times.
///
/// Two things about this surface in particular:
///
/// - **It is written for the owner, not the integrator.** Both open it, but
///   only one of them gives up. So: "your other apps", "address", and the
///   signing key explained by what it is FOR rather than what it is.
/// - **The event names are sentences, not identifiers.** `message.received` is
///   the wire name and appears nowhere a person reads; what they see is "A
///   customer texts you".
enum WebhooksStrings {
    static let section = AppStrings.Section(
        name: "WebhooksStrings",
        en: [
            "webhooks.navWebhooks": "Connections",
            "webhooks.navWebhooksDesc": "Send what happens here to your other apps",
            "webhooks.title": "Connections",
            "webhooks.intro":
                "Send what happens in this workspace to your other apps — a scheduling "
                + "tool, an accounting package, or anything that can accept a web address. We "
                + "post the details the moment they happen.",
            "webhooks.developerNote":
                "Setting this up usually takes a developer a few minutes.",
            "webhooks.empty": "Nothing is connected yet.",
            "webhooks.emptyBody":
                "Add an address and we'll start sending events to it. You can test it "
                + "before anything real goes out.",
            "webhooks.addAction": "Add a connection",
            "webhooks.capReached":
                "You've reached the limit of {count} connections. Remove one to add "
                + "another.",
            "webhooks.loadFailed": "Couldn't load your connections. Try again.",
            "webhooks.eventsCount": "{count} events",
            "webhooks.statusHealthy": "Working",
            "webhooks.statusNeverUsed": "Not used yet",
            "webhooks.statusFailing": "Failing",
            "webhooks.statusPaused": "Paused by you",
            "webhooks.statusStopped": "We stopped sending",
            "webhooks.lastSuccess": "Last delivered {when}",
            "webhooks.lastFailure": "Last failed {when}",
            "webhooks.failingBody":
                "The last {count} attempts were refused. We're still trying, with longer "
                + "gaps between each one.",
            "webhooks.stoppedBody":
                "This address refused too many deliveries in a row, so we stopped sending "
                + "to it. Everything since then has been missed. Fix the address and turn it "
                + "back on to start receiving again.",
            "webhooks.resumeAction": "Turn back on",
            "webhooks.pauseAction": "Pause",
            "webhooks.addTitle": "Add a connection",
            "webhooks.editTitle": "Edit connection",
            "webhooks.urlLabel": "Where should we send it?",
            "webhooks.urlHint": "Must start with https://",
            "webhooks.nameLabel": "What is this? (optional)",
            "webhooks.namePlaceholder": "Scheduling tool",
            "webhooks.eventsLabel": "What should we send?",
            "webhooks.eventsHint": "All of them, unless you know you want fewer.",
            "webhooks.saveAction": "Save",
            "webhooks.cancelAction": "Cancel",
            "webhooks.savingAction": "Saving…",
            "webhooks.needOneEvent": "Pick at least one thing to send.",
            "webhooks.secretTitle": "Copy your signing key now",
            "webhooks.secretBody":
                "This is how your app checks that a delivery really came from us. We cannot "
                + "show it to you again — if you lose it, you can create a new one, which "
                + "stops the old one working.",
            "webhooks.secretCopy": "Copy",
            "webhooks.secretCopied": "Copied",
            "webhooks.secretDone": "I've saved it",
            "webhooks.testAction": "Send a test",
            "webhooks.testSending": "Sending…",
            "webhooks.testOk": "Your app answered. This connection works.",
            "webhooks.testRefused":
                "Your app answered {status}. It's reachable, but it refused this.",
            "webhooks.testUnreachable": "We couldn't reach that address at all.",
            "webhooks.testTimeout": "That address took too long to answer.",
            "webhooks.rotateAction": "Create a new signing key",
            "webhooks.rotateTitle": "Create a new signing key?",
            "webhooks.rotateBody":
                "The current key stops working immediately, and deliveries will be refused "
                + "until your app is updated with the new one.",
            "webhooks.rotateConfirm": "Create a new key",
            "webhooks.deleteAction": "Remove",
            "webhooks.deleteTitle": "Remove this connection?",
            "webhooks.deleteBody":
                "We'll stop sending to {url}. Anything that app does with these events will "
                + "stop happening.",
            "webhooks.deleteConfirm": "Remove it",
            "webhooks.keepIt": "Keep it",
            "webhooks.deliveriesAction": "Recent deliveries",
            "webhooks.deliveriesTitle": "Recent deliveries",
            "webhooks.deliveriesEmpty": "Nothing has been sent to this address yet.",
            "webhooks.deliveryPending": "Waiting to retry",
            "webhooks.deliverySucceeded": "Delivered",
            "webhooks.deliveryFailed": "Gave up",
            "webhooks.deliveryDelivering": "Sending",
            "webhooks.deliveryAttempts": "{count} attempts",
            "webhooks.event.messageReceived": "A customer texts you",
            "webhooks.event.messageSent": "You text a customer",
            "webhooks.event.messageFailed": "A text doesn't go through",
            "webhooks.event.callCompleted": "A call ends",
            "webhooks.event.voicemailReceived": "Somebody leaves a voicemail",
            "webhooks.event.taskCreated": "A job is added",
            "webhooks.event.taskCompleted": "A job is finished",
            "webhooks.event.contactCreated": "A new customer is added",
            "webhooks.urlError.notAUrl": "That doesn't look like a web address.",
            "webhooks.urlError.notHttps":
                "The address has to start with https:// — http isn't secure enough to send "
                + "your customers' messages over.",
            "webhooks.urlError.privateHost":
                "That address is inside a private network, so we can't reach it from the "
                + "internet.",
            "webhooks.urlError.loopbackHost":
                "That address points back at the machine making the request, so nothing "
                + "would receive it.",
            "webhooks.urlError.ourOwnHost": "That address points back at us.",
            "webhooks.urlError.hasCredentials":
                "Take the username and password out of the address — the signing key is how "
                + "we prove it's us.",
            "webhooks.urlError.tooLong": "That address is too long.",
            "webhooks.disabled.tooManyFailures": "Too many failed deliveries in a row",
        ],
        frCA: [
            "webhooks.navWebhooks": "Connexions",
            "webhooks.navWebhooksDesc": "Envoyez ce qui se passe ici à vos autres applications",
            "webhooks.title": "Connexions",
            "webhooks.intro":
                "Envoyez ce qui se passe dans cet espace de travail à vos autres "
                + "applications — un outil de planification, un logiciel comptable, ou tout "
                + "ce qui peut recevoir une adresse web. Nous transmettons les détails dès "
                + "que ça arrive.",
            "webhooks.developerNote":
                "La configuration prend habituellement quelques minutes à un développeur.",
            "webhooks.empty": "Rien n'est connecté pour l'instant.",
            "webhooks.emptyBody":
                "Ajoutez une adresse et nous commencerons à y envoyer les événements. Vous "
                + "pouvez faire un test avant que quoi que ce soit de réel ne parte.",
            "webhooks.addAction": "Ajouter une connexion",
            "webhooks.capReached":
                "Vous avez atteint la limite de {count} connexions. Retirez-en une pour en "
                + "ajouter une autre.",
            "webhooks.loadFailed": "Impossible de charger vos connexions. Réessayez.",
            "webhooks.eventsCount": "{count} événements",
            "webhooks.statusHealthy": "Fonctionne",
            "webhooks.statusNeverUsed": "Pas encore utilisée",
            "webhooks.statusFailing": "En échec",
            "webhooks.statusPaused": "Mise en pause par vous",
            "webhooks.statusStopped": "Nous avons arrêté d'envoyer",
            "webhooks.lastSuccess": "Dernière livraison {when}",
            "webhooks.lastFailure": "Dernier échec {when}",
            "webhooks.failingBody":
                "Les {count} dernières tentatives ont été refusées. Nous continuons "
                + "d'essayer, avec des intervalles plus longs entre chacune.",
            "webhooks.stoppedBody":
                "Cette adresse a refusé trop de livraisons d'affilée, alors nous avons "
                + "arrêté d'y envoyer. Tout ce qui a suivi a été manqué. Corrigez l'adresse "
                + "et réactivez-la pour recommencer à recevoir.",
            "webhooks.resumeAction": "Réactiver",
            "webhooks.pauseAction": "Mettre en pause",
            "webhooks.addTitle": "Ajouter une connexion",
            "webhooks.editTitle": "Modifier la connexion",
            "webhooks.urlLabel": "Où devons-nous l'envoyer ?",
            "webhooks.urlHint": "Doit commencer par https://",
            "webhooks.nameLabel": "De quoi s'agit-il ? (facultatif)",
            "webhooks.namePlaceholder": "Outil de planification",
            "webhooks.eventsLabel": "Qu'est-ce qu'on envoie ?",
            "webhooks.eventsHint": "Tout, sauf si vous savez que vous en voulez moins.",
            "webhooks.saveAction": "Enregistrer",
            "webhooks.cancelAction": "Annuler",
            "webhooks.savingAction": "Enregistrement…",
            "webhooks.needOneEvent": "Choisissez au moins un élément à envoyer.",
            "webhooks.secretTitle": "Copiez votre clé de signature maintenant",
            "webhooks.secretBody":
                "C'est ainsi que votre application vérifie qu'une livraison vient bien de "
                + "nous. Nous ne pourrons plus vous la montrer — si vous la perdez, vous "
                + "pouvez en créer une nouvelle, ce qui rend l'ancienne inutilisable.",
            "webhooks.secretCopy": "Copier",
            "webhooks.secretCopied": "Copiée",
            "webhooks.secretDone": "Je l'ai enregistrée",
            "webhooks.testAction": "Envoyer un test",
            "webhooks.testSending": "Envoi…",
            "webhooks.testOk": "Votre application a répondu. Cette connexion fonctionne.",
            "webhooks.testRefused":
                "Votre application a répondu {status}. Elle est joignable, mais elle a "
                + "refusé ceci.",
            "webhooks.testUnreachable": "Nous n'avons pas pu joindre cette adresse du tout.",
            "webhooks.testTimeout": "Cette adresse a mis trop de temps à répondre.",
            "webhooks.rotateAction": "Créer une nouvelle clé de signature",
            "webhooks.rotateTitle": "Créer une nouvelle clé de signature ?",
            "webhooks.rotateBody":
                "La clé actuelle cesse de fonctionner immédiatement, et les livraisons "
                + "seront refusées tant que votre application n'aura pas la nouvelle.",
            "webhooks.rotateConfirm": "Créer une nouvelle clé",
            "webhooks.deleteAction": "Retirer",
            "webhooks.deleteTitle": "Retirer cette connexion ?",
            "webhooks.deleteBody":
                "Nous cesserons d'envoyer à {url}. Tout ce que cette application fait avec "
                + "ces événements cessera de se produire.",
            "webhooks.deleteConfirm": "La retirer",
            "webhooks.keepIt": "La garder",
            "webhooks.deliveriesAction": "Livraisons récentes",
            "webhooks.deliveriesTitle": "Livraisons récentes",
            "webhooks.deliveriesEmpty": "Rien n'a encore été envoyé à cette adresse.",
            "webhooks.deliveryPending": "En attente de reprise",
            "webhooks.deliverySucceeded": "Livré",
            "webhooks.deliveryFailed": "Abandonné",
            "webhooks.deliveryDelivering": "Envoi en cours",
            "webhooks.deliveryAttempts": "{count} tentatives",
            "webhooks.event.messageReceived": "Un client vous écrit",
            "webhooks.event.messageSent": "Vous écrivez à un client",
            "webhooks.event.messageFailed": "Un message ne passe pas",
            "webhooks.event.callCompleted": "Un appel se termine",
            "webhooks.event.voicemailReceived": "Quelqu'un laisse un message vocal",
            "webhooks.event.taskCreated": "Une tâche est ajoutée",
            "webhooks.event.taskCompleted": "Une tâche est terminée",
            "webhooks.event.contactCreated": "Un nouveau client est ajouté",
            "webhooks.urlError.notAUrl": "Ça ne ressemble pas à une adresse web.",
            "webhooks.urlError.notHttps":
                "L'adresse doit commencer par https:// — http n'est pas assez sécuritaire "
                + "pour transmettre les messages de vos clients.",
            "webhooks.urlError.privateHost":
                "Cette adresse se trouve dans un réseau privé, alors nous ne pouvons pas la "
                + "joindre depuis Internet.",
            "webhooks.urlError.loopbackHost":
                "Cette adresse pointe vers la machine qui fait la demande, alors personne "
                + "ne recevrait rien.",
            "webhooks.urlError.ourOwnHost": "Cette adresse pointe vers nous.",
            "webhooks.urlError.hasCredentials":
                "Retirez le nom d'utilisateur et le mot de passe de l'adresse — la clé de "
                + "signature est ce qui prouve que c'est bien nous.",
            "webhooks.urlError.tooLong": "Cette adresse est trop longue.",
            "webhooks.disabled.tooManyFailures": "Trop de livraisons échouées d'affilée",
        ]
    )
}
