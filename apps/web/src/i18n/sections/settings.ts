/**
 * #228 — the words Settings says, in both languages.
 *
 * One file per surface so the extraction can run in parallel without every
 * change colliding in one catalogue, and so a translator working through a
 * screen sees its strings adjacent rather than sorted by concept.
 *
 * `fr` is typed as `en`'s exact shape: a key added to one and forgotten in the
 * other fails `tsc`. That is the whole reason this is TypeScript rather than
 * the JSON a library would want — a missing key in a JSON message file is a
 * runtime fallback nobody sees until a French reader does.
 */
import type { Translated } from "../translated";

export const settingsEn = {
  /* Shared across the settings screens. */
  saveFailed: "Couldn't save. Try again.",
  clearAction: "Clear",
  opening: "Opening…",

  /* Sign-in methods. "Google" and "Apple" are product names and stay put. */
  signInPassword: "Password",
  signInLinked: "Linked",
  signInNotLinked: "Not linked",

  /* After-hours calling (#278). */
  afterHoursTitle: "After hours",
  afterHoursDescription:
    "Outside your business hours a call can ring everyone, ring only whoever's " +
    "on call, or go straight to a message. Most small crews are best on the " +
    "first one.",
  afterHoursNoHours:
    "You haven't set business hours yet, so nothing here can happen — every " +
    "hour is a working hour until you do. Set them under Settings → Hours.",
  afterHoursGroupAria: "After-hours calling",
  afterHoursVoiceLabel: "After-hours voice",
  afterHoursSameGreeting: "The same greeting as always",
  afterHoursGreetingNote:
    'Played only outside your hours. "We\'re closed until Monday" and ' +
    '"we\'re on another job" are different messages, and one greeting cannot ' +
    "be both.",
  afterHoursAdminOnly: "Only owners and admins can change after-hours calling.",
  afterHoursSaved: "After-hours calling updated.",
  afterHoursGreetingSaved: "After-hours greeting updated.",
  afterHoursRingEveryone: "Ring everyone, day or night",
  afterHoursRingEveryoneDetail:
    "What happens today. Every call rings the whole crew whatever the clock says.",
  afterHoursOnCallOnly: "Ring only whoever's on call",
  afterHoursOnCallOnlyDetail:
    "After hours, the phone rings for the person holding the on-call shift and " +
    "nobody else. With no shift set, everyone rings — we never leave a call " +
    "reaching nobody.",
  afterHoursVoicemail: "Take a message",
  afterHoursVoicemailDetail:
    "After hours, the caller goes straight to your greeting instead of ringing " +
    "out first — unless somebody is on call, who still rings.",

  /* What Lou has done this month (#431). */
  aiUsageUsedOfCap: "{used} of {cap}",
  aiUsageOff: "Off",
  aiUsageBarAria: "{label}: {used} of {cap} used this month",
  aiUsageBarAriaOff: "{label}: turned off",
  aiUsageNearCap: "Close to this month’s limit. It resets on the 1st.",
  aiUsageNoOutcomes: "Nothing recorded yet about whether these got used.",

  /* Cancelling (#277).

     The consequence copy is a cross-client contract pinned by structural tests
     in `billing.test.tsx` — every count of days on this card has to name where
     it is counted FROM, and no sentence may claim texting is currently on. The
     card still exports the English of each line for those tests to read; the
     words themselves live here, so a French owner reads the same promise in
     their own language rather than an English one they have to trust. */
  cancelTitle: "Cancel",
  cancelPortalFailed: "Couldn't open the billing portal. Try again.",
  cancelExportFailed: "The export didn't go through. Try again.",
  cancelReasonGroupAria: "Why you are cancelling",
  cancelDetailPlaceholder: "Anything else worth telling us?",
  cancelDetailAria: "Anything else worth telling us (optional)",
  cancelCharactersLeft: "{count} characters left.",
  cancelExporting: "Exporting…",
  /* The six answers. The CODE is what gets recorded and never changes; this is
     only what the screen shows. */
  cancelReasonTooExpensive: "Too expensive",
  cancelReasonSeasonal: "Quiet season, I'll be back",
  cancelReasonMissingFeature: "Missing something I need",
  cancelReasonSwitched: "Going with something else",
  cancelReasonNotUsing: "Not using it",
  cancelReasonOther: "Something else",
  /* The hold is anchored to the CANCELLATION, not to the period end, in both
     voices — `runGraceJob` measures from `companies.canceled_at`, which Stripe
     stamps at the moment of the request. Somebody who reads the other anchor
     counts about twice the days they have, and what runs out is the number on
     the side of their van. Keep "{days} days from the day you cancel" adjacent
     in any rewrite, in either language. */
  cancelConsequence:
    "Cancel anytime. Your plan runs to the end of the billing period and does " +
    "not renew — texting stops then, if it has not stopped already. We hold " +
    "your number for {days} days from the day you cancel, not from the day " +
    "the plan ends, so the hold can run out soon afterwards. After that the " +
    "number is released for good.",
  cancelQuestion: "If you want to say why, it helps us fix it.",
  cancelQuestionNote: "Optional, and it changes nothing about cancelling.",
  cancelExportTitle: "Take your contacts with you",
  /* Names the columns the CSV actually carries. Custom fields are NOT in it,
     and somebody who has already left cannot come back and check. */
  cancelExportNote:
    "Every contact in this workspace as a CSV: names, numbers, tags and when " +
    "they opted in. It opens in a spreadsheet and imports into whatever you " +
    "use next. Yours either way.",
  cancelExportAction: "Export contacts",
  cancelSkipNote:
    "Nothing above has to be filled in. This takes you to Stripe either way, " +
    "where you finish cancelling.",
  cancelAction: "Continue to cancel",
  /* The admin's version: the same three facts, never in the second person,
     because an admin cannot do any of it — and they are the one relaying the
     deadline to the owner, so the anchor matters more here rather than less. */
  cancelAdminConsequence:
    "Only the owner can cancel this plan. When they do, the plan runs to the " +
    "end of the billing period and does not renew — texting stops then, if it " +
    "has not stopped already. We hold the number for {days} days from the day " +
    "they cancel, not from the day the plan ends, so the hold can run out soon " +
    "afterwards. After that the number is released for good.",
  cancelAdminNote:
    "The payment portal an admin reaches is the card screen and has no " +
    "cancellation on it, so this is not something to go looking for there.",

  /* The hold on the number, after cancelling. */
  holdGeneral:
    "We hold your number for {days} days from the day you cancel. Resubscribe " +
    "before then and everything picks up where it left off.",
  holdEndedLead: "The {days}-day hold on your number ended on",
  holdEndedTail:
    ". We are not keeping it for you any more, so plan on a new number if you " +
    "resubscribe — your message history is still here either way.",
  holdUntilLead: "We hold your number until",
  holdUntilTail:
    ". Resubscribe before then and everything picks up where it left off.",
  checkoutFailed: "Couldn't start checkout. Try again.",
  resubscribe: "Resubscribe",
  winbackNoThanks: "No thanks",

  /* The spending cap (#178). */
  capReadOnlyLead: "Spending cap:",
  capReadOnlyTail:
    "your included messages. Only the account owner can change it.",
  capSaved: "Cap set to {cap}.",
  capSaveFailed: "Couldn't change the cap. Try again.",
  capPausesAt: "Sending pauses at",
  capMessagesThisPeriod: "messages this period",
  capSliderValueText:
    "{cap} your included messages, pausing at {pauseAt} messages",
  capRailMin: "{n}× included",
  capRailMax: "{n}× max",
  capAtCeiling: "That's the highest the cap goes.",
  capSave: "Save cap",
  capFootnote:
    "The cap is a multiple of what your plan includes. If a month ever hits " +
    "it, sending pauses until you raise it, and nothing is billed past it.",

  /* Typing a word to confirm, on the two screens that ask for one. */
  typeToConfirmLead: "Type",
  typeToConfirmTail: "to confirm",
  neverMind: "Never mind",
  addAction: "Add",

  /* Picking a number after a failed provision. */
  chooseNumberTitle: "Choose your number",
  chooseNumberDescription:
    "Pick an available number to finish setting up your workspace. You won't " +
    "be charged again.",
  chooseNumberBeingSetUp: "{number} is being set up.",
  chooseNumberSettingUp: "Setting up your number.",
  chooseNumberFailed: "Couldn't set that up. Try again in a moment.",
  chooseNumberBusy: "Setting up…",
  chooseNumberAction: "Use this number",

  /* Closing the workspace (#341 / D48). */
  closeWorkspaceTitle: "Close this workspace",
  closeWorkspaceDescription:
    "Ends the account for everyone on it. This is not reversible after 30 days.",
  closeWorkspaceNumberReleased:
    "Everyone loses access straight away, and your number is released. It goes " +
    "back to the phone company and can be given to another business, so anyone " +
    "who still texts it will reach someone else. We cannot get it back for you.",
  closeWorkspacePortLead: "If you want to keep the number,",
  closeWorkspacePortEmphasis: "port it out to another carrier before you close",
  closeWorkspacePortTail: ". Afterwards it is too late.",
  closeWorkspaceBilling:
    "Billing stops today. Everything in the workspace — messages, photos, " +
    "voicemails, contacts, tasks — is erased 30 days from now.",
  closeWorkspaceUndoLead: "Until then,",
  closeWorkspaceEmailUs: "email us",
  closeWorkspaceUndoTail:
    "and we can put the workspace back — every message, contact and job " +
    "exactly as you left it. Not the number, though: that one is already gone. " +
    "After 30 days nobody can undo any of it.",
  closeWorkspaceStopKept:
    "Anyone who replied STOP stays on the do-not-text list. That record is " +
    "theirs, not ours, and it protects them.",
  closeWorkspaceConsentRecord:
    "A record that consent existed is kept for three years, with names and " +
    "message contents removed. That is the law we operate under.",
  closeWorkspaceAction: "Close this workspace",
  closeWorkspaceConfirmTitle: "Close {name}?",
  closeWorkspaceConfirmDescription:
    "Everyone is signed out now, and the number goes back to the phone company " +
    "now, where it can be given to another business. We cannot get it back. " +
    "The rest is erased in 30 days, and after that it cannot be undone by " +
    "anyone, including us.",
  closeWorkspaceKeep: "Keep it",
  closeWorkspaceClosing: "Closing…",
  closeWorkspaceConfirmAction: "Close workspace",
  closeWorkspaceInThirtyDays: "in 30 days",
  closeWorkspaceDone: "Workspace closed. Everything is erased on {when}.",
  closeWorkspaceReceipt: "We've emailed you the details and the date.",
  closeWorkspaceFailed: "Couldn't close the workspace. Try again in a moment.",

  /* Closed dates (#402). */
  closedDatesTitle: "Closed dates",
  closedDatesDescription:
    "Holidays, a week off, a day for a funeral. On these dates your away reply " +
    "goes out even if the weekly schedule says you're open — so a customer " +
    "texting on Christmas morning hears something back instead of nothing.",
  closedDatesEmpty: "No closed dates yet. Your weekly hours apply every week.",
  closedDatesRemoveAria: "Remove {range}",
  closedDatesFirstDay: "First day",
  closedDatesLastDay: "Last day",
  closedDatesSameDay: "Same day",
  closedDatesNoteLabel: "What to tell customers (optional)",
  closedDatesNotePlaceholder: "Closed for the holiday, back Monday",
  closedDatesPickDate: "Pick the date you're closed.",
  closedDatesBadRange: "The last day can't be before the first day.",
  closedDatesAdded: "Closed date added.",
  closedDatesRemoved: "Closed date removed.",
  closedDatesSaveFailed: "Couldn't save those dates. Try again.",

  /* The fields a workspace defines for itself (#291). */
  contactFieldKindText: "Text",
  contactFieldKindNumber: "Number",
  contactFieldKindDate: "Date",
  contactFieldKindSelect: "Dropdown",
  contactFieldKindCheckbox: "Yes / no",
  contactFieldsEmpty:
    "You have not added any yet. Your contacts show the standard fields — " +
    "name, phone, email, address and notes.",
  contactFieldLabelLabel: "What this field is called",
  contactFieldLabelPlaceholder: "Boiler model",
  contactFieldKindLabel: "What kind of answer it takes",
  contactFieldRemoveAria: "Remove {name}",
  contactFieldThisField: "this field",
  contactFieldChoicesLabel: "The choices, one per line",
  contactFieldChoicesPlaceholder: "Combi\nSystem\nHeat only",
  contactFieldExportsAs: "Exports as",
  contactFieldFrozenType: " · the name can change, the type cannot",
  contactFieldsAdd: "Add a field",
  contactFieldsSave: "Save fields",
  contactFieldsDiscard: "Discard",
  contactFieldsNeedName: "Give every field a name first.",
  contactFieldsSavedEmpty: "Saved. Your contacts are back to the standard fields.",
  contactFieldsSaved: "Saved. These show on every customer.",
  contactFieldsSaveFailed: "That could not be saved. Try again.",

  /* Deleting your own account (#346). */
  deleteAccountTitle: "Delete your account",
  deleteAccountDescription:
    "Removes you from Loonext entirely. This cannot be undone.",
  deleteAccountAction: "Delete my account",
  deleteAccountOwnerLead: "You own",
  deleteAccountOwnerTail:
    ". A workspace cannot be left without an owner, so hand it to someone else " +
    "or close it first — then you can delete your account.",
  deleteAccountOwnerWhere:
    "Closing a workspace is on its Workspace settings page.",
  deleteAccountSignedOut:
    "You are signed out everywhere and cannot sign back in. Your name comes " +
    "off the app, and notifications stop.",
  deleteAccountLeaveLead: "You leave",
  deleteAccountLeaveOne: "your workspace",
  deleteAccountLeaveMany: "all {count} of your workspaces",
  deleteAccountLeaveHandoff:
    ", and anything you are still working on goes back to the crew so nothing " +
    "is lost.",
  deleteAccountRecordStays:
    "Texts you sent to customers, jobs you logged and notes you wrote stay " +
    "with the business. They have to — that record is theirs, and some of it " +
    "we are required by law to keep. They will no longer carry your name.",
  deleteAccountEmailNote:
    "We email you a confirmation before your address is removed. It is the " +
    "last thing you will get from us, and it is worth keeping.",
  deleteAccountConfirmTitle: "Delete your account?",
  deleteAccountConfirmDescription:
    "You will be signed out everywhere and will not be able to sign back in. " +
    "Your work stays with the business, without your name on it. Nobody can " +
    "undo this.",
  deleteAccountKeep: "Keep my account",
  deleteAccountDeleting: "Deleting…",
  deleteAccountDone: "Your account is deleted.",
  deleteAccountFailed: "Couldn't delete your account. Try again in a moment.",

  /* How loud each kind of notification is (#297). */
  deliveryBatchEvery: "Group them every",
  deliveryBatchMinutes: "{minutes} minutes",
  deliverySummaryAt: "Daily summary at",
  deliverySummaryOn: "Who is waiting and what is due, once a day.",
  deliverySummaryOff: "Off. Leave it blank for no summary.",
  deliveryModesSaveFailed: "Couldn't save that.",

  /* One signed-in device (#236). */
  deviceWeb: "Web browser",
  deviceAndroid: "Android app",
  deviceIos: "iPhone or iPad",
  deviceUnknown: "Unrecognised device",
  deviceThisOne: "This device",
  deviceNoLocation: "Location not available",
  deviceLastActive: "Last active {when}",
  deviceSignedIn: "signed in {when}",

  /* "We can't reach this address" (#386). */
  emailUnreachable: "We can't email you at {email}",
  emailBouncing:
    "Emails to this address are bouncing, so we've stopped sending them. Push " +
    "notifications still work. If the address was mistyped, fix it in your " +
    "account first, then tell us to try again.",
  emailComplained:
    "This address reported our email as spam, so we've stopped sending to it " +
    "for good. Push notifications still work. To get email again, change your " +
    "account to a different address.",
  emailRetrying: "Trying…",
  emailRetryAction: "Try this address again",
  emailRetryQueued: "We'll try that address again on your next notification.",
  emailRetryFailed: "Couldn't do that. Try again.",

  /* The emergency words and reply (#460). */
  emergencyTitle: "Emergency words and reply",
  emergencyDescription:
    "Which words a customer can text to reach the whole crew straight away, " +
    "and what goes back to them automatically.",
  emergencySave: "Save emergency settings",
  emergencyWordsLabel: "Words that count as an emergency",
  emergencyWordsHelp:
    "Matched on the first word a customer sends, so “URGENT no heat” counts. " +
    "Use the words your customers would actually reach for.",
  emergencyWordRemoveAria: "Remove {word}",
  emergencyWordAddAria: "Add an emergency word",
  emergencyWordsAreDefaults:
    "These are the defaults. Change them and only your words are watched for.",
  emergencyWordDuplicate: "{word} is already on the list.",
  emergencyWordLimit:
    "Ten words is the limit — past that it stops being an emergency.",
  emergencyWordLastOne:
    "Keep at least one word. To stop treating replies as emergencies, turn " +
    "the switch off above.",
  emergencyReplyLabel: "Automatic reply",
  emergencyReplySwitch: "Text the customer back",
  emergencyReplySwitchHelp:
    "Off means we still alert the crew and flag the thread — we just don't " +
    "message the customer for you.",
  emergencyReplyHelp:
    "Sent once per hour, at most, to a customer who texts one of these words. " +
    "Say what is true for your business.",
  emergencyUsingDefault: " · using the default",
  emergencyPreviewLabel: "What the customer receives",
  emergencySafetyNote:
    "“{line}” is always added and can't be edited. You decide what is " +
    "promised; whether someone in danger is told where else to turn isn't " +
    "ours to leave out.",
  emergencySaved: "Emergency settings saved.",
  emergencySaveFailed: "Couldn't save your emergency settings. Try again.",
  emergencyToggleFailed: "Couldn't change that. Try again.",

  /* Taking a copy of the workspace (#227). */
  exportDataTitle: "Export your data",
  exportDataDescription:
    "A copy of everything in this workspace, in a format you can load " +
    "somewhere else.",
  exportDataContents:
    "Contacts, conversations, messages, tasks, call history and voicemail " +
    "transcripts, saved replies, tags and opt-outs. Photos and recordings are " +
    "listed with where they live and how big they are, rather than copied.",
  exportDataBuilding:
    "Building your export. It usually takes a few minutes, and we'll email you " +
    "when it's ready — you can close this page.",
  exportDataAction: "Export my data",
  exportDataStarting: "Starting…",
  exportDataAlready: "One is already being built.",
  exportDataStarted:
    "We're building your export. We'll email you when it's ready.",
  exportDataStartFailed: "Couldn't start the export. Try again in a moment.",
  exportDataFailed:
    "The last export didn't finish {when}. Try again, and if it keeps failing " +
    "let us know.",
  exportDataLatest: "Latest export",
  exportDataRecords: "{count} records",
  exportDataExpired:
    "The download links have expired and the copy has been deleted. Ask for a " +
    "fresh one above.",
  exportDataLinksExpire: "These links work until {when}, then the copy is deleted.",

  /* A period's metered usage, as a file (#304). */
  exportUsageFrom: "From",
  exportUsageTo: "To",
  exportUsageStart: "Start it",
  exportUsageAlready:
    "One is already being put together. It will appear under Data export.",
  exportUsageStarted: "Being put together now. It will appear under Data export.",
  exportUsageFailed: "That could not be started.",

  /* Giving up your own access (#538). */
  giveUpAccessTitle: "Give up your own access?",
  giveUpAccessKeep: "Keep my access",
  giveUpAccessChanging: "Changing…",
  giveUpAccessMakeMe: "Make me a {role}",
  roleAdminWord: "admin",
  roleMemberWord: "member",

  /* Numbers the plan no longer covers (#523). */
  heldNumbersTitleMany: "Numbers on hold",
  heldNumbersTitleOne: "One number is on hold",
  heldCoversFewerMany:
    "Your {plan} plan covers fewer numbers than you have, so these are on hold.",
  heldCoversFewerOne:
    "Your {plan} plan covers fewer numbers than you have, so this one is on hold.",
  heldCoversCountMany:
    "Your {plan} plan covers {count} {noun}, and you have more than that — so " +
    "these are on hold.",
  heldCoversCountOne:
    "Your {plan} plan covers {count} {noun}, and you have more than that — so " +
    "this one is on hold.",
  heldNumberNoun: "number",
  heldNumbersNoun: "numbers",
  heldReassuranceMany:
    "Nothing has been given up. We're still holding them for you, texts and " +
    "calls still come through, and the history is untouched — you just can't " +
    "send or answer from them while they're on hold.",
  heldReassuranceOne:
    "Nothing has been given up. We're still holding it for you, texts and " +
    "calls still come through, and the history is untouched — you just can't " +
    "send or answer from it while it's on hold.",
  heldYourNumber: "Your number",
  heldThisNumber: "this number",
  heldSince: "On hold since {since}.",
  heldBringBack: "Bring it back — {price}/mo",
  heldConfirmTitle: "Bring {number} back?",
  heldConfirmBody:
    "This adds an extra number to your plan at {price}/mo, charged today for " +
    "the rest of this billing period. {number} starts sending and answering " +
    "again straight away, with everything it already has.",
  heldBringingBack: "Bringing it back…",
  heldAddFor: "Add it for {price}/mo",
  heldAlreadyBack: "{number} is already back.",
  heldIsBack: "{number} is back. You can send and answer from it again.",
  heldReinstateFailed: "Couldn't bring the number back. Try again.",
  heldUpgradeMany:
    "Moving to Pro brings them back too — Pro includes {count} numbers, at no " +
    "extra charge per number.",
  heldUpgradeOne:
    "Moving to Pro brings it back too — Pro includes {count} numbers, at no " +
    "extra charge per number.",
  heldNoRouteMany:
    "To bring them back, get in touch and we'll sort it out with you.",
  heldNoRouteOne:
    "To bring it back, get in touch and we'll sort it out with you.",
  heldMaxTotal: "{plan} tops out at {count} numbers in total.",

  /* The language the automated texts go out in (#228). */
  languageTitle: "Language",
  languageDescription: "The language the texts we send on your behalf go out in.",
  languageScope:
    "It changes four texts: the after-hours away reply, the missed-call " +
    "text-back, the emergency acknowledgment, and the rating ask. It does not " +
    "translate this app, and it does not translate a message you wrote " +
    "yourself. An away message you typed keeps the words you typed.",
  languagePerContact:
    "A customer set to their own language on their contact record keeps it. " +
    "This is what everyone else hears from you.",
  languageAdminOnly: "Only owners and admins can change the language.",
  languageSaved: "Language saved.",
  languageSaveFailed: "Couldn't save the language. Try again.",

  /* Chasing an unanswered lead (#463). */
  leadChaseLabel: "Tell the whole crew after {minutes} minutes",
  leadChaseHelp:
    "When a conversation is assigned to one person and they still haven't " +
    "replied, notify everyone who can see it. Business hours only, and never " +
    "someone who has turned their own notifications off.",
  leadChaseScope: "This one is for the whole workspace, not just you",
  leadChaseAdminOnly: " — only owners and admins can change it.",
  leadChaseSaveFailed: "Couldn't save that. Try again.",

  /* Where customers come from (#301). */
  leadSourcesTitle: "Where customers come from",
  leadSourcesDescription:
    "Your own list — the truck, the yard sign, the ad, a neighbour. Put one on " +
    "a number and every call and text to that line is counted automatically.",
  leadSourcesEmpty:
    'Nothing yet, so every conversation reads as "don\'t know". The cheapest ' +
    "way to start is to name the number you advertise — attribution then costs " +
    "the crew nothing at all.",
  leadSourcesArchivedNote:
    "Archived — off the pickers, still named in reports about the period they " +
    "ran.",
  leadSourcesAdminOnly:
    "Only owners and admins can change this list. Anyone can tag a " +
    "conversation with one.",
  leadSourceDefaultName: "Truck",
  leadSourceAddLabel: "Add one",
  leadSourceAdding: "Adding…",
  leadSourceArchiveAction: "Archive",
  leadSourceRestoreAction: "Bring back",
  leadSourceAdded: '"{name}" added. Put it on a number to start counting.',
  leadSourceArchived: "Archived.",
  leadSourceRestored: "Back in the list.",
  leadSourceAddFailed: "That could not be added.",
  leadSourceSaveFailed: "That could not be saved.",

  /* Leaving a workspace yourself (#406). */
  leaveWorkspaceTitle: "Leave this workspace",
  leaveWorkspaceDescription:
    "End your own access to this workspace. You can do this yourself — you " +
    "don't need to ask an owner.",
  leaveWorkspaceAccessEnds:
    "Your access ends straight away, on every device you’re signed in on.",
  leaveWorkspaceHandoff:
    "Anything you were working on goes back to the team, so nothing is left " +
    "pointing at someone who has gone.",
  leaveWorkspaceRecordStays:
    "Messages you sent stay on the record under your name. Leaving doesn’t " +
    "erase your work, and isn’t meant to.",
  leaveWorkspaceComeBack:
    "To come back, someone in the workspace has to invite you again.",
  leaveWorkspaceAction: "Leave workspace",
  leaveWorkspaceConfirmTitle: "Leave {name}?",
  leaveWorkspaceConfirmDescription:
    "Your access ends now and your open work goes back to the team. To come " +
    "back, someone will need to invite you again.",
  leaveWorkspaceStay: "Stay",
  leaveWorkspaceLeaving: "Leaving…",
  leaveWorkspaceDone: "You've left the workspace.",
  leaveWorkspaceDoneHandoff: "You've left. Your open work went back to the team.",
  leaveWorkspaceFailed: "Couldn't leave. Try again.",

  /* What one member reaches, and why (#348). */
  memberAccessTitle: "Numbers {name} can reach",
  memberAccessDescription:
    "What they can do on each number, and the rule that decided it.",
  memberAccessChecking: "Checking…",
  memberAccessLoadFailed: "Couldn't load their access. Try again.",
  memberAccessNoNumbers: "This workspace has no numbers yet.",
  memberAccessUnnamedNumber: "Number",

  /* Calls that arrived while the line was off (#490). */
  missedWhileOffOne: "1 customer called while your number was off",
  missedWhileOffMany: "{count} customers called while your number was off",
  missedWhileOffHeard: "They heard that the number isn't taking calls.",
  missedWhileOffLast:
    "They heard that the number isn't taking calls. The most recent was {when}.",
  dayToday: "today",
  dayYesterday: "yesterday",
  dayOn: "on {date}",

  /* What a member cannot reach, and why (#286). */
  myAccessTitle: "What you can reach",
  myAccessDescription:
    "Some of this workspace's numbers are not shared with you. Here is which, " +
    "and what decided it.",
  myAccessUnnamedNumber: "A number",

  /* Changing the email on the account (D18 §1.5). */
  emailCardTitle: "Email",
  emailCardDescription: "The address we use to reach you.",
  emailRelayNote:
    "Email is routed through Apple. To sign in on another device, set a " +
    "password below.",
  emailSignedInAs: "You're signed in as {email}.",
  emailAddOne: "Add an email to your account.",
  emailChangeSent:
    "We've emailed both your old and new address. Confirm from each to finish " +
    "the change.",
  emailChangeAnother: "Change a different address",
  emailNewLabel: "New email",
  emailConfirmBoth: "We'll ask you to confirm from both your old and new inbox.",
  emailSending: "Sending…",
  emailChangeAction: "Change email",
  emailInvalid: "Enter a valid email address.",
  emailAlreadyYours: "That's already your email address.",

  /* Setting or changing the password (D18 §1.6, §1.8). */
  passwordSetAction: "Set a password",
  passwordChangeAction: "Change password",
  passwordSetting: "Setting…",
  passwordSetDescription:
    "Add a password so you can sign in on any device, not just with Google or " +
    "Apple.",
  passwordChangeDescription:
    "Pick a new password. We may ask you to confirm it's you.",
  passwordNewLabel: "New password",
  passwordConfirmLabel: "Confirm password",
  passwordCodeLabel: "Confirmation code",
  passwordCodeHelp: "Enter the 6-digit code we emailed you.",
  passwordTooShort: "Use at least 8 characters.",
  passwordMismatch: "The passwords don't match.",
  passwordNonceRequired: "Enter the 6-digit code from your email.",
  passwordReauthSent:
    "For your security, enter the 6-digit code we just emailed you.",
  passwordSet: "Password set.",
  passwordUpdated: "Password updated.",

  /* Changing plan (G8 Billing, SPEC §9). "Pro" and "Starter" are plan names. */
  planUpgradeAction: "Upgrade to Pro",
  planSwitchAction: "Switch to Starter",
  planUpgradeTitle: "Upgrade to Pro?",
  planSwitchTitle: "Switch to Starter?",
  planUpgradeBody:
    "Pro is {price}/mo: a bigger fair-use texting allowance, {seats} seats, " +
    "and a second phone number. You're charged the prorated difference for " +
    "the rest of this period today.",
  planSwitchBody:
    "Starter is {price}/mo: texting for a small crew under fair use, {seats} " +
    "seats, 1 number.",
  planNumbersOk: "1 phone number. You're set.",
  planNumbersOver: "Starter includes 1 phone number; you have {count}.",
  planReleaseOne: "one",
  planReleaseFirst: "Release {count} first",
  planSeatsUnknown: "Couldn't check your member count.",
  planSeatsOk: "Up to {seats} members; you have {count}.",
  planSeatsOver: "Starter includes {seats} members; you have {count} active.",
  planDeactivate: "Deactivate {count}",
  planFirstWord: "first.",
  planDowngradeTiming:
    "The change happens at the end of your current period. You keep Pro until " +
    "then, and nothing is refunded mid-period.",
  planPrepaidPaid: "Paid up front",
  planPrepaidMonthsUsed: "Months used",
  planPrepaidOfTwelve: "{used} of 12",
  planPrepaidCredit: "Back on your account",
  planChanging: "Changing…",
  planSwitchAtPeriodEnd: "Switch at period end",
  planUpgradedPlain: "You're on Pro. The extra allowance starts now.",
  planUpgradedOneBack: "You're on Pro, and {number} is back.",
  planUpgradedManyBack: "You're on Pro, and {count} numbers are back.",
  planStarterStarts: "Starter starts {date}. You keep Pro until then.",
  planChangeFailed: "Couldn't change the plan. Try again.",

  /* #232 — the Text-us widget's snippet. */
  widgetTitle: "Text us button for your website",
  widgetBlurb:
    "A button on your own site that turns a visitor into a conversation here. " +
    "They type their number, we text them a code, and their message lands in " +
    "your inbox like any other text.",
  widgetShow: "Get the snippet",
  /** #232: the frame showing the real widget on a stand-in page. */
  widgetPreviewTitle: "A preview of your Text us button",
  widgetPreviewHint: "Your site, with the button on it.",
  widgetStepCopy: "Copy the line below.",
  widgetStepPaste: "Paste it into your website, just before </body>.",
  widgetStepSave: "Save and reload your site — the button appears bottom right.",
  widgetCopy: "Copy",
  widgetCopied: "Copied.",
  widgetCopyFailed: "Couldn't copy it. Select the line and copy it by hand.",
  widgetLoadFailed: "Couldn't load your snippet. Try again.",
  widgetRotate: "Replace the key",
  widgetRotateWarning:
    "The button stops working on every site using the old snippet, " +
    "immediately. You'll need to paste the new one everywhere you installed it.",
  widgetRotateConfirm: "Replace it",
  widgetRotated: "Replaced. Paste the new snippet on your site.",
  /** #232 phase 3: which of the workspace's lines the website rings. */
  widgetLineLabel: "Which number website messages land on",
  widgetLineHelp:
    "Replies from your crew come from this number, so pick the line you watch.",
  widgetLineDefault: "Your first number",
  widgetLineSaved: "Website messages will land on that number.",
  widgetLineFailed: "That did not save. Try again.",
  widgetRotateFailed: "Couldn't replace the key. Try again.",
} as const;

