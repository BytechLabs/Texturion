/**
 * #228 — the words jobs and scheduled sends says, in both languages.
 *
 * One file per surface so the extraction can run in parallel without every
 * change colliding in one catalogue, and so a translator working through a
 * screen sees its strings adjacent rather than sorted by concept.
 *
 * `fr` is typed as `en`'s exact shape: a key added to one and forgotten in the
 * other fails `tsc`. That is the whole reason this is TypeScript rather than
 * the JSON a library would want — a missing key in a JSON message file is a
 * runtime fallback nobody sees until a French reader does.
 *
 * Grouped by the screen a translator would be looking at, not alphabetically:
 * the shared task vocabulary first (it is the reason "Done" is one word here
 * and three keys — a status pill, a button that marks one done, and a board
 * column of finished ones are three different French words), then each surface.
 */
import type { Translated } from "../translated";

export const tasksEn = {
  // -------------------------------------------------------------------------
  // Shared task vocabulary — read by more than one of the four views.
  // -------------------------------------------------------------------------
  unassigned: "Unassigned",
  teammate: "Teammate",
  aTeammate: "A teammate",
  assignee: "Assignee",
  due: "Due",
  statusOpen: "Open",
  statusDone: "Done",
  overdue: "Overdue",
  /** Read aloud before the date, so overdue is not colour-only (WCAG 1.4.1). */
  overdueSrPrefix: "Overdue: ",
  today: "Today",
  tomorrow: "Tomorrow",
  markDone: "Mark done",
  markNotDone: "Mark not done",
  /** Appended to the signed-in member's own name in a picker. */
  youSuffix: " (you)",
  openConversation: "Open conversation",
  tasksLoadFailed:
    "We couldn't load your tasks. Check your connection and try again.",

  // -------------------------------------------------------------------------
  // The calm empty state.
  // -------------------------------------------------------------------------
  emptyFiltered: "Nothing on this list.",
  emptyTitle: "No tasks yet.",
  emptyBody:
    "Promote a message from its ⋯ menu in a conversation to track it as a " +
    "task here.",

  // -------------------------------------------------------------------------
  // The /tasks page and its view switcher.
  // -------------------------------------------------------------------------
  pageTitle: "Tasks",
  viewAria: "Task view",
  viewList: "List",
  viewBoard: "Board",
  viewCalendar: "Calendar",
  viewMap: "Map",

  // -------------------------------------------------------------------------
  // The filter bar: tabs, search, chips, the `+ Filter` popover.
  // -------------------------------------------------------------------------
  statusTabsAria: "Task status",
  tabOpen: "Open",
  tabMine: "Mine",
  tabAll: "All",
  tabDone: "Done",
  searchPlaceholder: "Search tasks",
  searchAria: "Search tasks by title",
  clearSearch: "Clear search",
  /** The chip label when a member has no display name of their own. */
  assigneeChipFallback: "Assignee",
  dueToday: "Due today",
  dueThisWeek: "Due this week",
  removeFilterAria: "Remove {label} filter",
  addFilterAria: "Add filter",
  filter: "Filter",
  filterPlaceholder: "Filter by…",
  noFilters: "No filters.",
  /** A second word somebody might type to find the unassigned filter. */
  keywordNobody: "nobody",

  // -------------------------------------------------------------------------
  // The selection bar over the list (#478).
  // -------------------------------------------------------------------------
  bulkSelectThese: "Select these {count}",
  bulkSelectAllMatching: "Select all matching",
  bulkAssign: "Assign",
  bulkMore: "More",
  bulkVerbMarkedDone: "Marked done",
  bulkVerbMarkedNotDone: "Marked not done",
  bulkVerbAssigned: "Assigned",
  bulkVerbDeleted: "Deleted",
  bulkNounOne: "task",
  bulkNounMany: "tasks",
  bulkFailed: "That didn't go through. Nothing was changed.",

  // -------------------------------------------------------------------------
  // The List view.
  // -------------------------------------------------------------------------
  columnTask: "Task",
  columnStatus: "Status",
  selectRowAria: "Select {title}",
  loadingMore: "Loading…",
  loadMore: "Load more",

  // -------------------------------------------------------------------------
  // The Board view.
  // -------------------------------------------------------------------------
  boardColumnToDo: "To do",
  boardColumnDone: "Done",
  boardColumnAria: "{title} column, {count} tasks",
  boardNothingDone: "Nothing done yet.",
  boardNothingToDo: "Nothing to do.",
  boardMoveToToDo: "Move to To do",
  boardMoveToDone: "Move to Done",

  // -------------------------------------------------------------------------
  // The Calendar view.
  // -------------------------------------------------------------------------
  calendarPreviousWeek: "Previous week",
  calendarPreviousMonth: "Previous month",
  calendarNextWeek: "Next week",
  calendarNextMonth: "Next month",
  calendarRangeAria: "Calendar range",
  calendarRangeMonth: "month",
  calendarRangeWeek: "week",
  dowSun: "Sun",
  dowMon: "Mon",
  dowTue: "Tue",
  dowWed: "Wed",
  dowThu: "Thu",
  dowFri: "Fri",
  dowSat: "Sat",
  calendarLoadFailed:
    "We couldn't load your scheduled tasks. Check your connection and try " +
    "again.",
  /**
   * Three keys because the middle one is emphasised in the markup. Split at the
   * emphasis rather than at a clause, so the French can put "date d'échéance"
   * where French puts it.
   */
  calendarEmptyBefore:
    "No tasks are scheduled in this range. A task appears here once it has a ",
  calendarEmptyDueDate: "due date",
  calendarEmptyAfter:
    ". Set one on a task from its row, the checklist, or its detail drawer, " +
    "then drag it between days to reschedule.",
  rescheduleDayEarlier: "A day earlier",
  rescheduleDayLater: "A day later",
  rescheduleWeekLater: "A week later",
  rescheduleAria: "Reschedule {title}",

  // -------------------------------------------------------------------------
  // The Map view and its lazy Leaflet island.
  // -------------------------------------------------------------------------
  mapGeoUnsupported: "Your browser can't share a location.",
  mapGeoFailed:
    "We couldn't get your location. Check your browser's permission.",
  mapLoadFailed: "We couldn't load the map. Check your connection and try again.",
  mapOnTheMap: "on the map",
  mapWithoutLocation: "without a location",
  /** Reads "Still locating 240 addresses." with the count between the two. */
  mapStillLocating: "Still locating",
  mapAddressOne: "address",
  mapAddressMany: "addresses",
  mapGeocodeBacklogNote:
    "Addresses are looked up a few hundred at a time, so a big import can " +
    "take a few hours to finish plotting.",
  mapLocating: "Locating…",
  mapNearMe: "Near me",
  mapNoMappedAddress:
    "None of these tasks have a mapped address yet. Add an address to a " +
    "contact and it appears here once geocoded.",
  mapYouAreHere: "You are here",
  mapTilesFailing:
    "The street background isn't loading right now. Job pins are still exact, " +
    "and we're looking at it.",
  mapOpenTask: "Open task",
  mapDirections: "Directions",
  mapTasksHere: "{count} tasks here",
  mapMoreZoomIn: "+{count} more, zoom in",
  mapZoomIn: "Zoom in",

  // -------------------------------------------------------------------------
  // The task detail panel — the drawer and the /tasks/[id] route.
  // -------------------------------------------------------------------------
  detailNotFound: "This task doesn't exist or was removed.",
  detailLoadFailed: "We couldn't load this task.",
  titleAria: "Task title",
  actionsAria: "Task actions",
  /** The menu item that marks the task done, as a verb. */
  markDoneAction: "Done",
  deleteTask: "Delete task",
  doneNeedsAccessTitle:
    "Marking this done needs access to the conversation it came from",
  accessNoticeAria: "Access notice",
  noAccessNotice:
    "This task is linked to a number you don't have access to. You can see " +
    "the task, but not its messages, files, or discussion — ask an owner or " +
    "admin for access.",
  sourceMessageAria: "Source message",
  fromThisMessage: "From this message",
  /** Stands in for the body of a source message that was only a picture. */
  sourcePhotoOnly: "A photo",
  viewInConversation: "View in conversation",
  clearDue: "Clear",
  remindCustomer: "Remind this customer",
  remindCustomerAria: "Remind this customer about this job",
  remindersOffForJob: "Off for this job. Nothing goes out about it.",
  remindersFromWorkspace: "Uses your workspace reminders.",
  confirmedByCustomer: "They confirmed they'll be there.",
  confirmedByCrew: "Marked confirmed by your crew.",
  description: "Description",
  descriptionPlaceholder: "Add details for your crew…",
  attachments: "Attachments",
  activity: "Activity",
  noActivity: "No activity yet. Post a note below to start a discussion.",
  taskUpdated: "Task updated",
  deleteConfirmTitle: "Delete this task?",
  deleteConfirmBody:
    "This task has {summary}. Deleting it removes the task and its activity " +
    "for everyone. This can't be undone.",
  attachFilesAria: "Attach files to this note",
  notePlaceholder: "Add a note to the discussion…",
  noteAria: "Task discussion note",
  notePost: "Post",
  noteFilesAllFailed:
    "The note posted, but its files didn't upload. Re-attach them from the " +
    "note's Files section in the thread.",
  noteFilesSomeFailed:
    "The note posted, but {failed} of {total} files didn't upload. Re-attach " +
    "them from the note's Files section in the thread.",
  address: "Address",
  addrStreet: "Street",
  addrUnit: "Unit / suite",
  addrCity: "City",
  addrState: "State / province",
  addrPostalCode: "Postal code",
  addrCountry: "Country",
  addrFromMessage: "From the message",
  addrFromContact: "From the contact",
  addrFromAreaCode: "Inferred from area code",
  renameFailed: "Couldn't rename this task.",
  descriptionSaveFailed: "Couldn't save the description.",
  reassignFailed: "Couldn't reassign this task.",
  dueChangeFailed: "Couldn't change the due date.",
  dueClearFailed: "Couldn't clear the due date.",
  deleted: "Task deleted.",
  deleteFailed: "Couldn't delete this task.",
  updateFailed: "Couldn't update this task.",
  addressSaveFailed: "Couldn't save the address.",
  notePostFailed: "Couldn't post your note.",

  // -------------------------------------------------------------------------
  // The drawer shell and the standalone /tasks/[id] frame.
  // -------------------------------------------------------------------------
  drawerTitle: "Task details",
  drawerDescription: "Edit the task, review its activity, and add a note.",
  backToTasks: "Back to tasks",

  // -------------------------------------------------------------------------
  // The inline row quick-edits.
  // -------------------------------------------------------------------------
  setDue: "Set due",
  changeDueAria: "Change due date",
  changeDueOverdueAria: "Change due date (overdue)",
  setDueAria: "Set due date",
  dueDateTimeAria: "Due date and time",
  clearDueDate: "Clear due date",

  // -------------------------------------------------------------------------
  // Sharing a job's photos with the customer (#294).
  // -------------------------------------------------------------------------
  shareLinkFailed: "Couldn't make that link. Try again.",
  shareLinkCopied: "Link copied. Paste it into the thread.",
  shareLinkSelectToCopy: "Select the link and copy it.",
  shareLinkOff: "That link no longer opens.",
  shareLinkOffFailed: "Couldn't turn that link off. Try again.",
  shareMakingLink: "Making a link…",
  sharePhotos: "Share these photos",
  shareExpiryNote: "Anyone with this link can see the photos until {when}.",
  shareCopied: "Copied",
  shareCopy: "Copy",
  shareTurningOff: "Turning it off…",
  shareTurnOff: "Turn this link off",

  // -------------------------------------------------------------------------
  // Taking the work away as a file (#304).
  // -------------------------------------------------------------------------
  exportOutstanding: "Export outstanding work",
  exportFinished: "Export finished work",
  exportAll: "Export all work",
  exportNote:
    "A file of this work for your records. It covers the whole workspace, not " +
    "just your own jobs, and it is put together in the background.",
  exportAlreadyBuilding:
    "One is already being put together. It will appear in Settings › Data " +
    "export.",
  exportStarted:
    "Being put together now. It will appear in Settings › Data export.",
  exportFailed: "That could not be started.",

  // -------------------------------------------------------------------------
  // What the write paths say when they roll back.
  // -------------------------------------------------------------------------
  doneNeedsAccessToast:
    "Marking this done needs access to the conversation it came from.",
  moveFailed: "Couldn't move that task. Try again.",
  rescheduleFailed: "Couldn't reschedule that task. Try again.",
  remindersOffToast:
    "Reminders off for this job. Anything queued has been cancelled.",
  remindersOnToast: "Reminders back on for this job.",
  remindersChangeFailed: "Couldn't change that. Try again.",

  // -------------------------------------------------------------------------
  // What a task carries, named in the delete confirmation (#89).
  // -------------------------------------------------------------------------
  deleteSummaryANote: "a note",
  deleteSummaryNotes: "{count} notes",
  deleteSummaryAFile: "a file",
  deleteSummaryFiles: "{count} files",
  deleteSummaryAnd: "{first} and {second}",

  // -------------------------------------------------------------------------
  // The task_* activity sentences (shared with the thread's system lines).
  // -------------------------------------------------------------------------
  eventCreated: "{by} turned this into a task",
  eventUnassigned: "{by} unassigned this task",
  eventAssigned: "{by} assigned this to {name}",
  eventReassigned: "{by} reassigned this task",
  eventDueCleared: "{by} cleared the due date",
  eventDueSet: "{by} set the due date to {due}",
  eventDeleted: "{by} removed this task",
  eventAttachmentAdded: "{by} attached a file",
  eventAttachmentRemoved: "{by} removed a file",
  /** The due instant inside `eventDueSet`, when it falls on the current day. */
  eventDueToday: "today {time}",

  // -------------------------------------------------------------------------
  // /scheduled — everything the workspace has queued (#233).
  // -------------------------------------------------------------------------
  scheduledTitle: "Scheduled",
  scheduledOneWaiting: "1 text waiting",
  scheduledManyWaiting: "{count} texts waiting",
  scheduledLoadFailed: "Couldn't load what's scheduled.",
  scheduledLoadFailedHint: "Check your connection and try again.",
  scheduledNeedsYou: "Needs you",
  scheduledGoingOut: "Going out",
  scheduledWaiting: "Waiting",
} as const;

