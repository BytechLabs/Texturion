package com.loonext.android.core.i18n

/**
 * #228 — the words the DOMAIN says: the sentences that live in `core/`, away
 * from any one screen.
 *
 * ## Why these were the last English left, and the hardest to see
 *
 * Every other section in this catalogue was extracted from a screen. These were
 * not on a screen. They are in `core/model`, `core/oncall`, `core/scheduled` and
 * their neighbours — hand-ports of `packages/shared` modules that decide what a
 * carrier rejection MEANS, why a scheduled text did not go, what a member is
 * allowed to reach on a number. The copy was deliberately lifted out of the
 * components so that three clients would say one thing, and lifting it out is
 * exactly what hid it from a component-shaped scanner for months.
 *
 * ## Where the French came from
 *
 * Copied character for character from the files under `apps/web/src/i18n/`
 * (`sections`, one `.ts` per surface) wherever
 * web has already said the same sentence — the contact's clock line, the address
 * provenance badges, the drafting and catch-up refusals, the quiet-hours warning,
 * "Peut texter", "Recommander une autre équipe", "Reportée". Two clients each
 * having a go at one sentence is how a product ends up with two names for one
 * thing, and the person who notices is the one using both.
 *
 * A large share of this file had no web counterpart, and that is not an
 * oversight: these strings live in `packages/shared` as plain English constants,
 * so the WEB app renders them in English too. Carrier rejections, the on-call
 * roster, the scheduled-send hold reasons, the referral draft, the send-failure
 * table — web says all of them in English today. Those are written here for the
 * first time, in the register the rest of the catalogue uses: Quebec French,
 * VOUVOIEMENT, accents spelled normally, and web's own vocabulary held steady
 * (texto, conversation, client, équipe, espace de travail, numéro, tâche,
 * fournisseurs for the carriers, quart for an on-call shift).
 *
 * Never translated, in either direction: the product names (Loonext, Lou,
 * Telnyx, Stripe), the platform, and the carrier keywords — a customer texts
 * STOP in Montreal exactly as they do in Denver, because it is the carrier that
 * reads it and not us.
 *
 * ## How these reach a reader
 *
 * `t()` is `@Composable` and nothing in `core/` is. So every function here is
 * reached the way `AppLock.headline` and `ongoingStatusLabel` already are: the
 * pure function takes `locale` as a LAST, DEFAULTED parameter and resolves the
 * key itself. Defaulted so the parity vectors and the hand-port tests that pin
 * the English are untouched, and so a call site that has not been given the
 * reader's language yet keeps rendering exactly what it rendered before rather
 * than a bare key.
 *
 * ## The tagline rule
 *
 * `domain.referralNote` is the one string in this file a stranger reads before
 * they have ever heard of us, and it is load-bearing: the crew can run SEVERAL
 * numbers, so the claim is "one INBOX", never "one number". The French keeps the
 * inbox singular for the same reason. `ReferralShareTest` asserts the English
 * against `packages/shared/src/referral-share.ts` character for character, which
 * is why the English here is a copy rather than a rewrite.
 */
