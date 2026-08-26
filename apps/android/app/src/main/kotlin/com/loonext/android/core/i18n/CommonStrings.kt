package com.loonext.android.core.i18n

/**
 * #228 — words used in more than one place, and nowhere in particular.
 *
 * The register for the French, and it is the same on all three clients:
 * Quebec French, VOUVOIEMENT, accents spelled normally. The GSM-7 restriction
 * in `MessageLocale`'s copy governs the automated TEXTS, which are billed by
 * the segment; nothing on a screen is.
 */
object CommonStrings : AppStrings.Section {
    override val en = mapOf(
        "common.cancel" to "Cancel",
        "common.save" to "Save",
        "common.saving" to "Saving…",
        "common.saved" to "Saved",
        "common.delete" to "Delete",
        "common.close" to "Close",
        "common.back" to "Back",
        "common.dismiss" to "Dismiss",
        "common.country" to "Country",
        "common.retry" to "Try again",
        "common.loadFailed" to
            "Couldn't load this. Check your connection and try again.",
        "common.somethingWentWrong" to "Something went wrong. Try again.",

        /*
         * ── What a failure is allowed to say (see `Throwable.userMessage`) ────
         *
         * Two sentences, because they are two different things. A DECODE failure
         * means we could not read what the server sent — our bug, and one that
         * "try again" cannot fix, because the same response fails the same way.
         * Telling somebody to retry a permanent failure is the dishonesty these
         * two keys exist to keep apart.
         *
         * Neither is the API's own refusal: those are rendered verbatim and
         * translating them belongs on the server, because a client-side copy of
         * somebody else's sentence is a copy that drifts.
         */
        "common.decodeFailed" to
            "This didn't load. It's a problem on our side, not something you did. " +
            "If there's an app update, that usually fixes it.",
        "common.unknownError" to "Something went wrong.",

        /*
         * #228 — the sentences THIS APP writes when a request fails.
         *
         * Every one was English on a French phone until now, and they are the
         * most-seen copy in the product: a lost connection shows one of these
         * on every screen at once. The server's own refusals are NOT here —
         * those arrive worded and translated by the API, and a second copy of
         * them would go stale the moment it rewords one.
         */
        "common.errNetwork" to "Can't reach Loonext. Check your connection.",
        "common.errSignInNetwork" to
            "Can't reach the sign-in service. Check your connection.",
        "common.errSignedOut" to "You're signed out.",
        "common.errSessionExpired" to "Session expired.",
        "common.errServer" to "Something went wrong ({status}).",
        "common.errGoogleUnavailable" to
            "Google sign-in isn't set up for this app yet.",
        "common.errPhoneConnect" to
            "Couldn't connect your phone. Check your connection and try again.",
        "common.errCallingNotReady" to
            "Calling isn't ready yet. Try again in a moment.",
        "common.errTwoCalls" to "You're already on two calls.",

        /*
         * Connected Apps is rendered by Android's Contacts/Accounts surfaces,
         * outside Compose.  It still uses the same catalogue so those rows do
         * not become the one English island on a French phone.
         */
        "contactsSync.accountSyncOnly" to "Loonext account is sync-only",
        "contactsSync.callAction" to "Call with Loonext",
        "contactsSync.textAction" to "Text with Loonext",

        /*
         * Client-authored call failures and the call foreground notification.
         * Server envelope copy remains the server's; these are the sentences
         * the Android client itself owns.
         */
        "telephony.placementUnreachable" to
            "Couldn't reach the line. Please try again.",
        "telephony.placementNoSession" to
            "Couldn't start the call. Please try again.",
        "telephony.temporarilyUnavailable" to
            "Calling is temporarily unavailable.",
        "telephony.connectFailed" to "Couldn't connect the call.",
        "telephony.answerFailed" to "Couldn't answer — try again.",
        "telephony.interruptedByCrash" to
            "A call was interrupted when the app closed unexpectedly.",
        "telephony.callInProgress" to "Call in progress",
        "telephony.callOnHold" to "On hold",
        "telephony.ongoingCall" to "Ongoing call",

        /* Malformed/legacy FCM data still produces a readable notification. */
        "push.fallbackIncomingTitle" to "Incoming call",
        "push.fallbackIncomingBody" to
            "Someone is calling your business number.",
        "push.fallbackGenericBody" to "You have a new notification.",

        /*
         * ── What "selected" says in a bulk bar ────────────────────────────────
         *
         * Common rather than inbox: the conversation list and the task list both
         * read these through `BulkSelection.label()`, and two copies of one
         * sentence is how two surfaces end up disagreeing about the same number.
         *
         * `bulkSelectedAllMatching` deliberately carries NO number. The server
         * has not counted the set yet, and a confident "340 selected" that turns
         * out to be wrong is the trap #275 exists about.
         */
        "common.bulkSelectedCount" to "{count} selected",
        "common.bulkSelectedAllMatching" to "All matching this filter",
    )

