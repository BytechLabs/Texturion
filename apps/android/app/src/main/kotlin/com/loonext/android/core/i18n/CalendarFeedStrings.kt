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

        "calendarFeed.twoWayTitle" to "Two-way calendar sync",
        "calendarFeed.twoWayDescription" to "Reschedule an assigned job in Loonext or its linked calendar event and the other copy follows.",
        "calendarFeed.twoWayDisclosure" to "Loonext creates calendar events for scheduled jobs assigned to you and checks those linked events for schedule changes. It never imports unrelated events or invites customers. Connecting revokes your existing read-only calendar feed so each job appears once.",
        "calendarFeed.googleProvider" to "Google Calendar",
        "calendarFeed.microsoftProvider" to "Microsoft 365",
        "calendarFeed.connectGoogle" to "Connect Google Calendar",
        "calendarFeed.connectMicrosoft" to "Connect Microsoft 365",
        "calendarFeed.connecting" to "Opening calendar sign-in…",
        "calendarFeed.providerUnavailable" to "{provider} is not available in this workspace.",
        "calendarFeed.connected" to "Connected",
        "calendarFeed.reauthRequired" to "Reconnect required",
        "calendarFeed.disconnected" to "Disconnected",
        "calendarFeed.needsAttention" to "Needs attention",
        "calendarFeed.calendarNamed" to "Calendar: {calendar}",
        "calendarFeed.verificationLabel" to "Verification",
        "calendarFeed.synchronizationLabel" to "Synchronization",
        "calendarFeed.lastVerified" to "Last verified {when}",
        "calendarFeed.neverVerified" to "Not verified yet",
        "calendarFeed.lastSynced" to "Last synced {when}",
        "calendarFeed.neverSynced" to "Not synced yet",
        "calendarFeed.connectionError" to "Loonext could not verify this calendar. Reconnect it to resume syncing.",
        "calendarFeed.connectionRetrying" to "A calendar update failed. Loonext will retry automatically.",
        "calendarFeed.connectionStale" to "Calendar sync has not been verified recently. Reminders stay paused until verification succeeds.",
        "calendarFeed.connectionCleanupFailed" to "Loonext disconnected this calendar but could not confirm removal of old Loonext data at the provider. Review that calendar and its access.",
        "calendarFeed.connectionDisconnecting" to "Loonext is removing its calendar watch and finishing linked-event cleanup. Reconnect is available after this finishes.",
        "calendarFeed.conflictsOne" to "One scheduling conflict needs your decision.",
        "calendarFeed.conflictsMany" to "{count} scheduling conflicts need your decision.",
        "calendarFeed.attentionTitle" to "Schedule decisions",
        "calendarFeed.attentionDescription" to "Loonext paused these jobs instead of guessing which schedule is right.",
        "calendarFeed.attentionLoading" to "Loading schedule decisions…",
        "calendarFeed.attentionLoadFailed" to "Your schedule decisions could not be loaded.",
        "calendarFeed.attentionRetry" to "Try again",
        "calendarFeed.conflictTitle" to "This job moved in two places",
        "calendarFeed.conflictDescription" to "Choose the schedule to keep. Loonext will update the other copy.",
        "calendarFeed.conflictProviderRemoved" to "The conflict still needs your decision, but the calendar event has since been removed. Keep the Loonext schedule to recreate it, or leave this flagged.",
        "calendarFeed.conflictProviderRefused" to "The conflict still needs your decision, but the calendar event no longer has a usable schedule. Keep the Loonext schedule to repair it, or leave this flagged.",
        "calendarFeed.removedTitle" to "This event was removed from your calendar",
        "calendarFeed.removedDescription" to "Tell Loonext whether the job was cancelled or moved. Its reminders stay paused until you decide.",
        "calendarFeed.refusedAllDayTitle" to "This job became an all-day event",
        "calendarFeed.refusedAllDayDescription" to "Loonext needs a real start time before it can schedule the job or send a reminder. Add a time in your calendar; it will sync on the next check.",
        "calendarFeed.refusedTimeTitle" to "This calendar event has an invalid time",
        "calendarFeed.refusedTimeDescription" to "Choose a valid start and a later end time in your calendar; it will sync on the next check.",
        "calendarFeed.refusedZoneTitle" to "This calendar time zone is not supported",
        "calendarFeed.refusedZoneDescription" to "Choose a standard time zone for the event in your calendar; it will sync on the next check.",
        "calendarFeed.refusedTitleTitle" to "This calendar event needs a valid job title",
        "calendarFeed.refusedTitleDescription" to "Add a title of 500 characters or fewer in your calendar; it will sync on the next check.",
        "calendarFeed.refusedDescriptionTitle" to "This calendar event has too much job detail",
        "calendarFeed.refusedDescriptionDescription" to "Shorten the event description to 5,000 characters or fewer; Loonext will never cut or import it silently.",
        "calendarFeed.refusedWindowTitle" to "This event moved outside the sync window",
        "calendarFeed.refusedWindowDescription" to "Move it to a date from 90 days ago through 365 days ahead, or manage this job manually.",
        "calendarFeed.refusedMeetingTitle" to "This event now has guests or an online meeting",
        "calendarFeed.refusedMeetingDescription" to "Loonext paused automatic changes so it cannot notify guests or damage meeting details. Remove the guests or meeting before syncing it again.",
        "calendarFeed.refusedRecurrenceTitle" to "This job became a recurring event",
        "calendarFeed.refusedRecurrenceDescription" to "Change it back to one event before syncing. Loonext will not guess which occurrence is the job.",
        "calendarFeed.refusedUnknownTitle" to "This calendar event needs review",
        "calendarFeed.refusedUnknownDescription" to "Loonext paused this event because it could not handle the provider change safely. Review the event before trying again.",
        "calendarFeed.loonextSchedule" to "Loonext schedule",
        "calendarFeed.providerSchedule" to "{provider} schedule",
        "calendarFeed.differencesTitle" to "What differs",
        "calendarFeed.startDifference" to "Different start time",
        "calendarFeed.endDifference" to "Different end time",
        "calendarFeed.timeZoneDifference" to "Different time zone",
        "calendarFeed.titleDifference" to "Different job title",
        "calendarFeed.descriptionChanged" to "The job notes differ too. Your choice also keeps that copy's notes.",
        "calendarFeed.scheduleStart" to "Starts",
        "calendarFeed.scheduleEnd" to "Ends",
        "calendarFeed.scheduleTimeZone" to "Time zone",
        "calendarFeed.scheduleTitle" to "Job title",
        "calendarFeed.loonextChangedByAt" to "{name} changed the Loonext schedule on {when}.",
        "calendarFeed.loonextChangedAt" to "The Loonext schedule changed on {when}.",
        "calendarFeed.providerObservedAt" to "Loonext observed the {provider} schedule on {when}.",
        "calendarFeed.conflictDetectedAt" to "Conflict detected on {when}.",
        "calendarFeed.openTask" to "Open job",
        "calendarFeed.useLoonext" to "Keep Loonext schedule",
        "calendarFeed.useCalendar" to "Keep calendar schedule",
        "calendarFeed.cancelJob" to "The job was cancelled",
        "calendarFeed.movedJob" to "The job was moved",
        "calendarFeed.newDateLabel" to "New date and time",
        "calendarFeed.newDateTimeZone" to "This time is in {zone}.",
        "calendarFeed.saveMovedDate" to "Save new time",
        "calendarFeed.notSure" to "Not sure yet",
        "calendarFeed.resolving" to "Saving decision…",
        "calendarFeed.resolutionSaved" to "Schedule decision saved.",
        "calendarFeed.resolutionFailed" to "That decision could not be saved. Try again.",
        "calendarFeed.movedDateRequired" to "Choose the new date and time first.",
        "calendarFeed.movedDateAmbiguous" to "That clock time happens twice because daylight saving time ends. Choose a different time.",
        "calendarFeed.movedDateNonexistent" to "That clock time does not exist because daylight saving time starts. Choose a different time.",
        "calendarFeed.reauthorize" to "Reconnect",
        "calendarFeed.disconnect" to "Disconnect",
        "calendarFeed.disconnectConfirm" to "Disconnect and stop syncing",
        "calendarFeed.connectedToast" to "Calendar connected.",
        "calendarFeed.replacementRequiresDisconnect" to "A different calendar is already connected. Disconnect it before connecting this one.",
        "calendarFeed.disconnectInProgress" to "Calendar cleanup is still in progress. Wait for it to finish before reconnecting.",
        "calendarFeed.disconnectedToast" to "Calendar disconnected.",
        "calendarFeed.authorizationFailed" to "Calendar sign-in could not be completed. Try again.",
        "calendarFeed.disconnectFailed" to "That calendar could not be disconnected. Try again.",
        "calendarFeed.connectionsLoading" to "Loading calendar connections…",
        "calendarFeed.connectionsLoadFailed" to "Your calendar connections could not be loaded.",
        "calendarFeed.retryConnections" to "Try again",
        "calendarFeed.readOnlyFallback" to "Use the read-only calendar feed instead",
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

        "calendarFeed.twoWayTitle" to "Synchronisation bidirectionnelle du calendrier",
        "calendarFeed.twoWayDescription" to "Replanifiez un travail qui vous est attribué dans Loonext ou son événement de calendrier lié; l'autre copie suivra.",
        "calendarFeed.twoWayDisclosure" to "Loonext crée des événements de calendrier pour les travaux planifiés qui vous sont attribués et vérifie les changements d'horaire de ces événements liés. Il n'importe jamais les événements sans lien et n'invite jamais de clients. La connexion révoque votre flux de calendrier existant en lecture seule afin que chaque travail n'apparaisse qu'une fois.",
        "calendarFeed.googleProvider" to "Google Agenda",
        "calendarFeed.microsoftProvider" to "Microsoft 365",
        "calendarFeed.connectGoogle" to "Connecter Google Agenda",
        "calendarFeed.connectMicrosoft" to "Connecter Microsoft 365",
        "calendarFeed.connecting" to "Ouverture de la connexion au calendrier…",
        "calendarFeed.providerUnavailable" to "{provider} n'est pas disponible dans cet espace de travail.",
        "calendarFeed.connected" to "Connecté",
        "calendarFeed.reauthRequired" to "Reconnexion requise",
        "calendarFeed.disconnected" to "Déconnecté",
        "calendarFeed.needsAttention" to "Nécessite votre attention",
        "calendarFeed.calendarNamed" to "Calendrier : {calendar}",
        "calendarFeed.verificationLabel" to "Vérification",
        "calendarFeed.synchronizationLabel" to "Synchronisation",
        "calendarFeed.lastVerified" to "Dernière vérification : {when}",
        "calendarFeed.neverVerified" to "Pas encore vérifié",
        "calendarFeed.lastSynced" to "Dernière synchronisation : {when}",
        "calendarFeed.neverSynced" to "Pas encore synchronisé",
        "calendarFeed.connectionError" to "Loonext n'a pas pu vérifier ce calendrier. Reconnectez-le pour reprendre la synchronisation.",
        "calendarFeed.connectionRetrying" to "Une mise à jour du calendrier a échoué. Loonext réessaiera automatiquement.",
        "calendarFeed.connectionStale" to "La synchronisation du calendrier n'a pas été vérifiée récemment. Les rappels restent en pause jusqu'à une vérification réussie.",
        "calendarFeed.connectionCleanupFailed" to "Loonext a déconnecté ce calendrier, mais n'a pas pu confirmer la suppression des anciennes données Loonext chez le fournisseur. Vérifiez ce calendrier et ses accès.",
        "calendarFeed.connectionDisconnecting" to "Loonext retire la surveillance du calendrier et termine le nettoyage des événements liés. La reconnexion sera disponible ensuite.",
        "calendarFeed.conflictsOne" to "Un conflit d'horaire attend votre décision.",
        "calendarFeed.conflictsMany" to "{count} conflits d'horaire attendent votre décision.",
        "calendarFeed.attentionTitle" to "Décisions d'horaire",
        "calendarFeed.attentionDescription" to "Loonext a mis ces travaux en pause au lieu de deviner quel horaire est le bon.",
        "calendarFeed.attentionLoading" to "Chargement des décisions d'horaire…",
        "calendarFeed.attentionLoadFailed" to "Vos décisions d'horaire n'ont pas pu être chargées.",
        "calendarFeed.attentionRetry" to "Réessayer",
        "calendarFeed.conflictTitle" to "Ce travail a été déplacé à deux endroits",
        "calendarFeed.conflictDescription" to "Choisissez l'horaire à conserver. Loonext mettra l'autre copie à jour.",
        "calendarFeed.conflictProviderRemoved" to "Le conflit attend toujours votre décision, mais l'événement du calendrier a depuis été supprimé. Conservez l'horaire Loonext pour le recréer, ou laissez ce conflit signalé.",
        "calendarFeed.conflictProviderRefused" to "Le conflit attend toujours votre décision, mais l'événement du calendrier n'a plus d'horaire utilisable. Conservez l'horaire Loonext pour le réparer, ou laissez ce conflit signalé.",
        "calendarFeed.removedTitle" to "Cet événement a été retiré de votre calendrier",
        "calendarFeed.removedDescription" to "Indiquez à Loonext si le travail a été annulé ou déplacé. Ses rappels restent en pause jusqu'à votre décision.",
        "calendarFeed.refusedAllDayTitle" to "Ce travail est devenu un événement d'une journée entière",
        "calendarFeed.refusedAllDayDescription" to "Loonext a besoin d'une heure de début réelle avant de planifier le travail ou d'envoyer un rappel. Ajoutez une heure dans votre calendrier; elle sera synchronisée à la prochaine vérification.",
        "calendarFeed.refusedTimeTitle" to "Cet événement de calendrier a une heure invalide",
        "calendarFeed.refusedTimeDescription" to "Choisissez une heure de début valide et une heure de fin plus tardive dans votre calendrier; il sera synchronisé à la prochaine vérification.",
        "calendarFeed.refusedZoneTitle" to "Ce fuseau horaire du calendrier n'est pas pris en charge",
        "calendarFeed.refusedZoneDescription" to "Choisissez un fuseau horaire standard pour l'événement dans votre calendrier; il sera synchronisé à la prochaine vérification.",
        "calendarFeed.refusedTitleTitle" to "Cet événement de calendrier a besoin d'un titre de travail valide",
        "calendarFeed.refusedTitleDescription" to "Ajoutez dans votre calendrier un titre de 500 caractères ou moins; il sera synchronisé à la prochaine vérification.",
        "calendarFeed.refusedDescriptionTitle" to "Cet événement de calendrier contient trop de détails sur le travail",
        "calendarFeed.refusedDescriptionDescription" to "Raccourcissez la description à 5 000 caractères ou moins; Loonext ne la coupera ni ne l'importera jamais en silence.",
        "calendarFeed.refusedWindowTitle" to "Cet événement a été déplacé hors de la période de synchronisation",
        "calendarFeed.refusedWindowDescription" to "Déplacez-le à une date allant de 90 jours dans le passé à 365 jours dans le futur, ou gérez ce travail manuellement.",
        "calendarFeed.refusedMeetingTitle" to "Cet événement a maintenant des invités ou une réunion en ligne",
        "calendarFeed.refusedMeetingDescription" to "Loonext a suspendu les changements automatiques pour ne pas avertir les invités ni endommager la réunion. Retirez les invités ou la réunion avant de reprendre la synchronisation.",
        "calendarFeed.refusedRecurrenceTitle" to "Ce travail est devenu un événement récurrent",
        "calendarFeed.refusedRecurrenceDescription" to "Rétablissez un seul événement avant de reprendre la synchronisation. Loonext ne devinera pas quelle occurrence correspond au travail.",
        "calendarFeed.refusedUnknownTitle" to "Cet événement de calendrier doit être vérifié",
        "calendarFeed.refusedUnknownDescription" to "Loonext a suspendu cet événement parce que le changement du fournisseur ne pouvait pas être traité de façon sûre. Vérifiez l'événement avant de réessayer.",
        "calendarFeed.loonextSchedule" to "Horaire Loonext",
        "calendarFeed.providerSchedule" to "Horaire {provider}",
        "calendarFeed.differencesTitle" to "Ce qui diffère",
        "calendarFeed.startDifference" to "Heure de début différente",
        "calendarFeed.endDifference" to "Heure de fin différente",
        "calendarFeed.timeZoneDifference" to "Fuseau horaire différent",
        "calendarFeed.titleDifference" to "Titre du travail différent",
        "calendarFeed.descriptionChanged" to "Les notes du travail diffèrent aussi. Votre choix conserve également les notes de cette copie.",
        "calendarFeed.scheduleStart" to "Début",
        "calendarFeed.scheduleEnd" to "Fin",
        "calendarFeed.scheduleTimeZone" to "Fuseau horaire",
        "calendarFeed.scheduleTitle" to "Titre du travail",
        "calendarFeed.loonextChangedByAt" to "{name} a modifié l'horaire Loonext le {when}.",
        "calendarFeed.loonextChangedAt" to "L'horaire Loonext a été modifié le {when}.",
        "calendarFeed.providerObservedAt" to "Loonext a observé l'horaire {provider} le {when}.",
        "calendarFeed.conflictDetectedAt" to "Conflit détecté le {when}.",
        "calendarFeed.openTask" to "Ouvrir le travail",
        "calendarFeed.useLoonext" to "Garder l'horaire Loonext",
        "calendarFeed.useCalendar" to "Garder l'horaire du calendrier",
        "calendarFeed.cancelJob" to "Le travail a été annulé",
        "calendarFeed.movedJob" to "Le travail a été déplacé",
        "calendarFeed.newDateLabel" to "Nouvelle date et heure",
        "calendarFeed.newDateTimeZone" to "Cette heure est dans le fuseau {zone}.",
        "calendarFeed.saveMovedDate" to "Enregistrer la nouvelle heure",
        "calendarFeed.notSure" to "Pas certain pour l'instant",
        "calendarFeed.resolving" to "Enregistrement de la décision…",
        "calendarFeed.resolutionSaved" to "Décision d'horaire enregistrée.",
        "calendarFeed.resolutionFailed" to "Cette décision n'a pas pu être enregistrée. Réessayez.",
        "calendarFeed.movedDateRequired" to "Choisissez d'abord la nouvelle date et l'heure.",
        "calendarFeed.movedDateAmbiguous" to "Cette heure se produit deux fois à la fin de l'heure avancée. Choisissez une autre heure.",
        "calendarFeed.movedDateNonexistent" to "Cette heure n'existe pas au début de l'heure avancée. Choisissez une autre heure.",
        "calendarFeed.reauthorize" to "Reconnecter",
        "calendarFeed.disconnect" to "Déconnecter",
        "calendarFeed.disconnectConfirm" to "Déconnecter et arrêter la synchronisation",
        "calendarFeed.connectedToast" to "Calendrier connecté.",
        "calendarFeed.replacementRequiresDisconnect" to "Un autre calendrier est déjà connecté. Déconnectez-le avant de connecter celui-ci.",
        "calendarFeed.disconnectInProgress" to "Le nettoyage du calendrier est toujours en cours. Attendez qu’il soit terminé avant de vous reconnecter.",
        "calendarFeed.disconnectedToast" to "Calendrier déconnecté.",
        "calendarFeed.authorizationFailed" to "La connexion au calendrier n'a pas pu être terminée. Réessayez.",
        "calendarFeed.disconnectFailed" to "Ce calendrier n'a pas pu être déconnecté. Réessayez.",
        "calendarFeed.connectionsLoading" to "Chargement des connexions de calendrier…",
        "calendarFeed.connectionsLoadFailed" to "Vos connexions de calendrier n'ont pas pu être chargées.",
        "calendarFeed.retryConnections" to "Réessayer",
        "calendarFeed.readOnlyFallback" to "Utiliser plutôt le flux de calendrier en lecture seule",
    )
}
