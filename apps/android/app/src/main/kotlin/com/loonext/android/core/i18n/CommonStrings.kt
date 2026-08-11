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
        "common.retry" to "Try again",
        "common.loadFailed" to
            "Couldn't load this. Check your connection and try again.",
        "common.somethingWentWrong" to "Something went wrong. Try again.",
    )

    override val frCA = mapOf(
        "common.cancel" to "Annuler",
        "common.save" to "Enregistrer",
        "common.saving" to "Enregistrement…",
        "common.saved" to "Enregistré",
        "common.delete" to "Supprimer",
        "common.back" to "Retour",
        "common.close" to "Fermer",
        
        "common.retry" to "Réessayer",
        "common.loadFailed" to
            "Impossible de charger. Vérifiez votre connexion et réessayez.",
        "common.somethingWentWrong" to "Une erreur s'est produite. Réessayez.",
    )
}
