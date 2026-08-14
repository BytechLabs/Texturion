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

        "common.bulkSelectedCount" to "{count} sélectionnées",
        "common.bulkSelectedAllMatching" to
            "Toutes celles qui correspondent à ce filtre",
    )
}
