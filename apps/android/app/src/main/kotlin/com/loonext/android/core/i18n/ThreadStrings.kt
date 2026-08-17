package com.loonext.android.core.i18n

/**
 * #228 — the conversation: its timeline, its composer, and the files that ride
 * on both (`features/thread`, `features/compose`, `features/attachments`).
 *
 * The busiest surface in the product, so it is also the one where a half-English
 * screen is most obvious: a crew member reads this all day and reads the
 * settings index twice a year.
 *
 * The register is `CommonStrings`': Quebec French, VOUVOIEMENT, accents spelled
 * normally, a space before `:`. Product names (Loonext, Lou, Stripe, Telnyx) and
 * the carrier keywords (STOP / START / HELP / URGENT) are never translated — a
 * carrier matches on the keyword, and a customer who is told to text "ARRÊT"
 * will not be unsubscribed by anybody.
 *
 * The shared vocabulary, so the phone and the laptop agree word for word:
 * texto · conversation · client · équipe · espace de travail · numéro · tâche ·
 * rappel · devis · acompte · forfait · facturation · paramètres ·
 * boîte de réception.
 */
object ThreadStrings : AppStrings.Section {
    override val en = mapOf(
        // #287 — the quote strip. Lifted verbatim from web's catalogue so
        // the clients say one thing; pinned by QuoteCopyParityTest.
        "quotes.statusDraft" to
            "Draft",
        "quotes.statusSent" to
            "Waiting",
        "quotes.statusViewed" to
            "Opened, no answer",
        "quotes.statusAccepted" to
            "Accepted",
        "quotes.statusDeclined" to
            "Declined",
        "quotes.statusExpired" to
            "Expired",
        "quotes.newQuote" to
            "Quote this job",
        "quotes.sendFor" to
            "Send for {amount}",
        "quotes.sending" to
            "Sending…",
        "quotes.saveDraft" to
            "Save draft",
        "quotes.saving" to
            "Saving…",
        "quotes.amountLabel" to
            "Amount",
        "quotes.descriptionLabel" to
            "What the work is",
        "quotes.expiresInDays" to
            "The price holds for {days} days. You can send it as soon as it is saved.",
        "quotes.needAmount" to
            "Put a number in, and make it more than zero.",
        "quotes.needDescription" to
            "Say what the work is. The customer sees this line.",
        // --- The thread itself -------------------------------------------
        "thread.notFound" to "This conversation doesn't exist or was removed.",
        "thread.backToInbox" to "Back to inbox",
        "thread.noMessages" to "No messages yet.",
        "thread.newMessagePill" to "New message",
        "thread.copied" to "Copied.",
        "thread.more" to "More",
        "thread.callContact" to "Call {name}",
        "thread.optedOut" to "Opted out",
        "thread.contactFallback" to "Contact",
        "thread.conversationFallback" to "Conversation",
        "thread.viewContact" to "View contact",
        "thread.photo" to "Photo",
        "thread.file" to "File",
        "thread.teammate" to "Teammate",
        "thread.you" to "You",
        "thread.youSuffix" to " (you)",
        "thread.selected" to "Selected",
        "thread.micNeededForCalls" to
            "Loonext needs the microphone to place calls. " +
            "Allow it in Settings › Apps › Loonext › Permissions.",

        // --- Status ------------------------------------------------------
        "thread.statusHeading" to "STATUS",
        "thread.statusNew" to "New",
        "thread.statusOpen" to "Open",
        "thread.statusWaiting" to "Waiting",
        "thread.statusClosed" to "Closed",

        // --- Day dividers -------------------------------------------------
        "thread.dayToday" to "Today",
        "thread.dayYesterday" to "Yesterday",

        // --- Queued sends (#234) -------------------------------------------
        "thread.deleteQueuedTitle" to "Delete this message?",
        "thread.deleteQueuedBody" to
            "It hasn't been sent, and deleting it here is the only copy gone.",
        "thread.keepIt" to "Keep it",
        "thread.queuedOffline" to "Queued — will send when you're back online",
        "thread.sending" to "Sending…",
        "thread.sent" to "Sent",
        "thread.delivered" to "Delivered",
        "thread.sendNow" to "Send now",
        "thread.retry" to "Retry",
        "thread.oneAttachment" to "1 attachment",
        "thread.manyAttachments" to "{count} attachments",

        // --- Tags ----------------------------------------------------------
        "thread.tags" to "Tags",
        "thread.addTag" to "Add tag",
        "thread.removeTag" to "Remove tag {name}",
        "thread.addOrCreateTag" to "Add or create a tag",
        "thread.findTag" to "Find a tag",
        "thread.create" to "Create",
        "thread.add" to "Add",
        "thread.didYouMean" to "Did you mean \"{name}\"?",
        "thread.tagsLocked" to
            "No tag by that name. Ask an admin to add it — this workspace keeps " +
            "a set list.",
        "thread.noTagsCreate" to "No tags yet. Create the first one above.",
        "thread.noTagsAdmin" to "No tags yet. An admin adds the first one.",
        "thread.attached" to "Attached",

        // --- Opt-out (#407) --------------------------------------------------
        "thread.optOutTitle" to "Opt this customer out?",
        "thread.optOutBody" to
            "They won't receive texts from you until the opt-out is removed. " +
            "This is recorded in the conversation timeline.",
        "thread.optOut" to "Opt out",
        "thread.optOutOfTexts" to "Opt out of texts",
        "thread.revokeTitle" to "Remove the opt-out?",
        "thread.revokeBody" to
            "You'll be able to text this customer again. Only do this if they " +
            "asked to hear from you.",
        "thread.removeOptOut" to "Remove opt-out",
        "thread.carrierStopNote" to
            "This customer texted STOP. Only they can undo it, by texting START " +
            "to your number.",

        // --- Assignment ------------------------------------------------------
        "thread.assignTo" to "Assign to",
        "thread.assignToEllipsis" to "Assign to…",
        "thread.assignedTo" to "Assigned to {name}",
        "thread.unassigned" to "Unassigned",

        // --- Spam (#250) -----------------------------------------------------
        "thread.spam" to "Spam",
        "thread.spamTitle" to "This looks like spam",
        "thread.notSpam" to "Not spam",
        "thread.spamBody" to
            "We didn't send a notification for it. Nothing is hidden, and you " +
            "can reply as normal.",

        // --- Snooze (#293) ----------------------------------------------------
        "thread.bringBack" to "Bring back",
        "thread.bringBackNow" to "Bring back now",
        "thread.cancelReminder" to "Cancel the reminder",
        "thread.snoozeUntil" to "Snooze until",
        "thread.remindMeToChase" to "Remind me to chase",
        "thread.pickADate" to "Pick a date…",
        "thread.remindMe" to "Remind me",
        "thread.snooze" to "Snooze",
        "thread.whyOptional" to "Why? (optional)",

        // --- Pinned ------------------------------------------------------------
        "thread.pinned" to "Pinned",
        "thread.pinnedCount" to "Pinned · {count}",
        "thread.collapse" to "Collapse",
        "thread.expand" to "Expand",

        // --- Timeline visibility -------------------------------------------------
        "thread.showMessages" to "Show messages",
        "thread.showNotes" to "Show notes",
        "thread.showEvents" to "Show events",

        // --- Message bubbles + long-press actions ---------------------------------
        "thread.internalNote" to "Internal note",
        "thread.noteOnTask" to "on: {title}",
        "thread.openTask" to "Open task",
        "thread.hasTask" to "Has a task",
        "thread.openTheTask" to "Open the task",
        "thread.goToMessage" to "Go to that message",
        "thread.photoUnavailable" to "Photo unavailable · tap to retry",
        "thread.copyText" to "Copy text",
        "thread.done" to "Done",
        "thread.retrySend" to "Retry send",
        "thread.makeTask" to "Make a task",

        // --- Make a task (#214) ------------------------------------------------
        "thread.newTask" to "New task",
        "thread.newTaskFrom" to "From {name}'s message · posts to the thread",
        "thread.taskTitle" to "Title",
        "thread.taskTitleFallback" to "Follow up",
        "thread.due" to "Due",
        "thread.dueToday" to "Today",
        "thread.dueTomorrow9" to "Tomorrow 9 AM",
        "thread.pickATime" to "Pick a time…",
        "thread.createTask" to "Create task",
        "thread.setDueDate" to "Set due date",
        "thread.nobodyYet" to "Nobody yet",
        "thread.suggested" to "Suggested",
        "thread.addressSection" to "Address",
        "thread.clear" to "Clear",
        "thread.showAddress" to "Show address",
        "thread.hideAddress" to "Hide address",
        "thread.addrStreet" to "Street",
        "thread.addrUnit" to "Unit / suite",
        "thread.addrCity" to "City",
        "thread.addrState" to "State / province",
        "thread.addrPostal" to "Postal code",

        // --- Contact panel (#165 / #301) -----------------------------------------
        "thread.openFullContact" to "Open the full contact",
        "thread.sectionDetails" to "Details",
        "thread.sectionConsent" to "Consent",
        "thread.sectionLeadSource" to "Where they came from",
        "thread.sectionTasks" to "Tasks in this conversation",
        "thread.sectionOtherConversations" to "Other conversations",
        "thread.fieldName" to "Name",
        "thread.addName" to "Add a name",
        "thread.fieldAddress" to "Address",
        "thread.addAddress" to "Add an address",
        "thread.fieldNotes" to "Notes",
        "thread.notesPlaceholder" to
            "Gate code, dog's name, preferred arrival window…",
        "thread.leadFromLine" to "{name} · the line they called",
        "thread.leadSaidSo" to "{name} · somebody said so",
        "thread.leadAsk" to "Ask them: how did you hear about us?",
        "thread.dontKnow" to "Don't know",
        "thread.tasksLoadFailed" to "Couldn't load this conversation's tasks.",
        "thread.noTasks" to "No tasks in this conversation.",
        "thread.priorLoadFailed" to "Couldn't load prior conversations.",
        "thread.noOtherConversations" to "No other conversations with this contact.",

        // --- The catch-up card (#247) ----------------------------------------------
        "thread.summaryReading" to "Reading the thread…",
        "thread.summaryReady" to "Lou's catch-up",
        "thread.summaryRetry" to "Try the catch-up again",
        "thread.summaryOffer" to "Catch me up",
        "thread.summaryTruncated" to
            "The thread is longer than this — Lou read the most recent part.",
        "thread.summaryLineAria" to "{text}. Open the message this came from.",

        // --- Scheduled strip (#233) ---------------------------------------------
        "thread.scheduledWaiting" to "Waiting",
        "thread.cancelScheduledAria" to "Cancel the message scheduled for {when}",

        // --- Asking for payment (#224), the parts payments.* does not carry --------
        "thread.askAmountLabel" to "Amount in {currency}",
        "thread.askDefaultDescription" to "Deposit",
        "thread.yourBusiness" to "Your business",
        "thread.askFootnote" to
            "Goes out as a text with a secure payment link. The money lands in " +
            "your bank account — we take nothing on top.",

        // --- Photos & files (#165 / #317) ------------------------------------------
        "thread.photosAndFiles" to "Photos & files",
        "thread.backToConversation" to "Back to conversation",
        "thread.galleryImages" to "Images",
        "thread.galleryFiles" to "Files",
        "thread.noPhotosLoaded" to "No photos loaded yet.",
        "thread.noPhotosYet" to "No photos in this conversation yet.",
        "thread.noFilesLoaded" to "No files loaded yet.",
        "thread.noFilesYet" to "No files in this conversation yet.",
        "thread.loadMore" to "Load more",
        "thread.noAppForFile" to "No app on this device can open that file.",
        "thread.fileActions" to "Actions for {name}",
        "thread.reportThisFile" to "Report this file",
        "thread.reportPhotoAction" to "Report this photo",
        "thread.reportFileTitle" to "Report this file?",
        "thread.reportFileBody" to
            "Nobody on your team will be able to open {name} until an owner or " +
            "admin releases it. Nothing is deleted.",
        "thread.reporting" to "Reporting…",
        "thread.reportFile" to "Report file",
        "thread.reportFileFailed" to "Couldn't report that file. Try again.",
        "thread.playAudio" to "Play audio message",
        "thread.pauseAudio" to "Pause audio message",

        // --- The composer ------------------------------------------------------------
        "thread.modeText" to "Text",
        "thread.modeNote" to "Note",
        "thread.textPlaceholder" to "Text message",
        "thread.notePlaceholder" to "Write an internal note…",
        "thread.addToMessage" to "Add to message",
        "thread.attachFiles" to "Attach files",
        "thread.attachFilesToNote" to "Attach files to this note",
        "thread.savedReply" to "Saved reply",
        "thread.sendLater" to "Send later",
        "thread.sendMessage" to "Send message",
        "thread.saveNote" to "Save note",
        "thread.attachedPhoto" to "Attached photo",
        "thread.removePhoto" to "Remove photo",
        "thread.removeNamed" to "Remove {name}",
        "thread.attachLimitText" to "You can attach up to {max} files per text.",
        "thread.attachLimitNote" to "Notes can carry up to 10 files.",
        "thread.sendsAs" to "Sends as: ",
        "thread.mmsSegments" to "MMS · sent in {count} parts",
        "thread.sentInOnePart" to "Sent in 1 part",
        "thread.sentInParts" to "Sent in {count} parts",
        "thread.callThemInstead" to "Call them instead",
        "thread.reportThis" to "Report this",

        // --- The send boundary (#408) ---------------------------------------------
        "thread.collisionTitle" to "Somebody already answered",
        "thread.collisionAsk" to " Send yours as well?",
        "thread.sendAnyway" to "Send anyway",
        "thread.letMeLook" to "Let me look",

        // --- Lou in the composer ----------------------------------------------------
        "thread.draftWithLou" to "Draft with Lou",
        "thread.finishWithLou" to "Finish with Lou",
        "thread.drafting" to "Drafting…",
        "thread.lousDrafts" to "Lou's drafts",
        "thread.dismiss" to "Dismiss",
        "thread.louNeedsBusiness" to
            "Lou doesn't know what you do yet. Tell it, and drafts get specific.",

        // --- The dictated wrap-up (#507) ----------------------------------------------
        "thread.holdToDictate" to "Hold to say what the call was about",
        "thread.wrapUpRecording" to
            "Say what the call was about — {elapsed}. Let go when you're done.",
        "thread.wrapUpWriting" to "Writing your words down…",
        "thread.wrapUpLost" to
            "That recording was lost — something else may have taken the " +
            "microphone. Try again, or type the note.",
        "thread.micAllowed" to
            "Microphone allowed. Hold it and say what the call was about.",
        "thread.micDeniedWrapUp" to
            "Loonext needs the microphone to write down a spoken wrap-up. Type " +
            "the note instead, or allow it in Settings › Apps › Loonext › " +
            "Permissions.",
        "thread.micStartFailed" to
            "Couldn't start the microphone. Something else may be using it — " +
            "type the note instead.",

        // --- Mentions -------------------------------------------------------------------
        "thread.mentionTeammate" to "Mention a teammate",
        "thread.noMentionable" to "No teammates can see this conversation.",

        // --- Saved replies (#274 / #475) ----------------------------------------------
        "thread.templates" to "Templates",
        "thread.savedReplies" to "Saved replies",
        "thread.noTemplates" to
            "No saved replies yet. Create them on the web under Settings.",
        "thread.nothingMatches" to "Nothing matches.",
        "thread.templateHint" to
            "Type / in the composer to open these inline · shared with the crew",
        "thread.searchTemplates" to "Search templates…",
        "thread.insert" to "Insert",

        // --- Send later (#233 / #539) ---------------------------------------------------
        "thread.scheduledConfirm" to "Sending {when}.",
        "thread.next" to "Next",
        "thread.sendAt" to "Send at",
        "thread.schedule" to "Schedule",
        "thread.quietHoursTitle" to "That lands late where they are",
        "thread.scheduleAnyway" to "Schedule it anyway",
        "thread.pickAnotherTime" to "Pick another time",

        // --- Marking up a photo (#294) ---------------------------------------------------
        "thread.markupTitle" to "Point at something",
        "thread.workPhaseAria" to "What these photos show",

        // --- What a file is, in a chip or a bubble (#189) ---------------------------------
        "thread.mmsKindImage" to "Image",
        "thread.mmsKindAudio" to "Audio",
        "thread.mmsKindVideo" to "Video",
        "thread.mmsKindContact" to "Contact card",
        "thread.mmsKindCalendar" to "Calendar invite",
        "thread.mmsKindDocument" to "PDF",
        "thread.mmsKindText" to "Text file",
        "thread.mmsKindFile" to "File",

        // --- Starting a conversation (#183) ------------------------------------------------
        "thread.newTextTitle" to "New text",
        "thread.numberNotReady" to "Your number isn't ready yet.",
        "thread.numberNotReadyBody" to
            "You need an active number to start a conversation. Check the web " +
            "app for its status.",
        "thread.toLabel" to "To",
        "thread.messageLabel" to "Message",
        "thread.recipientPlaceholder" to "Name or phone number",
        "thread.clearRecipient" to "Clear recipient",
        "thread.nanpOnly" to "US and Canadian numbers only.",
        "thread.noContactMatch" to
            "No match in contacts. This starts a new conversation.",
        "thread.willText" to "Will text {number}",
        "thread.fromNumber" to "From: {number}",
        "thread.charactersWithMeter" to "{meter} · {count} characters",
        "thread.characters" to "{count} characters",
        "thread.consentAsked" to "This customer asked us to text them.",
        "thread.consentRecorded" to
            "Required for new contacts. Consent is recorded with your name.",
        "thread.sendText" to "Send text",
        "thread.lateThereTitle" to "It's late where they are",
        "thread.lateThereBody" to "It's {time} at this number. Send anyway?",
        "thread.lateThereUnknown" to "between 8pm and 8am",
        "thread.wait" to "Wait",
        "thread.theirTimeAskFirst" to
            "It's {time} for this customer. We'll ask before sending this late.",
        "thread.theirTime" to "It's {time} for them.",

        // --- The banner that stands in for the composer (#315/#363/#396/#423) ---
        //
        // Nine states, each a TITLE and a BODY. Web says each of these in one
        // line; a phone has room for both, and the title is what gets read at a
        // glance while the body is what somebody acts on. The tails these carry
        // and web's do not — "Internal notes still work" — are true only here,
        // where the note composer stays on screen underneath the banner.
        "thread.bannerOptedOutTitle" to "This customer opted out",
        "thread.bannerOptedOutCarrierBody" to
            "They texted STOP, so their carrier is blocking your texts. Only " +
            "they can undo it, by texting START to your number. Internal notes " +
            "still work.",
        "thread.bannerOptedOutManualBody" to
            "Someone marked them opted out. You can undo that on their contact. " +
            "Internal notes still work.",
        "thread.bannerReadOnlyTitle" to "You have view-only access",
        "thread.bannerReadOnlyBody" to
            "You can read this conversation but not reply or leave notes. An " +
            "owner or admin can change your access.",
        "thread.bannerNumberAccessTitle" to "You can't text from this number",
        "thread.bannerNumberAccessBody" to
            "You can read this conversation and add internal notes, but texting " +
            "this customer needs access an owner or admin grants. Calls to this " +
            "number won't ring you either. Ask them if you need it.",
        "thread.bannerSubscriptionTitle" to "Texting is paused",
        "thread.bannerSubscriptionBody" to
            "Your subscription isn't active, so outbound texts are blocked. An " +
            "owner can fix this in billing. Internal notes still work.",
        "thread.bannerRegistrationPendingTitle" to "US texting isn't approved yet",
        "thread.bannerRegistrationPendingBody" to
            "Carriers are still reviewing your registration. Texts to US numbers " +
            "will send once it's approved. Internal notes still work.",
        "thread.bannerUsTextingOffTitle" to "US texting isn't on for this workspace",
        "thread.bannerUsTextingOffBody" to
            "This is a US number, and texting US numbers is an add-on your " +
            "workspace hasn't turned on. An owner can add it in settings. Calls " +
            "to this customer still work, and internal notes still work.",
        "thread.bannerRegistrationSuspendedTitle" to "US texting is paused",
        "thread.bannerRegistrationSuspendedBody" to
            "The carrier paused your US registration, so texts to US numbers " +
            "won't send. We've been told and we're on it, and you'll get an " +
            "email when it's back. Canadian texts, calls and internal notes all " +
            "still work.",
        "thread.bannerUsageCapTitle" to "You've hit this month's cap",
        "thread.bannerUsageCapBody" to
            "Outbound texts pause until the cap is raised or the month rolls " +
            "over. Internal notes still work.",
        "thread.bannerOptOutHintTitle" to "They asked not to be contacted",
        "thread.bannerOptOutHintBody" to
            "Someone on this thread asked to be left alone. That request is " +
            "binding however it's worded, so don't reply unless you're sure it " +
            "wasn't one. To stop texts for good, they need to text STOP.",

        // --- Staging a photo or a file (#189 / #262 / D19) ---------------------
        // The file's name is INTERPOLATED rather than glued on the front: the
        // subject is not where every language starts its sentence.
        "thread.thatFile" to "That file",
        "thread.mmsUnsupportedFile" to
            "{name} isn't something a text can carry. Try a photo, video, " +
            "audio clip, contact card, or PDF.",
        "thread.mmsFileEmpty" to "{name} is empty.",
        "thread.mmsFileTooBig" to "{name} is over 1 MB, the most a text can carry.",
        "thread.photoReadFailed" to "Couldn't read that photo. Try attaching it again.",
        "thread.imageCantBeSent" to "That image can't be sent. Try a different photo.",
        "thread.fileReadFailedPick" to "Couldn't read that file. Try picking it again.",
        "thread.fileSizeReadFailed" to
            "Couldn't read that file's size. Try picking it again.",
        "thread.fileTypeBlocked" to
            "That file type isn't allowed. Images, PDFs, and documents only.",
        "thread.fileSizeLimit" to "Files can be up to 25 MB each.",

        // --- Merge fields (#274) ------------------------------------------------
        // `MergeFields.VARIABLES` carries these as KEYS rather than sentences:
        // the list is a mirror of packages/shared, read from a template editor
        // and from the composer's preview, and neither read is composable.
        "thread.mergeFirstName" to "The customer's first name",
        "thread.mergeAddress" to "The address on their contact",
        "thread.mergeJobDay" to "The day of their next booked visit",
        "thread.mergeJobTime" to "The time of it",
        "thread.mergeMyName" to "Your first name",
        "thread.mergeBusinessName" to "Your business name",
        "thread.mergeOurNumber" to "The number they reply to",
        "thread.serverOnlyTokensNote" to "The day and time fill in when you send.",

        // --- What the two multipart doors throw (D19 / #507) --------------------
        "thread.signedOut" to "You're signed out.",
        "thread.cantReachLoonext" to "Can't reach Loonext. Check your connection.",

        // --- Send later: whose clock (#233 / #539) ------------------------------
        // `{reassurance}`, `{clock}` and `{source}` are held by core/scheduled
        // and core/time, which are not this section's to translate — the
        // sentence around them is.
        "thread.sendLaterClock" to "Send later — {clock}",
        "thread.sendLaterWorkspaceClock" to "Send later — your workspace's time",
        "thread.quietHoursAround" to "That is around {hour} for this customer.",
        "thread.senderClockOwn" to "This is your own time. {reassurance}",
        "thread.senderClockApart" to
            "This is your own time, and they are {delta}. {reassurance}",
        "thread.clockSame" to "on the same clock",
        "thread.clockAnHourAhead" to "an hour ahead of you",
        "thread.clockAnHourBehind" to "an hour behind you",
        "thread.clockHoursAhead" to "{count} hours ahead of you",
        "thread.clockHoursBehind" to "{count} hours behind you",
        "thread.pickerThats" to "That's {time} {clock}",

        // --- The dictated wrap-up's refusals (#507 / #581) ----------------------
        "thread.wrapUpTooLong" to
            "That was longer than two minutes. Say the short version, or type the note.",
        "thread.wrapUpDisabled" to
            "Dictated wrap-ups are turned off for this workspace. Settings, AI " +
            "turns them back on.",
        "thread.louPausedForBilling" to
            "Lou is paused while the subscription is sorted out. An owner can " +
            "fix that in Billing.",
        "thread.wrapUpOverCap" to
            "This month's dictation is used up. It starts again next month — " +
            "type the note for now.",
        "thread.wrapUpUnreachable" to
            "Couldn't write that down just now. Try again, or type the note.",
        "thread.wrapUpUnusable" to
            "Couldn't make out any words. Try again somewhere quieter, or type the note.",
        "thread.wrapUpNoWords" to "Couldn't write that down. Type the note instead.",

        // --- The audio row (#272) -----------------------------------------------
        "thread.audioMessage" to "Audio message",
        "thread.audioUnavailable" to "Audio unavailable · tap to retry",

        // --- Quoting the source message (#214) ----------------------------------
        // Its own key because the quotation MARKS belong to a language rather
        // than to a layout: French sets a quotation in guillemets, with spaces.
        "thread.quoted" to "“{text}”",

        // --- Somebody already answered (#408) -----------------------------------
        "thread.duplicateReplyNamed" to "{name} replied {ago}.",
        "thread.duplicateReplyAuto" to "An automatic reply went out {ago}.",
        "thread.agoJustNow" to "just now",
        "thread.agoOneMinute" to "1 minute ago",
        "thread.agoMinutes" to "{count} minutes ago",
        "thread.agoOneHour" to "1 hour ago",
        "thread.agoHours" to "{count} hours ago",
        "thread.agoSinceWriting" to "since you started writing",

        // --- The destination clock (#225 / D49 / #539) --------------------------
        "thread.theirTimeAbout" to "It's about {time} where they are ({source}).",
        "thread.clockFromContact" to "set on their contact",
        "thread.clockFromAreaCode" to "from their area code",
        "thread.clockFromWorkspace" to
            "your workspace's timezone — we don't know theirs",

        // --- The durable outbox (#234) ------------------------------------------
        "thread.outboxStale" to
            "Queued for over a day. The conversation may have moved on — send " +
            "it now, or delete it.",
        "thread.outboxMediaLost" to
            "The photo for this message is no longer on this device. Send the " +
            "text on its own, or delete it.",

        // --- What the thread says back ------------------------------------------
        "thread.noteFilesAllFailed" to "The note saved, but its files didn't upload.",
        "thread.noteFilesSomeFailed" to
            "The note saved, but {failed} of {total} files didn't upload.",
        "thread.taskCreated" to "Task created.",
        "thread.alreadyHasTask" to "This message already has a task.",
        "thread.markedAsSpam" to "Marked as spam.",
        "thread.markedAsNotSpam" to "Marked as not spam. It stays closed.",
        "thread.spamCleared" to "Thanks. We won't flag this one.",
        "thread.snoozeLeadRemind" to "I'll remind you — back",
        "thread.snoozeLeadSnoozed" to "Snoozed — back",
        "thread.reminderCancelled" to "Reminder cancelled.",
        "thread.backInYourInbox" to "Back in your inbox.",
        "thread.undo" to "Undo",

        // --- Asking for money, said back (#224 / #607) --------------------------
        "thread.askedFor" to "Asked for {amount}.",
        "thread.paymentCalledOff" to "Called off. You can ask again any time.",

        // --- The catch-up card's carrier note (#247 / #407) ---------------------
        "thread.summaryOptOutCarrier" to
            "They texted STOP, so their carrier is blocking your texts. Only " +
            "they can undo it.",
        "thread.summaryOptOutManual" to
            "Someone marked this customer opted out, so texts are blocked. " +
            "Internal notes still work.",
        "thread.summaryOptOutHint" to
            "Someone on this thread asked to be left alone. That request is " +
            "binding however it's worded.",

        // --- The timeline's audit lines (Timeline.kt `eventLine`) ---------------
        //
        // Every actor is INTERPOLATED rather than concatenated, for the reason
        // web's catalogue states next to the same lines: `{by}` at the front of
        // an English sentence is not where every language puts its subject, and
        // a catalogue that hands the translator "closed this conversation" with
        // the name glued on outside cannot be translated at all.
        "thread.sysSomeone" to "Someone",
        "thread.sysATeammate" to "a teammate",
        "thread.sysMovedTo" to "{by} moved this to {status}",
        "thread.sysStatusChanged" to "{by} changed the status",
        "thread.sysUnassigned" to "{by} unassigned this conversation",
        "thread.sysAssignedTo" to "{by} assigned this to {name}",
        "thread.sysTagAdded" to "{by} added the tag \"{name}\"",
        "thread.sysTagAddedGeneric" to "{by} added a tag",
        "thread.sysTagRemoved" to "{by} removed a tag",
        "thread.sysOptedOutSystem" to "{name} opted out of texts",
        "thread.sysOptedOutBy" to "{by} opted {name} out",
        "thread.sysOptedInSystem" to "{name} opted back in",
        "thread.sysOptOutRevoked" to "{by} removed the opt-out",
        "thread.sysConsentAttested" to "{by} attested consent to text {name}",
        "thread.sysQuietHours" to "{by} sent during this customer's quiet hours",
        // #237/#313: the actor is the CUSTOMER, who has no user row, so these
        // two carry no name — crediting the crew with the customer's answer is
        // the defect they were written to avoid.
        "thread.sysAppointmentConfirmed" to "They confirmed the appointment",
        "thread.sysJobRated" to "They rated the job {score} out of 5",
        "thread.sysSpamMarked" to "{by} marked this as spam",
        "thread.sysSpamUnmarked" to "{by} marked this as not spam",
        "thread.sysMessageDone" to "{by} marked a message done",
        "thread.sysMessageUndone" to "{by} reopened a message",
        "thread.sysTaskCreated" to "{by} created a task",
        "thread.sysTaskAssigned" to "{by} assigned a task",
        "thread.sysTaskDueSet" to "{by} set a task due date",
        "thread.sysTaskDeleted" to "{by} deleted a task",
        "thread.sysNoteAttachmentAdded" to "{by} attached a file to a note",
        "thread.sysNoteAttachmentRemoved" to "{by} removed a file from a note",
        "thread.sysTaskAttachmentAdded" to "{by} attached a file to a task",
        "thread.sysTaskAttachmentRemoved" to "{by} removed a file from a task",
        "thread.sysMissedCallFrom" to "Missed call from {name}",
        "thread.sysAutoReplySent" to "Away auto-reply sent",

        // #607 A3 — the five money lines, in the strip's vocabulary rather than
        // a second glossary for it. Asked and cancelled are things a crew member
        // does, so those carry `{by}`; paid, refunded and disputed are the
        // customer and their bank, whom the server writes with a null actor.
        "thread.sysPaymentRequested" to "{by} asked for {amount}",
        "thread.sysPaymentRequestedGeneric" to "{by} asked for a payment",
        "thread.sysPaymentCancelled" to "{by} called off the {amount} request",
        "thread.sysPaymentCancelledGeneric" to "{by} called off the request",
        "thread.sysPaymentPaid" to "They paid {amount}",
        "thread.sysPaymentPaidGeneric" to "They paid",
        "thread.sysPaymentRefunded" to "{amount} went back to them",
        "thread.sysPaymentRefundedGeneric" to "The money went back to them",
        "thread.sysPaymentDisputed" to "Their bank pulled back {amount}",
        "thread.sysPaymentDisputedGeneric" to "Their bank pulled this payment back",
        "thread.sysPaymentWithDescription" to "{line} — {description}",

        /*
         * #317 — THE SEVEN REFUSAL SENTENCES. LOAD-BEARING FOR THREE CLIENTS.
         *
         * `apps/web/src/components/thread/media-refused-parity.test.ts` compares
         * these to web's and iOS's with a verbatim `includes`, and it reads THIS
         * file for Android since the copy moved out of `Timeline.kt` — the same
         * redirection web's own entry needed when its sentences left
         * `system-line.tsx`. A `"…" + "…"` wrap, which reads better and which
         * this file uses everywhere else, would split the sentence in the source
         * and the guard would report Android as the client that reworded it. So
         * these seven stay long, deliberately.
         */
        "thread.sysMediaTooLarge" to
            "A file this customer sent was too big to save — ask them to send a smaller one",
        "thread.sysMediaEmpty" to
            "A file this customer sent arrived empty — ask them to send it again",
        "thread.sysMediaTypeMismatch" to
            "A file this customer sent wasn't the kind of file it claimed to be, so it wasn't saved",
        "thread.sysMediaUnsafe" to
            "A file this customer sent had something unsafe inside it, so it wasn't saved — ask them for a photo or a plain PDF",
        "thread.sysMediaUnreadable" to
            "A file this customer sent couldn't be checked, so it wasn't saved — ask them to send it again",
        "thread.sysMediaTooManyKept" to
            "This message came with more files than we can save — the first {kept} were kept",
        "thread.sysMediaTooMany" to
            "This message came with more files than we can save",
        "thread.sysMediaUnsupported" to
            "A file this customer sent can't be shown here — ask them to send a photo or a PDF",

        // #273/#517 — one call event, six honest readings.
        "thread.sysCalledNoAnswer" to "Called, no answer",
        "thread.sysYouCalled" to "You called",
        "thread.sysTransferredBy" to "{from} transferred the call to {to}",
        "thread.sysTransferredTo" to "Call transferred to {to}",
        "thread.sysTransferred" to "Call transferred",
        "thread.sysLeftVoicemail" to "Left a voicemail",
        "thread.sysWentToVoicemail" to "Call went to voicemail",
        "thread.sysMissedCall" to "Missed call",
        "thread.sysAnsweredBy" to "Call answered by {name}",
        "thread.sysAnswered" to "Call answered",
        "thread.sysWithDuration" to "{line} · {duration}",
    )

