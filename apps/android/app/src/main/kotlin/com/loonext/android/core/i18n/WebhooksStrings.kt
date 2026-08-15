package com.loonext.android.core.i18n

/**
 * #243 — the words the Connections section says, in both languages.
 *
 * The copy is the web catalogue's, character for character
 * (`apps/web/src/i18n/sections/webhooks.ts`). Not paraphrased: three clients
 * saying almost the same thing in slightly different words is how a customer
 * on two devices ends up unsure whether they are looking at the same feature,
 * and it is how a translator ends up reviewing the same sentence three times.
 *
 * The register is the one `CommonStrings` sets out: Quebec French,
 * VOUVOIEMENT, accents spelled normally, a normal space before `?`.
 *
 * Two things about this surface in particular:
 *
 * - **It is written for the owner, not the integrator.** Both open it, but only
 *   one of them gives up. So: "your other apps" rather than "consumers",
 *   "address" rather than "URL", and the signing key explained by what it is
 *   FOR rather than what it is.
 * - **The event names are sentences, not identifiers.** `message.received` is
 *   the wire name and appears nowhere a person reads; what they see is "A
 *   customer texts you". The mapping is derived in shared code, so a new event
 *   arrives here as a missing key rather than as a raw identifier on screen.
 */
object WebhooksStrings : AppStrings.Section {
    override val en = mapOf(
        "webhooks.navWebhooks" to "Connections",
        "webhooks.navWebhooksDesc" to "Send what happens here to your other apps",

        "webhooks.title" to "Connections",
        "webhooks.intro" to
            "Send what happens in this workspace to your other apps — a scheduling " +
            "tool, an accounting package, or anything that can accept a web address. " +
            "We post the details the moment they happen.",
        "webhooks.developerNote" to
            "Setting this up usually takes a developer a few minutes.",

        "webhooks.empty" to "Nothing is connected yet.",
        "webhooks.emptyBody" to
            "Add an address and we'll start sending events to it. You can test it " +
            "before anything real goes out.",
        "webhooks.addAction" to "Add a connection",
        "webhooks.capReached" to
            "You've reached the limit of {count} connections. Remove one to add another.",
        "webhooks.loadFailed" to "Couldn't load your connections. Try again.",

        "webhooks.eventsCount" to "{count} events",
        "webhooks.statusHealthy" to "Working",
        "webhooks.statusNeverUsed" to "Not used yet",
        "webhooks.statusFailing" to "Failing",
        "webhooks.statusPaused" to "Paused by you",
        "webhooks.statusStopped" to "We stopped sending",
        "webhooks.lastSuccess" to "Last delivered {when}",
        "webhooks.lastFailure" to "Last failed {when}",
        "webhooks.failingBody" to
            "The last {count} attempts were refused. We're still trying, with " +
            "longer gaps between each one.",
        "webhooks.stoppedBody" to
            "This address refused too many deliveries in a row, so we stopped " +
            "sending to it. Everything since then has been missed. Fix the address " +
            "and turn it back on to start receiving again.",
        "webhooks.resumeAction" to "Turn back on",
        "webhooks.pauseAction" to "Pause",

        "webhooks.addTitle" to "Add a connection",
        "webhooks.editTitle" to "Edit connection",
        "webhooks.urlLabel" to "Where should we send it?",
        "webhooks.urlHint" to "Must start with https://",
        "webhooks.nameLabel" to "What is this? (optional)",
        "webhooks.namePlaceholder" to "Scheduling tool",
        "webhooks.eventsLabel" to "What should we send?",
        "webhooks.eventsHint" to "All of them, unless you know you want fewer.",
        "webhooks.saveAction" to "Save",
        "webhooks.cancelAction" to "Cancel",
        "webhooks.savingAction" to "Saving…",
        "webhooks.needOneEvent" to "Pick at least one thing to send.",

        "webhooks.secretTitle" to "Copy your signing key now",
        "webhooks.secretBody" to
            "This is how your app checks that a delivery really came from us. We " +
            "cannot show it to you again — if you lose it, you can create a new one, " +
            "which stops the old one working.",
        "webhooks.secretCopy" to "Copy",
        "webhooks.secretCopied" to "Copied",
        "webhooks.secretDone" to "I've saved it",

        "webhooks.testAction" to "Send a test",
        "webhooks.testSending" to "Sending…",
        "webhooks.testOk" to "Your app answered. This connection works.",
        "webhooks.testRefused" to
            "Your app answered {status}. It's reachable, but it refused this.",
        "webhooks.testUnreachable" to "We couldn't reach that address at all.",
        "webhooks.testTimeout" to "That address took too long to answer.",

        "webhooks.rotateAction" to "Create a new signing key",
        "webhooks.rotateTitle" to "Create a new signing key?",
        "webhooks.rotateBody" to
            "The current key stops working immediately, and deliveries will be " +
            "refused until your app is updated with the new one.",
        "webhooks.rotateConfirm" to "Create a new key",

        "webhooks.deleteAction" to "Remove",
        "webhooks.deleteTitle" to "Remove this connection?",
        "webhooks.deleteBody" to
            "We'll stop sending to {url}. Anything that app does with these events " +
            "will stop happening.",
        "webhooks.deleteConfirm" to "Remove it",
        "webhooks.keepIt" to "Keep it",

        "webhooks.deliveriesAction" to "Recent deliveries",
        "webhooks.deliveriesTitle" to "Recent deliveries",
        "webhooks.deliveriesEmpty" to "Nothing has been sent to this address yet.",
        "webhooks.deliveryPending" to "Waiting to retry",
        "webhooks.deliverySucceeded" to "Delivered",
        "webhooks.deliveryFailed" to "Gave up",
        "webhooks.deliveryDelivering" to "Sending",
        "webhooks.deliveryAttempts" to "{count} attempts",

        "webhooks.event.messageReceived" to "A customer texts you",
        "webhooks.event.messageSent" to "You text a customer",
        "webhooks.event.messageFailed" to "A text doesn't go through",
        "webhooks.event.callCompleted" to "A call ends",
        "webhooks.event.voicemailReceived" to "Somebody leaves a voicemail",
        "webhooks.event.taskCreated" to "A job is added",
        "webhooks.event.taskCompleted" to "A job is finished",
        "webhooks.event.contactCreated" to "A new customer is added",

        "webhooks.urlError.notAUrl" to "That doesn't look like a web address.",
        "webhooks.urlError.notHttps" to
            "The address has to start with https:// — http isn't secure enough to " +
            "send your customers' messages over.",
        "webhooks.urlError.privateHost" to
            "That address is inside a private network, so we can't reach it from " +
            "the internet.",
        "webhooks.urlError.loopbackHost" to
            "That address points back at the machine making the request, so nothing " +
            "would receive it.",
        "webhooks.urlError.ourOwnHost" to "That address points back at us.",
        "webhooks.urlError.hasCredentials" to
            "Take the username and password out of the address — the signing key is " +
            "how we prove it's us.",
        "webhooks.urlError.tooLong" to "That address is too long.",

        "webhooks.disabled.tooManyFailures" to
            "Too many failed deliveries in a row",
    )