object DomainStrings : AppStrings.Section {
    override val en = mapOf(
        // ── What a caller said, pulled out of a voicemail (#367) ─────────────
        // The provenance line says WHERE this was read, which is the half a
        // person can check against the transcript underneath.
        "domain.voicemailIntakeSource" to "From the voicemail",
        "domain.voicemailIntakeProblem" to "Problem",
        "domain.voicemailIntakeAddress" to "Address",
        "domain.voicemailIntakeCallback" to "Call back",
        "domain.voicemailIntakeName" to "Name",

        // ── Whose clock a contact is on (#539) ───────────────────────────────
        "domain.contactClockSetByCrew" to "Set by your crew",
        "domain.contactClockFromAreaCode" to "From their area code",
        "domain.contactClockUnknown" to
            "Their area code doesn't say — using your timezone",

        // ── Following the workspace's language (#228) ────────────────────────
        // Names the language when it is known, because "same as workspace" on
        // its own gives the rule and not the answer.
        "domain.localeSameAsWorkspace" to "Same as workspace",
        "domain.localeSameAsWorkspaceNamed" to "Same as workspace ({language})",

        // ── Numbers this member cannot see (#286) ────────────────────────────
        // A COUNT and nothing else: naming the number would undo the rule the
        // sentence exists to explain.
        "domain.hiddenNumbersOne" to
            "One more number is on this account that is not shared with you. " +
            "Ask an owner if you need it.",
        "domain.hiddenNumbersMany" to
            "{count} more numbers are on this account that are not shared " +
            "with you. Ask an owner if you need them.",

        // ── Why a spam-marked thread was raised again (#342) ─────────────────
        "domain.spamWhyTexted" to "You texted them before this was marked",
        "domain.spamWhySustained" to "Still texting, over several days",
        "domain.spamWhyCount" to "{count} messages since it was marked",

        // ── What one member reaches on one number, and why (#348/#286) ───────
        "domain.numberAccessCanText" to "Can text",
        "domain.numberAccessNoteOnly" to "Read and notes only",
        "domain.numberAccessHidden" to "Hidden",
        // `{role}` is the wire value the rule named — a role, never translated,
        // because it is the same word the owner sees on the rule they would go
        // and edit.
        "domain.numberAccessRuleNamingYou" to "A rule naming you",
        "domain.numberAccessRuleNamingThem" to "A rule naming them",
        "domain.numberAccessRuleForRole" to "A rule for {role}s",
        "domain.numberAccessRuleForYourRole" to "A rule for your role",
        "domain.numberAccessRuleForTheirRole" to "A rule for their role",
        "domain.numberAccessRuleForEveryone" to "A rule for everyone",
        // `unruled` and `no-match` look alike and are not: one means nobody
        // restricted this number, the other that somebody did and left this
        // person out. Confusing them is how an owner concludes the rules broke.
        "domain.numberAccessNoMatchYou" to
            "This number has rules, and none of them include you",
        "domain.numberAccessNoMatchThem" to
            "This number has rules, and none of them include them",
        "domain.numberAccessUnruled" to "Nobody has restricted this number",
        "domain.numberAccessOwners" to "Owners reach every number",
        "domain.numberAccessAdmins" to "Admins reach every number",
        "domain.numberAccessNotMemberYou" to "You are no longer in this workspace",
        "domain.numberAccessNotMemberThem" to "No longer in this workspace",
        // The sentence that stops a new tech reading a permission as a bug.
        "domain.numberAccessSelfHiddenOne" to "{count} number is hidden from you",
        "domain.numberAccessSelfHiddenMany" to "{count} numbers are hidden from you",
        "domain.numberAccessSelfReadOnlyOne" to "{count} is read-only",
        "domain.numberAccessSelfReadOnlyMany" to "{count} are read-only",
        "domain.numberAccessSelfNote" to
            "{parts}. That is deliberate — somebody set it up that way, and it " +
            "is not the app failing. Ask an owner or admin if you need more.",

        // ── Making the carrier wait legible (#310) ───────────────────────────
        "domain.regStageNeedsDetailsTitle" to "We need a few business details",
        "domain.regStageNeedsDetailsNext" to
            "Finish the texting registration form and we'll send it on.",
        "domain.regStageSubmittingTitle" to "Sent to the carriers",
        "domain.regStageSubmittingNext" to
            "The carriers review it next. Nothing needed from you.",
        "domain.regStageExpected" to "Usually 3–7 business days, sometimes longer",
        "domain.regStageUnderReviewTitle" to "Under review by the carriers",
        "domain.regStageUnderReviewNext" to
            "We'll text and email you the moment it clears.",
        "domain.regStageApprovedTitle" to "Your texting is live",
        "domain.regStageApprovedNext" to "You can text customers now.",
        "domain.regStageRejectedTitle" to "The carriers need something changed",
        "domain.regStageRejectedNext" to
            "Check the details on your registration and resubmit.",

        // ── A carrier rejection, in words the customer can act on (#352) ─────
        // Each pair is WHAT the carrier objected to and the ONE thing to change.
        // The routing that picks a pair is pinned by parity vectors; the wording
        // is not, and lives here.
        "domain.rejectRegEinWhat" to
            "The tax ID you gave does not match what the government registry " +
            "holds for your business.",
        "domain.rejectRegEinFix" to
            "Check the EIN or business number on a tax document and enter it " +
            "exactly, digits only.",
        "domain.rejectRegNameWhat" to
            "The business name you gave does not match the one on your " +
            "government registration.",
        "domain.rejectRegNameFix" to
            "Use the exact legal name from your registration paperwork, " +
            "including any Ltd, Inc or LLC — the name customers see is set " +
            "separately.",
        "domain.rejectRegAddressWhat" to
            "The business address does not match the one on your government " +
            "registration.",
        "domain.rejectRegAddressFix" to
            "Enter the registered business address rather than a mailing or " +
            "job-site address.",
        "domain.rejectRegWebsiteWhat" to
            "The carrier could not confirm your business from the website you gave.",
        "domain.rejectRegWebsiteFix" to
            "Give a website that names your business and describes what you do, " +
            "and make sure it loads publicly.",
        "domain.rejectRegConsentWhat" to
            "The carrier was not satisfied that customers agree to be texted " +
            "before you text them.",
        "domain.rejectRegConsentFix" to
            "Describe exactly where a customer gives you their number and what " +
            "they are told at that moment.",
        "domain.rejectRegSampleWhat" to
            "The sample texts did not show the carrier what you actually send.",
        "domain.rejectRegSampleFix" to
            "Use real messages you would send a customer, and include your " +
            "business name in each one.",
        "domain.rejectRegUseCaseWhat" to
            "The use case you picked does not match what your samples and " +
            "website describe.",
        "domain.rejectRegUseCaseFix" to
            "Pick the category that matches the texts you actually send to customers.",
        "domain.rejectRegDuplicateWhat" to
            "This business is already registered with the carriers, most likely " +
            "by a provider you used before.",
        "domain.rejectRegDuplicateFix" to
            "Reply to us and we will get the existing registration released or " +
            "transferred — this is not something the form can fix.",
        "domain.rejectRegEntityWhat" to
            "The business type you chose does not match how your business is " +
            "registered.",
        "domain.rejectRegEntityFix" to
            "Choose the type that matches your paperwork — a sole trader and a " +
            "limited company are registered differently.",
        "domain.rejectRegContactWhat" to
            "The carrier could not reach the contact details on the registration.",
        "domain.rejectRegContactFix" to
            "Give a business email and phone number that reach a person and are " +
            "not auto-replied.",
        "domain.rejectPortAccountWhat" to
            "The account number does not match the one your current provider has " +
            "on file.",
        "domain.rejectPortAccountFix" to
            "Copy it from a recent bill from that provider — it is usually not " +
            "the phone number itself.",
        "domain.rejectPortPinWhat" to "The transfer PIN was missing or wrong.",
        "domain.rejectPortPinFix" to
            "Ask your current provider for a port-out PIN — most will only give " +
            "it to the account holder, and it often expires within a few days.",
        "domain.rejectPortAuthWhat" to
            "The person named on the request is not authorised on the account.",
        "domain.rejectPortAuthFix" to
            "Use the name of the person your current provider has as the account " +
            "holder, spelled the same way.",
        "domain.rejectPortEntityWhat" to
            "The account holder name does not match your current provider's records.",
        "domain.rejectPortEntityFix" to
            "Use the name exactly as it appears on the bill, including any Ltd, " +
            "Inc or LLC.",
        "domain.rejectPortAddressWhat" to
            "The service address does not match the one your current provider " +
            "has on file.",
        "domain.rejectPortAddressFix" to
            "Use the address on the bill for this line, even if the business has " +
            "since moved.",
        "domain.rejectPortPendingWhat" to
            "Your current provider has another change in progress on this line.",
        "domain.rejectPortPendingFix" to
            "Ask them to cancel or finish it, then tell us and we will resubmit.",
        "domain.rejectPortInactiveWhat" to
            "Your current provider says this number is not active on the account " +
            "we asked about.",
        "domain.rejectPortInactiveFix" to
            "Check the number is still in service and on the account you gave us " +
            "— a number already cancelled cannot be moved.",
        "domain.resubmitWaitRegistration" to
            "Most resubmissions are decided within a business day or two.",
        "domain.resubmitWaitPort" to
            "Most resubmitted transfers are accepted within a few business days.",

        // ── Why a text did not arrive ────────────────────────────────────────
        // The fallback, and the whole of what a failed send used to say. Never
        // invent a reason: an unknown code keeps this rather than guessing.
        "domain.sendFailureGeneric" to "Not delivered",
        "domain.sendFailureOptedOut" to "This customer opted out",
        "domain.sendFailureUnreachable" to "That number can't receive texts",
        "domain.sendFailureNotTextable" to "That number isn't textable",
        "domain.sendFailureBlockedNow" to "Carriers are blocking this right now",
        "domain.sendFailureSpam" to "Carriers blocked this as spam",
        "domain.sendFailureRateLimited" to
            "Sent too fast for carriers. Try again shortly",
        "domain.sendFailureHandsetRejected" to "Their phone rejected it",
        "domain.sendFailureHandsetUnavailable" to "Their phone couldn't receive it",
        "domain.sendFailureExpired" to "It expired before it could send",
        "domain.sendFailureContent" to "Carriers wouldn't accept this message",
        "domain.sendFailureEmpty" to "There was nothing to send",
        "domain.sendFailureAttachment" to "Carriers wouldn't accept that attachment",
        "domain.sendFailureTooLong" to "Too long to send",
        "domain.sendFailureRegistration" to
            "Your US texting registration isn't approved yet",
        "domain.sendFailureNumberNotReady" to
            "This number isn't set up for texting yet",
        "domain.sendFailureTextingOff" to "Texting is turned off for this number",
        "domain.sendFailureNoSms" to "This number can't send texts",
        "domain.sendFailureNoMms" to "This number can't send pictures",

        // ── Where a task's address came from (#214) ──────────────────────────
        "domain.addrFromMessage" to "From the message",
        "domain.addrFromContact" to "From the contact",
        "domain.addrFromAreaCode" to "Inferred from area code",

        // ── When Lou has no draft to offer ───────────────────────────────────
        // One blanket "nothing to suggest" hid real breakage behind what looked
        // like a shrug, so each reason says what happened and whether trying
        // again will help.
        "domain.draftsDisabled" to
            "Drafting is turned off for this workspace. Settings, AI turns it back on.",
        "domain.draftsSpam" to
            "This thread is marked as spam, so Lou skips it. Unmark it to draft a reply.",
        "domain.draftsNothingToReply" to
            "Nothing to draft from yet. Type a few words and try again.",
        "domain.draftsOverCap" to
            "This month's drafting is used up. It starts again next month.",
        "domain.draftsRateLimited" to
            "That was a lot of drafts at once. Try again in a moment.",
        "domain.draftsUnusable" to
            "Nothing came back worth sending. Try again, or add a few words first.",
        "domain.draftsNone" to "No drafts this time. Try again.",
        // Read by BOTH the drafting and the catch-up refusals, on purpose: a
        // crew that meets them in one afternoon should read one story, not two.
        "domain.louUnreachable" to "Couldn't reach Lou just now. Try again.",
        "domain.louPausedForBilling" to
            "Lou is paused while the subscription is sorted out. An owner can fix " +
            "that in Billing.",

        // ── The catch-up (#247) ──────────────────────────────────────────────
        // Ordered: what THEY wanted, what WE said back, what is still owed.
        // Not "action items" — a loop is open because nobody closed it, which is
        // a statement about the conversation rather than an instruction.
        "domain.catchUpSectionAsked" to "What they asked",
        "domain.catchUpSectionWeSaid" to "What we said",
        "domain.catchUpSectionOpen" to "Still open",
        "domain.catchUpAttribution" to
            "Lou read this thread. Tap any line to see the message it came from.",
        "domain.catchUpDisabled" to
            "Catch-ups are turned off for this workspace. Settings, AI turns them " +
            "back on.",
        "domain.catchUpSpam" to
            "This thread is marked as spam, so Lou skips it. Unmark it to catch up.",
        "domain.catchUpTooShort" to
            "This thread is short enough to read. Lou saves catch-ups for the long ones.",
        "domain.catchUpOverCap" to
            "This month's catch-ups are used up. They start again next month.",
        "domain.catchUpRateLimited" to
            "That was a lot of catch-ups at once. Try again in a moment.",
        // The reader's ROLE, not our weather — so it never says "try again".
        "domain.catchUpNotAllowed" to
            "You can read this thread but not ask Lou to catch you up. " +
            "An owner or admin can change your access.",
        "domain.catchUpUnusable" to
            "Nothing came back that Lou could point at in the thread, so there's " +
            "nothing to show.",
        "domain.catchUpNone" to "No catch-up this time. Try again.",

        // ── Who is holding the phone tonight (#244) ──────────────────────────
        "domain.onCallPresetTonight" to "Tonight",
        "domain.onCallPresetTonightDetail" to "6pm until 8am tomorrow",
        "domain.onCallPresetWeekend" to "This weekend",
        "domain.onCallPresetWeekendDetail" to "Friday 6pm until Monday 8am",
        "domain.onCallPresetWeek" to "The next 7 days",
        "domain.onCallPresetWeekDetail" to "Starting now",
        // States the CONSEQUENCE, which is the decision.
        "domain.onCallNobody" to
            "Nobody is on call, so an after-hours call wakes everyone who can see " +
            "the number. Put one person on and the rest get a quiet night.",
        "domain.onCallUntil" to "on call until",
        "domain.onCallLine" to "{name} is on call until {until}",
        "domain.onCallEscalation" to
            "If they do not pick it up, everyone else is told a few minutes later.",
        "domain.onCallReadOnly" to "Only an owner or admin can change who is on call.",
        "domain.onCallBannerWaiting" to "Nobody has picked this up yet",
        "domain.onCallBannerClaim" to "I have this",
        "domain.onCallBannerTaken" to "has this",
        "domain.onCallTakenLine" to "{name} has this",
        "domain.onCallBannerYours" to "You have this. The rest of the crew has been told.",

        // ── A member's own quiet hours (#244) ────────────────────────────────
        "domain.quietHoursHeading" to "Quiet hours",
        // THE LOAD-BEARING SENTENCE. The reason people do not set quiet hours is
        // the fear of missing the emergency, so a control that offers silence
        // without saying what still gets through does not get switched on.
        "domain.quietHoursReassurance" to
            "Your phone stays quiet for ordinary messages. If you are on call, or " +
            "an alert nobody picked up widens to the crew, it still comes through.",
        "domain.quietHoursOff" to "Off — every notification reaches you at any hour.",
        "domain.quietHoursOn" to "Quiet from",
        "domain.quietHoursLine" to "Quiet from {from} to {to}",
        "domain.quietHoursScope" to "This applies to this workspace only.",

        // ── How loud each kind of notification is (#297) ─────────────────────
        "domain.deliveryHeading" to "How much we tell you",
        // THE PROMISE THAT MAKES A QUIETER SETTING PICKABLE.
        "domain.deliveryUrgentAlways" to
            "An emergency, a page while you are on call, or an alert nobody picked " +
            "up always arrives straight away, whatever you choose here.",
        "domain.deliveryImmediate" to "Straight away",
        "domain.deliveryBatched" to "Grouped up",
        "domain.deliverySummary" to "Once a day",
        // Said next to "Once a day", the option people misread as off.
        "domain.deliverySummaryDetail" to "Held for your daily summary, not discarded.",
        "domain.categoryMessagesMine" to "Texts on my jobs",
        "domain.categoryMessagesAll" to "Texts on anyone's jobs",
        "domain.categoryMentions" to "When somebody @s me",
        "domain.categoryAssignments" to "Work handed to me",
        "domain.categoryMissedCalls" to "Missed calls",
        "domain.categoryVoicemails" to "Voicemails",

        // ── Going quiet while you are the one on call (#538) ─────────────────
        "domain.onCallSilenceConfirm" to "Turn it off anyway",
        "domain.onCallSilenceCancel" to "Leave it on",
        "domain.onCallSilenceChannelPush" to "Push alerts",
        "domain.onCallSilenceChannelEmail" to "Emails",
        "domain.onCallSilenceWarning" to
            "You're on call right now. {what} are how a new customer nobody has " +
            "answered reaches you, and with this off those pages go nowhere — no " +
            "one else is told. Hand the shift over first if you need to be " +
            "unreachable.",

        // ── Why a scheduled text did not go (#233) ───────────────────────────
        // Each is a REASON, not an error. The opt-out one deliberately offers no
        // remedy, because there is not one — only the customer can lift a STOP.
        "domain.scheduledHoldSubscriptionInactive" to
            "Your subscription has lapsed, so this has not been sent. It will go " +
            "out when billing is sorted.",
        "domain.scheduledHoldWorkspacePaused" to
            "Your plan is paused, so this has not been sent. It will go out when " +
            "you resume.",
        "domain.scheduledHoldRegistrationPending" to
            "This is waiting on carrier approval for US texting. It will send once " +
            "that clears.",
        "domain.scheduledHoldServiceUnavailable" to
            "Texting is paused while we deal with an issue. This is still queued " +
            "and nothing was lost.",
        "domain.scheduledHoldCustomerReplied" to
            "They replied after you scheduled this, so we held it rather than talk " +
            "over them. Send it anyway, or cancel it.",
        "domain.scheduledHoldOptedOut" to
            "They replied STOP after you scheduled this, so it was not sent. Only " +
            "they can undo that.",
        "domain.scheduledHoldInvalidDestination" to
            "We cannot text this number any more, so this was not sent.",
        "domain.scheduledHoldExpired" to
            "The send window passed before this could go, so it was not sent. A " +
            "late message is usually worse than none.",
        "domain.scheduledHoldWorkspaceClosed" to
            "The workspace was closed before this was due to send.",
        "domain.scheduledHoldJobUnscheduled" to
            "That job is no longer booked, so this reminder was not sent.",
        "domain.scheduledPickerReassurance" to
            "You can change or cancel it any time before it goes.",
        "domain.scheduledQuietHoursChoice" to
            "You can send it anyway, or pick a time in their morning.",
        "domain.scheduledQuietHoursUnknown" to
            "That time is inside this customer's quiet hours.",
        "domain.scheduledCancelled" to "Cancelled — that text will not go out.",
        "domain.scheduledNothingWaiting" to
            "Nothing is waiting to send. Anything you schedule shows up here.",
        "domain.clockTheirTimeContact" to "their time, set on their contact",
        "domain.clockTheirTimeAreaCode" to "their time, from their area code",
        "domain.clockWorkspaceTime" to "your workspace's time — we don't know theirs",
        "domain.scheduledPresetTomorrow" to "Tomorrow, 8:00am",
        "domain.scheduledPresetMonday" to "Monday, 8:00am",
        "domain.scheduledPresetCustom" to "Pick a time",

        // ── Referring another crew (#288/#399) ───────────────────────────────
        // First person and plain: a contractor writing to another contractor,
        // not us writing on their behalf. "One inbox" — never "one number".
        "domain.referralNote" to
            "We run our business line through Loonext — calls and texts land in one " +
            "inbox and whoever's free answers. Flat price, no per-seat fee. Sign up " +
            "with my link and we both get a free month.",
        "domain.referralTitle" to "Refer another crew",
        // Unpunctuated on purpose: web continues the sentence with the amount,
        // and the phones close it themselves.
        "domain.referralRewardLine" to
            "Send this to another business. When they sign up and a customer texts " +
            "them back, you both get a month free",
        "domain.referralStageInvited" to "Signed up, no replies yet",
        "domain.referralStageSignedUp" to "Up and running",
        "domain.referralStageActive" to "Still going after 30 days",
        "domain.referralStageRewarded" to "Free month applied",
        "domain.referralStageVoided" to "Not counted",
        "domain.referralAction" to "Share",
        "domain.referralCopy" to "Copy",
        "domain.referralCopied" to "Copied",
        "domain.referralDraftLabel" to "Your message",
        "domain.referralLinkNote" to "Your link goes on the end automatically.",
        "domain.referralAskBody" to
            "Know another crew still running their business off one person's cell? " +
            "Send them your link — you both get a free month.",
        "domain.referralAskAction" to "Share your link",
        // A plain button of equal weight: a prompt asking for a favour has no
        // business making "no" hard to find.
        "domain.referralAskDismiss" to "Not now",
        "domain.referralCodeFallback" to "Use my code {code} when you sign up.",
        "domain.referralAskHeadlineOne" to "You replied to 1 customer this month.",
        "domain.referralAskHeadlineMany" to
            "You replied to {count} customers this month.",

        // ── Which measures a member may put away (#540) ──────────────────────
        // The label has to be the heading shown on the screen, or the switch is
        // a guess.
        "domain.panelResponseTime" to "Response time",
        "domain.panelPipeline" to "Quotes",
        "domain.panelSatisfaction" to "Satisfaction",
        "domain.panelLeadSources" to "Where your customers come from",
        "domain.panelRecentCalls" to "Recent calls",
        "domain.panelResponseTimeNote" to
            "How fast new customers got an answer this week.",
        "domain.panelPipelineNote" to
            "What you quoted this month, and how much of it landed.",
        "domain.panelSatisfactionNote" to
            "Whether the people you answered were happy.",
        "domain.panelLeadSourcesNote" to
            "Which channels are actually bringing work in.",
        "domain.panelRecentCallsNote" to "The last few calls, in and out.",

        // ── Confirming a handover of the business (#537) ─────────────────────
        "domain.handoverTitle" to "Confirm it's you",
        // Two sentences rather than one that covers both: "enter your code" is
        // useless to somebody who does not know which code.
        "domain.handoverWhereAuthenticator" to
            "Open your authenticator app and enter the six-digit code it shows.",
        "domain.handoverWhereEmail" to
            "We've emailed a six-digit code to the address on your account. " +
            "It works once, and expires in ten minutes.",
        "domain.handoverField" to "Six-digit code",
        "domain.handoverSubmit" to "Confirm",
        "domain.handoverResend" to "Send it again",
        // ONE message for wrong, expired, already used, and out of attempts —
        // the server refuses to distinguish them, so the client must not invent
        // a distinction it declined to make.
        "domain.handoverRejected" to
            "That code didn't work. Ask for a new one and try again.",

        // ── An arrow and a circle on a photo (#294) ──────────────────────────
        "domain.markupArrow" to "Arrow",
        "domain.markupCircle" to "Circle",
        "domain.markupHint" to "Drag on the photo, or tap twice, to point at something.",
        // The tap-tap path is WCAG 2.5.7's requirement, and it only works if the
        // person can tell the app is waiting for them.
        "domain.markupHintSecondTap" to "Now tap where it should point.",
        "domain.markupSave" to "Done",
        "domain.markupUndo" to "Undo",

        // ── Before and after (#294) ──────────────────────────────────────────
        "domain.workPhaseBefore" to "Before",
        "domain.workPhaseAfter" to "After",
        // Named rather than "None": most notes are neither, and "None" invites a
        // tech to think they failed to fill something in.
        "domain.workPhaseUnset" to "Not a before or after",
        "domain.workPhaseHint" to
            "Marks these photos as how it looked when you arrived, or how you left it.",
        "domain.jobPhaseCountBefore" to "{count} before",
        "domain.jobPhaseCountAfter" to "{count} after",

        // ── When a snoozed thread comes back (#293) ──────────────────────────
        // The SHAPE is decided by the rule; the day and time come from
        // java.time in the device's locale, so only the frame is here.
        // The two ladders. Separate on purpose: "this afternoon" is a meaningful
        // time to pick a thread back up and a meaningless time to chase a quote.
        // They share the one rung that means the same thing on both.
        "domain.snoozePresetAfternoon" to "This afternoon",
        "domain.snoozePresetEvening" to "This evening",
        "domain.snoozePresetTomorrow" to "Tomorrow morning",
        "domain.snoozePresetNextWeek" to "Next week",
        "domain.followUpPresetThreeDays" to "In 3 days",
        "domain.followUpPresetTwoWeeks" to "In 2 weeks",
        "domain.snoozeFallback" to "Snoozed",
        "domain.snoozeBackAt" to "Back at {time}",
        "domain.snoozeBackTomorrow" to "Back tomorrow, {time}",
        "domain.snoozeBackWeekday" to "Back {day}, {time}",
        "domain.snoozeBackDate" to "Back {date}",

        // ── How long before an appointment a reminder goes (#237) ────────────
        "domain.reminderOffsetDayBefore" to "The day before",
        "domain.reminderOffsetDays" to "{count} days before",
        "domain.reminderOffsetHour" to "1 hour before",
        "domain.reminderOffsetHours" to "{count} hours before",
        "domain.reminderOffsetMinutes" to "{count} minutes before",

        // ── One instant, two wall clocks (#539) ──────────────────────────────
        // Said only when they differ: a label that is noise on the ordinary day
        // is one people stop reading before the day it matters.
        "domain.twoClocksThere" to "their time",
        "domain.twoClocksHere" to "yours",
        "domain.twoClocksLine" to "{there} their time · {here} yours",
        // A middot is announced as "middle dot" or skipped entirely, so the
        // spoken form spells the two facts out.
        "domain.twoClocksSpoken" to "{there} their time, which is {here} yours",
        "domain.twoClocksAreaCodeNote" to
            "The rules about when you may text go by their clock, not yours. " +
            "If this number moved, set their timezone on the contact.",
        "domain.twoClocksChoiceTheirs" to "Their time",
        "domain.twoClocksChoiceYours" to "Your time",

        // ── Taking powers off yourself (#538) ────────────────────────────────
        // Written as things they DO: "team.manage" tells a developer what is
        // being revoked and tells an owner nothing.
        "domain.capBilling" to "the plan and billing",
        "domain.capSettings" to "workspace settings",
        "domain.capTeam" to "who is on the team and what they can do",
        "domain.capNumbers" to "phone numbers",
        "domain.capHistory" to "the history log",
        "domain.capContactsBulk" to "importing and exporting customers",
        "domain.selfDowngradeSomeOfWhat" to "some of what you can do now",
        "domain.selfDowngradeListPair" to "{first} and {last}",
        "domain.selfDowngradeMore" to "{list}, and {count} more",
        // The part they would actually want to know, kept apart from "you will
        // have less access", which people accept easily and correctly.
        "domain.selfDowngradeUndo" to
            " You won't be able to change it back yourself — only an owner can.",
        "domain.selfDowngradeWarning" to "You'll lose access to {scope}.{undo}",
        // Joins two clauses in one sentence. Its own key because French and
        // English put the same word in the same place and neither has a comma.
        "domain.and" to "and",
    )