    override val frCA = mapOf(
        // #287 — the quote strip. Lifted verbatim from web's catalogue so
        // the clients say one thing; pinned by QuoteCopyParityTest.
        "quotes.statusDraft" to
            "Brouillon",
        "quotes.statusSent" to
            "En attente",
        "quotes.statusViewed" to
            "Ouvert, sans réponse",
        "quotes.statusAccepted" to
            "Accepté",
        "quotes.statusDeclined" to
            "Refusé",
        "quotes.statusExpired" to
            "Expiré",
        "quotes.newQuote" to
            "Faire un devis",
        "quotes.sendFor" to
            "Envoyer pour {amount}",
        "quotes.sending" to
            "Envoi…",
        "quotes.saveDraft" to
            "Enregistrer le brouillon",
        "quotes.saving" to
            "Enregistrement…",
        "quotes.amountLabel" to
            "Montant",
        "quotes.descriptionLabel" to
            "En quoi consistent les travaux",
        "quotes.expiresInDays" to
            "Le prix tient pendant {days} jours. Vous pouvez l'envoyer dès qu'il est enregistré.",
        "quotes.needAmount" to
            "Inscrivez un montant supérieur à zéro.",
        "quotes.needDescription" to
            "Précisez les travaux. Le client voit cette ligne.",
        // --- The thread itself -------------------------------------------
        "thread.notFound" to "Cette conversation n'existe pas ou a été supprimée.",
        "thread.backToInbox" to "Retour à la boîte de réception",
        "thread.noMessages" to "Aucun message pour l'instant.",
        "thread.newMessagePill" to "Nouveau message",
        "thread.copied" to "Copié.",
        "thread.more" to "Plus",
        "thread.callContact" to "Appeler {name}",
        "thread.optedOut" to "Désabonné",
        "thread.contactFallback" to "Contact",
        "thread.conversationFallback" to "Conversation",
        "thread.viewContact" to "Voir le contact",
        "thread.photo" to "Photo",
        "thread.file" to "Fichier",
        "thread.teammate" to "Collègue",
        "thread.you" to "Vous",
        "thread.youSuffix" to " (vous)",
        "thread.selected" to "Sélectionné",
        "thread.micNeededForCalls" to
            "Loonext a besoin du micro pour passer des appels. " +
            "Autorisez-le dans Paramètres › Applis › Loonext › Autorisations.",

        // --- Status ------------------------------------------------------
        "thread.statusHeading" to "STATUT",
        "thread.statusNew" to "Nouveau",
        "thread.statusOpen" to "Ouvert",
        "thread.statusWaiting" to "En attente",
        "thread.statusClosed" to "Fermé",

        // --- Day dividers -------------------------------------------------
        "thread.dayToday" to "Aujourd'hui",
        "thread.dayYesterday" to "Hier",

        // --- Queued sends (#234) -------------------------------------------
        "thread.deleteQueuedTitle" to "Supprimer ce message ?",
        "thread.deleteQueuedBody" to
            "Il n'a pas été envoyé, et le supprimer ici efface la seule copie.",
        "thread.keepIt" to "Le garder",
        "thread.queuedOffline" to
            "En file d'attente — s'enverra dès votre retour en ligne",
        "thread.sending" to "Envoi…",
        "thread.sent" to "Envoyé",
        "thread.delivered" to "Livré",
        "thread.sendNow" to "Envoyer maintenant",
        "thread.retry" to "Réessayer",
        "thread.oneAttachment" to "1 pièce jointe",
        "thread.manyAttachments" to "{count} pièces jointes",

        // --- Tags ----------------------------------------------------------
        "thread.tags" to "Étiquettes",
        "thread.addTag" to "Ajouter une étiquette",
        "thread.removeTag" to "Retirer l'étiquette {name}",
        "thread.addOrCreateTag" to "Ajouter ou créer une étiquette",
        "thread.findTag" to "Trouver une étiquette",
        "thread.create" to "Créer",
        "thread.add" to "Ajouter",
        "thread.didYouMean" to "Vouliez-vous dire « {name} » ?",
        "thread.tagsLocked" to
            "Aucune étiquette de ce nom. Demandez à un administrateur de " +
            "l'ajouter — cet espace de travail garde une liste fixe.",
        "thread.noTagsCreate" to
            "Aucune étiquette pour l'instant. Créez la première ci-dessus.",
        "thread.noTagsAdmin" to
            "Aucune étiquette pour l'instant. Un administrateur ajoute la première.",
        "thread.attached" to "Attachée",

        // --- Opt-out (#407) --------------------------------------------------
        "thread.optOutTitle" to "Désabonner ce client ?",
        "thread.optOutBody" to
            "Il ne recevra plus vos textos tant que le désabonnement n'est pas " +
            "retiré. C'est inscrit dans l'historique de la conversation.",
        "thread.optOut" to "Désabonner",
        "thread.optOutOfTexts" to "Désabonner des textos",
        "thread.revokeTitle" to "Retirer le désabonnement ?",
        "thread.revokeBody" to
            "Vous pourrez de nouveau texter ce client. Ne faites ceci que s'il " +
            "a demandé à recevoir vos messages.",
        "thread.removeOptOut" to "Retirer le désabonnement",
        "thread.carrierStopNote" to
            "Ce client a texté STOP. Lui seul peut annuler cela, en textant " +
            "START à votre numéro.",

        // --- Assignment ------------------------------------------------------
        "thread.assignTo" to "Assigner à",
        "thread.assignToEllipsis" to "Assigner à…",
        "thread.assignedTo" to "Assignée à {name}",
        "thread.unassigned" to "Non assignée",

        // --- Spam (#250) -----------------------------------------------------
        "thread.spam" to "Pourriel",
        "thread.spamTitle" to "Ceci ressemble à un pourriel",
        "thread.notSpam" to "Pas un pourriel",
        "thread.spamBody" to
            "Nous n'avons pas envoyé de notification. Rien n'est caché, et vous " +
            "pouvez répondre normalement.",

        // --- Snooze (#293) ----------------------------------------------------
        "thread.bringBack" to "Ramener",
        "thread.bringBackNow" to "Ramener maintenant",
        "thread.cancelReminder" to "Annuler le rappel",
        "thread.snoozeUntil" to "Reporter jusqu'à",
        "thread.remindMeToChase" to "Me rappeler de relancer",
        "thread.pickADate" to "Choisir une date…",
        "thread.remindMe" to "Me rappeler",
        "thread.snooze" to "Reporter",
        "thread.whyOptional" to "Pourquoi ? (facultatif)",

        // --- Pinned ------------------------------------------------------------
        "thread.pinned" to "Épinglé",
        "thread.pinnedCount" to "Épinglés · {count}",
        "thread.collapse" to "Réduire",
        "thread.expand" to "Développer",

        // --- Timeline visibility -------------------------------------------------
        "thread.showMessages" to "Afficher les textos",
        "thread.showNotes" to "Afficher les notes",
        "thread.showEvents" to "Afficher les évènements",

        // --- Message bubbles + long-press actions ---------------------------------
        "thread.internalNote" to "Note interne",
        "thread.noteOnTask" to "sur : {title}",
        "thread.openTask" to "Ouvrir la tâche",
        "thread.hasTask" to "A une tâche",
        "thread.openTheTask" to "Ouvrir la tâche",
        "thread.goToMessage" to "Aller à ce message",
        "thread.photoUnavailable" to "Photo indisponible · touchez pour réessayer",
        "thread.copyText" to "Copier le texte",
        "thread.done" to "Fait",
        "thread.retrySend" to "Renvoyer",
        "thread.makeTask" to "Créer une tâche",

        // --- Make a task (#214) ------------------------------------------------
        "thread.newTask" to "Nouvelle tâche",
        "thread.newTaskFrom" to
            "Depuis le message de {name} · publié dans la conversation",
        "thread.taskTitle" to "Titre",
        "thread.taskTitleFallback" to "Faire un suivi",
        "thread.due" to "Échéance",
        "thread.dueToday" to "Aujourd'hui",
        "thread.dueTomorrow9" to "Demain 9 h",
        "thread.pickATime" to "Choisir une heure…",
        "thread.createTask" to "Créer la tâche",
        "thread.setDueDate" to "Fixer l'échéance",
        "thread.nobodyYet" to "Personne encore",
        "thread.suggested" to "Suggéré",
        "thread.addressSection" to "Adresse",
        "thread.clear" to "Effacer",
        "thread.showAddress" to "Afficher l'adresse",
        "thread.hideAddress" to "Masquer l'adresse",
        "thread.addrStreet" to "Rue",
        "thread.addrUnit" to "Unité / suite",
        "thread.addrCity" to "Ville",
        "thread.addrState" to "Province / État",
        "thread.addrPostal" to "Code postal",

        // --- Contact panel (#165 / #301) -----------------------------------------
        "thread.openFullContact" to "Ouvrir la fiche complète",
        "thread.sectionDetails" to "Coordonnées",
        "thread.sectionConsent" to "Consentement",
        "thread.sectionLeadSource" to "D'où il vient",
        "thread.sectionTasks" to "Tâches de cette conversation",
        "thread.sectionOtherConversations" to "Autres conversations",
        "thread.fieldName" to "Nom",
        "thread.addName" to "Ajouter un nom",
        "thread.fieldAddress" to "Adresse",
        "thread.addAddress" to "Ajouter une adresse",
        "thread.fieldNotes" to "Notes",
        "thread.notesPlaceholder" to
            "Code de barrière, nom du chien, heure d'arrivée préférée…",
        "thread.leadFromLine" to "{name} · la ligne qu'il a appelée",
        "thread.leadSaidSo" to "{name} · quelqu'un l'a indiqué",
        "thread.leadAsk" to "Demandez-lui : comment nous avez-vous connus ?",
        "thread.dontKnow" to "Je ne sais pas",
        "thread.tasksLoadFailed" to
            "Impossible de charger les tâches de cette conversation.",
        "thread.noTasks" to "Aucune tâche dans cette conversation.",
        "thread.priorLoadFailed" to
            "Impossible de charger les conversations précédentes.",
        "thread.noOtherConversations" to "Aucune autre conversation avec ce client.",

        // --- The catch-up card (#247) ----------------------------------------------
        "thread.summaryReading" to "Lecture de la conversation…",
        "thread.summaryReady" to "Le résumé de Lou",
        "thread.summaryRetry" to "Réessayer le résumé",
        "thread.summaryOffer" to "Faites-moi un résumé",
        "thread.summaryTruncated" to
            "La conversation est plus longue que ceci — Lou a lu la partie la " +
            "plus récente.",
        "thread.summaryLineAria" to "{text}. Ouvrir le message d'où ceci provient.",

        // --- Scheduled strip (#233) ---------------------------------------------
        "thread.scheduledWaiting" to "En attente",
        "thread.cancelScheduledAria" to "Annuler le message prévu pour {when}",

        // --- Asking for payment (#224), the parts payments.* does not carry --------
        "thread.askAmountLabel" to "Montant en {currency}",
        "thread.askDefaultDescription" to "Acompte",
        "thread.yourBusiness" to "Votre entreprise",
        "thread.askFootnote" to
            "Part sous forme de texto avec un lien de paiement sécurisé. " +
            "L'argent arrive dans votre compte bancaire — nous ne prenons rien " +
            "de plus.",

        // --- Photos & files (#165 / #317) ------------------------------------------
        "thread.photosAndFiles" to "Photos et fichiers",
        "thread.backToConversation" to "Retour à la conversation",
        "thread.galleryImages" to "Images",
        "thread.galleryFiles" to "Fichiers",
        "thread.noPhotosLoaded" to "Aucune photo chargée pour l'instant.",
        "thread.noPhotosYet" to "Aucune photo dans cette conversation.",
        "thread.noFilesLoaded" to "Aucun fichier chargé pour l'instant.",
        "thread.noFilesYet" to "Aucun fichier dans cette conversation.",
        "thread.loadMore" to "Charger plus",
        "thread.noAppForFile" to
            "Aucune application sur cet appareil ne peut ouvrir ce fichier.",
        "thread.fileActions" to "Actions pour {name}",
        "thread.reportThisFile" to "Signaler ce fichier",
        "thread.reportPhotoAction" to "Signaler cette photo",
        "thread.reportFileTitle" to "Signaler ce fichier ?",
        "thread.reportFileBody" to
            "Personne dans votre équipe ne pourra ouvrir {name} tant qu'un " +
            "propriétaire ou un administrateur ne l'aura pas débloqué. Rien " +
            "n'est supprimé.",
        "thread.reporting" to "Signalement…",
        "thread.reportFile" to "Signaler le fichier",
        "thread.reportFileFailed" to
            "Impossible de signaler ce fichier. Réessayez.",
        "thread.playAudio" to "Écouter le message vocal",
        "thread.pauseAudio" to "Mettre le message vocal en pause",

        // --- The composer ------------------------------------------------------------
        "thread.modeText" to "Texto",
        "thread.modeNote" to "Note",
        "thread.textPlaceholder" to "Texto",
        "thread.notePlaceholder" to "Écrire une note interne…",
        "thread.addToMessage" to "Ajouter au message",
        "thread.attachFiles" to "Joindre des fichiers",
        "thread.attachFilesToNote" to "Joindre des fichiers à cette note",
        "thread.savedReply" to "Réponse enregistrée",
        "thread.sendLater" to "Envoyer plus tard",
        "thread.sendMessage" to "Envoyer le message",
        "thread.saveNote" to "Enregistrer la note",
        "thread.attachedPhoto" to "Photo jointe",
        "thread.removePhoto" to "Retirer la photo",
        "thread.removeNamed" to "Retirer {name}",
        "thread.attachLimitText" to
            "Vous pouvez joindre jusqu'à {max} fichiers par texto.",
        "thread.attachLimitNote" to
            "Une note peut porter jusqu'à 10 fichiers.",
        "thread.sendsAs" to "S'envoie ainsi : ",
        "thread.mmsSegments" to "MMS · envoyé en {count} parties",
        "thread.sentInOnePart" to "Envoyé en 1 partie",
        "thread.sentInParts" to "Envoyé en {count} parties",
        "thread.callThemInstead" to "Appelez-le plutôt",
        "thread.reportThis" to "Signaler ceci",

        // --- The send boundary (#408) ---------------------------------------------
        "thread.collisionTitle" to "Quelqu'un a déjà répondu",
        "thread.collisionAsk" to " Envoyer le vôtre quand même ?",
        "thread.sendAnyway" to "Envoyer quand même",
        "thread.letMeLook" to "Laissez-moi voir",

        // --- Lou in the composer ----------------------------------------------------
        "thread.draftWithLou" to "Rédiger avec Lou",
        "thread.finishWithLou" to "Terminer avec Lou",
        "thread.drafting" to "Rédaction…",
        "thread.lousDrafts" to "Les brouillons de Lou",
        "thread.dismiss" to "Fermer",
        "thread.louNeedsBusiness" to
            "Lou ne sait pas encore ce que vous faites. Dites-le-lui, et les " +
            "brouillons deviendront précis.",

        // --- The dictated wrap-up (#507) ----------------------------------------------
        "thread.holdToDictate" to "Maintenez pour dire de quoi parlait l'appel",
        "thread.wrapUpRecording" to
            "Dites de quoi parlait l'appel — {elapsed}. Relâchez quand vous " +
            "avez terminé.",
        "thread.wrapUpWriting" to "Transcription de vos mots…",
        "thread.wrapUpLost" to
            "Cet enregistrement a été perdu — autre chose a peut-être pris le " +
            "micro. Réessayez, ou tapez la note.",
        "thread.micAllowed" to
            "Micro autorisé. Maintenez-le et dites de quoi parlait l'appel.",
        "thread.micDeniedWrapUp" to
            "Loonext a besoin du micro pour transcrire un compte rendu parlé. " +
            "Tapez la note, ou autorisez-le dans Paramètres › Applis › Loonext " +
            "› Autorisations.",
        "thread.micStartFailed" to
            "Impossible de démarrer le micro. Autre chose l'utilise peut-être — " +
            "tapez la note.",

        // --- Mentions -------------------------------------------------------------------
        "thread.mentionTeammate" to "Mentionner un collègue",
        "thread.noMentionable" to "Personne de l'équipe ne voit cette conversation.",

        // --- Saved replies (#274 / #475) ----------------------------------------------
        "thread.templates" to "Modèles",
        "thread.savedReplies" to "Réponses enregistrées",
        "thread.noTemplates" to
            "Aucune réponse enregistrée. Créez-les sur le web dans Paramètres.",
        "thread.nothingMatches" to "Aucun résultat.",
        "thread.templateHint" to
            "Tapez / dans la zone de rédaction pour les ouvrir · partagées avec " +
            "l'équipe",
        "thread.searchTemplates" to "Rechercher des modèles…",
        "thread.insert" to "Insérer",

        // --- Send later (#233 / #539) ---------------------------------------------------
        "thread.scheduledConfirm" to "Envoi {when}.",
        "thread.next" to "Suivant",
        "thread.sendAt" to "Envoyer à",
        "thread.schedule" to "Programmer",
        "thread.quietHoursTitle" to "Ça arrive tard chez lui",
        "thread.scheduleAnyway" to "Programmer quand même",
        "thread.pickAnotherTime" to "Choisir une autre heure",

        // --- Marking up a photo (#294) ---------------------------------------------------
        "thread.markupTitle" to "Pointer quelque chose",
        "thread.workPhaseAria" to "Ce que montrent ces photos",

        // --- What a file is, in a chip or a bubble (#189) ---------------------------------
        "thread.mmsKindImage" to "Image",
        "thread.mmsKindAudio" to "Audio",
        "thread.mmsKindVideo" to "Vidéo",
        "thread.mmsKindContact" to "Fiche de contact",
        "thread.mmsKindCalendar" to "Invitation d'agenda",
        "thread.mmsKindDocument" to "PDF",
        "thread.mmsKindText" to "Fichier texte",
        "thread.mmsKindFile" to "Fichier",

        // --- Starting a conversation (#183) ------------------------------------------------
        "thread.newTextTitle" to "Nouveau texto",
        "thread.numberNotReady" to "Votre numéro n'est pas encore prêt.",
        "thread.numberNotReadyBody" to
            "Il vous faut un numéro actif pour démarrer une conversation. " +
            "Vérifiez son état dans l'application web.",
        "thread.toLabel" to "À",
        "thread.messageLabel" to "Message",
        "thread.recipientPlaceholder" to "Nom ou numéro de téléphone",
        "thread.clearRecipient" to "Effacer le destinataire",
        "thread.nanpOnly" to "Numéros américains et canadiens seulement.",
        "thread.noContactMatch" to
            "Aucune correspondance dans les contacts. Ceci démarre une nouvelle " +
            "conversation.",
        "thread.willText" to "Textera {number}",
        "thread.fromNumber" to "De : {number}",
        "thread.charactersWithMeter" to "{meter} · {count} caractères",
        "thread.characters" to "{count} caractères",
        "thread.consentAsked" to "Ce client nous a demandé de le texter.",
        "thread.consentRecorded" to
            "Requis pour les nouveaux contacts. Le consentement est inscrit à " +
            "votre nom.",
        "thread.sendText" to "Envoyer le texto",
        "thread.lateThereTitle" to "Il est tard chez lui",
        "thread.lateThereBody" to "Il est {time} à ce numéro. Envoyer quand même ?",
        "thread.lateThereUnknown" to "entre 20 h et 8 h",
        "thread.wait" to "Attendre",
        "thread.theirTimeAskFirst" to
            "Il est {time} chez ce client. Nous demanderons avant d'envoyer si tard.",
        "thread.theirTime" to "Il est {time} chez lui.",

        // --- The banner that stands in for the composer -------------------------
        // Copied from web's `sections/thread.ts` sentence by sentence wherever
        // the two clients say the same thing — « désabonné », « espace de
        // travail », « fournisseur », « les textos vers les États-Unis ». The
        // opt-out hint below is web's `bannerOptOutHint`, word for word.
        "thread.bannerOptedOutTitle" to "Ce client s'est désabonné",
        "thread.bannerOptedOutCarrierBody" to
            "Il a texté STOP : son fournisseur bloque vos textos. Lui seul peut " +
            "annuler ce blocage, en textant START à votre numéro. Les notes " +
            "internes fonctionnent toujours.",
        "thread.bannerOptedOutManualBody" to
            "Quelqu'un l'a marqué comme désabonné. Vous pouvez annuler cela dans " +
            "sa fiche de contact. Les notes internes fonctionnent toujours.",
        "thread.bannerReadOnlyTitle" to "Vous avez un accès en lecture seule",
        "thread.bannerReadOnlyBody" to
            "Vous pouvez lire cette conversation, mais pas répondre ni laisser " +
            "de notes. Un propriétaire ou un administrateur peut modifier votre " +
            "accès.",
        "thread.bannerNumberAccessTitle" to "Vous ne pouvez pas texter depuis ce numéro",
        "thread.bannerNumberAccessBody" to
            "Vous pouvez lire cette conversation et ajouter des notes internes, " +
            "mais texter ce client exige un accès qu'un propriétaire ou un " +
            "administrateur accorde. Les appels vers ce numéro ne vous joindront " +
            "pas non plus. Demandez-le-leur si vous en avez besoin.",
        "thread.bannerSubscriptionTitle" to "Les textos sont en pause",
        "thread.bannerSubscriptionBody" to
            "Votre abonnement n'est pas actif : les textos sortants sont bloqués. " +
            "Un propriétaire peut corriger cela dans la facturation. Les notes " +
            "internes fonctionnent toujours.",
        "thread.bannerRegistrationPendingTitle" to
            "Les textos vers les États-Unis ne sont pas encore approuvés",
        "thread.bannerRegistrationPendingBody" to
            "Les fournisseurs examinent encore votre inscription. Les textos vers " +
            "les numéros américains partiront dès son approbation. Les notes " +
            "internes fonctionnent toujours.",
        "thread.bannerUsTextingOffTitle" to
            "Les textos vers les États-Unis ne sont pas activés pour cet espace de travail",
        "thread.bannerUsTextingOffBody" to
            "Ceci est un numéro américain, et texter les numéros américains est " +
            "une option que votre espace de travail n'a pas activée. Un " +
            "propriétaire peut l'ajouter dans les paramètres. Les appels vers ce " +
            "client fonctionnent toujours, et les notes internes aussi.",
        "thread.bannerRegistrationSuspendedTitle" to
            "Les textos vers les États-Unis sont en pause",
        "thread.bannerRegistrationSuspendedBody" to
            "Le fournisseur a suspendu votre inscription américaine : les textos " +
            "vers les numéros américains ne partiront pas. Nous avons été avisés " +
            "et nous nous en occupons, et vous recevrez un courriel dès le " +
            "rétablissement. Les textos canadiens, les appels et les notes " +
            "internes fonctionnent toujours.",
        "thread.bannerUsageCapTitle" to "Vous avez atteint le plafond du mois",
        "thread.bannerUsageCapBody" to
            "Les textos sortants sont en pause jusqu'à ce que le plafond soit " +
            "relevé ou que le mois change. Les notes internes fonctionnent " +
            "toujours.",
        "thread.bannerOptOutHintTitle" to "Il a demandé à ne plus être contacté",
        "thread.bannerOptOutHintBody" to
            "Quelqu'un dans cette conversation a demandé à ne plus être contacté. " +
            "Cette demande est contraignante, peu importe la formulation : ne " +
            "répondez pas à moins d'être certain qu'il ne s'agissait pas de cela. " +
            "Pour arrêter les textos définitivement, le client doit texter STOP.",

        // --- Staging a photo or a file -------------------------------------------
        "thread.thatFile" to "Ce fichier",
        "thread.mmsUnsupportedFile" to
            "{name} n'est pas quelque chose qu'un texto peut transporter. Essayez " +
            "une photo, une vidéo, un clip audio, une fiche de contact ou un PDF.",
        "thread.mmsFileEmpty" to "{name} est vide.",
        "thread.mmsFileTooBig" to
            "{name} dépasse 1 Mo, le maximum qu'un texto peut transporter.",
        "thread.photoReadFailed" to
            "Impossible de lire cette photo. Joignez-la de nouveau.",
        "thread.imageCantBeSent" to
            "Cette image ne peut pas être envoyée. Essayez une autre photo.",
        "thread.fileReadFailedPick" to
            "Impossible de lire ce fichier. Choisissez-le de nouveau.",
        "thread.fileSizeReadFailed" to
            "Impossible de lire la taille de ce fichier. Choisissez-le de nouveau.",
        // Web's `attachmentTypeBlocked`, character for character.
        "thread.fileTypeBlocked" to
            "Ce type de fichier n'est pas autorisé. Images, PDF et documents seulement.",
        "thread.fileSizeLimit" to "Les fichiers peuvent atteindre 25 Mo chacun.",

        // --- Merge fields ---------------------------------------------------------
        "thread.mergeFirstName" to "Le prénom du client",
        "thread.mergeAddress" to "L'adresse inscrite à sa fiche de contact",
        "thread.mergeJobDay" to "Le jour de sa prochaine visite prévue",
        "thread.mergeJobTime" to "L'heure de celle-ci",
        "thread.mergeMyName" to "Votre prénom",
        "thread.mergeBusinessName" to "Le nom de votre entreprise",
        "thread.mergeOurNumber" to "Le numéro auquel il répond",
        "thread.serverOnlyTokensNote" to
            "Le jour et l'heure se remplissent à l'envoi.",

        // --- What the two multipart doors throw ------------------------------------
        "thread.signedOut" to "Vous êtes déconnecté.",
        "thread.cantReachLoonext" to
            "Impossible de joindre Loonext. Vérifiez votre connexion.",

        // --- Send later: whose clock ------------------------------------------------
        "thread.sendLaterClock" to "Envoyer plus tard — {clock}",
        "thread.sendLaterWorkspaceClock" to
            "Envoyer plus tard — l'heure de votre espace de travail",
        // Web's `quietHoursAround`, character for character.
        "thread.quietHoursAround" to "Il sera environ {hour} chez ce client.",
        "thread.senderClockOwn" to "Ceci est votre propre heure. {reassurance}",
        "thread.senderClockApart" to
            "Ceci est votre propre heure, et le client est {delta}. {reassurance}",
        "thread.clockSame" to "à la même heure que vous",
        "thread.clockAnHourAhead" to "une heure en avance sur vous",
        "thread.clockAnHourBehind" to "une heure en retard sur vous",
        "thread.clockHoursAhead" to "{count} heures en avance sur vous",
        "thread.clockHoursBehind" to "{count} heures en retard sur vous",
        "thread.pickerThats" to "C'est {time} {clock}",

        // --- The dictated wrap-up's refusals ----------------------------------------
        "thread.wrapUpTooLong" to
            "C'était plus long que deux minutes. Dites la version courte, ou " +
            "tapez la note.",
        "thread.wrapUpDisabled" to
            "La dictée des comptes rendus est désactivée pour cet espace de " +
            "travail. Paramètres, IA permet de la réactiver.",
        // Web's `louPausedForBilling`, character for character — the same
        // sentence everywhere Lou refuses for this reason (#581).
        "thread.louPausedForBilling" to
            "Lou est en pause le temps de régler l'abonnement. Un propriétaire " +
            "peut corriger cela dans Facturation.",
        // Web's `wrapUpOverCap`, character for character.
        "thread.wrapUpOverCap" to
            "La dictée de ce mois-ci est épuisée. Elle reprend le mois prochain — " +
            "tapez la note pour l'instant.",
        "thread.wrapUpUnreachable" to
            "Impossible de transcrire cela pour l'instant. Réessayez, ou tapez " +
            "la note.",
        "thread.wrapUpUnusable" to
            "Impossible de distinguer des mots. Réessayez dans un endroit plus " +
            "calme, ou tapez la note.",
        "thread.wrapUpNoWords" to
            "Impossible de transcrire cela. Tapez la note à la place.",

        // --- The audio row -----------------------------------------------------------
        "thread.audioMessage" to "Message audio",
        "thread.audioUnavailable" to "Audio indisponible · touchez pour réessayer",

        // --- Quoting the source message ------------------------------------------------
        "thread.quoted" to "« {text} »",

        // --- Somebody already answered ---------------------------------------------------
        "thread.duplicateReplyNamed" to "{name} a répondu {ago}.",
        "thread.duplicateReplyAuto" to "Une réponse automatique est partie {ago}.",
        "thread.agoJustNow" to "à l'instant",
        "thread.agoOneMinute" to "il y a 1 minute",
        "thread.agoMinutes" to "il y a {count} minutes",
        "thread.agoOneHour" to "il y a 1 heure",
        "thread.agoHours" to "il y a {count} heures",
        "thread.agoSinceWriting" to "depuis que vous avez commencé à écrire",

        // --- The destination clock ---------------------------------------------------------
        "thread.theirTimeAbout" to "Il est environ {time} chez lui ({source}).",
        "thread.clockFromContact" to "inscrit à sa fiche de contact",
        "thread.clockFromAreaCode" to "d'après son indicatif régional",
        "thread.clockFromWorkspace" to
            "le fuseau horaire de votre espace de travail — nous ne connaissons " +
            "pas le sien",

        // --- The durable outbox -----------------------------------------------------------
        "thread.outboxStale" to
            "En file d'attente depuis plus d'une journée. La conversation a " +
            "peut-être évolué — envoyez-le maintenant, ou supprimez-le.",
        "thread.outboxMediaLost" to
            "La photo de ce message n'est plus sur cet appareil. Envoyez le texte " +
            "seul, ou supprimez-le.",

        // --- What the thread says back -------------------------------------------------------
        "thread.noteFilesAllFailed" to
            "La note est enregistrée, mais ses fichiers n'ont pas été téléversés.",
        "thread.noteFilesSomeFailed" to
            "La note est enregistrée, mais {failed} fichiers sur {total} n'ont " +
            "pas été téléversés.",
        "thread.taskCreated" to "Tâche créée.",
        "thread.alreadyHasTask" to "Ce message a déjà une tâche.",
        "thread.markedAsSpam" to "Marquée comme pourriel.",
        "thread.markedAsNotSpam" to "Marquée comme non pourriel. Elle reste fermée.",
        // Web's `spamCleared`, character for character.
        "thread.spamCleared" to "Merci. Nous ne signalerons plus celui-ci.",
        "thread.snoozeLeadRemind" to "Je vous le rappellerai — de retour",
        "thread.snoozeLeadSnoozed" to "Reportée — de retour",
        "thread.reminderCancelled" to "Rappel annulé.",
        "thread.backInYourInbox" to "De retour dans votre boîte de réception.",
        "thread.undo" to "Annuler",

        // --- Asking for money, said back ---------------------------------------------------
        "thread.askedFor" to "Demande de {amount} envoyée.",
        "thread.paymentCalledOff" to "Annulée. Vous pouvez redemander à tout moment.",

        // --- The catch-up card's carrier note -----------------------------------------------
        "thread.summaryOptOutCarrier" to
            "Il a texté STOP : son fournisseur bloque vos textos. Lui seul peut " +
            "annuler ce blocage.",
        "thread.summaryOptOutManual" to
            "Quelqu'un a marqué ce client comme désabonné : les textos sont " +
            "bloqués. Les notes internes fonctionnent toujours.",
        // Web's `optOutHintShort`, character for character.
        "thread.summaryOptOutHint" to
            "Quelqu'un dans cette conversation a demandé à ne plus être contacté. " +
            "Cette demande est contraignante, peu importe la formulation.",

        // --- The timeline's audit lines -------------------------------------------------------
        // Copied from web's `sys*` keys wherever the two clients narrate the
        // same event in the same words. « pourriel » for spam, « étiquette »
        // for a tag, « désabonné » for an opt-out — the phone speaks the
        // laptop's French, not a second translation of the same English.
        "thread.sysSomeone" to "Quelqu'un",
        "thread.sysATeammate" to "un membre de l'équipe",
        "thread.sysMovedTo" to "{by} a fait passer ceci à {status}",
        "thread.sysStatusChanged" to "{by} a changé le statut",
        "thread.sysUnassigned" to "{by} a retiré l'assignation de cette conversation",
        "thread.sysAssignedTo" to "{by} a assigné celle-ci à {name}",
        "thread.sysTagAdded" to "{by} a ajouté l'étiquette « {name} »",
        "thread.sysTagAddedGeneric" to "{by} a ajouté une étiquette",
        "thread.sysTagRemoved" to "{by} a retiré une étiquette",
        "thread.sysOptedOutSystem" to "{name} s'est désabonné des textos",
        "thread.sysOptedOutBy" to "{by} a désabonné {name}",
        "thread.sysOptedInSystem" to "{name} s'est réabonné",
        "thread.sysOptOutRevoked" to "{by} a retiré le désabonnement",
        "thread.sysConsentAttested" to
            "{by} a attesté du consentement à texter {name}",
        "thread.sysQuietHours" to
            "{by} a envoyé pendant les heures de silence de ce client",
        "thread.sysAppointmentConfirmed" to "Le client a confirmé le rendez-vous",
        "thread.sysJobRated" to "Le client a noté le travail {score} sur 5",
        "thread.sysSpamMarked" to "{by} a marqué ceci comme pourriel",
        "thread.sysSpamUnmarked" to "{by} a marqué ceci comme non pourriel",
        "thread.sysMessageDone" to "{by} a marqué un message comme fait",
        "thread.sysMessageUndone" to "{by} a rouvert un message",
        "thread.sysTaskCreated" to "{by} a créé une tâche",
        "thread.sysTaskAssigned" to "{by} a assigné une tâche",
        "thread.sysTaskDueSet" to "{by} a fixé l'échéance d'une tâche",
        "thread.sysTaskDeleted" to "{by} a supprimé une tâche",
        "thread.sysNoteAttachmentAdded" to "{by} a joint un fichier à une note",
        "thread.sysNoteAttachmentRemoved" to "{by} a retiré un fichier d'une note",
        "thread.sysTaskAttachmentAdded" to "{by} a joint un fichier à une tâche",
        "thread.sysTaskAttachmentRemoved" to "{by} a retiré un fichier d'une tâche",
        "thread.sysMissedCallFrom" to "Appel manqué de {name}",
        "thread.sysAutoReplySent" to "Réponse automatique d'absence envoyée",

        // #607 A3 — « repris » is the verb the payment strip already uses for a
        // chargeback and « remboursé » the one it uses for a refund, exactly as
        // web's note beside these keys says.
        "thread.sysPaymentRequested" to "{by} a demandé {amount}",
        "thread.sysPaymentRequestedGeneric" to "{by} a demandé un paiement",
        "thread.sysPaymentCancelled" to "{by} a annulé la demande de {amount}",
        "thread.sysPaymentCancelledGeneric" to "{by} a annulé la demande",
        "thread.sysPaymentPaid" to "Le client a payé {amount}",
        "thread.sysPaymentPaidGeneric" to "Le client a payé",
        "thread.sysPaymentRefunded" to "{amount} lui a été remboursé",
        "thread.sysPaymentRefundedGeneric" to "L'argent lui a été remboursé",
        "thread.sysPaymentDisputed" to "Sa banque a repris {amount}",
        "thread.sysPaymentDisputedGeneric" to "Sa banque a repris ce paiement",
        "thread.sysPaymentWithDescription" to "{line} — {description}",

        // #317 — copied from web's `sysMedia*`, character for character. The
        // parity guard compares the ENGLISH above; these are held to the same
        // standard by hand, because a French crew reading a different reason
        // than an English one is the same defect in a second language.
        "thread.sysMediaTooLarge" to
            "Un fichier envoyé par ce client était trop gros pour être conservé — " +
            "demandez-lui d'en envoyer un plus petit",
        "thread.sysMediaEmpty" to
            "Un fichier envoyé par ce client est arrivé vide — demandez-lui de " +
            "l'envoyer de nouveau",
        "thread.sysMediaTypeMismatch" to
            "Un fichier envoyé par ce client n'était pas du type qu'il annonçait, " +
            "alors il n'a pas été conservé",
        "thread.sysMediaUnsafe" to
            "Un fichier envoyé par ce client contenait quelque chose de dangereux, " +
            "alors il n'a pas été conservé — demandez-lui une photo ou un PDF ordinaire",
        "thread.sysMediaUnreadable" to
            "Un fichier envoyé par ce client n'a pas pu être vérifié, alors il n'a " +
            "pas été conservé — demandez-lui de l'envoyer de nouveau",
        "thread.sysMediaTooManyKept" to
            "Ce message contenait plus de fichiers que nous pouvons conserver — les " +
            "{kept} premiers ont été gardés",
        "thread.sysMediaTooMany" to
            "Ce message contenait plus de fichiers que nous pouvons conserver",
        "thread.sysMediaUnsupported" to
            "Un fichier envoyé par ce client ne peut pas être affiché ici — " +
            "demandez-lui d'envoyer une photo ou un PDF",

        // #273/#517 — the call lines, copied from web's `sys*Call*` keys.
        "thread.sysCalledNoAnswer" to "Appel effectué, sans réponse",
        "thread.sysYouCalled" to "Vous avez appelé",
        "thread.sysTransferredBy" to "{from} a transféré l'appel à {to}",
        "thread.sysTransferredTo" to "Appel transféré à {to}",
        "thread.sysTransferred" to "Appel transféré",
        "thread.sysLeftVoicemail" to "Message vocal laissé",
        "thread.sysWentToVoicemail" to "L'appel s'est rendu à la boîte vocale",
        "thread.sysMissedCall" to "Appel manqué",
        "thread.sysAnsweredBy" to "Appel répondu par {name}",
        "thread.sysAnswered" to "Appel répondu",
        "thread.sysWithDuration" to "{line} · {duration}",
    )
}
