import Foundation

/// #228 — the conversation: its timeline, its composer, and the files that ride
/// on both (`Features/Thread`, `Features/Compose`, `Features/Attachments`).
///
/// The busiest surface in the product, so it is also the one where a half-English
/// screen is most obvious: a crew member reads this all day and reads the
/// settings index twice a year.
///
/// ## It is the Android catalogue's twin, on purpose
///
/// Every key here that Android's `ThreadStrings.kt` already has keeps that key's
/// NAME and its exact English and French. A crew that switches devices must not
/// meet a different product, and two catalogues that agree about the sentence
/// but disagree about the key are two catalogues that drift the next time one of
/// them is edited.
///
/// The keys Android does not have are the ones iOS says something Android does
/// not — a permission path that reads `Settings › Loonext` rather than
/// `Paramètres › Applis`, a wrap-up status line written for a press-and-hold
/// mic, the make-a-task placeholders. Those are named by MEANING in the same
/// `thread.camelCase` shape, so a later Android change can adopt them.
///
/// ## The register
///
/// `CommonStrings`': Quebec French, VOUVOIEMENT, accents spelled normally, a
/// normal space before `:`. Product names (Loonext, Lou, Stripe, Telnyx) and the
/// carrier keywords (STOP / START / HELP / URGENT) are never translated — a
/// carrier matches on the keyword, and a customer told to text "ARRÊT" will not
/// be unsubscribed by anybody.
///
/// The shared vocabulary, so the phone and the laptop agree word for word:
/// texto · conversation · client · équipe · espace de travail · numéro · tâche ·
/// rappel · devis · acompte · forfait · facturation · paramètres ·
/// boîte de réception.
enum ThreadStrings {
    static let section = AppStrings.Section(
        name: "ThreadStrings",
        en: [
            // --- The thread itself ---------------------------------------
            "thread.notFound": "This conversation doesn't exist or was removed.",
            "thread.backToInbox": "Back to inbox",
            "thread.noMessages": "No messages yet.",
            "thread.newMessagePill": "New message",
            "thread.callContact": "Call {name}",
            "thread.optedOut": "Opted out",
            "thread.conversationFallback": "Conversation",
            "thread.viewContact": "View contact",
            "thread.photo": "Photo",
            "thread.file": "File",
            "thread.teammate": "Teammate",
            "thread.youSuffix": " (you)",
            "thread.conversationOptions": "Conversation options for {name}",
            "thread.conversationOptionsBadge":
                "Conversation options for {name}, {badge}",
            // The iOS permission path, not Android's. One key, two true
            // sentences: a member sent to "Settings › Apps › Loonext" on an
            // iPhone is being sent somewhere that does not exist.
            "thread.micNeededForCalls":
                "Loonext needs the microphone to place calls. "
                + "Allow it in Settings › Loonext.",

            // --- Status ---------------------------------------------------
            "thread.statusHeading": "STATUS",
            "thread.statusNew": "New",
            "thread.statusOpen": "Open",
            "thread.statusWaiting": "Waiting",
            "thread.statusClosed": "Closed",

            // --- Day dividers ---------------------------------------------
            "thread.dayToday": "Today",
            "thread.dayYesterday": "Yesterday",

            // --- Queued sends (#234) --------------------------------------
            "thread.deleteQueuedTitle": "Delete this message?",
            "thread.deleteQueuedBody":
                "It hasn't been sent, and deleting it here is the only copy gone.",
            "thread.keepIt": "Keep it",
            "thread.queuedOffline": "Queued — will send when you're back online",
            "thread.sending": "Sending…",
            "thread.sent": "Sent",
            "thread.delivered": "Delivered",
            "thread.sendNow": "Send now",
            "thread.retry": "Retry",
            "thread.onePhoto": "1 photo",
            "thread.manyPhotos": "{count} photos",

            // --- Tags ------------------------------------------------------
            "thread.tags": "Tags",
            "thread.addTag": "Add tag",
            "thread.manageTags": "Manage tags",
            "thread.removeTag": "Remove tag {name}",
            "thread.addTagNamed": "Add tag {name}",
            "thread.addOrCreateTag": "Add or create a tag",
            "thread.findTag": "Find a tag",
            "thread.create": "Create",
            "thread.add": "Add",
            "thread.didYouMean": "Did you mean “{name}”?",
            "thread.tagsLocked":
                "No tag by that name. Ask an admin to add it — this workspace keeps "
                + "a set list.",
            "thread.noTagsCreate": "No tags yet. Create the first one above.",
            "thread.noTagsAdmin": "No tags yet. An admin adds the first one.",

            // --- Opt-out (#407) ---------------------------------------------
            "thread.optOutTitle": "Opt this customer out?",
            "thread.optOutBody":
                "They won't receive texts from you until the opt-out is removed. "
                + "This is recorded in the conversation timeline.",
            "thread.optOut": "Opt out",
            "thread.optOutOfTexts": "Opt out of texts",
            "thread.revokeTitle": "Remove the opt-out?",
            "thread.revokeBody":
                "You'll be able to text this customer again. Only do this if they "
                + "asked to hear from you.",
            "thread.removeOptOut": "Remove opt-out",
            "thread.carrierStopNote":
                "This customer texted STOP. Only they can undo it, by texting START "
                + "to your number.",

            // --- Assignment --------------------------------------------------
            "thread.assignTo": "Assign to",
            "thread.assignToEllipsis": "Assign to…",
            "thread.assignedTo": "Assigned to {name}",
            "thread.unassigned": "Unassigned",

            // --- Spam (#250) --------------------------------------------------
            "thread.spam": "Spam",
            "thread.spamTitle": "This looks like spam",
            "thread.notSpam": "Not spam",
            "thread.spamBody":
                "We didn't send a notification for it. Nothing is hidden, and you "
                + "can reply as normal.",

            // --- Snooze (#293) -------------------------------------------------
            "thread.bringBack": "Bring back",
            "thread.bringBackNow": "Bring back now",
            "thread.bringBackHint":
                "Brings this conversation back to your inbox now",
            "thread.cancelReminder": "Cancel the reminder",
            "thread.snoozeUntil": "Snooze until",
            "thread.remindMeToChase": "Remind me to chase",
            "thread.pickADate": "Pick a date…",
            "thread.remindMe": "Remind me",
            "thread.snooze": "Snooze",
            "thread.whyOptional": "Why? (optional)",
            "thread.returnDateTime": "Return date and time",
            "thread.snoozeExplainer":
                "It comes back to your inbox then — and immediately if the customer "
                + "replies before that.",
            "thread.followUpExplainer":
                "It comes back then as something to chase — unless they reply first, "
                + "in which case there is nothing to chase and the reminder "
                + "disappears.",

            // --- Pinned ----------------------------------------------------------
            "thread.pinned": "Pinned",
            "thread.pinnedCount": "Pinned · {count}",
            "thread.collapsePinned": "Collapse pinned",
            "thread.expandPinned": "Expand pinned",

            // --- Timeline visibility ------------------------------------------
            "thread.showMessages": "Show messages",
            "thread.showNotes": "Show notes",
            "thread.showEvents": "Show events",
            "thread.refresh": "Refresh",

            // --- Message bubbles + long-press actions ---------------------------
            "thread.internalNote": "Internal note",
            "thread.noteOnTask": "on: {title}",
            "thread.openTask": "Open task",
            "thread.openTaskNamed": "Open task {title}",
            "thread.reopenTaskNamed": "Reopen task {title}",
            "thread.markTaskDoneNamed": "Mark task {title} done",
            "thread.hasTask": "Has a task",
            "thread.openTheTask": "Open the task",
            "thread.goToMessage": "Go to that message",
            "thread.photoUnavailable": "Photo unavailable · tap to retry",
            "thread.copyText": "Copy text",
            "thread.done": "Done",
            "thread.retrySend": "Retry send",
            "thread.makeTask": "Make a task",

            // --- Make a task (#214) -----------------------------------------------
            "thread.newTask": "New task",
            "thread.newTaskFrom": "From {name}'s message · posts to the thread",
            "thread.taskTitle": "Title",
            "thread.taskTitlePlaceholder": "Task title",
            "thread.taskTitleFallback": "Follow up",
            "thread.due": "Due",
            "thread.dueOptional": "Due (optional)",
            "thread.addDueDate": "Add a due date",
            "thread.clearDueDate": "Clear due date",
            "thread.pickATime": "Pick a time…",
            "thread.createTask": "Create task",
            "thread.setDueDate": "Set due date",
            "thread.nobody": "Nobody",
            "thread.suggested": "Suggested",
            "thread.addressSection": "Address",
            "thread.clear": "Clear",
            "thread.clearAddress": "Clear address",
            "thread.addrStreet": "Street",
            "thread.addrUnit": "Unit / suite",
            "thread.addrCity": "City",
            "thread.addrState": "State / province",
            "thread.addrPostal": "Postal code",
            "thread.taskLineNote": "The thread shows the task line",

            // --- Contact panel (#165 / #301) ---------------------------------------
            "thread.openFullContact": "Open the full contact",
            "thread.sectionDetails": "Details",
            "thread.sectionConsent": "Consent",
            "thread.sectionLeadSource": "Where they came from",
            "thread.sectionTasks": "Tasks in this conversation",
            "thread.sectionOtherConversations": "Other conversations",
            "thread.fieldName": "Name",
            "thread.addName": "Add a name",
            "thread.fieldAddress": "Address",
            "thread.addAddress": "Add an address",
            "thread.fieldNotes": "Notes",
            "thread.notesPlaceholder":
                "Gate code, dog's name, preferred arrival window…",
            "thread.saveFailed": "Couldn't save. Check your connection.",
            "thread.leadFromLine": "{name} · the line they called",
            "thread.leadSaidSo": "{name} · somebody said so",
            "thread.leadAsk": "Ask them: how did you hear about us?",
            "thread.dontKnow": "Don't know",
            "thread.tasksLoadFailed": "Couldn't load this conversation's tasks.",
            "thread.noTasks": "No tasks in this conversation.",
            "thread.priorLoadFailed": "Couldn't load prior conversations.",
            "thread.noOtherConversations":
                "No other conversations with this contact.",

            // --- The catch-up card (#247) --------------------------------------------
            "thread.summaryReading": "Reading the thread…",
            "thread.summaryReady": "Lou's catch-up",
            "thread.summaryOffer": "Catch me up",
            "thread.summaryOfferAria": "Catch me up on this thread",
            "thread.summaryOfferHint":
                "Lou reads the thread and shows what they asked, what you said, and "
                + "what's still open.",
            "thread.summaryHide": "Hide",
            "thread.summaryLineHint": "Opens the message this came from.",

            // --- Scheduled strip (#233) ------------------------------------------
            "thread.scheduledWaiting": "Waiting",
            "thread.cancelScheduledAria": "Cancel the message scheduled for {when}",

            // --- Photos & files (#165 / #317) --------------------------------------
            "thread.photosAndFiles": "Photos & files",
            "thread.backToConversation": "Back to conversation",
            "thread.galleryView": "View",
            "thread.galleryImages": "Images",
            "thread.galleryFiles": "Files",
            "thread.noPhotosLoaded": "No photos loaded yet.",
            "thread.noPhotosYet": "No photos in this conversation yet.",
            "thread.noFilesLoaded": "No files loaded yet.",
            "thread.noFilesYet": "No files in this conversation yet.",
            "thread.loadMore": "Load more",
            "thread.loadAnyway": "Load",
            "thread.fileCantOpen": "This file can't be opened.",
            "thread.reportThisFile": "Report this file",
            "thread.reportFileTitle": "Report this file?",
            "thread.reportFileBody":
                "Nobody on your team will be able to open {name} until an owner or "
                + "admin releases it. Nothing is deleted.",
            "thread.reportFile": "Report file",
            "thread.reportFileFailed": "Couldn't report that file. Try again.",
            "thread.playAudio": "Play audio message",
            "thread.pauseAudio": "Pause audio message",
            "thread.openAttachment": "Open {kind}",

            // --- The composer -------------------------------------------------------
            "thread.modeText": "Text",
            "thread.modeNote": "Note",
            "thread.textPlaceholder": "Text message",
            "thread.notePlaceholder": "Write an internal note…",
            "thread.addToMessage": "Add to message",
            "thread.attachPhoto": "Attach a photo",
            "thread.attachFile": "Attach a file",
            "thread.attachFilesToNote": "Attach files to this note",
            "thread.savedReply": "Saved reply",
            "thread.sendLater": "Send later",
            "thread.sendMessage": "Send message",
            "thread.saveNote": "Save note",
            "thread.removeAttachment": "Remove attachment",
            "thread.removeNamed": "Remove {name}",
            "thread.attachLimitPhotos":
                "You can attach up to {max} photos per text.",
            "thread.attachLimitText": "You can attach up to {max} files per text.",
            "thread.attachLimitNote": "Notes can carry up to 10 files.",
            "thread.photoReadFailed":
                "Couldn't read that photo. Try attaching it again.",
            "thread.sendsAs": "Sends as: ",
            "thread.callThemInstead": "Call them instead",
            "thread.reportThis": "Report this",

            // --- The send boundary (#408) -------------------------------------------
            "thread.collisionTitle": "Somebody already answered",
            "thread.collisionAsk": " Send yours as well?",
            "thread.sendAnyway": "Send anyway",
            "thread.letMeLook": "Let me look",

            // --- Lou in the composer -------------------------------------------------
            "thread.draftWithLou": "Draft with Lou",
            "thread.finishWithLou": "Finish with Lou",
            "thread.drafting": "Drafting…",
            "thread.lousDrafts": "Lou's drafts",
            "thread.dismiss": "Dismiss",
            "thread.louNeedsBusiness":
                "Lou doesn't know what you do yet. Tell it, and drafts get specific.",

            // --- The dictated wrap-up (#507) -------------------------------------------
            //
            // iOS holds the mic down rather than latching it, so the running
            // commentary is this platform's own sentence rather than Android's.
            "thread.holdToDictateWrapUp": "Hold to dictate a wrap-up",
            "thread.wrapUpHint":
                "Say what was agreed after the call. Lou writes your words down for "
                + "you to check before you post the note.",
            "thread.wrapUpTranscribing": "Writing down what you said…",
            "thread.wrapUpGoAhead": "Go ahead — let go when you're done",
            "thread.wrapUpGoAheadLeft": "Go ahead — {seconds}s left",
            "thread.wrapUpTooShort":
                "Hold the mic while you talk — that was too short to write down.",

            // --- Mentions ---------------------------------------------------------------
            "thread.mentionTeammate": "Mention a teammate",
            "thread.noMentionable": "No teammates can see this conversation.",

            // --- Saved replies (#274 / #475) ---------------------------------------------
            "thread.templates": "Templates",
            "thread.savedReplies": "Saved replies",
            "thread.noTemplates":
                "No saved replies yet. Create them on the web under Settings.",
            "thread.nothingMatches": "Nothing matches.",
            "thread.templateHint":
                "Type / in the composer to open these inline · shared with the crew",
            "thread.searchTemplates": "Search templates…",
            "thread.insert": "Insert",

            // --- Send later (#233 / #539) --------------------------------------------------
            "thread.sendAt": "Send at",
            "thread.schedule": "Schedule",
            "thread.whichClock": "Which clock",
            "thread.workspaceTime": "Your workspace's time",
            "thread.quietHoursTitle": "That lands late where they are",
            "thread.scheduleAnyway": "Schedule it anyway",
            "thread.pickAnotherTime": "Pick another time",

            // --- Marking up a photo (#294) -------------------------------------------------
            "thread.markupTitle": "Point at something",
            "thread.workPhaseAria": "What these photos show",

            // --- Starting a conversation (#183) ---------------------------------------------
            "thread.newTextTitle": "New text",
            "thread.numberNotReady": "Your number isn't ready yet.",
            "thread.numberNotReadyBody":
                "You need an active number to start a conversation. Check the web "
                + "app for its status.",
            "thread.toLabel": "To",
            "thread.messageLabel": "Message",
            "thread.recipientPlaceholder": "Name or phone number",
            "thread.clearRecipient": "Clear recipient",
            "thread.nanpOnly": "US and Canadian numbers only.",
            "thread.noContactMatch":
                "No match in contacts. This starts a new conversation.",
            "thread.willText": "Will text {number}",
            "thread.fromNumber": "From: {number}",
            "thread.sendText": "Send text",
            "thread.lateThereTitle": "It's late where they are",
            "thread.lateThereBody": "It's {time} at this number. Send anyway?",
            "thread.lateThereUnknown": "between 8pm and 8am",
            "thread.wait": "Wait",
            "thread.theirTimeAskFirst":
                "It's {time} for this customer. We'll ask before sending this late.",
            "thread.theirTime": "It's {time} for them.",

            // ── #228 pass 2: the composer, the timeline's system lines,
            //    the catch-up and the wrap-up ─────────────────────────────
            "thread.copied": "Copied.",
            "thread.undo": "Undo",
            "thread.thatFile": "That file",
            "thread.imageCantBeSent": "That image can't be sent. Try a different photo.",
            "thread.mmsUnsupportedFile":
                "{name} isn't something a text can carry. Try a photo, video, audio "
                + "clip, contact card, or PDF.",
            "thread.mmsFileEmpty": "{name} is empty.",
            "thread.mmsFileTooBig": "{name} is over 1 MB, the most a text can carry.",
            "thread.fileReadFailedPick":
                "Couldn't read that file. Try picking it again.",
            "thread.fileSizeReadFailed":
                "Couldn't read that file's size. Try picking it again.",
            "thread.fileTypeBlocked":
                "That file type isn't allowed. Images, PDFs, and documents only.",
            "thread.fileSizeLimit": "Files can be up to 25 MB each.",
            "thread.mergeFirstName": "The customer's first name",
            "thread.mergeAddress": "The address on their contact",
            "thread.mergeJobDay": "The day of their next booked visit",
            "thread.mergeJobTime": "The time of it",
            "thread.mergeMyName": "Your first name",
            "thread.mergeBusinessName": "Your business name",
            "thread.mergeOurNumber": "The number they reply to",
            "thread.serverOnlyTokensNote": "The day and time fill in when you send.",
            "thread.mmsSegments": "MMS · sent in {count} parts",
            "thread.sentInOnePart": "Sent in 1 part",
            "thread.sentInParts": "Sent in {count} parts",
            "thread.scheduledConfirm": "Sending {when}.",
            "thread.quietHoursAround": "That is around {hour} for this customer.",
            "thread.pickerThats": "That's {time} {clock}",
            "thread.senderClockOwn": "This is your own time. {reassurance}",
            "thread.senderClockApart":
                "This is your own time, and they are {delta}. {reassurance}",
            "thread.clockSame": "on the same clock",
            "thread.clockAnHourAhead": "an hour ahead of you",
            "thread.clockAnHourBehind": "an hour behind you",
            "thread.clockHoursAhead": "{count} hours ahead of you",
            "thread.clockHoursBehind": "{count} hours behind you",
            "thread.theirTimeAbout": "It's about {time} where they are ({source}).",
            "thread.clockFromContact": "set on their contact",
            "thread.clockFromAreaCode": "from their area code",
            "thread.clockFromWorkspace":
                "your workspace's timezone — we don't know theirs",
            "thread.duplicateReplyNamed": "{name} replied {ago}.",
            "thread.duplicateReplyAuto": "An automatic reply went out {ago}.",
            "thread.agoJustNow": "just now",
            "thread.agoOneMinute": "1 minute ago",
            "thread.agoMinutes": "{count} minutes ago",
            "thread.agoOneHour": "1 hour ago",
            "thread.agoHours": "{count} hours ago",
            "thread.agoSinceWriting": "since you started writing",
            "thread.bannerOptedOutTitle": "This customer opted out",
            "thread.bannerOptedOutCarrierBody":
                "They texted STOP, so their carrier is blocking your texts. Only "
                + "they can undo it, by texting START to your number. Internal notes "
                + "still work.",
            "thread.bannerOptedOutManualBody":
                "Someone marked them opted out. You can undo that on their contact. "
                + "Internal notes still work.",
            "thread.bannerSubscriptionTitle": "Texting is paused",
            "thread.bannerSubscriptionBody":
                "Your subscription isn't active, so outbound texts are blocked. An "
                + "owner can fix this in billing. Internal notes still work.",
            "thread.bannerRegistrationPendingTitle": "US texting isn't approved yet",
            "thread.bannerRegistrationPendingBody":
                "Carriers are still reviewing your registration. Texts to US "
                + "numbers will send once it's approved. Internal notes still work.",
            "thread.bannerUsTextingOffTitle": "US texting isn't on for this workspace",
            "thread.bannerUsTextingOffBody":
                "This is a US number, and texting US numbers is an add-on your "
                + "workspace hasn't turned on. An owner can add it in settings. Calls "
                + "to this customer still work, and internal notes still work.",
            "thread.bannerRegistrationSuspendedTitle": "US texting is paused",
            "thread.bannerRegistrationSuspendedBody":
                "The carrier paused your US registration, so texts to US numbers "
                + "won't send. We've been told and we're on it, and you'll get an "
                + "email when it's back. Canadian texts, calls and internal notes all "
                + "still work.",
            "thread.bannerUsageCapTitle": "You've hit this month's cap",
            "thread.bannerUsageCapBody":
                "Outbound texts pause until the cap is raised or the month rolls "
                + "over. Internal notes still work.",
            "thread.bannerReadOnlyTitle": "You have view-only access",
            "thread.bannerReadOnlyBody":
                "You can read this conversation but not reply or leave notes. An "
                + "owner or admin can change your access.",
            "thread.bannerNumberAccessTitle": "You can't text from this number",
            "thread.bannerNumberAccessBody":
                "You can read this conversation and add internal notes, but texting "
                + "this customer needs access an owner or admin grants. Calls to this "
                + "number won't ring you either. Ask them if you need it.",
            "thread.bannerOptOutHintTitle": "They asked not to be contacted",
            "thread.bannerOptOutHintBody":
                "Someone on this thread asked to be left alone. That request is "
                + "binding however it's worded, so don't reply unless you're sure it "
                + "wasn't one. To stop texts for good, they need to text STOP.",
            "thread.signedOut": "You're signed out.",
            "thread.cantReachLoonext": "Can't reach Loonext. Check your connection.",
            "thread.outboxStale":
                "Queued for over a day. The conversation may have moved on — send "
                + "it now, or delete it.",
            "thread.outboxMediaLost":
                "The photo for this message is no longer on this device. Send the "
                + "text on its own, or delete it.",
            "thread.noteFilesAllFailed": "The note saved, but its files didn't upload.",
            "thread.noteFilesSomeFailed":
                "The note saved, but {failed} of {total} files didn't upload.",
            "thread.taskCreated": "Task created.",
            "thread.alreadyHasTask": "This message already has a task.",
            "thread.markedAsSpam": "Marked as spam.",
            "thread.markedAsNotSpam": "Marked as not spam. It stays closed.",
            "thread.spamCleared": "Thanks. We won't flag this one.",
            "thread.snoozeLeadRemind": "I'll remind you — back",
            "thread.snoozeLeadSnoozed": "Snoozed — back",
            "thread.reminderCancelled": "Reminder cancelled.",
            "thread.backInYourInbox": "Back in your inbox.",
            "thread.audioMessage": "Audio message",
            "thread.audioUnavailable": "Audio unavailable · tap to retry",
            "thread.louPausedForBilling":
                "Lou is paused while the subscription is sorted out. An owner can "
                + "fix that in Billing.",
            "thread.sysSomeone": "Someone",
            "thread.sysATeammate": "a teammate",
            "thread.sysMovedTo": "{by} moved this to {status}",
            "thread.sysStatusChanged": "{by} changed the status",
            "thread.sysUnassigned": "{by} unassigned this conversation",
            "thread.sysAssignedTo": "{by} assigned this to {name}",
            "thread.sysTagAdded": "{by} added the tag \"{name}\"",
            "thread.sysTagAddedGeneric": "{by} added a tag",
            "thread.sysTagRemoved": "{by} removed a tag",
            "thread.sysOptedOutSystem": "{name} opted out of texts",
            "thread.sysOptedOutBy": "{by} opted {name} out",
            "thread.sysOptedInSystem": "{name} opted back in",
            "thread.sysOptOutRevoked": "{by} removed the opt-out",
            "thread.sysConsentAttested": "{by} attested consent to text {name}",
            "thread.sysQuietHours": "{by} sent during this customer's quiet hours",
            "thread.sysAppointmentConfirmed": "They confirmed the appointment",
            "thread.sysJobRated": "They rated the job {score} out of 5",
            "thread.sysSpamMarked": "{by} marked this as spam",
            "thread.sysSpamUnmarked": "{by} marked this as not spam",
            "thread.sysMessageDone": "{by} marked a message done",
            "thread.sysMessageUndone": "{by} reopened a message",
            "thread.sysTaskCreated": "{by} created a task",
            "thread.sysTaskAssigned": "{by} assigned a task",
            "thread.sysTaskDueSet": "{by} set a task due date",
            "thread.sysTaskDeleted": "{by} deleted a task",
            "thread.sysNoteAttachmentAdded": "{by} attached a file to a note",
            "thread.sysNoteAttachmentRemoved": "{by} removed a file from a note",
            "thread.sysTaskAttachmentAdded": "{by} attached a file to a task",
            "thread.sysTaskAttachmentRemoved": "{by} removed a file from a task",
            "thread.sysMissedCallFrom": "Missed call from {name}",
            "thread.sysAutoReplySent": "Away auto-reply sent",
            "thread.sysPaymentRequested": "{by} asked for {amount}",
            "thread.sysPaymentRequestedGeneric": "{by} asked for a payment",
            "thread.sysPaymentCancelled": "{by} called off the {amount} request",
            "thread.sysPaymentCancelledGeneric": "{by} called off the request",
            "thread.sysPaymentPaid": "They paid {amount}",
            "thread.sysPaymentPaidGeneric": "They paid",
            "thread.sysPaymentRefunded": "{amount} went back to them",
            "thread.sysPaymentRefundedGeneric": "The money went back to them",
            "thread.sysPaymentDisputed": "Their bank pulled back {amount}",
            "thread.sysPaymentDisputedGeneric": "Their bank pulled this payment back",
            "thread.sysPaymentWithDescription": "{line} — {description}",
            "thread.sysMediaTooLarge":
                "A file this customer sent was too big to save — ask them to send a "
                + "smaller one",
            "thread.sysMediaEmpty":
                "A file this customer sent arrived empty — ask them to send it "
                + "again",
            "thread.sysMediaTypeMismatch":
                "A file this customer sent wasn't the kind of file it claimed to "
                + "be, so it wasn't saved",
            "thread.sysMediaUnsafe":
                "A file this customer sent had something unsafe inside it, so it "
                + "wasn't saved — ask them for a photo or a plain PDF",
            "thread.sysMediaUnreadable":
                "A file this customer sent couldn't be checked, so it wasn't saved "
                + "— ask them to send it again",
            "thread.sysMediaTooManyKept":
                "This message came with more files than we can save — the first "
                + "{kept} were kept",
            "thread.sysMediaTooMany":
                "This message came with more files than we can save",
            "thread.sysMediaUnsupported":
                "A file this customer sent can't be shown here — ask them to send a "
                + "photo or a PDF",
            "thread.sysCalledNoAnswer": "Called, no answer",
            "thread.sysYouCalled": "You called",
            "thread.sysTransferredBy": "{from} transferred the call to {to}",
            "thread.sysTransferredTo": "Call transferred to {to}",
            "thread.sysTransferred": "Call transferred",
            "thread.sysLeftVoicemail": "Left a voicemail",
            "thread.sysWentToVoicemail": "Call went to voicemail",
            "thread.sysMissedCall": "Missed call",
            "thread.sysAnsweredBy": "Call answered by {name}",
            "thread.sysAnswered": "Call answered",
            "thread.sysWithDuration": "{line} · {duration}",
            "domain.catchUpSectionAsked": "What they asked",
            "domain.catchUpSectionWeSaid": "What we said",
            "domain.catchUpSectionOpen": "Still open",
            "domain.catchUpAttribution":
                "Lou read this thread. Tap any line to see the message it came "
                + "from.",
            "domain.catchUpDisabled":
                "Catch-ups are turned off for this workspace. Settings, AI turns "
                + "them back on.",
            "domain.catchUpRateLimited":
                "That was a lot of catch-ups at once. Try again in a moment.",
            "thread.somethingWentWrongStatus": "Something went wrong ({status}).",
            "thread.summaryOfferMessages": "{count} messages",
            "thread.summaryOfferQuietDay": "quiet for a day",
            "thread.summaryOfferQuietDays": "quiet for {count} days",
            "thread.summarySpam":
                "This thread is marked as spam, so Lou skips it. Unmark it to ask "
                + "for a catch-up.",
            "thread.summaryTooShort":
                "There isn't much here yet — reading the thread is quicker than a "
                + "catch-up.",
            "thread.summaryOverCap":
                "This month's catch-ups are used up. They start again next month. "
                + "Read the thread.",
            "thread.summaryUnreachable":
                "Couldn't reach Lou just now. Try again, or read the thread.",
            "thread.summaryUnusable":
                "Nothing Lou wrote checked out against the thread, so it said "
                + "nothing. Read the thread.",
            "thread.summaryForbidden":
                "Your role can't ask for catch-ups — they spend the workspace's "
                + "shared AI budget. An owner or admin can change that, and the "
                + "thread is all here.",
            "thread.summaryNotFound":
                "This thread isn't there any more. Close it and open it again.",
            "thread.summaryNetwork":
                "Can't reach Loonext. Check your connection, then try again.",
            "thread.summaryPaused":
                "Catch-ups are paused right now. Try again shortly, or read the "
                + "thread.",
            "thread.summaryNone":
                "No catch-up this time. Try again, or read the thread.",
            "thread.summaryStopNotice":
                "This contact texted STOP. Nothing can be sent to them, whatever "
                + "this says.",
            "thread.summaryOptedOutNotice":
                "This contact is opted out. Nothing can be sent to them, whatever "
                + "this says.",
            "thread.summaryLeftAloneNotice":
                "Somebody here asked to be left alone. Check the thread before "
                + "replying.",
            "thread.summaryRecentStretch":
                "This is the recent stretch of the thread, not all of it.",
            "thread.wrapUpFailTooLong":
                "That was longer than two minutes. Say the short version and Lou "
                + "will write it down.",
            "thread.wrapUpFailDisabled":
                "Wrap-up dictation is turned off for this workspace. Settings, AI "
                + "turns it back on.",
            "thread.wrapUpFailOverCap":
                "This month's dictation is used up. It starts again next month — "
                + "type the note in the meantime.",
            "thread.wrapUpFailUnreachable":
                "Couldn't reach Lou just now. Try again, or type the note.",
            "thread.wrapUpFailUnusable":
                "Nothing came back that reads like words. Try again closer to the "
                + "mic, or type the note.",
            "thread.wrapUpFailDefault":
                "That didn't come back as words. Type the note instead.",
            "thread.wrapUpRefusalCallInProgress":
                "Finish the call first. Lou writes down what you say afterwards, "
                + "never the call.",
            "thread.wrapUpRefusalMicDenied":
                "Loonext needs the microphone to take a wrap-up. Allow it in "
                + "Settings › Loonext, or type the note.",
            "thread.wrapUpRefusalMicJustGranted":
                "Microphone is on now. Hold the mic and say it again.",
            "thread.wrapUpRefusalCouldNotStart":
                "Couldn't start recording. Type the note instead.",
        ],
        frCA: [
            // --- The thread itself ---------------------------------------
            "thread.notFound": "Cette conversation n'existe pas ou a été supprimée.",
            "thread.backToInbox": "Retour à la boîte de réception",
            "thread.noMessages": "Aucun message pour l'instant.",
            "thread.newMessagePill": "Nouveau message",
            "thread.callContact": "Appeler {name}",
            "thread.optedOut": "Désabonné",
            "thread.conversationFallback": "Conversation",
            "thread.viewContact": "Voir le contact",
            "thread.photo": "Photo",
            "thread.file": "Fichier",
            "thread.teammate": "Collègue",
            "thread.youSuffix": " (vous)",
            "thread.conversationOptions": "Options de conversation pour {name}",
            "thread.conversationOptionsBadge":
                "Options de conversation pour {name}, {badge}",
            "thread.micNeededForCalls":
                "Loonext a besoin du micro pour passer des appels. "
                + "Autorisez-le dans Réglages › Loonext.",

            // --- Status ---------------------------------------------------
            "thread.statusHeading": "STATUT",
            "thread.statusNew": "Nouveau",
            "thread.statusOpen": "Ouvert",
            "thread.statusWaiting": "En attente",
            "thread.statusClosed": "Fermé",

            // --- Day dividers ---------------------------------------------
            "thread.dayToday": "Aujourd'hui",
            "thread.dayYesterday": "Hier",

            // --- Queued sends (#234) --------------------------------------
            "thread.deleteQueuedTitle": "Supprimer ce message ?",
            "thread.deleteQueuedBody":
                "Il n'a pas été envoyé, et le supprimer ici efface la seule copie.",
            "thread.keepIt": "Le garder",
            "thread.queuedOffline":
                "En file d'attente — s'enverra dès votre retour en ligne",
            "thread.sending": "Envoi…",
            "thread.sent": "Envoyé",
            "thread.delivered": "Livré",
            "thread.sendNow": "Envoyer maintenant",
            "thread.retry": "Réessayer",
            "thread.onePhoto": "1 photo",
            "thread.manyPhotos": "{count} photos",

            // --- Tags ------------------------------------------------------
            "thread.tags": "Étiquettes",
            "thread.addTag": "Ajouter une étiquette",
            "thread.manageTags": "Gérer les étiquettes",
            "thread.removeTag": "Retirer l'étiquette {name}",
            "thread.addTagNamed": "Ajouter l'étiquette {name}",
            "thread.addOrCreateTag": "Ajouter ou créer une étiquette",
            "thread.findTag": "Trouver une étiquette",
            "thread.create": "Créer",
            "thread.add": "Ajouter",
            "thread.didYouMean": "Vouliez-vous dire « {name} » ?",
            "thread.tagsLocked":
                "Aucune étiquette de ce nom. Demandez à un administrateur de "
                + "l'ajouter — cet espace de travail garde une liste fixe.",
            "thread.noTagsCreate":
                "Aucune étiquette pour l'instant. Créez la première ci-dessus.",
            "thread.noTagsAdmin":
                "Aucune étiquette pour l'instant. Un administrateur ajoute la première.",

            // --- Opt-out (#407) ---------------------------------------------
            "thread.optOutTitle": "Désabonner ce client ?",
            "thread.optOutBody":
                "Il ne recevra plus vos textos tant que le désabonnement n'est pas "
                + "retiré. C'est inscrit dans l'historique de la conversation.",
            "thread.optOut": "Désabonner",
            "thread.optOutOfTexts": "Désabonner des textos",
            "thread.revokeTitle": "Retirer le désabonnement ?",
            "thread.revokeBody":
                "Vous pourrez de nouveau texter ce client. Ne faites ceci que s'il "
                + "a demandé à recevoir vos messages.",
            "thread.removeOptOut": "Retirer le désabonnement",
            "thread.carrierStopNote":
                "Ce client a texté STOP. Lui seul peut annuler cela, en textant "
                + "START à votre numéro.",

            // --- Assignment --------------------------------------------------
            "thread.assignTo": "Assigner à",
            "thread.assignToEllipsis": "Assigner à…",
            "thread.assignedTo": "Assignée à {name}",
            "thread.unassigned": "Non assignée",

            // --- Spam (#250) --------------------------------------------------
            "thread.spam": "Pourriel",
            "thread.spamTitle": "Ceci ressemble à un pourriel",
            "thread.notSpam": "Pas un pourriel",
            "thread.spamBody":
                "Nous n'avons pas envoyé de notification. Rien n'est caché, et vous "
                + "pouvez répondre normalement.",

            // --- Snooze (#293) -------------------------------------------------
            "thread.bringBack": "Ramener",
            "thread.bringBackNow": "Ramener maintenant",
            "thread.bringBackHint":
                "Ramène cette conversation dans votre boîte de réception maintenant",
            "thread.cancelReminder": "Annuler le rappel",
            "thread.snoozeUntil": "Reporter jusqu'à",
            "thread.remindMeToChase": "Me rappeler de relancer",
            "thread.pickADate": "Choisir une date…",
            "thread.remindMe": "Me rappeler",
            "thread.snooze": "Reporter",
            "thread.whyOptional": "Pourquoi ? (facultatif)",
            "thread.returnDateTime": "Date et heure du retour",
            "thread.snoozeExplainer":
                "Elle revient dans votre boîte de réception à ce moment-là — et "
                + "immédiatement si le client répond avant.",
            "thread.followUpExplainer":
                "Elle revient à ce moment-là comme une relance à faire — sauf si le "
                + "client répond avant, auquel cas il n'y a rien à relancer et le "
                + "rappel disparaît.",

            // --- Pinned ----------------------------------------------------------
            "thread.pinned": "Épinglé",
            "thread.pinnedCount": "Épinglés · {count}",
            "thread.collapsePinned": "Réduire les épinglés",
            "thread.expandPinned": "Développer les épinglés",

            // --- Timeline visibility ------------------------------------------
            "thread.showMessages": "Afficher les textos",
            "thread.showNotes": "Afficher les notes",
            "thread.showEvents": "Afficher les évènements",
            "thread.refresh": "Actualiser",

            // --- Message bubbles + long-press actions ---------------------------
            "thread.internalNote": "Note interne",
            "thread.noteOnTask": "sur : {title}",
            "thread.openTask": "Ouvrir la tâche",
            "thread.openTaskNamed": "Ouvrir la tâche {title}",
            "thread.reopenTaskNamed": "Rouvrir la tâche {title}",
            "thread.markTaskDoneNamed": "Marquer la tâche {title} comme faite",
            "thread.hasTask": "A une tâche",
            "thread.openTheTask": "Ouvrir la tâche",
            "thread.goToMessage": "Aller à ce message",
            "thread.photoUnavailable": "Photo indisponible · touchez pour réessayer",
            "thread.copyText": "Copier le texte",
            "thread.done": "Fait",
            "thread.retrySend": "Renvoyer",
            "thread.makeTask": "Créer une tâche",

            // --- Make a task (#214) -----------------------------------------------
            "thread.newTask": "Nouvelle tâche",
            "thread.newTaskFrom":
                "Depuis le message de {name} · publié dans la conversation",
            "thread.taskTitle": "Titre",
            "thread.taskTitlePlaceholder": "Titre de la tâche",
            "thread.taskTitleFallback": "Faire un suivi",
            "thread.due": "Échéance",
            "thread.dueOptional": "Échéance (facultatif)",
            "thread.addDueDate": "Ajouter une échéance",
            "thread.clearDueDate": "Effacer l'échéance",
            "thread.pickATime": "Choisir une heure…",
            "thread.createTask": "Créer la tâche",
            "thread.setDueDate": "Fixer l'échéance",
            "thread.nobody": "Personne",
            "thread.suggested": "Suggéré",
            "thread.addressSection": "Adresse",
            "thread.clear": "Effacer",
            "thread.clearAddress": "Effacer l'adresse",
            "thread.addrStreet": "Rue",
            "thread.addrUnit": "Unité / suite",
            "thread.addrCity": "Ville",
            "thread.addrState": "Province / État",
            "thread.addrPostal": "Code postal",
            "thread.taskLineNote": "La conversation affichera la ligne de tâche",

            // --- Contact panel (#165 / #301) ---------------------------------------
            "thread.openFullContact": "Ouvrir la fiche complète",
            "thread.sectionDetails": "Coordonnées",
            "thread.sectionConsent": "Consentement",
            "thread.sectionLeadSource": "D'où il vient",
            "thread.sectionTasks": "Tâches de cette conversation",
            "thread.sectionOtherConversations": "Autres conversations",
            "thread.fieldName": "Nom",
            "thread.addName": "Ajouter un nom",
            "thread.fieldAddress": "Adresse",
            "thread.addAddress": "Ajouter une adresse",
            "thread.fieldNotes": "Notes",
            "thread.notesPlaceholder":
                "Code de barrière, nom du chien, heure d'arrivée préférée…",
            "thread.saveFailed":
                "Impossible d'enregistrer. Vérifiez votre connexion.",
            "thread.leadFromLine": "{name} · la ligne qu'il a appelée",
            "thread.leadSaidSo": "{name} · quelqu'un l'a indiqué",
            "thread.leadAsk": "Demandez-lui : comment nous avez-vous connus ?",
            "thread.dontKnow": "Je ne sais pas",
            "thread.tasksLoadFailed":
                "Impossible de charger les tâches de cette conversation.",
            "thread.noTasks": "Aucune tâche dans cette conversation.",
            "thread.priorLoadFailed":
                "Impossible de charger les conversations précédentes.",
            "thread.noOtherConversations":
                "Aucune autre conversation avec ce client.",

            // --- The catch-up card (#247) --------------------------------------------
            "thread.summaryReading": "Lecture de la conversation…",
            "thread.summaryReady": "Le résumé de Lou",
            "thread.summaryOffer": "Faites-moi un résumé",
            "thread.summaryOfferAria": "Faites-moi un résumé de cette conversation",
            "thread.summaryOfferHint":
                "Lou lit la conversation et montre ce que le client a demandé, ce "
                + "que vous avez répondu, et ce qui reste en suspens.",
            "thread.summaryHide": "Masquer",
            "thread.summaryLineHint": "Ouvre le message d'où ceci provient.",

            // --- Scheduled strip (#233) ------------------------------------------
            "thread.scheduledWaiting": "En attente",
            "thread.cancelScheduledAria": "Annuler le message prévu pour {when}",

            // --- Photos & files (#165 / #317) --------------------------------------
            "thread.photosAndFiles": "Photos et fichiers",
            "thread.backToConversation": "Retour à la conversation",
            "thread.galleryView": "Affichage",
            "thread.galleryImages": "Images",
            "thread.galleryFiles": "Fichiers",
            "thread.noPhotosLoaded": "Aucune photo chargée pour l'instant.",
            "thread.noPhotosYet": "Aucune photo dans cette conversation.",
            "thread.noFilesLoaded": "Aucun fichier chargé pour l'instant.",
            "thread.noFilesYet": "Aucun fichier dans cette conversation.",
            "thread.loadMore": "Charger plus",
            "thread.loadAnyway": "Charger",
            "thread.fileCantOpen": "Impossible d'ouvrir ce fichier.",
            "thread.reportThisFile": "Signaler ce fichier",
            "thread.reportFileTitle": "Signaler ce fichier ?",
            "thread.reportFileBody":
                "Personne dans votre équipe ne pourra ouvrir {name} tant qu'un "
                + "propriétaire ou un administrateur ne l'aura pas débloqué. Rien "
                + "n'est supprimé.",
            "thread.reportFile": "Signaler le fichier",
            "thread.reportFileFailed":
                "Impossible de signaler ce fichier. Réessayez.",
            "thread.playAudio": "Écouter le message vocal",
            "thread.pauseAudio": "Mettre le message vocal en pause",
            "thread.openAttachment": "Ouvrir {kind}",

            // --- The composer -------------------------------------------------------
            "thread.modeText": "Texto",
            "thread.modeNote": "Note",
            "thread.textPlaceholder": "Texto",
            "thread.notePlaceholder": "Écrire une note interne…",
            "thread.addToMessage": "Ajouter au message",
            "thread.attachPhoto": "Joindre une photo",
            "thread.attachFile": "Joindre un fichier",
            "thread.attachFilesToNote": "Joindre des fichiers à cette note",
            "thread.savedReply": "Réponse enregistrée",
            "thread.sendLater": "Envoyer plus tard",
            "thread.sendMessage": "Envoyer le message",
            "thread.saveNote": "Enregistrer la note",
            "thread.removeAttachment": "Retirer la pièce jointe",
            "thread.removeNamed": "Retirer {name}",
            "thread.attachLimitPhotos":
                "Vous pouvez joindre jusqu'à {max} photos par texto.",
            "thread.attachLimitText":
                "Vous pouvez joindre jusqu'à {max} fichiers par texto.",
            "thread.attachLimitNote": "Une note peut porter jusqu'à 10 fichiers.",
            "thread.photoReadFailed":
                "Impossible de lire cette photo. Joignez-la de nouveau.",
            "thread.sendsAs": "S'envoie ainsi : ",
            "thread.callThemInstead": "Appelez-le plutôt",
            "thread.reportThis": "Signaler ceci",

            // --- The send boundary (#408) -------------------------------------------
            "thread.collisionTitle": "Quelqu'un a déjà répondu",
            "thread.collisionAsk": " Envoyer le vôtre quand même ?",
            "thread.sendAnyway": "Envoyer quand même",
            "thread.letMeLook": "Laissez-moi voir",

            // --- Lou in the composer -------------------------------------------------
            "thread.draftWithLou": "Rédiger avec Lou",
            "thread.finishWithLou": "Terminer avec Lou",
            "thread.drafting": "Rédaction…",
            "thread.lousDrafts": "Les brouillons de Lou",
            "thread.dismiss": "Fermer",
            "thread.louNeedsBusiness":
                "Lou ne sait pas encore ce que vous faites. Dites-le-lui, et les "
                + "brouillons deviendront précis.",

            // --- The dictated wrap-up (#507) -------------------------------------------
            "thread.holdToDictateWrapUp":
                "Maintenez pour dicter un compte rendu",
            "thread.wrapUpHint":
                "Dites ce qui a été convenu après l'appel. Lou transcrit vos mots "
                + "pour que vous les vérifiiez avant de publier la note.",
            "thread.wrapUpTranscribing": "Transcription de ce que vous avez dit…",
            "thread.wrapUpGoAhead": "Allez-y — relâchez quand vous avez terminé",
            "thread.wrapUpGoAheadLeft": "Allez-y — {seconds} s restantes",
            "thread.wrapUpTooShort":
                "Maintenez le micro pendant que vous parlez — c'était trop court "
                + "pour être transcrit.",

            // --- Mentions ---------------------------------------------------------------
            "thread.mentionTeammate": "Mentionner un collègue",
            "thread.noMentionable":
                "Personne de l'équipe ne voit cette conversation.",

            // --- Saved replies (#274 / #475) ---------------------------------------------
            "thread.templates": "Modèles",
            "thread.savedReplies": "Réponses enregistrées",
            "thread.noTemplates":
                "Aucune réponse enregistrée. Créez-les sur le web dans Paramètres.",
            "thread.nothingMatches": "Aucun résultat.",
            "thread.templateHint":
                "Tapez / dans la zone de rédaction pour les ouvrir · partagées avec "
                + "l'équipe",
            "thread.searchTemplates": "Rechercher des modèles…",
            "thread.insert": "Insérer",

            // --- Send later (#233 / #539) --------------------------------------------------
            "thread.sendAt": "Envoyer à",
            "thread.schedule": "Programmer",
            "thread.whichClock": "Quelle heure",
            "thread.workspaceTime": "L'heure de votre espace de travail",
            "thread.quietHoursTitle": "Ça arrive tard chez lui",
            "thread.scheduleAnyway": "Programmer quand même",
            "thread.pickAnotherTime": "Choisir une autre heure",

            // --- Marking up a photo (#294) -------------------------------------------------
            "thread.markupTitle": "Pointer quelque chose",
            "thread.workPhaseAria": "Ce que montrent ces photos",

            // --- Starting a conversation (#183) ---------------------------------------------
            "thread.newTextTitle": "Nouveau texto",
            "thread.numberNotReady": "Votre numéro n'est pas encore prêt.",
            "thread.numberNotReadyBody":
                "Il vous faut un numéro actif pour démarrer une conversation. "
                + "Vérifiez son état dans l'application web.",
            "thread.toLabel": "À",
            "thread.messageLabel": "Message",
            "thread.recipientPlaceholder": "Nom ou numéro de téléphone",
            "thread.clearRecipient": "Effacer le destinataire",
            "thread.nanpOnly": "Numéros américains et canadiens seulement.",
            "thread.noContactMatch":
                "Aucune correspondance dans les contacts. Ceci démarre une nouvelle "
                + "conversation.",
            "thread.willText": "Textera {number}",
            "thread.fromNumber": "De : {number}",
            "thread.sendText": "Envoyer le texto",
            "thread.lateThereTitle": "Il est tard chez lui",
            "thread.lateThereBody": "Il est {time} à ce numéro. Envoyer quand même ?",
            "thread.lateThereUnknown": "entre 20 h et 8 h",
            "thread.wait": "Attendre",
            "thread.theirTimeAskFirst":
                "Il est {time} chez ce client. Nous demanderons avant d'envoyer si tard.",
            "thread.theirTime": "Il est {time} chez lui.",

            // ── #228 pass 2: the composer, the timeline's system lines,
            //    the catch-up and the wrap-up ─────────────────────────────
            "thread.copied": "Copié.",
            "thread.undo": "Annuler",
            "thread.thatFile": "Ce fichier",
            "thread.imageCantBeSent":
                "Cette image ne peut pas être envoyée. Essayez une autre photo.",
            "thread.mmsUnsupportedFile":
                "{name} n'est pas quelque chose qu'un texto peut transporter. "
                + "Essayez une photo, une vidéo, un clip audio, une fiche de contact "
                + "ou un PDF.",
            "thread.mmsFileEmpty": "{name} est vide.",
            "thread.mmsFileTooBig":
                "{name} dépasse 1 Mo, le maximum qu'un texto peut transporter.",
            "thread.fileReadFailedPick":
                "Impossible de lire ce fichier. Choisissez-le de nouveau.",
            "thread.fileSizeReadFailed":
                "Impossible de lire la taille de ce fichier. Choisissez-le de "
                + "nouveau.",
            "thread.fileTypeBlocked":
                "Ce type de fichier n'est pas autorisé. Images, PDF et documents "
                + "seulement.",
            "thread.fileSizeLimit": "Les fichiers peuvent atteindre 25 Mo chacun.",
            "thread.mergeFirstName": "Le prénom du client",
            "thread.mergeAddress": "L'adresse inscrite à sa fiche de contact",
            "thread.mergeJobDay": "Le jour de sa prochaine visite prévue",
            "thread.mergeJobTime": "L'heure de celle-ci",
            "thread.mergeMyName": "Votre prénom",
            "thread.mergeBusinessName": "Le nom de votre entreprise",
            "thread.mergeOurNumber": "Le numéro auquel il répond",
            "thread.serverOnlyTokensNote":
                "Le jour et l'heure se remplissent à l'envoi.",
            "thread.mmsSegments": "MMS · envoyé en {count} parties",
            "thread.sentInOnePart": "Envoyé en 1 partie",
            "thread.sentInParts": "Envoyé en {count} parties",
            "thread.scheduledConfirm": "Envoi {when}.",
            "thread.quietHoursAround": "Il sera environ {hour} chez ce client.",
            "thread.pickerThats": "C'est {time} {clock}",
            "thread.senderClockOwn": "Ceci est votre propre heure. {reassurance}",
            "thread.senderClockApart":
                "Ceci est votre propre heure, et le client est {delta}. "
                + "{reassurance}",
            "thread.clockSame": "à la même heure que vous",
            "thread.clockAnHourAhead": "une heure en avance sur vous",
            "thread.clockAnHourBehind": "une heure en retard sur vous",
            "thread.clockHoursAhead": "{count} heures en avance sur vous",
            "thread.clockHoursBehind": "{count} heures en retard sur vous",
            "thread.theirTimeAbout": "Il est environ {time} chez lui ({source}).",
            "thread.clockFromContact": "inscrit à sa fiche de contact",
            "thread.clockFromAreaCode": "d'après son indicatif régional",
            "thread.clockFromWorkspace":
                "le fuseau horaire de votre espace de travail — nous ne connaissons "
                + "pas le sien",
            "thread.duplicateReplyNamed": "{name} a répondu {ago}.",
            "thread.duplicateReplyAuto": "Une réponse automatique est partie {ago}.",
            "thread.agoJustNow": "à l'instant",
            "thread.agoOneMinute": "il y a 1 minute",
            "thread.agoMinutes": "il y a {count} minutes",
            "thread.agoOneHour": "il y a 1 heure",
            "thread.agoHours": "il y a {count} heures",
            "thread.agoSinceWriting": "depuis que vous avez commencé à écrire",
            "thread.bannerOptedOutTitle": "Ce client s'est désabonné",
            "thread.bannerOptedOutCarrierBody":
                "Il a texté STOP : son fournisseur bloque vos textos. Lui seul peut "
                + "annuler ce blocage, en textant START à votre numéro. Les notes "
                + "internes fonctionnent toujours.",
            "thread.bannerOptedOutManualBody":
                "Quelqu'un l'a marqué comme désabonné. Vous pouvez annuler cela "
                + "dans sa fiche de contact. Les notes internes fonctionnent "
                + "toujours.",
            "thread.bannerSubscriptionTitle": "Les textos sont en pause",
            "thread.bannerSubscriptionBody":
                "Votre abonnement n'est pas actif : les textos sortants sont "
                + "bloqués. Un propriétaire peut corriger cela dans la facturation. "
                + "Les notes internes fonctionnent toujours.",
            "thread.bannerRegistrationPendingTitle":
                "Les textos vers les États-Unis ne sont pas encore approuvés",
            "thread.bannerRegistrationPendingBody":
                "Les fournisseurs examinent encore votre inscription. Les textos "
                + "vers les numéros américains partiront dès son approbation. Les "
                + "notes internes fonctionnent toujours.",
            "thread.bannerUsTextingOffTitle":
                "Les textos vers les États-Unis ne sont pas activés pour cet espace "
                + "de travail",
            "thread.bannerUsTextingOffBody":
                "Ceci est un numéro américain, et texter les numéros américains est "
                + "une option que votre espace de travail n'a pas activée. Un "
                + "propriétaire peut l'ajouter dans les paramètres. Les appels vers "
                + "ce client fonctionnent toujours, et les notes internes aussi.",
            "thread.bannerRegistrationSuspendedTitle":
                "Les textos vers les États-Unis sont en pause",
            "thread.bannerRegistrationSuspendedBody":
                "Le fournisseur a suspendu votre inscription américaine : les "
                + "textos vers les numéros américains ne partiront pas. Nous avons "
                + "été avisés et nous nous en occupons, et vous recevrez un courriel "
                + "dès le rétablissement. Les textos canadiens, les appels et les "
                + "notes internes fonctionnent toujours.",
            "thread.bannerUsageCapTitle": "Vous avez atteint le plafond du mois",
            "thread.bannerUsageCapBody":
                "Les textos sortants sont en pause jusqu'à ce que le plafond soit "
                + "relevé ou que le mois change. Les notes internes fonctionnent "
                + "toujours.",
            "thread.bannerReadOnlyTitle": "Vous avez un accès en lecture seule",
            "thread.bannerReadOnlyBody":
                "Vous pouvez lire cette conversation, mais pas répondre ni laisser "
                + "de notes. Un propriétaire ou un administrateur peut modifier votre "
                + "accès.",
            "thread.bannerNumberAccessTitle":
                "Vous ne pouvez pas texter depuis ce numéro",
            "thread.bannerNumberAccessBody":
                "Vous pouvez lire cette conversation et ajouter des notes internes, "
                + "mais texter ce client exige un accès qu'un propriétaire ou un "
                + "administrateur accorde. Les appels vers ce numéro ne vous "
                + "joindront pas non plus. Demandez-le-leur si vous en avez besoin.",
            "thread.bannerOptOutHintTitle": "Il a demandé à ne plus être contacté",
            "thread.bannerOptOutHintBody":
                "Quelqu'un dans cette conversation a demandé à ne plus être "
                + "contacté. Cette demande est contraignante, peu importe la "
                + "formulation : ne répondez pas à moins d'être certain qu'il ne "
                + "s'agissait pas de cela. Pour arrêter les textos définitivement, le "
                + "client doit texter STOP.",
            "thread.signedOut": "Vous êtes déconnecté.",
            "thread.cantReachLoonext":
                "Impossible de joindre Loonext. Vérifiez votre connexion.",
            "thread.outboxStale":
                "En file d'attente depuis plus d'une journée. La conversation a "
                + "peut-être évolué — envoyez-le maintenant, ou supprimez-le.",
            "thread.outboxMediaLost":
                "La photo de ce message n'est plus sur cet appareil. Envoyez le "
                + "texte seul, ou supprimez-le.",
            "thread.noteFilesAllFailed":
                "La note est enregistrée, mais ses fichiers n'ont pas été "
                + "téléversés.",
            "thread.noteFilesSomeFailed":
                "La note est enregistrée, mais {failed} fichiers sur {total} n'ont "
                + "pas été téléversés.",
            "thread.taskCreated": "Tâche créée.",
            "thread.alreadyHasTask": "Ce message a déjà une tâche.",
            "thread.markedAsSpam": "Marquée comme pourriel.",
            "thread.markedAsNotSpam": "Marquée comme non pourriel. Elle reste fermée.",
            "thread.spamCleared": "Merci. Nous ne signalerons plus celui-ci.",
            "thread.snoozeLeadRemind": "Je vous le rappellerai — de retour",
            "thread.snoozeLeadSnoozed": "Reportée — de retour",
            "thread.reminderCancelled": "Rappel annulé.",
            "thread.backInYourInbox": "De retour dans votre boîte de réception.",
            "thread.audioMessage": "Message audio",
            "thread.audioUnavailable": "Audio indisponible · touchez pour réessayer",
            "thread.louPausedForBilling":
                "Lou est en pause le temps de régler l'abonnement. Un propriétaire "
                + "peut corriger cela dans Facturation.",
            "thread.sysSomeone": "Quelqu'un",
            "thread.sysATeammate": "un membre de l'équipe",
            "thread.sysMovedTo": "{by} a fait passer ceci à {status}",
            "thread.sysStatusChanged": "{by} a changé le statut",
            "thread.sysUnassigned": "{by} a retiré l'assignation de cette conversation",
            "thread.sysAssignedTo": "{by} a assigné celle-ci à {name}",
            "thread.sysTagAdded": "{by} a ajouté l'étiquette « {name} »",
            "thread.sysTagAddedGeneric": "{by} a ajouté une étiquette",
            "thread.sysTagRemoved": "{by} a retiré une étiquette",
            "thread.sysOptedOutSystem": "{name} s'est désabonné des textos",
            "thread.sysOptedOutBy": "{by} a désabonné {name}",
            "thread.sysOptedInSystem": "{name} s'est réabonné",
            "thread.sysOptOutRevoked": "{by} a retiré le désabonnement",
            "thread.sysConsentAttested":
                "{by} a attesté du consentement à texter {name}",
            "thread.sysQuietHours":
                "{by} a envoyé pendant les heures de silence de ce client",
            "thread.sysAppointmentConfirmed": "Le client a confirmé le rendez-vous",
            "thread.sysJobRated": "Le client a noté le travail {score} sur 5",
            "thread.sysSpamMarked": "{by} a marqué ceci comme pourriel",
            "thread.sysSpamUnmarked": "{by} a marqué ceci comme non pourriel",
            "thread.sysMessageDone": "{by} a marqué un message comme fait",
            "thread.sysMessageUndone": "{by} a rouvert un message",
            "thread.sysTaskCreated": "{by} a créé une tâche",
            "thread.sysTaskAssigned": "{by} a assigné une tâche",
            "thread.sysTaskDueSet": "{by} a fixé l'échéance d'une tâche",
            "thread.sysTaskDeleted": "{by} a supprimé une tâche",
            "thread.sysNoteAttachmentAdded": "{by} a joint un fichier à une note",
            "thread.sysNoteAttachmentRemoved": "{by} a retiré un fichier d'une note",
            "thread.sysTaskAttachmentAdded": "{by} a joint un fichier à une tâche",
            "thread.sysTaskAttachmentRemoved": "{by} a retiré un fichier d'une tâche",
            "thread.sysMissedCallFrom": "Appel manqué de {name}",
            "thread.sysAutoReplySent": "Réponse automatique d'absence envoyée",
            "thread.sysPaymentRequested": "{by} a demandé {amount}",
            "thread.sysPaymentRequestedGeneric": "{by} a demandé un paiement",
            "thread.sysPaymentCancelled": "{by} a annulé la demande de {amount}",
            "thread.sysPaymentCancelledGeneric": "{by} a annulé la demande",
            "thread.sysPaymentPaid": "Le client a payé {amount}",
            "thread.sysPaymentPaidGeneric": "Le client a payé",
            "thread.sysPaymentRefunded": "{amount} lui a été remboursé",
            "thread.sysPaymentRefundedGeneric": "L'argent lui a été remboursé",
            "thread.sysPaymentDisputed": "Sa banque a repris {amount}",
            "thread.sysPaymentDisputedGeneric": "Sa banque a repris ce paiement",
            "thread.sysPaymentWithDescription": "{line} — {description}",
            "thread.sysMediaTooLarge":
                "Un fichier envoyé par ce client était trop gros pour être conservé "
                + "— demandez-lui d'en envoyer un plus petit",
            "thread.sysMediaEmpty":
                "Un fichier envoyé par ce client est arrivé vide — demandez-lui de "
                + "l'envoyer de nouveau",
            "thread.sysMediaTypeMismatch":
                "Un fichier envoyé par ce client n'était pas du type qu'il "
                + "annonçait, alors il n'a pas été conservé",
            "thread.sysMediaUnsafe":
                "Un fichier envoyé par ce client contenait quelque chose de "
                + "dangereux, alors il n'a pas été conservé — demandez-lui une photo "
                + "ou un PDF ordinaire",
            "thread.sysMediaUnreadable":
                "Un fichier envoyé par ce client n'a pas pu être vérifié, alors il "
                + "n'a pas été conservé — demandez-lui de l'envoyer de nouveau",
            "thread.sysMediaTooManyKept":
                "Ce message contenait plus de fichiers que nous pouvons conserver — "
                + "les {kept} premiers ont été gardés",
            "thread.sysMediaTooMany":
                "Ce message contenait plus de fichiers que nous pouvons conserver",
            "thread.sysMediaUnsupported":
                "Un fichier envoyé par ce client ne peut pas être affiché ici — "
                + "demandez-lui d'envoyer une photo ou un PDF",
            "thread.sysCalledNoAnswer": "Appel effectué, sans réponse",
            "thread.sysYouCalled": "Vous avez appelé",
            "thread.sysTransferredBy": "{from} a transféré l'appel à {to}",
            "thread.sysTransferredTo": "Appel transféré à {to}",
            "thread.sysTransferred": "Appel transféré",
            "thread.sysLeftVoicemail": "Message vocal laissé",
            "thread.sysWentToVoicemail": "L'appel s'est rendu à la boîte vocale",
            "thread.sysMissedCall": "Appel manqué",
            "thread.sysAnsweredBy": "Appel répondu par {name}",
            "thread.sysAnswered": "Appel répondu",
            "thread.sysWithDuration": "{line} · {duration}",
            "domain.catchUpSectionAsked": "Ce que le client a demandé",
            "domain.catchUpSectionWeSaid": "Ce que votre équipe a répondu",
            "domain.catchUpSectionOpen": "Ce qui reste en suspens",
            "domain.catchUpAttribution":
                "Lou a lu cette conversation. Touchez une ligne pour voir le "
                + "message d'où elle vient.",
            "domain.catchUpDisabled":
                "Les rattrapages sont désactivés pour cet espace de travail. "
                + "Paramètres, Lou permet de les réactiver.",
            "domain.catchUpRateLimited":
                "Cela fait beaucoup de rattrapages d'un coup. Réessayez dans un "
                + "moment.",
            "thread.somethingWentWrongStatus": "Une erreur s'est produite ({status}).",
            "thread.summaryOfferMessages": "{count} messages",
            "thread.summaryOfferQuietDay": "silencieuse depuis un jour",
            "thread.summaryOfferQuietDays": "silencieuse depuis {count} jours",
            "thread.summarySpam":
                "Cette conversation est marquée comme pourriel, alors Lou la saute. "
                + "Retirez la marque pour demander un rattrapage.",
            "thread.summaryTooShort":
                "Il n'y a pas grand-chose ici encore — lire la conversation est "
                + "plus rapide qu'un rattrapage.",
            "thread.summaryOverCap":
                "Les rattrapages de ce mois-ci sont épuisés. Ils reprennent le mois "
                + "prochain. Lisez la conversation.",
            "thread.summaryUnreachable":
                "Impossible de joindre Lou pour l'instant. Réessayez, ou lisez la "
                + "conversation.",
            "thread.summaryUnusable":
                "Rien de ce que Lou a écrit ne concordait avec la conversation, "
                + "alors il n'a rien dit. Lisez la conversation.",
            "thread.summaryForbidden":
                "Votre rôle ne permet pas de demander un rattrapage — ils puisent "
                + "dans le budget d'IA partagé de l'espace de travail. Un "
                + "propriétaire ou un administrateur peut modifier cela, et la "
                + "conversation est entièrement ici.",
            "thread.summaryNotFound":
                "Cette conversation n'est plus là. Fermez-la et rouvrez-la.",
            "thread.summaryNetwork":
                "Impossible de joindre Loonext. Vérifiez votre connexion, puis "
                + "réessayez.",
            "thread.summaryPaused":
                "Les rattrapages sont en pause pour le moment. Réessayez sous peu, "
                + "ou lisez la conversation.",
            "thread.summaryNone":
                "Aucun rattrapage cette fois-ci. Réessayez, ou lisez la "
                + "conversation.",
            "thread.summaryStopNotice":
                "Ce contact a texté STOP. Rien ne peut lui être envoyé, peu importe "
                + "ce qui est écrit ici.",
            "thread.summaryOptedOutNotice":
                "Ce contact est désabonné. Rien ne peut lui être envoyé, peu "
                + "importe ce qui est écrit ici.",
            "thread.summaryLeftAloneNotice":
                "Quelqu'un ici a demandé à ne plus être contacté. Vérifiez la "
                + "conversation avant de répondre.",
            "thread.summaryRecentStretch":
                "Ceci est la partie récente de la conversation, pas la totalité.",
            "thread.wrapUpFailTooLong":
                "C'était plus long que deux minutes. Dites la version courte et Lou "
                + "la transcrira.",
            "thread.wrapUpFailDisabled":
                "La dictée des comptes rendus est désactivée pour cet espace de "
                + "travail. Paramètres, IA permet de la réactiver.",
            "thread.wrapUpFailOverCap":
                "La dictée de ce mois-ci est épuisée. Elle reprend le mois prochain "
                + "— tapez la note entre-temps.",
            "thread.wrapUpFailUnreachable":
                "Impossible de joindre Lou pour l'instant. Réessayez, ou tapez la "
                + "note.",
            "thread.wrapUpFailUnusable":
                "Rien de ce qui est revenu ne ressemble à des mots. Réessayez plus "
                + "près du micro, ou tapez la note.",
            "thread.wrapUpFailDefault":
                "Cela n'est pas revenu sous forme de mots. Tapez la note à la "
                + "place.",
            "thread.wrapUpRefusalCallInProgress":
                "Terminez d'abord l'appel. Lou transcrit ce que vous dites ensuite, "
                + "jamais l'appel.",
            "thread.wrapUpRefusalMicDenied":
                "Loonext a besoin du micro pour prendre un compte rendu. "
                + "Autorisez-le dans Réglages › Loonext, ou tapez la note.",
            "thread.wrapUpRefusalMicJustGranted":
                "Le micro est activé. Maintenez-le et redites-le.",
            "thread.wrapUpRefusalCouldNotStart":
                "Impossible de démarrer l'enregistrement. Tapez la note à la place.",
        ]
    )
}
