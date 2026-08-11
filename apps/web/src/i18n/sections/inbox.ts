/**
 * #228 — the words the inbox and the crew queue says, in both languages.
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
 * ---------------------------------------------------------------------------
 * THIS SECTION IS READ AS SOURCE TEXT BY THREE PARITY GUARDS.
 *
 * `components/for-you/response-time-parity.test.ts`,
 * `components/for-you/satisfaction-parity.test.ts` and
 * `packages/shared/src/first-run-copy.test.ts` compare web's ENGLISH against
 * the Kotlin and Swift hand-ports, and web's English now lives here rather than
 * in the component. Changing an English value below is therefore a change to
 * three clients, and the guard says so with the file to open.
 */
import type { Translated } from "../translated";

export const inboxEn = {
  // --- The list pane's own chrome (inbox-pane.tsx) --------------------------
  title: "Inbox",
  newConversationAria: "New conversation",
  newAction: "New",

  // --- Empty states (empty-states.tsx) --------------------------------------
  emptyEveryoneAnswered: "Everyone has been answered.",
  emptyNothingSnoozed: "Nothing snoozed.",
  emptyNothingWaiting: "Nothing waiting on you.",
  activationCheckoutOwner:
    "One step left: finish checkout to get your business number and start texting.",
  activationCheckoutMember:
    "Checkout isn't finished yet. Ask your account owner to complete it, then " +
    "your business number appears here.",
  activationFinishSetup: "Finish setting up",
  activationCanceledOwner:
    "Your subscription is canceled, so there's no active number. Restart it " +
    "from billing to keep texting.",
  activationCanceledMember:
    "Your subscription is canceled, so there's no active number. Ask your " +
    "account owner to restart it.",
  activationGoToBilling: "Go to billing",
  activationSeeProgress: "See progress in Settings",
  activationCopyNumber: "Copy your business number",
  activationCaption:
    "This is your business number. Text it from your phone right now, and " +
    "your message will appear here.",

  // --- One row of the list (conversation-row.tsx) ---------------------------
  // The row's aria-label is assembled from these fragments, each carrying its
  // own leading punctuation so the joining stays in the component and the
  // WORDS stay here.
  rowAriaConversationWith: "Conversation with {name}",
  rowAriaUnread: ", unread",
  rowAriaPinned: ", pinned",
  rowAriaInternalNote: ", internal note",
  rowAriaAssignedTo: ", assigned to {name}",
  rowAriaSpam: ", spam",
  rowAriaSnoozed: ", snoozed, {until}",
  rowAriaWithAttachment: ", with {label}",
  rowPreviewYou: "You: ",
  rowPinnedAria: "Pinned",
  rowNoteAria: "Note",
  rowAssignedToTitle: "Assigned to {name}",
  spamLabel: "Spam",

  // --- The status pill (status-pill.tsx) ------------------------------------
  /*
   * Shorter than the filter chips above on purpose: a pill sits inside a row
   * that already says who and when, so `statusWaitingOnThem`'s extra words
   * would push the name out (phone-header-is-full).
   */
  pillNew: "New",
  pillOpen: "Open",
  pillWaiting: "Waiting",
  pillClosed: "Closed",
  /*
   * The same four INSIDE a sentence — "Sam marked this waiting" (the thread's
   * system lines). A lowercased pill label is the version that breaks: French
   * capitalises differently and a `.toLowerCase()` over translated copy is a
   * rule about English hiding in a helper.
   */
  pillNewInSentence: "new",
  pillOpenInSentence: "open",
  pillWaitingInSentence: "waiting",
  pillClosedInSentence: "closed",

  // --- The virtualized list (conversation-list.tsx) -------------------------
  listLoadFailed:
    "We couldn't load your conversations. Check your connection and try again.",
  listAria: "Conversations",
  listSelectRowAria: "Select conversation with {name}",
  listLoadingMore: "Loading more…",
  bulkActionFailed: "That bulk action didn't go through. Nothing changed.",

  // --- The selection bar (bulk-bar.tsx) -------------------------------------
  bulkClearSelectionAria: "Clear selection",
  bulkSelectAllLoaded: "Select all {count} loaded",
  bulkSelectAllMatching: "Select all matching this filter",
  bulkMarkRead: "Mark read",
  bulkClose: "Close",
  bulkSpam: "Spam",
  bulkMore: "More",
  bulkAssignTo: "Assign to",
  bulkNobody: "Nobody",
  bulkAddTag: "Add tag",

  // --- The filter bar (filter-bar.tsx + filter-url.ts) ----------------------
  segmentOpen: "Open",
  segmentMine: "Mine",
  segmentAll: "All",
  segmentClosed: "Closed",
  statusTablistAria: "Conversation status",
  openCountAria: "{count} open",
  openCountOverAria: "over {cap} open",
  searchPausesFilters:
    "Search looks through every conversation, so these filters are paused.",
  searchPlaceholder: "Search conversations",
  searchAria: "Search conversations and contacts",
  clearSearchAria: "Clear search",
  // #548: only ever a status the segments cannot show, so the word alone would
  // sit beside four tabs meaning the same kind of thing.
  statusChipLabel: "Status: {label}",
  statusChipUnset: "set",
  statusNew: "New",
  statusOpen: "Open",
  statusWaitingOnThem: "Waiting on them",
  statusClosed: "Closed",
  chipAssignee: "Assignee",
  chipTag: "Tag",
  chipUnread: "Unread",
  chipSpam: "Spam",
  chipSnoozed: "Snoozed",
  chipUnanswered: "Unanswered",
  clearAll: "Clear all",
  removeFilterAria: "Remove {label} filter",
  addFilterAria: "Add filter",
  filterAction: "Filter",
  filterByPlaceholder: "Filter by…",
  filterNone: "No filters.",
  filterGroupAssignee: "Assignee",
  filterGroupTag: "Tag",
  filterGroupMore: "More",
  teammateFallback: "Teammate",
  youSuffix: " (you)",

  // --- The getting-started checklist (getting-started-card.tsx) -------------
  // Read verbatim by packages/shared/src/first-run-copy.test.ts, which holds
  // Android and iOS to the same words.
  startedMemberTitle: "Getting the hang of it",
  startedMemberReplyLabel: "Answer a customer",
  // THE THREE HINTS BELOW ARE ONE LITERAL EACH, DELIBERATELY OVER-LONG.
  // `first-run-copy.test.ts` compares them to the Kotlin and Swift ports with a
  // verbatim `includes`, so a `"…" + "…"` wrap — which reads better and which
  // this file uses everywhere else — splits the sentence in the source and the
  // guard reports web as the client that lost the line. Prettier does not break
  // string literals, so leaving them long is stable.
  startedMemberReplyHint:
    "Open a thread and reply. It goes out from the business number, and the whole crew can see it.",
  startedMemberNoteLabel: "Leave a note for the crew",
  startedMemberNoteHint:
    "Switch the composer to Note. Notes stay inside the app — the customer never sees them.",
  startedMemberDoneLabel: "Mark something done",
  startedMemberDoneHint:
    "Tick a message off when it is handled, so the rest of the crew knows nobody needs to chase it.",
  startedMemberNotifications: "Your notification settings are yours alone.",
  startedMemberNotificationsLink: "Change when we buzz you",
  startedOwnerTitle: "Getting started",
  startedOwnerSignupLabel: "Set your workspace up",
  startedOwnerNumberLabel: "Get your business number",
  startedOwnerNumberHint: "It's on its way, usually under a minute.",
  startedOwnerNumberStalledHint:
    "Taking a little longer than usual. You don't need to do anything.",
  startedOwnerInboundLabel: "Receive your first text",
  startedOwnerInboundHint:
    "Text your number from your phone, and it lands right here.",
  startedOwnerReplyLabel: "Send your first reply",
  startedOwnerReplyHint:
    "Open a conversation and answer like you would from your cell.",
  startedOwnerTeammateLabel: "Invite a teammate",
  startedOwnerTeammateLink: "Invite",
  startedProgress: "{done} of {total} done",
  startedProgressAria: "{done} of {total} steps done",
  startedDismissAria: "Dismiss {title}",
  startedStepDone: ", done",
  startedStepNotDone: ", not done yet",

  // --- Compose (new-conversation.tsx) ---------------------------------------
  composeBackAria: "Back to inbox",
  composeTitle: "New conversation",
  composeToLabel: "To",
  composeChangeRecipientAria: "Change recipient",
  composeToPlaceholder: "Search contacts or type a number",
  composeToAria: "Recipient: search contacts or type a phone number",
  composeMatchesAria: "Recipient matches",
  composeTextNumber: "Text {number}",
  composeKeepTyping: "Keep typing. A US or Canada number has 10 digits.",
  composeSearching: "Searching…",
  composeNoContacts: "No matching contacts.",
  composeFromLabel: "From",
  composeChooseNumber: "Choose a number",
  composeNumberProvisioning:
    "Your business number is still being set up. Sending unlocks the moment " +
    "it's ready.",
  composeMessageLabel: "Message",
  composeAttachAria: "Attach files",
  composeAttach: "Attach",
  composeSavedReply: "Saved reply",
  composeBodyPlaceholder: "Write your text…  (/ for a saved reply)",
  composeNeedsWords:
    "Add a short message. The first text in a new conversation can't be just " +
    "an attachment.",
  composeLocalTimeQuiet:
    "It's {time} for this customer. We'll ask before sending this late.",
  composeLocalTime: "It's {time} for them.",
  composeQuietTitle: "It's {time} for this customer.",
  composeQuietTitleUnknown: "It's late where this customer is.",
  composeQuietBody: "Send anyway?",
  composeQuietWait: "Wait",
  composeSend: "Send",
  composeSending: "Sending…",
  composeFileReadFailed: "Couldn't read that file. Try attaching it again.",
  composeSendFailed: "That didn't send. Check your connection and try again.",

  // --- Saved views (saved-views-bar.tsx) ------------------------------------
  viewsAria: "Saved views",
  viewSharedAria: "Shared",
  viewsSave: "Save this view",
  viewOptionsAria: "Options for {name}",
  viewStopOpeningHere: "Stop opening here",
  viewOpenHereByDefault: "Open here by default",
  viewRename: "Rename",
  viewMakeMine: "Make it just mine",
  viewShareWithCrew: "Share with the crew",
  viewSaveDescription:
    "The filters you have on now, under a name, one tap away tomorrow.",
  viewNameLabel: "Name",
  viewNamePlaceholder: "Monday morning",
  viewShareToggle: "Share it with the crew",
  viewShareNote:
    "Everyone gets the same view, and each person sees only the numbers they " +
    "already have access to.",
  viewSaveFailed: "Could not save that. Try again in a moment.",
  viewRenameTitle: "Rename view",
  viewRenameFailed: "Could not rename that. Try again in a moment.",
  viewDeleteTitle: "Delete “{name}”?",
  viewDeleteBody:
    "The whole crew uses this one. Anyone who opens the app here will land on " +
    "the ordinary inbox instead.",
  viewDeleteKeep: "Keep it",
  viewDeleteConfirm: "Delete for everyone",

  // --- Search results (search-results.tsx) ----------------------------------
  searchFailed: "Search isn't responding. Try again in a moment.",
  searchNoMatches: "No matches for “{query}”.",
  searchConversationsAria: "Matching conversations",
  searchConversationsHeading: "Conversations",
  searchContactsAria: "Matching contacts",
  searchContactsHeading: "Contacts",

  // --- The crew queue (for-you-view.tsx) ------------------------------------
  forYouTitle: "For you",
  forYouWorkOne: "{count} thing needs you · you're all caught up otherwise",
  forYouWorkMany: "{count} things need you · you're all caught up otherwise",
  forYouAllCaughtUp: "You're all caught up.",
  forYouSearchAria: "Search",
  forYouWhyOverdueTask: "Overdue task",
  forYouWhyUnread: "Unread · {when}",
  forYouWhyWaiting: "Waiting · {when}",
  forYouWhyFollowUpNote: "{note} · asked {when}",
  forYouWhyNoReply: "No reply since {when}",
  forYouWhyDue: "Due {when}",
  forYouWhyOpenTask: "Open task",
  forYouWhyUnassignedOverdue: "Unassigned · overdue",
  forYouWhyUnassignedTask: "Unassigned task",
  forYouCompleteTaskAria: "Complete task: {title}",
  forYouOpenConversationAria: "Open conversation",
  forYouTaskCompleteFailed: "Couldn't complete the task.",
  forYouTaskCompleted: "Task completed",
  forYouUndoFailed: "Couldn't undo.",
  forYouNewLead: "New lead",
  forYouUnknownCaller: "Unknown caller",
  forYouRecentCalls: "Recent calls",
  forYouViewAllCalls: "View all calls",
  forYouOverflowShowing: "Showing {shown} of ",
  forYouOverflowLabel: " · {label}",
  forYouOverflowUnassignedConversations:
    "unassigned conversations in the inbox",
  forYouOverflowAllTasks: "all tasks",
  forYouOverflowRestInInbox: "see the rest in your inbox",
  forYouOverflowOpenTasks: "see all your open tasks",
  forYouTileOverdue: "{count} overdue",
  forYouTileOldest: "oldest {when}",
  forYouSectionUnassigned: "Unassigned",
  forYouSectionWaiting: "Waiting on you",
  forYouSectionTasks: "My tasks",
  forYouSectionUnread: "Unread",
  forYouSectionChaseThese: "Chase these",
  forYouSectionSpamReview: "Marked spam, still texting",
  forYouSpamWhyTexted: "You texted them before this was marked",
  forYouSpamWhySustained: "Still texting {when}, over several days",
  forYouSpamWhyCount: "{count} messages since it was marked",
  forYouNotSpam: "Not spam",
  forYouStillSpam: "Still spam",
  forYouBackInInbox: "Back in the inbox.",
  forYouUndoMarkFailed: "Couldn't undo the mark.",
  forYouLeftAsSpam: "Left as spam.",
  forYouSaveFailed: "Couldn't save that.",
  forYouNewLeadsHere: "New leads will show up here.",
  forYouOpenInbox: "Open the inbox",
  forYouLoadFailed:
    "We couldn't load your queue. Check your connection and try again.",

  // --- Customise the dashboard (customise-dashboard.tsx) --------------------
  customiseAria: "Customise this screen",
  customiseAriaPutAwayOne: "Customise this screen — {count} panel put away",
  customiseAriaPutAwayMany: "Customise this screen — {count} panels put away",
  customiseTitle: "What's on this screen",
  customiseQueueStays:
    "The queue always stays. Work isn't something you can switch off.",
  customiseSaveFailed:
    "We couldn't save that — it's back the way it was. Try again in a moment.",
  customiseGroupMeasures: "Measures",
  customiseGroupHistory: "History",

  // --- Where the customers came from (lead-sources-card.tsx) ----------------
  leadSourcesTitle: "Where your customers come from",
  leadSourcesLeading:
    "Most of the work you can account for came from {name} — {count} of {total}.",
  leadSourcesMore: "{count} more",
  leadSourcesNoneSetUp:
    "You haven't told us yet. Put a source on the numbers you advertise — the " +
    "one on the truck, the one in the ad — and every call and text to them is " +
    "counted from then on, with nobody tapping anything.",
  leadSourcesSetOneUp: "Set one up",
  leadSourcesUnknown: "Don't know",
  leadSourcesFooterOne: "Last 30 days · {count} conversation",
  leadSourcesFooterMany: "Last 30 days · {count} conversations",

  // --- The quote pipeline (pipeline-card.tsx) -------------------------------
  pipelineTitle: "Quotes",
  pipelineWindow: "last 30 days",
  pipelineTooEarlyOne: "{count} quote sent. Too early to call a win rate.",
  pipelineTooEarlyMany: "{count} quotes sent. Too early to call a win rate.",
  pipelineDeltaPoints: "{delta} pts",
  pipelineQuoted: "Quoted",
  pipelineWon: "Won",
  pipelineStillOut: "Still out",
  pipelineShareAria: "Of {quoted} quoted, {won} won and {open} still out",
  pipelineChase: "Chase the {count} still waiting",

  // --- The referral ask (referral-ask.tsx) ----------------------------------
  referralGettingLink: "Getting your link…",

  // --- Response time (response-time-card.tsx) -------------------------------
  // Read verbatim by components/for-you/response-time-parity.test.ts, which
  // holds Android and iOS to the same sentences.
  responseTimeTitle: "Response time",
  responseWindowAria: "Window",
  responseLoadFailed: "Could not load your response time.",
  responseNoLeads:
    "No new customers texted you in the last {days} days, so there is nothing " +
    "to measure yet.",
  responseRingAria: "{answered} of {leads} new customers answered",
  responseToAnswer: "to answer a new customer",
  responseArcDown: "Down from {then} when you started",
  responseArcUp: "Up from {then} when you started",
  responseNoArcTooNew:
    "Your starting point lands once you have been here a fortnight",
  responseNoArcNoLeads:
    "No answered leads in your first two weeks, so there is nothing to compare",
  responseNoArcSame: "About the same as when you started",
  responseUnansweredOne: "1 lead nobody answered",
  responseUnansweredMany: "{count} leads nobody answered",
  responseDetails: "Details",
  responseHideDetails: "Hide details",
  responseSlowest: "Slowest 10% of answers",
  responseDuringHours: "During hours ({count})",
  responseAfterHours: "After hours ({count})",
  responseByNumber: "{number} · {count} unanswered",
  responseByMember: "Member · {count} answered",
  responseSplitTruncated:
    "The hours split covers your most recent {limit} leads; the numbers above " +
    "it cover all {total}.",

  // --- Satisfaction (satisfaction-card.tsx) ---------------------------------
  // Read verbatim by components/for-you/satisfaction-parity.test.ts.
  satisfactionTitle: "Satisfaction",
  satisfactionLoadFailed: "Could not load your ratings.",
  satisfactionArcUp: "Up from {then} the month before",
  satisfactionArcDown: "Down from {then} the month before",
  satisfactionGapTooFew: "{copy} — {answered} of {minimum}",
  satisfactionNoBaseline: "No month before this one to compare against yet",
  satisfactionSame: "About the same as the month before",
  satisfactionRingAria: "{score} out of 5, from {count} answers",
  satisfactionOutOfFive: "out of 5, from {count} answers",
  satisfactionStarsOne: "1 star",
  satisfactionStarsMany: "{count} stars",
  satisfactionAsked: "Asked",
  satisfactionAskedValue: "{count} in {days} days",
  satisfactionMemberFallback: "Member",
  satisfactionByMember: "{name} · {count} answered",
  satisfactionTruncated: "Showing the most recent {count} ratings.",

  // --- The waiting room (while-you-wait.tsx) --------------------------------
  whileWaitProgressAria: "Texting registration progress",
  whileWaitCallsWork: "Calls already work",
  whileWaitCallsBody:
    "Your number rings, takes voicemail, and texts back anyone you miss. None " +
    "of that waits on the carriers.",
  whileWaitContacts: "Bring your customers in",
  whileWaitInvite: "Invite your crew",
  whileWaitHours: "Set your hours and greeting",

  /* ── What "selected" says, and what a bulk action reports back ────────────
     `lib/inbox/bulk-selection.ts`, read by the inbox bar and the task bar.

     `bulkSelectedAllMatching` deliberately carries no number. The server has
     not counted the set yet, and a confident "340 selected" that turns out to
     be the 25 loaded rows is the trap #275 is about.

     The result sentence is assembled from a VERB and a NOUN the caller
     supplies — "Closed", "conversations" — because which action ran is the
     caller's fact, not this module's. They are interpolated rather than
     concatenated so a translator can put them where the sentence needs them. */
  bulkSelectedCount: "{count} selected",
  bulkSelectedAllMatching: "All matching this filter",
  bulkResultApplied: "{verb} {count} {thing}",
  /** Appended when the server capped one pass, so the remainder is named. */
  bulkResultCapped:
    ". {count} more matched than one go can handle, so run it again",
  /** …and when some rows could not be touched. Never swallowed. */
  bulkResultFailedOne: ". {count} couldn't be reached and was left alone",
  bulkResultFailedMany: ". {count} couldn't be reached and were left alone",
} as const;

