import type { Translated } from "../translated";

/**
 * #245 — the words the schedule-feed card says, in both languages.
 *
 * ## Register
 *
 * Written for the crew member, not for whoever will implement the sync later.
 * So: "your calendar", "your scheduled work" — never "ICS", "iCalendar",
 * "endpoint" or "subscription URL" in the body copy. The one place the format
 * is named at all is where somebody has to recognise it in their calendar app's
 * own dialog, and even there it is described rather than abbreviated.
 *
 * ## What the copy has to carry that the UI cannot
 *
 * Two facts, both of which cost somebody an afternoon if they are missing:
 *
 * 1. The URL is shown ONCE. The server keeps a hash, so there is no screen
 *    anywhere that can show it again — losing it means rotating, and rotating
 *    breaks the calendar they already set up. Said before they generate it, not
 *    after.
 * 2. Anyone holding the URL can read that schedule. It is a password in the
 *    shape of a link, and it will be pasted into a third-party app, so the
 *    warning has to be in the words rather than implied by the amber border.
 */
export const calendarFeedEn = {
  title: "Your schedule in your calendar",
  description:
    "Add your scheduled jobs to Google Calendar, Apple Calendar, Outlook or any other calendar app. It updates on its own — you only set it up once.",

  create: "Set up my calendar",
  rotate: "Get a new link",
  revoke: "Turn it off",
  /** The second press. Says what breaks, rather than asking "are you sure". */
  revokeConfirm: "Turn it off — my calendar stops updating",

  shownOnceTitle: "Copy this link now",
  shownOnceDetail:
    "This is the only time you will see it. Paste it into your calendar app to subscribe. Anyone with this link can see your scheduled jobs, so keep it to yourself — if it gets out, get a new link and the old one stops working.",
  copy: "Copy link",
  copied: "Copied",
  done: "Done",

  /** The fact that answers "did I finish setting this up?". */
  lastRead: "Your calendar last checked {when}",
  neverRead:
    "Your calendar has not checked yet. It usually takes a few minutes after you subscribe.",

  failed: "That didn't go through. Try again.",

  twoWayTitle: "Two-way calendar sync",
  twoWayDescription:
    "Reschedule an assigned job in Loonext or its linked calendar event and the other copy follows.",
  twoWayDisclosure:
    "Loonext creates calendar events for scheduled jobs assigned to you and checks those linked events for schedule changes. It never imports unrelated events or invites customers. Connecting revokes your existing read-only calendar feed so each job appears once.",

  googleProvider: "Google Calendar",
  microsoftProvider: "Microsoft 365",
  connectGoogle: "Connect Google Calendar",
  connectMicrosoft: "Connect Microsoft 365",
  connecting: "Opening calendar sign-in…",
  providerUnavailable: "{provider} is not available in this workspace.",

  connected: "Connected",
  reauthRequired: "Reconnect required",
  disconnected: "Disconnected",
  needsAttention: "Needs attention",
  calendarNamed: "Calendar: {calendar}",
  verificationLabel: "Verification",
  synchronizationLabel: "Synchronization",
  lastVerified: "Last verified {when}",
  neverVerified: "Not verified yet",
  lastSynced: "Last synced {when}",
  neverSynced: "Not synced yet",
  connectionError:
    "Loonext could not verify this calendar. Reconnect it to resume syncing.",
  connectionRetrying:
    "A calendar update failed. Loonext will retry automatically.",
  connectionStale:
    "Calendar sync has not been verified recently. Reminders stay paused until verification succeeds.",
  connectionCleanupFailed:
    "Loonext disconnected this calendar but could not confirm removal of old Loonext data at the provider. Review that calendar and its access.",
  connectionDisconnecting:
    "Loonext is removing its calendar watch and finishing linked-event cleanup. Reconnect is available after this finishes.",
  conflictsOne: "One scheduling conflict needs your decision.",
  conflictsMany: "{count} scheduling conflicts need your decision.",

  attentionTitle: "Schedule decisions",
  attentionDescription:
    "Loonext paused these jobs instead of guessing which schedule is right.",
  attentionLoading: "Loading schedule decisions…",
  attentionLoadFailed: "Your schedule decisions could not be loaded.",
  attentionRetry: "Try again",
  conflictTitle: "This job moved in two places",
  conflictDescription:
    "Choose the schedule to keep. Loonext will update the other copy.",
  conflictProviderRemoved:
    "The conflict still needs your decision, but the calendar event has since been removed. Keep the Loonext schedule to recreate it, or leave this flagged.",
  conflictProviderRefused:
    "The conflict still needs your decision, but the calendar event no longer has a usable schedule. Keep the Loonext schedule to repair it, or leave this flagged.",
  removedTitle: "This event was removed from your calendar",
  removedDescription:
    "Tell Loonext whether the job was cancelled or moved. Its reminders stay paused until you decide.",
  refusedAllDayTitle: "This job became an all-day event",
  refusedAllDayDescription:
    "Loonext needs a real start time before it can schedule the job or send a reminder. Add a time in your calendar; it will sync on the next check.",
  refusedTimeTitle: "This calendar event has an invalid time",
  refusedTimeDescription:
    "Choose a valid start and a later end time in your calendar; it will sync on the next check.",
  refusedZoneTitle: "This calendar time zone is not supported",
  refusedZoneDescription:
    "Choose a standard time zone for the event in your calendar; it will sync on the next check.",
  refusedTitleTitle: "This calendar event needs a valid job title",
  refusedTitleDescription:
    "Add a title of 500 characters or fewer in your calendar; it will sync on the next check.",
  refusedDescriptionTitle: "This calendar event has too much job detail",
  refusedDescriptionDescription:
    "Shorten the event description to 5,000 characters or fewer; Loonext will never cut or import it silently.",
  refusedWindowTitle: "This event moved outside the sync window",
  refusedWindowDescription:
    "Move it to a date from 90 days ago through 365 days ahead, or manage this job manually.",
  refusedMeetingTitle: "This event now has guests or an online meeting",
  refusedMeetingDescription:
    "Loonext paused automatic changes so it cannot notify guests or damage meeting details. Remove the guests or meeting before syncing it again.",
  refusedRecurrenceTitle: "This job became a recurring event",
  refusedRecurrenceDescription:
    "Change it back to one event before syncing. Loonext will not guess which occurrence is the job.",
  refusedUnknownTitle: "This calendar event needs review",
  refusedUnknownDescription:
    "Loonext paused this event because it could not handle the provider change safely. Review the event before trying again.",
  loonextSchedule: "Loonext schedule",
  providerSchedule: "{provider} schedule",
  differencesTitle: "What differs",
  startDifference: "Different start time",
  endDifference: "Different end time",
  timeZoneDifference: "Different time zone",
  titleDifference: "Different job title",
  descriptionChanged:
    "The job notes differ too. Your choice also keeps that copy's notes.",
  scheduleStart: "Starts",
  scheduleEnd: "Ends",
  scheduleTimeZone: "Time zone",
  scheduleTitle: "Job title",
  loonextChangedByAt: "{name} changed the Loonext schedule on {when}.",
  loonextChangedAt: "The Loonext schedule changed on {when}.",
  providerObservedAt: "Loonext observed the {provider} schedule on {when}.",
  conflictDetectedAt: "Conflict detected on {when}.",
  openTask: "Open job",
  useLoonext: "Keep Loonext schedule",
  useCalendar: "Keep calendar schedule",
  cancelJob: "The job was cancelled",
  movedJob: "The job was moved",
  newDateLabel: "New date and time",
  newDateTimeZone: "This time is in {zone}.",
  saveMovedDate: "Save new time",
  notSure: "Not sure yet",
  resolving: "Saving decision…",
  resolutionSaved: "Schedule decision saved.",
  resolutionFailed: "That decision could not be saved. Try again.",
  movedDateRequired: "Choose the new date and time first.",
  movedDateAmbiguous:
    "That clock time happens twice because daylight saving time ends. Choose a different time.",
  movedDateNonexistent:
    "That clock time does not exist because daylight saving time starts. Choose a different time.",

  reauthorize: "Reconnect",
  disconnect: "Disconnect",
  disconnectConfirm: "Disconnect and stop syncing",
  connectedToast: "Calendar connected.",
  replacementRequiresDisconnect:
    "A different calendar is already connected. Disconnect it before connecting this one.",
  disconnectInProgress:
    "Calendar cleanup is still in progress. Wait for it to finish before reconnecting.",
  disconnectedToast: "Calendar disconnected.",
  authorizationFailed: "Calendar sign-in could not be completed. Try again.",
  disconnectFailed: "That calendar could not be disconnected. Try again.",
  connectionsLoading: "Loading calendar connections…",
  connectionsLoadFailed: "Your calendar connections could not be loaded.",
  retryConnections: "Try again",
  readOnlyFallback: "Use the read-only calendar feed instead",
} as const;

