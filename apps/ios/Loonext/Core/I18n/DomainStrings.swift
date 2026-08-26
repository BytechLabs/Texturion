import Foundation

/// #228 — the words the DOMAIN says: the sentences that live in `Core/`, away
/// from any one screen.
///
/// ## Why these were the last English left, and the hardest to see
///
/// Every other section in this catalogue was extracted from a screen. These
/// were not on a screen. They are in `Core/Model`, `Core/OnCall.swift`,
/// `Core/ScheduledSend.swift` and their neighbours — hand-ports of
/// `packages/shared` modules that decide what a carrier rejection MEANS, why a
/// scheduled text did not go, what a member is allowed to reach on a number.
/// The copy was deliberately lifted out of the views so that three clients
/// would say one thing, and lifting it out is exactly what hid it from a
/// view-shaped scanner for months.
///
/// ## Where the keys and the French came from
///
/// Both are COPIED, key for key and character for character, from Android's
/// `core/i18n/DomainStrings.kt`, which extracted the same twenty-one hand-ports
/// first. Not laziness — it is the parity guarantee. The same sentence must
/// reach the same key on both phones, or the two clients drift and the
/// cross-client comparisons stop meaning anything. Two clients each having a go
/// at "Carriers blocked this as spam" is how a product ends up with two names
/// for one failure, and the person who notices is the crew member holding both.
///
/// Two runs of Android's section are deliberately NOT here: `domain.catchUp*`
/// and `domain.locale*`. Those sentences live in `Features/` on this client
/// rather than in `Core/`, so they belong to whichever section extracts the
/// screen that says them. A key defined twice is silently won by whichever
/// section is registered last, which `AppStringsTests` fails on by design.
///
/// The register is the one the rest of the catalogue uses: Quebec French,
/// VOUVOIEMENT, accents spelled normally, and the vocabulary held steady with
/// the other two clients — texto, conversation, client, équipe, espace de
/// travail, numéro, tâche, paramètres, boîte de réception, and **fournisseurs**
/// for the carriers.
///
/// Never translated, in either direction: the product names (Loonext, Lou,
/// Telnyx, Stripe), the platform, and the carrier keywords — a customer texts
/// STOP in Montreal exactly as they do in Denver, because it is the carrier
/// that reads it and not us.
///
/// ## How these reach a reader
///
/// Nothing in `Core/` has an `@Environment(\.appLocale)` to read: these are
/// plain `enum` namespaces whose constants are built at type-init, before any
/// view exists. So every sentence here is reached the way `AppLock.headline`
/// already is — the pure function takes `locale` as a LAST, DEFAULTED parameter
/// and resolves the key itself.
///
/// Defaulted, and that is the load-bearing half. It keeps every existing call
/// site compiling untouched and rendering exactly what it rendered before,
/// rather than a bare key; and it leaves the hand-port tests that pin the
/// ENGLISH against `packages/shared` — `TwoClocksTests`, `ReferralShareTests`,
/// `WorkPhaseTests`, `ScheduledSendTests` — asserting the same sentences they
/// always did. A screen that knows its reader passes `appLocale`; one that does
/// not yet gets English, which is what everybody had before this existed.
///
/// The old `static let` constants are kept as computed `static var`s over the
/// same keys, for the same reason: a settings screen reading `OnCall.quietOff`
/// keeps working, and moves to the locale-taking twin beside it when its own
/// extraction reaches it.
///
/// ## The tagline rule
///
/// `domain.referralNote` is the one string in this file a stranger reads before
/// they have ever heard of us, and it is load-bearing: a crew can run SEVERAL
/// numbers, so the claim is "one INBOX", never "one number". The French keeps
/// the inbox singular for the same reason. `ReferralShareTests` asserts the
/// English against `packages/shared/src/referral-share.ts` character for
/// character, which is why the English here is a copy rather than a rewrite.
enum DomainStrings {
    static let section = AppStrings.Section(
        name: "DomainStrings",
        en: [
            // ── What a caller said, pulled out of a voicemail (#367) — Model/Calls.swift ───
            "domain.voicemailIntakeSource": "From the voicemail",
            "domain.voicemailIntakeProblem": "Problem",
            "domain.voicemailIntakeAddress": "Address",
            "domain.voicemailIntakeCallback": "Call back",
            "domain.voicemailIntakeName": "Name",
            // ── Whose clock a contact is on (#539) — Model/Contacts.swift ───────────
            "domain.contactClockSetByCrew": "Set by your crew",
            "domain.contactClockFromAreaCode": "From their area code",
            "domain.contactClockUnknown": "Their area code doesn't say — using your timezone",
            // ── Numbers on the account this reader cannot see (#286) — Model/HiddenNumbersNotice.swift ───
            "domain.hiddenNumbersOne":
                "One more number is on this account that is not shared with you. Ask "
                + "an owner if you need it.",
            "domain.hiddenNumbersMany":
                "{count} more numbers are on this account that are not shared with "
                + "you. Ask an owner if you need them.",
            // ── Why a thread survived a spam mark (#250) — Model/Home.swift ─────────
            "domain.spamWhyTexted": "You texted them before this was marked",
            "domain.spamWhySustained": "Still texting, over several days",
            "domain.spamWhyCount": "{count} messages since it was marked",
            // ── What one member reaches on a number, and why (#348/#286) — Model/NumberAccessExplained.swift ───
            "domain.numberAccessCanText": "Can text",
            "domain.numberAccessNoteOnly": "Read and notes only",
            "domain.numberAccessHidden": "Hidden",
            "domain.numberAccessRuleNamingYou": "A rule naming you",
            "domain.numberAccessRuleNamingThem": "A rule naming them",
            "domain.numberAccessRuleForRole": "A rule for {role}s",
            "domain.numberAccessRuleForYourRole": "A rule for your role",
            "domain.numberAccessRuleForTheirRole": "A rule for their role",
            "domain.numberAccessRuleForEveryone": "A rule for everyone",
            "domain.numberAccessNoMatchYou":
                "This number has rules, and none of them include you",
            "domain.numberAccessNoMatchThem":
                "This number has rules, and none of them include them",
            "domain.numberAccessUnruled": "Nobody has restricted this number",
            "domain.numberAccessOwners": "Owners reach every number",
            "domain.numberAccessAdmins": "Admins reach every number",
            "domain.numberAccessNotMemberYou": "You are no longer in this workspace",
            "domain.numberAccessNotMemberThem": "No longer in this workspace",
            "domain.numberAccessSelfHiddenOne": "{count} number is hidden from you",
            "domain.numberAccessSelfHiddenMany": "{count} numbers are hidden from you",
            "domain.numberAccessSelfReadOnlyOne": "{count} is read-only",
            "domain.numberAccessSelfReadOnlyMany": "{count} are read-only",
            "domain.numberAccessSelfNote":
                "{parts}. That is deliberate — somebody set it up that way, and it is "
                + "not the app failing. Ask an owner or admin if you need more.",
            // ── How far the texting registration has got (#352) — Model/RegistrationProgress.swift ───
            "domain.regStageNeedsDetailsTitle": "We need a few business details",
            "domain.regStageNeedsDetailsNext":
                "Finish the texting registration form and we'll send it on.",
            "domain.regStageSubmittingTitle": "Sent to the carriers",
            "domain.regStageSubmittingNext":
                "The carriers review it next. Nothing needed from you.",
            "domain.regStageExpected": "Usually 3–7 business days, sometimes longer",
            "domain.regStageUnderReviewTitle": "Under review by the carriers",
            "domain.regStageUnderReviewNext": "We'll text and email you the moment it clears.",
            "domain.regStageApprovedTitle": "Your texting is live",
            "domain.regStageApprovedNext": "You can text customers now.",
            "domain.regStageRejectedTitle": "The carriers need something changed",
            "domain.regStageRejectedNext":
                "Check the details on your registration and resubmit.",
            // ── A carrier rejection, in words to act on (#352) — Model/RejectionGuidance.swift ───
            "domain.rejectRegEinWhat":
                "The tax ID you gave does not match what the government registry "
                + "holds for your business.",
            "domain.rejectRegEinFix":
                "Check the EIN or business number on a tax document and enter it "
                + "exactly, digits only.",
            "domain.rejectRegNameWhat":
                "The business name you gave does not match the one on your government "
                + "registration.",
            "domain.rejectRegNameFix":
                "Use the exact legal name from your registration paperwork, including "
                + "any Ltd, Inc or LLC — the name customers see is set separately.",
            "domain.rejectRegAddressWhat":
                "The business address does not match the one on your government "
                + "registration.",
            "domain.rejectRegAddressFix":
                "Enter the registered business address rather than a mailing or "
                + "job-site address.",
            "domain.rejectRegWebsiteWhat":
                "The carrier could not confirm your business from the website you "
                + "gave.",
            "domain.rejectRegWebsiteFix":
                "Give a website that names your business and describes what you do, "
                + "and make sure it loads publicly.",
            "domain.rejectRegConsentWhat":
                "The carrier was not satisfied that customers agree to be texted "
                + "before you text them.",
            "domain.rejectRegConsentFix":
                "Describe exactly where a customer gives you their number and what "
                + "they are told at that moment.",
            "domain.rejectRegSampleWhat":
                "The sample texts did not show the carrier what you actually send.",
            "domain.rejectRegSampleFix":
                "Use real messages you would send a customer, and include your "
                + "business name in each one.",
            "domain.rejectRegUseCaseWhat":
                "The use case you picked does not match what your samples and website "
                + "describe.",
            "domain.rejectRegUseCaseFix":
                "Pick the category that matches the texts you actually send to "
                + "customers.",
            "domain.rejectRegDuplicateWhat":
                "This business is already registered with the carriers, most likely "
                + "by a provider you used before.",
            "domain.rejectRegDuplicateFix":
                "Reply to us and we will get the existing registration released or "
                + "transferred — this is not something the form can fix.",
            "domain.rejectRegEntityWhat":
                "The business type you chose does not match how your business is "
                + "registered.",
            "domain.rejectRegEntityFix":
                "Choose the type that matches your paperwork — a sole trader and a "
                + "limited company are registered differently.",
            "domain.rejectRegContactWhat":
                "The carrier could not reach the contact details on the registration.",
            "domain.rejectRegContactFix":
                "Give a business email and phone number that reach a person and are "
                + "not auto-replied.",
            "domain.rejectPortAccountWhat":
                "The account number does not match the one your current provider has "
                + "on file.",
            "domain.rejectPortAccountFix":
                "Copy it from a recent bill from that provider — it is usually not "
                + "the phone number itself.",
            "domain.rejectPortPinWhat": "The transfer PIN was missing or wrong.",
            "domain.rejectPortPinFix":
                "Ask your current provider for a port-out PIN — most will only give "
                + "it to the account holder, and it often expires within a few days.",
            "domain.rejectPortAuthWhat":
                "The person named on the request is not authorised on the account.",
            "domain.rejectPortAuthFix":
                "Use the name of the person your current provider has as the account "
                + "holder, spelled the same way.",
            "domain.rejectPortEntityWhat":
                "The account holder name does not match your current provider's "
                + "records.",
            "domain.rejectPortEntityFix":
                "Use the name exactly as it appears on the bill, including any Ltd, "
                + "Inc or LLC.",
            "domain.rejectPortAddressWhat":
                "The service address does not match the one your current provider has "
                + "on file.",
            "domain.rejectPortAddressFix":
                "Use the address on the bill for this line, even if the business has "
                + "since moved.",
            "domain.rejectPortPendingWhat":
                "Your current provider has another change in progress on this line.",
            "domain.rejectPortPendingFix":
                "Ask them to cancel or finish it, then tell us and we will resubmit.",
            "domain.rejectPortInactiveWhat":
                "Your current provider says this number is not active on the account "
                + "we asked about.",
            "domain.rejectPortInactiveFix":
                "Check the number is still in service and on the account you gave us "
                + "— a number already cancelled cannot be moved.",
            "domain.resubmitWaitRegistration":
                "Most resubmissions are decided within a business day or two.",
            "domain.resubmitWaitPort":
                "Most resubmitted transfers are accepted within a few business days.",
            // ── Why a text did not arrive (#241) — Model/SendFailures.swift ─────────
            "domain.sendFailureGeneric": "Not delivered",
            "domain.sendFailureOptedOut": "This customer opted out",
            "domain.sendFailureUnreachable": "That number can't receive texts",
            "domain.sendFailureNotTextable": "That number isn't textable",
            "domain.sendFailureBlockedNow": "Carriers are blocking this right now",
            "domain.sendFailureSpam": "Carriers blocked this as spam",
            "domain.sendFailureRateLimited": "Sent too fast for carriers. Try again shortly",
            "domain.sendFailureHandsetRejected": "Their phone rejected it",
            "domain.sendFailureHandsetUnavailable": "Their phone couldn't receive it",
            "domain.sendFailureExpired": "It expired before it could send",
            "domain.sendFailureContent": "Carriers wouldn't accept this message",
            "domain.sendFailureEmpty": "There was nothing to send",
            "domain.sendFailureAttachment": "Carriers wouldn't accept that attachment",
            "domain.sendFailureTooLong": "Too long to send",
            "domain.sendFailureRegistration": "Your US texting registration isn't approved yet",
            "domain.sendFailureNumberNotReady": "This number isn't set up for texting yet",
            "domain.sendFailureTextingOff": "Texting is turned off for this number",
            "domain.sendFailureNoSms": "This number can't send texts",
            "domain.sendFailureNoMms": "This number can't send pictures",
            // ── Where Lou read an address, and why a draft is missing (#214/#581) — Model/AiEnrichment.swift ───
            "domain.addrFromMessage": "From the message",
            "domain.addrFromContact": "From the contact",
            "domain.addrFromAreaCode": "Inferred from area code",
            "domain.draftsDisabled":
                "Drafting is turned off for this workspace. Settings, AI turns it "
                + "back on.",
            "domain.draftsSpam":
                "This thread is marked as spam, so Lou skips it. Unmark it to draft a "
                + "reply.",
            "domain.draftsNothingToReply":
                "Nothing to draft from yet. Type a few words and try again.",
            "domain.draftsOverCap":
                "This month's drafting is used up. It starts again next month.",
            "domain.draftsRateLimited":
                "That was a lot of drafts at once. Try again in a moment.",
            "domain.draftsUnusable":
                "Nothing came back worth sending. Try again, or add a few words "
                + "first.",
            "domain.draftsNone": "No drafts this time. Try again.",
            "domain.louUnreachable": "Couldn't reach Lou just now. Try again.",
            "domain.louPausedForBilling":
                "Lou is paused while the subscription is sorted out. An owner can fix "
                + "that in Billing.",
            // ── Who is holding the phone tonight (#244/#297) — OnCall.swift ─────────
            "domain.onCallPresetTonight": "Tonight",
            "domain.onCallPresetTonightDetail": "6pm until 8am tomorrow",
            "domain.onCallPresetWeekend": "This weekend",
            "domain.onCallPresetWeekendDetail": "Friday 6pm until Monday 8am",
            "domain.onCallPresetWeek": "The next 7 days",
            "domain.onCallPresetWeekDetail": "Starting now",
            "domain.onCallNobody":
                "Nobody is on call, so an after-hours call wakes everyone who can see "
                + "the number. Put one person on and the rest get a quiet night.",
            "domain.onCallUntil": "on call until",
            "domain.onCallLine": "{name} is on call until {until}",
            "domain.onCallEscalation":
                "If they do not pick it up, everyone else is told a few minutes "
                + "later.",
            "domain.onCallReadOnly": "Only an owner or admin can change who is on call.",
            "domain.onCallBannerWaiting": "Nobody has picked this up yet",
            "domain.onCallBannerClaim": "I have this",
            "domain.onCallBannerTaken": "has this",
            "domain.onCallTakenLine": "{name} has this",
            "domain.onCallBannerYours": "You have this. The rest of the crew has been told.",
            "domain.quietHoursHeading": "Quiet hours",
            "domain.quietHoursReassurance":
                "Your phone stays quiet for ordinary messages. If you are on call, or "
                + "an alert nobody picked up widens to the crew, it still comes "
                + "through.",
            "domain.quietHoursOff": "Off — every notification reaches you at any hour.",
            "domain.quietHoursOn": "Quiet from",
            "domain.quietHoursLine": "Quiet from {from} to {to}",
            "domain.quietHoursScope": "This applies to this workspace only.",
            "domain.deliveryHeading": "How much we tell you",
            "domain.deliveryUrgentAlways":
                "An emergency, a page while you are on call, or an alert nobody "
                + "picked up always arrives straight away, whatever you choose here.",
            "domain.deliveryImmediate": "Straight away",
            "domain.deliveryBatched": "Grouped up",
            "domain.deliverySummary": "Once a day",
            "domain.deliverySummaryDetail": "Held for your daily summary, not discarded.",
            "domain.categoryMessagesMine": "Texts on my jobs",
            "domain.categoryMessagesAll": "Texts on anyone's jobs",
            "domain.categoryMentions": "When somebody @s me",
            "domain.categoryAssignments": "Work handed to me",
            "domain.categoryMissedCalls": "Missed calls",
            "domain.categoryVoicemails": "Voicemails",
            // ── Silencing a channel while on call (#244) — OnCallSilence.swift ──────
            "domain.onCallSilenceConfirm": "Turn it off anyway",
            "domain.onCallSilenceCancel": "Leave it on",
            "domain.onCallSilenceChannelPush": "Push alerts",
            "domain.onCallSilenceChannelEmail": "Emails",
            "domain.onCallSilenceWarning":
                "You're on call right now. {what} are how a new customer nobody has "
                + "answered reaches you, and with this off those pages go nowhere — no "
                + "one else is told. Hand the shift over first if you need to be "
                + "unreachable.",
            // ── Send later, and why one did not go (#233) — ScheduledSend.swift ─────
            "domain.scheduledHoldSubscriptionInactive":
                "Your subscription has lapsed, so this has not been sent. It will go "
                + "out when billing is sorted.",
            "domain.scheduledHoldWorkspacePaused":
                "Your plan is paused, so this has not been sent. It will go out when "
                + "you resume.",
            "domain.scheduledHoldRegistrationPending":
                "This is waiting on carrier approval for US texting. It will send "
                + "once that clears.",
            "domain.scheduledHoldServiceUnavailable":
                "Texting is paused while we deal with an issue. This is still queued "
                + "and nothing was lost.",
            "domain.scheduledHoldCalendarUnverified":
                "Calendar sync is disconnected or has not checked in recently, so this "
                + "reminder is waiting. It will send after sync is verified again.",
            "domain.scheduledHoldCustomerReplied":
                "They replied after you scheduled this, so we held it rather than "
                + "talk over them. Send it anyway, or cancel it.",
            "domain.scheduledHoldOptedOut":
                "They replied STOP after you scheduled this, so it was not sent. Only "
                + "they can undo that.",
            "domain.scheduledHoldInvalidDestination":
                "We cannot text this number any more, so this was not sent.",
            "domain.scheduledHoldExpired":
                "The send window passed before this could go, so it was not sent. A "
                + "late message is usually worse than none.",
            "domain.scheduledHoldWorkspaceClosed":
                "The workspace was closed before this was due to send.",
            "domain.scheduledHoldJobUnscheduled":
                "That job is no longer booked, so this reminder was not sent.",
            "domain.scheduledPickerReassurance":
                "You can change or cancel it any time before it goes.",
            "domain.scheduledQuietHoursChoice":
                "You can send it anyway, or pick a time in their morning.",
            "domain.scheduledQuietHoursUnknown":
                "That time is inside this customer's quiet hours.",
            "domain.scheduledCancelled": "Cancelled — that text will not go out.",
            "domain.scheduledNothingWaiting":
                "Nothing is waiting to send. Anything you schedule shows up here.",
            "domain.clockTheirTimeContact": "their time, set on their contact",
            "domain.clockTheirTimeAreaCode": "their time, from their area code",
            "domain.clockWorkspaceTime": "your workspace's time — we don't know theirs",
            "domain.scheduledPresetTomorrow": "Tomorrow, 8:00am",
            // #228 — the relationship line and its months.
            "domain.monthJanuary": "January",
            "domain.monthFebruary": "February",
            "domain.monthMarch": "March",
            "domain.monthApril": "April",
            "domain.monthMay": "May",
            "domain.monthJune": "June",
            "domain.monthJuly": "July",
            "domain.monthAugust": "August",
            "domain.monthSeptember": "September",
            "domain.monthOctober": "October",
            "domain.monthNovember": "November",
            "domain.monthDecember": "December",
            "domain.contactSince": "Customer since {since} · {conversations}",
            "domain.contactConversationOne": "1 conversation",
            "domain.contactConversationMany": "{count} conversations",
            "domain.scheduledPresetMonday": "Monday, 8:00am",
            "domain.scheduledPresetCustom": "Pick a time",
            // ── Recommending us to another crew (#288) — ReferralShare.swift ────────
            "domain.referralNote":
                "We run our business line through Loonext — calls and texts land in "
                + "one inbox and whoever's free answers. Flat price, no per-seat fee. "
                + "Sign up with my link and we both get a free month.",
            "domain.referralTitle": "Refer another crew",
            "domain.referralRewardLine":
                "Send this to another business. When they sign up and a customer "
                + "texts them back, you both get a month free",
            "domain.referralStageInvited": "Signed up, no replies yet",
            "domain.referralStageSignedUp": "Up and running",
            "domain.referralStageActive": "Still going after 30 days",
            "domain.referralStageRewarded": "Free month applied",
            "domain.referralStageVoided": "Not counted",
            "domain.referralAction": "Share",
            "domain.referralCopy": "Copy",
            "domain.referralCopied": "Copied",
            "domain.referralDraftLabel": "Your message",
            "domain.referralLinkNote": "Your link goes on the end automatically.",
            "domain.referralAskBody":
                "Know another crew still running their business off one person's "
                + "cell? Send them your link — you both get a free month.",
            "domain.referralAskAction": "Share your link",
            "domain.referralAskDismiss": "Not now",
            "domain.referralCodeFallback": "Use my code {code} when you sign up.",
            "domain.referralAskHeadlineOne": "You replied to 1 customer this month.",
            "domain.referralAskHeadlineMany": "You replied to {count} customers this month.",
            // ── The measures on the For You tab (#268) — DashboardPanels.swift ──────
            "domain.panelResponseTime": "Response time",
            "domain.panelPipeline": "Quotes",
            "domain.panelSatisfaction": "Satisfaction",
            "domain.panelLeadSources": "Where your customers come from",
            "domain.panelRecentCalls": "Recent calls",
            "domain.panelResponseTimeNote": "How fast new customers got an answer this week.",
            "domain.panelPipelineNote":
                "What you quoted this month, and how much of it landed.",
            "domain.panelSatisfactionNote": "Whether the people you answered were happy.",
            "domain.panelLeadSourcesNote": "Which channels are actually bringing work in.",
            "domain.panelRecentCallsNote": "The last few calls, in and out.",
            // ── Proving it is you before handing the workspace over — HandoverConfirmation.swift ───
            "domain.handoverTitle": "Confirm it's you",
            "domain.handoverWhereAuthenticator":
                "Open your authenticator app and enter the six-digit code it shows.",
            "domain.handoverWhereEmail":
                "We've emailed a six-digit code to the address on your account. It "
                + "works once, and expires in ten minutes.",
            "domain.handoverField": "Six-digit code",
            "domain.handoverSubmit": "Confirm",
            "domain.handoverResend": "Send it again",
            "domain.handoverRejected":
                "That code didn't work. Ask for a new one and try again.",
            // ── An arrow and a circle on a photo — PhotoMarkup.swift ────────────────
            "domain.markupArrow": "Arrow",
            "domain.markupCircle": "Circle",
            "domain.markupHint": "Drag on the photo, or tap twice, to point at something.",
            "domain.markupHintSecondTap": "Now tap where it should point.",
            "domain.markupSave": "Done",
            "domain.markupUndo": "Undo",
            // ── Before and after, on a job's photos — WorkPhase.swift ───────────────
            // #228 — the on-my-way control.
            "domain.onMyWayAction": "On my way",
            "domain.onMyWayPrompt": "How long?",
            "domain.onMyWayGatedNote": "Sends straight away, and follows the same rules as any text.",
            "domain.workPhaseBefore": "Before",
            "domain.workPhaseAfter": "After",
            "domain.workPhaseUnset": "Not a before or after",
            "domain.workPhaseHint":
                "Marks these photos as how it looked when you arrived, or how you "
                + "left it.",
            "domain.jobPhaseCountBefore": "{count} before",
            "domain.jobPhaseCountAfter": "{count} after",
            // ── When “later” is (#293) — SnoozeLogic.swift ──────────────────────────
            "domain.snoozePresetAfternoon": "This afternoon",
            "domain.snoozePresetEvening": "This evening",
            "domain.snoozePresetTomorrow": "Tomorrow morning",
            "domain.snoozePresetNextWeek": "Next week",
            "domain.followUpPresetThreeDays": "In 3 days",
            "domain.followUpPresetTwoWeeks": "In 2 weeks",
            "domain.snoozeFallback": "Snoozed",
            "domain.snoozeBackAt": "Back at {time}",
            "domain.snoozeBackTomorrow": "Back tomorrow, {time}",
            "domain.snoozeBackWeekday": "Back {day}, {time}",
            "domain.snoozeBackDate": "Back {date}",
            // ── How long before an appointment to remind — AppointmentReminders.swift ───
            "domain.reminderOffsetDayBefore": "The day before",
            "domain.reminderOffsetDays": "{count} days before",
            "domain.reminderOffsetHour": "1 hour before",
            "domain.reminderOffsetHours": "{count} hours before",
            "domain.reminderOffsetMinutes": "{count} minutes before",
            // ── One instant, two wall clocks (#539) — TwoClocks.swift ───────────────
            "domain.twoClocksThere": "their time",
            "domain.twoClocksHere": "yours",
            "domain.twoClocksLine": "{there} their time · {here} yours",
            "domain.twoClocksSpoken": "{there} their time, which is {here} yours",
            "domain.twoClocksAreaCodeNote":
                "The rules about when you may text go by their clock, not yours. If "
                + "this number moved, set their timezone on the contact.",
            "domain.twoClocksChoiceTheirs": "Their time",
            "domain.twoClocksChoiceYours": "Your time",
            // ── Taking your own access away (#315) — SelfDowngrade.swift ────────────
            "domain.capBilling": "the plan and billing",
            "domain.capSettings": "workspace settings",
            "domain.capTeam": "who is on the team and what they can do",
            "domain.capNumbers": "phone numbers",
            "domain.capHistory": "the history log",
            "domain.capContactsBulk": "importing and exporting customers",
            "domain.selfDowngradeSomeOfWhat": "some of what you can do now",
            "domain.selfDowngradeListPair": "{first} and {last}",
            "domain.selfDowngradeMore": "{list}, and {count} more",
            "domain.selfDowngradeUndo": " You won't be able to change it back yourself — only an owner can.",
            "domain.selfDowngradeWarning": "You'll lose access to {scope}.{undo}",
            "domain.and": "and",
        ],
        frCA: [
            // ── What a caller said, pulled out of a voicemail (#367) — Model/Calls.swift ───
            "domain.voicemailIntakeSource": "Tiré du message vocal",
            "domain.voicemailIntakeProblem": "Problème",
            "domain.voicemailIntakeAddress": "Adresse",
            "domain.voicemailIntakeCallback": "Rappeler",
            "domain.voicemailIntakeName": "Nom",
            // ── Whose clock a contact is on (#539) — Model/Contacts.swift ───────────
            "domain.contactClockSetByCrew": "Défini par votre équipe",
            "domain.contactClockFromAreaCode": "D'après son indicatif régional",
            "domain.contactClockUnknown":
                "Son indicatif régional ne le dit pas — nous utilisons votre fuseau",
            // ── Numbers on the account this reader cannot see (#286) — Model/HiddenNumbersNotice.swift ───
            "domain.hiddenNumbersOne":
                "Un autre numéro se trouve sur ce compte sans être partagé avec vous. "
                + "Demandez-le à un propriétaire si vous en avez besoin.",
            "domain.hiddenNumbersMany":
                "{count} autres numéros se trouvent sur ce compte sans être partagés "
                + "avec vous. Demandez-les à un propriétaire si vous en avez besoin.",
            // ── Why a thread survived a spam mark (#250) — Model/Home.swift ─────────
            "domain.spamWhyTexted": "Vous leur avez texté avant ce marquage",
            "domain.spamWhySustained": "Textent encore, sur plusieurs jours",
            "domain.spamWhyCount": "{count} messages depuis le marquage",
            // ── What one member reaches on a number, and why (#348/#286) — Model/NumberAccessExplained.swift ───
            "domain.numberAccessCanText": "Peut texter",
            "domain.numberAccessNoteOnly": "Consultation et notes seulement",
            "domain.numberAccessHidden": "Masqué",
            "domain.numberAccessRuleNamingYou": "Une règle qui vous nomme",
            "domain.numberAccessRuleNamingThem": "Une règle qui nomme cette personne",
            "domain.numberAccessRuleForRole": "Une règle pour le rôle {role}",
            "domain.numberAccessRuleForYourRole": "Une règle pour votre rôle",
            "domain.numberAccessRuleForTheirRole": "Une règle pour son rôle",
            "domain.numberAccessRuleForEveryone": "Une règle pour tout le monde",
            "domain.numberAccessNoMatchYou": "Ce numéro a des règles, et aucune ne vous inclut",
            "domain.numberAccessNoMatchThem":
                "Ce numéro a des règles, et aucune n'inclut cette personne",
            "domain.numberAccessUnruled": "Personne n'a restreint ce numéro",
            "domain.numberAccessOwners": "Les propriétaires peuvent utiliser tous les numéros",
            "domain.numberAccessAdmins":
                "Les administrateurs peuvent utiliser tous les numéros",
            "domain.numberAccessNotMemberYou":
                "Vous ne faites plus partie de cet espace de travail",
            "domain.numberAccessNotMemberThem": "Ne fait plus partie de cet espace de travail",
            "domain.numberAccessSelfHiddenOne": "{count} numéro vous est masqué",
            "domain.numberAccessSelfHiddenMany": "{count} numéros vous sont masqués",
            "domain.numberAccessSelfReadOnlyOne": "{count} est en consultation seulement",
            "domain.numberAccessSelfReadOnlyMany": "{count} sont en consultation seulement",
            "domain.numberAccessSelfNote":
                "{parts}. C'est voulu — quelqu'un l'a configuré ainsi, et ce n'est "
                + "pas l'application qui fait défaut. Demandez à un propriétaire ou à "
                + "un administrateur s'il vous en faut davantage.",
            // ── How far the texting registration has got (#352) — Model/RegistrationProgress.swift ───
            "domain.regStageNeedsDetailsTitle":
                "Il nous faut quelques renseignements sur l'entreprise",
            "domain.regStageNeedsDetailsNext":
                "Remplissez le formulaire d'inscription aux textos et nous "
                + "l'enverrons.",
            "domain.regStageSubmittingTitle": "Envoyée aux fournisseurs",
            "domain.regStageSubmittingNext":
                "Les fournisseurs l'examinent ensuite. Rien à faire de votre côté.",
            "domain.regStageExpected": "Habituellement de 3 à 7 jours ouvrables, parfois plus",
            "domain.regStageUnderReviewTitle": "En cours d'examen par les fournisseurs",
            "domain.regStageUnderReviewNext":
                "Nous vous écrirons par texto et par courriel dès que ce sera "
                + "approuvé.",
            "domain.regStageApprovedTitle": "Vos textos sont en service",
            "domain.regStageApprovedNext": "Vous pouvez texter vos clients dès maintenant.",
            "domain.regStageRejectedTitle": "Les fournisseurs demandent une correction",
            "domain.regStageRejectedNext":
                "Vérifiez les renseignements de votre inscription et renvoyez-la.",
            // ── A carrier rejection, in words to act on (#352) — Model/RejectionGuidance.swift ───
            "domain.rejectRegEinWhat":
                "Le numéro d'identification fiscale que vous avez donné ne correspond "
                + "pas à ce que le registre gouvernemental détient pour votre "
                + "entreprise.",
            "domain.rejectRegEinFix":
                "Vérifiez l'EIN ou le numéro d'entreprise sur un document fiscal et "
                + "saisissez-le exactement, chiffres seulement.",
            "domain.rejectRegNameWhat":
                "La dénomination sociale que vous avez donnée ne correspond pas à "
                + "celle de votre inscription gouvernementale.",
            "domain.rejectRegNameFix":
                "Utilisez la dénomination sociale exacte figurant sur vos documents "
                + "d'inscription, y compris tout Ltd, Inc ou LLC — le nom que vos "
                + "clients voient se règle séparément.",
            "domain.rejectRegAddressWhat":
                "L'adresse de l'entreprise ne correspond pas à celle de votre "
                + "inscription gouvernementale.",
            "domain.rejectRegAddressFix":
                "Entrez l'adresse d'entreprise inscrite plutôt qu'une adresse postale "
                + "ou de chantier.",
            "domain.rejectRegWebsiteWhat":
                "Le fournisseur n'a pas pu confirmer votre entreprise à partir du "
                + "site web que vous avez donné.",
            "domain.rejectRegWebsiteFix":
                "Donnez un site web qui nomme votre entreprise et décrit ce que vous "
                + "faites, et assurez-vous qu'il s'affiche publiquement.",
            "domain.rejectRegConsentWhat":
                "Le fournisseur n'a pas été convaincu que vos clients acceptent de "
                + "recevoir vos textos avant que vous leur écriviez.",
            "domain.rejectRegConsentFix":
                "Décrivez exactement où un client vous donne son numéro et ce qu'on "
                + "lui dit à ce moment-là.",
            "domain.rejectRegSampleWhat":
                "Les exemples de textos n'ont pas montré au fournisseur ce que vous "
                + "envoyez réellement.",
            "domain.rejectRegSampleFix":
                "Utilisez de vrais messages que vous enverriez à un client, et "
                + "incluez le nom de votre entreprise dans chacun.",
            "domain.rejectRegUseCaseWhat":
                "Le cas d'utilisation que vous avez choisi ne correspond pas à ce que "
                + "décrivent vos exemples et votre site web.",
            "domain.rejectRegUseCaseFix":
                "Choisissez la catégorie qui correspond aux textos que vous envoyez "
                + "réellement à vos clients.",
            "domain.rejectRegDuplicateWhat":
                "Cette entreprise est déjà inscrite auprès des fournisseurs, fort "
                + "probablement par un service que vous utilisiez auparavant.",
            "domain.rejectRegDuplicateFix":
                "Répondez-nous et nous ferons libérer ou transférer l'inscription "
                + "existante — le formulaire ne peut rien y changer.",
            "domain.rejectRegEntityWhat":
                "Le type d'entreprise que vous avez choisi ne correspond pas à la "
                + "façon dont votre entreprise est inscrite.",
            "domain.rejectRegEntityFix":
                "Choisissez le type qui correspond à vos documents — une entreprise "
                + "individuelle et une société par actions ne s'inscrivent pas de la "
                + "même façon.",
            "domain.rejectRegContactWhat":
                "Le fournisseur n'a pas pu joindre les coordonnées inscrites sur la "
                + "demande.",
            "domain.rejectRegContactFix":
                "Donnez un courriel et un numéro de téléphone d'entreprise qui "
                + "joignent une personne et qui ne répondent pas automatiquement.",
            "domain.rejectPortAccountWhat":
                "Le numéro de compte ne correspond pas à celui que votre fournisseur "
                + "actuel a au dossier.",
            "domain.rejectPortAccountFix":
                "Copiez-le sur une facture récente de ce fournisseur — ce n'est "
                + "habituellement pas le numéro de téléphone lui-même.",
            "domain.rejectPortPinWhat": "Le NIP de transfert était absent ou erroné.",
            "domain.rejectPortPinFix":
                "Demandez un NIP de transfert à votre fournisseur actuel — la plupart "
                + "ne le donnent qu'au titulaire du compte, et il expire souvent en "
                + "quelques jours.",
            "domain.rejectPortAuthWhat":
                "La personne nommée sur la demande n'est pas autorisée sur le compte.",
            "domain.rejectPortAuthFix":
                "Utilisez le nom de la personne que votre fournisseur actuel a comme "
                + "titulaire du compte, écrit de la même façon.",
            "domain.rejectPortEntityWhat":
                "Le nom du titulaire du compte ne correspond pas aux dossiers de "
                + "votre fournisseur actuel.",
            "domain.rejectPortEntityFix":
                "Utilisez le nom exactement tel qu'il apparaît sur la facture, y "
                + "compris tout Ltd, Inc ou LLC.",
            "domain.rejectPortAddressWhat":
                "L'adresse de service ne correspond pas à celle que votre fournisseur "
                + "actuel a au dossier.",
            "domain.rejectPortAddressFix":
                "Utilisez l'adresse figurant sur la facture de cette ligne, même si "
                + "l'entreprise a déménagé depuis.",
            "domain.rejectPortPendingWhat":
                "Votre fournisseur actuel a un autre changement en cours sur cette "
                + "ligne.",
            "domain.rejectPortPendingFix":
                "Demandez-lui de l'annuler ou de le terminer, puis dites-le-nous et "
                + "nous renverrons la demande.",
            "domain.rejectPortInactiveWhat":
                "Votre fournisseur actuel indique que ce numéro n'est pas actif sur "
                + "le compte que nous avons cité.",
            "domain.rejectPortInactiveFix":
                "Vérifiez que le numéro est encore en service et rattaché au compte "
                + "que vous nous avez donné — un numéro déjà résilié ne peut pas être "
                + "transféré.",
            "domain.resubmitWaitRegistration":
                "La plupart des renvois sont tranchés en un ou deux jours ouvrables.",
            "domain.resubmitWaitPort":
                "La plupart des transferts renvoyés sont acceptés en quelques jours "
                + "ouvrables.",
            // ── Why a text did not arrive (#241) — Model/SendFailures.swift ─────────
            "domain.sendFailureGeneric": "Non livré",
            "domain.sendFailureOptedOut": "Ce client s'est désabonné",
            "domain.sendFailureUnreachable": "Ce numéro ne peut pas recevoir de textos",
            "domain.sendFailureNotTextable": "Ce numéro n'accepte pas les textos",
            "domain.sendFailureBlockedNow": "Les fournisseurs bloquent ce message en ce moment",
            "domain.sendFailureSpam": "Les fournisseurs l'ont bloqué comme pourriel",
            "domain.sendFailureRateLimited":
                "Envoyé trop vite pour les fournisseurs. Réessayez sous peu",
            "domain.sendFailureHandsetRejected": "Son téléphone l'a refusé",
            "domain.sendFailureHandsetUnavailable": "Son téléphone n'a pas pu le recevoir",
            "domain.sendFailureExpired": "Il a expiré avant de pouvoir partir",
            "domain.sendFailureContent": "Les fournisseurs ont refusé ce message",
            "domain.sendFailureEmpty": "Il n'y avait rien à envoyer",
            "domain.sendFailureAttachment": "Les fournisseurs ont refusé cette pièce jointe",
            "domain.sendFailureTooLong": "Trop long pour être envoyé",
            "domain.sendFailureRegistration":
                "Votre inscription pour les textos américains n'est pas encore "
                + "approuvée",
            "domain.sendFailureNumberNotReady":
                "Ce numéro n'est pas encore configuré pour les textos",
            "domain.sendFailureTextingOff": "Les textos sont désactivés pour ce numéro",
            "domain.sendFailureNoSms": "Ce numéro ne peut pas envoyer de textos",
            "domain.sendFailureNoMms": "Ce numéro ne peut pas envoyer d'images",
            // ── Where Lou read an address, and why a draft is missing (#214/#581) — Model/AiEnrichment.swift ───
            "domain.addrFromMessage": "D'après le message",
            "domain.addrFromContact": "D'après le client",
            "domain.addrFromAreaCode": "Déduite de l'indicatif régional",
            "domain.draftsDisabled":
                "La rédaction est désactivée pour cet espace de travail. Paramètres, "
                + "IA permet de la réactiver.",
            "domain.draftsSpam":
                "Cette conversation est marquée comme indésirable, alors Lou la "
                + "saute. Retirez la marque pour rédiger une réponse.",
            "domain.draftsNothingToReply":
                "Rien à quoi répondre pour l'instant. Écrivez quelques mots et "
                + "réessayez.",
            "domain.draftsOverCap":
                "La rédaction de ce mois-ci est épuisée. Elle reprend le mois "
                + "prochain.",
            "domain.draftsRateLimited":
                "Cela fait beaucoup de propositions d'un coup. Réessayez dans un "
                + "moment.",
            "domain.draftsUnusable":
                "Rien de valable à envoyer n'est revenu. Réessayez, ou ajoutez "
                + "d'abord quelques mots.",
            "domain.draftsNone": "Aucune proposition cette fois-ci. Réessayez.",
            "domain.louUnreachable": "Impossible de joindre Lou pour l'instant. Réessayez.",
            "domain.louPausedForBilling":
                "Lou est en pause le temps de régler l'abonnement. Un propriétaire "
                + "peut corriger cela dans Facturation.",
            // ── Who is holding the phone tonight (#244/#297) — OnCall.swift ─────────
            "domain.onCallPresetTonight": "Ce soir",
            "domain.onCallPresetTonightDetail": "De 18 h à 8 h demain",
            "domain.onCallPresetWeekend": "Cette fin de semaine",
            "domain.onCallPresetWeekendDetail": "Du vendredi 18 h au lundi 8 h",
            "domain.onCallPresetWeek": "Les 7 prochains jours",
            "domain.onCallPresetWeekDetail": "À partir de maintenant",
            "domain.onCallNobody":
                "Personne n'est de garde, alors un appel en dehors des heures "
                + "réveille toutes les personnes qui voient le numéro. Mettez une seule "
                + "personne de garde et le reste de l'équipe passe une nuit tranquille.",
            "domain.onCallUntil": "de garde jusqu'à",
            "domain.onCallLine": "{name} est de garde jusqu'à {until}",
            "domain.onCallEscalation":
                "Si cette personne ne répond pas, tout le monde est prévenu quelques "
                + "minutes plus tard.",
            "domain.onCallReadOnly":
                "Seul un propriétaire ou un administrateur peut changer qui est de "
                + "garde.",
            "domain.onCallBannerWaiting": "Personne ne s'en est encore occupé",
            "domain.onCallBannerClaim": "Je m'en occupe",
            "domain.onCallBannerTaken": "s'en occupe",
            "domain.onCallTakenLine": "{name} s'en occupe",
            "domain.onCallBannerYours":
                "Vous vous en occupez. Le reste de l'équipe a été prévenu.",
            "domain.quietHoursHeading": "Heures de silence",
            "domain.quietHoursReassurance":
                "Votre téléphone reste silencieux pour les messages ordinaires. Si "
                + "vous êtes de garde, ou si une alerte que personne n'a prise "
                + "s'élargit à l'équipe, elle passe quand même.",
            "domain.quietHoursOff":
                "Désactivé — toutes les notifications vous parviennent à toute heure.",
            "domain.quietHoursOn": "Silence à partir de",
            "domain.quietHoursLine": "Silence de {from} à {to}",
            "domain.quietHoursScope": "Ceci s'applique à cet espace de travail seulement.",
            "domain.deliveryHeading": "Ce que nous vous disons",
            "domain.deliveryUrgentAlways":
                "Une urgence, un appel pendant que vous êtes de garde, ou une alerte "
                + "que personne n'a prise arrive toujours immédiatement, quel que soit "
                + "votre choix ici.",
            "domain.deliveryImmediate": "Immédiatement",
            "domain.deliveryBatched": "Regroupées",
            "domain.deliverySummary": "Une fois par jour",
            "domain.deliverySummaryDetail":
                "Conservées pour votre résumé quotidien, pas supprimées.",
            "domain.categoryMessagesMine": "Textos sur mes tâches",
            "domain.categoryMessagesAll": "Textos sur les tâches de tout le monde",
            "domain.categoryMentions": "Quand quelqu'un me mentionne avec @",
            "domain.categoryAssignments": "Travail qui m'est confié",
            "domain.categoryMissedCalls": "Appels manqués",
            "domain.categoryVoicemails": "Messages vocaux",
            // ── Silencing a channel while on call (#244) — OnCallSilence.swift ──────
            "domain.onCallSilenceConfirm": "La désactiver quand même",
            "domain.onCallSilenceCancel": "La laisser activée",
            "domain.onCallSilenceChannelPush": "Les alertes push",
            "domain.onCallSilenceChannelEmail": "Les courriels",
            "domain.onCallSilenceWarning":
                "Vous êtes de garde en ce moment. {what} sont la façon dont un "
                + "nouveau client à qui personne n'a répondu vous joint. Avec ce "
                + "réglage désactivé, ces appels ne mènent nulle part et personne "
                + "d'autre n'est prévenu. Passez le quart à quelqu'un d'abord si vous "
                + "devez être injoignable.",
            // ── Send later, and why one did not go (#233) — ScheduledSend.swift ─────
            "domain.scheduledHoldSubscriptionInactive":
                "Votre abonnement a expiré, alors ceci n'a pas été envoyé. Le message "
                + "partira une fois la facturation réglée.",
            "domain.scheduledHoldWorkspacePaused":
                "Votre forfait est en pause, alors ceci n'a pas été envoyé. Le "
                + "message partira à votre reprise.",
            "domain.scheduledHoldRegistrationPending":
                "Ceci attend l'approbation des fournisseurs pour les textos "
                + "américains. Le message partira dès que ce sera approuvé.",
            "domain.scheduledHoldServiceUnavailable":
                "Les textos sont en pause pendant que nous réglons un problème. Ceci "
                + "est toujours en file et rien n'a été perdu.",
            "domain.scheduledHoldCalendarUnverified":
                "La synchronisation du calendrier est déconnectée ou n'a pas été "
                + "vérifiée récemment, alors ce rappel est en attente. Il partira après "
                + "une nouvelle vérification.",
            "domain.scheduledHoldCustomerReplied":
                "Le client a répondu après votre programmation, alors nous avons "
                + "retenu le message plutôt que de lui couper la parole. Envoyez-le "
                + "quand même, ou annulez-le.",
            "domain.scheduledHoldOptedOut":
                "Le client a répondu STOP après votre programmation, alors le message "
                + "n'a pas été envoyé. Lui seul peut annuler cela.",
            "domain.scheduledHoldInvalidDestination":
                "Nous ne pouvons plus texter ce numéro, alors ceci n'a pas été "
                + "envoyé.",
            "domain.scheduledHoldExpired":
                "La fenêtre d'envoi est passée avant que ceci ne parte, alors le "
                + "message n'a pas été envoyé. Un message en retard vaut habituellement "
                + "moins que pas de message du tout.",
            "domain.scheduledHoldWorkspaceClosed":
                "L'espace de travail a été fermé avant l'heure d'envoi prévue.",
            "domain.scheduledHoldJobUnscheduled":
                "Cette tâche n'est plus prévue, alors ce rappel n'a pas été envoyé.",
            "domain.scheduledPickerReassurance":
                "Vous pouvez le modifier ou l'annuler à tout moment avant l'envoi.",
            "domain.scheduledQuietHoursChoice":
                "Vous pouvez l'envoyer quand même, ou choisir une heure le matin chez "
                + "eux.",
            "domain.scheduledQuietHoursUnknown":
                "Cette heure tombe dans les heures de silence de ce client.",
            "domain.scheduledCancelled": "Annulé — ce texto ne partira pas.",
            "domain.scheduledNothingWaiting":
                "Rien n'est en attente d'envoi. Tout ce que vous programmez apparaît "
                + "ici.",
            "domain.clockTheirTimeContact": "son heure locale, définie sur sa fiche",
            "domain.clockTheirTimeAreaCode": "son heure locale, d'après son indicatif régional",
            "domain.clockWorkspaceTime":
                "l'heure de votre espace de travail — nous ne connaissons pas la "
                + "sienne",
            "domain.scheduledPresetTomorrow": "Demain, 8 h",
            "domain.monthJanuary": "janvier",
            "domain.monthFebruary": "février",
            "domain.monthMarch": "mars",
            "domain.monthApril": "avril",
            "domain.monthMay": "mai",
            "domain.monthJune": "juin",
            "domain.monthJuly": "juillet",
            "domain.monthAugust": "août",
            "domain.monthSeptember": "septembre",
            "domain.monthOctober": "octobre",
            "domain.monthNovember": "novembre",
            "domain.monthDecember": "décembre",
            "domain.contactSince": "Client depuis {since} · {conversations}",
            "domain.contactConversationOne": "1 conversation",
            "domain.contactConversationMany": "{count} conversations",
            "domain.scheduledPresetMonday": "Lundi, 8 h",
            "domain.scheduledPresetCustom": "Choisir une heure",
            // ── Recommending us to another crew (#288) — ReferralShare.swift ────────
            "domain.referralNote":
                "Nous passons notre ligne d'affaires par Loonext — les appels et les "
                + "textos arrivent dans une seule boîte de réception et la personne "
                + "libre répond. Prix fixe, aucuns frais par utilisateur. "
                + "Inscrivez-vous avec mon lien et nous obtenons tous les deux un mois "
                + "gratuit.",
            "domain.referralTitle": "Recommander une autre équipe",
            "domain.referralRewardLine":
                "Envoyez ceci à une autre entreprise. Quand elle s'inscrit et qu'un "
                + "client lui répond par texto, vous obtenez tous les deux un mois "
                + "gratuit",
            "domain.referralStageInvited": "Inscrite, aucune réponse encore",
            "domain.referralStageSignedUp": "En service",
            "domain.referralStageActive": "Toujours active après 30 jours",
            "domain.referralStageRewarded": "Mois gratuit appliqué",
            "domain.referralStageVoided": "Non comptabilisée",
            "domain.referralAction": "Partager",
            "domain.referralCopy": "Copier",
            "domain.referralCopied": "Copié",
            "domain.referralDraftLabel": "Votre message",
            "domain.referralLinkNote": "Votre lien s'ajoute automatiquement à la fin.",
            "domain.referralAskBody":
                "Vous connaissez une autre équipe qui fait encore rouler son "
                + "entreprise sur le cellulaire d'une seule personne ? Envoyez-lui "
                + "votre lien — vous obtenez tous les deux un mois gratuit.",
            "domain.referralAskAction": "Partager votre lien",
            "domain.referralAskDismiss": "Pas maintenant",
            "domain.referralCodeFallback": "Utilisez mon code {code} à votre inscription.",
            "domain.referralAskHeadlineOne": "Vous avez répondu à 1 client ce mois-ci.",
            "domain.referralAskHeadlineMany": "Vous avez répondu à {count} clients ce mois-ci.",
            // ── The measures on the For You tab (#268) — DashboardPanels.swift ──────
            "domain.panelResponseTime": "Temps de réponse",
            "domain.panelPipeline": "Devis",
            "domain.panelSatisfaction": "Satisfaction",
            "domain.panelLeadSources": "D'où viennent vos clients",
            "domain.panelRecentCalls": "Appels récents",
            "domain.panelResponseTimeNote":
                "À quelle vitesse les nouveaux clients ont eu une réponse cette "
                + "semaine.",
            "domain.panelPipelineNote":
                "Ce que vous avez proposé en devis ce mois-ci, et quelle part vous "
                + "avez décrochée.",
            "domain.panelSatisfactionNote":
                "Si les personnes à qui vous avez répondu étaient satisfaites.",
            "domain.panelLeadSourcesNote": "Quels canaux amènent réellement du travail.",
            "domain.panelRecentCallsNote": "Les derniers appels, entrants et sortants.",
            // ── Proving it is you before handing the workspace over — HandoverConfirmation.swift ───
            "domain.handoverTitle": "Confirmez votre identité",
            "domain.handoverWhereAuthenticator":
                "Ouvrez votre application d'authentification et entrez le code à six "
                + "chiffres qu'elle affiche.",
            "domain.handoverWhereEmail":
                "Nous avons envoyé un code à six chiffres par courriel à l'adresse de "
                + "votre compte. Il fonctionne une seule fois et expire dans dix "
                + "minutes.",
            "domain.handoverField": "Code à six chiffres",
            "domain.handoverSubmit": "Confirmer",
            "domain.handoverResend": "Envoyer de nouveau",
            "domain.handoverRejected":
                "Ce code n'a pas fonctionné. Demandez-en un nouveau et réessayez.",
            // ── An arrow and a circle on a photo — PhotoMarkup.swift ────────────────
            "domain.markupArrow": "Flèche",
            "domain.markupCircle": "Cercle",
            "domain.markupHint":
                "Glissez sur la photo, ou touchez deux fois, pour pointer quelque "
                + "chose.",
            "domain.markupHintSecondTap": "Touchez maintenant l'endroit à pointer.",
            "domain.markupSave": "Terminé",
            "domain.markupUndo": "Annuler",
            // ── Before and after, on a job's photos — WorkPhase.swift ───────────────
            "domain.onMyWayAction": "En route",
            "domain.onMyWayPrompt": "Dans combien de temps ?",
            "domain.onMyWayGatedNote": "S'envoie immédiatement, et suit les mêmes règles que n'importe quel texto.",
            "domain.workPhaseBefore": "Avant",
            "domain.workPhaseAfter": "Après",
            "domain.workPhaseUnset": "Ni un avant ni un après",
            "domain.workPhaseHint":
                "Marque ces photos comme l'état à votre arrivée, ou l'état à votre "
                + "départ.",
            "domain.jobPhaseCountBefore": "{count} avant",
            "domain.jobPhaseCountAfter": "{count} après",
            // ── When “later” is (#293) — SnoozeLogic.swift ──────────────────────────
            "domain.snoozePresetAfternoon": "Cet après-midi",
            "domain.snoozePresetEvening": "Ce soir",
            "domain.snoozePresetTomorrow": "Demain matin",
            "domain.snoozePresetNextWeek": "Semaine prochaine",
            "domain.followUpPresetThreeDays": "Dans 3 jours",
            "domain.followUpPresetTwoWeeks": "Dans 2 semaines",
            "domain.snoozeFallback": "Reportée",
            "domain.snoozeBackAt": "De retour à {time}",
            "domain.snoozeBackTomorrow": "De retour demain, {time}",
            "domain.snoozeBackWeekday": "De retour {day}, {time}",
            "domain.snoozeBackDate": "De retour le {date}",
            // ── How long before an appointment to remind — AppointmentReminders.swift ───
            "domain.reminderOffsetDayBefore": "La veille",
            "domain.reminderOffsetDays": "{count} jours avant",
            "domain.reminderOffsetHour": "1 heure avant",
            "domain.reminderOffsetHours": "{count} heures avant",
            "domain.reminderOffsetMinutes": "{count} minutes avant",
            // ── One instant, two wall clocks (#539) — TwoClocks.swift ───────────────
            "domain.twoClocksThere": "à leur heure",
            "domain.twoClocksHere": "à la vôtre",
            "domain.twoClocksLine": "{there} à leur heure · {here} à la vôtre",
            "domain.twoClocksSpoken": "{there} à leur heure, ce qui fait {here} à la vôtre",
            "domain.twoClocksAreaCodeNote":
                "Les règles sur les heures où vous pouvez texter suivent leur "
                + "horloge, pas la vôtre. Si ce numéro a déménagé, réglez son fuseau "
                + "horaire sur la fiche du client.",
            "domain.twoClocksChoiceTheirs": "Son heure locale",
            "domain.twoClocksChoiceYours": "Votre heure locale",
            // ── Taking your own access away (#315) — SelfDowngrade.swift ────────────
            "domain.capBilling": "le forfait et la facturation",
            "domain.capSettings": "les paramètres de l'espace de travail",
            "domain.capTeam":
                "qui fait partie de l'équipe et ce que ces personnes peuvent faire",
            "domain.capNumbers": "les numéros de téléphone",
            "domain.capHistory": "le journal d'historique",
            "domain.capContactsBulk": "l'importation et l'exportation des clients",
            "domain.selfDowngradeSomeOfWhat":
                "une partie de ce que vous pouvez faire actuellement",
            "domain.selfDowngradeListPair": "{first} et {last}",
            "domain.selfDowngradeMore": "{list}, et {count} de plus",
            "domain.selfDowngradeUndo": " Vous ne pourrez pas revenir en arrière vous-même — seul un propriétaire le peut.",
            "domain.selfDowngradeWarning": "Vous perdrez l'accès à {scope}.{undo}",
            "domain.and": "et",
        ]
    )
}
