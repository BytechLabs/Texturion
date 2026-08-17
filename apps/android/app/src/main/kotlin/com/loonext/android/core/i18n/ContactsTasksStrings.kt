package com.loonext.android.core.i18n

/**
 * #228 — the customer record, the job and the phone call.
 *
 * One section rather than four because the four surfaces share a vocabulary
 * and a translator working through them should see it settle: a *contact* is a
 * `client`, a *task* is a `tâche`, a *conversation* is a `conversation`, and
 * the same words are used on web and iOS so a crew that switches devices does
 * not meet a second product.
 *
 * The register is the one [CommonStrings] sets out: Quebec French,
 * VOUVOIEMENT, accents spelled normally, a space before a colon. Product names
 * (Loonext, Stripe, Telnyx, Lou) and the carrier keywords (STOP, HELP, START,
 * URGENT) are never translated — a carrier matches on the literal word, so a
 * translated STOP is an opt-out that never registers.
 */
object ContactsTasksStrings : AppStrings.Section {
    override val en = mapOf(
        // #228/#291 — the address list. Named the same as iOS so the two
        // phones spell one thing once; the sentences are pinned across all
        // three clients by address-parity.test.ts.
        "contactsTasks.addressPrimary" to
            "Where the van goes",
        "contactsTasks.addressMakePrimary" to
            "Make it the main one",
        "contactsTasks.addressLabelPlaceholder" to
            "Unit 4, Billing, the rooftop…",
        "contactsTasks.addressPlaceholder" to
            "Where the job is",
        "contactsTasks.addressAddAnother" to
            "Add another address",
        // ── Notifications ────────────────────────────────────────────────
        "contactsTasks.notificationsHeading" to "Notifications",
        "contactsTasks.notifEmailTitle" to "Email",
        "contactsTasks.notifEmailSupporting" to
            "An email when a new conversation starts or a customer texts back " +
            "after a quiet spell. Never one per message.",
        "contactsTasks.notifPushTitle" to "Push",
        "contactsTasks.notifPushSupporting" to
            "Notifications on your devices for new texts and missed calls.",
        "contactsTasks.notifOnCallTitle" to "You're on call",
        "contactsTasks.notifDeviceHeading" to "Push on this device",
        "contactsTasks.notifPushUnavailable" to
            "Push isn't available in this build yet. Everything still shows up in the app.",
        "contactsTasks.notifDeviceOnBody" to
            "This device gets a notification when a customer texts or calls.",
        "contactsTasks.notifSystemSettings" to "System settings",
        "contactsTasks.notifDeviceOffBody" to
            "Get a notification on this device when a customer texts or calls, " +
            "even with Loonext closed.",
        "contactsTasks.notifTurnOn" to "Turn on",
        "contactsTasks.notifDeviceBlockedBody" to
            "Notifications are turned off for Loonext in system settings. " +
            "Turn them on there to get pinged.",
        "contactsTasks.notifOpenSettings" to "Open settings",
        "contactsTasks.deliveryGroupEvery" to "Group them every",
        "contactsTasks.deliveryMinutes" to "{minutes} minutes",
        "contactsTasks.notifMarkOneFailed" to "Couldn't mark that read.",
        "contactsTasks.notifMarkAllFailed" to "Couldn't mark all read.",
        "contactsTasks.notifRefreshFailed" to "Couldn't refresh.",
        "contactsTasks.notifLoadOlderFailed" to "Couldn't load older notifications.",
        "contactsTasks.notifUnreadCount" to "{count} unread",
        "contactsTasks.notifReadAll" to "Read all",
        "contactsTasks.notifCaughtUp" to "You're all caught up.",
        "contactsTasks.notifLoadingOlder" to "Loading older…",
        "contactsTasks.notifShowOlder" to "Show older",
        "contactsTasks.notifMirrorHint" to
            "Push and email mirror these · Settings › Notifications",
        "contactsTasks.notifStateUnread" to "Unread",
        "contactsTasks.notifStateRead" to "Read",
        "contactsTasks.notifNewMessage" to "New message",
        "contactsTasks.notifNewMessageFrom" to "New message from {who}",
        "contactsTasks.notifAssigned" to "Conversation assigned to you",
        "contactsTasks.notifAssignedFrom" to "{who} assigned to you",
        "contactsTasks.notifTaskAssigned" to "Task assigned to you",
        "contactsTasks.notifTaskAssignedFrom" to "Task assigned · {who}",
        "contactsTasks.notifMissedCall" to "Missed call",
        "contactsTasks.notifMissedCallFrom" to "Missed call from {who}",
        "contactsTasks.notifMention" to "You were mentioned",
        "contactsTasks.notifMentionFrom" to "You were mentioned · {who}",
        "contactsTasks.notifUpdate" to "Update",
        "contactsTasks.notifUpdateFrom" to "Update · {who}",
        "contactsTasks.notifPausedBoth" to "Notifications are paused",
        "contactsTasks.notifPausedEmail" to "Email alerts are paused",
        "contactsTasks.notifPausedPush" to "Push alerts are paused",
        "contactsTasks.notifPausedStillPush" to " You're still getting push.",
        "contactsTasks.notifPausedResumes" to " They resume {when}.",
        "contactsTasks.notifPausedBody" to
            "{what} for today — this workspace hit its daily limit.{still}{resumes} " +
            "Your messages are all still here.",

        // ── Tasks: the list, the board, the calendar and the map ─────────
        "contactsTasks.tasksTitle" to "Tasks",
        "contactsTasks.taskHeading" to "Task",
        "contactsTasks.filter" to "Filter",
        "contactsTasks.hideSearch" to "Hide search",
        "contactsTasks.searchTaskTitles" to "Search task titles",
        "contactsTasks.clearSearch" to "Clear search",
        "contactsTasks.viewList" to "List view",
        "contactsTasks.viewBoard" to "Board view",
        "contactsTasks.viewCalendar" to "Calendar view",
        "contactsTasks.viewMap" to "Map view",
        "contactsTasks.tabOpen" to "Open",
        "contactsTasks.tabMine" to "Mine",
        "contactsTasks.tabAll" to "All",
        "contactsTasks.tabDone" to "Done",
        "contactsTasks.dueOverdue" to "Overdue",
        "contactsTasks.dueToday" to "Due today",
        "contactsTasks.dueThisWeek" to "Due this week",
        "contactsTasks.assignee" to "Assignee",
        "contactsTasks.clearAssigneeFilter" to "Clear assignee filter",
        "contactsTasks.unassigned" to "Unassigned",
        "contactsTasks.unassign" to "Unassign",
        "contactsTasks.assignTo" to "Assign to {who}",
        "contactsTasks.you" to "You",
        "contactsTasks.youSuffix" to " (you)",
        "contactsTasks.teammate" to "Teammate",
        "contactsTasks.selected" to "Selected",
        "contactsTasks.searchTeammates" to "Search teammates",
        "contactsTasks.noTeammatesMatch" to "No teammates match.",
        "contactsTasks.listEmptyFiltered" to "Nothing on this list.",
        "contactsTasks.listEmpty" to
            "No tasks yet. Promote a message from its ⋯ menu in a conversation.",
        "contactsTasks.loadMore" to "Load more",
        "contactsTasks.loading" to "Loading…",
        "contactsTasks.columnToDo" to "To do",
        "contactsTasks.columnToDoEmpty" to "Nothing to do here.",
        "contactsTasks.columnDone" to "Done",
        "contactsTasks.columnDoneEmpty" to "Nothing marked done yet.",
        "contactsTasks.moveToDone" to "Move to Done",
        "contactsTasks.moveToToDo" to "Move to To do",
        "contactsTasks.markDone" to "Mark done",
        "contactsTasks.markNotDone" to "Mark not done",
        "contactsTasks.swipeNotDone" to "Not done",
        "contactsTasks.dueDate" to "Due date",
        "contactsTasks.overdue" to "Overdue",
        "contactsTasks.dueWhen" to "Due {when}",
        "contactsTasks.overdueDueWhen" to "Overdue · due {when}",
        "contactsTasks.today" to "Today",
        "contactsTasks.tomorrow" to "Tomorrow",
        "contactsTasks.todayAtTime" to "today {time}",
        "contactsTasks.clearSelection" to "Clear selection",
        "contactsTasks.moreBulkActions" to "More bulk actions",
        "contactsTasks.selectThese" to "Select these {count}",
        "contactsTasks.selectAllMatching" to "Select all matching",
        "contactsTasks.bulkFailed" to "That didn't go through. Nothing was changed.",

        // Calendar
        "contactsTasks.calendarEmptyRange" to
            "Nothing is scheduled in this range. A task appears here once it has a " +
            "due date. Set one from the task's detail screen.",
        "contactsTasks.calendarScheduled" to "{scheduled} scheduled",
        "contactsTasks.calendarUndated" to "{undated} without a due date",
        "contactsTasks.calendarScheduledAndUndated" to
            "{scheduled} scheduled · {undated} without a due date",
        "contactsTasks.calendarNothingDueThisDay" to "Nothing due this day.",
        "contactsTasks.calendarPreviousMonth" to "Previous month",
        "contactsTasks.calendarNextMonth" to "Next month",
        "contactsTasks.calendarDayCellOne" to "{date}, {count} task",
        "contactsTasks.calendarDayCellMany" to "{date}, {count} tasks",
        "contactsTasks.weekdayMon" to "Mon",
        "contactsTasks.weekdayTue" to "Tue",
        "contactsTasks.weekdayWed" to "Wed",
        "contactsTasks.weekdayThu" to "Thu",
        "contactsTasks.weekdayFri" to "Fri",
        "contactsTasks.weekdaySat" to "Sat",
        "contactsTasks.weekdaySun" to "Sun",

        // Map
        "contactsTasks.mapCounts" to "{located} on the map",
        "contactsTasks.mapCountsWithMissing" to
            "{located} on the map · {missing} without a location",
        "contactsTasks.mapMissingCount" to "{missing} without a location",
        "contactsTasks.mapNoLocatedTasks" to "No located tasks yet.",
        "contactsTasks.mapAddAnAddress" to
            "Add an address to a contact and its tasks appear here.",
        "contactsTasks.mapMyLocation" to "My location",
        "contactsTasks.mapThisLocation" to "This location",
        "contactsTasks.mapTasksHere" to "{count} tasks here",
        "contactsTasks.mapOpenTask" to "Open task",
        "contactsTasks.mapDirections" to "Directions",
        "contactsTasks.mapMore" to "+{count} more",

        // Task detail
        "contactsTasks.taskGone" to "This task doesn't exist or was removed.",
        "contactsTasks.backToTasks" to "Back to tasks",
        "contactsTasks.taskActions" to "Task actions",
        "contactsTasks.deleteTask" to "Delete task",
        "contactsTasks.deleteForbidden" to
            "Only the task's creator or an admin can delete it.",
        "contactsTasks.deleteTaskTitle" to "Delete this task?",
        "contactsTasks.deleteTaskBody" to
            "It carries {what}. The conversation and its messages stay; the done " +
            "mark on the source message is kept.",
        "contactsTasks.discussionNotes" to "discussion notes",
        "contactsTasks.filesLower" to "files",
        "contactsTasks.andJoiner" to " and ",
        "contactsTasks.keepTask" to "Keep task",
        "contactsTasks.taskTitlePlaceholder" to "Task title",
        "contactsTasks.createdWhen" to "Created {when}",
        "contactsTasks.createdBy" to "by {who}",
        "contactsTasks.due" to "Due",
        "contactsTasks.noDueDate" to "No due date",
        "contactsTasks.overdueDot" to "Overdue · {due}",
        "contactsTasks.clearDueDate" to "Clear due date",
        "contactsTasks.dueTime" to "Due time",
        "contactsTasks.setDueDate" to "Set due date",
        "contactsTasks.next" to "Next",
        "contactsTasks.remind" to "Remind",
        "contactsTasks.remindOff" to "Off for this job",
        "contactsTasks.remindWorkspace" to "Uses your workspace reminders",
        "contactsTasks.confirmedByCustomer" to "They confirmed they'll be there.",
        "contactsTasks.confirmedByCrew" to "Marked confirmed by your crew.",
        "contactsTasks.taskNoAccess" to
            "This task is linked to a number you don't have access to. You can see " +
            "the task, but not its messages, files, or discussion. Ask an owner or " +
            "admin for access.",
        "contactsTasks.aPhoto" to "A photo",
        "contactsTasks.sourceMessageWhen" to "Source message · {when}",
        "contactsTasks.openConversationArrow" to "Open conversation →",
        "contactsTasks.description" to "Description",
        "contactsTasks.descriptionPlaceholder" to "Add details teammates should know",
        "contactsTasks.files" to "Files",
        "contactsTasks.activity" to "Activity",
        "contactsTasks.activityEmpty" to
            "No activity yet. Post a note below to start a discussion.",
        "contactsTasks.activityLine" to "{sentence} · {when}",
        "contactsTasks.activityCreated" to "{by} turned this into a task",
        "contactsTasks.activityUnassigned" to "{by} unassigned this task",
        "contactsTasks.activityAssignedTo" to "{by} assigned this to {who}",
        "contactsTasks.activityReassigned" to "{by} reassigned this task",
        "contactsTasks.activityDueCleared" to "{by} cleared the due date",
        "contactsTasks.activityDueSet" to "{by} set the due date to {when}",
        "contactsTasks.activityDeleted" to "{by} removed this task",
        "contactsTasks.activityAttached" to "{by} attached a file",
        "contactsTasks.activityAttachmentRemoved" to "{by} removed a file",
        "contactsTasks.internalNote" to "Internal note",
        "contactsTasks.photo" to "Photo",
        "contactsTasks.file" to "File",
        "contactsTasks.couldntLoad" to "Couldn't load",
        "contactsTasks.attachFiles" to "Attach files",
        "contactsTasks.postNote" to "Post note",
        "contactsTasks.noteComposerPlaceholder" to "Add a note for the crew…",
        "contactsTasks.noteFilesCap" to "Up to {count} files per note.",
        "contactsTasks.noteFileTooBig" to "Files must be 25 MB or less.",
        "contactsTasks.noteUploadFailedOne" to
            "The note posted, but {count} file didn't upload. Retry from the note " +
            "in the thread.",
        "contactsTasks.noteUploadFailedMany" to
            "The note posted, but {count} files didn't upload. Retry from the note " +
            "in the thread.",
        "contactsTasks.removeNamed" to "Remove {name}",

        // The task's job address
        "contactsTasks.address" to "Address",
        "contactsTasks.clear" to "Clear",
        "contactsTasks.reset" to "Reset",
        "contactsTasks.saveAddress" to "Save address",
        "contactsTasks.hideAddress" to "Hide address",
        "contactsTasks.showAddress" to "Show address",
        "contactsTasks.addrStreet" to "Street",
        "contactsTasks.addrUnit" to "Unit / suite",
        "contactsTasks.addrCity" to "City",
        "contactsTasks.addrState" to "State / province",
        "contactsTasks.addrPostalCode" to "Postal code",

        // Job photos (#294)
        "contactsTasks.photosFromCustomer" to "From the customer",
        "contactsTasks.photosFromCrew" to "Added by the crew",
        "contactsTasks.jobPhotosShare" to "Share these photos",
        "contactsTasks.jobPhotosMakingLink" to "Making a link…",
        "contactsTasks.jobPhotosExpiry" to
            "Anyone with this link can see the photos until {when}.",
        "contactsTasks.jobPhotosTurnOff" to "Turn this link off",
        "contactsTasks.jobPhotosClipboardLabel" to "Job photos",
        "contactsTasks.copy" to "Copy",

        // ── Contacts: the list, the record and the merge ─────────────────
        "contactsTasks.contactsTitle" to "Contacts",
        "contactsTasks.contactHeading" to "Contact",
        "contactsTasks.newContact" to "New contact",
        "contactsTasks.addContact" to "Add contact",
        "contactsTasks.adding" to "Adding…",
        "contactsTasks.add" to "Add",
        "contactsTasks.done" to "Done",
        "contactsTasks.doneEditing" to "Done",
        "contactsTasks.change" to "Change",
        "contactsTasks.working" to "Working…",
        "contactsTasks.saveFailed" to "Couldn't save. Check your connection.",
        "contactsTasks.optional" to "Optional",
        "contactsTasks.labelField" to "Label",
        "contactsTasks.numberField" to "Number",
        "contactsTasks.phoneField" to "Phone",
        "contactsTasks.nameField" to "Name",
        "contactsTasks.notesField" to "Notes",
        "contactsTasks.businessField" to "Business",
        "contactsTasks.emailField" to "Email",
        "contactsTasks.nanpHint" to "Enter a 10-digit US or Canada number.",
        "contactsTasks.addAName" to "Add a name",
        "contactsTasks.addAnAddress" to "Add an address",
        "contactsTasks.businessPlaceholder" to "Who they work for, if anyone",
        "contactsTasks.emailPlaceholder" to "For quotes and receipts",
        "contactsTasks.notesPlaceholder" to
            "Gate code, dog's name, preferred arrival window…",
        "contactsTasks.notesCaption" to "Saves automatically · visible to the crew",
        "contactsTasks.searchNameOrNumber" to "Search name or number",
        "contactsTasks.searchNameOrNumberHint" to "Search name or number…",
        "contactsTasks.noMatchesFor" to "No matches for \"{query}\".",
        "contactsTasks.noContactsYet" to
            "No contacts yet. They're added automatically when someone texts you, " +
            "or add one yourself.",
        "contactsTasks.optedOut" to "Opted out",
        "contactsTasks.contactGone" to "This contact doesn't exist or was removed.",
        "contactsTasks.backToContacts" to "Back to contacts",
        "contactsTasks.copyNumber" to "Copy number",
        "contactsTasks.openConversation" to "Open conversation",
        "contactsTasks.conversation" to "Conversation",
        "contactsTasks.conversationsSection" to "Conversations",
        "contactsTasks.updatedWhen" to "Updated {when}",
        "contactsTasks.textAction" to "Text",
        "contactsTasks.call" to "Call",
        "contactsTasks.calling" to "Calling…",
        "contactsTasks.micNeeded" to
            "Loonext needs the microphone to place calls. Allow it in " +
            "Settings › Apps › Loonext › Permissions.",
        "contactsTasks.optedOutBanner" to
            "This customer opted out of texting. Sends to them are blocked.",
        // STOP and START are carrier keywords: a carrier matches on the literal
        // word, so they are never translated.
        "contactsTasks.optedOutByCarrier" to
            "They texted STOP, so their carrier is blocking your texts. Only they " +
            "can undo it, by texting START to your number.",
        "contactsTasks.optedOutByHand" to
            "Someone recorded this by hand, so undoing it here is all it takes.",
        "contactsTasks.markOptedInAgain" to "Mark opted in again",
        "contactsTasks.optOut" to "Opt out",
        "contactsTasks.optOutContact" to "Opt out this contact",
        "contactsTasks.optOutCaption" to "Blocks all texting to this number",
        "contactsTasks.optOutTitle" to "Opt out this contact?",
        "contactsTasks.optOutBody" to
            "All texting to {number} is blocked until they're opted back in. Use " +
            "this when a customer asks you to stop texting them.",
        "contactsTasks.deleteContact" to "Delete contact",
        "contactsTasks.deleteContactCaption" to
            "Texting history stays. They reappear if they text you again",
        "contactsTasks.deleteContactTitle" to "Delete this contact?",
        "contactsTasks.deleteContactBody" to
            "They disappear from your contact list. Conversations and messages " +
            "stay, and the contact comes back automatically if they text you again.",
        "contactsTasks.keepContact" to "Keep contact",
        "contactsTasks.theirTime" to "Their time",
        "contactsTasks.theirLanguage" to "Their language",
        "contactsTasks.sameAsWorkspace" to "Same as your workspace",
        "contactsTasks.setByCrew" to "Set by your crew",
        "contactsTasks.useAreaCode" to "Use their area code",
        "contactsTasks.localeCaveat" to
            "Automated texts only: the away reply, the missed-call text back, the " +
            "urgent reply, and the rating ask. Anything you type is sent exactly " +
            "as you wrote it.",

        // The phone's own address book (#459)
        "contactsTasks.onThisPhone" to "On this phone",
        "contactsTasks.devicePhoneNoMatch" to "Nobody here matches.",
        "contactsTasks.devicePhoneOwn" to
            "Your own contacts. They stay on your phone.",
        "contactsTasks.devicePhoneAsk" to
            "Let Loonext read your phone's contacts and they show up here, so you " +
            "can text somebody without adding them first. They stay on your phone.",
        "contactsTasks.showMyPhoneContacts" to "Show my phone contacts",
        "contactsTasks.showAllFromPhone" to "Show all from this phone",
        "contactsTasks.addToContacts" to "Add {name} to contacts",

        // Import and export
        "contactsTasks.importing" to "Importing…",
        "contactsTasks.importCsvOrVcard" to "Import CSV or vCard",
        "contactsTasks.csvFile" to "CSV file",
        "contactsTasks.vcardFile" to "vCard file (.vcf)",
        "contactsTasks.exporting" to "Exporting…",
        "contactsTasks.exportCsv" to "Export CSV",
        "contactsTasks.contactsExported" to "Contacts exported.",
        "contactsTasks.exportFailed" to "The export didn't go through. Try again.",
        "contactsTasks.importFinished" to "Import finished",
        "contactsTasks.importImported" to "{count} imported",
        "contactsTasks.importUpdated" to "{count} updated",
        "contactsTasks.importSkipped" to "{count} skipped",
        "contactsTasks.importSkippedRows" to "Skipped rows:",
        "contactsTasks.importRowLine" to "{word} {row} · {reason}",

        // Duplicates and merging (#246)
        "contactsTasks.duplicatesOnePair" to "These two look like the same customer",
        "contactsTasks.duplicatesManyPairs" to
            "{count} pairs look like the same customer",
        "contactsTasks.duplicatesBlurb" to
            "Merging keeps every message, task and photo from both, under one record.",
        "contactsTasks.duplicatesPair" to "{a} and {b}",
        "contactsTasks.merge" to "Merge",
        "contactsTasks.merging" to "Merging…",
        "contactsTasks.merged" to "Merged.",
        "contactsTasks.mergedOptedOut" to
            "Merged. This customer is opted out, so nothing sends to either number.",
        "contactsTasks.mergeDialogTitle" to "Merge these two customers",
        "contactsTasks.mergeDialogBody" to
            "Everything from both — messages, tasks, photos, notes — ends up under " +
            "the record you keep. Both phone numbers keep working.",
        "contactsTasks.mergeWhichToKeep" to "Which one to keep",
        "contactsTasks.mergeDirection" to
            "{folded} stops being a separate customer. Its history moves to {survivor}.",

        // The contact's calls and history sections
        "contactsTasks.callsSection" to "Calls",
        "contactsTasks.historySection" to "History",
        "contactsTasks.noCallsYet" to "No calls with this contact yet.",
        "contactsTasks.timelineEmpty" to
            "Texts, calls and jobs for this customer will collect here.",
        "contactsTasks.showMore" to "Show more",
        "contactsTasks.showEarlier" to "Show earlier",
        "contactsTasks.callBack" to "Call back",
        "contactsTasks.textBack" to "Text back",
        "contactsTasks.playVoicemail" to "Play voicemail",
        "contactsTasks.pauseVoicemail" to "Pause voicemail",
        "contactsTasks.voicemailPlayFailed" to "Couldn't play this voicemail.",

        // ── Calls: the log, the keypad, the ring and the live call ───────
        "contactsTasks.filterAll" to "All",
        "contactsTasks.filterMissed" to "Missed",
        "contactsTasks.filterVoicemail" to "Voicemail",
        "contactsTasks.noMissedCalls" to "No missed calls.",
        "contactsTasks.noVoicemails" to "No voicemails.",
        "contactsTasks.noCallsYetLog" to
            "No calls yet. When customers call your number, they land here.",
        "contactsTasks.missedCallAutoText" to
            "Missed calls text the customer back automatically",
        "contactsTasks.dialANumber" to "Dial a number",
        "contactsTasks.readyToRing" to "Ready to ring",
        "contactsTasks.offlineRetry" to "Offline · retry",
        "contactsTasks.ongoing" to "Ongoing",
        "contactsTasks.earlier" to "Earlier",
        "contactsTasks.yesterday" to "Yesterday",
        "contactsTasks.connected" to "Connected",
        "contactsTasks.connecting" to "Connecting…",
        "contactsTasks.reconnectingLine" to "Reconnecting your line…",
        "contactsTasks.incomingCallEyebrow" to "INCOMING CALL",
        "contactsTasks.decline" to "Decline",
        "contactsTasks.answer" to "Answer",
        "contactsTasks.hangUp" to "Hang up",
        "contactsTasks.dismiss" to "Dismiss",
        "contactsTasks.phaseIncoming" to "Incoming call",
        "contactsTasks.phaseCalling" to "Calling…",
        "contactsTasks.phaseOnHold" to "On hold",
        "contactsTasks.phaseEnded" to "Call ended",

        // The keypad
        "contactsTasks.fromNumber" to "From {number}",
        "contactsTasks.lineReady" to "Line ready · {number}",
        "contactsTasks.enterANumber" to "Enter a number",
        "contactsTasks.matchNamesFromContacts" to "Match names from your contacts",
        "contactsTasks.sendMessageInstead" to "Send a message instead",
        "contactsTasks.deleteLastDigit" to "Delete last digit",
        "contactsTasks.openContact" to "Open contact",

        // The live call
        "contactsTasks.hide" to "Hide",
        "contactsTasks.mute" to "Mute",
        "contactsTasks.unmute" to "Unmute",
        "contactsTasks.keypad" to "Keypad",
        "contactsTasks.hold" to "Hold",
        "contactsTasks.resume" to "Resume",
        "contactsTasks.transfer" to "Transfer",
        "contactsTasks.swap" to "Swap",
        "contactsTasks.note" to "Note",
        "contactsTasks.speaker" to "Speaker",
        "contactsTasks.bluetooth" to "Bluetooth",
        "contactsTasks.endCall" to "End call",
        "contactsTasks.allowMicToAnswer" to
            "Allow microphone access to answer this call.",
        "contactsTasks.callNoteEyebrow" to "CALL NOTE · SAVES TO THE THREAD",
        "contactsTasks.addNoteAction" to "Add a note in the conversation",
        "contactsTasks.addNotePlaceholder" to "Add a note in the conversation…",
        "contactsTasks.transferThisCall" to "Transfer this call",
        "contactsTasks.noTeammatesAvailable" to
            "No teammates can take this call right now.",
        "contactsTasks.transferSnapBack" to
            "If they decline, the call snaps back to you.",
        "contactsTasks.onACall" to "On a call",
        "contactsTasks.available" to "Available",
        "contactsTasks.ringing" to "Ringing…",
        "contactsTasks.leavingVoicemail" to "Leaving a voicemail",
        "contactsTasks.withMember" to "With {who}",
        "contactsTasks.onTheLine" to "On the line",

        // Who added this record, and who last changed it (#191)
        "contactsTasks.addedBy" to "Added by {who}",
        "contactsTasks.addedByOn" to "Added by {who} on {date}",
        "contactsTasks.editedBy" to "Edited by {who}",

        // ── The consent card (#226) ──────────────────────────────────────
        // Copied from web's `appShell.ts` (`contactNoConsent` and friends):
        // the same card, in the same words, so a crew reading it on the phone
        // and then on the laptop is not told two things about one customer.
        "contactsTasks.consentNone" to
            "No consent recorded yet. It's recorded when they text you first, " +
            "or when you send them their first text, which attests they asked for it.",
        "contactsTasks.consentTextedFirst" to "Texted you first",
        "contactsTasks.consentRecorded" to "Consent recorded",
        "contactsTasks.consentRecordedBy" to "Consent recorded by {name}",

        // ── The filtered-empty list (#291) ───────────────────────────────
        // NOT the no-contacts-yet line: under a filter those customers are
        // excluded, not missing. Copied from web's `filteredEmpty*`.
        "contactsTasks.filterEmptyTitle" to "Nobody matches that yet",
        "contactsTasks.filterEmptyBody" to
            "No customer has that answer on file. Clear the filter to see everyone.",

        // ── The map with no basemap (#428) ───────────────────────────────
        // Copied from web's `misc.mapNoBasemap`. The provider's ATTRIBUTION
        // beside it is never translated — a reworded credit is a licensing
        // problem rather than a copy change.
        "contactsTasks.mapNoBasemap" to
            "Job pins are exact. The street background needs a map provider " +
            "configured, which an owner can do in one setting.",

        // ── The contact's history, row by row (#324) ─────────────────────
        // All twelve copied from web's `contacts.ts` `timeline*` keys: one
        // chronology, described the same way on both clients.
        "contactsTasks.timelineJob" to "Job",
        "contactsTasks.timelineCallAnsweredBy" to "Call answered by {name}",
        "contactsTasks.timelineCallAnswered" to "Call answered",
        "contactsTasks.timelineVoicemail" to "Voicemail",
        "contactsTasks.timelineMissedCall" to "Missed call",
        "contactsTasks.timelineConversation" to "Conversation",
        "contactsTasks.timelineDone" to "Done",
        "contactsTasks.timelineDue" to "Due {date}",
        "contactsTasks.timelineOpen" to "Open",
        "contactsTasks.timelineTalkedFor" to "Talked for {duration}",
        "contactsTasks.timelineNoAnswer" to "No answer",
        "contactsTasks.timelineClosed" to "Closed",

        // ── Bulk import: the attestation sheet (#226/#248) ───────────────
        // THE CLAIM is `importAttestation`, copied from web's
        // `consentLabelFile`. It is never pre-ticked on any surface, and the
        // wording IS what gets posted — a claim whose wording drifts from what
        // it authorises is worse than no claim.
        "contactsTasks.importBeforeTitle" to "Before you import",
        "contactsTasks.importBeforeLead" to
            "You are about to upload other people's phone numbers into this workspace.",
        "contactsTasks.importAttestation" to
            "Everyone in this file agreed to be texted by this business.",
        "contactsTasks.importRecorded" to
            "For anyone with no consent recorded yet, this is stored as your " +
            "attestation. Contacts who already have one keep it.",
        "contactsTasks.importChooseFile" to "Choose file",

        // The bounds, with both figures derived from the shipped constants and
        // neither typed. One key per door because the two caps differ, and a
        // sentence quoting the CSV cap at a vCard promises a file the server
        // refuses. STOP is a carrier keyword and is never translated.
        "contactsTasks.importLimitsCsv" to "Up to {count} rows, {size} MB.",
        "contactsTasks.importLimitsVcard" to "Up to {count} cards, {size} MB.",
        "contactsTasks.importTooLargeCsv" to "CSV files must be {size} MB or less.",
        "contactsTasks.importTooLargeVcard" to "vCard files must be {size} MB or less.",
        "contactsTasks.importOptOutNoteCsv" to
            "A STOP always survives an import, and an opted-out column in " +
            "your file blocks those people here too.",
        "contactsTasks.importOptOutNoteVcard" to
            "A STOP always survives an import. A card marked do-not-text " +
            "blocks that person here too.",

        // How the server's per-entry errors are labelled, per door. A refusal
        // list saying "Row 12" over a .vcf points at a line the file has not.
        "contactsTasks.importRowWordRow" to "Row",
        "contactsTasks.importRowWordCard" to "Card",

        // ── Bulk import: the whole file refused ──────────────────────────
        // "Not imported" rather than "failed": nothing is broken and nothing
        // landed, and the difference decides what somebody does next.
        "contactsTasks.importRefusedTitle" to "This file was not imported",
        "contactsTasks.importRefusedEdit" to "Change columns",
        "contactsTasks.importAndMore" to "…and {count} more.",
        "contactsTasks.importOptedOutOne" to
            "{count} customer in this file had already opted out",
        "contactsTasks.importOptedOutMany" to
            "{count} customers in this file had already opted out",

        // ── Bulk import: the per-column step (#248 round 3) ──────────────
        // Every column of the file is asked about, including the recognised
        // ones and the empty ones. `importWrongColumn` names the CONSEQUENCE
        // rather than the mechanism, and it derives the answer's own label
        // through {answer} rather than retyping it.
        "contactsTasks.importColumnsTitle" to "What is in this file?",
        "contactsTasks.importColumnsLead" to
            "This import does not guess what a column means — a do-not-contact " +
            "column read as nothing texts somebody who asked this business " +
            "to stop. Say what each column is, or ignore it on purpose.",
        "contactsTasks.importWrongColumn" to
            "If a column marks who must not be texted, choose " +
            "“{answer}” — ignoring it would text everyone it was protecting.",
        "contactsTasks.importConfirm" to "Import",
        "contactsTasks.importUnansweredColumns" to
            "Every column needs an answer before this file can import.",
        "contactsTasks.importNotRecognised" to "Not recognised",
        "contactsTasks.importRecognisedHeading" to "Recognised — change any that are wrong",
        "contactsTasks.importDuplicateHint" to
            "Two columns are both marked “{answer}”. A contact has one.",
        "contactsTasks.importChoose" to "Choose…",
        "contactsTasks.importColumnPosition" to "Column {number}",
        "contactsTasks.importColumnNoHeader" to "(no header)",
        "contactsTasks.importColumnQuoted" to "“{header}”",
        "contactsTasks.importValuesEmpty" to "Every row leaves this column empty.",
        // "include", never "holds": these are the first distinct values, and
        // claiming to have listed the column would be a claim nobody checked.
        "contactsTasks.importValuesInclude" to "Values include: {samples}",
        "contactsTasks.importValuesAndMore" to ", and {count} more",
        "contactsTasks.importShowAllValues" to "Show all {count} values",
        "contactsTasks.importShowFewerValues" to "Show fewer values",
        "contactsTasks.importValueCeiling" to
            "Showing {shown} of the {total} different answers in this column.",
        "contactsTasks.importProgress" to "{answered} of {total} answered",

        // What each answer a column may carry is called. `importActionPhone`,
        // `importActionFirstName` and `importActionLastName` are copied from
        // web's `answer*`; the other four reuse the field labels above.
        "contactsTasks.importActionPhone" to "Phone number",
        "contactsTasks.importActionFirstName" to "First name",
        "contactsTasks.importActionLastName" to "Last name",
        "contactsTasks.importActionOptedOut" to "Do not text",
        "contactsTasks.importActionIgnore" to "Ignore this column",

        // ── Bulk import: the vCard door's own question ───────────────────
        "contactsTasks.importPropertiesTitle" to "What do these cards carry?",
        "contactsTasks.importPropertiesLead" to
            "These cards carry information this import does not read. A card's " +
            "categories, a note saying they asked us to stop, or a label " +
            "typed beside a number are where a .vcf says do-not-text — so a " +
            "property read as nothing texts somebody who asked this business " +
            "to stop.",
        "contactsTasks.importParameterNote" to
            "A name with a “;” in it is a label attached to the property before " +
            "it, and the label carries free text of its own — “DO NOT CALL” " +
            "is one of the things people type there.",
        "contactsTasks.importPropertiesCoarse" to
            "“{answer}” blocks every card carrying that property, whatever it " +
            "says on the card. Not texting somebody is the only direction this " +
            "import is allowed to be wrong in.",
        "contactsTasks.importUnansweredProperties" to
            "Every one of these needs an answer before the file can import.",
        "contactsTasks.importPropertyIgnore" to "Says nothing about texting",
        "contactsTasks.importPropertyOptedOut" to "Do not text these cards",
    )

