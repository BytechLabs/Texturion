/**
 * #228 — the words a conversation says, in both languages.
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
 * Grouped by the file that says them, in the order somebody reads the screen:
 * the transcript, then the strips above the composer, then the composer, then
 * the header and its menus. A translator working through the thread meets the
 * strings in the order they meet the reader.
 */
import type { Translated } from "../translated";

export const threadEn = {
  // --- Attachments in a bubble (attachment-audio / -file / -image) ----------
  audioMessage: "Audio message",
  /** `from` is already a phrase — see `audioFromLabel` / `audioSentToLabel`. */
  audioMessageAria: "Audio message {from}",
  downloadAudioAria: "Download audio message {from}",
  audioFromLabel: "from {name}",
  audioSentToLabel: "sent to {name}",
  didntLoadRetry: "Didn't load. Retry",
  photoDidntLoadRetry: "Photo didn't load. Retry",
  photo: "Photo",
  photoLoadFailed: "This photo couldn't be loaded.",
  openPhotoAria: "Open photo: {alt}",
  photoFrom: "Photo from {name}",
  photoSentTo: "Photo sent to {name}",

  // The coarse media kinds a non-image MMS chip is labelled with (#189).
  mediaImage: "Image",
  mediaAudio: "Audio",
  mediaVideo: "Video",
  mediaContactCard: "Contact card",
  mediaCalendarInvite: "Calendar invite",
  mediaPdf: "PDF",
  mediaTextFile: "Text file",
  mediaFile: "File",
  openAttachmentAria: "Open {kind}",

  // --- The attachments gallery (attachments-gallery.tsx) --------------------
  attachments: "Attachments",
  galleryDescription: "Photos and files shared in the conversation with {name}.",
  tabImages: "Images",
  tabFiles: "Files",
  galleryLoadFailed: "We couldn't load the attachments.",
  loadMore: "Load more",
  loadingMore: "Loading…",
  noPhotosYet: "No photos shared in this conversation yet.",
  noFilesYet: "No files shared in this conversation yet.",
  openGalleryPhotoAria: "Open {source} photo from {when}",
  viewAllAttachmentsAria: "View all attachments ({count})",

  // --- One message bubble (message-bubble.tsx) ------------------------------
  deliverySending: "Sending…",
  deliverySent: "Sent",
  deliveryDelivered: "Delivered",
  /** Screen-reader words for the same three states, read after the time. */
  srSending: "sending",
  srSent: "sent",
  srDelivered: "delivered",
  retry: "Retry",
  retrying: "Retrying…",
  pinned: "Pinned",
  pinnedSrSuffix: ", pinned message",
  done: "Done",
  task: "Task",
  openTaskAria: "Open the task: {title}",
  noteOnTask: "on: {title}",
  internalNote: "Internal note",

  // --- The timeline (message-list.tsx) --------------------------------------
  conversationLoadFailed: "We couldn't load this conversation.",
  loadingEarlier: "Loading earlier messages…",
  newMessage: "New message",
  showingFilter: "Showing {kinds}",
  showingFilterAria: "Showing {kinds} only. Show everything.",
  messagesWithAria: "Messages with {name}",
  newMessageAnnouncement: "New message from {name}: {body}",
  attachmentWord: "attachment",
  aTeammate: "A teammate",

  // --- The pinned strip (pinned-banner.tsx) ---------------------------------
  pinnedMessagesAria: "Pinned messages",
  jumpToPinnedAria: "Jump to pinned message: {snippet}",
  jump: "Jump",

  // --- The catch-up card (thread-summary-card.tsx) --------------------------
  catchUp: "Catch-up",
  catchMeUp: "Catch me up",
  catchMeUpAgain: "Catch me up again",
  louReadsRecent: "Lou reads the recent messages",
  readingThread: "Reading the thread…",
  readingThreadAria: "Reading the thread",
  dismiss: "Dismiss",
  newMessagesSinceCatchUp:
    "New messages have come in since this catch-up. Read the newest ones " +
    "below, or ask again.",
  openMessageBehindAria: "Open the message behind: {text}",
  threadLongerThanRead:
    "This thread is longer than the stretch Lou read, so anything older " +
    "isn’t in here.",
  optOutStripCarrier:
    "This customer texted STOP. Their carrier is blocking your texts and " +
    "only they can undo it.",
  optOutHintShort:
    "Someone on this thread asked not to be contacted. That request is " +
    "binding however it is worded.",

  // --- "This looks like spam" (spam-suspected-banner.tsx) -------------------
  spamTitle: "This looks like spam",
  spamBody:
    "We didn't send a notification for it. Nothing is hidden, and you can " +
    "reply as normal.",
  notSpam: "Not spam",
  spamCleared: "Thanks. We won't flag this one.",
  spamClearFailed: "Couldn't clear that just now. Try again.",

  // --- The unclaimed-alert strip (alert-banner.tsx) -------------------------
  /**
   * The TAIL of the banner's one line, after a "·". Its LEAD is
   * `ALERT_BANNER_COPY.waiting` in @loonext/shared, which the phones hand-port
   * and which no catalogue owns yet — so until that copy moves, this line
   * reads half-translated for a French crew. Recorded rather than hidden: the
   * sentence still belongs here, and the day the shared strings land it needs
   * no second pass.
   */
  alertPagedFirst: "{name} was told first",
  alertClaimFailed: "Could not claim that",

  // --- The banner that replaces the composer (composer-banners.tsx) ---------
  bannerReadOnly:
    "You have view-only access to this workspace, so you can read the " +
    "conversation but not reply or leave notes. An owner or admin can change " +
    "your access.",
  bannerNumberAccess:
    "You can add internal notes here, but not text this customer from this " +
    "number. Calls to it won't ring you either. Ask an owner or admin for " +
    "access.",
  bannerOptedOutCarrier:
    "This customer texted STOP, so their carrier is blocking your texts. " +
    "Only they can undo it, by texting START to your number.",
  bannerOptedOut:
    "This customer is marked opted out. You can undo that on their contact.",
  bannerPastDue: "Update your payment method to send messages.",
  updatePayment: "Update payment",
  opening: "Opening…",
  bannerSubscriptionInactive: "Your subscription isn't active, so sending is off.",
  goToBilling: "Go to billing",
  bannerUsTextingOffAdmin:
    "This is a US number, and US texting isn't on for this workspace.",
  bannerUsTextingOffMember:
    "This is a US number, and US texting isn't on for this workspace. An " +
    "owner can add it.",
  addUsTexting: "Add US texting",
  callThemInstead: "Call them instead",
  bannerRegistrationSuspended:
    "The carrier paused your US registration, so US texts won't send. We've " +
    "been told and we're on it — you'll get an email when it's back. " +
    "Canadian texts and calls still work.",
  bannerRegistrationPending:
    "US texting activates once your registration is approved. Usually 3 to 7 " +
    "business days.",
  bannerUsageCapOwner:
    "Sending is paused at the spending cap you set. Nothing bills past it.",
  bannerUsageCapMember:
    "Sending is paused at this workspace's spending cap. Ask your account " +
    "owner to raise it.",
  raiseCap: "Raise cap",
  raising: "Raising…",
  bannerOptOutHint:
    "Someone on this thread asked not to be contacted. That request is " +
    "binding however it is worded, so don't reply unless you are sure it " +
    "wasn't one. To stop texts for good, they need to text STOP.",
  reportThis: "Report this",
  billingOpenFailed: "Couldn't open billing.",
  capRaised: "Cap raised to {count}× your included messages.",
  capRaiseFailed: "Couldn't raise the cap.",

  // --- The composer (composer.tsx) ------------------------------------------
  composerModeAria: "Composer mode",
  modeText: "Text",
  modeNote: "Note",
  fileFallbackName: "File",
  removeAria: "Remove {name}",
  unsentNotice:
    "This didn’t send. Press send to try again. It won’t send twice.",
  sendsAs: "Sends as:",
  attachFilesAria: "Attach files",
  attachTooltip: "Attach up to {count} files, 1 MB each",
  savedReplyAria: "Insert a saved reply",
  savedReplyTooltip: "Saved replies, or type “/”",
  draftWithLou: "Draft with Lou",
  finishWithLou: "Finish with Lou",
  addToMessageAria: "Add to message",
  attachAFile: "Attach a file",
  savedReply: "Saved reply",
  attachNoteFilesAria: "Attach files to this note",
  attachNoteTooltip: "Attach up to {count} files, 25 MB each",
  notePlaceholder: "Write an internal note…",
  textPlaceholder: "Text message",
  noteAria: "Internal note",
  messageAria: "Message",
  saveNoteAria: "Save note",
  sendMessageAria: "Send message",
  send: "Send",
  sendLaterAria: "Send later",
  alreadyAnsweredTitle: "Somebody already answered",
  sendYoursAsWell: "Send yours as well?",
  letMeLook: "Let me look",
  sendAnyway: "Send anyway",
  teammate: "Teammate",
  mentionNoAccess:
    "One of the teammates you named can't see this conversation. Remove them " +
    "and save again.",
  mentionCap:
    "A note can name up to {count} teammates. Assign the thread if the whole " +
    "crew needs it.",
  draftReplyFailed: "Couldn't draft a reply. Try again.",
  wrapUpSendFailed:
    "Couldn't send that recording. Check your connection, or type the note.",
  noteSaveFailed: "That note didn't save. Try again.",
  noteFilesAllFailed:
    "The note saved, but its files didn't upload. Re-attach them from the " +
    "note's Files section.",
  noteFilesSomeFailed:
    "The note saved, but {failed} of {total} files didn't upload. Re-attach " +
    "them from the note's Files section.",
  fileReadFailed: "Couldn't read that file. Try attaching it again.",
  sendFailedConnection: "That didn't send. Check your connection and try again.",
  scheduledFor: "Scheduled for {when}. You can cancel it any time before it goes.",
  scheduleFailed: "That could not be scheduled. Try again.",
  sendFailed: "That didn't send.",

  // --- Lou's reply drafts (reply-suggestion-chips.tsx) ----------------------
  drafting: "Drafting…",
  lousDrafts: "Lou's drafts",
  suggestedRepliesAria: "Suggested replies",
  louDoesntKnowYou: "Lou doesn’t know what you do yet.",
  tellLouLink: "Tell it, and drafts get specific",

  // --- Dictating a wrap-up (wrap-up-dictation.tsx) --------------------------
  stopAndWriteDown: "Stop and write it down",
  writingWrapUpDown: "Writing your wrap-up down",
  writingWrapUpDownEllipsis: "Writing your wrap-up down…",
  dictateWrapUp: "Dictate a wrap-up",
  dictateWrapUpTooltip:
    "Say what happened after a call. Your voice, not the call — Lou writes " +
    "your words down for you to check.",
  recordingWrapUp: "Recording your wrap-up",
  writingItDown: "Writing it down…",
  yourVoiceAfterCall:
    "Your voice, after the call has ended — never the call itself.",

  // --- Before / after on a photo note (work-phase-picker.tsx) ---------------
  whatPhotosShowAria: "What these photos show",

  // --- Saved replies (template-picker.tsx) ----------------------------------
  searchSavedReplies: "Search saved replies…",
  loadingSavedReplies: "Loading saved replies…",
  savedRepliesLoadFailed: "Couldn't load saved replies.",
  noSavedRepliesYet: "No saved replies yet.",
  ownerCanAddTemplates: "An owner or admin can add them in Settings.",
  createOneInSettings: "Create one in Settings › Templates",
  noSavedRepliesMatch: "No saved replies match.",
  savedReplies: "Saved replies",
  pickASavedReply: "Pick a saved reply to insert into your message.",

  // --- Naming a teammate on a note (mention-picker.tsx) ---------------------
  searchTeammates: "Search teammates…",
  loadingTeammates: "Loading teammates…",
  teammatesLoadFailed: "Couldn't load teammates.",
  noTeammatesCanSee: "No teammates can see this conversation.",
  noTeammatesMatch: "No teammates match.",
  mention: "Mention",
  mentionATeammate: "Mention a teammate",
  mentionSheetDescription:
    "Pick a teammate to name on this note. They will be notified.",

  // --- Per-message actions (message-actions.tsx) ----------------------------
  moreActions: "More actions",
  makeATask: "Make a task",
  copyText: "Copy text",
  retrySend: "Retry send",
  copied: "Copied to clipboard.",
  copyFailed: "Couldn't copy. Your browser blocked clipboard access.",

  // --- Promoting a message to a task (make-task-form.tsx) ------------------
  provenanceFromMessage: "From the message",
  provenanceFromContact: "From the contact",
  provenanceFromAreaCode: "Inferred from area code",
  addressCleared: "Address cleared",
  undo: "Undo",
  taskTitleRequired: "Give the task a title.",
  taskCreated: "Made a task from this message.",
  alreadyATask: "This message is already a task.",
  taskCreateFailed: "Couldn't make a task. Try again.",
  taskTitleLabel: "Task",
  taskTitlePlaceholder: "What needs doing?",
  assigneeLabel: "Assignee",
  unassigned: "Unassigned",
  youSuffix: " (you)",
  dueLabel: "Due (optional)",
  suggested: "Suggested",
  addressLabel: "Address",
  addrStreet: "Street",
  addrUnitAria: "Unit or suite",
  addrUnit: "Unit / suite",
  addrCity: "City",
  addrStateAria: "State or province",
  addrState: "State / province",
  addrPostalCode: "Postal code",
  addrCountry: "Country",
  clearAddress: "Clear address",
  creating: "Creating…",
  create: "Create",

  // --- Send later (send-later-menu.tsx) -------------------------------------
  theirClock: "Their clock — {source}",
  yourWorkspaceTime: "Your workspace's time",
  pickATime: "Pick a time…",
  sendLater: "Send later",
  pickWhichClock: "Pick which clock you mean. They are {delta}.",
  yourOwnTime:
    "This is your own time. You can change or cancel it any time before it " +
    "goes.",
  whichClockAria: "Which clock",
  sendDateTimeAria: "Send date and time",
  sendDateTimeClockAria: "Send date and time, {clock}",
  thatsYourTime: "That's {when} your time",
  thatsTheirTime: "That's {when} their time",
  schedule: "Schedule",
  landsLateTitle: "That lands late where they are",
  quietHoursNoHour: "That time is inside this customer's quiet hours.",
  quietHoursAround: "That is around {hour} for this customer.",
  quietHoursTail: "You can send it anyway, or pick a time in their morning.",
  pickAnotherTime: "Pick another time",
  scheduleItAnyway: "Schedule it anyway",

  // --- Snooze and follow-up (snooze-menu.tsx) -------------------------------
  cancelTheReminder: "Cancel the reminder",
  bringBackNow: "Bring back now",
  snoozeUntilMenu: "Snooze until…",
  remindMeToChaseMenu: "Remind me to chase…",
  pickADate: "Pick a date…",
  remindMeToChaseTitle: "Remind me to chase",
  snoozeUntilTitle: "Snooze until",
  followUpDescription:
    "It comes back then as something to chase — unless they reply first, in " +
    "which case there is nothing to chase and the reminder disappears.",
  snoozeDescription:
    "It comes back to your inbox then — and immediately if the customer " +
    "replies before that.",
  returnDateAria: "Return date and time",
  whyPlaceholder: "Why? (optional)",
  whySnoozingAria: "Why you are snoozing this",
  remindMe: "Remind me",
  snooze: "Snooze",

  // --- The thread header and its menus (thread-header.tsx) ------------------
  backToInbox: "Back to inbox",
  viewContactAria: "View contact details for {name}, {phone}",
  addAName: "Add a name",
  copyPhoneAria: "Copy phone number",
  numberCopied: "Number copied.",
  bringBackTitle: "Bring this back to your inbox now",
  statusAria: "Status: {status}. Change status",
  assignAria: "Assign",
  assignedToAria: "Assigned to {name}. Reassign",
  assignTo: "Assign to",
  assignedTo: "Assigned to {name}",
  teammateLower: "teammate",
  assignFailed: "Couldn't assign.",
  hideInfoAria: "Hide conversation info",
  showInfoAria: "Show conversation info",
  conversationInfo: "Conversation info",
  showLabel: "Show",
  markUnread: "Mark unread",
  markedUnread: "Marked unread",
  markUnreadFailed: "Couldn't mark this unread.",
  spam: "Spam",
  viewAttachments: "View attachments",
  statusUpdateFailed: "Couldn't update the status.",
  conversationClosed: "Conversation closed",
  undoFailed: "Couldn't undo.",
  spamUpdateFailed: "Couldn't update spam.",
  markedAsSpam: "Marked as spam",
  markedAsNotSpam: "Marked as not spam",
  reminderSetFailed: "Couldn't set that reminder.",
  snoozeFailed: "Couldn't snooze this conversation.",
  bringBackFailed: "Couldn't bring this back.",
  reminderCancelled: "Reminder cancelled",
  backInYourInbox: "Back in your inbox",
  pinUpdateFailed: "Couldn't update pin.",
  conversationPinned: "Conversation pinned",
  conversationUnpinned: "Conversation unpinned",
  carrierStopNote:
    "This customer texted STOP. Only they can undo it, by texting START to " +
    "your number.",
  markOptedInAgain: "Mark opted in again",
  markedOptedInAgain: "Marked opted in again.",
  optOutUpdateFailed: "Couldn't update opt-out.",
  optOutContact: "Opt out contact",
  optOutTitle: "Opt out {name}?",
  optOutDescription:
    "They won't receive texts from you anymore. Use this when a customer " +
    "asks to stop hearing from you in any words.",
  optingOut: "Opting out…",
  optOut: "Opt out",
  contactOptedOut: "Contact opted out.",
  optOutFailed: "Couldn't opt out the contact.",

  // --- The thread screen (thread-view.tsx) ----------------------------------
  conversationNotFound: "This conversation doesn't exist or was removed.",
  conversationInfoForAria: "Conversation info for {name}",
  resizePanelAria: "Resize contact panel",
  panelWidthAria: "{pixels} pixels",

  // --- In-thread filter (thread-filter-bar.tsx) -----------------------------
  showInConversationAria: "Show in conversation",
} as const;

