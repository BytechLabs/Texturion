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
/// find all of its sentences together rather than folded into the 200-odd keys
/// of the N–Z settings file.
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
            "calendarFeed.twoWayTitle": "Two-way calendar sync",
            "calendarFeed.twoWayDescription": "Reschedule an assigned job in Loonext or its linked calendar event and the other copy follows.",
            "calendarFeed.twoWayDisclosure": "Loonext creates calendar events for scheduled jobs assigned to you and checks those linked events for schedule changes. It never imports unrelated events or invites customers. Connecting revokes your existing read-only calendar feed so each job appears once.",
            "calendarFeed.googleProvider": "Google Calendar",
            "calendarFeed.microsoftProvider": "Microsoft 365",
            "calendarFeed.connectGoogle": "Connect Google Calendar",
            "calendarFeed.connectMicrosoft": "Connect Microsoft 365",
            "calendarFeed.connecting": "Opening calendar sign-in…",
            "calendarFeed.providerUnavailable": "{provider} is not available in this workspace.",
            "calendarFeed.connected": "Connected",
            "calendarFeed.reauthRequired": "Reconnect required",
            "calendarFeed.disconnected": "Disconnected",
            "calendarFeed.needsAttention": "Needs attention",
            "calendarFeed.calendarNamed": "Calendar: {calendar}",
            "calendarFeed.verificationLabel": "Verification",
            "calendarFeed.synchronizationLabel": "Synchronization",
            "calendarFeed.lastVerified": "Last verified {when}",
            "calendarFeed.neverVerified": "Not verified yet",
            "calendarFeed.lastSynced": "Last synced {when}",
            "calendarFeed.neverSynced": "Not synced yet",
            "calendarFeed.connectionError": "Loonext could not verify this calendar. Reconnect it to resume syncing.",
            "calendarFeed.connectionRetrying": "A calendar update failed. Loonext will retry automatically.",
            "calendarFeed.connectionStale": "Calendar sync has not been verified recently. Reminders stay paused until verification succeeds.",
            "calendarFeed.connectionCleanupFailed": "Loonext disconnected this calendar but could not confirm removal of old Loonext data at the provider. Review that calendar and its access.",
            "calendarFeed.connectionDisconnecting": "Loonext is removing its calendar watch and finishing linked-event cleanup. Reconnect is available after this finishes.",
            "calendarFeed.conflictsOne": "One scheduling conflict needs your decision.",
            "calendarFeed.conflictsMany": "{count} scheduling conflicts need your decision.",
            "calendarFeed.attentionTitle": "Schedule decisions",
            "calendarFeed.attentionDescription": "Loonext paused these jobs instead of guessing which schedule is right.",
            "calendarFeed.attentionLoading": "Loading schedule decisions…",
            "calendarFeed.attentionLoadFailed": "Your schedule decisions could not be loaded.",
            "calendarFeed.attentionRetry": "Try again",
            "calendarFeed.conflictTitle": "This job moved in two places",
            "calendarFeed.conflictDescription": "Choose the schedule to keep. Loonext will update the other copy.",
            "calendarFeed.conflictProviderRemoved": "The conflict still needs your decision, but the calendar event has since been removed. Keep the Loonext schedule to recreate it, or leave this flagged.",
            "calendarFeed.conflictProviderRefused": "The conflict still needs your decision, but the calendar event no longer has a usable schedule. Keep the Loonext schedule to repair it, or leave this flagged.",
            "calendarFeed.removedTitle": "This event was removed from your calendar",
            "calendarFeed.removedDescription": "Tell Loonext whether the job was cancelled or moved. Its reminders stay paused until you decide.",
            "calendarFeed.refusedAllDayTitle": "This job became an all-day event",
            "calendarFeed.refusedAllDayDescription": "Loonext needs a real start time before it can schedule the job or send a reminder. Add a time in your calendar; it will sync on the next check.",
            "calendarFeed.refusedTimeTitle": "This calendar event has an invalid time",
            "calendarFeed.refusedTimeDescription": "Choose a valid start and a later end time in your calendar; it will sync on the next check.",
            "calendarFeed.refusedZoneTitle": "This calendar time zone is not supported",
            "calendarFeed.refusedZoneDescription": "Choose a standard time zone for the event in your calendar; it will sync on the next check.",
            "calendarFeed.refusedTitleTitle": "This calendar event needs a valid job title",
            "calendarFeed.refusedTitleDescription": "Add a title of 500 characters or fewer in your calendar; it will sync on the next check.",
            "calendarFeed.refusedDescriptionTitle": "This calendar event has too much job detail",
            "calendarFeed.refusedDescriptionDescription": "Shorten the event description to 5,000 characters or fewer; Loonext will never cut or import it silently.",
            "calendarFeed.refusedWindowTitle": "This event moved outside the sync window",
            "calendarFeed.refusedWindowDescription": "Move it to a date from 90 days ago through 365 days ahead, or manage this job manually.",
            "calendarFeed.refusedMeetingTitle": "This event now has guests or an online meeting",
            "calendarFeed.refusedMeetingDescription": "Loonext paused automatic changes so it cannot notify guests or damage meeting details. Remove the guests or meeting before syncing it again.",
            "calendarFeed.refusedRecurrenceTitle": "This job became a recurring event",
            "calendarFeed.refusedRecurrenceDescription": "Change it back to one event before syncing. Loonext will not guess which occurrence is the job.",
            "calendarFeed.refusedUnknownTitle": "This calendar event needs review",
            "calendarFeed.refusedUnknownDescription": "Loonext paused this event because it could not handle the provider change safely. Review the event before trying again.",
            "calendarFeed.loonextSchedule": "Loonext schedule",
            "calendarFeed.providerSchedule": "{provider} schedule",
            "calendarFeed.differencesTitle": "What differs",
            "calendarFeed.startDifference": "Different start time",
            "calendarFeed.endDifference": "Different end time",
            "calendarFeed.timeZoneDifference": "Different time zone",
            "calendarFeed.titleDifference": "Different job title",
            "calendarFeed.descriptionChanged": "The job notes differ too. Your choice also keeps that copy's notes.",
            "calendarFeed.scheduleStart": "Starts",
            "calendarFeed.scheduleEnd": "Ends",
            "calendarFeed.scheduleTimeZone": "Time zone",
            "calendarFeed.scheduleTitle": "Job title",
            "calendarFeed.loonextChangedByAt": "{name} changed the Loonext schedule on {when}.",
            "calendarFeed.loonextChangedAt": "The Loonext schedule changed on {when}.",
            "calendarFeed.providerObservedAt": "Loonext observed the {provider} schedule on {when}.",
            "calendarFeed.conflictDetectedAt": "Conflict detected on {when}.",
            "calendarFeed.openTask": "Open job",
            "calendarFeed.useLoonext": "Keep Loonext schedule",
            "calendarFeed.useCalendar": "Keep calendar schedule",
            "calendarFeed.cancelJob": "The job was cancelled",
            "calendarFeed.movedJob": "The job was moved",
            "calendarFeed.newDateLabel": "New date and time",
            "calendarFeed.newDateTimeZone": "This time is in {zone}.",
            "calendarFeed.saveMovedDate": "Save new time",
            "calendarFeed.notSure": "Not sure yet",
            "calendarFeed.resolving": "Saving decision…",
            "calendarFeed.resolutionSaved": "Schedule decision saved.",
            "calendarFeed.resolutionFailed": "That decision could not be saved. Try again.",
            "calendarFeed.movedDateRequired": "Choose the new date and time first.",
            "calendarFeed.movedDateAmbiguous": "That clock time happens twice because daylight saving time ends. Choose a different time.",
            "calendarFeed.movedDateNonexistent": "That clock time does not exist because daylight saving time starts. Choose a different time.",
            "calendarFeed.reauthorize": "Reconnect",
            "calendarFeed.disconnect": "Disconnect",
            "calendarFeed.disconnectConfirm": "Disconnect and stop syncing",
            "calendarFeed.connectedToast": "Calendar connected.",
            "calendarFeed.replacementRequiresDisconnect": "A different calendar is already connected. Disconnect it before connecting this one.",
            "calendarFeed.disconnectInProgress": "Calendar cleanup is still in progress. Wait for it to finish before reconnecting.",
            "calendarFeed.disconnectedToast": "Calendar disconnected.",
            "calendarFeed.authorizationFailed": "Calendar sign-in could not be completed. Try again.",
            "calendarFeed.disconnectFailed": "That calendar could not be disconnected. Try again.",
            "calendarFeed.connectionsLoading": "Loading calendar connections…",
            "calendarFeed.connectionsLoadFailed": "Your calendar connections could not be loaded.",
            "calendarFeed.retryConnections": "Try again",
            "calendarFeed.readOnlyFallback": "Use the read-only calendar feed instead",
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
            "calendarFeed.twoWayTitle": "Synchronisation bidirectionnelle du calendrier",
            "calendarFeed.twoWayDescription": "Replanifiez un travail qui vous est attribué dans Loonext ou son événement de calendrier lié; l'autre copie suivra.",
            "calendarFeed.twoWayDisclosure": "Loonext crée des événements de calendrier pour les travaux planifiés qui vous sont attribués et vérifie les changements d'horaire de ces événements liés. Il n'importe jamais les événements sans lien et n'invite jamais de clients. La connexion révoque votre flux de calendrier existant en lecture seule afin que chaque travail n'apparaisse qu'une fois.",
            "calendarFeed.googleProvider": "Google Agenda",
            "calendarFeed.microsoftProvider": "Microsoft 365",
            "calendarFeed.connectGoogle": "Connecter Google Agenda",
            "calendarFeed.connectMicrosoft": "Connecter Microsoft 365",
            "calendarFeed.connecting": "Ouverture de la connexion au calendrier…",
            "calendarFeed.providerUnavailable": "{provider} n'est pas disponible dans cet espace de travail.",
            "calendarFeed.connected": "Connecté",
            "calendarFeed.reauthRequired": "Reconnexion requise",
            "calendarFeed.disconnected": "Déconnecté",
            "calendarFeed.needsAttention": "Nécessite votre attention",
            "calendarFeed.calendarNamed": "Calendrier : {calendar}",
            "calendarFeed.verificationLabel": "Vérification",
            "calendarFeed.synchronizationLabel": "Synchronisation",
            "calendarFeed.lastVerified": "Dernière vérification : {when}",
            "calendarFeed.neverVerified": "Pas encore vérifié",
            "calendarFeed.lastSynced": "Dernière synchronisation : {when}",
            "calendarFeed.neverSynced": "Pas encore synchronisé",
            "calendarFeed.connectionError": "Loonext n'a pas pu vérifier ce calendrier. Reconnectez-le pour reprendre la synchronisation.",
            "calendarFeed.connectionRetrying": "Une mise à jour du calendrier a échoué. Loonext réessaiera automatiquement.",
            "calendarFeed.connectionStale": "La synchronisation du calendrier n'a pas été vérifiée récemment. Les rappels restent en pause jusqu'à une vérification réussie.",
            "calendarFeed.connectionCleanupFailed": "Loonext a déconnecté ce calendrier, mais n'a pas pu confirmer la suppression des anciennes données Loonext chez le fournisseur. Vérifiez ce calendrier et ses accès.",
            "calendarFeed.connectionDisconnecting": "Loonext retire la surveillance du calendrier et termine le nettoyage des événements liés. La reconnexion sera disponible ensuite.",
            "calendarFeed.conflictsOne": "Un conflit d'horaire attend votre décision.",
            "calendarFeed.conflictsMany": "{count} conflits d'horaire attendent votre décision.",
            "calendarFeed.attentionTitle": "Décisions d'horaire",
            "calendarFeed.attentionDescription": "Loonext a mis ces travaux en pause au lieu de deviner quel horaire est le bon.",
            "calendarFeed.attentionLoading": "Chargement des décisions d'horaire…",
            "calendarFeed.attentionLoadFailed": "Vos décisions d'horaire n'ont pas pu être chargées.",
            "calendarFeed.attentionRetry": "Réessayer",
            "calendarFeed.conflictTitle": "Ce travail a été déplacé à deux endroits",
            "calendarFeed.conflictDescription": "Choisissez l'horaire à conserver. Loonext mettra l'autre copie à jour.",
            "calendarFeed.conflictProviderRemoved": "Le conflit attend toujours votre décision, mais l'événement du calendrier a depuis été supprimé. Conservez l'horaire Loonext pour le recréer, ou laissez ce conflit signalé.",
            "calendarFeed.conflictProviderRefused": "Le conflit attend toujours votre décision, mais l'événement du calendrier n'a plus d'horaire utilisable. Conservez l'horaire Loonext pour le réparer, ou laissez ce conflit signalé.",
            "calendarFeed.removedTitle": "Cet événement a été retiré de votre calendrier",
            "calendarFeed.removedDescription": "Indiquez à Loonext si le travail a été annulé ou déplacé. Ses rappels restent en pause jusqu'à votre décision.",
            "calendarFeed.refusedAllDayTitle": "Ce travail est devenu un événement d'une journée entière",
            "calendarFeed.refusedAllDayDescription": "Loonext a besoin d'une heure de début réelle avant de planifier le travail ou d'envoyer un rappel. Ajoutez une heure dans votre calendrier; elle sera synchronisée à la prochaine vérification.",
            "calendarFeed.refusedTimeTitle": "Cet événement de calendrier a une heure invalide",
            "calendarFeed.refusedTimeDescription": "Choisissez une heure de début valide et une heure de fin plus tardive dans votre calendrier; il sera synchronisé à la prochaine vérification.",
            "calendarFeed.refusedZoneTitle": "Ce fuseau horaire du calendrier n'est pas pris en charge",
            "calendarFeed.refusedZoneDescription": "Choisissez un fuseau horaire standard pour l'événement dans votre calendrier; il sera synchronisé à la prochaine vérification.",
            "calendarFeed.refusedTitleTitle": "Cet événement de calendrier a besoin d'un titre de travail valide",
            "calendarFeed.refusedTitleDescription": "Ajoutez dans votre calendrier un titre de 500 caractères ou moins; il sera synchronisé à la prochaine vérification.",
            "calendarFeed.refusedDescriptionTitle": "Cet événement de calendrier contient trop de détails sur le travail",
            "calendarFeed.refusedDescriptionDescription": "Raccourcissez la description à 5 000 caractères ou moins; Loonext ne la coupera ni ne l'importera jamais en silence.",
            "calendarFeed.refusedWindowTitle": "Cet événement a été déplacé hors de la période de synchronisation",
            "calendarFeed.refusedWindowDescription": "Déplacez-le à une date allant de 90 jours dans le passé à 365 jours dans le futur, ou gérez ce travail manuellement.",
            "calendarFeed.refusedMeetingTitle": "Cet événement a maintenant des invités ou une réunion en ligne",
            "calendarFeed.refusedMeetingDescription": "Loonext a suspendu les changements automatiques pour ne pas avertir les invités ni endommager la réunion. Retirez les invités ou la réunion avant de reprendre la synchronisation.",
            "calendarFeed.refusedRecurrenceTitle": "Ce travail est devenu un événement récurrent",
            "calendarFeed.refusedRecurrenceDescription": "Rétablissez un seul événement avant de reprendre la synchronisation. Loonext ne devinera pas quelle occurrence correspond au travail.",
            "calendarFeed.refusedUnknownTitle": "Cet événement de calendrier doit être vérifié",
            "calendarFeed.refusedUnknownDescription": "Loonext a suspendu cet événement parce que le changement du fournisseur ne pouvait pas être traité de façon sûre. Vérifiez l'événement avant de réessayer.",
            "calendarFeed.loonextSchedule": "Horaire Loonext",
            "calendarFeed.providerSchedule": "Horaire {provider}",
            "calendarFeed.differencesTitle": "Ce qui diffère",
            "calendarFeed.startDifference": "Heure de début différente",
            "calendarFeed.endDifference": "Heure de fin différente",
            "calendarFeed.timeZoneDifference": "Fuseau horaire différent",
            "calendarFeed.titleDifference": "Titre du travail différent",
            "calendarFeed.descriptionChanged": "Les notes du travail diffèrent aussi. Votre choix conserve également les notes de cette copie.",
            "calendarFeed.scheduleStart": "Début",
            "calendarFeed.scheduleEnd": "Fin",
            "calendarFeed.scheduleTimeZone": "Fuseau horaire",
            "calendarFeed.scheduleTitle": "Titre du travail",
            "calendarFeed.loonextChangedByAt": "{name} a modifié l'horaire Loonext le {when}.",
            "calendarFeed.loonextChangedAt": "L'horaire Loonext a été modifié le {when}.",
            "calendarFeed.providerObservedAt": "Loonext a observé l'horaire {provider} le {when}.",
            "calendarFeed.conflictDetectedAt": "Conflit détecté le {when}.",
            "calendarFeed.openTask": "Ouvrir le travail",
            "calendarFeed.useLoonext": "Garder l'horaire Loonext",
            "calendarFeed.useCalendar": "Garder l'horaire du calendrier",
            "calendarFeed.cancelJob": "Le travail a été annulé",
            "calendarFeed.movedJob": "Le travail a été déplacé",
            "calendarFeed.newDateLabel": "Nouvelle date et heure",
            "calendarFeed.newDateTimeZone": "Cette heure est dans le fuseau {zone}.",
            "calendarFeed.saveMovedDate": "Enregistrer la nouvelle heure",
            "calendarFeed.notSure": "Pas certain pour l'instant",
            "calendarFeed.resolving": "Enregistrement de la décision…",
            "calendarFeed.resolutionSaved": "Décision d'horaire enregistrée.",
            "calendarFeed.resolutionFailed": "Cette décision n'a pas pu être enregistrée. Réessayez.",
            "calendarFeed.movedDateRequired": "Choisissez d'abord la nouvelle date et l'heure.",
            "calendarFeed.movedDateAmbiguous": "Cette heure se produit deux fois à la fin de l'heure avancée. Choisissez une autre heure.",
            "calendarFeed.movedDateNonexistent": "Cette heure n'existe pas au début de l'heure avancée. Choisissez une autre heure.",
            "calendarFeed.reauthorize": "Reconnecter",
            "calendarFeed.disconnect": "Déconnecter",
            "calendarFeed.disconnectConfirm": "Déconnecter et arrêter la synchronisation",
            "calendarFeed.connectedToast": "Calendrier connecté.",
            "calendarFeed.replacementRequiresDisconnect": "Un autre calendrier est déjà connecté. Déconnectez-le avant de connecter celui-ci.",
            "calendarFeed.disconnectInProgress": "Le nettoyage du calendrier est toujours en cours. Attendez qu’il soit terminé avant de vous reconnecter.",
            "calendarFeed.disconnectedToast": "Calendrier déconnecté.",
            "calendarFeed.authorizationFailed": "La connexion au calendrier n'a pas pu être terminée. Réessayez.",
            "calendarFeed.disconnectFailed": "Ce calendrier n'a pas pu être déconnecté. Réessayez.",
            "calendarFeed.connectionsLoading": "Chargement des connexions de calendrier…",
            "calendarFeed.connectionsLoadFailed": "Vos connexions de calendrier n'ont pas pu être chargées.",
            "calendarFeed.retryConnections": "Réessayer",
            "calendarFeed.readOnlyFallback": "Utiliser plutôt le flux de calendrier en lecture seule",
        ]
    )
}
