package com.loonext.android.core.i18n

/**
 * #245 — the words the schedule-feed card says, in both languages.
 *
 * Copied CHARACTER FOR CHARACTER from `apps/web/src/i18n/sections/calendarFeed.ts`,
 * English and French alike, and `CalendarFeedCardTest` reads that file and fails
 * if either half drifts. Not tidiness: this card hands somebody a bearer
 * credential and tells them it will never be shown again, and a client that says
 * that slightly differently is a client whose customer is unsure whether the two
 * screens are the same feature. The French is already translated there — it is
 * carried across, never re-translated, for the same reason.
 *
 * ## Its own section rather than a corner of `SettingsMoreStrings`
 *
 * The prefix is `calendarFeed.`, and the two nearest neighbours — `apiKeys.` and
 * `webhooks.` — each mirror one web section file with one Kotlin object. Keeping
 * that correspondence is what lets the verbatim guard above slice ONE web file
 * and compare it against ONE Kotlin map; a namespace folded into a
 * hundred-and-sixty-kilobyte settings file would have to be found by grep on
 * both sides. Registered in `AppStrings.SECTIONS` — an unregistered section is
 * one every screen renders the bare keys of, which `AppStringsTest` also pins.
 *
 * ## What the copy carries that the interface cannot
 *
 * Web's catalogue states it and it is worth repeating where a reader of THIS
 * file will meet it: the URL is shown once, and anyone holding it can read that
 * schedule. It is a password in the shape of a link, and it is about to be
 * pasted into a third-party app — so the warning has to be in the words rather
 * than left to the amber block they sit in.
 */
object CalendarFeedStrings : AppStrings.Section {
    override val en = mapOf(
        "calendarFeed.title" to "Your schedule in your calendar",
        "calendarFeed.description" to
            "Add your scheduled jobs to Google Calendar, Apple Calendar, Outlook or " +
            "any other calendar app. It updates on its own — you only set it up once.",

        "calendarFeed.create" to "Set up my calendar",
        "calendarFeed.rotate" to "Get a new link",
        "calendarFeed.revoke" to "Turn it off",
        // The second press. Says what breaks, rather than asking "are you sure".
        "calendarFeed.revokeConfirm" to "Turn it off — my calendar stops updating",

        "calendarFeed.shownOnceTitle" to "Copy this link now",
        "calendarFeed.shownOnceDetail" to
            "This is the only time you will see it. Paste it into your calendar app " +
            "to subscribe. Anyone with this link can see your scheduled jobs, so keep " +
            "it to yourself — if it gets out, get a new link and the old one stops " +
            "working.",
        "calendarFeed.copy" to "Copy link",
        "calendarFeed.copied" to "Copied",
        "calendarFeed.done" to "Done",

        // The fact that answers "did I finish setting this up?".
        "calendarFeed.lastRead" to "Your calendar last checked {when}",
        "calendarFeed.neverRead" to
            "Your calendar has not checked yet. It usually takes a few minutes after " +
            "you subscribe.",

        "calendarFeed.failed" to "That didn't go through. Try again.",
    )

    override val frCA = mapOf(
        "calendarFeed.title" to "Votre horaire dans votre calendrier",
        "calendarFeed.description" to
            "Ajoutez vos travaux planifiés à Google Agenda, Calendrier Apple, Outlook " +
            "ou n'importe quelle autre application de calendrier. La mise à jour se " +
            "fait toute seule — vous ne le configurez qu'une fois.",

        "calendarFeed.create" to "Configurer mon calendrier",
        "calendarFeed.rotate" to "Obtenir un nouveau lien",
        "calendarFeed.revoke" to "Désactiver",
        // The same "say what breaks" rule as the English, kept short enough to fit
        // a button: the consequence, not a confirmation question.
        "calendarFeed.revokeConfirm" to
            "Désactiver — mon calendrier cesse de se mettre à jour",

        "calendarFeed.shownOnceTitle" to "Copiez ce lien maintenant",
        "calendarFeed.shownOnceDetail" to
            "C'est la seule fois que vous le verrez. Collez-le dans votre application " +
            "de calendrier pour vous abonner. Toute personne ayant ce lien peut voir " +
            "vos travaux planifiés, alors gardez-le pour vous — s'il circule, obtenez " +
            "un nouveau lien et l'ancien cessera de fonctionner.",
        "calendarFeed.copy" to "Copier le lien",
        "calendarFeed.copied" to "Copié",
        "calendarFeed.done" to "Terminé",

        "calendarFeed.lastRead" to "Votre calendrier a vérifié pour la dernière fois {when}",
        "calendarFeed.neverRead" to
            "Votre calendrier n'a pas encore vérifié. Cela prend habituellement " +
            "quelques minutes après l'abonnement.",

        "calendarFeed.failed" to "Ça n'a pas fonctionné. Réessayez.",
    )
}
