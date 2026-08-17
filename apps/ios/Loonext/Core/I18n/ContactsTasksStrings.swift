import Foundation

/// #228 — the customer record, the job, the phone call and the bill.
///
/// One section rather than four because the four surfaces share a vocabulary
/// and a translator working through them should see it settle: a *contact* is a
/// `client`, a *task* is a `tâche`, a *conversation* is a `conversation`, and
/// the same words are used on web and Android so a crew that switches devices
/// does not meet a second product. Its Android twin is
/// `core/i18n/ContactsTasksStrings.kt`, and every key that exists there is
/// spelled the same here, with the same English and the same French.
///
/// The register is the one `CommonStrings` sets out: Quebec French,
/// VOUVOIEMENT, accents spelled normally, a normal space before a colon.
/// Product names (Loonext, Stripe, Telnyx, Lou) and the carrier keywords
/// (STOP, HELP, START, URGENT) are never translated — a carrier matches on the
/// literal word, so a translated STOP is an opt-out that never registers.
///
/// ## Why a handful of keys here carry the `payments.` prefix
///
/// `PaymentsStrings` is the foundation's worked example and holds the twelve
/// strings text-to-pay shipped with. The two payment SCREENS —
/// `Features/Payments/PaymentsSection.swift` and `ThreadPayments.swift` — say
/// more than those twelve, and the rest belong under the same prefix or a
/// translator reading `payments.*` would be reading half a screen. They live in
/// this file because it is the one this extraction owns; the keys are disjoint
/// from `PaymentsStrings`, which `AppStringsTests` asserts.
///
/// ## Where iOS says something the other clients do not
///
/// Three sentences name the iOS Settings app (`Réglages`, which is what iOS
/// calls it in French — the app's own settings screen stays `paramètres`).
/// Android's twins name Android's path, so those keys are iOS-only by
/// necessity rather than by drift.
enum ContactsTasksStrings {
    static let section = AppStrings.Section(
        name: "ContactsTasksStrings",
        en: [
            // ── Tasks: the list, the board, the calendar and the map ─────────
            "contactsTasks.tasksTitle": "Tasks",
            "contactsTasks.taskHeading": "Task",
            "contactsTasks.searchTaskTitles": "Search task titles",
            "contactsTasks.clearSearch": "Clear search",
            // The four view pills are icon-only; these are what they SAY.
            "contactsTasks.viewList": "List view",
            "contactsTasks.viewBoard": "Board view",
            "contactsTasks.viewCalendar": "Calendar view",
            "contactsTasks.viewMap": "Map view",
            // The status tabs. `TasksTabKind.rawValue` stays an English
            // identifier — it is the reload token and the cache key, matching
            // the Android enum's `.name`; the WORDS are these four.
            "contactsTasks.tabOpen": "Open",
            "contactsTasks.tabMine": "Mine",
            "contactsTasks.tabAll": "All",
            "contactsTasks.tabDone": "Done",
            "contactsTasks.dueOverdue": "Overdue",
            "contactsTasks.dueToday": "Due today",
            "contactsTasks.dueThisWeek": "Due this week",
            "contactsTasks.assignee": "Assignee",
            "contactsTasks.clearAssigneeFilter": "Clear assignee filter",
            "contactsTasks.unassigned": "Unassigned",
            "contactsTasks.unassign": "Unassign",
            "contactsTasks.assignTo": "Assign to {who}",
            "contactsTasks.you": "You",
            "contactsTasks.youSuffix": " (you)",
            "contactsTasks.teammate": "Teammate",
            "contactsTasks.selected": "Selected",
            "contactsTasks.searchTeammates": "Search teammates",
            "contactsTasks.noTeammatesMatch": "No teammates match.",
            // Two empty lists, and the difference decides what somebody does
            // next: a filter excluded them, or there are none.
            "contactsTasks.listEmptyFiltered": "Nothing on this list.",
            "contactsTasks.listEmpty":
                "No tasks yet. Promote a message from its ⋯ menu in a conversation.",
            "contactsTasks.loadMore": "Load more",
            "contactsTasks.loading": "Loading…",
            "contactsTasks.columnToDo": "To do",
            "contactsTasks.columnToDoEmpty": "Nothing to do here.",
            "contactsTasks.columnDone": "Done",
            "contactsTasks.columnDoneEmpty": "Nothing marked done yet.",
            "contactsTasks.moveToDone": "Move to Done",
            "contactsTasks.moveToToDo": "Move to To do",
            "contactsTasks.markDone": "Mark done",
            "contactsTasks.markNotDone": "Mark not done",
            "contactsTasks.dueWhen": "Due {when}",
            "contactsTasks.overdueDot": "Overdue · {due}",
            "contactsTasks.overdueDueWhen": "Overdue · due {when}",
            "contactsTasks.today": "Today",
            "contactsTasks.tomorrow": "Tomorrow",
            "contactsTasks.clearSelection": "Clear selection",
            "contactsTasks.moreBulkActions": "More bulk actions",
            "contactsTasks.selectThese": "Select these {count}",
            "contactsTasks.selectAllMatching": "Select all matching",
            "contactsTasks.bulkFailed": "That didn't go through. Nothing was changed.",
            "contactsTasks.taskUpdateFailed": "Couldn't update the task",
            "contactsTasks.everyTaskLinksBack": "Every task links back to its message",

            // Calendar
            "contactsTasks.calendarEmptyRange":
                "Nothing is scheduled in this range. A task appears here once it has a "
                + "due date. Set one from the task's detail screen.",
            "contactsTasks.calendarScheduled": "{scheduled} scheduled",
            "contactsTasks.calendarUndated": "{undated} without a due date",
            "contactsTasks.calendarScheduledAndUndated":
                "{scheduled} scheduled · {undated} without a due date",
            "contactsTasks.calendarNothingDueThisDay": "Nothing due this day.",
            "contactsTasks.calendarPreviousMonth": "Previous month",
            "contactsTasks.calendarNextMonth": "Next month",
            "contactsTasks.calendarDayCellOne": "{date}, {count} task",
            "contactsTasks.calendarDayCellMany": "{date}, {count} tasks",
            "contactsTasks.weekdayMon": "Mon",
            "contactsTasks.weekdayTue": "Tue",
            "contactsTasks.weekdayWed": "Wed",
            "contactsTasks.weekdayThu": "Thu",
            "contactsTasks.weekdayFri": "Fri",
            "contactsTasks.weekdaySat": "Sat",
            "contactsTasks.weekdaySun": "Sun",

            // Map
            "contactsTasks.mapCounts": "{located} on the map",
            "contactsTasks.mapCountsWithMissing":
                "{located} on the map · {missing} without a location",
            "contactsTasks.mapMissingCount": "{missing} without a location",
            "contactsTasks.mapNoLocatedTasks": "No located tasks yet.",
            "contactsTasks.mapAddAnAddress":
                "Add an address to a contact and its tasks appear here.",
            "contactsTasks.mapThisLocation": "This location",
            "contactsTasks.mapTasksHere": "{count} tasks here",
            "contactsTasks.mapOpenTask": "Open task",
            "contactsTasks.mapDirections": "Directions",
            "contactsTasks.mapMore": "+{count} more",
            // A pin with no contact name is titled by its count. Android's map
            // has no marker title of its own (a Compose marker carries none),
            // so this one key is iOS's — French written here, for review.
            "contactsTasks.mapMarkerTasks": "{count} tasks",

            // Task detail
            "contactsTasks.taskGone": "This task doesn't exist or was removed.",
            "contactsTasks.taskActions": "Task actions",
            "contactsTasks.deleteTask": "Delete task",
            "contactsTasks.deleteForbidden":
                "Only the task's creator or an admin can delete it.",
            "contactsTasks.deleteTaskTitle": "Delete this task?",
            "contactsTasks.deleteTaskBody":
                "It carries {what}. The conversation and its messages stay; the done "
                + "mark on the source message is kept.",
            "contactsTasks.discussionNotes": "discussion notes",
            "contactsTasks.filesLower": "files",
            "contactsTasks.andJoiner": " and ",
            "contactsTasks.keepTask": "Keep task",
            "contactsTasks.taskTitlePlaceholder": "Task title",
            "contactsTasks.createdByName": "Created by {name}",
            "contactsTasks.due": "Due",
            "contactsTasks.noDueDate": "No due date",
            "contactsTasks.clearDueDate": "Clear due date",
            "contactsTasks.setDueDate": "Set due date",
            "contactsTasks.remind": "Remind",
            "contactsTasks.remindAria": "Remind this customer about this job",
            "contactsTasks.remindOff": "Off for this job",
            "contactsTasks.remindWorkspace": "Uses your workspace reminders",
            "contactsTasks.confirmedByCustomer": "They confirmed they'll be there.",
            "contactsTasks.confirmedByCrew": "Marked confirmed by your crew.",
            "contactsTasks.taskNoAccess":
                "This task is linked to a number you don't have access to. You can see "
                + "the task, but not its messages, files, or discussion. Ask an owner or "
                + "admin for access.",
            "contactsTasks.aPhoto": "A photo",
            "contactsTasks.fromThisMessage": "From this message",
            "contactsTasks.viewInConversation": "View in conversation",
            "contactsTasks.description": "Description",
            "contactsTasks.descriptionPlaceholder": "Add details teammates should know",
            "contactsTasks.files": "Files",
            "contactsTasks.activity": "Activity",
            "contactsTasks.activityEmpty":
                "No activity yet. Post a note below to start a discussion.",
            "contactsTasks.activityLine": "{sentence} · {when}",
            "contactsTasks.photo": "Photo",
            "contactsTasks.file": "File",
            "contactsTasks.couldntLoad": "Couldn't load",
            "contactsTasks.attachFiles": "Attach files",
            "contactsTasks.postNote": "Post note",
            "contactsTasks.noteComposerTeam": "Add a note for your team",
            "contactsTasks.removeNamed": "Remove {name}",
            "contactsTasks.noteFilesCap": "Up to {count} files per note.",
            "contactsTasks.noteFileTooBig": "Files must be 25 MB or less.",
            "contactsTasks.noteUploadFailedOne":
                "The note posted, but {count} file didn't upload. Retry from the note "
                + "in the thread.",
            "contactsTasks.noteUploadFailedMany":
                "The note posted, but {count} files didn't upload. Retry from the note "
                + "in the thread.",

            // The visit a strip of photos arrived on (#294)
            "contactsTasks.photosFromCustomer": "From the customer",
            "contactsTasks.photosFromCrew": "Added by the crew",

            // The task's job address
            "contactsTasks.address": "Address",
            "contactsTasks.clear": "Clear",
            "contactsTasks.clearAddress": "Clear address",
            "contactsTasks.addrStreet": "Street",
            "contactsTasks.addrUnit": "Unit / suite",
            "contactsTasks.addrCity": "City",
            "contactsTasks.addrState": "State / province",
            "contactsTasks.addrPostalCode": "Postal code",

            // Job photos (#294)
            "contactsTasks.jobPhotosShare": "Share these photos",
            "contactsTasks.jobPhotosMakingLink": "Making a link…",
            "contactsTasks.jobPhotosExpiry":
                "Anyone with this link can see the photos until {when}.",
            "contactsTasks.jobPhotosTurnOff": "Turn this link off",
            "contactsTasks.copy": "Copy",

            // ── Contacts: the list, the record and the merge ─────────────────
            "contactsTasks.contactsTitle": "Contacts",
            "contactsTasks.contactHeading": "Contact",
            "contactsTasks.newContact": "New contact",
            "contactsTasks.addContact": "Add contact",
            "contactsTasks.adding": "Adding…",
            "contactsTasks.add": "Add",
            // The FINISH-EDITING button, and Android carries the same key
            // beside the same `columnDone`: one is a verb somebody presses,
            // the other is a status a task is in. They read alike in both
            // languages today and are still two different sentences.
            "contactsTasks.done": "Done",
            "contactsTasks.change": "Change",
            "contactsTasks.changeTimezone": "Change timezone",
            "contactsTasks.changeLanguage": "Change language",
            "contactsTasks.working": "Working…",
            "contactsTasks.saveFailed": "Couldn't save. Check your connection.",
            "contactsTasks.optional": "Optional",
            "contactsTasks.labelField": "Label",
            "contactsTasks.numberField": "Number",
            "contactsTasks.phoneField": "Phone",
            "contactsTasks.nameField": "Name",
            "contactsTasks.notesField": "Notes",
            "contactsTasks.businessField": "Business",
            "contactsTasks.emailField": "Email",
            "contactsTasks.nanpHint": "Enter a 10-digit US or Canada number.",
            "contactsTasks.addAName": "Add a name",
            "contactsTasks.addAnAddress": "Add an address",
            "contactsTasks.businessPlaceholder": "Who they work for, if anyone",
            "contactsTasks.emailPlaceholder": "For quotes and receipts",
            "contactsTasks.notesPlaceholder":
                "Gate code, dog's name, preferred arrival window…",
            "contactsTasks.searchNameOrNumber": "Search name or number",
            "contactsTasks.noMatchesFor": "No matches for \"{query}\".",
            "contactsTasks.noContactsYet":
                "No contacts yet. They're added automatically when someone texts you, "
                + "or add one yourself.",
            // The filtered-empty list (#291). NOT `noContactsYet`: under a
            // filter those customers are excluded, not missing, and "they're
            // added automatically" reads as having none at all.
            "contactsTasks.filterEmptyTitle": "Nobody matches that yet",
            "contactsTasks.filterEmptyBody":
                "No customer has that answer on file. Clear the filter to see everyone.",
            "contactsTasks.optedOut": "Opted out",
            "contactsTasks.contactGone": "This contact doesn't exist or was removed.",

            // Who put this record here, and who last touched it (#191)
            "contactsTasks.addedBy": "Added by {who}",
            "contactsTasks.addedByOn": "Added by {who} on {date}",
            "contactsTasks.editedBy": "Edited by {who}",

            // The consent card (#226). Same words as web's `appShell.ts`, so a
            // crew reading it on the phone and then on the laptop is not told
            // two things about one customer.
            "contactsTasks.consentNone":
                "No consent recorded yet. It's recorded when they text you first, "
                + "or when you send them their first text, which attests they asked "
                + "for it.",
            "contactsTasks.consentTextedFirst": "Texted you first",
            "contactsTasks.consentRecorded": "Consent recorded",
            "contactsTasks.consentRecordedBy": "Consent recorded by {name}",
            "contactsTasks.copyNumber": "Copy number",
            "contactsTasks.openConversation": "Open conversation",
            "contactsTasks.openTheConversation": "Open the conversation",
            "contactsTasks.messageAria": "Message",
            "contactsTasks.conversationsSection": "Conversations",
            "contactsTasks.textAction": "Text",
            "contactsTasks.call": "Call",
            "contactsTasks.calling": "Calling…",
            "contactsTasks.callingAria": "Calling",
            "contactsTasks.optedOutBanner":
                "This customer opted out of texting. Sends to them are blocked.",
            // STOP and START are carrier keywords: a carrier matches on the
            // literal word, so they are never translated.
            "contactsTasks.optedOutByCarrier":
                "They texted STOP, so their carrier is blocking your texts. Only they "
                + "can undo it, by texting START to your number.",
            "contactsTasks.optedOutByHand":
                "Someone recorded this by hand, so undoing it here is all it takes.",
            "contactsTasks.markOptedInAgain": "Mark opted in again",
            "contactsTasks.optOut": "Opt out",
            "contactsTasks.optOutContact": "Opt out this contact",
            "contactsTasks.optOutTitle": "Opt out this contact?",
            "contactsTasks.optOutBody":
                "All texting to {number} is blocked until they're opted back in. Use "
                + "this when a customer asks you to stop texting them.",
            "contactsTasks.manageThisContact": "Manage this contact",
            "contactsTasks.stopAllTexting": "Stop all texting to this customer.",
            "contactsTasks.hideThisContact":
                "Hide this contact from your list. Texting history stays, and they "
                + "reappear if they text you again.",
            "contactsTasks.deleteContact": "Delete contact",
            "contactsTasks.deleteContactTitle": "Delete this contact?",
            "contactsTasks.deleteContactBody":
                "They disappear from your contact list. Conversations and messages "
                + "stay, and the contact comes back automatically if they text you again.",
            "contactsTasks.keepContact": "Keep contact",
            "contactsTasks.theirTime": "Their time",
            "contactsTasks.theirLanguage": "Their language",
            // #228: "Same as workspace", not "your" — this entry existed and
            // was bypassed by a hardcoded literal in ContactDetailView, which
            // is why the two disagreed without anything noticing.
            "contactsTasks.sameAsWorkspace": "Same as workspace",
            "contactsTasks.sameAsWorkspaceNamed": "Same as workspace ({language})",
            "contactsTasks.setOnThisContact": "Set on this contact",
            "contactsTasks.useAreaCode": "Use their area code",

            // The other numbers and addresses this customer has (#291)
            "contactsTasks.phoneAddAnother": "Add another number",
            "contactsTasks.phoneLabelPlaceholder": "Landline, the wife, the shop…",
            "contactsTasks.phonePlaceholder": "Another number they answer",
            "contactsTasks.phoneMatchNote":
                "Texts and calls from this number will show up under this customer, in "
                + "their own thread.",
            "contactsTasks.phoneRemove": "Remove {number}",
            "contactsTasks.addressPrimary": "Where the van goes",
            "contactsTasks.addressMakePrimary": "Make it the main one",
            "contactsTasks.addressLabelPlaceholder": "Unit 4, Billing, the rooftop…",
            "contactsTasks.addressPlaceholder": "Where the job is",
            "contactsTasks.addressAddAnother": "Add another address",
            "contactsTasks.addressRemove": "Remove {address}",

            // The phone's own address book (#459)
            "contactsTasks.onThisPhone": "On this phone",
            "contactsTasks.devicePhoneNoMatch": "Nobody here matches.",
            "contactsTasks.devicePhoneOwn":
                "Your own contacts. They stay on your phone.",
            "contactsTasks.devicePhoneAsk":
                "Let Loonext read your phone's contacts and they show up here, so you "
                + "can text somebody without adding them first. They stay on your phone.",
            "contactsTasks.showMyPhoneContacts": "Show my phone contacts",
            "contactsTasks.showAllFromPhone": "Show all from this phone",
            // #228 — the four value-list controls on the import mapping screen.
            // Named by packages/shared/src/contact-import.ts and by Android from the
            // same keys; iOS was the one client still holding them as literals.
            "contactsTasks.importHiddenValues": "and {count} more",
            "contactsTasks.importShowAllValues": "Show all {count} values",
            "contactsTasks.importShowFewerValues": "Show fewer values",
            "contactsTasks.importValueCeiling": "Showing {shown} of the {total} different answers in this column.",
            "contactsTasks.contactsNeedSettings":
                "Turn Contacts on for Loonext in Settings.",
            "contactsTasks.addToContacts": "Add {name} to contacts",

            // Import and export
            "contactsTasks.importing": "Importing…",
            "contactsTasks.importCsvOrVcard": "Import CSV or vCard",
            "contactsTasks.csvFile": "CSV file",
            "contactsTasks.vcardFile": "vCard file (.vcf)",
            "contactsTasks.exporting": "Exporting…",
            "contactsTasks.exportCsv": "Export CSV",
            "contactsTasks.beforeImporting": "Before importing",
            "contactsTasks.importAction": "Import",
            "contactsTasks.importFinished": "Import finished",
            "contactsTasks.skippedRowsHeading": "Skipped rows",
            "contactsTasks.andMore": "…and {count} more.",
            "contactsTasks.nothingWasImported": "Nothing was imported",
            "contactsTasks.noContactsAddedOrChanged":
                " · no contacts were added or changed",
            "contactsTasks.exportFailed": "The export didn't go through. Try again.",
            "contactsTasks.fileUnreadable": "Couldn't read that file. Try again.",

            // THE CLAIM, copied from web's `consentLabelFile` through Android's
            // `importAttestation`. It is never pre-ticked on any surface. What
            // travels is `consent_attested=true`, never this sentence, so a
            // translation here cannot change what a workspace attested to.
            "contactsTasks.importAttestation":
                "Everyone in this file agreed to be texted by this business.",
            // The three facts under it, in the order somebody worries about
            // them. iOS-only wording — Android says the second of these
            // differently, and changing either to match would be a copy change
            // wearing a translation's clothes. French written here, for review.
            "contactsTasks.importRecordsYourName":
                "We record your name and today's date against everyone in this file "
                + "who has no consent recorded yet.",
            "contactsTasks.importKeepsExistingConsent":
                "Anyone who already has consent recorded keeps the one they have.",
            // STOP is a carrier keyword: a carrier matches on the literal word.
            "contactsTasks.importStopStaysBlocked":
                "Anyone who has texted STOP stays blocked. Importing them again does "
                + "not undo that.",

            // Duplicates and merging (#246)
            "contactsTasks.duplicatesOnePair": "These two look like the same customer",
            "contactsTasks.duplicatesManyPairs":
                "{count} pairs look like the same customer",
            "contactsTasks.duplicatesBlurb":
                "Merging keeps every message, task and photo from both, under one record.",
            "contactsTasks.duplicatesPair": "{a} and {b}",
            "contactsTasks.merge": "Merge",
            "contactsTasks.mergeAria": "Merge {a} and {b}",
            "contactsTasks.merging": "Merging…",
            "contactsTasks.merged": "Merged.",
            "contactsTasks.mergedOptedOut":
                "Merged. This customer is opted out, so nothing sends to either number.",
            "contactsTasks.mergeDialogTitle": "Merge these two customers",
            "contactsTasks.mergeDialogBody":
                "Everything from both — messages, tasks, photos, notes — ends up under "
                + "the record you keep. Both phone numbers keep working.",
            "contactsTasks.mergeWhichToKeep": "Which one to keep",
            "contactsTasks.mergeDirection":
                "{folded} stops being a separate customer. Its history moves to {survivor}.",

            // The contact's calls and history sections
            "contactsTasks.callsSection": "Calls",
            "contactsTasks.historySection": "History",
            "contactsTasks.noCallsYet": "No calls with this contact yet.",
            "contactsTasks.timelineEmpty":
                "Texts, calls and jobs for this customer will collect here.",
            "contactsTasks.showMore": "Show more",
            "contactsTasks.showEarlier": "Show earlier",
            "contactsTasks.playVoicemail": "Play voicemail",
            "contactsTasks.pauseVoicemail": "Pause voicemail",
            "contactsTasks.voicemailPlayFailed": "Couldn't play this voicemail.",

            // ── Calls: the log, the keypad, the ring and the live call ───────
            "contactsTasks.callsTitle": "Calls",
            "contactsTasks.callsRingWhileOpen": "Calls ring here while the app is open.",
            "contactsTasks.filterAll": "All",
            "contactsTasks.filterMissed": "Missed",
            "contactsTasks.filterVoicemail": "Voicemail",
            "contactsTasks.noMissedCalls": "No missed calls.",
            "contactsTasks.noVoicemailsYet": "No voicemails yet.",
            "contactsTasks.noCallsYetLog":
                "No calls yet. When customers call your number, they land here.",
            "contactsTasks.dialANumber": "Dial a number",
            "contactsTasks.readyToRing": "Ready to ring",
            "contactsTasks.offlineRetry": "Offline · retry",
            "contactsTasks.connecting": "Connecting…",
            "contactsTasks.ongoing": "Ongoing",
            "contactsTasks.decline": "Decline",
            "contactsTasks.answer": "Answer",
            "contactsTasks.hangUp": "Hang up",
            "contactsTasks.dismiss": "Dismiss",
            "contactsTasks.phaseIncoming": "Incoming call",
            "contactsTasks.phaseCalling": "Calling…",
            "contactsTasks.phaseOnHold": "On hold",
            "contactsTasks.phaseEnded": "Call ended",
            "contactsTasks.timerOnHold": "{timer} · {count} on hold",
            // The iOS Settings app, which is not where Android sends anybody —
            // hence a key of its own rather than Android's `micNeeded`.
            "contactsTasks.micNeededToAnswer":
                "Loonext needs the microphone to answer calls. "
                + "Allow it in Settings › Loonext.",
            "contactsTasks.micNeededToPlace":
                "Loonext needs the microphone to place calls. "
                + "Allow it in Settings › Loonext.",

            // The keypad
            "contactsTasks.fromNumber": "From {number}",
            "contactsTasks.enterANumber": "Enter a number",
            "contactsTasks.sendMessageInstead": "Send a message instead",
            "contactsTasks.deleteLastDigit": "Delete last digit",
            "contactsTasks.openContact": "Open contact",

            // The live call
            "contactsTasks.hide": "Hide",
            "contactsTasks.mute": "Mute",
            "contactsTasks.unmute": "Unmute",
            "contactsTasks.keypad": "Keypad",
            "contactsTasks.hold": "Hold",
            "contactsTasks.resume": "Resume",
            "contactsTasks.transfer": "Transfer",
            "contactsTasks.swap": "Swap",
            "contactsTasks.speaker": "Speaker",
            "contactsTasks.endCall": "End call",
            "contactsTasks.addNoteAction": "Add a note in the conversation",
            "contactsTasks.transferThisCall": "Transfer this call",
            "contactsTasks.transferHoldNote":
                "The customer stays on hold while we ring them.",
            "contactsTasks.noTeammatesAvailable":
                "No teammates can take this call right now.",
            "contactsTasks.transferSnapBack":
                "If they decline, the call snaps back to you.",
            "contactsTasks.onACall": "On a call",
            "contactsTasks.available": "Available",

            // ── Getting paid, and asking for it ──────────────────────────────
            // The prefix is PaymentsStrings'; these keys are the rest of the
            // two payment screens. See the note at the top of this file.
            "payments.opening": "Opening…",
            "payments.opensStripeInBrowser": "Opens Stripe in your browser.",
            "payments.onlyOwnerConnectsStripe":
                "Only the account owner can connect Stripe — it needs their "
                + "business details and their bank account.",
            "payments.whereMoneyGoes": "Where the money goes",
            "payments.payouts": "Payouts",
            "payments.payoutsOn": "On — money reaches your bank",
            "payments.payoutsOff": "Stripe has not switched payouts on yet",
            "payments.chargedIn": "Charged in",
            "payments.stripeDashboardNote":
                "Refunds, receipts and payout history all live in your Stripe "
                + "dashboard. We never hold your money and we take nothing on top "
                + "of what you charge — Stripe's own card fee is the only deduction.",
            "payments.deposit": "Deposit",
            "payments.previewLabel": "What the customer receives",
            "payments.sending": "Sending…",
            "payments.yourBusiness": "Your business",
            "payments.goesOutAsText":
                "Goes out as a text with a secure payment link. The money lands "
                + "in your bank account — we take nothing on top.",
        ],
        frCA: [
            // ── Tâches : la liste, le tableau, le calendrier et la carte ─────
            "contactsTasks.tasksTitle": "Tâches",
            "contactsTasks.taskHeading": "Tâche",
            "contactsTasks.searchTaskTitles": "Rechercher un titre de tâche",
            "contactsTasks.clearSearch": "Effacer la recherche",
            "contactsTasks.viewList": "Vue liste",
            "contactsTasks.viewBoard": "Vue tableau",
            "contactsTasks.viewCalendar": "Vue calendrier",
            "contactsTasks.viewMap": "Vue carte",
            "contactsTasks.tabOpen": "Ouvertes",
            "contactsTasks.tabMine": "Les miennes",
            "contactsTasks.tabAll": "Toutes",
            "contactsTasks.tabDone": "Terminées",
            "contactsTasks.dueOverdue": "En retard",
            "contactsTasks.dueToday": "Échéance aujourd'hui",
            "contactsTasks.dueThisWeek": "Échéance cette semaine",
            "contactsTasks.assignee": "Assignée à",
            "contactsTasks.clearAssigneeFilter": "Effacer le filtre d'assignation",
            "contactsTasks.unassigned": "Non assignée",
            "contactsTasks.unassign": "Désassigner",
            "contactsTasks.assignTo": "Assigner à {who}",
            "contactsTasks.you": "Vous",
            "contactsTasks.youSuffix": " (vous)",
            "contactsTasks.teammate": "Coéquipier",
            "contactsTasks.selected": "Sélectionné",
            "contactsTasks.searchTeammates": "Rechercher un coéquipier",
            "contactsTasks.noTeammatesMatch": "Aucun coéquipier ne correspond.",
            "contactsTasks.listEmptyFiltered": "Rien dans cette liste.",
            "contactsTasks.listEmpty":
                "Aucune tâche pour l'instant. Transformez un texto en tâche depuis son "
                + "menu ⋯ dans une conversation.",
            "contactsTasks.loadMore": "Charger plus",
            "contactsTasks.loading": "Chargement…",
            "contactsTasks.columnToDo": "À faire",
            "contactsTasks.columnToDoEmpty": "Rien à faire ici.",
            "contactsTasks.columnDone": "Terminé",
            "contactsTasks.columnDoneEmpty": "Rien n'est encore marqué comme terminé.",
            "contactsTasks.moveToDone": "Déplacer vers Terminé",
            "contactsTasks.moveToToDo": "Déplacer vers À faire",
            "contactsTasks.markDone": "Marquer comme terminée",
            "contactsTasks.markNotDone": "Marquer comme non terminée",
            "contactsTasks.dueWhen": "Échéance {when}",
            "contactsTasks.overdueDot": "En retard · {due}",
            "contactsTasks.overdueDueWhen": "En retard · échéance {when}",
            "contactsTasks.today": "Aujourd'hui",
            "contactsTasks.tomorrow": "Demain",
            "contactsTasks.clearSelection": "Effacer la sélection",
            "contactsTasks.moreBulkActions": "Plus d'actions groupées",
            "contactsTasks.selectThese": "Sélectionner ces {count}",
            "contactsTasks.selectAllMatching": "Tout sélectionner",
            "contactsTasks.bulkFailed": "L'opération n'a pas abouti. Rien n'a été modifié.",
            "contactsTasks.taskUpdateFailed": "Impossible de mettre à jour la tâche",
            "contactsTasks.everyTaskLinksBack": "Chaque tâche renvoie à son texto",

            // Calendrier
            "contactsTasks.calendarEmptyRange":
                "Rien n'est prévu dans cette période. Une tâche apparaît ici une fois "
                + "qu'elle a une date d'échéance. Fixez-la depuis l'écran de la tâche.",
            "contactsTasks.calendarScheduled": "{scheduled} prévues",
            "contactsTasks.calendarUndated": "{undated} sans date d'échéance",
            "contactsTasks.calendarScheduledAndUndated":
                "{scheduled} prévues · {undated} sans date d'échéance",
            "contactsTasks.calendarNothingDueThisDay": "Rien à faire ce jour-là.",
            "contactsTasks.calendarPreviousMonth": "Mois précédent",
            "contactsTasks.calendarNextMonth": "Mois suivant",
            "contactsTasks.calendarDayCellOne": "{date}, {count} tâche",
            "contactsTasks.calendarDayCellMany": "{date}, {count} tâches",
            "contactsTasks.weekdayMon": "lun",
            "contactsTasks.weekdayTue": "mar",
            "contactsTasks.weekdayWed": "mer",
            "contactsTasks.weekdayThu": "jeu",
            "contactsTasks.weekdayFri": "ven",
            "contactsTasks.weekdaySat": "sam",
            "contactsTasks.weekdaySun": "dim",

            // Carte
            "contactsTasks.mapCounts": "{located} sur la carte",
            "contactsTasks.mapCountsWithMissing":
                "{located} sur la carte · {missing} sans emplacement",
            "contactsTasks.mapMissingCount": "{missing} sans emplacement",
            "contactsTasks.mapNoLocatedTasks": "Aucune tâche localisée pour l'instant.",
            "contactsTasks.mapAddAnAddress":
                "Ajoutez une adresse à un client et ses tâches apparaissent ici.",
            "contactsTasks.mapThisLocation": "Cet emplacement",
            "contactsTasks.mapTasksHere": "{count} tâches ici",
            "contactsTasks.mapOpenTask": "Ouvrir la tâche",
            "contactsTasks.mapDirections": "Itinéraire",
            "contactsTasks.mapMore": "+{count} de plus",
            "contactsTasks.mapMarkerTasks": "{count} tâches",

            // Détail de la tâche
            "contactsTasks.taskGone": "Cette tâche n'existe pas ou a été supprimée.",
            "contactsTasks.taskActions": "Actions de la tâche",
            "contactsTasks.deleteTask": "Supprimer la tâche",
            "contactsTasks.deleteForbidden":
                "Seul le créateur de la tâche ou un administrateur peut la supprimer.",
            "contactsTasks.deleteTaskTitle": "Supprimer cette tâche ?",
            "contactsTasks.deleteTaskBody":
                "Elle contient {what}. La conversation et ses textos restent ; la "
                + "marque « terminé » sur le texto d'origine est conservée.",
            "contactsTasks.discussionNotes": "des notes de discussion",
            "contactsTasks.filesLower": "des fichiers",
            "contactsTasks.andJoiner": " et ",
            "contactsTasks.keepTask": "Conserver la tâche",
            "contactsTasks.taskTitlePlaceholder": "Titre de la tâche",
            "contactsTasks.createdByName": "Créée par {name}",
            "contactsTasks.due": "Échéance",
            "contactsTasks.noDueDate": "Aucune date d'échéance",
            "contactsTasks.clearDueDate": "Effacer la date d'échéance",
            "contactsTasks.setDueDate": "Fixer l'échéance",
            "contactsTasks.remind": "Rappel",
            "contactsTasks.remindAria": "Rappeler ce travail à ce client",
            "contactsTasks.remindOff": "Désactivé pour ce travail",
            "contactsTasks.remindWorkspace":
                "Utilise les rappels de votre espace de travail",
            "contactsTasks.confirmedByCustomer": "Le client a confirmé sa présence.",
            "contactsTasks.confirmedByCrew": "Confirmée par votre équipe.",
            "contactsTasks.taskNoAccess":
                "Cette tâche est liée à un numéro auquel vous n'avez pas accès. Vous "
                + "voyez la tâche, mais pas ses textos, ses fichiers ni sa discussion. "
                + "Demandez l'accès à un propriétaire ou à un administrateur.",
            "contactsTasks.aPhoto": "Une photo",
            "contactsTasks.fromThisMessage": "À partir de ce texto",
            "contactsTasks.viewInConversation": "Voir dans la conversation",
            "contactsTasks.description": "Description",
            "contactsTasks.descriptionPlaceholder":
                "Ajoutez les détails que l'équipe doit connaître",
            "contactsTasks.files": "Fichiers",
            "contactsTasks.activity": "Activité",
            "contactsTasks.activityEmpty":
                "Aucune activité pour l'instant. Publiez une note ci-dessous pour "
                + "lancer la discussion.",
            "contactsTasks.activityLine": "{sentence} · {when}",
            "contactsTasks.photo": "Photo",
            "contactsTasks.file": "Fichier",
            "contactsTasks.couldntLoad": "Chargement impossible",
            "contactsTasks.attachFiles": "Joindre des fichiers",
            "contactsTasks.postNote": "Publier la note",
            "contactsTasks.noteComposerTeam": "Ajoutez une note pour votre équipe",
            "contactsTasks.removeNamed": "Retirer {name}",
            "contactsTasks.noteFilesCap": "Jusqu'à {count} fichiers par note.",
            "contactsTasks.noteFileTooBig": "Les fichiers doivent faire 25 Mo ou moins.",
            "contactsTasks.noteUploadFailedOne":
                "La note a été publiée, mais {count} fichier n'a pas été téléversé. "
                + "Réessayez depuis la note dans la conversation.",
            "contactsTasks.noteUploadFailedMany":
                "La note a été publiée, mais {count} fichiers n'ont pas été téléversés. "
                + "Réessayez depuis la note dans la conversation.",

            // La visite dont provient une bande de photos (#294)
            "contactsTasks.photosFromCustomer": "Du client",
            "contactsTasks.photosFromCrew": "Ajoutées par l'équipe",

            // L'adresse du travail
            "contactsTasks.address": "Adresse",
            "contactsTasks.clear": "Effacer",
            "contactsTasks.clearAddress": "Effacer l'adresse",
            "contactsTasks.addrStreet": "Rue",
            "contactsTasks.addrUnit": "Unité / bureau",
            "contactsTasks.addrCity": "Ville",
            "contactsTasks.addrState": "État / province",
            "contactsTasks.addrPostalCode": "Code postal",

            // Photos du travail (#294)
            "contactsTasks.jobPhotosShare": "Partager ces photos",
            "contactsTasks.jobPhotosMakingLink": "Création du lien…",
            "contactsTasks.jobPhotosExpiry":
                "Toute personne ayant ce lien peut voir les photos jusqu'au {when}.",
            "contactsTasks.jobPhotosTurnOff": "Désactiver ce lien",
            "contactsTasks.copy": "Copier",

            // ── Clients : la liste, la fiche et la fusion ────────────────────
            "contactsTasks.contactsTitle": "Clients",
            "contactsTasks.contactHeading": "Client",
            "contactsTasks.newContact": "Nouveau client",
            "contactsTasks.addContact": "Ajouter le client",
            "contactsTasks.adding": "Ajout…",
            "contactsTasks.add": "Ajouter",
            "contactsTasks.done": "Terminé",
            "contactsTasks.change": "Modifier",
            "contactsTasks.changeTimezone": "Changer le fuseau horaire",
            "contactsTasks.changeLanguage": "Changer la langue",
            "contactsTasks.working": "Traitement…",
            "contactsTasks.saveFailed":
                "Enregistrement impossible. Vérifiez votre connexion.",
            "contactsTasks.optional": "Facultatif",
            "contactsTasks.labelField": "Étiquette",
            "contactsTasks.numberField": "Numéro",
            "contactsTasks.phoneField": "Téléphone",
            "contactsTasks.nameField": "Nom",
            "contactsTasks.notesField": "Notes",
            "contactsTasks.businessField": "Entreprise",
            "contactsTasks.emailField": "Courriel",
            "contactsTasks.nanpHint":
                "Entrez un numéro à 10 chiffres des États-Unis ou du Canada.",
            "contactsTasks.addAName": "Ajouter un nom",
            "contactsTasks.addAnAddress": "Ajouter une adresse",
            "contactsTasks.businessPlaceholder": "Pour qui il travaille, le cas échéant",
            "contactsTasks.emailPlaceholder": "Pour les devis et les reçus",
            "contactsTasks.notesPlaceholder":
                "Code de portail, nom du chien, plage d'arrivée préférée…",
            "contactsTasks.searchNameOrNumber": "Rechercher un nom ou un numéro",
            "contactsTasks.noMatchesFor": "Aucun résultat pour « {query} ».",
            "contactsTasks.noContactsYet":
                "Aucun client pour l'instant. Ils sont ajoutés automatiquement quand "
                + "quelqu'un vous texte, ou ajoutez-en un vous-même.",
            // La liste vidée par un filtre (#291)
            "contactsTasks.filterEmptyTitle": "Personne ne correspond pour l'instant",
            "contactsTasks.filterEmptyBody":
                "Aucun client n'a cette réponse au dossier. Retirez le filtre pour "
                + "voir tout le monde.",
            "contactsTasks.optedOut": "Désabonné",
            "contactsTasks.contactGone": "Ce client n'existe pas ou a été supprimé.",

            // Qui a créé cette fiche, et qui l'a modifiée en dernier (#191)
            "contactsTasks.addedBy": "Ajouté par {who}",
            "contactsTasks.addedByOn": "Ajouté par {who} le {date}",
            "contactsTasks.editedBy": "Modifié par {who}",

            // La carte de consentement (#226)
            "contactsTasks.consentNone":
                "Aucun consentement enregistré pour l'instant. Il est enregistré quand "
                + "le client vous texte en premier, ou quand vous lui envoyez son "
                + "premier texto, ce qui atteste qu'il l'a demandé.",
            "contactsTasks.consentTextedFirst": "Vous a texté en premier",
            "contactsTasks.consentRecorded": "Consentement enregistré",
            "contactsTasks.consentRecordedBy": "Consentement enregistré par {name}",
            "contactsTasks.copyNumber": "Copier le numéro",
            "contactsTasks.openConversation": "Ouvrir la conversation",
            "contactsTasks.openTheConversation": "Ouvrir la conversation",
            "contactsTasks.messageAria": "Écrire un texto",
            "contactsTasks.conversationsSection": "Conversations",
            "contactsTasks.textAction": "Texter",
            "contactsTasks.call": "Appeler",
            "contactsTasks.calling": "Appel…",
            "contactsTasks.callingAria": "Appel en cours",
            "contactsTasks.optedOutBanner":
                "Ce client s'est désabonné des textos. Les envois vers lui sont bloqués.",
            "contactsTasks.optedOutByCarrier":
                "Il a texté STOP, alors son fournisseur bloque vos textos. Lui seul "
                + "peut annuler cela, en textant START à votre numéro.",
            "contactsTasks.optedOutByHand":
                "Quelqu'un l'a inscrit à la main, alors il suffit de l'annuler ici.",
            "contactsTasks.markOptedInAgain": "Marquer comme réabonné",
            "contactsTasks.optOut": "Désabonner",
            "contactsTasks.optOutContact": "Désabonner ce client",
            "contactsTasks.optOutTitle": "Désabonner ce client ?",
            "contactsTasks.optOutBody":
                "Tous les textos vers {number} sont bloqués jusqu'au réabonnement. "
                + "Utilisez ceci quand un client vous demande d'arrêter de lui texter.",
            "contactsTasks.manageThisContact": "Gérer ce client",
            "contactsTasks.stopAllTexting": "Cesser tous les textos vers ce client.",
            "contactsTasks.hideThisContact":
                "Masquer ce client de votre liste. L'historique des textos reste, et "
                + "il réapparaît s'il vous texte de nouveau.",
            "contactsTasks.deleteContact": "Supprimer le client",
            "contactsTasks.deleteContactTitle": "Supprimer ce client ?",
            "contactsTasks.deleteContactBody":
                "Il disparaît de votre liste de clients. Les conversations et les "
                + "textos restent, et le client revient automatiquement s'il vous texte "
                + "de nouveau.",
            "contactsTasks.keepContact": "Conserver le client",
            "contactsTasks.theirTime": "Son heure",
            "contactsTasks.theirLanguage": "Sa langue",
            "contactsTasks.sameAsWorkspace": "Comme l'espace de travail",
            "contactsTasks.sameAsWorkspaceNamed":
                "Comme l'espace de travail ({language})",
            "contactsTasks.setOnThisContact": "Défini sur cette fiche",
            "contactsTasks.useAreaCode": "Utiliser son indicatif régional",

            // Les autres numéros et adresses de ce client (#291)
            "contactsTasks.phoneAddAnother": "Ajouter un autre numéro",
            "contactsTasks.phoneLabelPlaceholder": "Fixe, la conjointe, l'atelier…",
            "contactsTasks.phonePlaceholder": "Un autre numéro auquel il répond",
            "contactsTasks.phoneMatchNote":
                "Les textos et les appels provenant de ce numéro apparaîtront sous ce "
                + "client, dans sa propre conversation.",
            "contactsTasks.phoneRemove": "Retirer {number}",
            "contactsTasks.addressPrimary": "Où le camion se rend",
            "contactsTasks.addressMakePrimary": "En faire l'adresse principale",
            "contactsTasks.addressLabelPlaceholder": "Unité 4, Facturation, le toit…",
            "contactsTasks.addressPlaceholder": "Où se fait la tâche",
            "contactsTasks.addressAddAnother": "Ajouter une autre adresse",
            "contactsTasks.addressRemove": "Retirer {address}",

            // Le carnet d'adresses du téléphone (#459)
            "contactsTasks.onThisPhone": "Sur ce téléphone",
            "contactsTasks.devicePhoneNoMatch": "Personne ne correspond ici.",
            "contactsTasks.devicePhoneOwn":
                "Vos propres contacts. Ils restent sur votre téléphone.",
            "contactsTasks.devicePhoneAsk":
                "Laissez Loonext lire les contacts de votre téléphone pour qu'ils "
                + "s'affichent ici, afin de texter quelqu'un sans l'ajouter d'abord. "
                + "Ils restent sur votre téléphone.",
            "contactsTasks.showMyPhoneContacts":
                "Afficher les contacts de mon téléphone",
            "contactsTasks.showAllFromPhone": "Tout afficher depuis ce téléphone",
            "contactsTasks.importHiddenValues": "et {count} de plus",
            "contactsTasks.importShowAllValues": "Afficher les {count} valeurs",
            "contactsTasks.importShowFewerValues": "Afficher moins de valeurs",
            "contactsTasks.importValueCeiling": "Affichage de {shown} des {total} réponses différentes de cette colonne.",
            "contactsTasks.contactsNeedSettings":
                "Activez les contacts pour Loonext dans les Réglages.",
            "contactsTasks.addToContacts": "Ajouter {name} aux clients",

            // Importation et exportation
            "contactsTasks.importing": "Importation…",
            "contactsTasks.importCsvOrVcard": "Importer un CSV ou une vCard",
            "contactsTasks.csvFile": "Fichier CSV",
            "contactsTasks.vcardFile": "Fichier vCard (.vcf)",
            "contactsTasks.exporting": "Exportation…",
            "contactsTasks.exportCsv": "Exporter en CSV",
            "contactsTasks.beforeImporting": "Avant l'importation",
            "contactsTasks.importAction": "Importer",
            "contactsTasks.importFinished": "Importation terminée",
            "contactsTasks.skippedRowsHeading": "Lignes ignorées",
            "contactsTasks.andMore": "…et {count} de plus.",
            "contactsTasks.nothingWasImported": "Rien n'a été importé",
            "contactsTasks.noContactsAddedOrChanged":
                " · aucun client n'a été ajouté ni modifié",
            "contactsTasks.exportFailed": "L'exportation n'a pas abouti. Réessayez.",
            "contactsTasks.fileUnreadable": "Impossible de lire ce fichier. Réessayez.",

            // LA déclaration : sa formulation est ce qui autorise l'envoi.
            "contactsTasks.importAttestation":
                "Toutes les personnes de ce fichier ont accepté de recevoir des textos "
                + "de cette entreprise.",
            "contactsTasks.importRecordsYourName":
                "Nous enregistrons votre nom et la date d'aujourd'hui pour toutes les "
                + "personnes de ce fichier qui n'ont pas encore de consentement "
                + "enregistré.",
            "contactsTasks.importKeepsExistingConsent":
                "Toute personne qui a déjà un consentement enregistré conserve celui-ci.",
            // STOP est un mot-clé de fournisseur : jamais traduit.
            "contactsTasks.importStopStaysBlocked":
                "Toute personne qui a texté STOP reste bloquée. L'importer de nouveau "
                + "n'annule pas cela.",

            // Doublons et fusion (#246)
            "contactsTasks.duplicatesOnePair":
                "Ces deux fiches semblent être le même client",
            "contactsTasks.duplicatesManyPairs":
                "{count} paires semblent être le même client",
            "contactsTasks.duplicatesBlurb":
                "La fusion conserve tous les textos, tâches et photos des deux, sous "
                + "une seule fiche.",
            "contactsTasks.duplicatesPair": "{a} et {b}",
            "contactsTasks.merge": "Fusionner",
            "contactsTasks.mergeAria": "Fusionner {a} et {b}",
            "contactsTasks.merging": "Fusion…",
            "contactsTasks.merged": "Fusionné.",
            "contactsTasks.mergedOptedOut":
                "Fusionné. Ce client s'est désabonné, alors rien n'est envoyé à l'un "
                + "ou l'autre numéro.",
            "contactsTasks.mergeDialogTitle": "Fusionner ces deux clients",
            "contactsTasks.mergeDialogBody":
                "Tout des deux — textos, tâches, photos, notes — se retrouve sous la "
                + "fiche que vous gardez. Les deux numéros continuent de fonctionner.",
            "contactsTasks.mergeWhichToKeep": "Laquelle garder",
            "contactsTasks.mergeDirection":
                "{folded} cesse d'être un client distinct. Son historique passe à "
                + "{survivor}.",

            // Les sections Appels et Historique de la fiche
            "contactsTasks.callsSection": "Appels",
            "contactsTasks.historySection": "Historique",
            "contactsTasks.noCallsYet": "Aucun appel avec ce client pour l'instant.",
            "contactsTasks.timelineEmpty":
                "Les textos, les appels et les travaux de ce client s'accumuleront ici.",
            "contactsTasks.showMore": "Voir plus",
            "contactsTasks.showEarlier": "Voir plus ancien",
            "contactsTasks.playVoicemail": "Lire le message vocal",
            "contactsTasks.pauseVoicemail": "Mettre le message vocal en pause",
            "contactsTasks.voicemailPlayFailed": "Impossible de lire ce message vocal.",

            // ── Appels : le journal, le clavier, la sonnerie et l'appel ──────
            "contactsTasks.callsTitle": "Appels",
            "contactsTasks.callsRingWhileOpen":
                "Les appels sonnent ici quand l'application est ouverte.",
            "contactsTasks.filterAll": "Tous",
            "contactsTasks.filterMissed": "Manqués",
            "contactsTasks.filterVoicemail": "Messages vocaux",
            "contactsTasks.noMissedCalls": "Aucun appel manqué.",
            "contactsTasks.noVoicemailsYet": "Aucun message vocal pour l'instant.",
            "contactsTasks.noCallsYetLog":
                "Aucun appel pour l'instant. Quand des clients appellent votre numéro, "
                + "les appels arrivent ici.",
            "contactsTasks.dialANumber": "Composer un numéro",
            "contactsTasks.readyToRing": "Prêt à sonner",
            "contactsTasks.offlineRetry": "Hors ligne · réessayer",
            "contactsTasks.connecting": "Connexion…",
            "contactsTasks.ongoing": "En cours",
            "contactsTasks.decline": "Refuser",
            "contactsTasks.answer": "Répondre",
            "contactsTasks.hangUp": "Raccrocher",
            "contactsTasks.dismiss": "Ignorer",
            "contactsTasks.phaseIncoming": "Appel entrant",
            "contactsTasks.phaseCalling": "Appel en cours…",
            "contactsTasks.phaseOnHold": "En attente",
            "contactsTasks.phaseEnded": "Appel terminé",
            "contactsTasks.timerOnHold": "{timer} · {count} en attente",
            "contactsTasks.micNeededToAnswer":
                "Loonext a besoin du microphone pour répondre aux appels. "
                + "Autorisez-le dans Réglages › Loonext.",
            "contactsTasks.micNeededToPlace":
                "Loonext a besoin du microphone pour passer des appels. "
                + "Autorisez-le dans Réglages › Loonext.",

            // Le clavier
            "contactsTasks.fromNumber": "Depuis {number}",
            "contactsTasks.enterANumber": "Entrez un numéro",
            "contactsTasks.sendMessageInstead": "Envoyer un texto à la place",
            "contactsTasks.deleteLastDigit": "Effacer le dernier chiffre",
            "contactsTasks.openContact": "Ouvrir la fiche",

            // L'appel en cours
            "contactsTasks.hide": "Masquer",
            "contactsTasks.mute": "Couper le micro",
            "contactsTasks.unmute": "Réactiver le micro",
            "contactsTasks.keypad": "Clavier",
            "contactsTasks.hold": "Mettre en attente",
            "contactsTasks.resume": "Reprendre",
            "contactsTasks.transfer": "Transférer",
            "contactsTasks.swap": "Permuter",
            "contactsTasks.speaker": "Haut-parleur",
            "contactsTasks.endCall": "Terminer l'appel",
            "contactsTasks.addNoteAction": "Ajouter une note dans la conversation",
            "contactsTasks.transferThisCall": "Transférer cet appel",
            "contactsTasks.transferHoldNote":
                "Le client reste en attente pendant que nous appelons cette personne.",
            "contactsTasks.noTeammatesAvailable":
                "Aucun coéquipier ne peut prendre cet appel en ce moment.",
            "contactsTasks.transferSnapBack": "S'il refuse, l'appel vous revient.",
            "contactsTasks.onACall": "En appel",
            "contactsTasks.available": "Disponible",

            // ── Encaisser les paiements, et les demander ─────────────────────
            "payments.opening": "Ouverture…",
            "payments.opensStripeInBrowser": "Ouvre Stripe dans votre navigateur.",
            "payments.onlyOwnerConnectsStripe":
                "Seul le propriétaire du compte peut relier Stripe — cela exige ses "
                + "renseignements d'entreprise et son compte bancaire.",
            "payments.whereMoneyGoes": "Où va l'argent",
            "payments.payouts": "Versements",
            "payments.payoutsOn": "Activés — l'argent se rend à votre banque",
            "payments.payoutsOff": "Stripe n'a pas encore activé les versements",
            "payments.chargedIn": "Facturé en",
            "payments.stripeDashboardNote":
                "Les remboursements, les reçus et l'historique des versements se "
                + "trouvent tous dans votre tableau de bord Stripe. Nous ne gardons "
                + "jamais votre argent et nous ne prenons rien de plus que ce que vous "
                + "facturez — les frais de carte de Stripe sont la seule retenue.",
            "payments.deposit": "Acompte",
            "payments.previewLabel": "Ce que le client reçoit",
            "payments.sending": "Envoi…",
            "payments.yourBusiness": "Votre entreprise",
            "payments.goesOutAsText":
                "Envoyé par texto avec un lien de paiement sécurisé. L'argent se rend "
                + "dans votre compte bancaire — nous ne prenons rien de plus.",
        ]
    )
}