/**
 * Quebec French. Vouvoiement throughout — the product speaks to the crew the
 * way a business speaks to a professional — and accents spelled normally,
 * because the GSM-7 restriction in packages/shared/src/locale.ts governs SMS
 * bodies and nothing on a web page is billed by the segment.
 *
 * STOP / START / HELP are left in English: they are what a carrier matches on,
 * and a translated keyword is a keyword that does nothing.
 */
export const threadFr: Translated<typeof threadEn> = {
  // --- Attachments in a bubble ---------------------------------------------
  audioMessage: "Message audio",
  audioMessageAria: "Message audio {from}",
  downloadAudioAria: "Télécharger le message audio {from}",
  audioFromLabel: "de {name}",
  audioSentToLabel: "envoyé à {name}",
  didntLoadRetry: "Le chargement a échoué. Réessayer",
  photoDidntLoadRetry: "La photo ne s'est pas chargée. Réessayer",
  photo: "Photo",
  photoLoadFailed: "Impossible de charger cette photo.",
  openPhotoAria: "Ouvrir la photo : {alt}",
  photoFrom: "Photo de {name}",
  photoSentTo: "Photo envoyée à {name}",

  mediaImage: "Image",
  mediaAudio: "Audio",
  mediaVideo: "Vidéo",
  mediaContactCard: "Fiche de contact",
  mediaCalendarInvite: "Invitation au calendrier",
  mediaPdf: "PDF",
  mediaTextFile: "Fichier texte",
  mediaFile: "Fichier",
  openAttachmentAria: "Ouvrir {kind}",

  // --- The attachments gallery ---------------------------------------------
  attachments: "Pièces jointes",
  galleryDescription:
    "Photos et fichiers partagés dans la conversation avec {name}.",
  tabImages: "Images",
  tabFiles: "Fichiers",
  galleryLoadFailed: "Impossible de charger les pièces jointes.",
  loadMore: "Afficher plus",
  loadingMore: "Chargement…",
  noPhotosYet: "Aucune photo partagée dans cette conversation pour l'instant.",
  noFilesYet: "Aucun fichier partagé dans cette conversation pour l'instant.",
  openGalleryPhotoAria: "Ouvrir la photo {source} du {when}",
  viewAllAttachmentsAria: "Voir toutes les pièces jointes ({count})",

  // --- One message bubble ---------------------------------------------------
  deliverySending: "Envoi…",
  deliverySent: "Envoyé",
  deliveryDelivered: "Livré",
  srSending: "envoi en cours",
  srSent: "envoyé",
  srDelivered: "livré",
  retry: "Réessayer",
  retrying: "Nouvel essai…",
  pinned: "Épinglé",
  pinnedSrSuffix: ", message épinglé",
  done: "Fait",
  task: "Tâche",
  openTaskAria: "Ouvrir la tâche : {title}",
  noteOnTask: "sur : {title}",
  internalNote: "Note interne",

  // --- The timeline ---------------------------------------------------------
  conversationLoadFailed: "Impossible de charger cette conversation.",
  loadingEarlier: "Chargement des messages précédents…",
  newMessage: "Nouveau message",
  showingFilter: "Affichage : {kinds}",
  showingFilterAria: "Affichage de {kinds} seulement. Tout afficher.",
  messagesWithAria: "Messages avec {name}",
  newMessageAnnouncement: "Nouveau message de {name} : {body}",
  attachmentWord: "pièce jointe",
  aTeammate: "Un membre de l'équipe",

  // --- The pinned strip -----------------------------------------------------
  pinnedMessagesAria: "Messages épinglés",
  jumpToPinnedAria: "Aller au message épinglé : {snippet}",
  jump: "Aller",

  // --- The catch-up card ----------------------------------------------------
  catchUp: "Rattrapage",
  catchMeUp: "Résumez-moi ça",
  catchMeUpAgain: "Résumez-moi ça de nouveau",
  louReadsRecent: "Lou lit les messages récents",
  readingThread: "Lecture de la conversation…",
  readingThreadAria: "Lecture de la conversation",
  dismiss: "Masquer",
  newMessagesSinceCatchUp:
    "De nouveaux messages sont arrivés depuis ce rattrapage. Lisez les plus " +
    "récents ci-dessous, ou demandez-en un autre.",
  openMessageBehindAria: "Ouvrir le message à l'origine de : {text}",
  threadLongerThanRead:
    "Cette conversation est plus longue que la portion lue par Lou : rien de " +
    "plus ancien ne s'y trouve.",
  optOutStripCarrier:
    "Ce client a texté STOP. Son fournisseur bloque vos textos et lui seul " +
    "peut annuler ce blocage.",
  optOutHintShort:
    "Quelqu'un dans cette conversation a demandé à ne plus être contacté. " +
    "Cette demande est contraignante, peu importe la formulation.",

  // --- "This looks like spam" ------------------------------------------------
  spamTitle: "Ceci ressemble à du pourriel",
  spamBody:
    "Nous n'avons pas envoyé de notification pour ce message. Rien n'est " +
    "masqué et vous pouvez répondre normalement.",
  notSpam: "Pas du pourriel",
  spamCleared: "Merci. Nous ne signalerons plus celui-ci.",
  spamClearFailed: "Impossible de retirer le signalement. Réessayez.",

  // --- The unclaimed-alert strip --------------------------------------------
  alertPagedFirst: "{name} a été prévenu en premier",
  alertClaimFailed: "Impossible de prendre cette conversation en charge",

  // --- The banner that replaces the composer --------------------------------
  bannerReadOnly:
    "Vous avez un accès en lecture seule à cet espace de travail : vous " +
    "pouvez lire la conversation, mais pas répondre ni laisser de notes. Un " +
    "propriétaire ou un administrateur peut modifier votre accès.",
  bannerNumberAccess:
    "Vous pouvez ajouter des notes internes ici, mais pas texter ce client à " +
    "partir de ce numéro. Les appels vers ce numéro ne vous joindront pas non " +
    "plus. Demandez l'accès à un propriétaire ou à un administrateur.",
  bannerOptedOutCarrier:
    "Ce client a texté STOP : son fournisseur bloque vos textos. Lui seul " +
    "peut annuler ce blocage, en textant START à votre numéro.",
  bannerOptedOut:
    "Ce client est marqué comme désabonné. Vous pouvez annuler cela dans sa " +
    "fiche de contact.",
  bannerPastDue: "Mettez à jour votre moyen de paiement pour envoyer des messages.",
  updatePayment: "Mettre à jour le paiement",
  opening: "Ouverture…",
  bannerSubscriptionInactive:
    "Votre abonnement n'est pas actif : l'envoi est désactivé.",
  goToBilling: "Aller à la facturation",
  bannerUsTextingOffAdmin:
    "Ceci est un numéro américain, et les textos vers les États-Unis ne sont " +
    "pas activés pour cet espace de travail.",
  bannerUsTextingOffMember:
    "Ceci est un numéro américain, et les textos vers les États-Unis ne sont " +
    "pas activés pour cet espace de travail. Un propriétaire peut les ajouter.",
  addUsTexting: "Ajouter les textos vers les États-Unis",
  callThemInstead: "Appelez-les plutôt",
  bannerRegistrationSuspended:
    "Le fournisseur a suspendu votre inscription américaine : les textos vers " +
    "les États-Unis ne partiront pas. Nous avons été avisés et nous nous en " +
    "occupons — vous recevrez un courriel dès le rétablissement. Les textos " +
    "canadiens et les appels fonctionnent toujours.",
  bannerRegistrationPending:
    "Les textos vers les États-Unis s'activeront dès l'approbation de votre " +
    "inscription. Habituellement de 3 à 7 jours ouvrables.",
  bannerUsageCapOwner:
    "L'envoi est suspendu au plafond de dépenses que vous avez fixé. Rien " +
    "n'est facturé au-delà.",
  bannerUsageCapMember:
    "L'envoi est suspendu au plafond de dépenses de cet espace de travail. " +
    "Demandez au propriétaire du compte de le relever.",
  raiseCap: "Relever le plafond",
  raising: "Relèvement…",
  bannerOptOutHint:
    "Quelqu'un dans cette conversation a demandé à ne plus être contacté. " +
    "Cette demande est contraignante, peu importe la formulation : ne " +
    "répondez pas à moins d'être certain qu'il ne s'agissait pas de cela. " +
    "Pour arrêter les textos définitivement, le client doit texter STOP.",
  reportThis: "Signaler ceci",
  billingOpenFailed: "Impossible d'ouvrir la facturation.",
  capRaised: "Plafond relevé à {count}× vos messages inclus.",
  capRaiseFailed: "Impossible de relever le plafond.",

  // --- The composer ---------------------------------------------------------
  composerModeAria: "Mode de rédaction",
  modeText: "Texto",
  modeNote: "Note",
  fileFallbackName: "Fichier",
  removeAria: "Retirer {name}",
  unsentNotice:
    "Ce message n’est pas parti. Appuyez sur envoyer pour réessayer. Il ne " +
    "partira pas deux fois.",
  sendsAs: "Sera envoyé ainsi :",
  attachFilesAria: "Joindre des fichiers",
  attachTooltip: "Joignez jusqu'à {count} fichiers, 1 Mo chacun",
  savedReplyAria: "Insérer une réponse enregistrée",
  savedReplyTooltip: "Réponses enregistrées, ou tapez « / »",
  draftWithLou: "Rédiger avec Lou",
  finishWithLou: "Terminer avec Lou",
  addToMessageAria: "Ajouter au message",
  attachAFile: "Joindre un fichier",
  savedReply: "Réponse enregistrée",
  attachNoteFilesAria: "Joindre des fichiers à cette note",
  attachNoteTooltip: "Joignez jusqu'à {count} fichiers, 25 Mo chacun",
  notePlaceholder: "Rédiger une note interne…",
  textPlaceholder: "Texto",
  noteAria: "Note interne",
  messageAria: "Message",
  saveNoteAria: "Enregistrer la note",
  sendMessageAria: "Envoyer le message",
  send: "Envoyer",
  sendLaterAria: "Envoyer plus tard",
  alreadyAnsweredTitle: "Quelqu'un a déjà répondu",
  sendYoursAsWell: "Envoyer le vôtre quand même ?",
  letMeLook: "Laissez-moi voir",
  sendAnyway: "Envoyer quand même",
  teammate: "Membre de l'équipe",
  mentionNoAccess:
    "Un des membres de l'équipe que vous avez nommés ne peut pas voir cette " +
    "conversation. Retirez-le et enregistrez de nouveau.",
  mentionCap:
    "Une note peut nommer jusqu'à {count} membres de l'équipe. Assignez la " +
    "conversation si toute l'équipe en a besoin.",
  draftReplyFailed: "Impossible de rédiger une réponse. Réessayez.",
  wrapUpSendFailed:
    "Impossible d'envoyer cet enregistrement. Vérifiez votre connexion, ou " +
    "tapez la note.",
  noteSaveFailed: "Cette note n'a pas été enregistrée. Réessayez.",
  noteFilesAllFailed:
    "La note est enregistrée, mais ses fichiers n'ont pas été téléversés. " +
    "Joignez-les de nouveau depuis la section Fichiers de la note.",
  noteFilesSomeFailed:
    "La note est enregistrée, mais {failed} fichiers sur {total} n'ont pas " +
    "été téléversés. Joignez-les de nouveau depuis la section Fichiers de la " +
    "note.",
  fileReadFailed: "Impossible de lire ce fichier. Joignez-le de nouveau.",
  sendFailedConnection:
    "L'envoi a échoué. Vérifiez votre connexion et réessayez.",
  scheduledFor:
    "Programmé pour {when}. Vous pouvez l'annuler à tout moment avant l'envoi.",
  scheduleFailed: "Impossible de programmer cet envoi. Réessayez.",
  sendFailed: "L'envoi a échoué.",

  // --- Lou's reply drafts ---------------------------------------------------
  drafting: "Rédaction…",
  lousDrafts: "Les propositions de Lou",
  suggestedRepliesAria: "Réponses suggérées",
  louDoesntKnowYou: "Lou ne sait pas encore ce que vous faites.",
  tellLouLink: "Dites-le-lui, et les propositions deviendront précises",

  // --- Dictating a wrap-up --------------------------------------------------
  stopAndWriteDown: "Arrêter et transcrire",
  writingWrapUpDown: "Transcription de votre compte rendu",
  writingWrapUpDownEllipsis: "Transcription de votre compte rendu…",
  dictateWrapUp: "Dicter un compte rendu",
  dictateWrapUpTooltip:
    "Dites ce qui s'est passé après un appel. Votre voix, pas l'appel — Lou " +
    "transcrit vos mots pour que vous les vérifiiez.",
  recordingWrapUp: "Enregistrement de votre compte rendu",
  writingItDown: "Transcription…",
  yourVoiceAfterCall:
    "Votre voix, une fois l'appel terminé — jamais l'appel lui-même.",

  // --- Before / after on a photo note ---------------------------------------
  whatPhotosShowAria: "Ce que montrent ces photos",

  // --- Saved replies --------------------------------------------------------
  searchSavedReplies: "Rechercher dans les réponses enregistrées…",
  loadingSavedReplies: "Chargement des réponses enregistrées…",
  savedRepliesLoadFailed: "Impossible de charger les réponses enregistrées.",
  noSavedRepliesYet: "Aucune réponse enregistrée pour l'instant.",
  ownerCanAddTemplates:
    "Un propriétaire ou un administrateur peut en ajouter dans les paramètres.",
  createOneInSettings: "Créez-en une dans Paramètres › Modèles",
  noSavedRepliesMatch: "Aucune réponse enregistrée ne correspond.",
  savedReplies: "Réponses enregistrées",
  pickASavedReply:
    "Choisissez une réponse enregistrée à insérer dans votre message.",

  // --- Naming a teammate on a note ------------------------------------------
  searchTeammates: "Rechercher un membre de l'équipe…",
  loadingTeammates: "Chargement de l'équipe…",
  teammatesLoadFailed: "Impossible de charger l'équipe.",
  noTeammatesCanSee:
    "Personne dans l'équipe ne peut voir cette conversation.",
  noTeammatesMatch: "Aucun membre de l'équipe ne correspond.",
  mention: "Mentionner",
  mentionATeammate: "Mentionner un membre de l'équipe",
  mentionSheetDescription:
    "Choisissez un membre de l'équipe à nommer sur cette note. Il sera avisé.",

  // --- Per-message actions --------------------------------------------------
  moreActions: "Plus d'actions",
  makeATask: "Créer une tâche",
  copyText: "Copier le texte",
  retrySend: "Renvoyer",
  copied: "Copié dans le presse-papiers.",
  copyFailed:
    "Impossible de copier. Votre navigateur a bloqué l'accès au " +
    "presse-papiers.",

  // --- Promoting a message to a task ----------------------------------------
  provenanceFromMessage: "Tiré du message",
  provenanceFromContact: "Tiré de la fiche de contact",
  provenanceFromAreaCode: "Déduit de l'indicatif régional",
  addressCleared: "Adresse effacée",
  undo: "Annuler",
  taskTitleRequired: "Donnez un titre à la tâche.",
  taskCreated: "Tâche créée à partir de ce message.",
  alreadyATask: "Ce message est déjà une tâche.",
  taskCreateFailed: "Impossible de créer la tâche. Réessayez.",
  taskTitleLabel: "Tâche",
  taskTitlePlaceholder: "Qu'y a-t-il à faire ?",
  assigneeLabel: "Responsable",
  unassigned: "Non assignée",
  youSuffix: " (vous)",
  dueLabel: "Échéance (facultative)",
  suggested: "Suggéré",
  addressLabel: "Adresse",
  addrStreet: "Rue",
  addrUnitAria: "Appartement ou bureau",
  addrUnit: "App. / bureau",
  addrCity: "Ville",
  addrStateAria: "État ou province",
  addrState: "État / province",
  addrPostalCode: "Code postal",
  addrCountry: "Pays",
  clearAddress: "Effacer l'adresse",
  creating: "Création…",
  create: "Créer",

  // --- Send later -----------------------------------------------------------
  theirClock: "Leur heure — {source}",
  yourWorkspaceTime: "L'heure de votre espace de travail",
  pickATime: "Choisir une heure…",
  sendLater: "Envoyer plus tard",
  pickWhichClock: "Choisissez de quelle heure vous parlez. Elles sont {delta}.",
  yourOwnTime:
    "Ceci est votre propre heure. Vous pouvez la modifier ou annuler l'envoi " +
    "à tout moment avant qu'il ne parte.",
  whichClockAria: "Quelle heure",
  sendDateTimeAria: "Date et heure d'envoi",
  sendDateTimeClockAria: "Date et heure d'envoi, {clock}",
  thatsYourTime: "Cela fait {when} à votre heure",
  thatsTheirTime: "Cela fait {when} à leur heure",
  schedule: "Programmer",
  landsLateTitle: "Cela arrive tard chez eux",
  quietHoursNoHour:
    "Cette heure tombe dans les heures de silence de ce client.",
  quietHoursAround: "Il sera environ {hour} chez ce client.",
  quietHoursTail:
    "Vous pouvez l'envoyer quand même, ou choisir une heure le matin chez eux.",
  pickAnotherTime: "Choisir une autre heure",
  scheduleItAnyway: "Programmer quand même",

  // --- Snooze and follow-up -------------------------------------------------
  cancelTheReminder: "Annuler le rappel",
  bringBackNow: "Ramener maintenant",
  snoozeUntilMenu: "Reporter jusqu'à…",
  remindMeToChaseMenu: "Me rappeler de relancer…",
  pickADate: "Choisir une date…",
  remindMeToChaseTitle: "Me rappeler de relancer",
  snoozeUntilTitle: "Reporter jusqu'à",
  followUpDescription:
    "La conversation revient alors comme une relance à faire — sauf si le " +
    "client répond avant, auquel cas il n'y a plus rien à relancer et le " +
    "rappel disparaît.",
  snoozeDescription:
    "La conversation revient alors dans votre boîte de réception — et " +
    "immédiatement si le client répond avant.",
  returnDateAria: "Date et heure de retour",
  whyPlaceholder: "Pourquoi ? (facultatif)",
  whySnoozingAria: "Pourquoi vous reportez cette conversation",
  remindMe: "Me rappeler",
  snooze: "Reporter",

  // --- The thread header and its menus --------------------------------------
  backToInbox: "Retour à la boîte de réception",
  viewContactAria: "Voir la fiche de contact de {name}, {phone}",
  addAName: "Ajouter un nom",
  copyPhoneAria: "Copier le numéro de téléphone",
  numberCopied: "Numéro copié.",
  bringBackTitle: "Ramener ceci dans votre boîte de réception maintenant",
  statusAria: "Statut : {status}. Changer le statut",
  assignAria: "Assigner",
  assignedToAria: "Assignée à {name}. Réassigner",
  assignTo: "Assigner à",
  assignedTo: "Assignée à {name}",
  teammateLower: "un membre de l'équipe",
  assignFailed: "Impossible d'assigner.",
  hideInfoAria: "Masquer les détails de la conversation",
  showInfoAria: "Afficher les détails de la conversation",
  conversationInfo: "Détails de la conversation",
  showLabel: "Afficher",
  markUnread: "Marquer comme non lue",
  markedUnread: "Marquée comme non lue",
  markUnreadFailed: "Impossible de marquer ceci comme non lu.",
  spam: "Pourriel",
  viewAttachments: "Voir les pièces jointes",
  statusUpdateFailed: "Impossible de mettre à jour le statut.",
  conversationClosed: "Conversation fermée",
  undoFailed: "Impossible d'annuler.",
  spamUpdateFailed: "Impossible de mettre à jour le pourriel.",
  markedAsSpam: "Marquée comme pourriel",
  markedAsNotSpam: "Marquée comme non pourriel",
  reminderSetFailed: "Impossible de créer ce rappel.",
  snoozeFailed: "Impossible de reporter cette conversation.",
  bringBackFailed: "Impossible de ramener cette conversation.",
  reminderCancelled: "Rappel annulé",
  backInYourInbox: "De retour dans votre boîte de réception",
  pinUpdateFailed: "Impossible de mettre à jour l'épinglage.",
  conversationPinned: "Conversation épinglée",
  conversationUnpinned: "Conversation désépinglée",
  carrierStopNote:
    "Ce client a texté STOP. Lui seul peut annuler cela, en textant START à " +
    "votre numéro.",
  markOptedInAgain: "Marquer comme réabonné",
  markedOptedInAgain: "Marqué comme réabonné.",
  optOutUpdateFailed: "Impossible de mettre à jour le désabonnement.",
  optOutContact: "Désabonner le contact",
  optOutTitle: "Désabonner {name} ?",
  optOutDescription:
    "Ce client ne recevra plus vos textos. Utilisez ceci lorsqu'un client " +
    "demande de ne plus avoir de vos nouvelles, peu importe la formulation.",
  optingOut: "Désabonnement…",
  optOut: "Désabonner",
  contactOptedOut: "Contact désabonné.",
  optOutFailed: "Impossible de désabonner le contact.",

  // --- The thread screen ----------------------------------------------------
  conversationNotFound: "Cette conversation n'existe pas ou a été supprimée.",
  conversationInfoForAria: "Détails de la conversation avec {name}",
  resizePanelAria: "Redimensionner le panneau du contact",
  panelWidthAria: "{pixels} pixels",

  // --- In-thread filter -----------------------------------------------------
  showInConversationAria: "Afficher dans la conversation",
};
