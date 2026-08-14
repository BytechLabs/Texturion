package com.loonext.android.core.i18n

/**
 * #228 — the words the inbox and the crew queue say, in both languages.
 *
 * ## Why these two surfaces share one section
 *
 * They share one on web too (`apps/web/src/i18n/sections/inbox.ts`), and the key
 * names below are that file's key names wherever the sentence is the same one.
 * That is not tidiness: three parity guards already read web's ENGLISH and hold
 * the two phones to it word for word (`packages/shared/src/first-run-copy.test.ts`,
 * `components/for-you/response-time-parity.test.ts` and its satisfaction twin).
 * A catalogue that renamed the keys would leave a translator comparing two files
 * that agree about every sentence and about nothing else.
 *
 * The French below is likewise web's French verbatim wherever the English
 * matches, for the reason the register note says: a crew that switches from the
 * laptop to the van must not meet a second product.
 *
 * ## The register
 *
 * Quebec French, VOUVOIEMENT throughout, accents spelled normally — the GSM-7
 * restriction in `MessageLocale` governs the automated TEXTS, which are billed by
 * the segment, and nothing on a screen is. A normal space before `:`, `?` and
 * inside `« »`.
 *
 * Two vocabulary decisions that recur, taken from web so the two clients agree:
 *
 * - **Indésirable**, not "spam", for a thread the crew has marked. It is the word
 *   every French mailbox on this continent uses for the same action.
 * - **Mise en veille** for a snoozed conversation: it is deferred, not archived,
 *   and "reportée" would read as a rescheduled appointment.
 *
 * Loonext, Stripe, Telnyx and Lou are never translated, and neither are the
 * carrier keywords STOP / HELP / START / URGENT — a carrier matches on them.
 */
