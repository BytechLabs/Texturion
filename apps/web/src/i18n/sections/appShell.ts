/**
 * #228 — the words the app's routed screens says, in both languages.
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
 * ## Ordering
 *
 * Grouped by SCREEN, in the order a reader meets them, rather than
 * alphabetically. A translator working through Settings › Calling needs that
 * screen's forty strings adjacent; sorted by name they would be scattered
 * through four hundred.
 *
 * ## The register
 *
 * Quebec French, vouvoiement throughout, accents spelled normally (the GSM-7
 * restriction in `packages/shared/src/locale.ts` governs SMS bodies, which are
 * billed by the segment — nothing on a web page is). Product names (Loonext,
 * Stripe, Telnyx, Lou) and the carrier keywords (STOP / START / URGENT) are
 * never translated: a carrier matches on them.
 */
import type { Translated } from "../translated";

export const appShellEn = {
  // /inbox with no thread open.
  inboxPickAThread: "Select a conversation to read it here.",
  // ── Shared across these screens ───────────────────────────────────────────
  /** A write that failed for no reason we can name. */
  saveFailed: "Couldn't save. Try again.",
  /** The same, for a screen that says which thing. */
  saveThatFailed: "Couldn't save that. Try again.",

  // ── The (app) segment error boundary ──────────────────────────────────────
  segmentErrorTitle: "This screen ran into a problem.",
  segmentErrorBody:
    "The rest of the app is fine. You can try this screen again or move on " +
    "from the sidebar.",

  // ── Inbox shell ───────────────────────────────────────────────────────────
  conversationListAria: "Conversation list",

  // ── Contacts list ─────────────────────────────────────────────────────────
  contactsTitle: "Contacts",
  contactsImportCsv: "Import CSV",

  // ── Contact detail ────────────────────────────────────────────────────────
  contactLoading: "Loading contact",
  contactNotFound: "This contact doesn't exist or was removed.",
  contactSaveFailed: "Couldn't save. Check your connection.",
  contactDetailsCard: "Details",
  contactName: "Name",
  contactNamePlaceholder: "Add a name",
  contactBusiness: "Business",
  contactBusinessPlaceholder: "Who they work for, if anyone",
  contactAddress: "Address",
  contactAddressPlaceholder: "Add an address",
  contactEmail: "Email",
  contactEmailPlaceholder: "For quotes and receipts",
  contactNotes: "Notes",
  contactNotesPlaceholder: "Gate code, dog's name, preferred arrival window…",
  contactLanguage: "Language",
  contactCopyNumberAria: "Copy number",
  contactNumberCopied: "Number copied.",
  contactOpenConversation: "Open conversation",
  contactMessage: "Message",
  contactOptedOutBadge: "Opted out",
  contactOptedOutNotice:
    "This customer opted out of texting. Sends to them are blocked.",
  contactCarrierOptOut:
    "They texted STOP, so their carrier is blocking your texts. Only they can " +
    "undo it, by texting START to your number.",
  contactManualOptOutNote:
    "Someone recorded this by hand, so undoing it here is all it takes.",
  contactMarkOptedIn: "Mark opted in again",
  contactOptedBackIn: "Marked opted in again.",
  contactOptInFailed: "Couldn't opt them back in. Try again.",
  contactWorking: "Working…",
  contactTheirTime: "Their time",
  contactClockSetByCrew: "Set by your crew",
  contactClockFromAreaCode: "From their area code",
  contactClockUnknown: "Their area code doesn't say — using your timezone",
  contactClockChange: "Change",
  contactUseAreaCode: "Use their area code",
  contactTimezoneUpdated: "Timezone updated.",
  contactTimezoneReset: "Back to their area code.",
  contactTimezoneSaveFailed: "Couldn't save the timezone. Try again.",
  contactConsentCard: "Consent",
  contactNoConsent:
    "No consent recorded yet. It's recorded when they text you first, or when " +
    "you send them their first text, which attests they asked for it.",
  contactConsentInbound: "Texted you first",
  contactConsentRecorded: "Consent recorded",
  contactConsentRecordedBy: "Consent recorded by {name}",
  contactAddedBy: "Added by {name} on {date}",
  contactEditedBy: "Edited by {name}",
  contactManageCard: "Manage this contact",
  contactStopTexting: "Stop all texting to this customer.",
  contactOptOutAction: "Opt out this contact",
  contactOptOutTitle: "Opt out this contact?",
  contactOptOutBody:
    "All texting to {phone} is blocked until they're opted back in. Use this " +
    "when a customer asks you to stop texting them.",
  contactOptOutConfirm: "Opt out",
  contactOptedOut: "Contact opted out.",
  contactOptOutFailed: "Couldn't opt them out. Try again.",
  contactHideNote:
    "Hide this contact from your list. Texting history stays, and they " +
    "reappear if they text you again.",
  contactDeleteAction: "Delete contact",
  contactDeleteTitle: "Delete this contact?",
  contactDeleteBody:
    "They disappear from your contact list. Conversations and messages stay, " +
    "and the contact comes back automatically if they text you again.",
  contactKeepContact: "Keep contact",
  contactDeleting: "Deleting…",
  contactDeleted: "Contact deleted.",
  contactDeleteFailed: "Couldn't delete the contact. Try again.",

  // ── Settings index + route gate ───────────────────────────────────────────
  settingsIndexOpening: "Opening your settings…",
  settingsIndexNothingHere: "There's nothing here for you yet.",
  gateNoAccessToSection: "You don't have access to {section}",
  gateNoAccessToPage: "You don't have access to this page",
  gateNoAccessBody:
    "Ask an owner or an admin if you need it — they're the ones who can " +
    "change what your role reaches.",
  gateBackToSettings: "Back to your settings",

  // ── Settings › Account ────────────────────────────────────────────────────
  accountTitle: "Account",
  accountDescription: "How you sign in to Loonext.",
  accountLoading: "Loading account settings",
  accountMethodsTitle: "Sign-in methods",
  accountMethodsDescription:
    "How you can log in. Same email across methods stays one account.",

  // ── Settings › Profile ────────────────────────────────────────────────────
  profileTitle: "Profile",
  profileDescription: "You, across this workspace.",
  profileDisplayName: "Display name",
  profileDisplayNameDescription:
    "How teammates see you on assignments and notes.",
  profileSignedInAs: "Signed in as {email}",
  profileNameSaved: "Name saved.",
  profileNameSaveFailed: "Couldn't save your name. Try again.",
  /* What the display-name field refuses, said under it. Declared in a zod
     schema rather than in JSX, which is why it read English after a pass that
     extracted the label directly above it. */
  profileNameRequired: "Enter your display name.",
  profileNameTooLong: "Keep it under {max} characters.",
  profileTheme: "Theme",
  profileThemeSystem: "System",
  profileThemeLight: "Light",
  profileThemeDark: "Dark",
  profileThemeLoading: "Loading theme…",
  profileSignOut: "Sign out",
  profileSigningOut: "Signing out…",

  // ── Settings › Numbers ────────────────────────────────────────────────────
  numbersTitle: "Numbers",
  numbersDescription:
    "The numbers your customers text, and your carrier registration.",
  numbersLoading: "Loading numbers",
  numbersNoneYet:
    "No number yet. It's created automatically when your subscription starts.",
  numbersExtraPaid:
    "An extra number is {price}/mo, billed to your subscription today. Your " +
    "monthly message allowance is shared across all your numbers — an extra " +
    "number doesn't add messages.",
  numbersFirstIncluded:
    "Choose the number your customers will text — it's included in your plan, " +
    "at no extra cost.",
  numbersProSecond:
    "Pro includes a second number, handy for a second crew or service area.",

  // ── Settings › What's new ─────────────────────────────────────────────────
  whatsNewTitle: "What's new",
  whatsNewDescription:
    "What has shipped recently. Everything here is in the product now.",
  whatsNewBadge: "New",
  whatsNewGoLook: "Go and have a look",
  whatsNewFootnote:
    "Smaller repairs ship most days and are not listed. If you reported " +
    "something and want to know where it got to, ask us on the Help page.",

  // ── Settings › Help ───────────────────────────────────────────────────────
  helpTitle: "Help",
  helpDescription:
    "Tell us what's happening and we'll look at it. Email is the fastest way " +
    "to reach a person.",
  helpEmailUs: "Email us",
  helpEmailUsDescription:
    "Opens your mail app with your workspace details already filled in, so we " +
    "can look it up without asking you first.",
  helpEmailAddress: "Email {email}",
  helpWhatToSay:
    "Say what you expected and what happened instead. If it's about a " +
    "specific text or call, the customer's phone number and roughly when it " +
    "happened is usually all we need.",
  helpNoMailApp: "If that button doesn't open anything",
  helpNoMailAppDescription:
    "Write to {email} from any email app and paste this in.",
  helpIdeaTitle: "Got an idea?",
  helpIdeaDescription:
    "Something we don't do yet, or do in a way that doesn't fit how you work.",
  helpSendIdea: "Send an idea",
  helpIdeaFootnote:
    "This goes to the same place, under its own subject so it doesn't get " +
    "triaged as a fault. Half of what's in the product came from someone " +
    "describing their day.",
  helpCommonQuestions: "Common questions",
  helpCommonQuestionsDescription:
    "The things that confuse people most, answered straight.",
  helpWhatToExpect: "What to expect",
  helpWhatToExpectDescription:
    "An honest answer rather than a promise we'd have to break.",
  helpReplyPromise:
    "We reply {time}. We're a small team, so this is email rather than a chat " +
    "window, and we read everything that comes in. If your texts have stopped " +
    "arriving, say so in the subject line and we'll start there.",

  // ── Settings › Lou (AI) ───────────────────────────────────────────────────
  aiTitle: "Lou",
  aiDescription:
    "Lou is the assistant built into Loonext. It drafts replies and fills in " +
    "task details from what a customer already wrote. Every suggestion is " +
    "yours to review and edit — Lou never sends anything, and never applies " +
    "anything on its own.",
  aiLoading: "Loading AI settings",
  aiTaskCardTitle: "When you make a task from a message",
  aiAddressLabel: "Suggest an address",
  aiAddressBody:
    "Read a job location out of the message (or fall back to the contact's " +
    "address) and pre-fill the task's address. It shows where each part came " +
    "from; you can edit or clear it before saving.",
  aiDueLabel: "Suggest a due date & time",
  aiDueBody:
    "Turn phrases like “tomorrow at 2pm” or “next Tuesday” into a due date in " +
    "your workspace's timezone. Always editable before you save.",
  aiBusinessCardTitle: "What Lou knows about your business",
  aiWhatYouDoLabel: "What you do",
  aiWhatYouDoBody:
    "One sentence, in your words. Without it Lou will not say what your " +
    "business does, because anything it said would be guesswork. With it, " +
    "drafts can answer “do you do X?” honestly.",
  aiDescriptionPlaceholder:
    "We paint houses and do small renovations in Calgary.",
  aiRepliesCardTitle: "When you reply to a customer",
  aiRepliesLabel: "Let Lou draft replies",
  aiRepliesBody:
    "Offer a few short replies you can edit before sending, drawn from the " +
    "conversation so far. Start typing and they finish what you started " +
    "instead.",
  aiVoicemailCardTitle: "When someone leaves a voicemail",
  aiVoicemailLabel: "Let Lou write voicemails down",
  aiVoicemailBody:
    "Show what a voicemail says next to the recording, so you can read it " +
    "when playing it isn't an option. The recording is always kept either way.",
  aiIntakeLabel: "Pull the job out of a voicemail",
  aiIntakeBody:
    "Lou reads the transcript and shows what the caller wanted and where, " +
    "above the recording. Your greeting is untouched — if you want callers to " +
    "say the address, ask them for it in your own greeting. Nothing books " +
    "anything and nobody is put through a menu.",
  aiWrapupCardTitle: "After a call ends",
  aiWrapupLabel: "Let Lou write down your wrap-up",
  aiWrapupBody:
    "Press the mic in the note box and say what happened — “quoted him $2,400 " +
    "for the tank, parts Thursday, he's confirming with his wife”. Lou writes " +
    "your words down exactly as you said them, for you to check and post as " +
    "an internal note.",
  aiWrapupVoiceBefore: "It records",
  aiWrapupVoiceEmphasis: "your",
  aiWrapupVoiceAfter:
    "voice, after the call has ended. The call itself is never recorded — " +
    "voicemail a caller leaves at the beep is a separate thing, covered in " +
    "Privacy.",
  aiCatchupCardTitle: "When you come back to a long thread",
  aiCatchupLabel: "Let Lou catch you up",
  aiCatchupBody:
    "On a long or long-quiet thread, Lou will read the recent messages and " +
    "show what the customer asked, what your crew said, and what's still " +
    "open. Only when someone asks for it — nothing runs on its own.",
  aiCatchupBoundary:
    "Every line points at the message it came from, so you can check it in a " +
    "tap. Your internal notes are never read, nothing is ever sent, and your " +
    "inbox order never changes.",
  aiOwnersOnly: "Only owners and admins can change these.",

  // ── Settings › Business hours & away reply ────────────────────────────────
  awayPageTitle: "Business hours & away reply",
  awayPageDescription:
    "Catch after-hours texts with one reply in your own words.",
  awayLoading: "Loading away-reply settings",
  hoursTitle: "Business hours",
  hoursDescription:
    "When you're open, in {timezone}. Texts that arrive outside these hours " +
    "can get your away reply. This is separate from each customer's texting " +
    "quiet hours.",
  hoursSaveAction: "Save hours",
  hoursSaved: "Business hours saved.",
  hoursSaveFailed: "Couldn't save your hours. Try again.",
  hoursOwnersOnly: "Only owners and admins can change business hours.",
  awayTitle: "Away reply",
  awayDescription:
    "One automatic text back when someone reaches you outside your business " +
    "hours, in your words, so you never lose an after-hours emergency.",
  awaySaveAction: "Save away reply",
  awaySaved: "Away reply saved.",
  awaySaveFailed: "Couldn't save the away reply. Try again.",
  awayMessageRequired:
    "Write your away message before turning the away reply on.",
  awayEnabledLabel: "Send an away reply after hours",
  awayEnabledBody:
    "Fires once per conversation when a customer first texts outside your " +
    "hours. Replies to their ongoing thread are never gated.",
  awayUsTextingOff:
    "Customers with US numbers won't get this reply: US texting isn't on for " +
    "this workspace. Canadian numbers get it now.",
  awayUsPendingApproval:
    "Customers with US numbers won't get this reply until your registration " +
    "is approved. Canadian numbers get it now.",
  awayMessageLabel: "Your away message",
  awayMergeHintBefore: "You can use",
  awayMergeHintBetween: "and",
  awayMergeHintAfter:
    ". Write it so an emergency still reaches you, never just “we're closed.”",
  awayEmergencyLabel: "Treat an emergency word as an emergency",
  awayEmergencyBody:
    "Texts back that start with {words} reach everyone on the crew straight " +
    "away, at the priority that wakes a phone — no away reply, and never held " +
    "back by your daily notification limit.",
  awayPreview: "Preview",
  awayOwnersOnly: "Only owners and admins can change the away reply.",

  // ── Settings › Billing ────────────────────────────────────────────────────
  billingTitle: "Billing",
  billingDescription: "Your plan and payment details.",
  billingLoading: "Loading billing",
  billingManagePortal: "Manage payment & invoices",
  billingOpening: "Opening…",
  billingPortalFailed: "Couldn't open the billing portal. Try again.",
  billingBadgeActive: "Active",
  billingBadgePaused: "Paused",
  billingBadgeChecking: "Checking…",
  billingPastDue:
    "Your last payment didn't go through. Update your payment method to keep " +
    "sending messages.",
  billingUnpaid: "Sending is paused until your payment method is updated.",
  billingUpdatePayment: "Update payment method",
  billingCancelScheduled: "Your plan is set to cancel",
  billingCancelOnDate: " on {date}",
  billingCancelAtPeriodEnd: " at the end of this period",
  billingCancelTail:
    ". Texting stops then, if it has not stopped already. Your number is held " +
    "for {days} days from the day you cancelled — not from that date — so it " +
    "can be released soon afterwards. You can undo this from the payment " +
    "portal.",
  billingKeepPlan: "Keep my plan",
  billingSubscription: "Subscription",
  billingCanceled: "Your subscription is canceled.",
  billingPlan: "Plan",
  billingNoPlanYet: "No plan yet. Finish setup to pick one and get your number.",
  billingFairUse: "Allowances reflect fair use.",
  billingSeePolicy: "See the policy",
  billingPeriodEnds: "Current period ends {date}.",
  billingPaymentTitle: "Payment & invoices",
  billingPaymentDescription:
    "Cards, receipts, and billing details live in the secure Stripe portal.",
  billingNotYourRole:
    "Billing isn't part of your role in this workspace. Ask the owner if you " +
    "need it.",

  // ── Settings › Signed-in devices ──────────────────────────────────────────
  devicesTitle: "Signed-in devices",
  devicesDescription:
    "Every browser and phone with access right now. Signing one out takes " +
    "effect immediately.",
  devicesMineTitle: "Your devices",
  devicesMineDescription: "Anything signed in as you, in any workspace.",
  devicesMineLoading: "Loading your devices",
  devicesLostPhone: "Lost a phone, or not sure about one of these?",
  devicesNoneSignedIn:
    "Nothing is signed in — which cannot be true, since you are reading this. " +
    "Refresh and check again.",
  devicesSignOut: "Sign out",
  devicesSignedOutOne: "Signed that device out.",
  devicesSignOutOneFailed: "Couldn't sign that device out. Try again.",
  devicesSignOutEverywhereElse: "Sign out everywhere else",
  devicesSignOutEverywhereElseTitle: "Sign out everywhere else?",
  devicesSignOutEverywhereElseBody:
    "{subject} will stop working on their next tap, and stop receiving your " +
    "customers' messages. You stay signed in here. Anyone who should still " +
    "have access can sign back in with their password.",
  devicesOneOther: "One other device",
  devicesNOthers: "{count} other devices",
  devicesSignThemOut: "Sign them out",
  devicesNothingElseSignedIn: "Nothing else was signed in.",
  devicesSignedOutOthers: "Signed out {count} other {devices}.",
  devicesSignOutOthersFailed: "Couldn't sign the other devices out. Try again.",
  /** The noun in "3 devices", so a French plural is not an appended "s". */
  deviceSingular: "device",
  devicePlural: "devices",
  devicesCrewTitle: "The crew's devices",
  devicesCrewDescription:
    "Everything signed in to this workspace. Removing someone already ends " +
    "their access — this is for a phone that went missing while they are " +
    "still on the team.",
  devicesCrewLoading: "Loading the crew's devices",
  devicesCrewNoneSignedIn: "Nobody on the crew has anything signed in right now.",
  devicesACrewMember: "A crew member",
  devicesSignMemberOutTitle: "Sign {name} out?",
  devicesSignMemberOutBody:
    "Every device they are signed in on — {count} right now — stops working " +
    "on its next tap and stops receiving this workspace's messages. They keep " +
    "their seat and can sign back in; a call they are on right now is not cut " +
    "off.",
  devicesSignedMemberOut: "Signed {name} out of {count} {devices}.",
  devicesTheyHadNothing: "They had nothing signed in.",
  devicesSignThemOutFailed: "Couldn't sign them out. Try again.",

  // ── Settings › History ────────────────────────────────────────────────────
  historyTitle: "History",
  historyDescription: "Every change to your workspace — who made it, and when.",
  historyFilterPerson: "Person",
  historyFilterEveryone: "Everyone",
  historyFilterChange: "Change",
  historyFilterEverything: "Everything",
  historyFilterFrom: "From",
  historyFilterTo: "To",
  historyRetention: "Kept for 12 months. This record cannot be edited, by anyone.",
  historyExportCsv: "Export CSV",
  historyExporting: "Exporting…",
  historyExportFailed: "Couldn't export the history. Try again in a moment.",
  historyEmptyTitle: "Nothing in this window",
  historyEmptyBody:
    "Changes to your team, your numbers and your settings show up here as " +
    "they happen. Widen the dates to look further back.",
  historyShowOlder: "Show older",
  historyLoadingMore: "Loading…",
  historyDetails: "Details",
  historyDetailBy: "By",
  historyDetailWas: "Was",
  historyDetailNow: "Now",

  // ── Settings › Calling ────────────────────────────────────────────────────
  callingTitle: "Calling",
  callingDescription:
    "Calls ring right in the app for your whole team. Unanswered calls take a " +
    "voicemail, and the caller gets your text-back.",
  callingLoading: "Loading calling settings",
  callingHostedOnly:
    "In-app calling needs a number whose calls come through Loonext. Calls to " +
    "your text-enabled landline stay with your existing carrier, so these " +
    "settings won't apply until you add or transfer a Loonext number.",
  callingMinutesIncluded:
    "Your plan includes {minutes} calling minutes a month, both directions.",
  callingMinutesOverage:
    " Past that, extra minutes bill at 1¢ each up to your spending cap.",
  callingMinutesDetails: "Details live in Settings › Usage.",
  mctbTitle: "Text back a missed call",
  mctbDescription:
    "When a call to your business number goes unanswered, we send the caller " +
    "one text so they can book by reply, instead of calling the next number " +
    "on their list.",
  mctbEnabledLabel: "Text back missed calls",
  mctbEnabledBody:
    "Fires once per caller when a call goes unanswered. A caller who dials " +
    "you started the conversation, so this reply is always allowed. " +
    "Opted-out numbers are never texted.",
  mctbUsTextingOff:
    "Callers with US numbers won't get this text: US texting isn't on for " +
    "this workspace. Canadian callers get it now.",
  mctbUsPendingApproval:
    "Callers with US numbers won't get this text until your registration is " +
    "approved. Canadian callers get it now.",
  mctbMessageLabel: "Your text-back message",
  mctbMergeHintBefore:
    "Saves as you type. Leave it empty to send the default, or write your own " +
    "with",
  mctbMergeHintAfter: ".",
  mctbPreviewLabel: "What the caller gets",
  mctbOwnersOnly: "Only owners and admins can change the missed-call text-back.",
  voicemailTitle: "Voicemail",
  voicemailDescription:
    "When nobody answers in the app, the caller hears this greeting and can " +
    "leave a message up to two minutes. Voicemails land in the call log and " +
    "the caller's conversation, ready to play.",
  voicemailSaveAction: "Save greeting",
  voicemailGreetingSaved: "Voicemail greeting saved.",
  voicemailGreetingLabel: "Your greeting",
  voicemailGreetingHint:
    "Spoken aloud to the caller. Leave it empty to use the default.",
  voicemailPreviewLabel: "What callers hear",
  voicemailOwnersOnly: "Only owners and admins can change the voicemail greeting.",
  screeningTitle: "Call screening",
  screeningDescription:
    "The phone network scores incoming calls for spam and fraud. Choose what " +
    "happens with that verdict.",
  screeningOffLabel: "Off",
  screeningOffDetail: "Every call rings the team, no labels.",
  screeningFlagLabel: "Label suspicious calls",
  screeningFlagDetail:
    "The carrier's verdict shows on the call — “Spam likely” — but every call " +
    "still rings the team.",
  screeningDivertLabel: "Send suspicious calls to voicemail",
  screeningDivertDetail:
    "Flagged callers skip the ring and go straight to voicemail. A real " +
    "customer who gets misflagged can still leave a message.",
  screeningUpdated: "Call screening updated.",
  screeningOwnersOnly: "Only owners and admins can change call screening.",
  cnamTitle: "Caller ID",
  cnamDescription:
    "What people see when you call them, and what you see when they call you.",
  cnamOutboundHeading: "Your outbound display name",
  cnamNoDisplayName: "No display name",
  cnamUsingCompanyName: "Using your company name",
  cnamCustomName: "Custom display name",
  cnamChange: "Change",
  cnamPendingNotice:
    "Update submitted {when}. Carriers usually show the new name within 1 to " +
    "3 days.",
  cnamNewNameLabel: "New display name",
  cnamNewNameHint:
    "Shown on US caller ID when you call customers. Letters, digits, and " +
    "spaces, 15 characters max. Canadian display names are set by the " +
    "receiving carrier, so this mainly helps your US calls.",
  cnamInvalid:
    "The display name can use letters, digits, and spaces, 15 characters max " +
    "(a carrier rule).",
  cnamReviewChange: "Review change",
  cnamUseCompanyName: "Use company name instead",
  cnamConfirmAria: "Confirm caller ID change",
  cnamConfirmBefore: "Update your caller ID to",
  cnamConfirmCompanyNameAside: " (your company name)",
  cnamConfirmAfter: "?",
  cnamConfirmHint:
    "Carriers refresh their name databases on their own schedule, so the new " +
    "name can take a few days to show on calls.",
  cnamSubmitting: "Submitting…",
  cnamUpdateAction: "Update caller ID",
  cnamGoBack: "Go back",
  cnamSubmitted: "Caller ID update submitted to carriers.",
  cnamLookupLabel: "Look up who's calling",
  cnamLookupBody:
    "Shows the caller's network-registered name on incoming calls when they " +
    "aren't in your contacts yet.",
  cnamOwnersOnly: "Only owners and admins can change caller ID settings.",

  // ── Settings › Notifications ──────────────────────────────────────────────
  notifTitle: "Notifications",
  notifDescription:
    "How you hear about customer texts, missed calls, and teammates who need " +
    "you. These are your settings; teammates set their own.",
  notifLoading: "Loading notification settings",
  notifOnCallTitle: "You're on call",
  notifCardTitle: "When something needs you",
  notifEmailLabel: "Email",
  notifEmailBody:
    "Email you when a new conversation starts or a customer texts back after " +
    "a quiet spell, never one email per message.",
  notifPushLabel: "Push",
  notifPushBody:
    "Send a notification to your devices for those same moments, plus a " +
    "missed call and any note where a teammate mentions you. Each device also " +
    "needs push turned on below.",
  notifAlwaysEmails:
    "Billing, usage, and registration emails always go to owners and admins. " +
    "They can't be turned off here.",

  // ── Settings › Team ───────────────────────────────────────────────────────
  teamTitle: "Team",
  teamDescription: "Who can see and answer your customers' texts.",
  teamLoading: "Loading team",
  teamMembersTitle: "Members",
  teamFallbackName: "Teammate",
  teamYouSuffix: "(you)",
  teamJoinedAgo: "Joined {when}",
  teamDeactivatedAgo: "Deactivated {when}",
  teamDeactivatedHeading: "Deactivated",
  teamNumbersAction: "Numbers",
  teamRoleForAria: "Role for {name}",
  teamRoleChangeFailed: "Couldn't change the role. Try again.",
  teamMoveTheirWork: "Move their work",
  teamDeactivate: "Deactivate",
  teamOwnersOnly: "Only owners and admins can invite or deactivate teammates.",
  roleOwner: "Owner",
  roleAdmin: "Admin",
  roleMember: "Member",
  roleReadOnly: "View only",
  roleBookkeeper: "Bookkeeper",
  roleAdminBlurb:
    "Everything except transferring ownership and closing the workspace",
  roleMemberBlurb: "Read and answer customers; no billing, team or settings",
  roleReadOnlyBlurb: "Can see conversations, cannot reply or change anything",
  roleBookkeeperBlurb: "Billing and invoices only; no access to conversations",
  teamMoveWorkTitle: "Move {name}'s work?",
  teamRemoveTitle: "Remove {name}?",
  teamAlreadyLeftBody:
    "{name} already left, but work was left pointing at them. Send it " +
    "somewhere a person will look.",
  teamRemoveBody:
    "They lose access right away — signed out everywhere, and notifications " +
    "stop reaching their phone. Their past messages stay theirs.",
  teamCheckingHoldings: "Checking what {name} is working on…",
  teamStillOnBefore: "{name} is still on",
  teamStillOnBetween: "and",
  teamStillOnAfter: ". Where should that go?",
  teamHoldsNothing: "{name} isn't holding any open conversations or tasks.",
  teamHandWorkToAria: "Hand their work to",
  teamLeaveUnassigned: "Leave it unassigned for the crew",
  teamHandItTo: "Hand it to {name}",
  teamATeammate: "a teammate",
  teamKeepThem: "Keep them",
  teamMoveTheWork: "Move the work",
  teamRemove: "Remove",
  teamMoving: "Moving…",
  teamRemoving: "Removing…",
  teamItemsLeftForCrew: "{items} left for the crew",
  teamItemsHandedOn: "{items} handed on",
  teamMemberRemoved: "{name} removed.",
  teamMemberRemovedWithWork: "{name} removed. {where}.",
  teamRemoveFailed: "Couldn't remove them. Try again.",
  /** Nouns for the counted phrases above, singular and plural. */
  countConversationOne: "conversation",
  countConversationMany: "conversations",
  countTaskOne: "task",
  countTaskMany: "tasks",
  countItemOne: "item",
  countItemMany: "items",
  countCharacterOne: "character",
  countCharacterMany: "characters",
  teamInvitesTitle: "Invites",
  teamInvitesDescription:
    "Teammates get an email link that adds them to this workspace. If they " +
    "already have a Loonext account, share their invite link instead.",
  teamInviteExpired: "Expired, doesn't hold a seat",
  teamInviteExpires: "Expires {date}",
  teamCopyLink: "Copy link",
  teamCopyInviteAria: "Copy invite link for {email}",
  teamInviteLinkCopied: "Invite link copied.",
  teamInviteLinkCopyFailed: "Couldn't copy the link.",
  teamRevoke: "Revoke",
  teamRevokeInviteAria: "Revoke invite for {email}",
  teamInviteRevoked: "Invite revoked.",
  teamInviteRevokeFailed: "Couldn't revoke the invite. Try again.",
  teamSeatsFull: "{used} of {limit} seats. Upgrade to add more of your crew.",
  teamSeePlans: "See plans",
  teamEmailLabel: "Email",
  teamRoleLabel: "Role",
  teamNoteLabel: "What to tell them (optional)",
  teamNotePlaceholder:
    "What they'll be doing, or anything they should know on day one.",
  /**
   * #521: the same sentence on all three clients, pinned by
   * `packages/shared/src/member-orientation-copy.test.ts`, which reads this
   * file alongside the web team screen. It says "when they join" and nothing
   * about mail on purpose — a brand-new address is invited by Supabase Auth
   * from a template this repo does not own, and that template carries no note.
   *
   * ON ONE LINE, deliberately: that guard reads this file as TEXT and does not
   * rejoin `"…" + "…"` the way it does for Kotlin and Swift, so a wrapped
   * string is not the sentence any more.
   */
  teamNoteDescription:
    "They see this once, when they join. You cannot change it after the invite goes out.",
  teamNoteCharactersLeft: "{characters} left",
  teamInviteAction: "Invite",
  teamSendingInvite: "Sending…",
  teamInviteSent: "Invite sent to {email}.",
  teamInviteEmailFailed:
    "The invite is saved, but we couldn't email {email} — use \"Copy link\" " +
    "below to send it to them.",
  teamInviteSendFailed: "Couldn't send the invite. Try again.",
  /* The two things the invite form refuses, said under the field itself.
     They come out of a zod schema rather than JSX, which is why they outlived
     the first extraction pass — a validation message is copy wherever it is
     declared. */
  teamInviteEmailInvalid: "Enter a valid email address.",
  teamInviteNoteTooLong: "Keep the note under {max} characters.",

  // ── Settings › Templates & tags ───────────────────────────────────────────
  templatesTitle: "Templates & tags",
  templatesDescription:
    "Saved replies your team can send in one tap, and the tags they file work " +
    "under.",
  templatesLoading: "Loading templates",
  templatesReadOnlyNote:
    "Anyone can send these — type / in the composer. Only an owner or admin " +
    "can add or change them.",
  templatesEmpty:
    "No templates yet. Save a reply you type all the time, then insert it " +
    "with / in the composer.",
  templatesCreateFirst: "Create your first template",
  templateNew: "New template",
  templateEdit: "Edit",
  templateEditAria: "Edit template {name}",
  templateDeleteAria: "Delete template {name}",
  templateUpdatedAgo: "Updated {when}",
  templateUpdatedBy: " by {name}",
  templateDeleteTitle: "Delete \"{name}\"?",
  templateDeleteBody:
    "It disappears from the composer's / picker for the whole team. This " +
    "can't be undone.",
  templateKeepIt: "Keep it",
  templateDeleting: "Deleting…",
  templateDeleted: "Template deleted.",
  templateDeleteFailed: "Couldn't delete the template. Try again.",
  templateDialogEditTitle: "Edit template",
  templateDialogDescription:
    "Type / in the composer to insert it while replying.",
  /* What the template dialog refuses, said under the field. Declared in a zod
     schema rather than in JSX, which is the only reason they read English
     after a pass that extracted everything around them. */
  templateNameRequired: "Give it a name.",
  templateNameTooLong: "Keep the name under {max} characters.",
  templateBodyRequired: "Add the message text.",
  templateBodyTooLong: "Keep it under {max} characters.",
  templateCategoryTooLong: "Keep it under {max} characters.",
  templateNameLabel: "Name",
  templateNamePlaceholder: "On my way",
  templateCategoryLabel: "Category",
  templateCategoryOptional: "(optional)",
  templateCategoryPlaceholder: "Quoting",
  templateMessageLabel: "Message",
  templateMessagePlaceholder: "On our way. See you in about 20 minutes.",
  templateSegmentCount: "{characters} characters · {segments} {unit} per send",
  templateSegmentOne: "segment",
  templateSegmentMany: "segments",
  templateVariablesHeading: "Variables: tap to insert",
  templateInsertToken: "Insert {token}",
  templatePreviewFor: "Preview (for {name})",
  templateYourBusiness: "your business",
  templateCreateAction: "Create template",
  templateSaved: "Template saved.",
  templateCreated: "Template created.",
  templateSaveFailed: "Couldn't save the template. Try again.",

  // ── Settings › Usage ──────────────────────────────────────────────────────
  usageTitle: "Usage",
  usageDescription: "Where this period stands under fair use.",
  usageLoading: "Loading usage",
  usageNoPlanTitle: "Fair use starts with your subscription",
  usageNoPlanDescription:
    "Once your plan is live, this is where fair use and your spending cap " +
    "live.",
  usageSeeBilling: "See billing",
  usageQuietHeadline: "Well within fair use this month.",
  usageQuietBody:
    "Almost every crew stays well inside fair use. If usage ever paces past " +
    "what your plan covers, we reach out early, right here.",
  usageFairUseLink: "How fair use works",
  usageSubjectMessages: "messages",
  usageSubjectCallingMinutes: "calling minutes",
  usageSubjectJoiner: " and ",
  usagePacingHeadline:
    "An early heads up: {subjects} are pacing past what your plan covers.",
  usageUsedBefore: "You've used",
  usageUsedOfYour: "of your",
  usageIncludedMessages: "included messages.",
  usageIncludedMinutes: "included calling minutes.",
  usageProjectionBefore: "At this pace, that's about",
  usageProjectionAfter: "in extra charges by the end of the period.",
  usageProjectionUnpriced:
    "At this pace, this period runs past what your plan includes.",
  usageCapProtects: "Nothing can bill past the spending cap below. It's yours to set.",
  usageCapReachedHeadline: "Your spending cap is doing its job.",
  usageCapNearHeadline: "You're getting close to your spending cap.",
  usageMeterMessages: "Messages are",
  usageMeterCalling: "Calling minutes are",
  usageMeterAt: "at",
  usageMeterOfThe: "of the",
  usageMeterYouAllowed: "you allowed",
  usagePauseSendingReached:
    "Sending is paused until you raise the cap or the period rolls over. " +
    "Incoming texts still arrive, free.",
  usagePauseSendingAhead:
    "At the cap, sending pauses instead of billing further. Incoming texts " +
    "still arrive, free.",
  usagePauseCallingReached:
    "Calling is paused until you raise the cap or the period rolls over. " +
    "Missed callers still get your text-back.",
  usagePauseCallingAhead:
    "At the cap, calling pauses instead of billing further. Missed callers " +
    "still get your text-back.",
  usageCapAdjustable:
    "Nothing bills past the cap. You can raise or lower it below at any time.",
  usageDeliveryTitle: "Are your texts arriving?",
  usageDeliveryDescription:
    "Carrier-reported delivery this period. A carrier confirming it took the " +
    "message is not the same as someone reading it, so this is the most we " +
    "can honestly tell you.",
  usageDeliveryConfirmed: "{count} confirmed delivered",
  usageDeliveryFailed: "{count} didn't get through",
  usageDeliveryPending: "{count} still on their way",
  usageDeliveryFailureHint:
    "A text that doesn't get through is usually a disconnected number or a " +
    "handset that has been off for days. Open the conversation and the " +
    "message itself says what the carrier reported.",
  usageDeliveryNoBounces: "Nothing has bounced this period.",
  /* The per-country line: "412 of 439" when a country has too few texts for a
     percentage to mean anything. The word between the two numbers is the only
     part of it that is language, and it is the part that would have stayed
     English forever if the numbers around it had kept it out of the guard. */
  usageDeliveryOfTotal: "{delivered} of {total}",
  usageCountryUs: "United States",
  usageCountryCa: "Canada",
  usageCountryElsewhere: "Elsewhere",
  usageSpendingCapTitle: "Spending cap",
  usageSpendingCapDescription:
    "A spending cap you control. If a month ever runs that hot, sending and " +
    "calling pause at the cap instead of billing past what you allowed.",
  usageExportTitle: "Export usage",
  usageExportDescription:
    "Take a period's texts, calls and storage away as a file.",
  usageShowNumbers: "Show the numbers",
  usageHideNumbers: "Hide the numbers",
  usageThisPeriod: "This period",
  /* The billing period, under the card's title: "Jul 1 to Jul 31". The dates
     are already locale-formatted by Intl; the word joining them was not. */
  usagePeriodRange: "{start} to {end}",
  usageMessagesLabel: "Messages:",
  usageSentOf: "sent of",
  usageIncludedSuffix: "included.",
  usagePastIncluded: "past included so far,",
  usageAtOverageRate: "at the overage rate.",
  usageSendingPausesAt: "Sending pauses at",
  usageMessagesWord: "messages",
  usageCapIsMaximum: ", the maximum, which is 10 times your included messages.",
  usageCapIsYours: ", the cap you set.",
  usageMessagesReceived: "messages received, always free.",
  usageCallingLabel: "Calling:",
  usageOf: "of",
  usageIncludedMinutesUsed: "included minutes used, both directions.",
  usageExtraMinutes: "extra minutes so far at 1¢ each.",
  usageCallingPausesAt: "Calling pauses at",
  usageMinutesSameCap: "minutes, the same cap.",
  usageLouTitle: "Lou this month",
  usageLouDescription:
    "What Lou has drafted, filled in, and written down. Each resets on the " +
    "1st.",
  usageLastSixMonths: "Last 6 months",
  usageLastSixMonthsDescription: "Outgoing messages by calendar month.",
  usageHistoryAria: "Messages sent by month: {months}.",
  usageCountingTitle: "How messages are counted",
  usageCountingBody:
    "Texts are counted in segments. A plain text fits 160 characters per " +
    "segment; texts with emoji fit 70; longer texts use more than one. A " +
    "picture message counts as 3. Incoming texts are always free and don't " +
    "count.",

  // ── Settings › Workspace ──────────────────────────────────────────────────
  workspaceTitle: "Workspace",
  workspaceDescription: "Your company as customers and carriers see it.",
  workspaceLoading: "Loading workspace settings",
  /* The company-name field's two refusals, from its zod schema. */
  workspaceNameRequired: "Enter your company name.",
  workspaceNameTooLong: "Keep it under {max} characters.",
  workspaceNameTitle: "Company name",
  workspaceNameDescription:
    "The name your customers know you by, used on your carrier registration " +
    "and available as a {business_name} field in your texts.",
  workspaceNameSaved: "Company name saved.",
  workspaceNameSaveFailed: "Couldn't save the name. Try again.",
  workspaceRenameOwnersOnly: "Only owners and admins can rename the workspace.",
  workspaceIdentityTitle: "Business identification",
  workspaceIdentityDescription:
    "What carriers have on file for your business. It comes from your texting " +
    "registration.",
  workspaceNoRegistrationNeeded:
    "No registration needed. Canadian texting works without one. Enabling US " +
    "texting adds it.",
  workspaceNoRegistrationYet: "No registration details on file yet.",
  workspaceSeeRegistration: "See registration",
  workspaceLegalName: "Legal name",
  workspaceIdSsn: "SSN (last 4)",
  workspaceIdSin: "SIN (last 4)",
  workspaceIdEin: "EIN",
  workspaceIdBusinessNumber: "Business number",
  workspaceAddress: "Address",
  workspaceWebsite: "Website",
  workspaceContact: "Contact",
  workspaceRegistrationSummary:
    "Registration is {status}. Owners and admins can see the full details.",
  workspaceRegistrationApproved: "approved",
  workspaceRegistrationOnFile: "on file",
  workspaceNeedChange: "Need to change something?",
  workspaceManageRegistration: "Manage registration",
  workspaceTimezoneTitle: "Timezone",
  workspaceTimezoneDescription:
    "Dates in emails about your workspace are framed in your business's local " +
    "time.",
  workspaceTimezoneSaved: "Timezone saved.",
  workspaceTimezoneSaveFailed: "Couldn't save the timezone. Try again.",
  workspaceLocalTimeNote:
    "It's {time} in {timezone} right now. Texting quiet hours always use each " +
    "customer's local time, not this one.",
  workspaceTimezoneOwnersOnly: "Only owners and admins can change the timezone.",
  workspaceSignTitle: "Sign your texts",
  workspaceSignDescription:
    "Add your business name to the first text you send someone, so a message " +
    "from an unknown number says who it is from.",
  workspaceSignLabel: "Sign the first text to a new customer",
  workspaceSignBody:
    "Once per customer. Replies and later texts are never signed.",
  workspaceSignPreviewLabel: "What gets added",
  workspaceSignLengthNote:
    "That is {length} characters, so a long first text can be sent in two " +
    "parts instead of one.",
  workspaceSignOwnersOnly:
    "Only owners and admins can change how texts are signed.",
  workspaceNightTitle: "Texting a new customer at night",
  workspaceNightDescription:
    "Starting a brand-new conversation between 8pm and 8am the customer's " +
    "time asks you to confirm first.",
  workspaceNightLabel: "Ask me to confirm",
  workspaceNightBody:
    "Only when you start the conversation. Replying to a customer who texted " +
    "or called you is never interrupted.",
  workspaceNightOffConsequence:
    "You will not be asked. A text you start at 2am goes straight out, and it " +
    "is on you that the customer wanted to hear from you then.",
  workspaceNightOffBoundary:
    "This does not change automated texts. Reminders and anything else we " +
    "send on your behalf still wait for the customer's morning, whatever this " +
    "is set to.",
  workspaceNightOwnersOnly: "Only owners and admins can change this.",
} as const;