    override val frCA = mapOf(
        "common.cancel" to "Annuler",
        "common.save" to "Enregistrer",
        "common.saving" to "Enregistrement…",
        "common.saved" to "Enregistré",
        "common.delete" to "Supprimer",
        "common.back" to "Retour",
        "common.close" to "Fermer",
        "common.dismiss" to "Masquer",
        "common.country" to "Pays",
        "common.retry" to "Réessayer",
        "common.loadFailed" to
            "Impossible de charger. Vérifiez votre connexion et réessayez.",
        "common.somethingWentWrong" to "Une erreur s'est produite. Réessayez.",

        "common.decodeFailed" to
            "Le chargement a échoué. C'est un problème de notre côté, pas " +
            "quelque chose que vous avez fait. S'il y a une mise à jour de " +
            "l'application, elle corrige habituellement ce genre de chose.",
        "common.unknownError" to "Une erreur s'est produite.",

        "common.errNetwork" to
            "Impossible de joindre Loonext. Vérifiez votre connexion.",
        "common.errSignInNetwork" to
            "Impossible de joindre le service de connexion. Vérifiez votre connexion.",
        "common.errSignedOut" to "Vous êtes déconnecté.",
        "common.errSessionExpired" to "Session expirée.",
        "common.errServer" to "Une erreur s'est produite ({status}).",
        "common.errGoogleUnavailable" to
            "La connexion Google n'est pas encore configurée pour cette application.",
        "common.errPhoneConnect" to
            "Impossible de connecter votre téléphone. Vérifiez votre connexion et réessayez.",
        "common.errCallingNotReady" to
            "Les appels ne sont pas encore prêts. Réessayez dans un moment.",
        "common.errTwoCalls" to "Vous êtes déjà sur deux appels.",

        "contactsSync.accountSyncOnly" to
            "Le compte Loonext sert seulement à la synchronisation",
        "contactsSync.callAction" to "Appeler avec Loonext",
        "contactsSync.textAction" to "Envoyer un texto avec Loonext",

        "telephony.placementUnreachable" to
            "Impossible de joindre la ligne. Veuillez réessayer.",
        "telephony.placementNoSession" to
            "Impossible de démarrer l'appel. Veuillez réessayer.",
        "telephony.temporarilyUnavailable" to
            "Les appels sont temporairement indisponibles.",
        "telephony.connectFailed" to "Impossible de connecter l'appel.",
        "telephony.answerFailed" to "Impossible de répondre — réessayez.",
        "telephony.interruptedByCrash" to
            "Un appel a été interrompu lorsque l'application s'est fermée de façon inattendue.",
        "telephony.callInProgress" to "Appel en cours",
        "telephony.callOnHold" to "En attente",
        "telephony.ongoingCall" to "Appel en cours",

        "push.fallbackIncomingTitle" to "Appel entrant",
        "push.fallbackIncomingBody" to
            "Quelqu'un appelle votre numéro d'affaires.",
        "push.fallbackGenericBody" to "Vous avez une nouvelle notification.",

        "common.bulkSelectedCount" to "{count} sélectionnées",
        "common.bulkSelectedAllMatching" to
            "Toutes celles qui correspondent à ce filtre",
    )
}