    override val frCA = mapOf(
        // #228/#291 — the address list. Named the same as iOS so the two
        // phones spell one thing once; the sentences are pinned across all
        // three clients by address-parity.test.ts.
        "contactsTasks.addressPrimary" to
            "Où le camion se rend",
        "contactsTasks.addressMakePrimary" to
            "En faire l'adresse principale",
        "contactsTasks.addressLabelPlaceholder" to
            "Unité 4, Facturation, le toit…",
        "contactsTasks.addressPlaceholder" to
            "Où se fait la tâche",
        "contactsTasks.addressAddAnother" to
            "Ajouter une autre adresse",
        // ── Notifications ────────────────────────────────────────────────
        "contactsTasks.notificationsHeading" to "Notifications",
        "contactsTasks.notifEmailTitle" to "Courriel",
        "contactsTasks.notifEmailSupporting" to
            "Un courriel quand une conversation commence ou qu'un client répond " +
            "après une accalmie. Jamais un par texto.",
        "contactsTasks.notifPushTitle" to "Notifications poussées",
        "contactsTasks.notifPushSupporting" to
            "Des notifications sur vos appareils pour les nouveaux textos et les " +
            "appels manqués.",
        "contactsTasks.notifOnCallTitle" to "Vous êtes de garde",
        "contactsTasks.notifDeviceHeading" to "Notifications sur cet appareil",
        "contactsTasks.notifPushUnavailable" to
            "Les notifications poussées ne sont pas encore offertes dans cette " +
            "version. Tout reste visible dans l'application.",
        "contactsTasks.notifDeviceOnBody" to
            "Cet appareil reçoit une notification quand un client texte ou appelle.",
        "contactsTasks.notifSystemSettings" to "Paramètres du système",
        "contactsTasks.notifDeviceOffBody" to
            "Recevez une notification sur cet appareil quand un client texte ou " +
            "appelle, même si Loonext est fermé.",
        "contactsTasks.notifTurnOn" to "Activer",
        "contactsTasks.notifDeviceBlockedBody" to
            "Les notifications sont désactivées pour Loonext dans les paramètres " +
            "du système. Activez-les là pour être averti.",
        "contactsTasks.notifOpenSettings" to "Ouvrir les paramètres",
        "contactsTasks.deliveryGroupEvery" to "Les regrouper toutes les",
        "contactsTasks.deliveryMinutes" to "{minutes} minutes",
        "contactsTasks.notifMarkOneFailed" to "Impossible de marquer comme lu.",
        "contactsTasks.notifMarkAllFailed" to "Impossible de tout marquer comme lu.",
        "contactsTasks.notifRefreshFailed" to "Impossible d'actualiser.",
        "contactsTasks.notifLoadOlderFailed" to
            "Impossible de charger les notifications précédentes.",
        "contactsTasks.notifUnreadCount" to "{count} non lues",
        "contactsTasks.notifReadAll" to "Tout marquer comme lu",
        "contactsTasks.notifCaughtUp" to "Vous êtes à jour.",
        "contactsTasks.notifLoadingOlder" to "Chargement des précédentes…",
        "contactsTasks.notifShowOlder" to "Voir les précédentes",
        "contactsTasks.notifMirrorHint" to
            "Les notifications poussées et les courriels reprennent ceci · " +
            "Paramètres › Notifications",
        "contactsTasks.notifStateUnread" to "Non lu",
        "contactsTasks.notifStateRead" to "Lu",
        "contactsTasks.notifNewMessage" to "Nouveau texto",
        "contactsTasks.notifNewMessageFrom" to "Nouveau texto de {who}",
        "contactsTasks.notifAssigned" to "Conversation qui vous est assignée",
        "contactsTasks.notifAssignedFrom" to "{who} vous est assigné",
        "contactsTasks.notifTaskAssigned" to "Tâche qui vous est assignée",
        "contactsTasks.notifTaskAssignedFrom" to "Tâche assignée · {who}",
        "contactsTasks.notifMissedCall" to "Appel manqué",
        "contactsTasks.notifMissedCallFrom" to "Appel manqué de {who}",
        "contactsTasks.notifMention" to "Vous avez été mentionné",
        "contactsTasks.notifMentionFrom" to "Vous avez été mentionné · {who}",
        "contactsTasks.notifUpdate" to "Mise à jour",
        "contactsTasks.notifUpdateFrom" to "Mise à jour · {who}",
        "contactsTasks.notifPausedBoth" to "Les notifications sont en pause",
        "contactsTasks.notifPausedEmail" to "Les alertes par courriel sont en pause",
        "contactsTasks.notifPausedPush" to "Les alertes poussées sont en pause",
        "contactsTasks.notifPausedStillPush" to
            " Vous recevez toujours les notifications poussées.",
        "contactsTasks.notifPausedResumes" to " Elles reprennent {when}.",
        "contactsTasks.notifPausedBody" to
            "{what} pour aujourd'hui — cet espace de travail a atteint sa limite " +
            "quotidienne.{still}{resumes} Vos messages sont tous encore là.",

        // ── Tâches : la liste, le tableau, le calendrier et la carte ─────
        "contactsTasks.tasksTitle" to "Tâches",
        "contactsTasks.taskHeading" to "Tâche",
        "contactsTasks.filter" to "Filtrer",
        "contactsTasks.hideSearch" to "Masquer la recherche",
        "contactsTasks.searchTaskTitles" to "Rechercher un titre de tâche",
        "contactsTasks.clearSearch" to "Effacer la recherche",
        "contactsTasks.viewList" to "Vue liste",
        "contactsTasks.viewBoard" to "Vue tableau",
        "contactsTasks.viewCalendar" to "Vue calendrier",
        "contactsTasks.viewMap" to "Vue carte",
        "contactsTasks.tabOpen" to "Ouvertes",
        "contactsTasks.tabMine" to "Les miennes",
        "contactsTasks.tabAll" to "Toutes",
        "contactsTasks.tabDone" to "Terminées",
        "contactsTasks.dueOverdue" to "En retard",
        "contactsTasks.dueToday" to "Échéance aujourd'hui",
        "contactsTasks.dueThisWeek" to "Échéance cette semaine",
        "contactsTasks.assignee" to "Assignée à",
        "contactsTasks.clearAssigneeFilter" to "Effacer le filtre d'assignation",
        "contactsTasks.unassigned" to "Non assignée",
        "contactsTasks.unassign" to "Désassigner",
        "contactsTasks.assignTo" to "Assigner à {who}",
        "contactsTasks.you" to "Vous",
        "contactsTasks.youSuffix" to " (vous)",
        "contactsTasks.teammate" to "Coéquipier",
        "contactsTasks.selected" to "Sélectionné",
        "contactsTasks.searchTeammates" to "Rechercher un coéquipier",
        "contactsTasks.noTeammatesMatch" to "Aucun coéquipier ne correspond.",
        "contactsTasks.listEmptyFiltered" to "Rien dans cette liste.",
        "contactsTasks.listEmpty" to
            "Aucune tâche pour l'instant. Transformez un texto en tâche depuis son " +
            "menu ⋯ dans une conversation.",
        "contactsTasks.loadMore" to "Charger plus",
        "contactsTasks.loading" to "Chargement…",
        "contactsTasks.columnToDo" to "À faire",
        "contactsTasks.columnToDoEmpty" to "Rien à faire ici.",
        "contactsTasks.columnDone" to "Terminé",
        "contactsTasks.columnDoneEmpty" to "Rien n'est encore marqué comme terminé.",
        "contactsTasks.moveToDone" to "Déplacer vers Terminé",
        "contactsTasks.moveToToDo" to "Déplacer vers À faire",
        "contactsTasks.markDone" to "Marquer comme terminée",
        "contactsTasks.markNotDone" to "Marquer comme non terminée",
        "contactsTasks.swipeNotDone" to "Non terminée",
        "contactsTasks.dueDate" to "Date d'échéance",
        "contactsTasks.overdue" to "En retard",
        "contactsTasks.dueWhen" to "Échéance {when}",
        "contactsTasks.overdueDueWhen" to "En retard · échéance {when}",
        "contactsTasks.today" to "Aujourd'hui",
        "contactsTasks.tomorrow" to "Demain",
        "contactsTasks.todayAtTime" to "aujourd'hui {time}",
        "contactsTasks.clearSelection" to "Effacer la sélection",
        "contactsTasks.moreBulkActions" to "Plus d'actions groupées",
        "contactsTasks.selectThese" to "Sélectionner ces {count}",
        "contactsTasks.selectAllMatching" to "Tout sélectionner",
        "contactsTasks.bulkFailed" to
            "L'opération n'a pas abouti. Rien n'a été modifié.",

        // Calendrier
        "contactsTasks.calendarEmptyRange" to
            "Rien n'est prévu dans cette période. Une tâche apparaît ici une fois " +
            "qu'elle a une date d'échéance. Fixez-la depuis l'écran de la tâche.",
        "contactsTasks.calendarScheduled" to "{scheduled} prévues",
        "contactsTasks.calendarUndated" to "{undated} sans date d'échéance",
        "contactsTasks.calendarScheduledAndUndated" to
            "{scheduled} prévues · {undated} sans date d'échéance",
        "contactsTasks.calendarNothingDueThisDay" to "Rien à faire ce jour-là.",
        "contactsTasks.calendarPreviousMonth" to "Mois précédent",
        "contactsTasks.calendarNextMonth" to "Mois suivant",
        "contactsTasks.calendarDayCellOne" to "{date}, {count} tâche",
        "contactsTasks.calendarDayCellMany" to "{date}, {count} tâches",
        "contactsTasks.weekdayMon" to "lun",
        "contactsTasks.weekdayTue" to "mar",
        "contactsTasks.weekdayWed" to "mer",
        "contactsTasks.weekdayThu" to "jeu",
        "contactsTasks.weekdayFri" to "ven",
        "contactsTasks.weekdaySat" to "sam",
        "contactsTasks.weekdaySun" to "dim",

        // Carte
        "contactsTasks.mapCounts" to "{located} sur la carte",
        "contactsTasks.mapCountsWithMissing" to
            "{located} sur la carte · {missing} sans emplacement",
        "contactsTasks.mapMissingCount" to "{missing} sans emplacement",
        "contactsTasks.mapNoLocatedTasks" to "Aucune tâche localisée pour l'instant.",
        "contactsTasks.mapAddAnAddress" to
            "Ajoutez une adresse à un client et ses tâches apparaissent ici.",
        "contactsTasks.mapMyLocation" to "Ma position",
        "contactsTasks.mapThisLocation" to "Cet emplacement",
        "contactsTasks.mapTasksHere" to "{count} tâches ici",
        "contactsTasks.mapOpenTask" to "Ouvrir la tâche",
        "contactsTasks.mapDirections" to "Itinéraire",
        "contactsTasks.mapMore" to "+{count} de plus",

        // Détail de la tâche
        "contactsTasks.taskGone" to "Cette tâche n'existe pas ou a été supprimée.",
        "contactsTasks.backToTasks" to "Retour aux tâches",
        "contactsTasks.taskActions" to "Actions de la tâche",
        "contactsTasks.deleteTask" to "Supprimer la tâche",
        "contactsTasks.deleteForbidden" to
            "Seul le créateur de la tâche ou un administrateur peut la supprimer.",
        "contactsTasks.deleteTaskTitle" to "Supprimer cette tâche ?",
        "contactsTasks.deleteTaskBody" to
            "Elle contient {what}. La conversation et ses textos restent ; la " +
            "marque « terminé » sur le texto d'origine est conservée.",
        "contactsTasks.discussionNotes" to "des notes de discussion",
        "contactsTasks.filesLower" to "des fichiers",
        "contactsTasks.andJoiner" to " et ",
        "contactsTasks.keepTask" to "Conserver la tâche",
        "contactsTasks.taskTitlePlaceholder" to "Titre de la tâche",
        "contactsTasks.createdWhen" to "Créée {when}",
        "contactsTasks.createdBy" to "par {who}",
        "contactsTasks.due" to "Échéance",
        "contactsTasks.noDueDate" to "Aucune date d'échéance",
        "contactsTasks.overdueDot" to "En retard · {due}",
        "contactsTasks.clearDueDate" to "Effacer la date d'échéance",
        "contactsTasks.dueTime" to "Heure d'échéance",
        "contactsTasks.setDueDate" to "Fixer l'échéance",
        "contactsTasks.next" to "Suivant",
        "contactsTasks.remind" to "Rappel",
        "contactsTasks.remindOff" to "Désactivé pour ce travail",
        "contactsTasks.remindWorkspace" to
            "Utilise les rappels de votre espace de travail",
        "contactsTasks.confirmedByCustomer" to "Le client a confirmé sa présence.",
        "contactsTasks.confirmedByCrew" to "Confirmée par votre équipe.",
        "contactsTasks.taskNoAccess" to
            "Cette tâche est liée à un numéro auquel vous n'avez pas accès. Vous " +
            "voyez la tâche, mais pas ses textos, ses fichiers ni sa discussion. " +
            "Demandez l'accès à un propriétaire ou à un administrateur.",
        "contactsTasks.aPhoto" to "Une photo",
        "contactsTasks.sourceMessageWhen" to "Texto d'origine · {when}",
        "contactsTasks.openConversationArrow" to "Ouvrir la conversation →",
        "contactsTasks.description" to "Description",
        "contactsTasks.descriptionPlaceholder" to
            "Ajoutez les détails que l'équipe doit connaître",
        "contactsTasks.files" to "Fichiers",
        "contactsTasks.activity" to "Activité",
        "contactsTasks.activityEmpty" to
            "Aucune activité pour l'instant. Publiez une note ci-dessous pour " +
            "lancer la discussion.",
        "contactsTasks.activityLine" to "{sentence} · {when}",
        "contactsTasks.activityCreated" to "{by} en a fait une tâche",
        "contactsTasks.activityUnassigned" to "{by} a désassigné cette tâche",
        "contactsTasks.activityAssignedTo" to "{by} a assigné ceci à {who}",
        "contactsTasks.activityReassigned" to "{by} a réassigné cette tâche",
        "contactsTasks.activityDueCleared" to "{by} a effacé la date d'échéance",
        "contactsTasks.activityDueSet" to "{by} a fixé l'échéance à {when}",
        "contactsTasks.activityDeleted" to "{by} a supprimé cette tâche",
        "contactsTasks.activityAttached" to "{by} a joint un fichier",
        "contactsTasks.activityAttachmentRemoved" to "{by} a retiré un fichier",
        "contactsTasks.internalNote" to "Note interne",
        "contactsTasks.photo" to "Photo",
        "contactsTasks.file" to "Fichier",
        "contactsTasks.couldntLoad" to "Chargement impossible",
        "contactsTasks.attachFiles" to "Joindre des fichiers",
        "contactsTasks.postNote" to "Publier la note",
        "contactsTasks.noteComposerPlaceholder" to "Ajoutez une note pour l'équipe…",
        "contactsTasks.noteFilesCap" to "Jusqu'à {count} fichiers par note.",
        "contactsTasks.noteFileTooBig" to "Les fichiers doivent faire 25 Mo ou moins.",
        "contactsTasks.noteUploadFailedOne" to
            "La note a été publiée, mais {count} fichier n'a pas été téléversé. " +
            "Réessayez depuis la note dans la conversation.",
        "contactsTasks.noteUploadFailedMany" to
            "La note a été publiée, mais {count} fichiers n'ont pas été téléversés. " +
            "Réessayez depuis la note dans la conversation.",
        "contactsTasks.removeNamed" to "Retirer {name}",

        // L'adresse du travail
        "contactsTasks.address" to "Adresse",
        "contactsTasks.clear" to "Effacer",
        "contactsTasks.reset" to "Réinitialiser",
        "contactsTasks.saveAddress" to "Enregistrer l'adresse",
        "contactsTasks.hideAddress" to "Masquer l'adresse",
        "contactsTasks.showAddress" to "Afficher l'adresse",
        "contactsTasks.addrStreet" to "Rue",
        "contactsTasks.addrUnit" to "Unité / bureau",
        "contactsTasks.addrCity" to "Ville",
        "contactsTasks.addrState" to "État / province",
        "contactsTasks.addrPostalCode" to "Code postal",

        // Photos du travail (#294)
        "contactsTasks.photosFromCustomer" to "Du client",
        "contactsTasks.photosFromCrew" to "Ajoutées par l'équipe",
        "contactsTasks.jobPhotosShare" to "Partager ces photos",
        "contactsTasks.jobPhotosMakingLink" to "Création du lien…",
        "contactsTasks.jobPhotosExpiry" to
            "Toute personne ayant ce lien peut voir les photos jusqu'au {when}.",
        "contactsTasks.jobPhotosTurnOff" to "Désactiver ce lien",
        "contactsTasks.jobPhotosClipboardLabel" to "Photos du travail",
        "contactsTasks.copy" to "Copier",

        // ── Clients : la liste, la fiche et la fusion ────────────────────
        "contactsTasks.contactsTitle" to "Clients",
        "contactsTasks.contactHeading" to "Client",
        "contactsTasks.newContact" to "Nouveau client",
        "contactsTasks.addContact" to "Ajouter le client",
        "contactsTasks.adding" to "Ajout…",
        "contactsTasks.add" to "Ajouter",
        "contactsTasks.done" to "Terminé",
        "contactsTasks.doneEditing" to "Terminé",
        "contactsTasks.change" to "Modifier",
        "contactsTasks.working" to "Traitement…",
        "contactsTasks.saveFailed" to
            "Enregistrement impossible. Vérifiez votre connexion.",
        "contactsTasks.optional" to "Facultatif",
        "contactsTasks.labelField" to "Étiquette",
        "contactsTasks.numberField" to "Numéro",
        "contactsTasks.phoneField" to "Téléphone",
        "contactsTasks.nameField" to "Nom",
        "contactsTasks.notesField" to "Notes",
        "contactsTasks.businessField" to "Entreprise",
        "contactsTasks.emailField" to "Courriel",
        "contactsTasks.nanpHint" to
            "Entrez un numéro à 10 chiffres des États-Unis ou du Canada.",
        "contactsTasks.addAName" to "Ajouter un nom",
        "contactsTasks.addAnAddress" to "Ajouter une adresse",
        "contactsTasks.businessPlaceholder" to "Pour qui il travaille, le cas échéant",
        "contactsTasks.emailPlaceholder" to "Pour les devis et les reçus",
        "contactsTasks.notesPlaceholder" to
            "Code de portail, nom du chien, plage d'arrivée préférée…",
        "contactsTasks.notesCaption" to
            "Enregistrement automatique · visible par l'équipe",
        "contactsTasks.searchNameOrNumber" to "Rechercher un nom ou un numéro",
        "contactsTasks.searchNameOrNumberHint" to "Rechercher un nom ou un numéro…",
        "contactsTasks.noMatchesFor" to "Aucun résultat pour « {query} ».",
        "contactsTasks.noContactsYet" to
            "Aucun client pour l'instant. Ils sont ajoutés automatiquement quand " +
            "quelqu'un vous texte, ou ajoutez-en un vous-même.",
        "contactsTasks.optedOut" to "Désabonné",
        "contactsTasks.contactGone" to "Ce client n'existe pas ou a été supprimé.",
        "contactsTasks.backToContacts" to "Retour aux clients",
        "contactsTasks.copyNumber" to "Copier le numéro",
        "contactsTasks.openConversation" to "Ouvrir la conversation",
        "contactsTasks.conversation" to "Conversation",
        "contactsTasks.conversationsSection" to "Conversations",
        "contactsTasks.updatedWhen" to "Mis à jour {when}",
        "contactsTasks.textAction" to "Texter",
        "contactsTasks.call" to "Appeler",
        "contactsTasks.calling" to "Appel…",
        "contactsTasks.micNeeded" to
            "Loonext a besoin du microphone pour passer des appels. Autorisez-le " +
            "dans Paramètres › Applications › Loonext › Autorisations.",
        "contactsTasks.optedOutBanner" to
            "Ce client s'est désabonné des textos. Les envois vers lui sont bloqués.",
        "contactsTasks.optedOutByCarrier" to
            "Il a texté STOP, alors son fournisseur bloque vos textos. Lui seul " +
            "peut annuler cela, en textant START à votre numéro.",
        "contactsTasks.optedOutByHand" to
            "Quelqu'un l'a inscrit à la main, alors il suffit de l'annuler ici.",
        "contactsTasks.markOptedInAgain" to "Marquer comme réabonné",
        "contactsTasks.optOut" to "Désabonner",
        "contactsTasks.optOutContact" to "Désabonner ce client",
        "contactsTasks.optOutCaption" to "Bloque tous les textos vers ce numéro",
        "contactsTasks.optOutTitle" to "Désabonner ce client ?",
        "contactsTasks.optOutBody" to
            "Tous les textos vers {number} sont bloqués jusqu'au réabonnement. " +
            "Utilisez ceci quand un client vous demande d'arrêter de lui texter.",
        "contactsTasks.deleteContact" to "Supprimer le client",
        "contactsTasks.deleteContactCaption" to
            "L'historique des textos reste. Il réapparaît s'il vous texte de nouveau",
        "contactsTasks.deleteContactTitle" to "Supprimer ce client ?",
        "contactsTasks.deleteContactBody" to
            "Il disparaît de votre liste de clients. Les conversations et les " +
            "textos restent, et le client revient automatiquement s'il vous texte " +
            "de nouveau.",
        "contactsTasks.keepContact" to "Conserver le client",
        "contactsTasks.theirTime" to "Son heure",
        "contactsTasks.theirLanguage" to "Sa langue",
        "contactsTasks.sameAsWorkspace" to "Comme votre espace de travail",
        "contactsTasks.setByCrew" to "Défini par votre équipe",
        "contactsTasks.useAreaCode" to "Utiliser son indicatif régional",
        "contactsTasks.localeCaveat" to
            "Textos automatisés seulement : la réponse d'absence, le texto après " +
            "un appel manqué, la réponse urgente et la demande d'évaluation. Tout " +
            "ce que vous tapez est envoyé exactement comme vous l'avez écrit.",

        // Le carnet d'adresses du téléphone (#459)
        "contactsTasks.onThisPhone" to "Sur ce téléphone",
        "contactsTasks.devicePhoneNoMatch" to "Personne ne correspond ici.",
        "contactsTasks.devicePhoneOwn" to
            "Vos propres contacts. Ils restent sur votre téléphone.",
        "contactsTasks.devicePhoneAsk" to
            "Laissez Loonext lire les contacts de votre téléphone pour qu'ils " +
            "s'affichent ici, afin de texter quelqu'un sans l'ajouter d'abord. " +
            "Ils restent sur votre téléphone.",
        "contactsTasks.showMyPhoneContacts" to
            "Afficher les contacts de mon téléphone",
        "contactsTasks.showAllFromPhone" to "Tout afficher depuis ce téléphone",
        "contactsTasks.addToContacts" to "Ajouter {name} aux clients",

        // Importation et exportation
        "contactsTasks.importing" to "Importation…",
        "contactsTasks.importCsvOrVcard" to "Importer un CSV ou une vCard",
        "contactsTasks.csvFile" to "Fichier CSV",
        "contactsTasks.vcardFile" to "Fichier vCard (.vcf)",
        "contactsTasks.exporting" to "Exportation…",
        "contactsTasks.exportCsv" to "Exporter en CSV",
        "contactsTasks.contactsExported" to "Clients exportés.",
        "contactsTasks.exportFailed" to "L'exportation n'a pas abouti. Réessayez.",
        "contactsTasks.importFinished" to "Importation terminée",
        "contactsTasks.importImported" to "{count} importés",
        "contactsTasks.importUpdated" to "{count} mis à jour",
        "contactsTasks.importSkipped" to "{count} ignorés",
        "contactsTasks.importSkippedRows" to "Lignes ignorées :",
        "contactsTasks.importRowLine" to "{word} {row} · {reason}",

        // Doublons et fusion (#246)
        "contactsTasks.duplicatesOnePair" to
            "Ces deux fiches semblent être le même client",
        "contactsTasks.duplicatesManyPairs" to
            "{count} paires semblent être le même client",
        "contactsTasks.duplicatesBlurb" to
            "La fusion conserve tous les textos, tâches et photos des deux, sous " +
            "une seule fiche.",
        "contactsTasks.duplicatesPair" to "{a} et {b}",
        "contactsTasks.merge" to "Fusionner",
        "contactsTasks.merging" to "Fusion…",
        "contactsTasks.merged" to "Fusionné.",
        "contactsTasks.mergedOptedOut" to
            "Fusionné. Ce client s'est désabonné, alors rien n'est envoyé à l'un " +
            "ou l'autre numéro.",
        "contactsTasks.mergeDialogTitle" to "Fusionner ces deux clients",
        "contactsTasks.mergeDialogBody" to
            "Tout des deux — textos, tâches, photos, notes — se retrouve sous la " +
            "fiche que vous gardez. Les deux numéros continuent de fonctionner.",
        "contactsTasks.mergeWhichToKeep" to "Laquelle garder",
        "contactsTasks.mergeDirection" to
            "{folded} cesse d'être un client distinct. Son historique passe à " +
            "{survivor}.",

        // Les sections Appels et Historique de la fiche
        "contactsTasks.callsSection" to "Appels",
        "contactsTasks.historySection" to "Historique",
        "contactsTasks.noCallsYet" to "Aucun appel avec ce client pour l'instant.",
        "contactsTasks.timelineEmpty" to
            "Les textos, les appels et les travaux de ce client s'accumuleront ici.",
        "contactsTasks.showMore" to "Voir plus",
        "contactsTasks.showEarlier" to "Voir plus ancien",
        "contactsTasks.callBack" to "Rappeler",
        "contactsTasks.textBack" to "Répondre par texto",
        "contactsTasks.playVoicemail" to "Lire le message vocal",
        "contactsTasks.pauseVoicemail" to "Mettre le message vocal en pause",
        "contactsTasks.voicemailPlayFailed" to
            "Impossible de lire ce message vocal.",

        // ── Appels : le journal, le clavier, la sonnerie et l'appel ──────
        "contactsTasks.filterAll" to "Tous",
        "contactsTasks.filterMissed" to "Manqués",
        "contactsTasks.filterVoicemail" to "Messages vocaux",
        "contactsTasks.noMissedCalls" to "Aucun appel manqué.",
        "contactsTasks.noVoicemails" to "Aucun message vocal.",
        "contactsTasks.noCallsYetLog" to
            "Aucun appel pour l'instant. Quand des clients appellent votre numéro, " +
            "les appels arrivent ici.",
        "contactsTasks.missedCallAutoText" to
            "Les appels manqués renvoient un texto au client automatiquement",
        "contactsTasks.dialANumber" to "Composer un numéro",
        "contactsTasks.readyToRing" to "Prêt à sonner",
        "contactsTasks.offlineRetry" to "Hors ligne · réessayer",
        "contactsTasks.ongoing" to "En cours",
        "contactsTasks.earlier" to "Plus tôt",
        "contactsTasks.yesterday" to "Hier",
        "contactsTasks.connected" to "Connecté",
        "contactsTasks.connecting" to "Connexion…",
        "contactsTasks.reconnectingLine" to "Reconnexion de votre ligne…",
        "contactsTasks.incomingCallEyebrow" to "APPEL ENTRANT",
        "contactsTasks.decline" to "Refuser",
        "contactsTasks.answer" to "Répondre",
        "contactsTasks.hangUp" to "Raccrocher",
        "contactsTasks.dismiss" to "Ignorer",
        "contactsTasks.phaseIncoming" to "Appel entrant",
        "contactsTasks.phaseCalling" to "Appel en cours…",
        "contactsTasks.phaseOnHold" to "En attente",
        "contactsTasks.phaseEnded" to "Appel terminé",

        // Le clavier
        "contactsTasks.fromNumber" to "Depuis {number}",
        "contactsTasks.lineReady" to "Ligne prête · {number}",
        "contactsTasks.enterANumber" to "Entrez un numéro",
        "contactsTasks.matchNamesFromContacts" to "Associer les noms de vos contacts",
        "contactsTasks.sendMessageInstead" to "Envoyer un texto à la place",
        "contactsTasks.deleteLastDigit" to "Effacer le dernier chiffre",
        "contactsTasks.openContact" to "Ouvrir la fiche",

        // L'appel en cours
        "contactsTasks.hide" to "Masquer",
        "contactsTasks.mute" to "Couper le micro",
        "contactsTasks.unmute" to "Réactiver le micro",
        "contactsTasks.keypad" to "Clavier",
        "contactsTasks.hold" to "Mettre en attente",
        "contactsTasks.resume" to "Reprendre",
        "contactsTasks.transfer" to "Transférer",
        "contactsTasks.swap" to "Permuter",
        "contactsTasks.note" to "Note",
        "contactsTasks.speaker" to "Haut-parleur",
        "contactsTasks.bluetooth" to "Bluetooth",
        "contactsTasks.endCall" to "Terminer l'appel",
        "contactsTasks.allowMicToAnswer" to
            "Autorisez l'accès au microphone pour répondre à cet appel.",
        "contactsTasks.callNoteEyebrow" to
            "NOTE D'APPEL · ENREGISTRÉE DANS LA CONVERSATION",
        "contactsTasks.addNoteAction" to "Ajouter une note dans la conversation",
        "contactsTasks.addNotePlaceholder" to
            "Ajouter une note dans la conversation…",
        "contactsTasks.transferThisCall" to "Transférer cet appel",
        "contactsTasks.noTeammatesAvailable" to
            "Aucun coéquipier ne peut prendre cet appel en ce moment.",
        "contactsTasks.transferSnapBack" to "S'il refuse, l'appel vous revient.",
        "contactsTasks.onACall" to "En appel",
        "contactsTasks.available" to "Disponible",
        "contactsTasks.ringing" to "Sonnerie…",
        "contactsTasks.leavingVoicemail" to "Laisse un message vocal",
        "contactsTasks.withMember" to "Avec {who}",
        "contactsTasks.onTheLine" to "En ligne",

        // Qui a ajouté la fiche, et qui l'a modifiée en dernier (#191)
        "contactsTasks.addedBy" to "Ajouté par {who}",
        "contactsTasks.addedByOn" to "Ajouté par {who} le {date}",
        "contactsTasks.editedBy" to "Modifié par {who}",

        // ── La carte de consentement (#226) ──────────────────────────────
        // Copié CARACTÈRE POUR CARACTÈRE de `appShell.ts` sur le web.
        "contactsTasks.consentNone" to
            "Aucun consentement enregistré pour l'instant. Il est enregistré quand le " +
            "client vous texte en premier, ou quand vous lui envoyez son premier " +
            "texto, ce qui atteste qu'il l'a demandé.",
        "contactsTasks.consentTextedFirst" to "Vous a texté en premier",
        "contactsTasks.consentRecorded" to "Consentement enregistré",
        "contactsTasks.consentRecordedBy" to "Consentement enregistré par {name}",

        // ── La liste vidée par un filtre (#291) ──────────────────────────
        // Copié de `filteredEmptyTitle` / `filteredEmptyDetail` sur le web.
        "contactsTasks.filterEmptyTitle" to "Personne ne correspond pour l'instant",
        "contactsTasks.filterEmptyBody" to
            "Aucun client n'a cette réponse au dossier. Retirez le filtre pour voir " +
            "tout le monde.",

        // ── La carte sans fond de carte (#428) ───────────────────────────
        // Copié de `misc.mapNoBasemap` sur le web.
        "contactsTasks.mapNoBasemap" to
            "Les épingles des travaux sont exactes. Le fond de carte exige un " +
            "fournisseur de tuiles, qu'un propriétaire peut configurer en un réglage.",

        // ── L'historique du client, ligne par ligne (#324) ───────────────
        // Les douze copiés des clés `timeline*` de `contacts.ts` sur le web.
        "contactsTasks.timelineJob" to "Tâche",
        "contactsTasks.timelineCallAnsweredBy" to "Appel pris par {name}",
        "contactsTasks.timelineCallAnswered" to "Appel pris",
        "contactsTasks.timelineVoicemail" to "Message vocal",
        "contactsTasks.timelineMissedCall" to "Appel manqué",
        "contactsTasks.timelineConversation" to "Conversation",
        "contactsTasks.timelineDone" to "Faite",
        "contactsTasks.timelineDue" to "Échéance {date}",
        "contactsTasks.timelineOpen" to "Ouverte",
        "contactsTasks.timelineTalkedFor" to "Durée de l'appel : {duration}",
        "contactsTasks.timelineNoAnswer" to "Sans réponse",
        "contactsTasks.timelineClosed" to "Fermée",

        // ── Importation en lot : la feuille d'attestation (#226/#248) ────
        // `importAttestation` est copié de `consentLabelFile` sur le web :
        // c'est LA déclaration, et sa formulation est ce qui est envoyé.
        "contactsTasks.importBeforeTitle" to "Avant d'importer",
        "contactsTasks.importBeforeLead" to
            "Vous êtes sur le point de téléverser les numéros de téléphone " +
            "d'autres personnes dans cet espace de travail.",
        "contactsTasks.importAttestation" to
            "Toutes les personnes de ce fichier ont accepté de recevoir des textos de " +
            "cette entreprise.",
        "contactsTasks.importRecorded" to
            "Pour toute personne sans consentement déjà enregistré, ceci est " +
            "conservé comme votre attestation. Les clients qui en ont déjà un " +
            "conservent celui-ci.",
        "contactsTasks.importChooseFile" to "Choisir un fichier",

        // STOP est un mot-clé de fournisseur : jamais traduit.
        "contactsTasks.importLimitsCsv" to "Jusqu'à {count} lignes, {size} Mo.",
        "contactsTasks.importLimitsVcard" to "Jusqu'à {count} fiches, {size} Mo.",
        "contactsTasks.importTooLargeCsv" to
            "Les fichiers CSV doivent faire {size} Mo ou moins.",
        "contactsTasks.importTooLargeVcard" to
            "Les fichiers vCard doivent faire {size} Mo ou moins.",
        "contactsTasks.importOptOutNoteCsv" to
            "Un STOP survit toujours à une importation, et une colonne " +
            "« désabonné » dans votre fichier bloque aussi ces personnes ici.",
        "contactsTasks.importOptOutNoteVcard" to
            "Un STOP survit toujours à une importation. Une fiche marquée " +
            "« ne pas texter » bloque aussi cette personne ici.",

        "contactsTasks.importRowWordRow" to "Ligne",
        "contactsTasks.importRowWordCard" to "Fiche",

        // ── Importation en lot : le fichier entier refusé ────────────────
        "contactsTasks.importRefusedTitle" to "Ce fichier n'a pas été importé",
        "contactsTasks.importRefusedEdit" to "Modifier les colonnes",
        // Copié de `andMore` sur le web.
        "contactsTasks.importAndMore" to "…et {count} de plus.",
        "contactsTasks.importOptedOutOne" to
            "{count} client de ce fichier s'était déjà désabonné",
        "contactsTasks.importOptedOutMany" to
            "{count} clients de ce fichier s'étaient déjà désabonnés",

        // ── Importation en lot : l'étape par colonne (#248, ronde 3) ─────
        "contactsTasks.importColumnsTitle" to "Qu'y a-t-il dans ce fichier ?",
        "contactsTasks.importColumnsLead" to
            "Cette importation ne devine pas ce qu'une colonne signifie : une " +
            "colonne « ne pas texter » lue comme rien, c'est un texto à " +
            "quelqu'un qui a demandé à cette entreprise d'arrêter. Dites ce " +
            "qu'est chaque colonne, ou ignorez-la volontairement.",
        "contactsTasks.importWrongColumn" to
            "Si une colonne indique qui ne doit pas être texté, choisissez " +
            "« {answer} » : l'ignorer texterait toutes les personnes qu'elle " +
            "protégeait.",
        "contactsTasks.importConfirm" to "Importer",
        "contactsTasks.importUnansweredColumns" to
            "Chaque colonne doit avoir une réponse avant que ce fichier puisse " +
            "être importé.",
        "contactsTasks.importNotRecognised" to "Non reconnues",
        "contactsTasks.importRecognisedHeading" to
            "Reconnues — corrigez celles qui clochent",
        "contactsTasks.importDuplicateHint" to
            "Deux colonnes sont toutes deux marquées « {answer} ». Un client " +
            "n'en a qu'un.",
        "contactsTasks.importChoose" to "Choisir…",
        "contactsTasks.importColumnPosition" to "Colonne {number}",
        "contactsTasks.importColumnNoHeader" to "(sans en-tête)",
        // Copié de `columnQuoted` sur le web.
        "contactsTasks.importColumnQuoted" to "« {header} »",
        "contactsTasks.importValuesEmpty" to
            "Toutes les lignes laissent cette colonne vide.",
        // « Parmi les valeurs » et non « les valeurs » : ce sont les premières
        // valeurs distinctes, pas la colonne entière.
        "contactsTasks.importValuesInclude" to "Parmi les valeurs : {samples}",
        // Copié de `unreadableOverflow` sur le web.
        "contactsTasks.importValuesAndMore" to ", et {count} de plus",
        "contactsTasks.importShowAllValues" to "Afficher les {count} valeurs",
        "contactsTasks.importShowFewerValues" to "Afficher moins de valeurs",
        "contactsTasks.importValueCeiling" to
            "Affichage de {shown} des {total} réponses différentes de cette colonne.",
        "contactsTasks.importProgress" to "{answered} sur {total} répondues",

        // Copiés de `answerPhone`, `answerFirstName` et `answerLastName`.
        "contactsTasks.importActionPhone" to "Numéro de téléphone",
        "contactsTasks.importActionFirstName" to "Prénom",
        "contactsTasks.importActionLastName" to "Nom de famille",
        "contactsTasks.importActionOptedOut" to "Ne pas texter",
        "contactsTasks.importActionIgnore" to "Ignorer cette colonne",

        // ── Importation en lot : la question propre à la porte vCard ─────
        "contactsTasks.importPropertiesTitle" to "Que contiennent ces fiches ?",
        "contactsTasks.importPropertiesLead" to
            "Ces fiches contiennent de l'information que cette importation ne " +
            "lit pas. Les catégories d'une fiche, une note indiquant qu'une " +
            "personne a demandé d'arrêter, ou un libellé écrit à côté d'un " +
            "numéro : c'est là qu'un .vcf dit « ne pas texter ». Un élément lu " +
            "comme rien, c'est un texto à quelqu'un qui a demandé à cette " +
            "entreprise d'arrêter.",
        "contactsTasks.importParameterNote" to
            "Un nom contenant un « ; » est un libellé rattaché à l'élément qui " +
            "le précède, et ce libellé contient son propre texte libre : " +
            "« DO NOT CALL » est une des choses que les gens y écrivent.",
        "contactsTasks.importPropertiesCoarse" to
            "« {answer} » bloque toutes les fiches contenant cet élément, peu " +
            "importe ce qui y est écrit. Ne pas texter quelqu'un est la seule " +
            "direction dans laquelle cette importation a le droit de se tromper.",
        "contactsTasks.importUnansweredProperties" to
            "Chacun de ces éléments doit avoir une réponse avant que le fichier " +
            "puisse être importé.",
        "contactsTasks.importPropertyIgnore" to "N'indique rien sur les textos",
        "contactsTasks.importPropertyOptedOut" to "Ne pas texter ces fiches",
    )
}