export const appShellFr: Translated<typeof appShellEn> = {
  inboxPickAThread: "Sélectionnez une conversation pour la lire ici.",
  // ── Partagé ───────────────────────────────────────────────────────────────
  saveFailed: "Impossible d'enregistrer. Réessayez.",
  saveThatFailed: "Impossible d'enregistrer ce réglage. Réessayez.",

  // ── Frontière d'erreur du groupe (app) ────────────────────────────────────
  segmentErrorTitle: "Cet écran a rencontré un problème.",
  segmentErrorBody:
    "Le reste de l'application fonctionne. Vous pouvez réessayer cet écran ou " +
    "passer à autre chose depuis la barre latérale.",

  // ── Coquille de la boîte de réception ─────────────────────────────────────
  conversationListAria: "Liste des conversations",

  // ── Liste des clients ─────────────────────────────────────────────────────
  contactsTitle: "Clients",
  contactsImportCsv: "Importer un CSV",

  // ── Fiche client ──────────────────────────────────────────────────────────
  contactLoading: "Chargement du client",
  contactNotFound: "Ce client n'existe pas ou a été retiré.",
  contactSaveFailed: "Impossible d'enregistrer. Vérifiez votre connexion.",
  contactDetailsCard: "Détails",
  contactName: "Nom",
  contactNamePlaceholder: "Ajouter un nom",
  contactBusiness: "Entreprise",
  contactBusinessPlaceholder: "Pour qui travaille cette personne, s'il y a lieu",
  contactAddress: "Adresse",
  contactAddressPlaceholder: "Ajouter une adresse",
  contactEmail: "Courriel",
  contactEmailPlaceholder: "Pour les devis et les reçus",
  contactNotes: "Notes",
  contactNotesPlaceholder:
    "Code de barrière, nom du chien, plage d'arrivée souhaitée…",
  contactLanguage: "Langue",
  contactCopyNumberAria: "Copier le numéro",
  contactNumberCopied: "Numéro copié.",
  contactOpenConversation: "Ouvrir la conversation",
  contactMessage: "Écrire",
  contactOptedOutBadge: "Désabonné",
  contactOptedOutNotice:
    "Ce client s'est désabonné des textos. Les envois vers ce numéro sont " +
    "bloqués.",
  contactCarrierOptOut:
    "Le client a texté STOP, donc son fournisseur bloque vos textos. Lui seul " +
    "peut annuler cela, en textant START à votre numéro.",
  contactManualOptOutNote:
    "Quelqu'un l'a inscrit à la main : l'annuler ici suffit.",
  contactMarkOptedIn: "Réinscrire ce client",
  contactOptedBackIn: "Client réinscrit.",
  contactOptInFailed: "Impossible de le réinscrire. Réessayez.",
  contactWorking: "En cours…",
  contactTheirTime: "Son heure locale",
  contactClockSetByCrew: "Défini par votre équipe",
  contactClockFromAreaCode: "D'après son indicatif régional",
  contactClockUnknown:
    "Son indicatif régional ne le dit pas — nous utilisons votre fuseau",
  contactClockChange: "Modifier",
  contactUseAreaCode: "Utiliser son indicatif régional",
  contactTimezoneUpdated: "Fuseau horaire mis à jour.",
  contactTimezoneReset: "Retour à son indicatif régional.",
  contactTimezoneSaveFailed:
    "Impossible d'enregistrer le fuseau horaire. Réessayez.",
  contactConsentCard: "Consentement",
  contactNoConsent:
    "Aucun consentement enregistré pour l'instant. Il est enregistré quand le " +
    "client vous texte en premier, ou quand vous lui envoyez son premier " +
    "texto, ce qui atteste qu'il l'a demandé.",
  contactConsentInbound: "Vous a texté en premier",
  contactConsentRecorded: "Consentement enregistré",
  contactConsentRecordedBy: "Consentement enregistré par {name}",
  contactAddedBy: "Ajouté par {name} le {date}",
  contactEditedBy: "Modifié par {name}",
  contactManageCard: "Gérer ce client",
  contactStopTexting: "Cesser tout envoi de textos à ce client.",
  contactOptOutAction: "Désabonner ce client",
  contactOptOutTitle: "Désabonner ce client ?",
  contactOptOutBody:
    "Tous les textos vers {phone} sont bloqués jusqu'à sa réinscription. " +
    "Utilisez ceci quand un client vous demande de cesser de lui écrire.",
  contactOptOutConfirm: "Désabonner",
  contactOptedOut: "Client désabonné.",
  contactOptOutFailed: "Impossible de le désabonner. Réessayez.",
  contactHideNote:
    "Retirer ce client de votre liste. L'historique des textos reste, et il " +
    "réapparaît s'il vous texte de nouveau.",
  contactDeleteAction: "Supprimer le client",
  contactDeleteTitle: "Supprimer ce client ?",
  contactDeleteBody:
    "Il disparaît de votre liste de clients. Les conversations et les " +
    "messages restent, et le client revient automatiquement s'il vous texte " +
    "de nouveau.",
  contactKeepContact: "Conserver le client",
  contactDeleting: "Suppression…",
  contactDeleted: "Client supprimé.",
  contactDeleteFailed: "Impossible de supprimer le client. Réessayez.",

  // ── Index des paramètres + barrière de section ────────────────────────────
  settingsIndexOpening: "Ouverture de vos paramètres…",
  settingsIndexNothingHere: "Il n'y a rien ici pour vous pour l'instant.",
  gateNoAccessToSection: "Vous n'avez pas accès à {section}",
  gateNoAccessToPage: "Vous n'avez pas accès à cette page",
  gateNoAccessBody:
    "Demandez à un propriétaire ou à un administrateur si vous en avez " +
    "besoin — ce sont eux qui peuvent changer ce que votre rôle atteint.",
  gateBackToSettings: "Retour à vos paramètres",

  // ── Paramètres › Compte ───────────────────────────────────────────────────
  accountTitle: "Compte",
  accountDescription: "Comment vous vous connectez à Loonext.",
  accountLoading: "Chargement des paramètres du compte",
  accountMethodsTitle: "Méthodes de connexion",
  accountMethodsDescription:
    "Comment vous pouvez vous connecter. Le même courriel d'une méthode à " +
    "l'autre reste un seul compte.",

  // ── Paramètres › Profil ───────────────────────────────────────────────────
  profileTitle: "Profil",
  profileDescription: "Vous, dans cet espace de travail.",
  profileDisplayName: "Nom affiché",
  profileDisplayNameDescription:
    "Comment vos collègues vous voient sur les affectations et les notes.",
  profileSignedInAs: "Connecté avec {email}",
  profileNameSaved: "Nom enregistré.",
  profileNameSaveFailed: "Impossible d'enregistrer votre nom. Réessayez.",
  profileNameRequired: "Entrez votre nom d'affichage.",
  profileNameTooLong: "Gardez-le sous {max} caractères.",
  profileTheme: "Thème",
  profileThemeSystem: "Système",
  profileThemeLight: "Clair",
  profileThemeDark: "Sombre",
  profileThemeLoading: "Chargement du thème…",
  profileSignOut: "Se déconnecter",
  profileSigningOut: "Déconnexion…",

  // ── Paramètres › Numéros ──────────────────────────────────────────────────
  numbersTitle: "Numéros",
  numbersDescription:
    "Les numéros auxquels vos clients textent, et votre inscription auprès " +
    "des fournisseurs.",
  numbersLoading: "Chargement des numéros",
  numbersNoneYet:
    "Aucun numéro pour l'instant. Il est créé automatiquement au début de " +
    "votre abonnement.",
  numbersExtraPaid:
    "Un numéro supplémentaire coûte {price}/mois, facturé à votre abonnement " +
    "aujourd'hui. Votre quota mensuel de messages est partagé entre tous vos " +
    "numéros — un numéro de plus n'ajoute pas de messages.",
  numbersFirstIncluded:
    "Choisissez le numéro auquel vos clients texteront — il est inclus dans " +
    "votre forfait, sans frais supplémentaires.",
  numbersProSecond:
    "Pro inclut un deuxième numéro, pratique pour une deuxième équipe ou un " +
    "autre secteur.",

  // ── Paramètres › Nouveautés ───────────────────────────────────────────────
  whatsNewTitle: "Nouveautés",
  whatsNewDescription:
    "Ce qui a été livré récemment. Tout ce qui est ici est déjà dans le " +
    "produit.",
  whatsNewBadge: "Nouveau",
  whatsNewGoLook: "Allez y jeter un œil",
  whatsNewFootnote:
    "De petites corrections sont livrées presque tous les jours et ne sont " +
    "pas listées. Si vous avez signalé quelque chose et voulez savoir où ça " +
    "en est, écrivez-nous depuis la page Aide.",

  // ── Paramètres › Aide ─────────────────────────────────────────────────────
  helpTitle: "Aide",
  helpDescription:
    "Dites-nous ce qui se passe et nous allons regarder. Le courriel est le " +
    "moyen le plus rapide de joindre une personne.",
  helpEmailUs: "Écrivez-nous",
  helpEmailUsDescription:
    "Ouvre votre application de courriel avec les détails de votre espace de " +
    "travail déjà remplis, pour qu'on puisse le retrouver sans vous le " +
    "demander.",
  helpEmailAddress: "Écrire à {email}",
  helpWhatToSay:
    "Dites ce que vous attendiez et ce qui est arrivé à la place. S'il s'agit " +
    "d'un texto ou d'un appel précis, le numéro du client et le moment " +
    "approximatif suffisent habituellement.",
  helpNoMailApp: "Si ce bouton n'ouvre rien",
  helpNoMailAppDescription:
    "Écrivez à {email} depuis n'importe quelle application de courriel et " +
    "collez ceci.",
  helpIdeaTitle: "Une idée ?",
  helpIdeaDescription:
    "Quelque chose que nous ne faisons pas encore, ou que nous faisons d'une " +
    "façon qui ne convient pas à votre méthode de travail.",
  helpSendIdea: "Proposer une idée",
  helpIdeaFootnote:
    "Cela arrive au même endroit, sous son propre sujet, pour ne pas être " +
    "traité comme une panne. La moitié de ce qui est dans le produit vient de " +
    "quelqu'un qui a décrit sa journée.",
  helpCommonQuestions: "Questions fréquentes",
  helpCommonQuestionsDescription:
    "Ce qui mêle le plus de monde, expliqué franchement.",
  helpWhatToExpect: "À quoi vous attendre",
  helpWhatToExpectDescription:
    "Une réponse honnête plutôt qu'une promesse que nous devrions briser.",
  helpReplyPromise:
    "Nous répondons {time}. Nous sommes une petite équipe, alors c'est le " +
    "courriel plutôt qu'une fenêtre de clavardage, et nous lisons tout ce qui " +
    "arrive. Si vos textos ont cessé d'arriver, dites-le dans l'objet et nous " +
    "commencerons par là.",

  // ── Paramètres › Lou (IA) ─────────────────────────────────────────────────
  aiTitle: "Lou",
  aiDescription:
    "Lou est l'assistant intégré à Loonext. Il rédige des réponses et " +
    "remplit les détails d'une tâche à partir de ce que le client a déjà " +
    "écrit. Chaque suggestion vous revient à réviser et à modifier — Lou " +
    "n'envoie jamais rien et n'applique jamais rien de lui-même.",
  aiLoading: "Chargement des paramètres d'IA",
  aiTaskCardTitle: "Quand vous créez une tâche à partir d'un message",
  aiAddressLabel: "Suggérer une adresse",
  aiAddressBody:
    "Repérer le lieu du chantier dans le message (ou reprendre l'adresse du " +
    "client) et préremplir l'adresse de la tâche. Chaque élément indique d'où " +
    "il vient ; vous pouvez le modifier ou l'effacer avant d'enregistrer.",
  aiDueLabel: "Suggérer une date et une heure d'échéance",
  aiDueBody:
    "Transformer des formules comme « demain à 14 h » ou « mardi prochain » " +
    "en date d'échéance dans le fuseau de votre espace de travail. Toujours " +
    "modifiable avant d'enregistrer.",
  aiBusinessCardTitle: "Ce que Lou sait de votre entreprise",
  aiWhatYouDoLabel: "Ce que vous faites",
  aiWhatYouDoBody:
    "Une phrase, dans vos mots. Sans elle, Lou ne dira pas ce que fait votre " +
    "entreprise, parce que tout ce qu'il dirait serait une supposition. Avec " +
    "elle, les brouillons peuvent répondre honnêtement à « faites-vous X ? ».",
  aiDescriptionPlaceholder:
    "Nous peinturons des maisons et faisons de petites rénovations à Calgary.",
  aiRepliesCardTitle: "Quand vous répondez à un client",
  aiRepliesLabel: "Laisser Lou rédiger des réponses",
  aiRepliesBody:
    "Proposer quelques réponses courtes que vous pouvez modifier avant " +
    "l'envoi, tirées de la conversation en cours. Commencez à écrire et elles " +
    "complètent plutôt ce que vous avez commencé.",
  aiVoicemailCardTitle: "Quand quelqu'un laisse un message vocal",
  aiVoicemailLabel: "Laisser Lou transcrire les messages vocaux",
  aiVoicemailBody:
    "Afficher ce que dit un message vocal à côté de l'enregistrement, pour " +
    "que vous puissiez le lire quand l'écouter n'est pas possible. " +
    "L'enregistrement est conservé dans tous les cas.",
  aiIntakeLabel: "Dégager le travail demandé dans un message vocal",
  aiIntakeBody:
    "Lou lit la transcription et affiche ce que l'appelant voulait et où, " +
    "au-dessus de l'enregistrement. Votre message d'accueil reste intact — si " +
    "vous voulez que les appelants donnent l'adresse, demandez-la dans votre " +
    "propre message d'accueil. Rien n'est réservé et personne n'est envoyé " +
    "dans un menu.",
  aiWrapupCardTitle: "Après la fin d'un appel",
  aiWrapupLabel: "Laisser Lou noter votre compte rendu",
  aiWrapupBody:
    "Appuyez sur le micro dans la boîte de note et dites ce qui s'est passé — " +
    "« je lui ai donné un devis de 2 400 $ pour le réservoir, les pièces " +
    "jeudi, il en parle à sa femme ». Lou écrit vos mots exactement comme " +
    "vous les avez dits, pour que vous les révisiez et les publiiez en note " +
    "interne.",
  aiWrapupVoiceBefore: "Il enregistre",
  aiWrapupVoiceEmphasis: "votre",
  aiWrapupVoiceAfter:
    "voix, une fois l'appel terminé. L'appel lui-même n'est jamais " +
    "enregistré — le message vocal qu'un appelant laisse après le bip est " +
    "une autre chose, traitée dans la Confidentialité.",
  aiCatchupCardTitle: "Quand vous revenez à une longue conversation",
  aiCatchupLabel: "Laisser Lou vous remettre à jour",
  aiCatchupBody:
    "Sur une conversation longue ou longtemps silencieuse, Lou lira les " +
    "messages récents et montrera ce que le client a demandé, ce que votre " +
    "équipe a répondu et ce qui reste en suspens. Seulement quand quelqu'un " +
    "le demande — rien ne se lance tout seul.",
  aiCatchupBoundary:
    "Chaque ligne pointe vers le message d'où elle vient, pour que vous " +
    "puissiez la vérifier d'une touche. Vos notes internes ne sont jamais " +
    "lues, rien n'est jamais envoyé, et l'ordre de votre boîte de réception " +
    "ne change jamais.",
  aiOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier ces " +
    "réglages.",

  // ── Paramètres › Heures d'ouverture et réponse d'absence ──────────────────
  awayPageTitle: "Heures d'ouverture et réponse d'absence",
  awayPageDescription:
    "Rattrapez les textos hors des heures d'ouverture avec une réponse dans " +
    "vos mots.",
  awayLoading: "Chargement des paramètres de réponse d'absence",
  hoursTitle: "Heures d'ouverture",
  hoursDescription:
    "Quand vous êtes ouvert, en {timezone}. Les textos qui arrivent hors de " +
    "ces heures peuvent recevoir votre réponse d'absence. C'est distinct des " +
    "heures de silence propres à chaque client.",
  hoursSaveAction: "Enregistrer les heures",
  hoursSaved: "Heures d'ouverture enregistrées.",
  hoursSaveFailed: "Impossible d'enregistrer vos heures. Réessayez.",
  hoursOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier les " +
    "heures d'ouverture.",
  awayTitle: "Réponse d'absence",
  awayDescription:
    "Un texto automatique quand quelqu'un vous joint hors de vos heures " +
    "d'ouverture, dans vos mots, pour ne jamais rater une urgence en soirée.",
  awaySaveAction: "Enregistrer la réponse d'absence",
  awaySaved: "Réponse d'absence enregistrée.",
  awaySaveFailed: "Impossible d'enregistrer la réponse d'absence. Réessayez.",
  awayMessageRequired:
    "Rédigez votre message d'absence avant d'activer la réponse d'absence.",
  awayEnabledLabel: "Envoyer une réponse d'absence après les heures",
  awayEnabledBody:
    "Se déclenche une fois par conversation quand un client texte pour la " +
    "première fois hors de vos heures. Les réponses dans une conversation en " +
    "cours ne sont jamais retenues.",
  awayUsTextingOff:
    "Les clients avec un numéro américain ne recevront pas cette réponse : la " +
    "messagerie vers les États-Unis n'est pas activée pour cet espace de " +
    "travail. Les numéros canadiens la reçoivent dès maintenant.",
  awayUsPendingApproval:
    "Les clients avec un numéro américain ne recevront pas cette réponse tant " +
    "que votre inscription n'est pas approuvée. Les numéros canadiens la " +
    "reçoivent dès maintenant.",
  awayMessageLabel: "Votre message d'absence",
  awayMergeHintBefore: "Vous pouvez utiliser",
  awayMergeHintBetween: "et",
  awayMergeHintAfter:
    ". Rédigez-le pour qu'une urgence vous joigne quand même, jamais " +
    "seulement « nous sommes fermés ».",
  awayEmergencyLabel: "Traiter un mot d'urgence comme une urgence",
  awayEmergencyBody:
    "Les textos qui commencent par {words} rejoignent toute l'équipe " +
    "immédiatement, à la priorité qui réveille un téléphone — sans réponse " +
    "d'absence, et jamais retenus par votre limite quotidienne de " +
    "notifications.",
  awayPreview: "Aperçu",
  awayOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier la " +
    "réponse d'absence.",

  // ── Paramètres › Facturation ──────────────────────────────────────────────
  billingTitle: "Facturation",
  billingDescription: "Votre forfait et vos informations de paiement.",
  billingLoading: "Chargement de la facturation",
  billingManagePortal: "Gérer le paiement et les factures",
  billingOpening: "Ouverture…",
  billingPortalFailed:
    "Impossible d'ouvrir le portail de facturation. Réessayez.",
  billingBadgeActive: "Actif",
  billingBadgePaused: "En pause",
  billingBadgeChecking: "Vérification…",
  billingPastDue:
    "Votre dernier paiement n'est pas passé. Mettez à jour votre moyen de " +
    "paiement pour continuer à envoyer des messages.",
  billingUnpaid:
    "Les envois sont suspendus jusqu'à la mise à jour de votre moyen de " +
    "paiement.",
  billingUpdatePayment: "Mettre à jour le moyen de paiement",
  billingCancelScheduled: "Votre forfait doit être annulé",
  billingCancelOnDate: " le {date}",
  billingCancelAtPeriodEnd: " à la fin de cette période",
  billingCancelTail:
    ". Les envois cessent alors, s'ils n'ont pas déjà cessé. Votre numéro est " +
    "conservé {days} jours à partir du jour de l'annulation — pas à partir de " +
    "cette date — il peut donc être libéré peu après. Vous pouvez annuler " +
    "cela depuis le portail de paiement.",
  billingKeepPlan: "Garder mon forfait",
  billingSubscription: "Abonnement",
  billingCanceled: "Votre abonnement est annulé.",
  billingPlan: "Forfait",
  billingNoPlanYet:
    "Aucun forfait pour l'instant. Terminez la configuration pour en choisir " +
    "un et obtenir votre numéro.",
  billingFairUse: "Les quotas relèvent de l'utilisation raisonnable.",
  billingSeePolicy: "Voir la politique",
  billingPeriodEnds: "La période en cours se termine le {date}.",
  billingPaymentTitle: "Paiement et factures",
  billingPaymentDescription:
    "Les cartes, les reçus et les informations de facturation se trouvent " +
    "dans le portail sécurisé Stripe.",
  billingNotYourRole:
    "La facturation ne fait pas partie de votre rôle dans cet espace de " +
    "travail. Demandez au propriétaire si vous en avez besoin.",

  // ── Paramètres › Appareils connectés ──────────────────────────────────────
  devicesTitle: "Appareils connectés",
  devicesDescription:
    "Tous les navigateurs et téléphones qui ont accès en ce moment. " +
    "Déconnecter un appareil prend effet immédiatement.",
  devicesMineTitle: "Vos appareils",
  devicesMineDescription:
    "Tout ce qui est connecté en votre nom, dans n'importe quel espace de " +
    "travail.",
  devicesMineLoading: "Chargement de vos appareils",
  devicesLostPhone:
    "Téléphone perdu, ou vous avez un doute sur l'un d'eux ?",
  devicesNoneSignedIn:
    "Rien n'est connecté — ce qui ne peut pas être vrai, puisque vous lisez " +
    "ceci. Actualisez et vérifiez de nouveau.",
  devicesSignOut: "Déconnecter",
  devicesSignedOutOne: "Cet appareil a été déconnecté.",
  devicesSignOutOneFailed: "Impossible de déconnecter cet appareil. Réessayez.",
  devicesSignOutEverywhereElse: "Déconnecter partout ailleurs",
  devicesSignOutEverywhereElseTitle: "Déconnecter partout ailleurs ?",
  devicesSignOutEverywhereElseBody:
    "{subject} cesseront de fonctionner à la prochaine touche et cesseront de " +
    "recevoir les messages de vos clients. Vous restez connecté ici. Toute " +
    "personne qui doit garder l'accès peut se reconnecter avec son mot de " +
    "passe.",
  devicesOneOther: "Un autre appareil",
  devicesNOthers: "{count} autres appareils",
  devicesSignThemOut: "Les déconnecter",
  devicesNothingElseSignedIn: "Rien d'autre n'était connecté.",
  devicesSignedOutOthers: "{count} autre {devices} déconnecté.",
  devicesSignOutOthersFailed:
    "Impossible de déconnecter les autres appareils. Réessayez.",
  deviceSingular: "appareil",
  devicePlural: "appareils",
  devicesCrewTitle: "Les appareils de l'équipe",
  devicesCrewDescription:
    "Tout ce qui est connecté à cet espace de travail. Retirer quelqu'un met " +
    "déjà fin à son accès — ceci sert à un téléphone égaré alors que la " +
    "personne fait toujours partie de l'équipe.",
  devicesCrewLoading: "Chargement des appareils de l'équipe",
  devicesCrewNoneSignedIn:
    "Personne dans l'équipe n'a d'appareil connecté en ce moment.",
  devicesACrewMember: "Un membre de l'équipe",
  devicesSignMemberOutTitle: "Déconnecter {name} ?",
  devicesSignMemberOutBody:
    "Tous les appareils où cette personne est connectée — {count} en ce " +
    "moment — cesseront de fonctionner à la prochaine touche et cesseront de " +
    "recevoir les messages de cet espace de travail. Elle garde son siège et " +
    "peut se reconnecter ; un appel en cours n'est pas coupé.",
  devicesSignedMemberOut: "{name} déconnecté de {count} {devices}.",
  devicesTheyHadNothing: "Cette personne n'avait rien de connecté.",
  devicesSignThemOutFailed: "Impossible de la déconnecter. Réessayez.",

  // ── Paramètres › Historique ───────────────────────────────────────────────
  historyTitle: "Historique",
  historyDescription:
    "Chaque changement dans votre espace de travail — qui l'a fait, et quand.",
  historyFilterPerson: "Personne",
  historyFilterEveryone: "Tout le monde",
  historyFilterChange: "Changement",
  historyFilterEverything: "Tout",
  historyFilterFrom: "Du",
  historyFilterTo: "Au",
  historyRetention:
    "Conservé 12 mois. Ce registre ne peut être modifié par personne.",
  historyExportCsv: "Exporter en CSV",
  historyExporting: "Exportation…",
  historyExportFailed:
    "Impossible d'exporter l'historique. Réessayez dans un moment.",
  historyEmptyTitle: "Rien dans cette période",
  historyEmptyBody:
    "Les changements à votre équipe, à vos numéros et à vos paramètres " +
    "apparaissent ici au fur et à mesure. Élargissez les dates pour remonter " +
    "plus loin.",
  historyShowOlder: "Afficher plus ancien",
  historyLoadingMore: "Chargement…",
  historyDetails: "Détails",
  historyDetailBy: "Par",
  historyDetailWas: "Avant",
  historyDetailNow: "Après",

  // ── Paramètres › Appels ───────────────────────────────────────────────────
  callingTitle: "Appels",
  callingDescription:
    "Les appels sonnent directement dans l'application pour toute votre " +
    "équipe. Les appels sans réponse prennent un message vocal, et l'appelant " +
    "reçoit votre texto de rappel.",
  callingLoading: "Chargement des paramètres d'appel",
  callingHostedOnly:
    "Les appels dans l'application exigent un numéro dont les appels passent " +
    "par Loonext. Les appels vers votre ligne fixe activée pour les textos " +
    "restent chez votre fournisseur actuel, donc ces réglages ne " +
    "s'appliqueront pas tant que vous n'aurez pas ajouté ou transféré un " +
    "numéro Loonext.",
  callingMinutesIncluded:
    "Votre forfait inclut {minutes} minutes d'appel par mois, dans les deux " +
    "sens.",
  callingMinutesOverage:
    " Au-delà, les minutes supplémentaires sont facturées 1 ¢ chacune jusqu'à " +
    "votre plafond de dépenses.",
  callingMinutesDetails:
    "Les détails se trouvent dans Paramètres › Utilisation.",
  mctbTitle: "Texter après un appel manqué",
  mctbDescription:
    "Quand un appel à votre numéro d'entreprise reste sans réponse, nous " +
    "envoyons un texto à l'appelant pour qu'il puisse réserver en répondant, " +
    "au lieu d'appeler le numéro suivant sur sa liste.",
  mctbEnabledLabel: "Texter après les appels manqués",
  mctbEnabledBody:
    "Se déclenche une fois par appelant quand un appel reste sans réponse. " +
    "Un appelant qui vous téléphone a lancé la conversation, donc cette " +
    "réponse est toujours permise. Les numéros désabonnés ne sont jamais " +
    "textés.",
  mctbUsTextingOff:
    "Les appelants avec un numéro américain ne recevront pas ce texto : la " +
    "messagerie vers les États-Unis n'est pas activée pour cet espace de " +
    "travail. Les appelants canadiens le reçoivent dès maintenant.",
  mctbUsPendingApproval:
    "Les appelants avec un numéro américain ne recevront pas ce texto tant " +
    "que votre inscription n'est pas approuvée. Les appelants canadiens le " +
    "reçoivent dès maintenant.",
  mctbMessageLabel: "Votre texto de rappel",
  mctbMergeHintBefore:
    "Enregistré au fur et à mesure. Laissez-le vide pour envoyer le message " +
    "par défaut, ou rédigez le vôtre avec",
  mctbMergeHintAfter: ".",
  mctbPreviewLabel: "Ce que l'appelant reçoit",
  mctbOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier le texto " +
    "après un appel manqué.",
  voicemailTitle: "Messagerie vocale",
  voicemailDescription:
    "Quand personne ne répond dans l'application, l'appelant entend ce " +
    "message d'accueil et peut laisser un message d'au plus deux minutes. Les " +
    "messages vocaux arrivent dans le journal d'appels et dans la " +
    "conversation de l'appelant, prêts à écouter.",
  voicemailSaveAction: "Enregistrer le message d'accueil",
  voicemailGreetingSaved: "Message d'accueil enregistré.",
  voicemailGreetingLabel: "Votre message d'accueil",
  voicemailGreetingHint:
    "Lu à voix haute à l'appelant. Laissez-le vide pour utiliser celui par " +
    "défaut.",
  voicemailPreviewLabel: "Ce que les appelants entendent",
  voicemailOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier le " +
    "message d'accueil.",
  screeningTitle: "Filtrage des appels",
  screeningDescription:
    "Le réseau téléphonique évalue les appels entrants pour le pourriel et la " +
    "fraude. Choisissez ce qui arrive avec ce verdict.",
  screeningOffLabel: "Désactivé",
  screeningOffDetail:
    "Chaque appel sonne pour l'équipe, sans aucune étiquette.",
  screeningFlagLabel: "Étiqueter les appels suspects",
  screeningFlagDetail:
    "Le verdict du fournisseur s'affiche sur l'appel — « pourriel probable » " +
    "— mais chaque appel sonne quand même pour l'équipe.",
  screeningDivertLabel:
    "Envoyer les appels suspects à la messagerie vocale",
  screeningDivertDetail:
    "Les appelants signalés ne font pas sonner et vont directement à la " +
    "messagerie vocale. Un vrai client mal signalé peut quand même laisser un " +
    "message.",
  screeningUpdated: "Filtrage des appels mis à jour.",
  screeningOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier le " +
    "filtrage des appels.",
  cnamTitle: "Afficheur",
  cnamDescription:
    "Ce que les gens voient quand vous les appelez, et ce que vous voyez " +
    "quand ils vous appellent.",
  cnamOutboundHeading: "Votre nom affiché en sortie",
  cnamNoDisplayName: "Aucun nom affiché",
  cnamUsingCompanyName: "Utilise le nom de votre entreprise",
  cnamCustomName: "Nom affiché personnalisé",
  cnamChange: "Modifier",
  cnamPendingNotice:
    "Mise à jour soumise {when}. Les fournisseurs affichent habituellement le " +
    "nouveau nom en 1 à 3 jours.",
  cnamNewNameLabel: "Nouveau nom affiché",
  cnamNewNameHint:
    "Affiché sur l'afficheur américain quand vous appelez des clients. " +
    "Lettres, chiffres et espaces, 15 caractères au maximum. Les noms " +
    "affichés au Canada sont fixés par le fournisseur qui reçoit, donc ceci " +
    "aide surtout vos appels aux États-Unis.",
  cnamInvalid:
    "Le nom affiché peut contenir des lettres, des chiffres et des espaces, " +
    "15 caractères au maximum (une règle des fournisseurs).",
  cnamReviewChange: "Réviser le changement",
  cnamUseCompanyName: "Utiliser plutôt le nom de l'entreprise",
  cnamConfirmAria: "Confirmer le changement d'afficheur",
  cnamConfirmBefore: "Changer votre afficheur pour",
  cnamConfirmCompanyNameAside: " (le nom de votre entreprise)",
  cnamConfirmAfter: " ?",
  cnamConfirmHint:
    "Les fournisseurs actualisent leurs bases de noms selon leur propre " +
    "horaire, donc le nouveau nom peut prendre quelques jours à apparaître " +
    "sur les appels.",
  cnamSubmitting: "Soumission…",
  cnamUpdateAction: "Mettre à jour l'afficheur",
  cnamGoBack: "Revenir",
  cnamSubmitted: "Mise à jour de l'afficheur soumise aux fournisseurs.",
  cnamLookupLabel: "Chercher qui appelle",
  cnamLookupBody:
    "Affiche le nom enregistré au réseau de l'appelant sur les appels " +
    "entrants quand il n'est pas encore dans vos clients.",
  cnamOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier les " +
    "réglages de l'afficheur.",

  // ── Paramètres › Notifications ────────────────────────────────────────────
  notifTitle: "Notifications",
  notifDescription:
    "Comment vous êtes averti des textos de clients, des appels manqués et " +
    "des collègues qui ont besoin de vous. Ce sont vos réglages ; vos " +
    "collègues règlent les leurs.",
  notifLoading: "Chargement des paramètres de notification",
  notifOnCallTitle: "Vous êtes de garde",
  notifCardTitle: "Quand quelque chose a besoin de vous",
  notifEmailLabel: "Courriel",
  notifEmailBody:
    "Vous écrire quand une nouvelle conversation commence ou qu'un client " +
    "reprend contact après un silence, jamais un courriel par message.",
  notifPushLabel: "Notifications poussées",
  notifPushBody:
    "Envoyer une notification à vos appareils pour ces mêmes moments, plus un " +
    "appel manqué et toute note où un collègue vous mentionne. Chaque " +
    "appareil doit aussi avoir les notifications activées ci-dessous.",
  notifAlwaysEmails:
    "Les courriels de facturation, d'utilisation et d'inscription vont " +
    "toujours aux propriétaires et aux administrateurs. Ils ne peuvent pas " +
    "être désactivés ici.",

  // ── Paramètres › Équipe ───────────────────────────────────────────────────
  teamTitle: "Équipe",
  teamDescription: "Qui peut voir et répondre aux textos de vos clients.",
  teamLoading: "Chargement de l'équipe",
  teamMembersTitle: "Membres",
  teamFallbackName: "Collègue",
  teamYouSuffix: "(vous)",
  teamJoinedAgo: "Arrivé {when}",
  teamDeactivatedAgo: "Désactivé {when}",
  teamDeactivatedHeading: "Désactivés",
  teamNumbersAction: "Numéros",
  teamRoleForAria: "Rôle de {name}",
  teamRoleChangeFailed: "Impossible de changer le rôle. Réessayez.",
  teamMoveTheirWork: "Déplacer son travail",
  teamDeactivate: "Désactiver",
  teamOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent inviter ou " +
    "désactiver des collègues.",
  roleOwner: "Propriétaire",
  roleAdmin: "Administrateur",
  roleMember: "Membre",
  roleReadOnly: "Lecture seule",
  roleBookkeeper: "Comptable",
  roleAdminBlurb:
    "Tout sauf le transfert de propriété et la fermeture de l'espace de " +
    "travail",
  roleMemberBlurb:
    "Lire et répondre aux clients ; aucun accès à la facturation, à l'équipe " +
    "ni aux paramètres",
  roleReadOnlyBlurb:
    "Peut voir les conversations, ne peut ni répondre ni rien modifier",
  roleBookkeeperBlurb:
    "Facturation et factures seulement ; aucun accès aux conversations",
  teamMoveWorkTitle: "Déplacer le travail de {name} ?",
  teamRemoveTitle: "Retirer {name} ?",
  teamAlreadyLeftBody:
    "{name} est déjà parti, mais du travail lui est resté attribué. " +
    "Envoyez-le là où une personne le verra.",
  teamRemoveBody:
    "Cette personne perd l'accès immédiatement — déconnectée partout, et les " +
    "notifications cessent d'atteindre son téléphone. Ses messages passés " +
    "restent les siens.",
  teamCheckingHoldings: "Vérification de ce sur quoi {name} travaille…",
  teamStillOnBefore: "{name} est encore sur",
  teamStillOnBetween: "et",
  teamStillOnAfter: ". Où cela doit-il aller ?",
  teamHoldsNothing:
    "{name} n'a aucune conversation ni tâche ouverte en main.",
  teamHandWorkToAria: "Confier son travail à",
  teamLeaveUnassigned: "Le laisser non attribué, pour l'équipe",
  teamHandItTo: "Le confier à {name}",
  teamATeammate: "un collègue",
  teamKeepThem: "La garder",
  teamMoveTheWork: "Déplacer le travail",
  teamRemove: "Retirer",
  teamMoving: "Déplacement…",
  teamRemoving: "Retrait…",
  teamItemsLeftForCrew: "{items} laissés pour l'équipe",
  teamItemsHandedOn: "{items} transmis",
  teamMemberRemoved: "{name} retiré.",
  teamMemberRemovedWithWork: "{name} retiré. {where}.",
  teamRemoveFailed: "Impossible de la retirer. Réessayez.",
  countConversationOne: "conversation",
  countConversationMany: "conversations",
  countTaskOne: "tâche",
  countTaskMany: "tâches",
  countItemOne: "élément",
  countItemMany: "éléments",
  countCharacterOne: "caractère",
  countCharacterMany: "caractères",
  teamInvitesTitle: "Invitations",
  teamInvitesDescription:
    "Vos collègues reçoivent un lien par courriel qui les ajoute à cet espace " +
    "de travail. S'ils ont déjà un compte Loonext, partagez plutôt leur lien " +
    "d'invitation.",
  teamInviteExpired: "Expirée, n'occupe pas de siège",
  teamInviteExpires: "Expire le {date}",
  teamCopyLink: "Copier le lien",
  teamCopyInviteAria: "Copier le lien d'invitation pour {email}",
  teamInviteLinkCopied: "Lien d'invitation copié.",
  teamInviteLinkCopyFailed: "Impossible de copier le lien.",
  teamRevoke: "Révoquer",
  teamRevokeInviteAria: "Révoquer l'invitation pour {email}",
  teamInviteRevoked: "Invitation révoquée.",
  teamInviteRevokeFailed: "Impossible de révoquer l'invitation. Réessayez.",
  teamSeatsFull:
    "{used} sièges sur {limit}. Passez à un forfait supérieur pour ajouter " +
    "d'autres membres de votre équipe.",
  teamSeePlans: "Voir les forfaits",
  teamEmailLabel: "Courriel",
  teamRoleLabel: "Rôle",
  teamNoteLabel: "Quoi lui dire (facultatif)",
  teamNotePlaceholder:
    "Ce qu'elle fera, ou tout ce qu'elle devrait savoir dès le premier jour.",
  teamNoteDescription:
    "Elle voit ceci une fois, à son arrivée. Vous ne pouvez pas le modifier " +
    "après l'envoi de l'invitation.",
  teamNoteCharactersLeft: "{characters} restants",
  teamInviteAction: "Inviter",
  teamSendingInvite: "Envoi…",
  teamInviteSent: "Invitation envoyée à {email}.",
  teamInviteEmailFailed:
    "L'invitation est enregistrée, mais nous n'avons pas pu écrire à " +
    "{email} — utilisez « Copier le lien » ci-dessous pour la lui envoyer.",
  teamInviteSendFailed: "Impossible d'envoyer l'invitation. Réessayez.",
  teamInviteEmailInvalid: "Entrez une adresse courriel valide.",
  teamInviteNoteTooLong: "Gardez la note sous {max} caractères.",

  // ── Paramètres › Modèles et étiquettes ────────────────────────────────────
  templatesTitle: "Modèles et étiquettes",
  templatesDescription:
    "Des réponses enregistrées que votre équipe peut envoyer en une touche, " +
    "et les étiquettes sous lesquelles elle classe le travail.",
  templatesLoading: "Chargement des modèles",
  templatesReadOnlyNote:
    "Tout le monde peut les envoyer — tapez / dans la zone de rédaction. Seul " +
    "un propriétaire ou un administrateur peut en ajouter ou en modifier.",
  templatesEmpty:
    "Aucun modèle pour l'instant. Enregistrez une réponse que vous écrivez " +
    "tout le temps, puis insérez-la avec / dans la zone de rédaction.",
  templatesCreateFirst: "Créer votre premier modèle",
  templateNew: "Nouveau modèle",
  templateEdit: "Modifier",
  templateEditAria: "Modifier le modèle {name}",
  templateDeleteAria: "Supprimer le modèle {name}",
  templateUpdatedAgo: "Mis à jour {when}",
  templateUpdatedBy: " par {name}",
  templateDeleteTitle: "Supprimer « {name} » ?",
  templateDeleteBody:
    "Il disparaît du sélecteur / de la zone de rédaction pour toute l'équipe. " +
    "Cette action est irréversible.",
  templateKeepIt: "Le garder",
  templateDeleting: "Suppression…",
  templateDeleted: "Modèle supprimé.",
  templateDeleteFailed: "Impossible de supprimer le modèle. Réessayez.",
  templateDialogEditTitle: "Modifier le modèle",
  templateDialogDescription:
    "Tapez / dans la zone de rédaction pour l'insérer pendant que vous " +
    "répondez.",
  templateNameRequired: "Donnez-lui un nom.",
  templateNameTooLong: "Gardez le nom sous {max} caractères.",
  templateBodyRequired: "Ajoutez le texte du message.",
  templateBodyTooLong: "Gardez-le sous {max} caractères.",
  templateCategoryTooLong: "Gardez-la sous {max} caractères.",
  templateNameLabel: "Nom",
  templateNamePlaceholder: "En route",
  templateCategoryLabel: "Catégorie",
  templateCategoryOptional: "(facultatif)",
  templateCategoryPlaceholder: "Devis",
  templateMessageLabel: "Message",
  templateMessagePlaceholder: "En route. On arrive dans une vingtaine de minutes.",
  templateSegmentCount: "{characters} caractères · {segments} {unit} par envoi",
  templateSegmentOne: "segment",
  templateSegmentMany: "segments",
  templateVariablesHeading: "Variables : touchez pour insérer",
  templateInsertToken: "Insérer {token}",
  templatePreviewFor: "Aperçu (pour {name})",
  templateYourBusiness: "votre entreprise",
  templateCreateAction: "Créer le modèle",
  templateSaved: "Modèle enregistré.",
  templateCreated: "Modèle créé.",
  templateSaveFailed: "Impossible d'enregistrer le modèle. Réessayez.",

  // ── Paramètres › Utilisation ──────────────────────────────────────────────
  usageTitle: "Utilisation",
  usageDescription:
    "Où en est cette période au regard de l'utilisation raisonnable.",
  usageLoading: "Chargement de l'utilisation",
  usageNoPlanTitle: "L'utilisation raisonnable commence avec votre abonnement",
  usageNoPlanDescription:
    "Une fois votre forfait actif, c'est ici que se trouvent l'utilisation " +
    "raisonnable et votre plafond de dépenses.",
  usageSeeBilling: "Voir la facturation",
  usageQuietHeadline: "Bien à l'intérieur de l'utilisation raisonnable ce mois-ci.",
  usageQuietBody:
    "Presque toutes les équipes restent bien à l'intérieur de l'utilisation " +
    "raisonnable. Si l'utilisation dépasse un jour ce que couvre votre " +
    "forfait, nous vous prévenons tôt, ici même.",
  usageFairUseLink: "Comment fonctionne l'utilisation raisonnable",
  usageSubjectMessages: "les messages",
  usageSubjectCallingMinutes: "les minutes d'appel",
  usageSubjectJoiner: " et ",
  usagePacingHeadline:
    "Un avertissement précoce : {subjects} dépassent le rythme de ce que " +
    "couvre votre forfait.",
  usageUsedBefore: "Vous avez utilisé",
  usageUsedOfYour: "de vos",
  usageIncludedMessages: "messages inclus.",
  usageIncludedMinutes: "minutes d'appel incluses.",
  usageProjectionBefore: "À ce rythme, cela représente environ",
  usageProjectionAfter: "de frais supplémentaires d'ici la fin de la période.",
  usageProjectionUnpriced:
    "À ce rythme, cette période dépasse ce que votre forfait inclut.",
  usageCapProtects:
    "Rien ne peut être facturé au-delà du plafond de dépenses ci-dessous. " +
    "Il est à vous de le fixer.",
  usageCapReachedHeadline: "Votre plafond de dépenses fait son travail.",
  usageCapNearHeadline: "Vous approchez de votre plafond de dépenses.",
  usageMeterMessages: "Les messages sont",
  usageMeterCalling: "Les minutes d'appel sont",
  usageMeterAt: "à",
  usageMeterOfThe: "des",
  usageMeterYouAllowed: "que vous avez autorisés",
  usagePauseSendingReached:
    "Les envois sont suspendus jusqu'à ce que vous releviez le plafond ou que " +
    "la période se renouvelle. Les textos entrants arrivent toujours, " +
    "gratuitement.",
  usagePauseSendingAhead:
    "Au plafond, les envois s'arrêtent au lieu de continuer à être facturés. " +
    "Les textos entrants arrivent toujours, gratuitement.",
  usagePauseCallingReached:
    "Les appels sont suspendus jusqu'à ce que vous releviez le plafond ou que " +
    "la période se renouvelle. Les appelants manqués reçoivent toujours votre " +
    "texto de rappel.",
  usagePauseCallingAhead:
    "Au plafond, les appels s'arrêtent au lieu de continuer à être facturés. " +
    "Les appelants manqués reçoivent toujours votre texto de rappel.",
  usageCapAdjustable:
    "Rien n'est facturé au-delà du plafond. Vous pouvez le relever ou " +
    "l'abaisser ci-dessous à tout moment.",
  usageDeliveryTitle: "Vos textos arrivent-ils ?",
  usageDeliveryDescription:
    "Livraison rapportée par les fournisseurs pour cette période. Un " +
    "fournisseur qui confirme avoir pris le message, ce n'est pas la même " +
    "chose que quelqu'un qui le lit, alors c'est le plus que nous puissions " +
    "honnêtement vous dire.",
  usageDeliveryConfirmed: "{count} livrés confirmés",
  usageDeliveryFailed: "{count} ne sont pas passés",
  usageDeliveryPending: "{count} encore en route",
  usageDeliveryFailureHint:
    "Un texto qui ne passe pas vient habituellement d'un numéro débranché ou " +
    "d'un appareil éteint depuis des jours. Ouvrez la conversation et le " +
    "message lui-même indique ce que le fournisseur a rapporté.",
  usageDeliveryNoBounces: "Rien n'a échoué cette période.",
  usageDeliveryOfTotal: "{delivered} sur {total}",
  usageCountryUs: "États-Unis",
  usageCountryCa: "Canada",
  usageCountryElsewhere: "Ailleurs",
  usageSpendingCapTitle: "Plafond de dépenses",
  usageSpendingCapDescription:
    "Un plafond de dépenses que vous contrôlez. Si un mois devient un jour " +
    "aussi chargé, les envois et les appels s'arrêtent au plafond au lieu " +
    "d'être facturés au-delà de ce que vous avez autorisé.",
  usageExportTitle: "Exporter l'utilisation",
  usageExportDescription:
    "Emportez les textos, les appels et le stockage d'une période sous forme " +
    "de fichier.",
  usageShowNumbers: "Afficher les chiffres",
  usageHideNumbers: "Masquer les chiffres",
  usageThisPeriod: "Cette période",
  usagePeriodRange: "Du {start} au {end}",
  usageMessagesLabel: "Messages :",
  usageSentOf: "envoyés sur",
  usageIncludedSuffix: "inclus.",
  usagePastIncluded: "au-delà des inclus jusqu'ici,",
  usageAtOverageRate: "au tarif de dépassement.",
  usageSendingPausesAt: "Les envois s'arrêtent à",
  usageMessagesWord: "messages",
  usageCapIsMaximum: ", le maximum, soit 10 fois vos messages inclus.",
  usageCapIsYours: ", le plafond que vous avez fixé.",
  usageMessagesReceived: "messages reçus, toujours gratuits.",
  usageCallingLabel: "Appels :",
  usageOf: "sur",
  usageIncludedMinutesUsed: "minutes incluses utilisées, dans les deux sens.",
  usageExtraMinutes: "minutes supplémentaires jusqu'ici, à 1 ¢ chacune.",
  usageCallingPausesAt: "Les appels s'arrêtent à",
  usageMinutesSameCap: "minutes, le même plafond.",
  usageLouTitle: "Lou ce mois-ci",
  usageLouDescription:
    "Ce que Lou a rédigé, rempli et transcrit. Chaque compteur se remet à " +
    "zéro le 1er.",
  usageLastSixMonths: "6 derniers mois",
  usageLastSixMonthsDescription: "Messages sortants par mois civil.",
  usageHistoryAria: "Messages envoyés par mois : {months}.",
  usageCountingTitle: "Comment les messages sont comptés",
  usageCountingBody:
    "Les textos sont comptés en segments. Un texto simple tient dans 160 " +
    "caractères par segment ; les textos avec émojis tiennent dans 70 ; les " +
    "textos plus longs en utilisent plus d'un. Un message avec photo compte " +
    "pour 3. Les textos entrants sont toujours gratuits et ne comptent pas.",

  // ── Paramètres › Espace de travail ────────────────────────────────────────
  workspaceTitle: "Espace de travail",
  workspaceDescription:
    "Votre entreprise telle que la voient vos clients et les fournisseurs.",
  workspaceLoading: "Chargement des paramètres de l'espace de travail",
  workspaceNameRequired: "Entrez le nom de votre entreprise.",
  workspaceNameTooLong: "Gardez-le sous {max} caractères.",
  workspaceNameTitle: "Nom de l'entreprise",
  workspaceNameDescription:
    "Le nom sous lequel vos clients vous connaissent, utilisé sur votre " +
    "inscription auprès des fournisseurs et offert comme champ " +
    "{business_name} dans vos textos.",
  workspaceNameSaved: "Nom de l'entreprise enregistré.",
  workspaceNameSaveFailed: "Impossible d'enregistrer le nom. Réessayez.",
  workspaceRenameOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent renommer l'espace " +
    "de travail.",
  workspaceIdentityTitle: "Identification de l'entreprise",
  workspaceIdentityDescription:
    "Ce que les fournisseurs ont au dossier pour votre entreprise. Cela vient " +
    "de votre inscription pour les textos.",
  workspaceNoRegistrationNeeded:
    "Aucune inscription nécessaire. La messagerie canadienne fonctionne sans " +
    "inscription. Activer la messagerie américaine en ajoute une.",
  workspaceNoRegistrationYet: "Aucun détail d'inscription au dossier pour l'instant.",
  workspaceSeeRegistration: "Voir l'inscription",
  workspaceLegalName: "Dénomination légale",
  workspaceIdSsn: "NAS américain (4 derniers)",
  workspaceIdSin: "NAS (4 derniers)",
  workspaceIdEin: "EIN",
  workspaceIdBusinessNumber: "Numéro d'entreprise",
  workspaceAddress: "Adresse",
  workspaceWebsite: "Site Web",
  workspaceContact: "Contact",
  workspaceRegistrationSummary:
    "L'inscription est {status}. Les propriétaires et les administrateurs " +
    "peuvent voir tous les détails.",
  workspaceRegistrationApproved: "approuvée",
  workspaceRegistrationOnFile: "au dossier",
  workspaceNeedChange: "Besoin de changer quelque chose ?",
  workspaceManageRegistration: "Gérer l'inscription",
  workspaceTimezoneTitle: "Fuseau horaire",
  workspaceTimezoneDescription:
    "Les dates dans les courriels au sujet de votre espace de travail sont " +
    "exprimées à l'heure locale de votre entreprise.",
  workspaceTimezoneSaved: "Fuseau horaire enregistré.",
  workspaceTimezoneSaveFailed:
    "Impossible d'enregistrer le fuseau horaire. Réessayez.",
  workspaceLocalTimeNote:
    "Il est {time} à {timezone} en ce moment. Les heures de silence pour les " +
    "textos utilisent toujours l'heure locale de chaque client, pas celle-ci.",
  workspaceTimezoneOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier le " +
    "fuseau horaire.",
  workspaceSignTitle: "Signer vos textos",
  workspaceSignDescription:
    "Ajouter le nom de votre entreprise au premier texto que vous envoyez à " +
    "quelqu'un, pour qu'un message venant d'un numéro inconnu dise de qui il " +
    "vient.",
  workspaceSignLabel: "Signer le premier texto à un nouveau client",
  workspaceSignBody:
    "Une fois par client. Les réponses et les textos suivants ne sont jamais " +
    "signés.",
  workspaceSignPreviewLabel: "Ce qui est ajouté",
  workspaceSignLengthNote:
    "Cela fait {length} caractères, donc un premier texto long peut être " +
    "envoyé en deux parties au lieu d'une.",
  workspaceSignOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier la " +
    "façon dont les textos sont signés.",
  workspaceNightTitle: "Texter un nouveau client le soir",
  workspaceNightDescription:
    "Commencer une toute nouvelle conversation entre 20 h et 8 h, à l'heure " +
    "du client, vous demande d'abord de confirmer.",
  workspaceNightLabel: "Me demander de confirmer",
  workspaceNightBody:
    "Seulement quand c'est vous qui commencez la conversation. Répondre à un " +
    "client qui vous a texté ou appelé n'est jamais interrompu.",
  workspaceNightOffConsequence:
    "On ne vous demandera rien. Un texto que vous commencez à 2 h part " +
    "directement, et il vous revient de juger que le client voulait avoir de " +
    "vos nouvelles à ce moment-là.",
  workspaceNightOffBoundary:
    "Cela ne change rien aux textos automatiques. Les rappels et tout ce que " +
    "nous envoyons en votre nom attendent toujours le matin du client, quel " +
    "que soit ce réglage.",
  workspaceNightOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier ceci.",
};