/**
 * Quebec French, vouvoiement throughout — the product speaks to the crew the
 * way a business speaks to a professional. Accents are spelled normally: the
 * GSM-7 restriction in packages/shared/src/locale.ts governs SMS bodies, which
 * are billed by the segment, and nothing on a web page is.
 *
 * A task is `une tâche`, so its adjectives are feminine throughout — "Ouverte",
 * "Terminée", "Non assignée". The board columns are plural because they name a
 * pile of them.
 */
export const tasksFr: Translated<typeof tasksEn> = {
  // -------------------------------------------------------------------------
  // Shared task vocabulary.
  // -------------------------------------------------------------------------
  unassigned: "Non assignée",
  teammate: "Collègue",
  aTeammate: "Un collègue",
  assignee: "Responsable",
  due: "Échéance",
  statusOpen: "Ouverte",
  statusDone: "Terminée",
  overdue: "En retard",
  overdueSrPrefix: "En retard : ",
  today: "Aujourd'hui",
  tomorrow: "Demain",
  markDone: "Marquer comme terminée",
  markNotDone: "Marquer comme non terminée",
  youSuffix: " (vous)",
  openConversation: "Ouvrir la conversation",
  tasksLoadFailed:
    "Impossible de charger vos tâches. Vérifiez votre connexion et réessayez.",

  // -------------------------------------------------------------------------
  // La liste vide.
  // -------------------------------------------------------------------------
  emptyFiltered: "Rien dans cette liste.",
  emptyTitle: "Aucune tâche pour le moment.",
  emptyBody:
    "Promouvez un message depuis son menu ⋯ dans une conversation pour en " +
    "faire une tâche suivie ici.",

  // -------------------------------------------------------------------------
  // La page /tasks et son sélecteur de vue.
  // -------------------------------------------------------------------------
  pageTitle: "Tâches",
  viewAria: "Vue des tâches",
  viewList: "Liste",
  viewBoard: "Tableau",
  viewCalendar: "Calendrier",
  viewMap: "Carte",

  // -------------------------------------------------------------------------
  // La barre de filtres.
  // -------------------------------------------------------------------------
  statusTabsAria: "Statut des tâches",
  tabOpen: "Ouvertes",
  tabMine: "Les miennes",
  tabAll: "Toutes",
  tabDone: "Terminées",
  searchPlaceholder: "Rechercher des tâches",
  searchAria: "Rechercher des tâches par titre",
  clearSearch: "Effacer la recherche",
  assigneeChipFallback: "Responsable",
  dueToday: "Échéance aujourd'hui",
  dueThisWeek: "Échéance cette semaine",
  removeFilterAria: "Retirer le filtre {label}",
  addFilterAria: "Ajouter un filtre",
  filter: "Filtrer",
  filterPlaceholder: "Filtrer par…",
  noFilters: "Aucun filtre.",
  keywordNobody: "personne",

  // -------------------------------------------------------------------------
  // La barre de sélection.
  // -------------------------------------------------------------------------
  bulkSelectThese: "Sélectionner ces {count}",
  bulkSelectAllMatching: "Sélectionner tout ce qui correspond",
  bulkAssign: "Assigner",
  bulkMore: "Plus",
  bulkVerbMarkedDone: "Marquées comme terminées",
  bulkVerbMarkedNotDone: "Marquées comme non terminées",
  bulkVerbAssigned: "Assignées",
  bulkVerbDeleted: "Supprimées",
  bulkNounOne: "tâche",
  bulkNounMany: "tâches",
  bulkFailed: "L'opération n'a pas abouti. Rien n'a été modifié.",

  // -------------------------------------------------------------------------
  // La vue Liste.
  // -------------------------------------------------------------------------
  columnTask: "Tâche",
  columnStatus: "Statut",
  selectRowAria: "Sélectionner {title}",
  loadingMore: "Chargement…",
  loadMore: "Afficher plus",

  // -------------------------------------------------------------------------
  // La vue Tableau.
  // -------------------------------------------------------------------------
  boardColumnToDo: "À faire",
  boardColumnDone: "Terminées",
  boardColumnAria: "Colonne {title}, {count} tâches",
  boardNothingDone: "Rien de terminé pour le moment.",
  boardNothingToDo: "Rien à faire.",
  boardMoveToToDo: "Déplacer vers À faire",
  boardMoveToDone: "Déplacer vers Terminées",

  // -------------------------------------------------------------------------
  // La vue Calendrier.
  // -------------------------------------------------------------------------
  calendarPreviousWeek: "Semaine précédente",
  calendarPreviousMonth: "Mois précédent",
  calendarNextWeek: "Semaine suivante",
  calendarNextMonth: "Mois suivant",
  calendarRangeAria: "Période du calendrier",
  calendarRangeMonth: "mois",
  calendarRangeWeek: "semaine",
  dowSun: "dim",
  dowMon: "lun",
  dowTue: "mar",
  dowWed: "mer",
  dowThu: "jeu",
  dowFri: "ven",
  dowSat: "sam",
  calendarLoadFailed:
    "Impossible de charger vos tâches planifiées. Vérifiez votre connexion et " +
    "réessayez.",
  calendarEmptyBefore:
    "Aucune tâche n'est planifiée dans cette période. Une tâche apparaît ici " +
    "dès qu'elle a une ",
  calendarEmptyDueDate: "date d'échéance",
  calendarEmptyAfter:
    ". Ajoutez-en une depuis la ligne de la tâche, la liste de la conversation " +
    "ou son panneau de détails, puis faites-la glisser d'un jour à l'autre " +
    "pour la replanifier.",
  rescheduleDayEarlier: "Un jour plus tôt",
  rescheduleDayLater: "Un jour plus tard",
  rescheduleWeekLater: "Une semaine plus tard",
  rescheduleAria: "Replanifier {title}",

  // -------------------------------------------------------------------------
  // La vue Carte.
  // -------------------------------------------------------------------------
  mapGeoUnsupported: "Votre navigateur ne peut pas partager de position.",
  mapGeoFailed:
    "Impossible d'obtenir votre position. Vérifiez l'autorisation de votre " +
    "navigateur.",
  mapLoadFailed:
    "Impossible de charger la carte. Vérifiez votre connexion et réessayez.",
  mapOnTheMap: "sur la carte",
  mapWithoutLocation: "sans emplacement",
  mapStillLocating: "Localisation de",
  mapAddressOne: "adresse",
  mapAddressMany: "adresses",
  mapGeocodeBacklogNote:
    "Les adresses sont recherchées par quelques centaines à la fois, alors " +
    "une grande importation peut prendre quelques heures avant d'être " +
    "entièrement affichée.",
  mapLocating: "Localisation…",
  mapNearMe: "Près de moi",
  mapNoMappedAddress:
    "Aucune de ces tâches n'a encore d'adresse cartographiée. Ajoutez une " +
    "adresse à un client et elle apparaît ici une fois géocodée.",
  mapYouAreHere: "Vous êtes ici",
  mapTilesFailing:
    "Le fond de carte ne se charge pas en ce moment. Les repères des tâches " +
    "restent exacts et nous examinons la situation.",
  mapOpenTask: "Ouvrir la tâche",
  mapDirections: "Itinéraire",
  mapTasksHere: "{count} tâches ici",
  mapMoreZoomIn: "+{count} autres, zoomer",
  mapZoomIn: "Zoomer",

  // -------------------------------------------------------------------------
  // Le panneau de détails.
  // -------------------------------------------------------------------------
  detailNotFound: "Cette tâche n'existe pas ou a été supprimée.",
  detailLoadFailed: "Impossible de charger cette tâche.",
  titleAria: "Titre de la tâche",
  actionsAria: "Actions de la tâche",
  markDoneAction: "Terminer",
  deleteTask: "Supprimer la tâche",
  doneNeedsAccessTitle:
    "Marquer cette tâche comme terminée exige l'accès à la conversation " +
    "d'origine",
  accessNoticeAria: "Avis d'accès",
  noAccessNotice:
    "Cette tâche est liée à un numéro auquel vous n'avez pas accès. Vous " +
    "voyez la tâche, mais pas ses messages, ses fichiers ni sa discussion — " +
    "demandez l'accès à un propriétaire ou à un administrateur.",
  sourceMessageAria: "Message d'origine",
  fromThisMessage: "À partir de ce message",
  sourcePhotoOnly: "Une photo",
  viewInConversation: "Voir dans la conversation",
  clearDue: "Effacer",
  remindCustomer: "Rappeler au client",
  remindCustomerAria: "Rappeler cette tâche au client",
  remindersOffForJob:
    "Désactivés pour cette tâche. Rien ne sera envoyé à son sujet.",
  remindersFromWorkspace: "Utilise les rappels de votre espace de travail.",
  confirmedByCustomer: "Le client a confirmé sa présence.",
  confirmedByCrew: "Confirmée par votre équipe.",
  description: "Description",
  descriptionPlaceholder: "Ajoutez des détails pour votre équipe…",
  attachments: "Pièces jointes",
  activity: "Activité",
  noActivity:
    "Aucune activité pour le moment. Publiez une note ci-dessous pour lancer " +
    "une discussion.",
  taskUpdated: "Tâche mise à jour",
  deleteConfirmTitle: "Supprimer cette tâche ?",
  deleteConfirmBody:
    "Cette tâche contient {summary}. La supprimer retire la tâche et son " +
    "activité pour tout le monde. Cette action est irréversible.",
  attachFilesAria: "Joindre des fichiers à cette note",
  notePlaceholder: "Ajoutez une note à la discussion…",
  noteAria: "Note de discussion de la tâche",
  notePost: "Publier",
  noteFilesAllFailed:
    "La note a été publiée, mais ses fichiers n'ont pas été téléversés. " +
    "Rattachez-les depuis la section Fichiers de la note dans la conversation.",
  noteFilesSomeFailed:
    "La note a été publiée, mais {failed} fichiers sur {total} n'ont pas été " +
    "téléversés. Rattachez-les depuis la section Fichiers de la note dans la " +
    "conversation.",
  address: "Adresse",
  addrStreet: "Rue",
  addrUnit: "Unité / bureau",
  addrCity: "Ville",
  addrState: "État / province",
  addrPostalCode: "Code postal",
  addrCountry: "Pays",
  addrFromMessage: "D'après le message",
  addrFromContact: "D'après le client",
  addrFromAreaCode: "Déduite de l'indicatif régional",
  renameFailed: "Impossible de renommer cette tâche.",
  descriptionSaveFailed: "Impossible d'enregistrer la description.",
  reassignFailed: "Impossible de réassigner cette tâche.",
  dueChangeFailed: "Impossible de modifier la date d'échéance.",
  dueClearFailed: "Impossible d'effacer la date d'échéance.",
  deleted: "Tâche supprimée.",
  deleteFailed: "Impossible de supprimer cette tâche.",
  updateFailed: "Impossible de mettre à jour cette tâche.",
  addressSaveFailed: "Impossible d'enregistrer l'adresse.",
  notePostFailed: "Impossible de publier votre note.",

  // -------------------------------------------------------------------------
  // Le tiroir et la page autonome.
  // -------------------------------------------------------------------------
  drawerTitle: "Détails de la tâche",
  drawerDescription:
    "Modifiez la tâche, consultez son activité et ajoutez une note.",
  backToTasks: "Retour aux tâches",

  // -------------------------------------------------------------------------
  // Les modifications rapides sur une ligne.
  // -------------------------------------------------------------------------
  setDue: "Définir l'échéance",
  changeDueAria: "Modifier la date d'échéance",
  changeDueOverdueAria: "Modifier la date d'échéance (en retard)",
  setDueAria: "Définir la date d'échéance",
  dueDateTimeAria: "Date et heure d'échéance",
  clearDueDate: "Effacer la date d'échéance",

  // -------------------------------------------------------------------------
  // Partager les photos d'une tâche.
  // -------------------------------------------------------------------------
  shareLinkFailed: "Impossible de créer ce lien. Réessayez.",
  shareLinkCopied: "Lien copié. Collez-le dans la conversation.",
  shareLinkSelectToCopy: "Sélectionnez le lien et copiez-le.",
  shareLinkOff: "Ce lien ne s'ouvre plus.",
  shareLinkOffFailed: "Impossible de désactiver ce lien. Réessayez.",
  shareMakingLink: "Création du lien…",
  sharePhotos: "Partager ces photos",
  shareExpiryNote:
    "Toute personne possédant ce lien peut voir les photos jusqu'au {when}.",
  shareCopied: "Copié",
  shareCopy: "Copier",
  shareTurningOff: "Désactivation…",
  shareTurnOff: "Désactiver ce lien",

  // -------------------------------------------------------------------------
  // Exporter le travail.
  // -------------------------------------------------------------------------
  exportOutstanding: "Exporter le travail en cours",
  exportFinished: "Exporter le travail terminé",
  exportAll: "Exporter tout le travail",
  exportNote:
    "Un fichier de ce travail pour vos dossiers. Il couvre tout l'espace de " +
    "travail, pas seulement vos propres tâches, et il est préparé en " +
    "arrière-plan.",
  exportAlreadyBuilding:
    "Un export est déjà en préparation. Il apparaîtra dans Paramètres › " +
    "Exportation des données.",
  exportStarted:
    "En cours de préparation. Il apparaîtra dans Paramètres › Exportation des " +
    "données.",
  exportFailed: "Impossible de démarrer l'opération.",

  // -------------------------------------------------------------------------
  // Ce que disent les écritures quand elles reculent.
  // -------------------------------------------------------------------------
  doneNeedsAccessToast:
    "Marquer cette tâche comme terminée exige l'accès à la conversation " +
    "d'origine.",
  moveFailed: "Impossible de déplacer cette tâche. Réessayez.",
  rescheduleFailed: "Impossible de replanifier cette tâche. Réessayez.",
  remindersOffToast:
    "Rappels désactivés pour cette tâche. Tout ce qui était en file d'attente " +
    "a été annulé.",
  remindersOnToast: "Rappels réactivés pour cette tâche.",
  remindersChangeFailed: "Impossible de modifier cela. Réessayez.",

  // -------------------------------------------------------------------------
  // Ce que porte une tâche, nommé dans la confirmation de suppression.
  // -------------------------------------------------------------------------
  deleteSummaryANote: "une note",
  deleteSummaryNotes: "{count} notes",
  deleteSummaryAFile: "un fichier",
  deleteSummaryFiles: "{count} fichiers",
  deleteSummaryAnd: "{first} et {second}",

  // -------------------------------------------------------------------------
  // Les phrases d'activité task_*.
  // -------------------------------------------------------------------------
  eventCreated: "{by} a transformé ceci en tâche",
  eventUnassigned: "{by} a retiré l'assignation de cette tâche",
  eventAssigned: "{by} a assigné ceci à {name}",
  eventReassigned: "{by} a réassigné cette tâche",
  eventDueCleared: "{by} a effacé la date d'échéance",
  eventDueSet: "{by} a fixé la date d'échéance au {due}",
  eventDeleted: "{by} a supprimé cette tâche",
  eventAttachmentAdded: "{by} a joint un fichier",
  eventAttachmentRemoved: "{by} a retiré un fichier",
  eventDueToday: "aujourd'hui {time}",

  // -------------------------------------------------------------------------
  // /scheduled — tout ce que l'espace de travail a mis en file.
  // -------------------------------------------------------------------------
  scheduledTitle: "Planifiés",
  scheduledOneWaiting: "1 texto en attente",
  scheduledManyWaiting: "{count} textos en attente",
  scheduledLoadFailed: "Impossible de charger ce qui est planifié.",
  scheduledLoadFailedHint: "Vérifiez votre connexion et réessayez.",
  scheduledNeedsYou: "Nécessite votre attention",
  scheduledGoingOut: "À envoyer",
  scheduledWaiting: "En attente",
};
