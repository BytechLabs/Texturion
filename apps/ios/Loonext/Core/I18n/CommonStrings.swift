import Foundation

/// #228 — words used in more than one place, and nowhere in particular.
///
/// The register, and it is the same on all three clients: Quebec French,
/// VOUVOIEMENT, accents spelled normally. The GSM-7 restriction that governs
/// the automated TEXTS exists because those are billed per segment; nothing on
/// a screen is.
enum CommonStrings {
    static let section = AppStrings.Section(
        name: "CommonStrings",
        en: [
            "common.cancel": "Cancel",
            "common.save": "Save",
            "common.saving": "Saving…",
            "common.saved": "Saved",
            "common.delete": "Delete",
            "common.close": "Close",
            "common.back": "Back",
            "common.retry": "Try again",
            "common.loadFailed": "Couldn't load this. Check your connection and try again.",
            "common.somethingWentWrong": "Something went wrong. Try again.",

            /*
             * ── What "selected" says in a bulk bar ────────────────────────────
             *
             * Common rather than inbox, and the key names are Android's
             * (`core/i18n/CommonStrings.kt`) for the same reason it gave: the
             * conversation list and the task list both read these through
             * `BulkSelection`, and two copies of one sentence is how two
             * surfaces end up disagreeing about the same number.
             *
             * `bulkSelectedAllMatching` deliberately carries NO number. The
             * server has not counted the set yet, and a confident "340 selected"
             * that turns out to be the 25 loaded rows is the trap #275 exists
             * about — `BulkSelectionTests` pins that there are no digits in it.
             */
            "common.bulkSelectedCount": "{count} selected",
            "common.bulkSelectedAllMatching": "All matching this filter",
        ],
        frCA: [
            "common.cancel": "Annuler",
            "common.save": "Enregistrer",
            "common.saving": "Enregistrement…",
            "common.saved": "Enregistré",
            "common.delete": "Supprimer",
            "common.close": "Fermer",
            "common.back": "Retour",
            "common.retry": "Réessayer",
            "common.loadFailed": "Impossible de charger. Vérifiez votre connexion et réessayez.",
            "common.somethingWentWrong": "Une erreur s'est produite. Réessayez.",

            "common.bulkSelectedCount": "{count} sélectionnées",
            "common.bulkSelectedAllMatching":
                "Toutes celles qui correspondent à ce filtre",
        ]
    )
}