object InboxStrings : AppStrings.Section {
    override val en = mapOf(
        // --- The list's own chrome (InboxTab.kt) ------------------------------
        "inbox.title" to "Inbox",
        "inbox.unreadChip" to "{count} unread",
        "inbox.scheduledOneAria" to "1 text waiting to send",
        "inbox.scheduledManyAria" to "{count} texts waiting to send",
        "inbox.searchAria" to "Search",
        "inbox.filtersAria" to "Filters",
        "inbox.segmentOpen" to "Open",
        "inbox.segmentMine" to "Mine",
        "inbox.segmentAll" to "All",
        "inbox.segmentClosed" to "Closed",

        // --- Empty states ----------------------------------------------------
        "inbox.emptyEveryoneAnswered" to "Everyone has been answered.",
        "inbox.emptyNoFilterMatch" to "Nothing matches these filters.",
        "inbox.emptyNothingWaiting" to "Nothing waiting on you.",
        "inbox.emptyNothingAssigned" to "Nothing assigned to you.",
        "inbox.emptyNoClosed" to "No closed conversations.",
        "inbox.emptyNoConversations" to "No conversations yet.",

        // --- One row of the list ---------------------------------------------
        "inbox.assigneeYou" to "You",
        "inbox.teammateFallback" to "Teammate",
        "inbox.sectionPinned" to "Pinned",
        "inbox.sectionConversations" to "Conversations",
        "inbox.actionMarkRead" to "Mark read",
        "inbox.actionMarkUnread" to "Mark unread",
        "inbox.actionReopenConversation" to "Reopen conversation",
        "inbox.actionCloseConversation" to "Close conversation",
        "inbox.swipeRead" to "Read",
        "inbox.swipeUnread" to "Unread",
        "inbox.swipeReopen" to "Reopen",
        "inbox.swipeClose" to "Close",
        "inbox.rowStateUnread" to "Unread",
        "inbox.rowStateRead" to "Read",
        "inbox.rowPreviewNote" to "Note · {body}",
        "inbox.rowPreviewYou" to "You: {body}",
        // Not a sentence, but it is on screen and a language that counts
        // differently would want it: "+3" beside three visible tags.
        "inbox.tagOverflow" to "+{count}",
        "inbox.spamLabel" to "Spam",

        // --- Swipe outcomes (InboxController) --------------------------------
        "inbox.inboundToastView" to "View",
        "inbox.undo" to "Undo",
        "inbox.conversationClosed" to "Conversation closed",
        "inbox.conversationReopened" to "Conversation reopened",

        // --- The filter sheet -------------------------------------------------
        "inbox.filtersTitle" to "Filters",
        "inbox.filtersReset" to "Reset",
        "inbox.filterGroupStatus" to "Status",
        "inbox.filterGroupAssignee" to "Assignee",
        "inbox.filterAnyone" to "Anyone",
        "inbox.filterMe" to "Me",
        "inbox.filterGroupTags" to "Tags",
        "inbox.filterNoTags" to
            "No tags yet. Add tags from a conversation on the web.",
        "inbox.filterAnyTag" to "Any tag",
        "inbox.filterUnansweredOnly" to "Unanswered only",
        "inbox.filterUnreadOnly" to "Unread only",
        "inbox.filterSpamOnly" to "Spam only",
        "inbox.filterSnoozedOnly" to "Snoozed only",
        "inbox.filtersApply" to "Show conversations",

        // --- Search -----------------------------------------------------------
        "inbox.searchScopeAll" to "All",
        "inbox.searchScopeTexts" to "Texts",
        "inbox.searchScopeTasks" to "Tasks",
        "inbox.searchScopeContacts" to "Contacts",
        "inbox.searchPlaceholder" to "Search texts, tasks, contacts…",
        "inbox.clearSearchAria" to "Clear search",
        "inbox.searchIdle" to "Search your texts, tasks, and contacts.",
        "inbox.searchNoMatches" to "Nothing matches \"{query}\".",
        "inbox.searchHeadingConversations" to "Conversations",
        "inbox.searchNotePrefix" to "Note · ",
        "inbox.searchLoadingMore" to "Loading…",
        "inbox.searchMoreResults" to "More results",
        "inbox.searchHeadingTasks" to "Tasks",
        "inbox.taskDone" to "Done",
        "inbox.taskOpen" to "Open task",
        "inbox.searchHeadingContacts" to "Contacts",
        "inbox.searchHeadingAttachments" to "Attachments",
        "inbox.searchHeadingVoicemails" to "Voicemails",
        "inbox.voicemailFallback" to "Voicemail",
        "inbox.searchHeadingTemplates" to "Saved replies",
        "inbox.contactTextAria" to "Text {name}",
        "inbox.contactFallback" to "contact",

        // --- The selection bar (#275) ------------------------------------------
        "inbox.bulkClearSelectionAria" to "Clear selection",
        "inbox.bulkMoreAria" to "More bulk actions",
        "inbox.bulkAssignTo" to "Assign to {name}",
        "inbox.bulkUnassign" to "Unassign",
        "inbox.bulkSelectAllLoaded" to "Select all {count} loaded",
        "inbox.bulkSelectAllMatching" to "Select all matching this filter",
        "inbox.bulkMarkRead" to "Mark read",
        "inbox.bulkClose" to "Close",
        "inbox.bulkSpam" to "Spam",

        // --- Saved views (#280) -------------------------------------------------
        "inbox.viewsSave" to "Save this view",
        "inbox.viewSaveDescription" to
            "The filters you have on now, under a name, one tap away tomorrow.",
        "inbox.viewNameLabel" to "Name",
        "inbox.viewShareToggle" to "Share it with the crew",
        "inbox.viewShareNote" to
            "Everyone gets the same view, and each person sees only the numbers " +
            "they already have access to.",
        "inbox.viewSaving" to "Saving",
        "inbox.viewSaveFailed" to "Could not save that view.",
        "inbox.viewDeleteTitle" to "Delete this crew view?",
        "inbox.viewDeleteBody" to
            "The whole crew uses {name}. Anyone who opens the app there will " +
            "land on the ordinary inbox instead.",
        "inbox.viewDeleteConfirm" to "Delete for everyone",
        "inbox.viewDeleteKeep" to "Keep it",
        "inbox.viewRenameTitle" to "Rename view",
        "inbox.viewRename" to "Rename",
        "inbox.viewStopOpeningHere" to "Stop opening here",
        "inbox.viewOpenHereByDefault" to "Open here by default",
        // The name the save sheet opens with, assembled from what is filtered.
        "inbox.viewNameAssigned" to "Assigned",
        "inbox.viewNameUnread" to "Unread",
        "inbox.viewNameSpam" to "Spam",
        "inbox.viewNameSnoozed" to "Snoozed",
        "inbox.viewNameUnanswered" to "Unanswered",

        // --- Scheduled (#233) ---------------------------------------------------
        "inbox.scheduledTitle" to "Scheduled",
        "inbox.scheduledNeedsYou" to "Needs you",
        "inbox.scheduledGoingOut" to "Going out",
        "inbox.scheduledWaiting" to "Waiting",
        "inbox.scheduledThisConversation" to "This conversation",

        // --- The first-run checklist (#476) --------------------------------------
        // Read verbatim by packages/shared/src/first-run-copy.test.ts, which holds
        // web, Android and iOS to the same words. Changing an English value here
        // is a change to three clients.
        "inbox.startedOwnerTitle" to "Getting started",
        "inbox.startedOwnerSignupLabel" to "Set your workspace up",
        "inbox.startedOwnerNumberLabel" to "Get your business number",
        "inbox.startedOwnerNumberHint" to "It's on its way, usually under a minute.",
        "inbox.startedOwnerNumberStalledHint" to
            "Taking a little longer than usual. You don't need to do anything.",
        "inbox.startedOwnerInboundLabel" to "Receive your first text",
        "inbox.startedOwnerInboundHint" to
            "Text your number from your phone, and it lands right here.",
        "inbox.startedOwnerReplyLabel" to "Send your first reply",
        "inbox.startedOwnerReplyHint" to
            "Open a conversation and answer like you would from your cell.",
        "inbox.startedOwnerTeammateLabel" to "Invite a teammate",
        "inbox.startedMemberTitle" to "Getting the hang of it",
        "inbox.startedMemberReplyLabel" to "Answer a customer",
        // THE THREE HINTS BELOW ARE ONE LITERAL EACH, DELIBERATELY OVER-LONG.
        // `first-run-copy.test.ts` compares them to web and iOS with a verbatim
        // `includes`, so a `"…" + "…"` wrap — which reads better and which this
        // file uses everywhere else — splits the sentence in the source and the
        // guard reports Android as the client that lost the line.
        "inbox.startedMemberReplyHint" to
            "Open a thread and reply. It goes out from the business number, and the whole crew can see it.",
        "inbox.startedMemberNoteLabel" to "Leave a note for the crew",
        "inbox.startedMemberNoteHint" to
            "Switch the composer to Note. Notes stay inside the app — the customer never sees them.",
        "inbox.startedMemberDoneLabel" to "Mark something done",
        "inbox.startedMemberDoneHint" to
            "Tick a message off when it is handled, so the rest of the crew knows nobody needs to chase it.",
        "inbox.startedMemberFooter" to
            "Your notification settings are yours alone. " +
            "Change when we buzz you in Settings.",
        "inbox.startedProgress" to "{done} of {total} done",
        "inbox.startedProgressAria" to "{done} of {total} steps done",
        "inbox.startedDismissAria" to "Dismiss {title}",
        "inbox.startedStepDone" to ", done",
        "inbox.startedStepNotDone" to ", not done yet",

        // --- The crew queue (ForYouTab.kt) ----------------------------------------
        "inbox.forYouTitle" to "For you",
        "inbox.forYouAllCaughtUp" to "You're all caught up",
        "inbox.forYouWorkOne" to "1 thing needs you · otherwise you're caught up",
        "inbox.forYouWorkMany" to "{count} things need you · otherwise you're caught up",
        "inbox.forYouNotificationsAria" to "Notifications",
        "inbox.forYouSectionSpamReview" to "Marked spam, still texting",
        "inbox.forYouSectionUnassigned" to "Unassigned",
        "inbox.forYouSectionWaiting" to "Waiting on you",
        "inbox.forYouSectionTasks" to "My tasks",
        "inbox.forYouSectionUnread" to "Unread",
        "inbox.forYouSectionChaseThese" to "Chase these",
        "inbox.forYouNewLead" to "New lead",
        "inbox.forYouWhyNoReply" to "No reply since {when}",
        "inbox.forYouUnknownCaller" to "Unknown",
        "inbox.forYouWhyOverdueTask" to "Overdue task",
        "inbox.forYouWhyDue" to "Due {when}",
        "inbox.forYouWhyOpenTask" to "Open task",
        "inbox.forYouCallsLoadFailed" to "Couldn't load recent calls.",
        "inbox.forYouRecentCalls" to "RECENT CALLS",
        "inbox.forYouViewAllCalls" to "View all",
        "inbox.forYouCaughtUpHeading" to "ALL CAUGHT UP",
        "inbox.forYouCaughtUpBody" to
            "Nothing needs you right now. New messages, tasks, and missed calls land here first.",
        "inbox.forYouNotSpam" to "Not spam",
        "inbox.forYouStillSpam" to "Still spam",

        // --- Customise the dashboard (#540) -----------------------------------------
        "inbox.customiseAria" to "Customise this screen",
        "inbox.customiseAriaPutAwayOne" to "Customise this screen — {count} panel put away",
        "inbox.customiseAriaPutAwayMany" to "Customise this screen — {count} panels put away",
        "inbox.customiseTitle" to "What's on this screen",
        "inbox.customiseQueueStays" to
            "The queue always stays. Work isn't something you can switch off.",
        "inbox.customiseGroupMeasures" to "Measures",
        "inbox.customiseGroupHistory" to "History",
        "inbox.customiseSaveFailed" to
            "We couldn't save that — it's back the way it was. " +
            "Try again in a moment.",
        "inbox.customiseStateOn" to "On this screen",
        "inbox.customiseStatePutAway" to "Put away",

        // --- Where the customers came from (#301) -------------------------------------
        "inbox.leadSourcesTitle" to "Where your customers come from",
        "inbox.leadSourcesNoneSetUp" to
            "You haven't told us yet. Put a source on the numbers you " +
            "advertise — the one on the truck, the one in the ad — and " +
            "every call and text to them is counted from then on, with " +
            "nobody tapping anything.",
        // #540: the door out of the paragraph above. Web has always had it;
        // both phones printed the instruction and offered no way to follow it.
        "inbox.leadSourcesSetOneUp" to "Set one up",
        "inbox.leadSourcesLeading" to
            "Most of the work you can account for came from {name} — " +
            "{count} of {total}.",
        "inbox.leadSourcesMore" to "{count} more",
        "inbox.leadSourcesWebsite" to "Your website",
        "inbox.leadSourcesWebsiteInline" to "your website",
        "inbox.leadSourcesUnknown" to "Don't know",
        "inbox.leadSourcesFooterOne" to "Last 30 days · {count} conversation",
        "inbox.leadSourcesFooterMany" to "Last 30 days · {count} conversations",

        // --- The quote pipeline (#354) --------------------------------------------------
        "inbox.pipelineTitle" to "Quotes",
        "inbox.pipelineWindow" to "last 30 days",
        "inbox.pipelineTooEarlyOne" to "{count} quote sent. Too early to call a win rate.",
        "inbox.pipelineTooEarlyMany" to "{count} quotes sent. Too early to call a win rate.",
        "inbox.pipelineQuoted" to "Quoted",
        "inbox.pipelineWon" to "Won",
        "inbox.pipelineStillOut" to "Still out",
        "inbox.pipelineShareAria" to "Of {quoted} quoted, {won} won and {open} still out",

        // --- The referral ask (#288) -------------------------------------------------------
        "inbox.referralGettingLink" to "Getting your link…",

        // --- Response time (#239) ------------------------------------------------------------
        // Read verbatim by components/for-you/response-time-parity.test.ts.
        "inbox.responseTimeTitle" to "RESPONSE TIME",
        "inbox.responseLoading" to "Working out your response time…",
        "inbox.responseNoLeads" to
            "No new customers texted you in the last {days} days, so " +
            "there is nothing to measure yet.",
        "inbox.responseRingAria" to "{answered} of {leads} new customers answered",
        "inbox.responseToAnswer" to "to answer a new customer",
        "inbox.responseArcDown" to "Down from {then} when you started",
        "inbox.responseArcUp" to "Up from {then} when you started",
        "inbox.responseNoArcTooNew" to
            "Your starting point lands once you have been here a fortnight",
        "inbox.responseNoArcNoLeads" to
            "No answered leads in your first two weeks, so there is nothing to compare",
        "inbox.responseNoArcSame" to "About the same as when you started",
        "inbox.responseUnansweredOne" to "1 lead nobody answered",
        "inbox.responseUnansweredMany" to "{count} leads nobody answered",
        "inbox.responseDetails" to "Details",
        "inbox.responseHideDetails" to "Hide details",
        "inbox.responseSlowest" to "Slowest 10% of answers",
        "inbox.responseDuringHours" to "During hours ({count})",
        "inbox.responseAfterHours" to "After hours ({count})",
        "inbox.responseByNumber" to "{number} · {count} unanswered",
        "inbox.responseByMember" to "Member · {count} answered",
        "inbox.responseSplitTruncated" to
            "The hours split covers your most recent {limit} " +
            "leads; the numbers above it cover all {total}.",

        // --- Satisfaction (#313) --------------------------------------------------------------
        // Read verbatim by components/for-you/satisfaction-parity.test.ts.
        "inbox.satisfactionTitle" to "SATISFACTION",
        "inbox.satisfactionLoading" to "Reading your ratings…",
        "inbox.satisfactionGapNoneAsked" to
            "No finished jobs have been asked about in this window. The question " +
            "goes out a few hours after a job is marked done.",
        "inbox.satisfactionGapNoneAnswered" to
            "Nobody has answered yet. Most people do not, which is why one answer " +
            "is worth reading rather than counting.",
        "inbox.satisfactionGapTooFew" to
            "Too few answers to average yet — {answered} of {minimum}",
        "inbox.satisfactionRingAria" to "{score} out of 5, from {count} answers",
        "inbox.satisfactionOutOfFive" to "out of 5, from {count} answers",
        "inbox.satisfactionArcUp" to "Up from {then} the month before",
        "inbox.satisfactionArcDown" to "Down from {then} the month before",
        "inbox.satisfactionNoBaseline" to "No month before this one to compare against yet",
        "inbox.satisfactionSame" to "About the same as the month before",
        "inbox.satisfactionDetails" to "Details",
        "inbox.satisfactionHideDetails" to "Hide details",
        "inbox.satisfactionStarsOne" to "1 star",
        "inbox.satisfactionStarsMany" to "{count} stars",
        "inbox.satisfactionAsked" to "Asked",
        "inbox.satisfactionAskedValue" to "{count} in {days} days",
        "inbox.satisfactionByMemberOff" to
            "Per-person scores are off. In a small crew a bad week is " +
            "noise, so this stays a coaching signal rather than a " +
            "scoreboard — turn it on in Settings.",
        "inbox.satisfactionMemberFallback" to "Member",
        "inbox.satisfactionByMember" to "{name} · {count} answered",
        "inbox.satisfactionMemberTooFew" to "Too few answers to average yet",
        "inbox.satisfactionTruncated" to "Showing the most recent {count} ratings.",

        // --- The waiting room (#310) ---------------------------------------------------------------
        "inbox.whileWaitCallsWork" to "Calls already work",
        "inbox.whileWaitCallsBody" to
            "Your number rings, takes voicemail, and texts back anyone you " +
            "miss. None of that waits on the carriers.",
        "inbox.whileWaitContacts" to "Bring your customers in",
        "inbox.whileWaitInvite" to "Invite your crew",
        "inbox.whileWaitHours" to "Set your hours and greeting",
    )