export const calendarFeedFr: Translated<typeof calendarFeedEn> = {
  title: "Votre horaire dans votre calendrier",
  description:
    "Ajoutez vos travaux planifiés à Google Agenda, Calendrier Apple, Outlook ou n'importe quelle autre application de calendrier. La mise à jour se fait toute seule — vous ne le configurez qu'une fois.",

  create: "Configurer mon calendrier",
  rotate: "Obtenir un nouveau lien",
  revoke: "Désactiver",
  // The same "say what breaks" rule as the English, kept short enough to fit a
  // button: the consequence, not a confirmation question.
  revokeConfirm: "Désactiver — mon calendrier cesse de se mettre à jour",

  shownOnceTitle: "Copiez ce lien maintenant",
  shownOnceDetail:
    "C'est la seule fois que vous le verrez. Collez-le dans votre application de calendrier pour vous abonner. Toute personne ayant ce lien peut voir vos travaux planifiés, alors gardez-le pour vous — s'il circule, obtenez un nouveau lien et l'ancien cessera de fonctionner.",
  copy: "Copier le lien",
  copied: "Copié",
  done: "Terminé",

  lastRead: "Votre calendrier a vérifié pour la dernière fois {when}",
  neverRead:
    "Votre calendrier n'a pas encore vérifié. Cela prend habituellement quelques minutes après l'abonnement.",

  failed: "Ça n'a pas fonctionné. Réessayez.",

  twoWayTitle: "Synchronisation bidirectionnelle du calendrier",
  twoWayDescription:
    "Replanifiez un travail qui vous est attribué dans Loonext ou son événement de calendrier lié; l'autre copie suivra.",
  twoWayDisclosure:
    "Loonext crée des événements de calendrier pour les travaux planifiés qui vous sont attribués et vérifie les changements d'horaire de ces événements liés. Il n'importe jamais les événements sans lien et n'invite jamais de clients. La connexion révoque votre flux de calendrier existant en lecture seule afin que chaque travail n'apparaisse qu'une fois.",

  googleProvider: "Google Agenda",
  microsoftProvider: "Microsoft 365",
  connectGoogle: "Connecter Google Agenda",
  connectMicrosoft: "Connecter Microsoft 365",
  connecting: "Ouverture de la connexion au calendrier…",
  providerUnavailable: "{provider} n'est pas disponible dans cet espace de travail.",

  connected: "Connecté",
  reauthRequired: "Reconnexion requise",
  disconnected: "Déconnecté",
  needsAttention: "Nécessite votre attention",
  calendarNamed: "Calendrier : {calendar}",
  verificationLabel: "Vérification",
  synchronizationLabel: "Synchronisation",
  lastVerified: "Dernière vérification : {when}",
  neverVerified: "Pas encore vérifié",
  lastSynced: "Dernière synchronisation : {when}",
  neverSynced: "Pas encore synchronisé",
  connectionError:
    "Loonext n'a pas pu vérifier ce calendrier. Reconnectez-le pour reprendre la synchronisation.",
  connectionRetrying:
    "Une mise à jour du calendrier a échoué. Loonext réessaiera automatiquement.",
  connectionStale:
    "La synchronisation du calendrier n'a pas été vérifiée récemment. Les rappels restent en pause jusqu'à une vérification réussie.",
  connectionCleanupFailed:
    "Loonext a déconnecté ce calendrier, mais n'a pas pu confirmer la suppression des anciennes données Loonext chez le fournisseur. Vérifiez ce calendrier et ses accès.",
  connectionDisconnecting:
    "Loonext retire la surveillance du calendrier et termine le nettoyage des événements liés. La reconnexion sera disponible ensuite.",
  conflictsOne: "Un conflit d'horaire attend votre décision.",
  conflictsMany: "{count} conflits d'horaire attendent votre décision.",

  attentionTitle: "Décisions d'horaire",
  attentionDescription:
    "Loonext a mis ces travaux en pause au lieu de deviner quel horaire est le bon.",
  attentionLoading: "Chargement des décisions d'horaire…",
  attentionLoadFailed: "Vos décisions d'horaire n'ont pas pu être chargées.",
  attentionRetry: "Réessayer",
  conflictTitle: "Ce travail a été déplacé à deux endroits",
  conflictDescription:
    "Choisissez l'horaire à conserver. Loonext mettra l'autre copie à jour.",
  conflictProviderRemoved:
    "Le conflit attend toujours votre décision, mais l'événement du calendrier a depuis été supprimé. Conservez l'horaire Loonext pour le recréer, ou laissez ce conflit signalé.",
  conflictProviderRefused:
    "Le conflit attend toujours votre décision, mais l'événement du calendrier n'a plus d'horaire utilisable. Conservez l'horaire Loonext pour le réparer, ou laissez ce conflit signalé.",
  removedTitle: "Cet événement a été retiré de votre calendrier",
  removedDescription:
    "Indiquez à Loonext si le travail a été annulé ou déplacé. Ses rappels restent en pause jusqu'à votre décision.",
  refusedAllDayTitle: "Ce travail est devenu un événement d'une journée entière",
  refusedAllDayDescription:
    "Loonext a besoin d'une heure de début réelle avant de planifier le travail ou d'envoyer un rappel. Ajoutez une heure dans votre calendrier; elle sera synchronisée à la prochaine vérification.",
  refusedTimeTitle: "Cet événement de calendrier a une heure invalide",
  refusedTimeDescription:
    "Choisissez une heure de début valide et une heure de fin plus tardive dans votre calendrier; il sera synchronisé à la prochaine vérification.",
  refusedZoneTitle: "Ce fuseau horaire du calendrier n'est pas pris en charge",
  refusedZoneDescription:
    "Choisissez un fuseau horaire standard pour l'événement dans votre calendrier; il sera synchronisé à la prochaine vérification.",
  refusedTitleTitle:
    "Cet événement de calendrier a besoin d'un titre de travail valide",
  refusedTitleDescription:
    "Ajoutez dans votre calendrier un titre de 500 caractères ou moins; il sera synchronisé à la prochaine vérification.",
  refusedDescriptionTitle:
    "Cet événement de calendrier contient trop de détails sur le travail",
  refusedDescriptionDescription:
    "Raccourcissez la description à 5 000 caractères ou moins; Loonext ne la coupera ni ne l'importera jamais en silence.",
  refusedWindowTitle:
    "Cet événement a été déplacé hors de la période de synchronisation",
  refusedWindowDescription:
    "Déplacez-le à une date allant de 90 jours dans le passé à 365 jours dans le futur, ou gérez ce travail manuellement.",
  refusedMeetingTitle:
    "Cet événement a maintenant des invités ou une réunion en ligne",
  refusedMeetingDescription:
    "Loonext a suspendu les changements automatiques pour ne pas avertir les invités ni endommager la réunion. Retirez les invités ou la réunion avant de reprendre la synchronisation.",
  refusedRecurrenceTitle:
    "Ce travail est devenu un événement récurrent",
  refusedRecurrenceDescription:
    "Rétablissez un seul événement avant de reprendre la synchronisation. Loonext ne devinera pas quelle occurrence correspond au travail.",
  refusedUnknownTitle: "Cet événement de calendrier doit être vérifié",
  refusedUnknownDescription:
    "Loonext a suspendu cet événement parce que le changement du fournisseur ne pouvait pas être traité de façon sûre. Vérifiez l'événement avant de réessayer.",
  loonextSchedule: "Horaire Loonext",
  providerSchedule: "Horaire {provider}",
  differencesTitle: "Ce qui diffère",
  startDifference: "Heure de début différente",
  endDifference: "Heure de fin différente",
  timeZoneDifference: "Fuseau horaire différent",
  titleDifference: "Titre du travail différent",
  descriptionChanged:
    "Les notes du travail diffèrent aussi. Votre choix conserve également les notes de cette copie.",
  scheduleStart: "Début",
  scheduleEnd: "Fin",
  scheduleTimeZone: "Fuseau horaire",
  scheduleTitle: "Titre du travail",
  loonextChangedByAt: "{name} a modifié l'horaire Loonext le {when}.",
  loonextChangedAt: "L'horaire Loonext a été modifié le {when}.",
  providerObservedAt: "Loonext a observé l'horaire {provider} le {when}.",
  conflictDetectedAt: "Conflit détecté le {when}.",
  openTask: "Ouvrir le travail",
  useLoonext: "Garder l'horaire Loonext",
  useCalendar: "Garder l'horaire du calendrier",
  cancelJob: "Le travail a été annulé",
  movedJob: "Le travail a été déplacé",
  newDateLabel: "Nouvelle date et heure",
  newDateTimeZone: "Cette heure est dans le fuseau {zone}.",
  saveMovedDate: "Enregistrer la nouvelle heure",
  notSure: "Pas certain pour l'instant",
  resolving: "Enregistrement de la décision…",
  resolutionSaved: "Décision d'horaire enregistrée.",
  resolutionFailed:
    "Cette décision n'a pas pu être enregistrée. Réessayez.",
  movedDateRequired: "Choisissez d'abord la nouvelle date et l'heure.",
  movedDateAmbiguous:
    "Cette heure se produit deux fois à la fin de l'heure avancée. Choisissez une autre heure.",
  movedDateNonexistent:
    "Cette heure n'existe pas au début de l'heure avancée. Choisissez une autre heure.",

  reauthorize: "Reconnecter",
  disconnect: "Déconnecter",
  disconnectConfirm: "Déconnecter et arrêter la synchronisation",
  connectedToast: "Calendrier connecté.",
  replacementRequiresDisconnect:
    "Un autre calendrier est déjà connecté. Déconnectez-le avant de connecter celui-ci.",
  disconnectInProgress:
    "Le nettoyage du calendrier est toujours en cours. Attendez qu’il soit terminé avant de vous reconnecter.",
  disconnectedToast: "Calendrier déconnecté.",
  authorizationFailed:
    "La connexion au calendrier n'a pas pu être terminée. Réessayez.",
  disconnectFailed: "Ce calendrier n'a pas pu être déconnecté. Réessayez.",
  connectionsLoading: "Chargement des connexions de calendrier…",
  connectionsLoadFailed:
    "Vos connexions de calendrier n'ont pas pu être chargées.",
  retryConnections: "Réessayer",
  readOnlyFallback: "Utiliser plutôt le flux de calendrier en lecture seule",
};
