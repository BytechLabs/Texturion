import Foundation

/// #245 — the words the schedule-feed card says, in both languages.
///
/// Copied key for key from `apps/web/src/i18n/sections/calendarFeed.ts`, the
/// English AND the French. Not re-translated and not reworded: three clients
/// that each phrase the same warning their own way are three clients whose
/// customers get three different products, and this particular warning is the
/// one that costs somebody an afternoon when it drifts.
///
/// ## Register
///
/// The web file's, unchanged. Written for the crew member rather than for
/// whoever implements the sync later — "your calendar", "your scheduled work",
/// never "ICS", "iCalendar" or "subscription URL".
///
/// ## What the copy carries that the UI cannot
///
/// 1. The URL is shown ONCE. The server keeps a hash, so no screen anywhere can
///    show it again — losing it means rotating, and rotating breaks the
///    calendar they already set up.
/// 2. Anyone holding the URL can read that schedule. It is a password in the
///    shape of a link, and it gets pasted into a third-party app, so the warning
///    has to be in the WORDS — on this client there is not even an amber border
///    around a share sheet to imply it.
///
/// ## Its own section rather than a corner of `SettingsMoreStrings`
///
/// The same call `ApiKeysStrings` and `WebhooksStrings` made: a `calendarFeed.`
/// namespace is a surface, and a translator working through this card should
/// find its fourteen sentences together rather than folded into the 200-odd
/// keys of the N–Z settings file.
enum CalendarFeedStrings {
    static let section = AppStrings.Section(
        name: "CalendarFeedStrings",
        en: [
            "calendarFeed.title": "Your schedule in your calendar",
            "calendarFeed.description":
                "Add your scheduled jobs to Google Calendar, Apple Calendar, Outlook or any "
                + "other calendar app. It updates on its own — you only set it up once.",

            "calendarFeed.create": "Set up my calendar",
            "calendarFeed.rotate": "Get a new link",
            "calendarFeed.revoke": "Turn it off",
            // The second press. Says what breaks, rather than asking "are you
            // sure" — which is why the confirmation dialog that carries it hides
            // its own title instead of adding a question above it.
            "calendarFeed.revokeConfirm": "Turn it off — my calendar stops updating",

            "calendarFeed.shownOnceTitle": "Copy this link now",
            "calendarFeed.shownOnceDetail":
                "This is the only time you will see it. Paste it into your calendar app to "
                + "subscribe. Anyone with this link can see your scheduled jobs, so keep it "
                + "to yourself — if it gets out, get a new link and the old one stops "
                + "working.",
            "calendarFeed.copy": "Copy link",
            "calendarFeed.copied": "Copied",
            "calendarFeed.done": "Done",

            // The fact that answers "did I finish setting this up?".
            "calendarFeed.lastRead": "Your calendar last checked {when}",
            "calendarFeed.neverRead":
                "Your calendar has not checked yet. It usually takes a few minutes after "
                + "you subscribe.",

            "calendarFeed.failed": "That didn't go through. Try again.",
        ],
        frCA: [
            "calendarFeed.title": "Votre horaire dans votre calendrier",
            "calendarFeed.description":
                "Ajoutez vos travaux planifiés à Google Agenda, Calendrier Apple, Outlook ou "
                + "n'importe quelle autre application de calendrier. La mise à jour se fait "
                + "toute seule — vous ne le configurez qu'une fois.",

            "calendarFeed.create": "Configurer mon calendrier",
            "calendarFeed.rotate": "Obtenir un nouveau lien",
            "calendarFeed.revoke": "Désactiver",
            // The same "say what breaks" rule as the English, kept short enough
            // to fit a button: the consequence, not a confirmation question.
            "calendarFeed.revokeConfirm": "Désactiver — mon calendrier cesse de se mettre à jour",

            "calendarFeed.shownOnceTitle": "Copiez ce lien maintenant",
            "calendarFeed.shownOnceDetail":
                "C'est la seule fois que vous le verrez. Collez-le dans votre application de "
                + "calendrier pour vous abonner. Toute personne ayant ce lien peut voir vos "
                + "travaux planifiés, alors gardez-le pour vous — s'il circule, obtenez un "
                + "nouveau lien et l'ancien cessera de fonctionner.",
            "calendarFeed.copy": "Copier le lien",
            "calendarFeed.copied": "Copié",
            "calendarFeed.done": "Terminé",

            "calendarFeed.lastRead": "Votre calendrier a vérifié pour la dernière fois {when}",
            "calendarFeed.neverRead":
                "Votre calendrier n'a pas encore vérifié. Cela prend habituellement quelques "
                + "minutes après l'abonnement.",

            "calendarFeed.failed": "Ça n'a pas fonctionné. Réessayez.",
        ]
    )
}
