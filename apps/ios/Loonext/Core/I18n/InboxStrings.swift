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
            "inbox.swipeReopen": "Reopen",
            "inbox.swipeDone": "Done",
            "inbox.swipeAssign": "Assign",
            "inbox.undo": "Undo",

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
            // The step LABELS and HINTS are deliberately absent: they live in
            // `ownerSteps`/`memberSteps`, which `first-run-copy.test.ts` reads
            // as source text on all three clients. See the note in that file.
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
            // Only the sentences `response-time-parity.test.ts` does NOT read
            // out of the Swift card. The arc phrases, "to answer a new
            // customer", the details rows and the unanswered line are still
            // written at the card, because that guard reads the FILE for iOS.
            "inbox.responseTimeTitle": "RESPONSE TIME",
            "inbox.responseLoading": "Working out your response time…",
            "inbox.responseNoLeads":
                "No new customers texted you in the last {days} days, so there "
                + "is nothing to measure yet.",
            "inbox.responseRingAria": "{answered} of {leads} new customers answered",
            "inbox.responseUnansweredHint":
                "Opens the inbox filtered to conversations nobody has answered",
            "inbox.responseSplitTruncated":
                "The hours split covers your most recent {limit} leads; the "
                + "numbers above it cover all {total}.",

            // --- Satisfaction (#313 SatisfactionCard.swift) ------------------------------------------
            //
            // Same arrangement, and the same reason: `satisfaction-parity.test.ts`
            // reads the Swift card, so "out of 5, from …", "Asked", the arc
            // phrases and the gap sentences stay in it.
            "inbox.satisfactionTitle": "SATISFACTION",
            "inbox.satisfactionLoading": "Reading your ratings…",
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
            "inbox.swipeReopen": "Rouvrir",
            "inbox.swipeDone": "Terminée",
            "inbox.swipeAssign": "Assigner",
            "inbox.undo": "Annuler",

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
