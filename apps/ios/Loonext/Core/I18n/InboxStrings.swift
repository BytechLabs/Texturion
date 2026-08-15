import Foundation

/// #228 — the words the inbox, the "For you" queue and the notifications feed
/// say, in both languages.
///
/// ## Why these three surfaces share one section
///
/// They are one slice of the iOS tree (`Features/Inbox`, `Features/ForYou`,
/// `Features/Notifications`) and a translator working through them reads them
/// in that order: the list, the queue above it, the bell beside it.
///
/// ## Where the key names come from
///
/// Wherever a sentence already exists on another client, the KEY NAME is that
/// client's — `apps/web/src/i18n/sections/inbox.ts` first, and Android's
/// `core/i18n/InboxStrings.kt` where web has no twin. That is not tidiness:
/// three parity guards already read web's ENGLISH and hold the two phones to it
/// word for word (`packages/shared/src/first-run-copy.test.ts`,
/// `components/for-you/response-time-parity.test.ts` and its satisfaction
/// twin). A catalogue that renamed the keys would leave a translator comparing
/// files that agree about every sentence and about nothing else.
///
/// **The notification keys are the one place the PREFIX had to differ.** Web
/// keeps them under `misc.`, Android under `contactsTasks.` — neither client
/// agrees with the other, because each grouped by its own file layout and the
/// feed lives somewhere different in all three trees. On iOS it is part of this
/// slice, so it is `inbox.notif…` here, with Android's key SUFFIX and Android's
/// exact English and French preserved. Squatting on `contactsTasks.` would put
/// this file's keys inside another section's namespace and invite the duplicate
/// that `AppStringsTests.testNoTwoSectionsClaimTheSameKey` exists to catch.
///
/// ## The register
///
/// Quebec French, VOUVOIEMENT throughout, accents spelled normally — the GSM-7
/// restriction in `MessageLocale` governs the automated TEXTS, which are billed
/// by the segment, and nothing on a screen is. A normal space before `:` and
/// `?` and inside `« »`.
///
/// Two vocabulary decisions that recur, taken from the other two clients:
///
/// - **Indésirable**, not "spam", for a thread the crew has marked. It is the
///   word every French mailbox on this continent uses for the same action.
/// - **Mise en veille / en veille** for a snoozed conversation: it is deferred,
///   not archived, and "reportée" would read as a rescheduled appointment.
///
/// Loonext, Stripe, Telnyx and Lou are never translated, and neither are the
/// carrier keywords STOP / HELP / START / URGENT — a carrier matches on them.
enum InboxStrings {
    static let section = AppStrings.Section(
        name: "InboxStrings",
        en: [
            // --- The list's own chrome (InboxTab.swift) ----------------------
            "inbox.title": "Inbox",
            "inbox.composeAria": "New message",
            "inbox.scheduledOneAria": "1 text waiting to send",
            "inbox.scheduledManyAria": "{count} texts waiting to send",
            "inbox.searchPlaceholder": "Search texts, tasks, contacts…",
            "inbox.clearSearchAria": "Clear search",
            "inbox.segmentOpen": "Open",
            "inbox.segmentMine": "Mine",
            "inbox.segmentAll": "All",
            "inbox.segmentClosed": "Closed",

            // --- The filter chip row -----------------------------------------
            "inbox.chipAssignee": "Assignee",
            "inbox.chipAssigneeNamed": "Assignee: {name}",
            "inbox.chipTag": "Tag",
            "inbox.chipTagNamed": "Tag: {name}",
            "inbox.chipUnanswered": "Unanswered",
            "inbox.chipUnread": "Unread",
            "inbox.chipSpam": "Spam",
            "inbox.chipSnoozed": "Snoozed",
            "inbox.chipClearFilters": "Clear filters",
            "inbox.clearFilterAria": "Clear filter",

            // --- Empty states -------------------------------------------------
            "inbox.emptyEveryoneAnswered": "Everyone has been answered.",
            "inbox.emptyNoFilterMatch": "Nothing matches these filters.",
            "inbox.emptyNothingWaiting": "Nothing waiting on you.",
            "inbox.emptyNothingAssigned": "Nothing assigned to you.",
            "inbox.emptyNoClosed": "No closed conversations.",
            "inbox.emptyNoConversations": "No conversations yet.",

            // --- One row of the list -------------------------------------------
            "inbox.sectionPinned": "Pinned",
            "inbox.sectionConversations": "Conversations",
            "inbox.assigneeYou": "You",
            "inbox.teammateFallback": "Teammate",
            "inbox.rowPreviewNote": "Note · {body}",
            "inbox.rowPreviewYou": "You: {body}",
            "inbox.rowAssignedToTitle": "Assigned to {name}",
            "inbox.rowStateUnread": "Unread",
            "inbox.tagOverflow": "+{count}",
            "inbox.spamLabel": "Spam",
            "inbox.swipeRead": "Read",
            "inbox.swipeUnread": "Unread",
            "inbox.swipeReopen": "Reopen",
            "inbox.swipeDone": "Done",
            "inbox.swipeAssign": "Assign",
            "inbox.undo": "Undo",
            // What a swipe SAYS afterwards. Android's `inbox.conversationClosed`
            // / `…Reopened` verbatim, because a crew that closes a thread on the
            // phone and reopens it on the tablet must read one vocabulary.
            "inbox.conversationClosed": "Conversation closed",
            "inbox.conversationReopened": "Conversation reopened",

            // --- The two filter sheets ------------------------------------------
            "inbox.filterByAssigneeTitle": "Filter by assignee",
            "inbox.filterByTagTitle": "Filter by tag",
            "inbox.filterAnyone": "Anyone",
            "inbox.filterAnyTag": "Any tag",
            "inbox.filterNoTags":
                "No tags yet. Add tags from a conversation on the web.",
            "inbox.youSuffix": " (you)",

            // --- Global search ----------------------------------------------------
            "inbox.searchNoMatches": "Nothing matches \"{query}\".",
            "inbox.searchNotePrefix": "Note · ",
            "inbox.searchLoadingMore": "Loading…",
            "inbox.searchMoreResults": "More results",
            "inbox.searchHeadingConversations": "Conversations",
            "inbox.searchHeadingContacts": "Contacts",
            "inbox.searchHeadingTasks": "Tasks",
            "inbox.searchHeadingAttachments": "Attachments",
            "inbox.searchHeadingVoicemails": "Voicemails",
            "inbox.searchHeadingTemplates": "Saved replies",
            "inbox.taskDone": "Done",
            "inbox.taskOpen": "Open task",
            "inbox.voicemailFallback": "Voicemail",

            // --- The multi-select bar (#275) ----------------------------------------
            "inbox.bulkClearSelectionAria": "Clear selection",
            "inbox.bulkMoreAria": "More bulk actions",
            "inbox.bulkAssignTo": "Assign to {name}",
            "inbox.bulkUnassign": "Unassign",
            "inbox.bulkSelectAllLoaded": "Select all {count} loaded",
            "inbox.bulkSelectAllMatching": "Select all matching this filter",
            "inbox.bulkMarkRead": "Mark read",
            "inbox.bulkClose": "Close",
            "inbox.bulkSpam": "Spam",
            /*
             * What a bulk action REPORTS BACK, in the shape web already uses
             * (`i18n/sections/inbox.ts`: `bulkResultApplied` and friends), keys
             * and English copied from there.
             *
             * The verb and the noun are interpolated rather than concatenated
             * so a translator can put them where the sentence needs them —
             * which is also why the two failure lines are separate keys: the
             * agreement moves more than a word in French.
             */
            "inbox.bulkResultApplied": "{verb} {count} {thing}",
            "inbox.bulkResultCapped":
                ". {count} more matched than one go can handle, so run it again",
            "inbox.bulkResultFailedOne":
                ". {count} couldn't be reached and was left alone",
            "inbox.bulkResultFailedMany":
                ". {count} couldn't be reached and were left alone",
            "inbox.bulkNounOne": "conversation",
            "inbox.bulkNounMany": "conversations",
            // The verbs that fill `{verb}` above. Named like web's
            // `tasks.bulkVerb…` set, which is the only client that had already
            // lifted them out of the component.
            "inbox.bulkVerbMarkedRead": "Marked read",
            "inbox.bulkVerbClosed": "Closed",
            "inbox.bulkVerbMarkedSpam": "Marked as spam",
            "inbox.bulkVerbAssigned": "Assigned",
            "inbox.bulkVerbUnassigned": "Unassigned",

            // --- Saved views (#280) ---------------------------------------------------
            "inbox.viewsSave": "Save this view",
            "inbox.viewSaveDescription":
                "The filters you have on now, under a name, one tap away tomorrow.",
            "inbox.viewNameLabel": "Name",
            "inbox.viewShareToggle": "Share it with the crew",
            "inbox.viewShareNote":
                "Everyone gets the same view, and each person sees only the "
                + "numbers they already have access to.",
            "inbox.viewSaving": "Saving",
            "inbox.viewRenameTitle": "Rename view",
            "inbox.viewRename": "Rename",
            "inbox.viewStopOpeningHere": "Stop opening here",
            "inbox.viewOpenHereByDefault": "Open here by default",
            "inbox.viewDeleteTitle": "Delete this crew view?",
            "inbox.viewDeleteBody":
                "The whole crew uses {name}. Anyone who opens the app there "
                + "will land on the ordinary inbox instead.",
            "inbox.viewDeleteConfirm": "Delete for everyone",
            "inbox.viewDeleteKeep": "Keep it",

            // --- The crew queue (#233 ScheduledSheet.swift) -----------------------------
            "inbox.scheduledTitle": "Scheduled",
            "inbox.scheduledEmptyTitle": "Nothing scheduled",
            "inbox.scheduledNeedsYou": "Needs you",
            "inbox.scheduledGoingOut": "Going out",
            "inbox.scheduledWaiting": "Waiting",
            "inbox.scheduledThisConversation": "This conversation",
            "inbox.done": "Done",

            // --- First-run guidance (#476 GettingStartedCard.swift) ----------------------
            //
            // Read verbatim by `packages/shared/src/first-run-copy.test.ts`,
            // which now reads THIS FILE for iOS — the same move Android's
            // sentences made when they left `GettingStartedLogic.kt`. Changing
            // an English value here is a change to three clients.
            "inbox.startedOwnerTitle": "Getting started",
            "inbox.startedOwnerSignupLabel": "Set your workspace up",
            "inbox.startedOwnerNumberLabel": "Get your business number",
            "inbox.startedOwnerNumberHint": "It's on its way, usually under a minute.",
            "inbox.startedOwnerNumberStalledHint":
                "Taking a little longer than usual. You don't need to do anything.",
            "inbox.startedOwnerInboundLabel": "Receive your first text",
            "inbox.startedOwnerInboundHint":
                "Text your number from your phone, and it lands right here.",
            "inbox.startedOwnerReplyLabel": "Send your first reply",
            "inbox.startedOwnerReplyHint":
                "Open a conversation and answer like you would from your cell.",
            "inbox.startedOwnerTeammateLabel": "Invite a teammate",
            "inbox.startedMemberTitle": "Getting the hang of it",
            "inbox.startedMemberReplyLabel": "Answer a customer",
            // THE THREE HINTS BELOW ARE ONE LITERAL EACH, DELIBERATELY OVER-LONG.
            // `first-run-copy.test.ts` compares them to web and Android with a
            // verbatim `includes`, so a `"…" + "…"` wrap — which reads better and
            // which this file uses everywhere else — splits the sentence in the
            // source and the guard reports iOS as the client that lost the line.
            "inbox.startedMemberReplyHint":
                "Open a thread and reply. It goes out from the business number, and the whole crew can see it.",
            "inbox.startedMemberNoteLabel": "Leave a note for the crew",
            "inbox.startedMemberNoteHint":
                "Switch the composer to Note. Notes stay inside the app — the customer never sees them.",
            "inbox.startedMemberDoneLabel": "Mark something done",
            "inbox.startedMemberDoneHint":
                "Tick a message off when it is handled, so the rest of the crew knows nobody needs to chase it.",
            "inbox.startedMemberFooter":
                "Your notification settings are yours alone. Change when we "
                + "buzz you in Settings.",
            "inbox.startedProgress": "{done} of {total} done",
            "inbox.startedProgressAria": "{done} of {total} steps done",
            "inbox.startedDismissAria": "Dismiss {title}",
            "inbox.startedStepDone": ", done",
            "inbox.startedStepNotDone": ", not done yet",

            // --- The "For you" queue (ForYouTab.swift) -------------------------------------
            "inbox.forYouTitle": "For you",
            "inbox.forYouAllCaughtUp": "You're all caught up.",
            "inbox.forYouWorkOne": "1 thing needs you",
            "inbox.forYouWorkMany": "{count} things need you",
            "inbox.forYouSectionSpamReview": "Marked spam, still texting",
            "inbox.forYouSectionUnassigned": "Unassigned",
            "inbox.forYouSectionChaseThese": "Chase these",
            "inbox.forYouSectionWaiting": "Waiting on you",
            "inbox.forYouSectionTasks": "My tasks",
            "inbox.forYouSectionUnread": "Unread",
            "inbox.forYouRecentCalls": "Recent calls",
            "inbox.forYouViewAllCalls": "View all",
            "inbox.forYouCallsLoadFailed": "Couldn't load recent calls.",
            "inbox.forYouNotSpam": "Not spam",
            "inbox.forYouStillSpam": "Still spam",
            "inbox.forYouUnknownCaller": "Unknown",
            "inbox.forYouWhyNoReply": "No reply since {when}",
            "inbox.forYouWhyOverdueTask": "Overdue task",
            "inbox.forYouWhyDue": "Due {when}",
            "inbox.forYouWhyOpenTask": "Open task",

            // --- Customise this screen (#540 CustomiseSheet.swift) ---------------------------
            "inbox.responseDetails": "Details",
            "inbox.responseHideDetails": "Hide details",
            "inbox.satisfactionDetails": "Details",
            "inbox.satisfactionHideDetails": "Hide details",
            "inbox.forYouNotificationsAria": "Notifications",
            "inbox.customiseAria": "Customise this screen",
            "inbox.customiseAriaPutAwayOne":
                "Customise this screen — {count} panel put away",
            "inbox.customiseAriaPutAwayMany":
                "Customise this screen — {count} panels put away",
            "inbox.customiseTitle": "What's on this screen",
            "inbox.customiseQueueStays":
                "The queue always stays. Work isn't something you can switch off.",
            "inbox.customiseGroupMeasures": "Measures",
            "inbox.customiseGroupHistory": "History",
            "inbox.customiseSaveFailed":
                "We couldn't save that — it's back the way it was. Try again in "
                + "a moment.",
            "inbox.customiseStateOn": "On this screen",
            "inbox.customiseStatePutAway": "Put away",

            // --- Where customers come from (#301 LeadSourcesCard.swift) -----------------------
            "inbox.leadSourcesTitle": "Where your customers come from",
            "inbox.leadSourcesNoneSetUp":
                "You haven't told us yet. Put a source on the numbers you "
                + "advertise — the one on the truck, the one in the ad — and "
                + "every call and text to them is counted from then on, with "
                + "nobody tapping anything.",
            // #540: the door out of the paragraph above. Web has always had it;
            // both phones printed the instruction and offered no way to follow it.
            "inbox.leadSourcesSetOneUp": "Set one up",
            "inbox.leadSourcesLeading":
                "Most of the work you can account for came from {name} — "
                + "{count} of {total}.",
            "inbox.leadSourcesMore": "{count} more",
            "inbox.leadSourcesWebsite": "Your website",
            "inbox.leadSourcesWebsiteInline": "your website",
            "inbox.leadSourcesUnknown": "Don't know",
            "inbox.leadSourcesFooterOne": "Last 30 days · {count} conversation",
            "inbox.leadSourcesFooterMany": "Last 30 days · {count} conversations",

            // --- Quotes (#354 PipelineCard.swift) ----------------------------------------------
            "inbox.pipelineTitle": "Quotes",
            "inbox.pipelineWindow": "last 30 days",
            "inbox.pipelineTooEarlyOne":
                "{count} quote sent. Too early to call a win rate.",
            "inbox.pipelineTooEarlyMany":
                "{count} quotes sent. Too early to call a win rate.",
            "inbox.pipelineDeltaPoints": "{delta} pts",
            "inbox.pipelineQuoted": "Quoted",
            "inbox.pipelineWon": "Won",
            "inbox.pipelineStillOut": "Still out",
            "inbox.pipelineShareAria":
                "Of {quoted} quoted, {won} won and {open} still out",

            // --- The referral ask (#288 ReferralAskCard.swift) -----------------------------------
            "inbox.referralGettingLink": "Getting your link…",

            // --- Response time (#239 ResponseTimeCard.swift) --------------------------------------
            //
            // ALL of it now, including the arc phrases and the details rows.
            // `response-time-parity.test.ts` reads the Swift card AND this file
            // for iOS — it has done since the Details control moved — so a
            // sentence that lands here is still held word for word against web
            // and Android. Key names and French are Android's
            // `core/i18n/InboxStrings.kt` verbatim.
            "inbox.responseTimeTitle": "RESPONSE TIME",
            "inbox.responseLoading": "Working out your response time…",
            "inbox.responseNoLeads":
                "No new customers texted you in the last {days} days, so there "
                + "is nothing to measure yet.",
            "inbox.responseRingAria": "{answered} of {leads} new customers answered",
            "inbox.responseToAnswer": "to answer a new customer",
            "inbox.responseArcDown": "Down from {then} when you started",
            "inbox.responseArcUp": "Up from {then} when you started",
            "inbox.responseNoArcTooNew":
                "Your starting point lands once you have been here a fortnight",
            "inbox.responseNoArcNoLeads":
                "No answered leads in your first two weeks, so there is nothing to compare",
            "inbox.responseNoArcSame": "About the same as when you started",
            "inbox.responseUnansweredOne": "1 lead nobody answered",
            "inbox.responseUnansweredMany": "{count} leads nobody answered",
            "inbox.responseSlowest": "Slowest 10% of answers",
            "inbox.responseDuringHours": "During hours ({count})",
            "inbox.responseAfterHours": "After hours ({count})",
            "inbox.responseByNumber": "{number} · {count} unanswered",
            "inbox.responseByMember": "Member · {count} answered",
            "inbox.responseUnansweredHint":
                "Opens the inbox filtered to conversations nobody has answered",
            "inbox.responseSplitTruncated":
                "The hours split covers your most recent {limit} leads; the "
                + "numbers above it cover all {total}.",

            // --- Satisfaction (#313 SatisfactionCard.swift) ------------------------------------------
            //
            // Same arrangement as the card above, and the same reason it is safe:
            // `satisfaction-parity.test.ts` reads the Swift card AND this file
            // for iOS, so the gap sentences, the arc phrases and "Asked" are
            // still compared word for word with web and Android. Keys and
            // French are Android's verbatim.
            "inbox.satisfactionTitle": "SATISFACTION",
            "inbox.satisfactionLoading": "Reading your ratings…",
            "inbox.satisfactionGapNoneAsked":
                "No finished jobs have been asked about in this window. The question "
                + "goes out a few hours after a job is marked done.",
            "inbox.satisfactionGapNoneAnswered":
                "Nobody has answered yet. Most people do not, which is why one answer "
                + "is worth reading rather than counting.",
            "inbox.satisfactionGapTooFew":
                "Too few answers to average yet — {answered} of {minimum}",
            "inbox.satisfactionRingAria": "{score} out of 5, from {count} answers",
            "inbox.satisfactionOutOfFive": "out of 5, from {count} answers",
            "inbox.satisfactionArcUp": "Up from {then} the month before",
            "inbox.satisfactionArcDown": "Down from {then} the month before",
            "inbox.satisfactionNoBaseline":
                "No month before this one to compare against yet",
            "inbox.satisfactionSame": "About the same as the month before",
            "inbox.satisfactionStarsOne": "1 star",
            "inbox.satisfactionStarsMany": "{count} stars",
            "inbox.satisfactionAsked": "Asked",
            "inbox.satisfactionAskedValue": "{count} in {days} days",
            "inbox.satisfactionByMemberOff":
                "Per-person scores are off. In a small crew a bad week is "
                + "noise, so this stays a coaching signal rather than a "
                + "scoreboard — turn it on in Settings.",
            "inbox.satisfactionMemberFallback": "Member",
            "inbox.satisfactionPoorOne": "1 job needed a call back",
            "inbox.satisfactionPoorMany": "{count} jobs needed a call back",
            "inbox.satisfactionByMember": "{name} · {count} answered",
            "inbox.satisfactionMemberTooFew": "Too few answers to average yet",
            "inbox.satisfactionPoorHint":
                "Opens the inbox to follow up with unhappy customers",
            "inbox.satisfactionTruncated": "Showing the most recent {count} ratings.",

            // --- The waiting room (#310 WhileYouWait.swift) --------------------------------------------
            "inbox.whileWaitCallsWork": "Calls already work",
            "inbox.whileWaitCallsBody":
                "Your number rings, takes voicemail, and texts back anyone you "
                + "miss. None of that waits on the carriers.",
            "inbox.whileWaitContacts": "Bring your customers in",
            "inbox.whileWaitInvite": "Invite your crew",
            "inbox.whileWaitHours": "Set your hours and greeting",

            // --- The notifications feed (Features/Notifications) -----------------------------------------
            "inbox.notificationsHeading": "Notifications",
            "inbox.notifReadAll": "Read all",
            "inbox.notifCaughtUp": "You're all caught up.",
            "inbox.notifLoadingOlder": "Loading older…",
            "inbox.notifShowOlder": "Show older",
            "inbox.notifMirrorHint":
                "Push and email mirror these · Settings › Notifications",
            "inbox.notifStateUnread": "Unread",
            "inbox.notifMarkOneFailed": "Couldn't mark that read.",
            "inbox.notifMarkAllFailed": "Couldn't mark all read.",
            "inbox.notifLoadOlderFailed": "Couldn't load older notifications.",
            "inbox.notifNewMessage": "New message",
            "inbox.notifNewMessageFrom": "New message from {who}",
            "inbox.notifAssigned": "Conversation assigned to you",
            "inbox.notifAssignedFrom": "{who} assigned to you",
            "inbox.notifTaskAssigned": "Task assigned to you",
            "inbox.notifTaskAssignedFrom": "Task assigned · {who}",
            "inbox.notifMissedCall": "Missed call",
            "inbox.notifMissedCallFrom": "Missed call from {who}",
            "inbox.notifMention": "You were mentioned",
            "inbox.notifMentionFrom": "You were mentioned · {who}",
            "inbox.notifUpdate": "Update",
            "inbox.notifUpdateFrom": "Update · {who}",
            "inbox.notifPausedBoth": "Notifications are paused",
            "inbox.notifPausedEmail": "Email alerts are paused",
            "inbox.notifPausedPush": "Push alerts are paused",
            "inbox.notifPausedStillPush": " You're still getting push.",
            "inbox.notifPausedResumes": " They resume {when}.",
            "inbox.notifPausedBody":
                "{what} for today — this workspace hit its daily limit."
                + "{still}{resumes} Your messages are all still here.",

            // --- Notification settings (NotificationPrefsCard / DeliveryModesCard) ------------------------
            "inbox.notifEmailTitle": "Email",
            "inbox.notifEmailSupporting":
                "An email when a new conversation starts or a customer texts "
                + "back after a quiet spell. Never one per message.",
            "inbox.notifPushTitle": "Push",
            "inbox.notifPushSupporting":
                "Notifications on your devices for new texts and missed calls.",
            "inbox.notifOnCallTitle": "You're on call",
            "inbox.notifDeviceHeading": "Push on this device",
            "inbox.notifPushUnavailable":
                "Push isn't available in this build yet. Everything still shows "
                + "up in the app.",
            "inbox.notifDeviceOnBody":
                "This device gets a notification when a customer texts or calls.",
            "inbox.notifSystemSettings": "System settings",
            "inbox.notifDeviceOffBody":
                "Get a notification on this device when a customer texts or "
                + "calls, even with Loonext closed.",
            "inbox.notifTurnOn": "Turn on",
            "inbox.notifTurningOn": "Turning on…",
            "inbox.notifDeviceBlockedBody":
                "Notifications are turned off for Loonext in system settings. "
                + "Turn them on there to get pinged.",
            "inbox.notifOpenSettings": "Open settings",
            "inbox.deliveryGroupEvery": "Group them every",
            "inbox.deliveryMinutes": "{minutes} minutes",
        ],
        frCA: [
            // --- The list's own chrome (InboxTab.swift) ----------------------
            "inbox.title": "Boîte de réception",
            "inbox.composeAria": "Nouveau texto",
            "inbox.scheduledOneAria": "1 texto en attente d'envoi",
            "inbox.scheduledManyAria": "{count} textos en attente d'envoi",
            "inbox.searchPlaceholder": "Rechercher textos, tâches, contacts…",
            "inbox.clearSearchAria": "Effacer la recherche",
            "inbox.segmentOpen": "Ouvertes",
            "inbox.segmentMine": "Les miennes",
            "inbox.segmentAll": "Toutes",
            "inbox.segmentClosed": "Fermées",

            // --- The filter chip row -----------------------------------------
            "inbox.chipAssignee": "Responsable",
            "inbox.chipAssigneeNamed": "Responsable : {name}",
            "inbox.chipTag": "Étiquette",
            "inbox.chipTagNamed": "Étiquette : {name}",
            "inbox.chipUnanswered": "Sans réponse",
            "inbox.chipUnread": "Non lues",
            "inbox.chipSpam": "Indésirables",
            "inbox.chipSnoozed": "En veille",
            "inbox.chipClearFilters": "Effacer les filtres",
            "inbox.clearFilterAria": "Effacer le filtre",

            // --- Empty states -------------------------------------------------
            "inbox.emptyEveryoneAnswered": "Tout le monde a reçu une réponse.",
            "inbox.emptyNoFilterMatch": "Rien ne correspond à ces filtres.",
            "inbox.emptyNothingWaiting": "Rien n'attend après vous.",
            "inbox.emptyNothingAssigned": "Rien ne vous est assigné.",
            "inbox.emptyNoClosed": "Aucune conversation fermée.",
            "inbox.emptyNoConversations": "Aucune conversation pour l'instant.",

            // --- One row of the list -------------------------------------------
            "inbox.sectionPinned": "Épinglées",
            "inbox.sectionConversations": "Conversations",
            "inbox.assigneeYou": "Vous",
            "inbox.teammateFallback": "Coéquipier",
            "inbox.rowPreviewNote": "Note · {body}",
            "inbox.rowPreviewYou": "Vous : {body}",
            "inbox.rowAssignedToTitle": "Assignée à {name}",
            "inbox.rowStateUnread": "Non lue",
            "inbox.tagOverflow": "+{count}",
            "inbox.spamLabel": "Indésirable",
            "inbox.swipeRead": "Lue",
            "inbox.swipeUnread": "Non lue",
            "inbox.swipeReopen": "Rouvrir",
            "inbox.swipeDone": "Terminée",
            "inbox.swipeAssign": "Assigner",
            "inbox.undo": "Annuler",
            "inbox.conversationClosed": "Conversation fermée",
            "inbox.conversationReopened": "Conversation rouverte",

            // --- The two filter sheets ------------------------------------------
            "inbox.filterByAssigneeTitle": "Filtrer par responsable",
            "inbox.filterByTagTitle": "Filtrer par étiquette",
            "inbox.filterAnyone": "N'importe qui",
            "inbox.filterAnyTag": "Toute étiquette",
            "inbox.filterNoTags":
                "Aucune étiquette pour l'instant. Ajoutez-en depuis une "
                + "conversation sur le web.",
            "inbox.youSuffix": " (vous)",

            // --- Global search ----------------------------------------------------
            "inbox.searchNoMatches": "Aucun résultat pour « {query} ».",
            "inbox.searchNotePrefix": "Note · ",
            "inbox.searchLoadingMore": "Chargement…",
            "inbox.searchMoreResults": "Plus de résultats",
            "inbox.searchHeadingConversations": "Conversations",
            "inbox.searchHeadingContacts": "Contacts",
            "inbox.searchHeadingTasks": "Tâches",
            "inbox.searchHeadingAttachments": "Pièces jointes",
            "inbox.searchHeadingVoicemails": "Messages vocaux",
            "inbox.searchHeadingTemplates": "Réponses enregistrées",
            "inbox.taskDone": "Terminée",
            "inbox.taskOpen": "Tâche ouverte",
            "inbox.voicemailFallback": "Message vocal",

            // --- The multi-select bar (#275) ----------------------------------------
            "inbox.bulkClearSelectionAria": "Effacer la sélection",
            "inbox.bulkMoreAria": "Plus d'actions groupées",
            "inbox.bulkAssignTo": "Assigner à {name}",
            "inbox.bulkUnassign": "Retirer l'assignation",
            "inbox.bulkSelectAllLoaded": "Sélectionner les {count} chargées",
            "inbox.bulkSelectAllMatching":
                "Sélectionner tout ce qui correspond à ce filtre",
            "inbox.bulkMarkRead": "Marquer comme lues",
            "inbox.bulkClose": "Fermer",
            "inbox.bulkSpam": "Indésirable",
            "inbox.bulkResultApplied": "{verb} {count} {thing}",
            "inbox.bulkResultCapped":
                ". {count} de plus correspondent que ce qu'une seule passe peut "
                + "traiter ; relancez l'action",
            "inbox.bulkResultFailedOne":
                ". {count} n'a pas pu être atteinte et a été laissée telle quelle",
            "inbox.bulkResultFailedMany":
                ". {count} n'ont pas pu être atteintes et ont été laissées telles quelles",
            "inbox.bulkNounOne": "conversation",
            "inbox.bulkNounMany": "conversations",
            "inbox.bulkVerbMarkedRead": "Marquées comme lues",
            "inbox.bulkVerbClosed": "Fermées",
            "inbox.bulkVerbMarkedSpam": "Marquées comme indésirables",
            "inbox.bulkVerbAssigned": "Assignées",
            "inbox.bulkVerbUnassigned": "Désassignées",

            // --- Saved views (#280) ---------------------------------------------------
            "inbox.viewsSave": "Enregistrer cette vue",
            "inbox.viewSaveDescription":
                "Les filtres que vous avez en ce moment, sous un nom, à une "
                + "touche demain.",
            "inbox.viewNameLabel": "Nom",
            "inbox.viewShareToggle": "La partager avec l'équipe",
            "inbox.viewShareNote":
                "Tout le monde obtient la même vue, et chaque personne ne voit "
                + "que les numéros auxquels elle a déjà accès.",
            "inbox.viewSaving": "Enregistrement",
            "inbox.viewRenameTitle": "Renommer la vue",
            "inbox.viewRename": "Renommer",
            "inbox.viewStopOpeningHere": "Ne plus ouvrir ici",
            "inbox.viewOpenHereByDefault": "Ouvrir ici par défaut",
            "inbox.viewDeleteTitle": "Supprimer cette vue d'équipe ?",
            "inbox.viewDeleteBody":
                "Toute l'équipe utilise {name}. Quiconque ouvre l'application "
                + "ici arrivera plutôt sur la boîte de réception ordinaire.",
            "inbox.viewDeleteConfirm": "Supprimer pour tout le monde",
            "inbox.viewDeleteKeep": "La garder",

            // --- The crew queue (#233 ScheduledSheet.swift) -----------------------------
            "inbox.scheduledTitle": "Programmés",
            "inbox.scheduledEmptyTitle": "Rien de programmé",
            "inbox.scheduledNeedsYou": "Demande votre attention",
            "inbox.scheduledGoingOut": "À envoyer",
            "inbox.scheduledWaiting": "En attente",
            "inbox.scheduledThisConversation": "Cette conversation",
            "inbox.done": "Terminé",

            // --- First-run guidance (#476 GettingStartedCard.swift) ----------------------
            "inbox.startedOwnerTitle": "Premiers pas",
            "inbox.startedOwnerSignupLabel": "Configurer votre espace de travail",
            "inbox.startedOwnerNumberLabel": "Obtenir votre numéro d'entreprise",
            "inbox.startedOwnerNumberHint":
                "Il arrive, habituellement en moins d'une minute.",
            "inbox.startedOwnerNumberStalledHint":
                "Cela prend un peu plus de temps que d'habitude. Vous n'avez rien à faire.",
            "inbox.startedOwnerInboundLabel": "Recevoir votre premier texto",
            "inbox.startedOwnerInboundHint":
                "Textez votre numéro depuis votre téléphone, et le message arrive ici.",
            "inbox.startedOwnerReplyLabel": "Envoyer votre première réponse",
            "inbox.startedOwnerReplyHint":
                "Ouvrez une conversation et répondez comme vous le feriez de votre cellulaire.",
            "inbox.startedOwnerTeammateLabel": "Inviter un coéquipier",
            "inbox.startedMemberTitle": "Prendre le rythme",
            "inbox.startedMemberReplyLabel": "Répondre à un client",
            "inbox.startedMemberReplyHint":
                "Ouvrez une conversation et répondez. Le texto part du numéro "
                + "d'entreprise, et toute l'équipe le voit.",
            "inbox.startedMemberNoteLabel": "Laisser une note à l'équipe",
            "inbox.startedMemberNoteHint":
                "Basculez le champ de rédaction en mode Note. Les notes restent dans "
                + "l'application — le client ne les voit jamais.",
            "inbox.startedMemberDoneLabel": "Marquer quelque chose comme fait",
            "inbox.startedMemberDoneHint":
                "Cochez un message une fois qu'il est réglé, pour que le reste de "
                + "l'équipe sache que personne n'a à le relancer.",
            "inbox.startedMemberFooter":
                "Vos paramètres de notification n'appartiennent qu'à vous. "
                + "Choisissez quand nous vous avertissons dans les paramètres.",
            "inbox.startedProgress": "{done} sur {total} de fait",
            "inbox.startedProgressAria": "{done} étapes sur {total} de faites",
            "inbox.startedDismissAria": "Masquer {title}",
            "inbox.startedStepDone": ", fait",
            "inbox.startedStepNotDone": ", pas encore fait",

            // --- The "For you" queue (ForYouTab.swift) -------------------------------------
            "inbox.forYouTitle": "Pour vous",
            "inbox.forYouAllCaughtUp": "Vous êtes à jour.",
            "inbox.forYouWorkOne": "1 chose demande votre attention",
            "inbox.forYouWorkMany": "{count} choses demandent votre attention",
            "inbox.forYouSectionSpamReview": "Marquées indésirables, textent encore",
            "inbox.forYouSectionUnassigned": "Non assignées",
            "inbox.forYouSectionChaseThese": "À relancer",
            "inbox.forYouSectionWaiting": "En attente de vous",
            "inbox.forYouSectionTasks": "Mes tâches",
            "inbox.forYouSectionUnread": "Non lues",
            "inbox.forYouRecentCalls": "Appels récents",
            "inbox.forYouViewAllCalls": "Voir tout",
            "inbox.forYouCallsLoadFailed": "Impossible de charger les appels récents.",
            "inbox.forYouNotSpam": "Pas indésirable",
            "inbox.forYouStillSpam": "Toujours indésirable",
            "inbox.forYouUnknownCaller": "Inconnu",
            "inbox.forYouWhyNoReply": "Aucune réponse depuis {when}",
            "inbox.forYouWhyOverdueTask": "Tâche en retard",
            "inbox.forYouWhyDue": "Échéance {when}",
            "inbox.forYouWhyOpenTask": "Tâche ouverte",

            // --- Customise this screen (#540 CustomiseSheet.swift) ---------------------------
            "inbox.responseDetails": "Détails",
            "inbox.responseHideDetails": "Masquer les détails",
            "inbox.satisfactionDetails": "Détails",
            "inbox.satisfactionHideDetails": "Masquer les détails",
            "inbox.forYouNotificationsAria": "Notifications",
            "inbox.customiseAria": "Personnaliser cet écran",
            "inbox.customiseAriaPutAwayOne":
                "Personnaliser cet écran — {count} panneau rangé",
            "inbox.customiseAriaPutAwayMany":
                "Personnaliser cet écran — {count} panneaux rangés",
            "inbox.customiseTitle": "Ce qu'il y a sur cet écran",
            "inbox.customiseQueueStays":
                "La file reste toujours. Le travail ne se désactive pas.",
            "inbox.customiseGroupMeasures": "Mesures",
            "inbox.customiseGroupHistory": "Historique",
            "inbox.customiseSaveFailed":
                "Impossible d'enregistrer — tout est revenu comme avant. "
                + "Réessayez dans un moment.",
            "inbox.customiseStateOn": "Sur cet écran",
            "inbox.customiseStatePutAway": "Rangé",

            // --- Where customers come from (#301 LeadSourcesCard.swift) -----------------------
            "inbox.leadSourcesTitle": "D'où viennent vos clients",
            "inbox.leadSourcesNoneSetUp":
                "Vous ne nous l'avez pas encore dit. Attribuez une source aux "
                + "numéros que vous annoncez — celui sur le camion, celui dans "
                + "la publicité — et chaque appel et texto vers ces numéros est "
                + "compté à partir de là, sans que personne n'ait à toucher à "
                + "quoi que ce soit.",
            "inbox.leadSourcesSetOneUp": "En configurer une",
            "inbox.leadSourcesLeading":
                "La majorité du travail que vous pouvez attribuer vient de {name} — "
                + "{count} sur {total}.",
            "inbox.leadSourcesMore": "{count} de plus",
            "inbox.leadSourcesWebsite": "Votre site web",
            "inbox.leadSourcesWebsiteInline": "votre site web",
            "inbox.leadSourcesUnknown": "Inconnue",
            "inbox.leadSourcesFooterOne": "30 derniers jours · {count} conversation",
            "inbox.leadSourcesFooterMany": "30 derniers jours · {count} conversations",

            // --- Quotes (#354 PipelineCard.swift) ----------------------------------------------
            "inbox.pipelineTitle": "Devis",
            "inbox.pipelineWindow": "30 derniers jours",
            "inbox.pipelineTooEarlyOne":
                "{count} devis envoyé. Trop tôt pour parler d'un taux de réussite.",
            "inbox.pipelineTooEarlyMany":
                "{count} devis envoyés. Trop tôt pour parler d'un taux de réussite.",
            "inbox.pipelineDeltaPoints": "{delta} pts",
            "inbox.pipelineQuoted": "Envoyés",
            "inbox.pipelineWon": "Gagnés",
            "inbox.pipelineStillOut": "En attente",
            "inbox.pipelineShareAria":
                "Sur {quoted} devis envoyés, {won} gagnés et {open} en attente",

            // --- The referral ask (#288 ReferralAskCard.swift) -----------------------------------
            "inbox.referralGettingLink": "Récupération de votre lien…",

            // --- Response time (#239 ResponseTimeCard.swift) --------------------------------------
            "inbox.responseTimeTitle": "TEMPS DE RÉPONSE",
            "inbox.responseLoading": "Calcul de votre temps de réponse…",
            "inbox.responseNoLeads":
                "Aucun nouveau client ne vous a texté dans les {days} derniers "
                + "jours, alors il n'y a encore rien à mesurer.",
            "inbox.responseRingAria":
                "{answered} nouveaux clients sur {leads} ont eu une réponse",
            "inbox.responseToAnswer": "pour répondre à un nouveau client",
            "inbox.responseArcDown": "En baisse depuis {then} à vos débuts",
            "inbox.responseArcUp": "En hausse depuis {then} à vos débuts",
            "inbox.responseNoArcTooNew":
                "Votre point de départ sera établi après deux semaines ici",
            "inbox.responseNoArcNoLeads":
                "Aucun client n'a reçu de réponse durant vos deux premières "
                + "semaines, alors il n'y a rien à comparer",
            "inbox.responseNoArcSame": "À peu près comme à vos débuts",
            "inbox.responseUnansweredOne": "1 client potentiel sans réponse",
            "inbox.responseUnansweredMany": "{count} clients potentiels sans réponse",
            "inbox.responseSlowest": "Les 10 % de réponses les plus lentes",
            "inbox.responseDuringHours": "Pendant les heures ({count})",
            "inbox.responseAfterHours": "Hors des heures ({count})",
            "inbox.responseByNumber": "{number} · {count} sans réponse",
            "inbox.responseByMember": "Membre · {count} avec réponse",
            "inbox.responseUnansweredHint":
                "Ouvre la boîte de réception filtrée sur les conversations sans "
                + "réponse",
            "inbox.responseSplitTruncated":
                "La répartition par heures couvre vos {limit} clients potentiels "
                + "les plus récents ; les chiffres au-dessus couvrent l'ensemble "
                + "des {total}.",

            // --- Satisfaction (#313 SatisfactionCard.swift) ------------------------------------------
            "inbox.satisfactionTitle": "SATISFACTION",
            "inbox.satisfactionLoading": "Lecture de vos évaluations…",
            "inbox.satisfactionGapNoneAsked":
                "Aucun travail terminé n'a fait l'objet d'une question durant cette "
                + "période. La question part quelques heures après qu'un travail est "
                + "marqué comme fait.",
            "inbox.satisfactionGapNoneAnswered":
                "Personne n'a répondu encore. La plupart des gens ne répondent pas, "
                + "c'est pourquoi une seule réponse vaut la peine d'être lue plutôt "
                + "que comptée.",
            "inbox.satisfactionGapTooFew":
                "Trop peu de réponses pour faire une moyenne — {answered} sur {minimum}",
            "inbox.satisfactionRingAria": "{score} sur 5, à partir de {count} réponses",
            "inbox.satisfactionOutOfFive": "sur 5, à partir de {count} réponses",
            "inbox.satisfactionArcUp": "En hausse depuis {then} le mois précédent",
            "inbox.satisfactionArcDown": "En baisse depuis {then} le mois précédent",
            "inbox.satisfactionNoBaseline":
                "Aucun mois précédent auquel se comparer pour l'instant",
            "inbox.satisfactionSame": "À peu près comme le mois précédent",
            "inbox.satisfactionStarsOne": "1 étoile",
            "inbox.satisfactionStarsMany": "{count} étoiles",
            "inbox.satisfactionAsked": "Demandées",
            "inbox.satisfactionAskedValue": "{count} en {days} jours",
            "inbox.satisfactionByMemberOff":
                "Les scores par personne sont désactivés. Dans une petite équipe, une "
                + "mauvaise semaine n'est que du bruit ; cela reste donc un signal "
                + "d'accompagnement plutôt qu'un tableau de classement — activez-les "
                + "dans les paramètres.",
            "inbox.satisfactionMemberFallback": "Membre",
            "inbox.satisfactionPoorOne": "1 travail a nécessité un rappel",
            "inbox.satisfactionPoorMany": "{count} travaux ont nécessité un rappel",
            "inbox.satisfactionByMember": "{name} · {count} avec réponse",
            "inbox.satisfactionMemberTooFew":
                "Trop peu de réponses pour faire une moyenne",
            "inbox.satisfactionPoorHint":
                "Ouvre la boîte de réception pour faire un suivi auprès des "
                + "clients insatisfaits",
            "inbox.satisfactionTruncated":
                "Affichage des {count} évaluations les plus récentes.",

            // --- The waiting room (#310 WhileYouWait.swift) --------------------------------------------
            "inbox.whileWaitCallsWork": "Les appels fonctionnent déjà",
            "inbox.whileWaitCallsBody":
                "Votre numéro sonne, prend les messages vocaux et renvoie un "
                + "texto à toute personne que vous manquez. Rien de tout cela "
                + "n'attend les opérateurs.",
            "inbox.whileWaitContacts": "Importer vos clients",
            "inbox.whileWaitInvite": "Inviter votre équipe",
            "inbox.whileWaitHours": "Définir vos heures et votre message d'accueil",

            // --- The notifications feed (Features/Notifications) -----------------------------------------
            "inbox.notificationsHeading": "Notifications",
            "inbox.notifReadAll": "Tout marquer comme lu",
            "inbox.notifCaughtUp": "Vous êtes à jour.",
            "inbox.notifLoadingOlder": "Chargement des précédentes…",
            "inbox.notifShowOlder": "Voir les précédentes",
            "inbox.notifMirrorHint":
                "Les notifications poussées et les courriels reprennent ceci · "
                + "Paramètres › Notifications",
            "inbox.notifStateUnread": "Non lu",
            "inbox.notifMarkOneFailed": "Impossible de marquer comme lu.",
            "inbox.notifMarkAllFailed": "Impossible de tout marquer comme lu.",
            "inbox.notifLoadOlderFailed":
                "Impossible de charger les notifications précédentes.",
            "inbox.notifNewMessage": "Nouveau texto",
            "inbox.notifNewMessageFrom": "Nouveau texto de {who}",
            "inbox.notifAssigned": "Conversation qui vous est assignée",
            "inbox.notifAssignedFrom": "{who} vous est assigné",
            "inbox.notifTaskAssigned": "Tâche qui vous est assignée",
            "inbox.notifTaskAssignedFrom": "Tâche assignée · {who}",
            "inbox.notifMissedCall": "Appel manqué",
            "inbox.notifMissedCallFrom": "Appel manqué de {who}",
            "inbox.notifMention": "Vous avez été mentionné",
            "inbox.notifMentionFrom": "Vous avez été mentionné · {who}",
            "inbox.notifUpdate": "Mise à jour",
            "inbox.notifUpdateFrom": "Mise à jour · {who}",
            "inbox.notifPausedBoth": "Les notifications sont en pause",
            "inbox.notifPausedEmail": "Les alertes par courriel sont en pause",
            "inbox.notifPausedPush": "Les alertes poussées sont en pause",
            "inbox.notifPausedStillPush":
                " Vous recevez toujours les notifications poussées.",
            "inbox.notifPausedResumes": " Elles reprennent {when}.",
            "inbox.notifPausedBody":
                "{what} pour aujourd'hui — cet espace de travail a atteint sa "
                + "limite quotidienne.{still}{resumes} Vos messages sont tous "
                + "encore là.",

            // --- Notification settings (NotificationPrefsCard / DeliveryModesCard) ------------------------
            "inbox.notifEmailTitle": "Courriel",
            "inbox.notifEmailSupporting":
                "Un courriel quand une conversation commence ou qu'un client "
                + "répond après une accalmie. Jamais un par texto.",
            "inbox.notifPushTitle": "Notifications poussées",
            "inbox.notifPushSupporting":
                "Des notifications sur vos appareils pour les nouveaux textos "
                + "et les appels manqués.",
            "inbox.notifOnCallTitle": "Vous êtes de garde",
            "inbox.notifDeviceHeading": "Notifications sur cet appareil",
            "inbox.notifPushUnavailable":
                "Les notifications poussées ne sont pas encore offertes dans "
                + "cette version. Tout reste visible dans l'application.",
            "inbox.notifDeviceOnBody":
                "Cet appareil reçoit une notification quand un client texte ou "
                + "appelle.",
            "inbox.notifSystemSettings": "Paramètres du système",
            "inbox.notifDeviceOffBody":
                "Recevez une notification sur cet appareil quand un client texte "
                + "ou appelle, même si Loonext est fermé.",
            "inbox.notifTurnOn": "Activer",
            "inbox.notifTurningOn": "Activation…",
            "inbox.notifDeviceBlockedBody":
                "Les notifications sont désactivées pour Loonext dans les "
                + "paramètres du système. Activez-les là pour être averti.",
            "inbox.notifOpenSettings": "Ouvrir les paramètres",
            "inbox.deliveryGroupEvery": "Les regrouper toutes les",
            "inbox.deliveryMinutes": "{minutes} minutes",
        ]
    )
}