    override val frCA = mapOf(
        "webhooks.navWebhooks" to "Connexions",
        "webhooks.navWebhooksDesc" to
            "Envoyez ce qui se passe ici à vos autres applications",

        "webhooks.title" to "Connexions",
        "webhooks.intro" to
            "Envoyez ce qui se passe dans cet espace de travail à vos autres " +
            "applications — un outil de planification, un logiciel comptable, ou " +
            "tout ce qui peut recevoir une adresse web. Nous transmettons les " +
            "détails dès que ça arrive.",
        "webhooks.developerNote" to
            "La configuration prend habituellement quelques minutes à un développeur.",

        "webhooks.empty" to "Rien n'est connecté pour l'instant.",
        "webhooks.emptyBody" to
            "Ajoutez une adresse et nous commencerons à y envoyer les événements. " +
            "Vous pouvez faire un test avant que quoi que ce soit de réel ne parte.",
        "webhooks.addAction" to "Ajouter une connexion",
        "webhooks.capReached" to
            "Vous avez atteint la limite de {count} connexions. Retirez-en une pour " +
            "en ajouter une autre.",
        "webhooks.loadFailed" to "Impossible de charger vos connexions. Réessayez.",

        "webhooks.eventsCount" to "{count} événements",
        "webhooks.statusHealthy" to "Fonctionne",
        "webhooks.statusNeverUsed" to "Pas encore utilisée",
        "webhooks.statusFailing" to "En échec",
        "webhooks.statusPaused" to "Mise en pause par vous",
        "webhooks.statusStopped" to "Nous avons arrêté d'envoyer",
        "webhooks.lastSuccess" to "Dernière livraison {when}",
        "webhooks.lastFailure" to "Dernier échec {when}",
        "webhooks.failingBody" to
            "Les {count} dernières tentatives ont été refusées. Nous continuons " +
            "d'essayer, avec des intervalles plus longs entre chacune.",
        "webhooks.stoppedBody" to
            "Cette adresse a refusé trop de livraisons d'affilée, alors nous avons " +
            "arrêté d'y envoyer. Tout ce qui a suivi a été manqué. Corrigez " +
            "l'adresse et réactivez-la pour recommencer à recevoir.",
        "webhooks.resumeAction" to "Réactiver",
        "webhooks.pauseAction" to "Mettre en pause",

        "webhooks.addTitle" to "Ajouter une connexion",
        "webhooks.editTitle" to "Modifier la connexion",
        "webhooks.urlLabel" to "Où devons-nous l'envoyer ?",
        "webhooks.urlHint" to "Doit commencer par https://",
        "webhooks.nameLabel" to "De quoi s'agit-il ? (facultatif)",
        "webhooks.namePlaceholder" to "Outil de planification",
        "webhooks.eventsLabel" to "Qu'est-ce qu'on envoie ?",
        "webhooks.eventsHint" to "Tout, sauf si vous savez que vous en voulez moins.",
        "webhooks.saveAction" to "Enregistrer",
        "webhooks.cancelAction" to "Annuler",
        "webhooks.savingAction" to "Enregistrement…",
        "webhooks.needOneEvent" to "Choisissez au moins un élément à envoyer.",

        "webhooks.secretTitle" to "Copiez votre clé de signature maintenant",
        "webhooks.secretBody" to
            "C'est ainsi que votre application vérifie qu'une livraison vient bien " +
            "de nous. Nous ne pourrons plus vous la montrer — si vous la perdez, " +
            "vous pouvez en créer une nouvelle, ce qui rend l'ancienne inutilisable.",
        "webhooks.secretCopy" to "Copier",
        "webhooks.secretCopied" to "Copiée",
        "webhooks.secretDone" to "Je l'ai enregistrée",

        "webhooks.testAction" to "Envoyer un test",
        "webhooks.testSending" to "Envoi…",
        "webhooks.testOk" to "Votre application a répondu. Cette connexion fonctionne.",
        "webhooks.testRefused" to
            "Votre application a répondu {status}. Elle est joignable, mais elle a " +
            "refusé ceci.",
        "webhooks.testUnreachable" to
            "Nous n'avons pas pu joindre cette adresse du tout.",
        "webhooks.testTimeout" to "Cette adresse a mis trop de temps à répondre.",

        "webhooks.rotateAction" to "Créer une nouvelle clé de signature",
        "webhooks.rotateTitle" to "Créer une nouvelle clé de signature ?",
        "webhooks.rotateBody" to
            "La clé actuelle cesse de fonctionner immédiatement, et les livraisons " +
            "seront refusées tant que votre application n'aura pas la nouvelle.",
        "webhooks.rotateConfirm" to "Créer une nouvelle clé",

        "webhooks.deleteAction" to "Retirer",
        "webhooks.deleteTitle" to "Retirer cette connexion ?",
        "webhooks.deleteBody" to
            "Nous cesserons d'envoyer à {url}. Tout ce que cette application fait " +
            "avec ces événements cessera de se produire.",
        "webhooks.deleteConfirm" to "La retirer",
        "webhooks.keepIt" to "La garder",

        "webhooks.deliveriesAction" to "Livraisons récentes",
        "webhooks.deliveriesTitle" to "Livraisons récentes",
        "webhooks.deliveriesEmpty" to "Rien n'a encore été envoyé à cette adresse.",
        "webhooks.deliveryPending" to "En attente de reprise",
        "webhooks.deliverySucceeded" to "Livré",
        "webhooks.deliveryFailed" to "Abandonné",
        "webhooks.deliveryDelivering" to "Envoi en cours",
        "webhooks.deliveryAttempts" to "{count} tentatives",

        "webhooks.event.messageReceived" to "Un client vous écrit",
        "webhooks.event.messageSent" to "Vous écrivez à un client",
        "webhooks.event.messageFailed" to "Un message ne passe pas",
        "webhooks.event.callCompleted" to "Un appel se termine",
        "webhooks.event.voicemailReceived" to "Quelqu'un laisse un message vocal",
        "webhooks.event.taskCreated" to "Une tâche est ajoutée",
        "webhooks.event.taskCompleted" to "Une tâche est terminée",
        "webhooks.event.contactCreated" to "Un nouveau client est ajouté",

        "webhooks.urlError.notAUrl" to "Ça ne ressemble pas à une adresse web.",
        "webhooks.urlError.notHttps" to
            "L'adresse doit commencer par https:// — http n'est pas assez " +
            "sécuritaire pour transmettre les messages de vos clients.",
        "webhooks.urlError.privateHost" to
            "Cette adresse se trouve dans un réseau privé, alors nous ne pouvons " +
            "pas la joindre depuis Internet.",
        "webhooks.urlError.loopbackHost" to
            "Cette adresse pointe vers la machine qui fait la demande, alors " +
            "personne ne recevrait rien.",
        "webhooks.urlError.ourOwnHost" to "Cette adresse pointe vers nous.",
        "webhooks.urlError.hasCredentials" to
            "Retirez le nom d'utilisateur et le mot de passe de l'adresse — la clé " +
            "de signature est ce qui prouve que c'est bien nous.",
        "webhooks.urlError.tooLong" to "Cette adresse est trop longue.",

        "webhooks.disabled.tooManyFailures" to
            "Trop de livraisons échouées d'affilée",
    )
}