    override val frCA = mapOf(
        // --- The list's own chrome --------------------------------------------
        "inbox.title" to "Boîte de réception",
        "inbox.unreadChip" to "{count} non lues",
        "inbox.scheduledOneAria" to "1 texto en attente d'envoi",
        "inbox.scheduledManyAria" to "{count} textos en attente d'envoi",
        "inbox.searchAria" to "Rechercher",
        "inbox.filtersAria" to "Filtres",
        "inbox.segmentOpen" to "Ouvertes",
        "inbox.segmentMine" to "Les miennes",
        "inbox.segmentAll" to "Toutes",
        "inbox.segmentClosed" to "Fermées",

        // --- Empty states -----------------------------------------------------
        "inbox.emptyEveryoneAnswered" to "Tout le monde a reçu une réponse.",
        "inbox.emptyNoFilterMatch" to "Rien ne correspond à ces filtres.",
        "inbox.emptyNothingWaiting" to "Rien n'attend après vous.",
        "inbox.emptyNothingAssigned" to "Rien ne vous est assigné.",
        "inbox.emptyNoClosed" to "Aucune conversation fermée.",
        "inbox.emptyNoConversations" to "Aucune conversation pour l'instant.",

        // --- One row of the list ----------------------------------------------
        "inbox.assigneeYou" to "Vous",
        "inbox.teammateFallback" to "Coéquipier",
        "inbox.sectionPinned" to "Épinglées",
        "inbox.sectionConversations" to "Conversations",
        "inbox.actionMarkRead" to "Marquer comme lue",
        "inbox.actionMarkUnread" to "Marquer comme non lue",
        "inbox.actionReopenConversation" to "Rouvrir la conversation",
        "inbox.actionCloseConversation" to "Fermer la conversation",
        "inbox.swipeRead" to "Lue",
        "inbox.swipeUnread" to "Non lue",
        "inbox.swipeReopen" to "Rouvrir",
        "inbox.swipeClose" to "Fermer",
        "inbox.rowStateUnread" to "Non lue",
        "inbox.rowStateRead" to "Lue",
        "inbox.rowPreviewNote" to "Note · {body}",
        "inbox.rowPreviewYou" to "Vous : {body}",
        "inbox.tagOverflow" to "+{count}",
        "inbox.spamLabel" to "Indésirable",

        // --- Swipe outcomes ----------------------------------------------------
        "inbox.inboundToastView" to "Voir",
        "inbox.undo" to "Annuler",
        "inbox.conversationClosed" to "Conversation fermée",
        "inbox.conversationReopened" to "Conversation rouverte",

        // --- The filter sheet ---------------------------------------------------
        "inbox.filtersTitle" to "Filtres",
        "inbox.filtersReset" to "Réinitialiser",
        "inbox.filterGroupStatus" to "Statut",
        "inbox.filterGroupAssignee" to "Responsable",
        "inbox.filterAnyone" to "N'importe qui",
        "inbox.filterMe" to "Moi",
        "inbox.filterGroupTags" to "Étiquettes",
        "inbox.filterNoTags" to
            "Aucune étiquette pour l'instant. Ajoutez-en depuis une conversation sur le web.",
        "inbox.filterAnyTag" to "Toute étiquette",
        "inbox.filterUnansweredOnly" to "Sans réponse seulement",
        "inbox.filterUnreadOnly" to "Non lues seulement",
        "inbox.filterSpamOnly" to "Indésirables seulement",
        "inbox.filterSnoozedOnly" to "En veille seulement",
        "inbox.filtersApply" to "Afficher les conversations",

        // --- Search --------------------------------------------------------------
        "inbox.searchScopeAll" to "Tout",
        "inbox.searchScopeTexts" to "Textos",
        "inbox.searchScopeTasks" to "Tâches",
        "inbox.searchScopeContacts" to "Contacts",
        "inbox.searchPlaceholder" to "Rechercher textos, tâches, contacts…",
        "inbox.clearSearchAria" to "Effacer la recherche",
        "inbox.searchIdle" to "Recherchez vos textos, vos tâches et vos contacts.",
        "inbox.searchNoMatches" to "Aucun résultat pour « {query} ».",
        "inbox.searchHeadingConversations" to "Conversations",
        "inbox.searchNotePrefix" to "Note · ",
        "inbox.searchLoadingMore" to "Chargement…",
        "inbox.searchMoreResults" to "Plus de résultats",
        "inbox.searchHeadingTasks" to "Tâches",
        "inbox.taskDone" to "Terminée",
        "inbox.taskOpen" to "Tâche ouverte",
        "inbox.searchHeadingContacts" to "Contacts",
        "inbox.searchHeadingAttachments" to "Pièces jointes",
        "inbox.searchHeadingVoicemails" to "Messages vocaux",
        "inbox.voicemailFallback" to "Message vocal",
        "inbox.searchHeadingTemplates" to "Réponses enregistrées",
        "inbox.contactTextAria" to "Texter {name}",
        "inbox.contactFallback" to "ce contact",

        // --- The selection bar ------------------------------------------------------
        "inbox.bulkClearSelectionAria" to "Effacer la sélection",
        "inbox.bulkMoreAria" to "Plus d'actions groupées",
        "inbox.bulkAssignTo" to "Assigner à {name}",
        "inbox.bulkUnassign" to "Retirer l'assignation",
        "inbox.bulkSelectAllLoaded" to "Sélectionner les {count} chargées",
        "inbox.bulkSelectAllMatching" to "Sélectionner tout ce qui correspond à ce filtre",
        "inbox.bulkMarkRead" to "Marquer comme lues",
        "inbox.bulkClose" to "Fermer",
        "inbox.bulkSpam" to "Indésirable",

        // --- Saved views --------------------------------------------------------------
        "inbox.viewsSave" to "Enregistrer cette vue",
        "inbox.viewSaveDescription" to
            "Les filtres que vous avez en ce moment, sous un nom, à une touche demain.",
        "inbox.viewNameLabel" to "Nom",
        "inbox.viewShareToggle" to "La partager avec l'équipe",
        "inbox.viewShareNote" to
            "Tout le monde obtient la même vue, et chaque personne ne voit que " +
            "les numéros auxquels elle a déjà accès.",
        "inbox.viewSaving" to "Enregistrement",
        "inbox.viewSaveFailed" to "Impossible d'enregistrer cette vue.",
        "inbox.viewDeleteTitle" to "Supprimer cette vue d'équipe ?",
        "inbox.viewDeleteBody" to
            "Toute l'équipe utilise {name}. Quiconque ouvre l'application ici " +
            "arrivera plutôt sur la boîte de réception ordinaire.",
        "inbox.viewDeleteConfirm" to "Supprimer pour tout le monde",
        "inbox.viewDeleteKeep" to "La garder",
        "inbox.viewRenameTitle" to "Renommer la vue",
        "inbox.viewRename" to "Renommer",
        "inbox.viewStopOpeningHere" to "Ne plus ouvrir ici",
        "inbox.viewOpenHereByDefault" to "Ouvrir ici par défaut",
        "inbox.viewNameAssigned" to "Assignées",
        "inbox.viewNameUnread" to "Non lues",
        "inbox.viewNameSpam" to "Indésirables",
        "inbox.viewNameSnoozed" to "En veille",
        "inbox.viewNameUnanswered" to "Sans réponse",

        // --- Scheduled -------------------------------------------------------------------
        "inbox.scheduledTitle" to "Programmés",
        "inbox.scheduledNeedsYou" to "Demande votre attention",
        "inbox.scheduledGoingOut" to "À envoyer",
        "inbox.scheduledWaiting" to "En attente",
        "inbox.scheduledThisConversation" to "Cette conversation",

        // --- The first-run checklist -------------------------------------------------------
        "inbox.startedOwnerTitle" to "Premiers pas",
        "inbox.startedOwnerSignupLabel" to "Configurer votre espace de travail",
        "inbox.startedOwnerNumberLabel" to "Obtenir votre numéro d'entreprise",
        "inbox.startedOwnerNumberHint" to
            "Il arrive, habituellement en moins d'une minute.",
        "inbox.startedOwnerNumberStalledHint" to
            "Cela prend un peu plus de temps que d'habitude. Vous n'avez rien à faire.",
        "inbox.startedOwnerInboundLabel" to "Recevoir votre premier texto",
        "inbox.startedOwnerInboundHint" to
            "Textez votre numéro depuis votre téléphone, et le message arrive ici.",
        "inbox.startedOwnerReplyLabel" to "Envoyer votre première réponse",
        "inbox.startedOwnerReplyHint" to
            "Ouvrez une conversation et répondez comme vous le feriez de votre cellulaire.",
        "inbox.startedOwnerTeammateLabel" to "Inviter un coéquipier",
        "inbox.startedMemberTitle" to "Prendre le rythme",
        "inbox.startedMemberReplyLabel" to "Répondre à un client",
        "inbox.startedMemberReplyHint" to
            "Ouvrez une conversation et répondez. Le texto part du numéro " +
            "d'entreprise, et toute l'équipe le voit.",
        "inbox.startedMemberNoteLabel" to "Laisser une note à l'équipe",
        "inbox.startedMemberNoteHint" to
            "Basculez le champ de rédaction en mode Note. Les notes restent dans " +
            "l'application — le client ne les voit jamais.",
        "inbox.startedMemberDoneLabel" to "Marquer quelque chose comme fait",
        "inbox.startedMemberDoneHint" to
            "Cochez un message une fois qu'il est réglé, pour que le reste de " +
            "l'équipe sache que personne n'a à le relancer.",
        "inbox.startedMemberFooter" to
            "Vos paramètres de notification n'appartiennent qu'à vous. " +
            "Choisissez quand nous vous avertissons dans les paramètres.",
        "inbox.startedProgress" to "{done} sur {total} de fait",
        "inbox.startedProgressAria" to "{done} étapes sur {total} de faites",
        "inbox.startedDismissAria" to "Masquer {title}",
        "inbox.startedStepDone" to ", fait",
        "inbox.startedStepNotDone" to ", pas encore fait",

        // --- The crew queue -----------------------------------------------------------------
        "inbox.forYouTitle" to "Pour vous",
        "inbox.forYouAllCaughtUp" to "Vous êtes à jour",
        "inbox.forYouWorkOne" to
            "1 chose demande votre attention · vous êtes à jour pour le reste",
        "inbox.forYouWorkMany" to
            "{count} choses demandent votre attention · vous êtes à jour pour le reste",
        "inbox.forYouNotificationsAria" to "Notifications",
        "inbox.forYouSectionSpamReview" to "Marquées indésirables, textent encore",
        "inbox.forYouSectionUnassigned" to "Non assignées",
        "inbox.forYouSectionWaiting" to "En attente de vous",
        "inbox.forYouSectionTasks" to "Mes tâches",
        "inbox.forYouSectionUnread" to "Non lues",
        "inbox.forYouSectionChaseThese" to "À relancer",
        "inbox.forYouNewLead" to "Nouveau client potentiel",
        "inbox.forYouWhyNoReply" to "Aucune réponse depuis {when}",
        "inbox.forYouUnknownCaller" to "Inconnu",
        "inbox.forYouWhyOverdueTask" to "Tâche en retard",
        "inbox.forYouWhyDue" to "Échéance {when}",
        "inbox.forYouWhyOpenTask" to "Tâche ouverte",
        "inbox.forYouCallsLoadFailed" to "Impossible de charger les appels récents.",
        "inbox.forYouRecentCalls" to "APPELS RÉCENTS",
        "inbox.forYouViewAllCalls" to "Voir tout",
        "inbox.forYouCaughtUpHeading" to "TOUT EST À JOUR",
        "inbox.forYouCaughtUpBody" to
            "Rien ne demande votre attention pour l'instant. Les nouveaux textos, " +
            "les tâches et les appels manqués arrivent ici en premier.",
        "inbox.forYouNotSpam" to "Pas indésirable",
        "inbox.forYouStillSpam" to "Toujours indésirable",

        // --- Customise the dashboard -----------------------------------------------------------
        "inbox.customiseAria" to "Personnaliser cet écran",
        "inbox.customiseAriaPutAwayOne" to "Personnaliser cet écran — {count} panneau rangé",
        "inbox.customiseAriaPutAwayMany" to "Personnaliser cet écran — {count} panneaux rangés",
        "inbox.customiseTitle" to "Ce qu'il y a sur cet écran",
        "inbox.customiseQueueStays" to
            "La file reste toujours. Le travail ne se désactive pas.",
        "inbox.customiseGroupMeasures" to "Mesures",
        "inbox.customiseGroupHistory" to "Historique",
        "inbox.customiseSaveFailed" to
            "Impossible d'enregistrer — tout est revenu comme avant. " +
            "Réessayez dans un moment.",
        "inbox.customiseStateOn" to "Sur cet écran",
        "inbox.customiseStatePutAway" to "Rangé",

        // --- Where the customers came from -------------------------------------------------------
        "inbox.leadSourcesTitle" to "D'où viennent vos clients",
        "inbox.leadSourcesNoneSetUp" to
            "Vous ne nous l'avez pas encore dit. Attribuez une source aux numéros " +
            "que vous annoncez — celui sur le camion, celui dans la publicité — et " +
            "chaque appel et texto vers ces numéros est compté à partir de là, sans " +
            "que personne n'ait à toucher à quoi que ce soit.",
        "inbox.leadSourcesSetOneUp" to "En configurer une",
        "inbox.leadSourcesLeading" to
            "La majorité du travail que vous pouvez attribuer vient de {name} — " +
            "{count} sur {total}.",
        "inbox.leadSourcesMore" to "{count} de plus",
        "inbox.leadSourcesWebsite" to "Votre site web",
        "inbox.leadSourcesWebsiteInline" to "votre site web",
        "inbox.leadSourcesUnknown" to "Inconnue",
        "inbox.leadSourcesFooterOne" to "30 derniers jours · {count} conversation",
        "inbox.leadSourcesFooterMany" to "30 derniers jours · {count} conversations",

        // --- The quote pipeline ---------------------------------------------------------------------
        "inbox.pipelineTitle" to "Devis",
        "inbox.pipelineWindow" to "30 derniers jours",
        "inbox.pipelineTooEarlyOne" to
            "{count} devis envoyé. Trop tôt pour parler d'un taux de réussite.",
        "inbox.pipelineTooEarlyMany" to
            "{count} devis envoyés. Trop tôt pour parler d'un taux de réussite.",
        "inbox.pipelineQuoted" to "Envoyés",
        "inbox.pipelineWon" to "Gagnés",
        "inbox.pipelineStillOut" to "En attente",
        "inbox.pipelineShareAria" to
            "Sur {quoted} devis envoyés, {won} gagnés et {open} en attente",

        // --- The referral ask ----------------------------------------------------------------------------
        "inbox.referralGettingLink" to "Récupération de votre lien…",

        // --- Response time -------------------------------------------------------------------------------
        "inbox.responseTimeTitle" to "TEMPS DE RÉPONSE",
        "inbox.responseLoading" to "Calcul de votre temps de réponse…",
        "inbox.responseNoLeads" to
            "Aucun nouveau client ne vous a texté dans les {days} derniers jours, " +
            "alors il n'y a encore rien à mesurer.",
        "inbox.responseRingAria" to
            "{answered} nouveaux clients sur {leads} ont eu une réponse",
        "inbox.responseToAnswer" to "pour répondre à un nouveau client",
        "inbox.responseArcDown" to "En baisse depuis {then} à vos débuts",
        "inbox.responseArcUp" to "En hausse depuis {then} à vos débuts",
        "inbox.responseNoArcTooNew" to
            "Votre point de départ sera établi après deux semaines ici",
        "inbox.responseNoArcNoLeads" to
            "Aucun client n'a reçu de réponse durant vos deux premières semaines, " +
            "alors il n'y a rien à comparer",
        "inbox.responseNoArcSame" to "À peu près comme à vos débuts",
        "inbox.responseUnansweredOne" to "1 client potentiel sans réponse",
        "inbox.responseUnansweredMany" to "{count} clients potentiels sans réponse",
        "inbox.responseDetails" to "Détails",
        "inbox.responseHideDetails" to "Masquer les détails",
        "inbox.responseSlowest" to "Les 10 % de réponses les plus lentes",
        "inbox.responseDuringHours" to "Pendant les heures ({count})",
        "inbox.responseAfterHours" to "Hors des heures ({count})",
        "inbox.responseByNumber" to "{number} · {count} sans réponse",
        "inbox.responseByMember" to "Membre · {count} avec réponse",
        "inbox.responseSplitTruncated" to
            "La répartition par heures couvre vos {limit} clients potentiels les " +
            "plus récents ; les chiffres au-dessus couvrent l'ensemble des {total}.",

        // --- Satisfaction ------------------------------------------------------------------------------------
        "inbox.satisfactionTitle" to "SATISFACTION",
        "inbox.satisfactionLoading" to "Lecture de vos évaluations…",
        "inbox.satisfactionGapNoneAsked" to
            "Aucun travail terminé n'a fait l'objet d'une question durant cette " +
            "période. La question part quelques heures après qu'un travail est " +
            "marqué comme fait.",
        "inbox.satisfactionGapNoneAnswered" to
            "Personne n'a répondu encore. La plupart des gens ne répondent pas, " +
            "c'est pourquoi une seule réponse vaut la peine d'être lue plutôt que " +
            "comptée.",
        "inbox.satisfactionGapTooFew" to
            "Trop peu de réponses pour faire une moyenne — {answered} sur {minimum}",
        "inbox.satisfactionRingAria" to "{score} sur 5, à partir de {count} réponses",
        "inbox.satisfactionOutOfFive" to "sur 5, à partir de {count} réponses",
        "inbox.satisfactionArcUp" to "En hausse depuis {then} le mois précédent",
        "inbox.satisfactionArcDown" to "En baisse depuis {then} le mois précédent",
        "inbox.satisfactionNoBaseline" to
            "Aucun mois précédent auquel se comparer pour l'instant",
        "inbox.satisfactionSame" to "À peu près comme le mois précédent",
        "inbox.satisfactionDetails" to "Détails",
        "inbox.satisfactionHideDetails" to "Masquer les détails",
        "inbox.satisfactionStarsOne" to "1 étoile",
        "inbox.satisfactionStarsMany" to "{count} étoiles",
        "inbox.satisfactionAsked" to "Demandées",
        "inbox.satisfactionAskedValue" to "{count} en {days} jours",
        "inbox.satisfactionByMemberOff" to
            "Les scores par personne sont désactivés. Dans une petite équipe, une " +
            "mauvaise semaine n'est que du bruit ; cela reste donc un signal " +
            "d'accompagnement plutôt qu'un tableau de classement — activez-les " +
            "dans les paramètres.",
        "inbox.satisfactionMemberFallback" to "Membre",
        "inbox.satisfactionByMember" to "{name} · {count} avec réponse",
        "inbox.satisfactionMemberTooFew" to "Trop peu de réponses pour faire une moyenne",
        "inbox.satisfactionTruncated" to
            "Affichage des {count} évaluations les plus récentes.",

        // --- The waiting room ---------------------------------------------------------------------------------
        "inbox.whileWaitCallsWork" to "Les appels fonctionnent déjà",
        "inbox.whileWaitCallsBody" to
            "Votre numéro sonne, prend les messages vocaux et renvoie un texto à " +
            "toute personne que vous manquez. Rien de tout cela n'attend les " +
            "opérateurs.",
        "inbox.whileWaitContacts" to "Importer vos clients",
        "inbox.whileWaitInvite" to "Inviter votre équipe",
        "inbox.whileWaitHours" to "Définir vos heures et votre message d'accueil",
    )
}