/**
 * Quebec French, vouvoiement throughout — the product speaks to the crew the
 * way a business speaks to a professional. Accents are spelled normally: the
 * GSM-7 restriction in `packages/shared/src/locale.ts` governs SMS bodies,
 * which are billed by the segment, and nothing on a web page is.
 *
 * Product names (Loonext, Stripe, Telnyx) and the carrier keywords are never
 * translated — a machine matches on those.
 */
export const settingsFr: Translated<typeof settingsEn> = {
  saveFailed: "Impossible d'enregistrer. Réessayez.",
  clearAction: "Effacer",
  opening: "Ouverture…",

  signInPassword: "Mot de passe",
  signInLinked: "Lié",
  signInNotLinked: "Non lié",

  afterHoursTitle: "En dehors des heures",
  afterHoursDescription:
    "En dehors de vos heures d'ouverture, un appel peut sonner chez toute " +
    "l'équipe, sonner uniquement chez la personne de garde, ou aller " +
    "directement à la messagerie. La première option convient à la plupart des " +
    "petites équipes.",
  afterHoursNoHours:
    "Vous n'avez pas encore défini vos heures d'ouverture, alors rien ici ne " +
    "peut se produire — chaque heure est une heure de travail tant que ce " +
    "n'est pas fait. Définissez-les dans Paramètres → Heures.",
  afterHoursGroupAria: "Appels en dehors des heures",
  afterHoursVoiceLabel: "Voix en dehors des heures",
  afterHoursSameGreeting: "Le même message d'accueil que d'habitude",
  afterHoursGreetingNote:
    "Joué uniquement en dehors de vos heures. « Nous sommes fermés jusqu'à " +
    "lundi » et « nous sommes sur un autre chantier » sont deux messages " +
    "différents, et un seul accueil ne peut pas être les deux.",
  afterHoursAdminOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier les " +
    "appels en dehors des heures.",
  afterHoursSaved: "Appels en dehors des heures mis à jour.",
  afterHoursGreetingSaved:
    "Message d'accueil en dehors des heures mis à jour.",
  afterHoursRingEveryone: "Sonner chez toute l'équipe, jour et nuit",
  afterHoursRingEveryoneDetail:
    "Ce qui se passe aujourd'hui. Chaque appel sonne chez toute l'équipe, peu " +
    "importe l'heure.",
  afterHoursOnCallOnly: "Sonner uniquement chez la personne de garde",
  afterHoursOnCallOnlyDetail:
    "En dehors des heures, le téléphone sonne chez la personne qui a le quart " +
    "de garde et chez personne d'autre. Sans quart défini, tout le monde " +
    "sonne — nous ne laissons jamais un appel sans destinataire.",
  afterHoursVoicemail: "Prendre un message",
  afterHoursVoicemailDetail:
    "En dehors des heures, l'appelant est dirigé directement vers votre " +
    "message d'accueil au lieu de sonner d'abord — sauf si quelqu'un est de " +
    "garde, chez qui le téléphone sonne quand même.",

  aiUsageUsedOfCap: "{used} sur {cap}",
  aiUsageOff: "Désactivé",
  aiUsageBarAria: "{label} : {used} sur {cap} utilisés ce mois-ci",
  aiUsageBarAriaOff: "{label} : désactivé",
  aiUsageNearCap:
    "Proche de la limite de ce mois-ci. Elle est réinitialisée le 1er.",
  aiUsageNoOutcomes:
    "Rien n'a encore été enregistré sur l'usage qui en a été fait.",

  cancelTitle: "Annuler",
  cancelPortalFailed:
    "Impossible d'ouvrir le portail de facturation. Réessayez.",
  cancelExportFailed: "L'exportation n'a pas fonctionné. Réessayez.",
  cancelReasonGroupAria: "Pourquoi vous annulez",
  cancelDetailPlaceholder: "Autre chose à nous dire ?",
  cancelDetailAria: "Autre chose à nous dire (facultatif)",
  cancelCharactersLeft: "{count} caractères restants.",
  cancelExporting: "Exportation…",
  cancelReasonTooExpensive: "Trop cher",
  cancelReasonSeasonal: "Saison tranquille, je reviendrai",
  cancelReasonMissingFeature: "Il manque quelque chose dont j'ai besoin",
  cancelReasonSwitched: "Je passe à autre chose",
  cancelReasonNotUsing: "Je ne m'en sers pas",
  cancelReasonOther: "Autre chose",
  cancelConsequence:
    "Annulez à tout moment. Votre forfait se poursuit jusqu'à la fin de la " +
    "période de facturation et ne se renouvelle pas — les textos s'arrêtent " +
    "alors, s'ils ne se sont pas déjà arrêtés. Nous conservons votre numéro " +
    "pendant {days} jours à compter du jour de l'annulation, et non à compter " +
    "de la fin du forfait : la conservation peut donc prendre fin peu après. " +
    "Ensuite, le numéro est libéré définitivement.",
  cancelQuestion:
    "Si vous voulez nous dire pourquoi, cela nous aide à nous améliorer.",
  cancelQuestionNote: "Facultatif, et cela ne change rien à l'annulation.",
  cancelExportTitle: "Repartez avec vos contacts",
  cancelExportNote:
    "Tous les contacts de cet espace de travail en fichier CSV : noms, " +
    "numéros, étiquettes et date du consentement. Il s'ouvre dans un tableur " +
    "et s'importe dans l'outil que vous utiliserez ensuite. Il est à vous " +
    "dans tous les cas.",
  cancelExportAction: "Exporter les contacts",
  cancelSkipNote:
    "Rien de ce qui précède n'est obligatoire. Ce bouton vous mène à Stripe " +
    "dans tous les cas, où vous terminez l'annulation.",
  cancelAction: "Continuer vers l'annulation",
  cancelAdminConsequence:
    "Seul le propriétaire peut annuler ce forfait. Lorsqu'il le fait, le " +
    "forfait se poursuit jusqu'à la fin de la période de facturation et ne se " +
    "renouvelle pas — les textos s'arrêtent alors, s'ils ne se sont pas déjà " +
    "arrêtés. Nous conservons le numéro pendant {days} jours à compter du " +
    "jour de l'annulation, et non à compter de la fin du forfait : la " +
    "conservation peut donc prendre fin peu après. Ensuite, le numéro est " +
    "libéré définitivement.",
  cancelAdminNote:
    "Le portail de paiement auquel accède un administrateur est l'écran de la " +
    "carte ; il n'y a aucune annulation à y trouver.",

  holdGeneral:
    "Nous conservons votre numéro pendant {days} jours à compter du jour de " +
    "l'annulation. Réabonnez-vous avant cette date et tout reprend là où vous " +
    "l'aviez laissé.",
  holdEndedLead:
    "La conservation de votre numéro pendant {days} jours a pris fin le",
  holdEndedTail:
    ". Nous ne le gardons plus pour vous : prévoyez un nouveau numéro si vous " +
    "vous réabonnez — votre historique de messages reste ici dans tous les cas.",
  holdUntilLead: "Nous conservons votre numéro jusqu'au",
  holdUntilTail:
    ". Réabonnez-vous avant cette date et tout reprend là où vous l'aviez " +
    "laissé.",
  checkoutFailed: "Impossible de démarrer le paiement. Réessayez.",
  resubscribe: "Se réabonner",
  winbackNoThanks: "Non merci",

  capReadOnlyLead: "Plafond de dépenses :",
  capReadOnlyTail:
    "vos messages inclus. Seul le propriétaire du compte peut le modifier.",
  capSaved: "Plafond réglé à {cap}.",
  capSaveFailed: "Impossible de modifier le plafond. Réessayez.",
  capPausesAt: "L'envoi s'arrête à",
  capMessagesThisPeriod: "messages cette période",
  capSliderValueText:
    "{cap} vos messages inclus, avec arrêt à {pauseAt} messages",
  capRailMin: "{n}× inclus",
  capRailMax: "{n}× max",
  capAtCeiling: "C'est le plafond le plus élevé possible.",
  capSave: "Enregistrer le plafond",
  capFootnote:
    "Le plafond est un multiple de ce que votre forfait inclut. Si un mois " +
    "l'atteint, l'envoi s'arrête jusqu'à ce que vous l'augmentiez, et rien " +
    "n'est facturé au-delà.",

  typeToConfirmLead: "Tapez",
  typeToConfirmTail: "pour confirmer",
  neverMind: "Laisser tomber",
  addAction: "Ajouter",

  chooseNumberTitle: "Choisissez votre numéro",
  chooseNumberDescription:
    "Choisissez un numéro disponible pour terminer la configuration de votre " +
    "espace de travail. Vous ne serez pas facturé de nouveau.",
  chooseNumberBeingSetUp: "{number} est en cours de configuration.",
  chooseNumberSettingUp: "Configuration de votre numéro en cours.",
  chooseNumberFailed: "Impossible de faire cette configuration. Réessayez dans un moment.",
  chooseNumberBusy: "Configuration…",
  chooseNumberAction: "Utiliser ce numéro",

  closeWorkspaceTitle: "Fermer cet espace de travail",
  closeWorkspaceDescription:
    "Met fin au compte pour toute l'équipe. Ce n'est plus réversible après 30 jours.",
  closeWorkspaceNumberReleased:
    "Tout le monde perd l'accès immédiatement, et votre numéro est libéré. Il " +
    "retourne à l'entreprise de téléphonie et peut être attribué à une autre " +
    "entreprise : quiconque lui écrit encore joindra quelqu'un d'autre. Nous ne " +
    "pouvons pas le récupérer pour vous.",
  closeWorkspacePortLead: "Si vous voulez garder le numéro,",
  closeWorkspacePortEmphasis:
    "transférez-le vers un autre fournisseur avant de fermer",
  closeWorkspacePortTail: ". Ensuite, il sera trop tard.",
  closeWorkspaceBilling:
    "La facturation s'arrête aujourd'hui. Tout ce que contient l'espace de " +
    "travail — textos, photos, messages vocaux, clients, tâches — est effacé " +
    "dans 30 jours.",
  closeWorkspaceUndoLead: "D'ici là,",
  closeWorkspaceEmailUs: "écrivez-nous",
  closeWorkspaceUndoTail:
    "et nous pouvons rétablir l'espace de travail — chaque texto, chaque " +
    "client et chaque tâche exactement comme vous les avez laissés. Sauf le " +
    "numéro : celui-là est déjà parti. Après 30 jours, personne ne peut plus " +
    "rien annuler.",
  closeWorkspaceStopKept:
    "Toute personne ayant répondu STOP reste sur la liste de ne-pas-texter. Ce " +
    "registre lui appartient, pas à nous, et il la protège.",
  closeWorkspaceConsentRecord:
    "Une trace de l'existence du consentement est conservée pendant trois ans, " +
    "sans les noms ni le contenu des messages. C'est la loi qui nous encadre.",
  closeWorkspaceAction: "Fermer cet espace de travail",
  closeWorkspaceConfirmTitle: "Fermer {name} ?",
  closeWorkspaceConfirmDescription:
    "Tout le monde est déconnecté maintenant, et le numéro retourne maintenant " +
    "à l'entreprise de téléphonie, qui peut l'attribuer à une autre entreprise. " +
    "Nous ne pouvons pas le récupérer. Le reste est effacé dans 30 jours, et " +
    "après cela personne ne peut revenir en arrière, nous y compris.",
  closeWorkspaceKeep: "Le garder",
  closeWorkspaceClosing: "Fermeture…",
  closeWorkspaceConfirmAction: "Fermer l'espace de travail",
  closeWorkspaceInThirtyDays: "dans 30 jours",
  closeWorkspaceDone: "Espace de travail fermé. Tout est effacé le {when}.",
  closeWorkspaceReceipt: "Nous vous avons envoyé les détails et la date par courriel.",
  closeWorkspaceFailed:
    "Impossible de fermer l'espace de travail. Réessayez dans un moment.",

  closedDatesTitle: "Dates de fermeture",
  closedDatesDescription:
    "Congés, une semaine de vacances, une journée pour des funérailles. À ces " +
    "dates, votre réponse d'absence est envoyée même si l'horaire hebdomadaire " +
    "vous dit ouvert — ainsi un client qui écrit le matin de Noël reçoit " +
    "quelque chose plutôt que rien.",
  closedDatesEmpty:
    "Aucune date de fermeture pour l'instant. Vos heures hebdomadaires " +
    "s'appliquent chaque semaine.",
  closedDatesRemoveAria: "Retirer {range}",
  closedDatesFirstDay: "Premier jour",
  closedDatesLastDay: "Dernier jour",
  closedDatesSameDay: "Même jour",
  closedDatesNoteLabel: "Quoi dire aux clients (facultatif)",
  closedDatesNotePlaceholder: "Fermé pour le congé, de retour lundi",
  closedDatesPickDate: "Choisissez la date de fermeture.",
  closedDatesBadRange:
    "Le dernier jour ne peut pas précéder le premier jour.",
  closedDatesAdded: "Date de fermeture ajoutée.",
  closedDatesRemoved: "Date de fermeture retirée.",
  closedDatesSaveFailed: "Impossible d'enregistrer ces dates. Réessayez.",

  contactFieldKindText: "Texte",
  contactFieldKindNumber: "Nombre",
  contactFieldKindDate: "Date",
  contactFieldKindSelect: "Liste déroulante",
  contactFieldKindCheckbox: "Oui / non",
  contactFieldsEmpty:
    "Vous n'en avez pas encore ajouté. Vos clients affichent les champs " +
    "standards — nom, numéro, courriel, adresse et notes.",
  contactFieldLabelLabel: "Le nom de ce champ",
  contactFieldLabelPlaceholder: "Modèle de chaudière",
  contactFieldKindLabel: "Le type de réponse attendu",
  contactFieldRemoveAria: "Retirer {name}",
  contactFieldThisField: "ce champ",
  contactFieldChoicesLabel: "Les choix, un par ligne",
  contactFieldChoicesPlaceholder: "Combinée\nSystème\nChauffage seulement",
  contactFieldExportsAs: "Exporté sous",
  contactFieldFrozenType: " · le nom peut changer, le type non",
  contactFieldsAdd: "Ajouter un champ",
  contactFieldsSave: "Enregistrer les champs",
  contactFieldsDiscard: "Abandonner",
  contactFieldsNeedName: "Donnez d'abord un nom à chaque champ.",
  contactFieldsSavedEmpty:
    "Enregistré. Vos clients reviennent aux champs standards.",
  contactFieldsSaved: "Enregistré. Ces champs s'affichent pour chaque client.",
  contactFieldsSaveFailed: "Impossible d'enregistrer. Réessayez.",

  deleteAccountTitle: "Supprimer votre compte",
  deleteAccountDescription:
    "Vous retire complètement de Loonext. C'est irréversible.",
  deleteAccountAction: "Supprimer mon compte",
  deleteAccountOwnerLead: "Vous êtes propriétaire de",
  deleteAccountOwnerTail:
    ". Un espace de travail ne peut pas rester sans propriétaire : confiez-le " +
    "à quelqu'un d'autre ou fermez-le d'abord, puis vous pourrez supprimer " +
    "votre compte.",
  deleteAccountOwnerWhere:
    "La fermeture d'un espace de travail se fait dans ses paramètres " +
    "d'espace de travail.",
  deleteAccountSignedOut:
    "Vous êtes déconnecté partout et ne pouvez plus vous reconnecter. Votre " +
    "nom disparaît de l'application, et les notifications s'arrêtent.",
  deleteAccountLeaveLead: "Vous quittez",
  deleteAccountLeaveOne: "votre espace de travail",
  deleteAccountLeaveMany: "vos {count} espaces de travail",
  deleteAccountLeaveHandoff:
    ", et tout ce sur quoi vous travaillez encore retourne à l'équipe pour que " +
    "rien ne se perde.",
  deleteAccountRecordStays:
    "Les textos que vous avez envoyés aux clients, les tâches que vous avez " +
    "consignées et les notes que vous avez écrites restent à l'entreprise. " +
    "C'est obligatoire — ce registre lui appartient, et la loi nous oblige à " +
    "en conserver une partie. Votre nom n'y figurera plus.",
  deleteAccountEmailNote:
    "Nous vous envoyons une confirmation par courriel avant de retirer votre " +
    "adresse. C'est la dernière chose que vous recevrez de nous, et elle vaut " +
    "la peine d'être gardée.",
  deleteAccountConfirmTitle: "Supprimer votre compte ?",
  deleteAccountConfirmDescription:
    "Vous serez déconnecté partout et ne pourrez plus vous reconnecter. Votre " +
    "travail reste à l'entreprise, sans votre nom dessus. Personne ne peut " +
    "revenir en arrière.",
  deleteAccountKeep: "Garder mon compte",
  deleteAccountDeleting: "Suppression…",
  deleteAccountDone: "Votre compte est supprimé.",
  deleteAccountFailed:
    "Impossible de supprimer votre compte. Réessayez dans un moment.",

  deliveryBatchEvery: "Les regrouper toutes les",
  deliveryBatchMinutes: "{minutes} minutes",
  deliverySummaryAt: "Résumé quotidien à",
  deliverySummaryOn: "Qui attend et ce qui est dû, une fois par jour.",
  deliverySummaryOff: "Désactivé. Laissez vide pour ne pas avoir de résumé.",
  deliveryModesSaveFailed: "Impossible d'enregistrer.",

  deviceWeb: "Navigateur web",
  deviceAndroid: "Application Android",
  deviceIos: "iPhone ou iPad",
  deviceUnknown: "Appareil non reconnu",
  deviceThisOne: "Cet appareil",
  deviceNoLocation: "Emplacement non disponible",
  deviceLastActive: "Dernière activité {when}",
  deviceSignedIn: "connexion {when}",

  emailUnreachable: "Nous ne pouvons pas vous écrire à {email}",
  emailBouncing:
    "Les courriels à cette adresse rebondissent, alors nous avons cessé d'en " +
    "envoyer. Les notifications poussées fonctionnent toujours. Si l'adresse " +
    "comporte une faute, corrigez-la d'abord dans votre compte, puis " +
    "demandez-nous de réessayer.",
  emailComplained:
    "Cette adresse a signalé nos courriels comme pourriel, alors nous avons " +
    "cessé d'y écrire pour de bon. Les notifications poussées fonctionnent " +
    "toujours. Pour recevoir des courriels de nouveau, changez l'adresse de " +
    "votre compte.",
  emailRetrying: "Tentative…",
  emailRetryAction: "Réessayer cette adresse",
  emailRetryQueued:
    "Nous réessaierons cette adresse à votre prochaine notification.",
  emailRetryFailed: "Impossible de faire cela. Réessayez.",

  emergencyTitle: "Mots d'urgence et réponse",
  emergencyDescription:
    "Les mots qu'un client peut texter pour joindre toute l'équipe " +
    "immédiatement, et ce qui lui est renvoyé automatiquement.",
  emergencySave: "Enregistrer les réglages d'urgence",
  emergencyWordsLabel: "Les mots qui comptent comme une urgence",
  emergencyWordsHelp:
    "La correspondance se fait sur le premier mot envoyé par le client, alors " +
    "« URGENT pas de chauffage » compte. Utilisez les mots que vos clients " +
    "emploieraient vraiment.",
  emergencyWordRemoveAria: "Retirer {word}",
  emergencyWordAddAria: "Ajouter un mot d'urgence",
  emergencyWordsAreDefaults:
    "Ce sont les mots par défaut. Changez-les et seuls vos mots seront " +
    "surveillés.",
  emergencyWordDuplicate: "{word} est déjà dans la liste.",
  emergencyWordLimit:
    "Dix mots, c'est la limite — au-delà, ce n'est plus une urgence.",
  emergencyWordLastOne:
    "Gardez au moins un mot. Pour cesser de traiter les réponses comme des " +
    "urgences, désactivez l'interrupteur ci-dessus.",
  emergencyReplyLabel: "Réponse automatique",
  emergencyReplySwitch: "Répondre au client par texto",
  emergencyReplySwitchHelp:
    "Désactivé, nous alertons quand même l'équipe et signalons la " +
    "conversation — nous n'écrivons simplement pas au client pour vous.",
  emergencyReplyHelp:
    "Envoyée au plus une fois par heure à un client qui texte l'un de ces " +
    "mots. Dites ce qui est vrai pour votre entreprise.",
  emergencyUsingDefault: " · valeur par défaut utilisée",
  emergencyPreviewLabel: "Ce que le client reçoit",
  emergencySafetyNote:
    "« {line} » est toujours ajouté et ne peut pas être modifié. Vous décidez " +
    "de ce qui est promis ; dire à une personne en danger où s'adresser " +
    "ailleurs n'est pas à nous de l'omettre.",
  emergencySaved: "Réglages d'urgence enregistrés.",
  emergencySaveFailed:
    "Impossible d'enregistrer vos réglages d'urgence. Réessayez.",
  emergencyToggleFailed: "Impossible de changer cela. Réessayez.",

  exportDataTitle: "Exporter vos données",
  exportDataDescription:
    "Une copie de tout ce que contient cet espace de travail, dans un format " +
    "que vous pouvez charger ailleurs.",
  exportDataContents:
    "Clients, conversations, textos, tâches, historique d'appels et " +
    "transcriptions de messages vocaux, réponses enregistrées, étiquettes et " +
    "désabonnements. Les photos et les enregistrements sont listés avec leur " +
    "emplacement et leur taille, plutôt que copiés.",
  exportDataBuilding:
    "Votre exportation est en préparation. Cela prend habituellement quelques " +
    "minutes, et nous vous écrirons quand ce sera prêt — vous pouvez fermer " +
    "cette page.",
  exportDataAction: "Exporter mes données",
  exportDataStarting: "Démarrage…",
  exportDataAlready: "Une exportation est déjà en préparation.",
  exportDataStarted:
    "Nous préparons votre exportation. Nous vous écrirons quand ce sera prêt.",
  exportDataStartFailed:
    "Impossible de démarrer l'exportation. Réessayez dans un moment.",
  exportDataFailed:
    "La dernière exportation ne s'est pas terminée {when}. Réessayez, et si " +
    "cela continue d'échouer, dites-le-nous.",
  exportDataLatest: "Dernière exportation",
  exportDataRecords: "{count} enregistrements",
  exportDataExpired:
    "Les liens de téléchargement sont expirés et la copie a été supprimée. " +
    "Demandez-en une nouvelle ci-dessus.",
  exportDataLinksExpire:
    "Ces liens fonctionnent jusqu'au {when}, après quoi la copie est supprimée.",

  exportUsageFrom: "Du",
  exportUsageTo: "Au",
  exportUsageStart: "Lancer",
  exportUsageAlready:
    "Un document est déjà en préparation. Il apparaîtra sous Exportation de " +
    "données.",
  exportUsageStarted:
    "En préparation. Il apparaîtra sous Exportation de données.",
  exportUsageFailed: "Impossible de démarrer cela.",

  giveUpAccessTitle: "Renoncer à votre propre accès ?",
  giveUpAccessKeep: "Garder mon accès",
  giveUpAccessChanging: "Changement…",
  giveUpAccessMakeMe: "Faire de moi un {role}",
  roleAdminWord: "administrateur",
  roleMemberWord: "membre",

  heldNumbersTitleMany: "Numéros en attente",
  heldNumbersTitleOne: "Un numéro est en attente",
  heldCoversFewerMany:
    "Votre forfait {plan} couvre moins de numéros que vous n'en avez, alors " +
    "ceux-ci sont en attente.",
  heldCoversFewerOne:
    "Votre forfait {plan} couvre moins de numéros que vous n'en avez, alors " +
    "celui-ci est en attente.",
  heldCoversCountMany:
    "Votre forfait {plan} couvre {count} {noun}, et vous en avez plus que " +
    "cela — alors ceux-ci sont en attente.",
  heldCoversCountOne:
    "Votre forfait {plan} couvre {count} {noun}, et vous en avez plus que " +
    "cela — alors celui-ci est en attente.",
  heldNumberNoun: "numéro",
  heldNumbersNoun: "numéros",
  heldReassuranceMany:
    "Rien n'a été abandonné. Nous les gardons toujours pour vous, les textos " +
    "et les appels entrent encore, et l'historique est intact — vous ne " +
    "pouvez simplement pas envoyer ni répondre à partir de ces numéros tant " +
    "qu'ils sont en attente.",
  heldReassuranceOne:
    "Rien n'a été abandonné. Nous le gardons toujours pour vous, les textos " +
    "et les appels entrent encore, et l'historique est intact — vous ne " +
    "pouvez simplement pas envoyer ni répondre à partir de ce numéro tant " +
    "qu'il est en attente.",
  heldYourNumber: "Votre numéro",
  heldThisNumber: "ce numéro",
  heldSince: "En attente depuis le {since}.",
  heldBringBack: "Le récupérer — {price}/mois",
  heldConfirmTitle: "Récupérer {number} ?",
  heldConfirmBody:
    "Cela ajoute un numéro supplémentaire à votre forfait à {price}/mois, " +
    "facturé aujourd'hui pour le reste de cette période de facturation. " +
    "{number} recommence à envoyer et à répondre immédiatement, avec tout ce " +
    "qu'il contient déjà.",
  heldBringingBack: "Récupération…",
  heldAddFor: "L'ajouter pour {price}/mois",
  heldAlreadyBack: "{number} est déjà de retour.",
  heldIsBack:
    "{number} est de retour. Vous pouvez de nouveau envoyer et répondre à " +
    "partir de ce numéro.",
  heldReinstateFailed: "Impossible de récupérer le numéro. Réessayez.",
  heldUpgradeMany:
    "Passer à Pro les récupère aussi — Pro inclut {count} numéros, sans frais " +
    "supplémentaires par numéro.",
  heldUpgradeOne:
    "Passer à Pro le récupère aussi — Pro inclut {count} numéros, sans frais " +
    "supplémentaires par numéro.",
  heldNoRouteMany:
    "Pour les récupérer, écrivez-nous et nous réglerons cela avec vous.",
  heldNoRouteOne:
    "Pour le récupérer, écrivez-nous et nous réglerons cela avec vous.",
  heldMaxTotal: "{plan} plafonne à {count} numéros au total.",

  languageTitle: "Langue",
  languageDescription:
    "La langue des textos que nous envoyons en votre nom.",
  languageScope:
    "Cela change quatre textos : la réponse d'absence en dehors des heures, " +
    "le texto après un appel manqué, l'accusé de réception d'urgence et la " +
    "demande d'évaluation. Cela ne traduit pas cette application, et cela ne " +
    "traduit pas un message que vous avez écrit vous-même. Un message " +
    "d'absence que vous avez tapé garde les mots que vous avez tapés.",
  languagePerContact:
    "Un client qui a sa propre langue dans sa fiche la garde. Ceci est ce que " +
    "tous les autres entendent de votre part.",
  languageAdminOnly:
    "Seuls les propriétaires et les administrateurs peuvent changer la langue.",
  languageSaved: "Langue enregistrée.",
  languageSaveFailed: "Impossible d'enregistrer la langue. Réessayez.",

  leadChaseLabel: "Prévenir toute l'équipe après {minutes} minutes",
  leadChaseHelp:
    "Quand une conversation est assignée à une personne et qu'elle n'a " +
    "toujours pas répondu, prévenir tous ceux qui la voient. Pendant les " +
    "heures d'ouverture seulement, et jamais quelqu'un qui a désactivé ses " +
    "propres notifications.",
  leadChaseScope:
    "Ce réglage vaut pour tout l'espace de travail, pas seulement pour vous",
  leadChaseAdminOnly:
    " — seuls les propriétaires et les administrateurs peuvent le changer.",
  leadChaseSaveFailed: "Impossible d'enregistrer. Réessayez.",

  leadSourcesTitle: "D'où viennent les clients",
  leadSourcesDescription:
    "Votre propre liste — le camion, l'affiche sur le terrain, la publicité, " +
    "un voisin. Attribuez-en une à un numéro et chaque appel et chaque texto " +
    "vers cette ligne est compté automatiquement.",
  leadSourcesEmpty:
    "Rien pour l'instant, alors chaque conversation se lit comme « ne sais " +
    "pas ». La façon la moins coûteuse de commencer est de nommer le numéro " +
    "que vous annoncez — l'attribution ne coûte alors rien à l'équipe.",
  leadSourcesArchivedNote:
    "Archivées — retirées des sélecteurs, toujours nommées dans les rapports " +
    "sur la période où elles étaient actives.",
  leadSourcesAdminOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier cette " +
    "liste. Tout le monde peut en attribuer une à une conversation.",
  leadSourceDefaultName: "Camion",
  leadSourceAddLabel: "En ajouter une",
  leadSourceAdding: "Ajout…",
  leadSourceArchiveAction: "Archiver",
  leadSourceRestoreAction: "Réactiver",
  leadSourceAdded:
    "« {name} » ajoutée. Attribuez-la à un numéro pour commencer à compter.",
  leadSourceArchived: "Archivée.",
  leadSourceRestored: "De retour dans la liste.",
  leadSourceAddFailed: "Impossible d'ajouter cela.",
  leadSourceSaveFailed: "Impossible d'enregistrer cela.",

  leaveWorkspaceTitle: "Quitter cet espace de travail",
  leaveWorkspaceDescription:
    "Mettez fin à votre propre accès à cet espace de travail. Vous pouvez le " +
    "faire vous-même — vous n'avez pas à demander à un propriétaire.",
  leaveWorkspaceAccessEnds:
    "Votre accès prend fin immédiatement, sur chaque appareil où vous êtes " +
    "connecté.",
  leaveWorkspaceHandoff:
    "Tout ce sur quoi vous travailliez retourne à l'équipe, pour que rien ne " +
    "reste rattaché à quelqu'un qui est parti.",
  leaveWorkspaceRecordStays:
    "Les textos que vous avez envoyés restent au dossier sous votre nom. " +
    "Partir n'efface pas votre travail, et ce n'est pas le but.",
  leaveWorkspaceComeBack:
    "Pour revenir, quelqu'un de l'espace de travail doit vous réinviter.",
  leaveWorkspaceAction: "Quitter l'espace de travail",
  leaveWorkspaceConfirmTitle: "Quitter {name} ?",
  leaveWorkspaceConfirmDescription:
    "Votre accès prend fin maintenant et votre travail en cours retourne à " +
    "l'équipe. Pour revenir, quelqu'un devra vous réinviter.",
  leaveWorkspaceStay: "Rester",
  leaveWorkspaceLeaving: "Départ…",
  leaveWorkspaceDone: "Vous avez quitté l'espace de travail.",
  leaveWorkspaceDoneHandoff:
    "Vous êtes parti. Votre travail en cours est retourné à l'équipe.",
  leaveWorkspaceFailed: "Impossible de partir. Réessayez.",

  memberAccessTitle: "Numéros que {name} peut joindre",
  memberAccessDescription:
    "Ce que cette personne peut faire sur chaque numéro, et la règle qui l'a " +
    "décidé.",
  memberAccessChecking: "Vérification…",
  memberAccessLoadFailed: "Impossible de charger son accès. Réessayez.",
  memberAccessNoNumbers:
    "Cet espace de travail n'a pas encore de numéros.",
  memberAccessUnnamedNumber: "Numéro",

  missedWhileOffOne:
    "1 client a appelé pendant que votre numéro était désactivé",
  missedWhileOffMany:
    "{count} clients ont appelé pendant que votre numéro était désactivé",
  missedWhileOffHeard: "Ils ont entendu que le numéro ne prend pas les appels.",
  missedWhileOffLast:
    "Ils ont entendu que le numéro ne prend pas les appels. Le plus récent " +
    "était {when}.",
  dayToday: "aujourd'hui",
  dayYesterday: "hier",
  dayOn: "le {date}",

  myAccessTitle: "Ce que vous pouvez joindre",
  myAccessDescription:
    "Certains numéros de cet espace de travail ne sont pas partagés avec " +
    "vous. Voici lesquels, et ce qui l'a décidé.",
  myAccessUnnamedNumber: "Un numéro",

  emailCardTitle: "Courriel",
  emailCardDescription: "L'adresse que nous utilisons pour vous joindre.",
  emailRelayNote:
    "Le courriel passe par Apple. Pour vous connecter sur un autre appareil, " +
    "définissez un mot de passe ci-dessous.",
  emailSignedInAs: "Vous êtes connecté en tant que {email}.",
  emailAddOne: "Ajoutez un courriel à votre compte.",
  emailChangeSent:
    "Nous avons écrit à votre ancienne et à votre nouvelle adresse. Confirmez " +
    "à partir de chacune pour terminer le changement.",
  emailChangeAnother: "Changer pour une autre adresse",
  emailNewLabel: "Nouveau courriel",
  emailConfirmBoth:
    "Nous vous demanderons de confirmer à partir de vos deux boîtes de " +
    "réception, l'ancienne et la nouvelle.",
  emailSending: "Envoi…",
  emailChangeAction: "Changer le courriel",
  emailInvalid: "Entrez une adresse courriel valide.",
  emailAlreadyYours: "C'est déjà votre adresse courriel.",

  passwordSetAction: "Définir un mot de passe",
  passwordChangeAction: "Changer le mot de passe",
  passwordSetting: "Définition…",
  passwordSetDescription:
    "Ajoutez un mot de passe pour vous connecter sur n'importe quel appareil, " +
    "pas seulement avec Google ou Apple.",
  passwordChangeDescription:
    "Choisissez un nouveau mot de passe. Nous pourrions vous demander de " +
    "confirmer votre identité.",
  passwordNewLabel: "Nouveau mot de passe",
  passwordConfirmLabel: "Confirmer le mot de passe",
  passwordCodeLabel: "Code de confirmation",
  passwordCodeHelp: "Entrez le code à 6 chiffres que nous vous avons envoyé.",
  passwordTooShort: "Utilisez au moins 8 caractères.",
  passwordMismatch: "Les mots de passe ne correspondent pas.",
  passwordNonceRequired:
    "Entrez le code à 6 chiffres reçu par courriel.",
  passwordReauthSent:
    "Par sécurité, entrez le code à 6 chiffres que nous venons de vous envoyer.",
  passwordSet: "Mot de passe défini.",
  passwordUpdated: "Mot de passe mis à jour.",

  planUpgradeAction: "Passer à Pro",
  planSwitchAction: "Passer à Starter",
  planUpgradeTitle: "Passer à Pro ?",
  planSwitchTitle: "Passer à Starter ?",
  planUpgradeBody:
    "Pro coûte {price}/mois : une plus grande allocation de textos en usage " +
    "raisonnable, {seats} sièges et un deuxième numéro. La différence au " +
    "prorata pour le reste de cette période vous est facturée aujourd'hui.",
  planSwitchBody:
    "Starter coûte {price}/mois : les textos pour une petite équipe en usage " +
    "raisonnable, {seats} sièges, 1 numéro.",
  planNumbersOk: "1 numéro de téléphone. Tout est en règle.",
  planNumbersOver:
    "Starter inclut 1 numéro de téléphone ; vous en avez {count}.",
  planReleaseOne: "un",
  planReleaseFirst: "Libérez-en {count} d'abord",
  planSeatsUnknown: "Impossible de vérifier votre nombre de membres.",
  planSeatsOk: "Jusqu'à {seats} membres ; vous en avez {count}.",
  planSeatsOver:
    "Starter inclut {seats} membres ; vous en avez {count} actifs.",
  planDeactivate: "Désactivez-en {count}",
  planFirstWord: "d'abord.",
  planDowngradeTiming:
    "Le changement prend effet à la fin de votre période en cours. Vous gardez " +
    "Pro jusque-là, et rien n'est remboursé en cours de période.",
  planPrepaidPaid: "Payé d'avance",
  planPrepaidMonthsUsed: "Mois utilisés",
  planPrepaidOfTwelve: "{used} sur 12",
  planPrepaidCredit: "Crédité à votre compte",
  planChanging: "Changement…",
  planSwitchAtPeriodEnd: "Passer à la fin de la période",
  planUpgradedPlain:
    "Vous êtes sur Pro. La plus grande allocation commence maintenant.",
  planUpgradedOneBack: "Vous êtes sur Pro, et {number} est de retour.",
  planUpgradedManyBack:
    "Vous êtes sur Pro, et {count} numéros sont de retour.",
  planStarterStarts:
    "Starter commence le {date}. Vous gardez Pro jusque-là.",
  planChangeFailed: "Impossible de changer le forfait. Réessayez.",

  widgetTitle: "Bouton « Écrivez-nous » pour votre site Web",
  widgetBlurb:
    "Un bouton sur votre propre site qui transforme un visiteur en " +
    "conversation ici. Il entre son numéro, nous lui envoyons un code, et son " +
    "message arrive dans votre boîte comme n'importe quel texto.",
  widgetShow: "Obtenir le code à coller",
  widgetPreviewTitle: "Un aperçu de votre bouton « Écrivez-nous »",
  widgetPreviewHint: "Votre site, avec le bouton dessus.",
  widgetStepCopy: "Copiez la ligne ci-dessous.",
  widgetStepPaste: "Collez-la dans votre site, juste avant </body>.",
  widgetStepSave:
    "Enregistrez et rechargez votre site — le bouton apparaît en bas à droite.",
  widgetCopy: "Copier",
  widgetCopied: "Copié.",
  widgetCopyFailed:
    "Impossible de copier. Sélectionnez la ligne et copiez-la à la main.",
  widgetLoadFailed: "Impossible de charger votre code. Réessayez.",
  widgetRotate: "Remplacer la clé",
  widgetRotateWarning:
    "Le bouton cessera de fonctionner sur tous les sites utilisant l'ancien " +
    "code, immédiatement. Vous devrez coller le nouveau partout où vous l'avez " +
    "installé.",
  widgetRotateConfirm: "Remplacer",
  widgetRotated: "Remplacée. Collez le nouveau code sur votre site.",
  widgetLineLabel: "Le numéro qui reçoit les messages du site web",
  widgetLineHelp:
    "Les réponses de votre équipe partent de ce numéro : choisissez la ligne que vous surveillez.",
  widgetLineDefault: "Votre premier numéro",
  widgetLineSaved: "Les messages du site web arriveront sur ce numéro.",
  widgetLineFailed: "L'enregistrement a échoué. Réessayez.",
  widgetRotateFailed: "Impossible de remplacer la clé. Réessayez.",
};