    override val frCA = mapOf(
        // ── What a caller said, pulled out of a voicemail (#367) ─────────────
        "domain.voicemailIntakeSource" to "Tiré du message vocal",
        "domain.voicemailIntakeProblem" to "Problème",
        "domain.voicemailIntakeAddress" to "Adresse",
        "domain.voicemailIntakeCallback" to "Rappeler",
        "domain.voicemailIntakeName" to "Nom",

        // ── Whose clock a contact is on (#539) ───────────────────────────────
        // Copied from web's `appShell.ts`: the same three rungs, the same words.
        "domain.contactClockSetByCrew" to "Défini par votre équipe",
        "domain.contactClockFromAreaCode" to "D'après son indicatif régional",
        "domain.contactClockUnknown" to
            "Son indicatif régional ne le dit pas — nous utilisons votre fuseau",

        // ── Following the workspace's language (#228) ────────────────────────
        "domain.localeSameAsWorkspace" to "Comme l'espace de travail",
        "domain.localeSameAsWorkspaceNamed" to "Comme l'espace de travail ({language})",

        // ── Numbers this member cannot see (#286) ────────────────────────────
        "domain.hiddenNumbersOne" to
            "Un autre numéro se trouve sur ce compte sans être partagé avec vous. " +
            "Demandez-le à un propriétaire si vous en avez besoin.",
        "domain.hiddenNumbersMany" to
            "{count} autres numéros se trouvent sur ce compte sans être partagés " +
            "avec vous. Demandez-les à un propriétaire si vous en avez besoin.",

        // ── Why a spam-marked thread was raised again (#342) ─────────────────
        "domain.spamWhyTexted" to "Vous leur avez texté avant ce marquage",
        "domain.spamWhySustained" to "Textent encore, sur plusieurs jours",
        "domain.spamWhyCount" to "{count} messages depuis le marquage",

        // ── What one member reaches on one number, and why (#348/#286) ───────
        "domain.numberAccessCanText" to "Peut texter",
        "domain.numberAccessNoteOnly" to "Consultation et notes seulement",
        "domain.numberAccessHidden" to "Masqué",
        "domain.numberAccessRuleNamingYou" to "Une règle qui vous nomme",
        "domain.numberAccessRuleNamingThem" to "Une règle qui nomme cette personne",
        // The role is the wire value, never translated — it is the word on the
        // rule an owner would go and edit. Phrased so that word can sit in the
        // sentence unpluralised, because pluralising an English noun with a
        // French article ("les members") reads as a bug rather than as data.
        "domain.numberAccessRuleForRole" to "Une règle pour le rôle {role}",
        "domain.numberAccessRuleForYourRole" to "Une règle pour votre rôle",
        "domain.numberAccessRuleForTheirRole" to "Une règle pour son rôle",
        "domain.numberAccessRuleForEveryone" to "Une règle pour tout le monde",
        "domain.numberAccessNoMatchYou" to
            "Ce numéro a des règles, et aucune ne vous inclut",
        "domain.numberAccessNoMatchThem" to
            "Ce numéro a des règles, et aucune n'inclut cette personne",
        "domain.numberAccessUnruled" to "Personne n'a restreint ce numéro",
        // "peuvent utiliser tous les numéros" is web's own phrasing for exactly
        // this rule, on the screen where an owner sets it.
        "domain.numberAccessOwners" to "Les propriétaires peuvent utiliser tous les numéros",
        "domain.numberAccessAdmins" to "Les administrateurs peuvent utiliser tous les numéros",
        "domain.numberAccessNotMemberYou" to
            "Vous ne faites plus partie de cet espace de travail",
        "domain.numberAccessNotMemberThem" to
            "Ne fait plus partie de cet espace de travail",
        "domain.numberAccessSelfHiddenOne" to "{count} numéro vous est masqué",
        "domain.numberAccessSelfHiddenMany" to "{count} numéros vous sont masqués",
        "domain.numberAccessSelfReadOnlyOne" to "{count} est en consultation seulement",
        "domain.numberAccessSelfReadOnlyMany" to "{count} sont en consultation seulement",
        "domain.numberAccessSelfNote" to
            "{parts}. C'est voulu — quelqu'un l'a configuré ainsi, et ce n'est pas " +
            "l'application qui fait défaut. Demandez à un propriétaire ou à un " +
            "administrateur s'il vous en faut davantage.",

        // ── Making the carrier wait legible (#310) ───────────────────────────
        // "Fournisseurs" for the carriers, as web's registration screens say.
        "domain.regStageNeedsDetailsTitle" to
            "Il nous faut quelques renseignements sur l'entreprise",
        "domain.regStageNeedsDetailsNext" to
            "Remplissez le formulaire d'inscription aux textos et nous l'enverrons.",
        "domain.regStageSubmittingTitle" to "Envoyée aux fournisseurs",
        "domain.regStageSubmittingNext" to
            "Les fournisseurs l'examinent ensuite. Rien à faire de votre côté.",
        "domain.regStageExpected" to
            "Habituellement de 3 à 7 jours ouvrables, parfois plus",
        "domain.regStageUnderReviewTitle" to "En cours d'examen par les fournisseurs",
        "domain.regStageUnderReviewNext" to
            "Nous vous écrirons par texto et par courriel dès que ce sera approuvé.",
        "domain.regStageApprovedTitle" to "Vos textos sont en service",
        "domain.regStageApprovedNext" to "Vous pouvez texter vos clients dès maintenant.",
        "domain.regStageRejectedTitle" to "Les fournisseurs demandent une correction",
        "domain.regStageRejectedNext" to
            "Vérifiez les renseignements de votre inscription et renvoyez-la.",

        // ── A carrier rejection, in words the customer can act on (#352) ─────
        "domain.rejectRegEinWhat" to
            "Le numéro d'identification fiscale que vous avez donné ne correspond " +
            "pas à ce que le registre gouvernemental détient pour votre entreprise.",
        "domain.rejectRegEinFix" to
            "Vérifiez l'EIN ou le numéro d'entreprise sur un document fiscal et " +
            "saisissez-le exactement, chiffres seulement.",
        "domain.rejectRegNameWhat" to
            "La dénomination sociale que vous avez donnée ne correspond pas à celle " +
            "de votre inscription gouvernementale.",
        "domain.rejectRegNameFix" to
            "Utilisez la dénomination sociale exacte figurant sur vos documents " +
            "d'inscription, y compris tout Ltd, Inc ou LLC — le nom que vos clients " +
            "voient se règle séparément.",
        "domain.rejectRegAddressWhat" to
            "L'adresse de l'entreprise ne correspond pas à celle de votre " +
            "inscription gouvernementale.",
        "domain.rejectRegAddressFix" to
            "Entrez l'adresse d'entreprise inscrite plutôt qu'une adresse postale " +
            "ou de chantier.",
        "domain.rejectRegWebsiteWhat" to
            "Le fournisseur n'a pas pu confirmer votre entreprise à partir du site " +
            "web que vous avez donné.",
        "domain.rejectRegWebsiteFix" to
            "Donnez un site web qui nomme votre entreprise et décrit ce que vous " +
            "faites, et assurez-vous qu'il s'affiche publiquement.",
        "domain.rejectRegConsentWhat" to
            "Le fournisseur n'a pas été convaincu que vos clients acceptent de " +
            "recevoir vos textos avant que vous leur écriviez.",
        "domain.rejectRegConsentFix" to
            "Décrivez exactement où un client vous donne son numéro et ce qu'on lui " +
            "dit à ce moment-là.",
        "domain.rejectRegSampleWhat" to
            "Les exemples de textos n'ont pas montré au fournisseur ce que vous " +
            "envoyez réellement.",
        "domain.rejectRegSampleFix" to
            "Utilisez de vrais messages que vous enverriez à un client, et incluez " +
            "le nom de votre entreprise dans chacun.",
        "domain.rejectRegUseCaseWhat" to
            "Le cas d'utilisation que vous avez choisi ne correspond pas à ce que " +
            "décrivent vos exemples et votre site web.",
        "domain.rejectRegUseCaseFix" to
            "Choisissez la catégorie qui correspond aux textos que vous envoyez " +
            "réellement à vos clients.",
        "domain.rejectRegDuplicateWhat" to
            "Cette entreprise est déjà inscrite auprès des fournisseurs, fort " +
            "probablement par un service que vous utilisiez auparavant.",
        "domain.rejectRegDuplicateFix" to
            "Répondez-nous et nous ferons libérer ou transférer l'inscription " +
            "existante — le formulaire ne peut rien y changer.",
        "domain.rejectRegEntityWhat" to
            "Le type d'entreprise que vous avez choisi ne correspond pas à la façon " +
            "dont votre entreprise est inscrite.",
        "domain.rejectRegEntityFix" to
            "Choisissez le type qui correspond à vos documents — une entreprise " +
            "individuelle et une société par actions ne s'inscrivent pas de la même " +
            "façon.",
        "domain.rejectRegContactWhat" to
            "Le fournisseur n'a pas pu joindre les coordonnées inscrites sur la " +
            "demande.",
        "domain.rejectRegContactFix" to
            "Donnez un courriel et un numéro de téléphone d'entreprise qui joignent " +
            "une personne et qui ne répondent pas automatiquement.",
        "domain.rejectPortAccountWhat" to
            "Le numéro de compte ne correspond pas à celui que votre fournisseur " +
            "actuel a au dossier.",
        "domain.rejectPortAccountFix" to
            "Copiez-le sur une facture récente de ce fournisseur — ce n'est " +
            "habituellement pas le numéro de téléphone lui-même.",
        "domain.rejectPortPinWhat" to "Le NIP de transfert était absent ou erroné.",
        "domain.rejectPortPinFix" to
            "Demandez un NIP de transfert à votre fournisseur actuel — la plupart ne " +
            "le donnent qu'au titulaire du compte, et il expire souvent en quelques " +
            "jours.",
        "domain.rejectPortAuthWhat" to
            "La personne nommée sur la demande n'est pas autorisée sur le compte.",
        "domain.rejectPortAuthFix" to
            "Utilisez le nom de la personne que votre fournisseur actuel a comme " +
            "titulaire du compte, écrit de la même façon.",
        "domain.rejectPortEntityWhat" to
            "Le nom du titulaire du compte ne correspond pas aux dossiers de votre " +
            "fournisseur actuel.",
        "domain.rejectPortEntityFix" to
            "Utilisez le nom exactement tel qu'il apparaît sur la facture, y compris " +
            "tout Ltd, Inc ou LLC.",
        "domain.rejectPortAddressWhat" to
            "L'adresse de service ne correspond pas à celle que votre fournisseur " +
            "actuel a au dossier.",
        "domain.rejectPortAddressFix" to
            "Utilisez l'adresse figurant sur la facture de cette ligne, même si " +
            "l'entreprise a déménagé depuis.",
        "domain.rejectPortPendingWhat" to
            "Votre fournisseur actuel a un autre changement en cours sur cette ligne.",
        "domain.rejectPortPendingFix" to
            "Demandez-lui de l'annuler ou de le terminer, puis dites-le-nous et nous " +
            "renverrons la demande.",
        "domain.rejectPortInactiveWhat" to
            "Votre fournisseur actuel indique que ce numéro n'est pas actif sur le " +
            "compte que nous avons cité.",
        "domain.rejectPortInactiveFix" to
            "Vérifiez que le numéro est encore en service et rattaché au compte que " +
            "vous nous avez donné — un numéro déjà résilié ne peut pas être transféré.",
        "domain.resubmitWaitRegistration" to
            "La plupart des renvois sont tranchés en un ou deux jours ouvrables.",
        "domain.resubmitWaitPort" to
            "La plupart des transferts renvoyés sont acceptés en quelques jours " +
            "ouvrables.",

        // ── Why a text did not arrive ────────────────────────────────────────
        "domain.sendFailureGeneric" to "Non livré",
        "domain.sendFailureOptedOut" to "Ce client s'est désabonné",
        "domain.sendFailureUnreachable" to "Ce numéro ne peut pas recevoir de textos",
        "domain.sendFailureNotTextable" to "Ce numéro n'accepte pas les textos",
        "domain.sendFailureBlockedNow" to
            "Les fournisseurs bloquent ce message en ce moment",
        "domain.sendFailureSpam" to "Les fournisseurs l'ont bloqué comme pourriel",
        "domain.sendFailureRateLimited" to
            "Envoyé trop vite pour les fournisseurs. Réessayez sous peu",
        "domain.sendFailureHandsetRejected" to "Son téléphone l'a refusé",
        "domain.sendFailureHandsetUnavailable" to
            "Son téléphone n'a pas pu le recevoir",
        "domain.sendFailureExpired" to "Il a expiré avant de pouvoir partir",
        "domain.sendFailureContent" to "Les fournisseurs ont refusé ce message",
        "domain.sendFailureEmpty" to "Il n'y avait rien à envoyer",
        "domain.sendFailureAttachment" to
            "Les fournisseurs ont refusé cette pièce jointe",
        "domain.sendFailureTooLong" to "Trop long pour être envoyé",
        "domain.sendFailureRegistration" to
            "Votre inscription pour les textos américains n'est pas encore approuvée",
        "domain.sendFailureNumberNotReady" to
            "Ce numéro n'est pas encore configuré pour les textos",
        "domain.sendFailureTextingOff" to "Les textos sont désactivés pour ce numéro",
        "domain.sendFailureNoSms" to "Ce numéro ne peut pas envoyer de textos",
        "domain.sendFailureNoMms" to "Ce numéro ne peut pas envoyer d'images",

        // ── Where a task's address came from (#214) ──────────────────────────
        "domain.addrFromMessage" to "D'après le message",
        "domain.addrFromContact" to "D'après le client",
        "domain.addrFromAreaCode" to "Déduite de l'indicatif régional",

        // ── When Lou has no draft to offer ───────────────────────────────────
        // Copied from web's `thread.ts`: the same refusals, the same words.
        "domain.draftsDisabled" to
            "La rédaction est désactivée pour cet espace de travail. Paramètres, IA " +
            "permet de la réactiver.",
        "domain.draftsSpam" to
            "Cette conversation est marquée comme indésirable, alors Lou la saute. " +
            "Retirez la marque pour rédiger une réponse.",
        "domain.draftsNothingToReply" to
            "Rien à quoi répondre pour l'instant. Écrivez quelques mots et réessayez.",
        "domain.draftsOverCap" to
            "La rédaction de ce mois-ci est épuisée. Elle reprend le mois prochain.",
        "domain.draftsRateLimited" to
            "Cela fait beaucoup de propositions d'un coup. Réessayez dans un moment.",
        "domain.draftsUnusable" to
            "Rien de valable à envoyer n'est revenu. Réessayez, ou ajoutez d'abord " +
            "quelques mots.",
        "domain.draftsNone" to "Aucune proposition cette fois-ci. Réessayez.",
        "domain.louUnreachable" to "Impossible de joindre Lou pour l'instant. Réessayez.",
        "domain.louPausedForBilling" to
            "Lou est en pause le temps de régler l'abonnement. Un propriétaire peut " +
            "corriger cela dans Facturation.",

        // ── The catch-up (#247) ──────────────────────────────────────────────
        "domain.catchUpSectionAsked" to "Ce que le client a demandé",
        "domain.catchUpSectionWeSaid" to "Ce que votre équipe a répondu",
        "domain.catchUpSectionOpen" to "Ce qui reste en suspens",
        "domain.catchUpAttribution" to
            "Lou a lu cette conversation. Touchez une ligne pour voir le message " +
            "d'où elle vient.",
        "domain.catchUpDisabled" to
            "Les rattrapages sont désactivés pour cet espace de travail. Paramètres, " +
            "Lou permet de les réactiver.",
        "domain.catchUpSpam" to
            "Cette conversation est marquée comme indésirable, alors Lou la saute. " +
            "Retirez la marque pour obtenir un rattrapage.",
        "domain.catchUpTooShort" to
            "Cette conversation se lit plus vite qu'un rattrapage. Lou garde les " +
            "rattrapages pour les longues.",
        "domain.catchUpOverCap" to
            "Les rattrapages de ce mois-ci sont épuisés. Ils reprennent le mois " +
            "prochain.",
        "domain.catchUpRateLimited" to
            "Cela fait beaucoup de rattrapages d'un coup. Réessayez dans un moment.",
        "domain.catchUpNotAllowed" to
            "Vous pouvez lire cette conversation, mais pas demander un rattrapage à " +
            "Lou. Un propriétaire ou un administrateur peut modifier votre accès.",
        "domain.catchUpUnusable" to
            "Rien n'est revenu que Lou puisse pointer dans la conversation, alors il " +
            "n'y a rien à afficher.",
        "domain.catchUpNone" to "Aucun rattrapage cette fois-ci. Réessayez.",

        // ── Who is holding the phone tonight (#244) ──────────────────────────
        // "Quart" for a shift, as web's on-call card already says.
        "domain.onCallPresetTonight" to "Ce soir",
        "domain.onCallPresetTonightDetail" to "De 18 h à 8 h demain",
        "domain.onCallPresetWeekend" to "Cette fin de semaine",
        "domain.onCallPresetWeekendDetail" to "Du vendredi 18 h au lundi 8 h",
        "domain.onCallPresetWeek" to "Les 7 prochains jours",
        "domain.onCallPresetWeekDetail" to "À partir de maintenant",
        "domain.onCallNobody" to
            "Personne n'est de garde, alors un appel en dehors des heures réveille " +
            "toutes les personnes qui voient le numéro. Mettez une seule personne de " +
            "garde et le reste de l'équipe passe une nuit tranquille.",
        "domain.onCallUntil" to "de garde jusqu'à",
        "domain.onCallLine" to "{name} est de garde jusqu'à {until}",
        "domain.onCallEscalation" to
            "Si cette personne ne répond pas, tout le monde est prévenu quelques " +
            "minutes plus tard.",
        "domain.onCallReadOnly" to
            "Seul un propriétaire ou un administrateur peut changer qui est de garde.",
        "domain.onCallBannerWaiting" to "Personne ne s'en est encore occupé",
        "domain.onCallBannerClaim" to "Je m'en occupe",
        "domain.onCallBannerTaken" to "s'en occupe",
        "domain.onCallTakenLine" to "{name} s'en occupe",
        "domain.onCallBannerYours" to
            "Vous vous en occupez. Le reste de l'équipe a été prévenu.",

        // ── A member's own quiet hours (#244) ────────────────────────────────
        "domain.quietHoursHeading" to "Heures de silence",
        "domain.quietHoursReassurance" to
            "Votre téléphone reste silencieux pour les messages ordinaires. Si vous " +
            "êtes de garde, ou si une alerte que personne n'a prise s'élargit à " +
            "l'équipe, elle passe quand même.",
        "domain.quietHoursOff" to
            "Désactivé — toutes les notifications vous parviennent à toute heure.",
        "domain.quietHoursOn" to "Silence à partir de",
        "domain.quietHoursLine" to "Silence de {from} à {to}",
        "domain.quietHoursScope" to "Ceci s'applique à cet espace de travail seulement.",

        // ── How loud each kind of notification is (#297) ─────────────────────
        "domain.deliveryHeading" to "Ce que nous vous disons",
        "domain.deliveryUrgentAlways" to
            "Une urgence, un appel pendant que vous êtes de garde, ou une alerte que " +
            "personne n'a prise arrive toujours immédiatement, quel que soit votre " +
            "choix ici.",
        "domain.deliveryImmediate" to "Immédiatement",
        "domain.deliveryBatched" to "Regroupées",
        "domain.deliverySummary" to "Une fois par jour",
        "domain.deliverySummaryDetail" to
            "Conservées pour votre résumé quotidien, pas supprimées.",
        "domain.categoryMessagesMine" to "Textos sur mes tâches",
        "domain.categoryMessagesAll" to "Textos sur les tâches de tout le monde",
        "domain.categoryMentions" to "Quand quelqu'un me mentionne avec @",
        "domain.categoryAssignments" to "Travail qui m'est confié",
        "domain.categoryMissedCalls" to "Appels manqués",
        "domain.categoryVoicemails" to "Messages vocaux",

        // ── Going quiet while you are the one on call (#538) ─────────────────
        "domain.onCallSilenceConfirm" to "La désactiver quand même",
        "domain.onCallSilenceCancel" to "La laisser activée",
        "domain.onCallSilenceChannelPush" to "Les alertes push",
        "domain.onCallSilenceChannelEmail" to "Les courriels",
        // Phrased so the sentence works whichever channel fills {what}: the two
        // do not share a gender, and an agreement written for one would be wrong
        // for the other on the screen where it matters most.
        "domain.onCallSilenceWarning" to
            "Vous êtes de garde en ce moment. {what} sont la façon dont un nouveau " +
            "client à qui personne n'a répondu vous joint. Avec ce réglage " +
            "désactivé, ces appels ne mènent nulle part et personne d'autre n'est " +
            "prévenu. Passez le quart à quelqu'un d'abord si vous devez être " +
            "injoignable.",

        // ── Why a scheduled text did not go (#233) ───────────────────────────
        "domain.scheduledHoldSubscriptionInactive" to
            "Votre abonnement a expiré, alors ceci n'a pas été envoyé. Le message " +
            "partira une fois la facturation réglée.",
        "domain.scheduledHoldWorkspacePaused" to
            "Votre forfait est en pause, alors ceci n'a pas été envoyé. Le message " +
            "partira à votre reprise.",
        "domain.scheduledHoldRegistrationPending" to
            "Ceci attend l'approbation des fournisseurs pour les textos américains. " +
            "Le message partira dès que ce sera approuvé.",
        "domain.scheduledHoldServiceUnavailable" to
            "Les textos sont en pause pendant que nous réglons un problème. Ceci est " +
            "toujours en file et rien n'a été perdu.",
        "domain.scheduledHoldCustomerReplied" to
            "Le client a répondu après votre programmation, alors nous avons retenu " +
            "le message plutôt que de lui couper la parole. Envoyez-le quand même, " +
            "ou annulez-le.",
        // STOP is the carrier's keyword and never translated: the customer types
        // the same five letters in Montreal as in Denver.
        "domain.scheduledHoldOptedOut" to
            "Le client a répondu STOP après votre programmation, alors le message " +
            "n'a pas été envoyé. Lui seul peut annuler cela.",
        "domain.scheduledHoldInvalidDestination" to
            "Nous ne pouvons plus texter ce numéro, alors ceci n'a pas été envoyé.",
        "domain.scheduledHoldExpired" to
            "La fenêtre d'envoi est passée avant que ceci ne parte, alors le message " +
            "n'a pas été envoyé. Un message en retard vaut habituellement moins que " +
            "pas de message du tout.",
        "domain.scheduledHoldWorkspaceClosed" to
            "L'espace de travail a été fermé avant l'heure d'envoi prévue.",
        "domain.scheduledHoldJobUnscheduled" to
            "Cette tâche n'est plus prévue, alors ce rappel n'a pas été envoyé.",
        "domain.scheduledPickerReassurance" to
            "Vous pouvez le modifier ou l'annuler à tout moment avant l'envoi.",
        "domain.scheduledQuietHoursChoice" to
            "Vous pouvez l'envoyer quand même, ou choisir une heure le matin chez eux.",
        "domain.scheduledQuietHoursUnknown" to
            "Cette heure tombe dans les heures de silence de ce client.",
        "domain.scheduledCancelled" to "Annulé — ce texto ne partira pas.",
        "domain.scheduledNothingWaiting" to
            "Rien n'est en attente d'envoi. Tout ce que vous programmez apparaît ici.",
        "domain.clockTheirTimeContact" to "son heure locale, définie sur sa fiche",
        "domain.clockTheirTimeAreaCode" to
            "son heure locale, d'après son indicatif régional",
        "domain.clockWorkspaceTime" to
            "l'heure de votre espace de travail — nous ne connaissons pas la sienne",
        "domain.scheduledPresetTomorrow" to "Demain, 8 h",
        "domain.scheduledPresetMonday" to "Lundi, 8 h",
        "domain.scheduledPresetCustom" to "Choisir une heure",

        // ── Referring another crew (#288/#399) ───────────────────────────────
        // "Une seule boîte de réception" is the claim, exactly as the tagline
        // makes it. The number stays possessive and is never counted.
        "domain.referralNote" to
            "Nous passons notre ligne d'affaires par Loonext — les appels et les " +
            "textos arrivent dans une seule boîte de réception et la personne libre " +
            "répond. Prix fixe, aucuns frais par utilisateur. Inscrivez-vous avec " +
            "mon lien et nous obtenons tous les deux un mois gratuit.",
        "domain.referralTitle" to "Recommander une autre équipe",
        "domain.referralRewardLine" to
            "Envoyez ceci à une autre entreprise. Quand elle s'inscrit et qu'un " +
            "client lui répond par texto, vous obtenez tous les deux un mois gratuit",
        "domain.referralStageInvited" to "Inscrite, aucune réponse encore",
        "domain.referralStageSignedUp" to "En service",
        "domain.referralStageActive" to "Toujours active après 30 jours",
        "domain.referralStageRewarded" to "Mois gratuit appliqué",
        "domain.referralStageVoided" to "Non comptabilisée",
        "domain.referralAction" to "Partager",
        "domain.referralCopy" to "Copier",
        "domain.referralCopied" to "Copié",
        "domain.referralDraftLabel" to "Votre message",
        "domain.referralLinkNote" to "Votre lien s'ajoute automatiquement à la fin.",
        "domain.referralAskBody" to
            "Vous connaissez une autre équipe qui fait encore rouler son entreprise " +
            "sur le cellulaire d'une seule personne ? Envoyez-lui votre lien — vous " +
            "obtenez tous les deux un mois gratuit.",
        "domain.referralAskAction" to "Partager votre lien",
        "domain.referralAskDismiss" to "Pas maintenant",
        "domain.referralCodeFallback" to "Utilisez mon code {code} à votre inscription.",
        "domain.referralAskHeadlineOne" to "Vous avez répondu à 1 client ce mois-ci.",
        "domain.referralAskHeadlineMany" to
            "Vous avez répondu à {count} clients ce mois-ci.",

        // ── Which measures a member may put away (#540) ──────────────────────
        "domain.panelResponseTime" to "Temps de réponse",
        "domain.panelPipeline" to "Devis",
        "domain.panelSatisfaction" to "Satisfaction",
        "domain.panelLeadSources" to "D'où viennent vos clients",
        "domain.panelRecentCalls" to "Appels récents",
        "domain.panelResponseTimeNote" to
            "À quelle vitesse les nouveaux clients ont eu une réponse cette semaine.",
        "domain.panelPipelineNote" to
            "Ce que vous avez proposé en devis ce mois-ci, et quelle part vous avez " +
            "décrochée.",
        "domain.panelSatisfactionNote" to
            "Si les personnes à qui vous avez répondu étaient satisfaites.",
        "domain.panelLeadSourcesNote" to
            "Quels canaux amènent réellement du travail.",
        "domain.panelRecentCallsNote" to "Les derniers appels, entrants et sortants.",

        // ── Confirming a handover of the business (#537) ─────────────────────
        "domain.handoverTitle" to "Confirmez votre identité",
        "domain.handoverWhereAuthenticator" to
            "Ouvrez votre application d'authentification et entrez le code à six " +
            "chiffres qu'elle affiche.",
        "domain.handoverWhereEmail" to
            "Nous avons envoyé un code à six chiffres par courriel à l'adresse de " +
            "votre compte. Il fonctionne une seule fois et expire dans dix minutes.",
        "domain.handoverField" to "Code à six chiffres",
        "domain.handoverSubmit" to "Confirmer",
        "domain.handoverResend" to "Envoyer de nouveau",
        "domain.handoverRejected" to
            "Ce code n'a pas fonctionné. Demandez-en un nouveau et réessayez.",

        // ── An arrow and a circle on a photo (#294) ──────────────────────────
        "domain.markupArrow" to "Flèche",
        "domain.markupCircle" to "Cercle",
        "domain.markupHint" to
            "Glissez sur la photo, ou touchez deux fois, pour pointer quelque chose.",
        "domain.markupHintSecondTap" to "Touchez maintenant l'endroit à pointer.",
        "domain.markupSave" to "Terminé",
        "domain.markupUndo" to "Annuler",

        // ── Before and after (#294) ──────────────────────────────────────────
        "domain.workPhaseBefore" to "Avant",
        "domain.workPhaseAfter" to "Après",
        "domain.workPhaseUnset" to "Ni un avant ni un après",
        "domain.workPhaseHint" to
            "Marque ces photos comme l'état à votre arrivée, ou l'état à votre départ.",
        "domain.jobPhaseCountBefore" to "{count} avant",
        "domain.jobPhaseCountAfter" to "{count} après",

        // ── When a snoozed thread comes back (#293) ──────────────────────────
        // "De retour", as web's snooze menu already says.
        "domain.snoozePresetAfternoon" to "Cet après-midi",
        "domain.snoozePresetEvening" to "Ce soir",
        "domain.snoozePresetTomorrow" to "Demain matin",
        "domain.snoozePresetNextWeek" to "Semaine prochaine",
        "domain.followUpPresetThreeDays" to "Dans 3 jours",
        "domain.followUpPresetTwoWeeks" to "Dans 2 semaines",
        "domain.snoozeFallback" to "Reportée",
        "domain.snoozeBackAt" to "De retour à {time}",
        "domain.snoozeBackTomorrow" to "De retour demain, {time}",
        "domain.snoozeBackWeekday" to "De retour {day}, {time}",
        "domain.snoozeBackDate" to "De retour le {date}",

        // ── How long before an appointment a reminder goes (#237) ────────────
        "domain.reminderOffsetDayBefore" to "La veille",
        "domain.reminderOffsetDays" to "{count} jours avant",
        "domain.reminderOffsetHour" to "1 heure avant",
        "domain.reminderOffsetHours" to "{count} heures avant",
        "domain.reminderOffsetMinutes" to "{count} minutes avant",

        // ── One instant, two wall clocks (#539) ──────────────────────────────
        "domain.twoClocksThere" to "à leur heure",
        "domain.twoClocksHere" to "à la vôtre",
        "domain.twoClocksLine" to "{there} à leur heure · {here} à la vôtre",
        "domain.twoClocksSpoken" to
            "{there} à leur heure, ce qui fait {here} à la vôtre",
        "domain.twoClocksAreaCodeNote" to
            "Les règles sur les heures où vous pouvez texter suivent leur horloge, " +
            "pas la vôtre. Si ce numéro a déménagé, réglez son fuseau horaire sur la " +
            "fiche du client.",
        "domain.twoClocksChoiceTheirs" to "Son heure locale",
        "domain.twoClocksChoiceYours" to "Votre heure locale",

        // ── Taking powers off yourself (#538) ────────────────────────────────
        "domain.capBilling" to "le forfait et la facturation",
        "domain.capSettings" to "les paramètres de l'espace de travail",
        "domain.capTeam" to "qui fait partie de l'équipe et ce que ces personnes peuvent faire",
        "domain.capNumbers" to "les numéros de téléphone",
        "domain.capHistory" to "le journal d'historique",
        "domain.capContactsBulk" to "l'importation et l'exportation des clients",
        "domain.selfDowngradeSomeOfWhat" to
            "une partie de ce que vous pouvez faire actuellement",
        "domain.selfDowngradeListPair" to "{first} et {last}",
        "domain.selfDowngradeMore" to "{list}, et {count} de plus",
        "domain.selfDowngradeUndo" to
            " Vous ne pourrez pas revenir en arrière vous-même — seul un " +
            "propriétaire le peut.",
        "domain.selfDowngradeWarning" to "Vous perdrez l'accès à {scope}.{undo}",
        "domain.and" to "et",
    )
}