/**
 * Quebec French, vouvoiement throughout, accents spelled normally — the GSM-7
 * restriction in packages/shared/src/locale.ts governs SMS bodies, and nothing
 * on a web page is billed by the segment.
 *
 * Two vocabulary decisions worth writing down, because they recur:
 *
 * - **Indésirable**, not "spam", for a thread the crew has marked. It is the
 *   word every French mailbox on this continent uses for the same action, and
 *   it is a word rather than a borrowing the reader has to recognise.
 * - **Mise en veille** for a snoozed conversation: it is deferred, not
 *   archived, and "reportée" would read as a rescheduled appointment.
 *
 * STOP / HELP / START / URGENT are never translated — a carrier matches on
 * them — and neither are Loonext, Stripe or Telnyx.
 */
export const inboxFr: Translated<typeof inboxEn> = {
  // --- The list pane's own chrome -------------------------------------------
  title: "Boîte de réception",
  newConversationAria: "Nouvelle conversation",
  newAction: "Nouveau",

  // --- Empty states ----------------------------------------------------------
  emptyEveryoneAnswered: "Tout le monde a reçu une réponse.",
  emptyNothingSnoozed: "Rien en veille.",
  emptyNothingWaiting: "Rien n'attend après vous.",
  activationCheckoutOwner:
    "Une étape reste : terminez le paiement pour obtenir votre numéro " +
    "d'entreprise et commencer à texter.",
  activationCheckoutMember:
    "Le paiement n'est pas terminé. Demandez au propriétaire du compte de le " +
    "finaliser, et votre numéro d'entreprise apparaîtra ici.",
  activationFinishSetup: "Terminer la configuration",
  activationCanceledOwner:
    "Votre abonnement est annulé, donc aucun numéro n'est actif. Reprenez-le " +
    "depuis la facturation pour continuer à texter.",
  activationCanceledMember:
    "Votre abonnement est annulé, donc aucun numéro n'est actif. Demandez au " +
    "propriétaire du compte de le reprendre.",
  activationGoToBilling: "Aller à la facturation",
  activationSeeProgress: "Voir la progression dans les paramètres",
  activationCopyNumber: "Copier votre numéro d'entreprise",
  activationCaption:
    "Voici votre numéro d'entreprise. Textez-le depuis votre téléphone dès " +
    "maintenant, et votre message apparaîtra ici.",

  // --- One row of the list ---------------------------------------------------
  rowAriaConversationWith: "Conversation avec {name}",
  rowAriaUnread: ", non lue",
  rowAriaPinned: ", épinglée",
  rowAriaInternalNote: ", note interne",
  rowAriaAssignedTo: ", assignée à {name}",
  rowAriaSpam: ", indésirable",
  rowAriaSnoozed: ", en veille, {until}",
  rowAriaWithAttachment: ", avec {label}",
  rowPreviewYou: "Vous : ",
  rowPinnedAria: "Épinglée",
  rowNoteAria: "Note",
  rowAssignedToTitle: "Assignée à {name}",
  spamLabel: "Indésirable",

  // --- The status pill -------------------------------------------------------
  pillNew: "Nouvelle",
  pillOpen: "Ouverte",
  pillWaiting: "En attente",
  pillClosed: "Fermée",
  pillNewInSentence: "nouvelle",
  pillOpenInSentence: "ouverte",
  pillWaitingInSentence: "en attente",
  pillClosedInSentence: "fermée",

  // --- The virtualized list --------------------------------------------------
  listLoadFailed:
    "Impossible de charger vos conversations. Vérifiez votre connexion et " +
    "réessayez.",
  listAria: "Conversations",
  listSelectRowAria: "Sélectionner la conversation avec {name}",
  listLoadingMore: "Chargement…",
  bulkActionFailed: "L'action groupée n'a pas abouti. Rien n'a changé.",

  // --- The selection bar -----------------------------------------------------
  bulkClearSelectionAria: "Effacer la sélection",
  bulkSelectAllLoaded: "Sélectionner les {count} chargées",
  bulkSelectAllMatching: "Sélectionner tout ce qui correspond à ce filtre",
  bulkMarkRead: "Marquer comme lues",
  bulkClose: "Fermer",
  bulkSpam: "Indésirable",
  bulkMore: "Plus",
  bulkAssignTo: "Assigner à",
  bulkNobody: "Personne",
  bulkAddTag: "Ajouter une étiquette",

  // --- The filter bar --------------------------------------------------------
  segmentOpen: "Ouvertes",
  segmentMine: "Les miennes",
  segmentAll: "Toutes",
  segmentClosed: "Fermées",
  statusTablistAria: "Statut des conversations",
  openCountAria: "{count} ouvertes",
  openCountOverAria: "plus de {cap} ouvertes",
  searchPausesFilters:
    "La recherche parcourt toutes les conversations, alors ces filtres sont " +
    "en pause.",
  searchPlaceholder: "Rechercher des conversations",
  searchAria: "Rechercher des conversations et des contacts",
  clearSearchAria: "Effacer la recherche",
  statusChipLabel: "Statut : {label}",
  statusChipUnset: "défini",
  statusNew: "Nouvelle",
  statusOpen: "Ouverte",
  statusWaitingOnThem: "En attente du client",
  statusClosed: "Fermée",
  chipAssignee: "Responsable",
  chipTag: "Étiquette",
  chipUnread: "Non lues",
  chipSpam: "Indésirables",
  chipSnoozed: "En veille",
  chipUnanswered: "Sans réponse",
  clearAll: "Tout effacer",
  removeFilterAria: "Retirer le filtre {label}",
  addFilterAria: "Ajouter un filtre",
  filterAction: "Filtrer",
  filterByPlaceholder: "Filtrer par…",
  filterNone: "Aucun filtre.",
  filterGroupAssignee: "Responsable",
  filterGroupTag: "Étiquette",
  filterGroupMore: "Plus",
  teammateFallback: "Coéquipier",
  youSuffix: " (vous)",

  // --- The getting-started checklist -----------------------------------------
  startedMemberTitle: "Prendre le rythme",
  startedMemberReplyLabel: "Répondre à un client",
  startedMemberReplyHint:
    "Ouvrez une conversation et répondez. Le texto part du numéro " +
    "d'entreprise, et toute l'équipe le voit.",
  startedMemberNoteLabel: "Laisser une note à l'équipe",
  startedMemberNoteHint:
    "Basculez le champ de rédaction en mode Note. Les notes restent dans " +
    "l'application — le client ne les voit jamais.",
  startedMemberDoneLabel: "Marquer quelque chose comme fait",
  startedMemberDoneHint:
    "Cochez un message une fois qu'il est réglé, pour que le reste de " +
    "l'équipe sache que personne n'a à le relancer.",
  startedMemberNotifications:
    "Vos paramètres de notification n'appartiennent qu'à vous.",
  startedMemberNotificationsLink: "Choisir quand nous vous avertissons",
  startedOwnerTitle: "Premiers pas",
  startedOwnerSignupLabel: "Configurer votre espace de travail",
  startedOwnerNumberLabel: "Obtenir votre numéro d'entreprise",
  startedOwnerNumberHint: "Il arrive, habituellement en moins d'une minute.",
  startedOwnerNumberStalledHint:
    "Cela prend un peu plus de temps que d'habitude. Vous n'avez rien à faire.",
  startedOwnerInboundLabel: "Recevoir votre premier texto",
  startedOwnerInboundHint:
    "Textez votre numéro depuis votre téléphone, et le message arrive ici.",
  startedOwnerReplyLabel: "Envoyer votre première réponse",
  startedOwnerReplyHint:
    "Ouvrez une conversation et répondez comme vous le feriez de votre " +
    "cellulaire.",
  startedOwnerTeammateLabel: "Inviter un coéquipier",
  startedOwnerTeammateLink: "Inviter",
  startedProgress: "{done} sur {total} de fait",
  startedProgressAria: "{done} étapes sur {total} de faites",
  startedDismissAria: "Masquer {title}",
  startedStepDone: ", fait",
  startedStepNotDone: ", pas encore fait",

  // --- Compose ---------------------------------------------------------------
  composeBackAria: "Retour à la boîte de réception",
  composeTitle: "Nouvelle conversation",
  composeToLabel: "À",
  composeChangeRecipientAria: "Changer de destinataire",
  composeToPlaceholder: "Cherchez un contact ou tapez un numéro",
  composeToAria: "Destinataire : cherchez un contact ou tapez un numéro",
  composeMatchesAria: "Destinataires correspondants",
  composeTextNumber: "Texter {number}",
  composeKeepTyping:
    "Continuez. Un numéro canadien ou américain compte 10 chiffres.",
  composeSearching: "Recherche…",
  composeNoContacts: "Aucun contact correspondant.",
  composeFromLabel: "De",
  composeChooseNumber: "Choisissez un numéro",
  composeNumberProvisioning:
    "Votre numéro d'entreprise est encore en préparation. L'envoi se " +
    "débloquera dès qu'il sera prêt.",
  composeMessageLabel: "Message",
  composeAttachAria: "Joindre des fichiers",
  composeAttach: "Joindre",
  composeSavedReply: "Réponse enregistrée",
  composeBodyPlaceholder:
    "Écrivez votre texto…  (/ pour une réponse enregistrée)",
  composeNeedsWords:
    "Ajoutez un court message. Le premier texto d'une nouvelle conversation " +
    "ne peut pas être seulement une pièce jointe.",
  composeLocalTimeQuiet:
    "Il est {time} chez ce client. Nous demanderons confirmation avant " +
    "d'envoyer aussi tard.",
  composeLocalTime: "Il est {time} chez lui.",
  composeQuietTitle: "Il est {time} chez ce client.",
  composeQuietTitleUnknown: "Il est tard là où se trouve ce client.",
  composeQuietBody: "Envoyer quand même ?",
  composeQuietWait: "Attendre",
  composeSend: "Envoyer",
  composeSending: "Envoi…",
  composeFileReadFailed:
    "Impossible de lire ce fichier. Essayez de le joindre à nouveau.",
  composeSendFailed:
    "L'envoi a échoué. Vérifiez votre connexion et réessayez.",

  // --- Saved views -----------------------------------------------------------
  viewsAria: "Vues enregistrées",
  viewSharedAria: "Partagée",
  viewsSave: "Enregistrer cette vue",
  viewOptionsAria: "Options pour {name}",
  viewStopOpeningHere: "Ne plus ouvrir ici",
  viewOpenHereByDefault: "Ouvrir ici par défaut",
  viewRename: "Renommer",
  viewMakeMine: "La garder pour moi",
  viewShareWithCrew: "Partager avec l'équipe",
  viewSaveDescription:
    "Les filtres que vous avez en ce moment, sous un nom, à une touche demain.",
  viewNameLabel: "Nom",
  viewNamePlaceholder: "Lundi matin",
  viewShareToggle: "La partager avec l'équipe",
  viewShareNote:
    "Tout le monde obtient la même vue, et chaque personne ne voit que les " +
    "numéros auxquels elle a déjà accès.",
  viewSaveFailed: "Impossible d'enregistrer. Réessayez dans un moment.",
  viewRenameTitle: "Renommer la vue",
  viewRenameFailed: "Impossible de renommer. Réessayez dans un moment.",
  viewDeleteTitle: "Supprimer « {name} » ?",
  viewDeleteBody:
    "Toute l'équipe utilise celle-ci. Quiconque ouvre l'application ici " +
    "arrivera plutôt sur la boîte de réception ordinaire.",
  viewDeleteKeep: "La garder",
  viewDeleteConfirm: "Supprimer pour tout le monde",

  // --- Search results --------------------------------------------------------
  searchFailed: "La recherche ne répond pas. Réessayez dans un moment.",
  searchNoMatches: "Aucun résultat pour « {query} ».",
  searchConversationsAria: "Conversations correspondantes",
  searchConversationsHeading: "Conversations",
  searchContactsAria: "Contacts correspondants",
  searchContactsHeading: "Contacts",

  // --- The crew queue --------------------------------------------------------
  forYouTitle: "Pour vous",
  forYouWorkOne:
    "{count} chose demande votre attention · vous êtes à jour pour le reste",
  forYouWorkMany:
    "{count} choses demandent votre attention · vous êtes à jour pour le reste",
  forYouAllCaughtUp: "Vous êtes à jour.",
  forYouSearchAria: "Rechercher",
  forYouWhyOverdueTask: "Tâche en retard",
  forYouWhyUnread: "Non lue · {when}",
  forYouWhyWaiting: "En attente · {when}",
  forYouWhyFollowUpNote: "{note} · demandé {when}",
  forYouWhyNoReply: "Aucune réponse depuis {when}",
  forYouWhyDue: "Échéance {when}",
  forYouWhyOpenTask: "Tâche ouverte",
  forYouWhyUnassignedOverdue: "Non assignée · en retard",
  forYouWhyUnassignedTask: "Tâche non assignée",
  forYouCompleteTaskAria: "Terminer la tâche : {title}",
  forYouOpenConversationAria: "Ouvrir la conversation",
  forYouTaskCompleteFailed: "Impossible de terminer la tâche.",
  forYouTaskCompleted: "Tâche terminée",
  forYouUndoFailed: "Impossible d'annuler.",
  forYouNewLead: "Nouveau client potentiel",
  forYouUnknownCaller: "Appelant inconnu",
  forYouRecentCalls: "Appels récents",
  forYouViewAllCalls: "Voir tous les appels",
  forYouOverflowShowing: "Affichage de {shown} sur ",
  forYouOverflowLabel: " · {label}",
  forYouOverflowUnassignedConversations:
    "conversations non assignées dans la boîte de réception",
  forYouOverflowAllTasks: "toutes les tâches",
  forYouOverflowRestInInbox: "voir le reste dans votre boîte de réception",
  forYouOverflowOpenTasks: "voir toutes vos tâches ouvertes",
  forYouTileOverdue: "{count} en retard",
  forYouTileOldest: "la plus ancienne {when}",
  forYouSectionUnassigned: "Non assignées",
  forYouSectionWaiting: "En attente de vous",
  forYouSectionTasks: "Mes tâches",
  forYouSectionUnread: "Non lues",
  forYouSectionChaseThese: "À relancer",
  forYouSectionSpamReview: "Marquées indésirables, textent encore",
  forYouSpamWhyTexted: "Vous leur avez texté avant ce marquage",
  forYouSpamWhySustained: "Textent encore {when}, sur plusieurs jours",
  forYouSpamWhyCount: "{count} messages depuis le marquage",
  forYouNotSpam: "Pas indésirable",
  forYouStillSpam: "Toujours indésirable",
  forYouBackInInbox: "De retour dans la boîte de réception.",
  forYouUndoMarkFailed: "Impossible d'annuler le marquage.",
  forYouLeftAsSpam: "Laissée comme indésirable.",
  forYouSaveFailed: "Impossible d'enregistrer.",
  forYouNewLeadsHere: "Les nouveaux clients potentiels apparaîtront ici.",
  forYouOpenInbox: "Ouvrir la boîte de réception",
  forYouLoadFailed:
    "Impossible de charger votre file. Vérifiez votre connexion et réessayez.",

  // --- Customise the dashboard -----------------------------------------------
  customiseAria: "Personnaliser cet écran",
  customiseAriaPutAwayOne: "Personnaliser cet écran — {count} panneau rangé",
  customiseAriaPutAwayMany: "Personnaliser cet écran — {count} panneaux rangés",
  customiseTitle: "Ce qu'il y a sur cet écran",
  customiseQueueStays:
    "La file reste toujours. Le travail ne se désactive pas.",
  customiseSaveFailed:
    "Impossible d'enregistrer — tout est revenu comme avant. Réessayez dans " +
    "un moment.",
  customiseGroupMeasures: "Mesures",
  customiseGroupHistory: "Historique",

  // --- Where the customers came from -----------------------------------------
  leadSourcesTitle: "D'où viennent vos clients",
  leadSourcesLeading:
    "La majorité du travail que vous pouvez attribuer vient de {name} — " +
    "{count} sur {total}.",
  leadSourcesMore: "{count} de plus",
  leadSourcesNoneSetUp:
    "Vous ne nous l'avez pas encore dit. Attribuez une source aux numéros que " +
    "vous annoncez — celui sur le camion, celui dans la publicité — et chaque " +
    "appel et texto vers ces numéros est compté à partir de là, sans que " +
    "personne n'ait à toucher à quoi que ce soit.",
  leadSourcesSetOneUp: "En configurer une",
  leadSourcesUnknown: "Inconnue",
  leadSourcesFooterOne: "30 derniers jours · {count} conversation",
  leadSourcesFooterMany: "30 derniers jours · {count} conversations",

  // --- The quote pipeline ----------------------------------------------------
  pipelineTitle: "Devis",
  pipelineWindow: "30 derniers jours",
  pipelineTooEarlyOne:
    "{count} devis envoyé. Trop tôt pour parler d'un taux de réussite.",
  pipelineTooEarlyMany:
    "{count} devis envoyés. Trop tôt pour parler d'un taux de réussite.",
  pipelineDeltaPoints: "{delta} pts",
  pipelineQuoted: "Envoyés",
  pipelineWon: "Gagnés",
  pipelineStillOut: "En attente",
  pipelineShareAria:
    "Sur {quoted} devis envoyés, {won} gagnés et {open} en attente",
  pipelineChase: "Relancer les {count} en attente",

  // --- The referral ask ------------------------------------------------------
  referralGettingLink: "Récupération de votre lien…",

  // --- Response time ---------------------------------------------------------
  responseTimeTitle: "Temps de réponse",
  responseWindowAria: "Période",
  responseLoadFailed: "Impossible de charger votre temps de réponse.",
  responseNoLeads:
    "Aucun nouveau client ne vous a texté dans les {days} derniers jours, " +
    "alors il n'y a encore rien à mesurer.",
  responseRingAria: "{answered} nouveaux clients sur {leads} ont eu une réponse",
  responseToAnswer: "pour répondre à un nouveau client",
  responseArcDown: "En baisse depuis {then} à vos débuts",
  responseArcUp: "En hausse depuis {then} à vos débuts",
  responseNoArcTooNew:
    "Votre point de départ sera établi après deux semaines ici",
  responseNoArcNoLeads:
    "Aucun client n'a reçu de réponse durant vos deux premières semaines, " +
    "alors il n'y a rien à comparer",
  responseNoArcSame: "À peu près comme à vos débuts",
  responseUnansweredOne: "1 client potentiel sans réponse",
  responseUnansweredMany: "{count} clients potentiels sans réponse",
  responseDetails: "Détails",
  responseHideDetails: "Masquer les détails",
  responseSlowest: "Les 10 % de réponses les plus lentes",
  responseDuringHours: "Pendant les heures ({count})",
  responseAfterHours: "Hors des heures ({count})",
  responseByNumber: "{number} · {count} sans réponse",
  responseByMember: "Membre · {count} avec réponse",
  responseSplitTruncated:
    "La répartition par heures couvre vos {limit} clients potentiels les plus " +
    "récents ; les chiffres au-dessus couvrent l'ensemble des {total}.",

  // --- Satisfaction ----------------------------------------------------------
  satisfactionTitle: "Satisfaction",
  satisfactionLoadFailed: "Impossible de charger vos évaluations.",
  satisfactionArcUp: "En hausse depuis {then} le mois précédent",
  satisfactionArcDown: "En baisse depuis {then} le mois précédent",
  satisfactionGapTooFew: "{copy} — {answered} sur {minimum}",
  satisfactionNoBaseline: "Aucun mois précédent auquel se comparer pour l'instant",
  satisfactionSame: "À peu près comme le mois précédent",
  satisfactionRingAria: "{score} sur 5, à partir de {count} réponses",
  satisfactionOutOfFive: "sur 5, à partir de {count} réponses",
  satisfactionStarsOne: "1 étoile",
  satisfactionStarsMany: "{count} étoiles",
  satisfactionAsked: "Demandées",
  satisfactionAskedValue: "{count} en {days} jours",
  satisfactionMemberFallback: "Membre",
  satisfactionByMember: "{name} · {count} avec réponse",
  satisfactionTruncated: "Affichage des {count} évaluations les plus récentes.",

  // --- The waiting room ------------------------------------------------------
  whileWaitProgressAria: "Progression de l'inscription pour les textos",
  whileWaitCallsWork: "Les appels fonctionnent déjà",
  whileWaitCallsBody:
    "Votre numéro sonne, prend les messages vocaux et renvoie un texto à " +
    "toute personne que vous manquez. Rien de tout cela n'attend les " +
    "opérateurs.",
  whileWaitContacts: "Importer vos clients",
  whileWaitInvite: "Inviter votre équipe",
  whileWaitHours: "Définir vos heures et votre message d'accueil",

  // --- La sélection multiple et ce qu'une action en lot rapporte -------------
  bulkSelectedCount: "{count} sélectionnées",
  bulkSelectedAllMatching: "Toutes celles qui correspondent à ce filtre",
  bulkResultApplied: "{verb} {count} {thing}",
  bulkResultCapped:
    ". {count} de plus correspondent que ce qu'une seule passe peut traiter ; " +
    "relancez l'action",
  bulkResultFailedOne: ". {count} n'a pas pu être atteinte et a été laissée telle quelle",
  bulkResultFailedMany:
    ". {count} n'ont pas pu être atteintes et ont été laissées telles quelles",
};
