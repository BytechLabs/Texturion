package com.loonext.android.core.i18n

/**
 * #228 — the second half of Settings: numbers, the team, usage, and everything
 * a workspace configures once and then argues about later.
 *
 * The register is the one `CommonStrings` sets out: Quebec French,
 * VOUVOIEMENT, accents spelled normally, a normal space before `:`. Product
 * names (Loonext, Stripe, Telnyx, Lou) and the carrier keywords (STOP, HELP,
 * START, URGENT) are NEVER translated — a carrier matches on those literally,
 * and a helpful translation of "STOP" is a customer who cannot opt out.
 *
 * Two things in this section are worth knowing before adding to it:
 *
 * - **Some sentences are assembled from a stem and a tail.** A switch that a
 *   member may read but not change says so at the END of its own description,
 *   rather than in a second line somewhere else. Splitting it means the long
 *   part is written once instead of twice, which is the only version that
 *   cannot drift between the two halves.
 * - **The carrier's and the registry's own words are not here.** A rejection
 *   reason, a Stripe requirement, an API refusal — each is rendered verbatim
 *   because it is somebody else's sentence, and a translation of it here would
 *   be a second copy that goes stale the moment they reword theirs.
 */
object SettingsMoreStrings : AppStrings.Section {
    override val en = mapOf(
        // -- Notifications ---------------------------------------------------
        "settingsMore.notifAlwaysOn" to
            "Billing, usage, and registration emails always go to owners and admins. " +
            "They can't be turned off.",
        "settingsMore.leadChaseLabel" to "Tell the whole crew after {minutes} minutes",
        "settingsMore.leadChaseSupporting" to
            "When a conversation is assigned to one person and they still haven't " +
            "replied, notify everyone who can see it. Business hours only, and never " +
            "someone who has turned their own notifications off. This one is for the " +
            "whole workspace, not just you",
        "settingsMore.pushContentLabel" to "Show message text on lock screens",
        "settingsMore.pushContentSupporting" to
            "Notifications show who texted and the first line of what they said, " +
            "so the crew can tell a lead from a \"thanks\" without unlocking. Turn this " +
            "off and they'll still see who it was, but never what a customer wrote — " +
            "useful if phones are out on the job, in other people's homes. This one is " +
            "for the whole workspace, not just you",
        // The two ways the sentence above finishes. A clause rather than a
        // whole second copy of the paragraph, so the long half is written once.
        "settingsMore.workspaceWideEnd" to ".",
        "settingsMore.workspaceWideAdminsOnly" to
            " — only owners and admins can change it.",
        "settingsMore.emailUnreachableTitle" to "We can't email you at {email}",
        "settingsMore.emailBouncingBody" to
            "Emails to this address are bouncing, so we've stopped sending them. " +
            "Push notifications still work. If the address was mistyped, fix it " +
            "in your account first, then tell us to try again.",
        "settingsMore.emailRetryQueued" to
            "We'll try that address again on your next notification.",
        "settingsMore.emailRetrying" to "Trying…",
        "settingsMore.emailRetryAction" to "Try this address again",
        "settingsMore.emailComplainedBody" to
            "This address reported our email as spam, so we've stopped sending to " +
            "it for good. Push notifications still work. To get email again, " +
            "change your account to a different address.",

        // -- On call ---------------------------------------------------------
        "settingsMore.onCallTitle" to "On call",
        "settingsMore.onCallChecking" to "Checking the rota…",
        "settingsMore.onCallEndShift" to "End shift",
        "settingsMore.onCallPut" to "Put somebody on call",
        "settingsMore.onCallNowOn" to "{name} is on call",
        "settingsMore.someone" to "Someone",
        "settingsMore.remove" to "Remove",

        // -- One number's own clock and identity ------------------------------
        "settingsMore.loading" to "Loading…",
        // "Use the workspace's" rather than "Clear": clear implies empty, and
        // empty is the one thing it cannot mean — the line goes back to the
        // workspace's greeting rather than falling silent.
        "settingsMore.inheritSame" to "Same as your workspace",
        "settingsMore.inheritUse" to "Use the workspace's",
        "settingsMore.numberHoursTitle" to "When this line is open",
        "settingsMore.numberHoursIntro" to
            "The after-hours reply on this number follows this clock. " +
            "Leave it alone and it follows your workspace.",
        "settingsMore.timezone" to "Timezone",
        "settingsMore.chooseTimezone" to "Choose a timezone",
        "settingsMore.openHours" to "Open hours",
        "settingsMore.numberIdentityTitle" to "How this line answers",
        "settingsMore.numberIdentityIntro" to
            "Anything you leave alone follows your workspace. Change one " +
            "here and it only affects this number.",
        "settingsMore.voicemailVoice" to "Voicemail voice",
        "settingsMore.writtenGreeting" to "The written greeting, read aloud",
        "settingsMore.recordingFallbackHint" to
            "A recording that will not play falls back to the " +
            "words below, so a caller never hears silence.",
        "settingsMore.afterHoursCalls" to "After-hours calls",
        "settingsMore.afterHoursRingEveryone" to "Ring everyone, day or night",
        "settingsMore.afterHoursOnCallOnly" to "Ring only whoever's on call",
        "settingsMore.afterHoursVoicemail" to "Take a message",
        "settingsMore.afterHoursHint" to
            "Outside this line's hours. With nobody on call, the " +
            "last two still differ — one rings the crew anyway, " +
            "the other takes a message.",
        "settingsMore.ringHow" to "How the phones ring",
        "settingsMore.ringAll" to "All at once",
        "settingsMore.ringInTurn" to "One at a time",
        "settingsMore.ringHowLong" to "How long they ring",
        "settingsMore.ringSeconds" to "{seconds} seconds",
        "settingsMore.lineNameTitle" to "Name for this line",
        "settingsMore.lineNameHint" to
            "Used in the greeting, on missed-call texts, and " +
            "wherever this line introduces itself.",
        "settingsMore.voicemailGreetingTitle" to "Voicemail greeting",
        "settingsMore.voicemailGreetingHint" to
            "What a caller hears when nobody picks up.",
        "settingsMore.afterHoursReplyTitle" to "After-hours reply",
        "settingsMore.afterHoursReplyHint" to
            "The text sent when somebody messages this line outside your hours.",
        "settingsMore.missedCallBackTitle" to "Text back a missed caller",
        "settingsMore.missedCallBackHint" to
            "Sent from this line when a call goes unanswered.",
        "settingsMore.missedCallTextTitle" to "Missed-call text",
        "settingsMore.missedCallTextHint" to
            "What a caller gets when nobody picks up and they hang up.",

        // -- Picking a number ------------------------------------------------
        "settingsMore.areaCode" to "Area code",
        "settingsMore.containsDigits" to "Contains digits",
        // Assembled: the clause is optional because a picker with no area code
        // typed yet has no place to name.
        "settingsMore.maskedPick" to
            "Canadian numbers are assigned when the order goes through, so your " +
            "pick here is the area code. There are numbers available{where}.",
        "settingsMore.inAreaCode" to " in {areaCode}",
        "settingsMore.enterAreaCode" to "Enter the 3-digit area code you want above.",
        "settingsMore.ordering" to "Ordering…",
        "settingsMore.useAreaCode" to "Use area code {areaCode}",
        "settingsMore.noNumbersIn" to
            "No numbers in {areaCode} right now. Nearby area codes usually have plenty.",
        "settingsMore.thatAreaCode" to "that area code",
        "settingsMore.showNearby" to "Show nearby numbers",
        "settingsMore.noNumberContains" to
            "No available number contains \"{digits}\". Loosen the filter " +
            "or refresh for a new batch.",
        "settingsMore.noNumbersBack" to
            "No numbers came back. Refresh for a new batch, or try another area code.",
        "settingsMore.refresh" to "Refresh",
        "settingsMore.showingNearby" to
            "Showing nearby numbers. The exact area code is out of stock.",
        "settingsMore.refreshList" to "Refresh the list",

        // -- The numbers a workspace holds -----------------------------------
        "settingsMore.yourNumber" to "Your number",
        "settingsMore.noNumberYet" to
            "No number yet. It's created automatically when your subscription starts.",
        "settingsMore.areaCodeIs" to "Area code {areaCode}",
        "settingsMore.sourcePorted" to "Transferred in",
        "settingsMore.sourceHosted" to "Text-enabled landline",
        // Loonext is the product's name, so it is the same word in both.
        "settingsMore.sourceLoonext" to "Loonext number",
        "settingsMore.phoneNumberClipLabel" to "Phone number",
        "settingsMore.copyNumber" to "Copy number",
        "settingsMore.numberCopied" to "Number copied.",
        "settingsMore.releasedAgo" to "Released {ago} ago.",
        "settingsMore.numberUnreliable" to
            "Messages from this number aren't arriving reliably",
        "settingsMore.chooseNumber" to "Choose a number",
        "settingsMore.chooseNumberFinish" to "Choose a number to finish setup",
        "settingsMore.whoCanUse" to "Who can use this number",
        "settingsMore.release" to "Release",
        "settingsMore.onlyAdminsManageNumbers" to
            "Only owners and admins can manage numbers.",
        "settingsMore.statusActive" to "Active",
        "settingsMore.statusSettingUp" to "Setting up",
        "settingsMore.statusSuspended" to "Suspended",
        "settingsMore.statusReleased" to "Released",
        "settingsMore.statusActionNeeded" to "Action needed",
        "settingsMore.statusFailed" to "Couldn't set up",
        "settingsMore.releaseTitle" to "Release {number}?",
        "settingsMore.releaseConfirm" to "Release number",
        "settingsMore.keepNumber" to "Keep the number",
        "settingsMore.typeToConfirm" to "Type {number} to confirm",
        "settingsMore.numberReleased" to "{number} released.",
        "settingsMore.codeSent" to "Sent. Check your email.",
        "settingsMore.numberBeingSetUp" to "Your number is being set up.",
        "settingsMore.setupRestarted" to "Setup restarted. You won't be charged again.",
        "settingsMore.addNumber" to "Add a number",
        // The reason is the server's own sentence, so it arrives already worded.
        "settingsMore.planNumbersInUse" to "Your plan's numbers are all in use. {reason}",
        "settingsMore.addNumberIncluded" to
            "Choose the number your customers will text. It's included in your " +
            "plan at no extra cost.",
        "settingsMore.addNumberPriced" to
            "An extra number is {price}, billed today. Your message allowance " +
            "is shared, so an extra number doesn't add messages.",
        "settingsMore.addNumberBilled" to
            "An extra number is billed to your plan today. Your message allowance " +
            "is shared, so an extra number doesn't add messages.",

        // -- Who can use one number ------------------------------------------
        "settingsMore.thisNumber" to "this number",
        "settingsMore.whoCanUseNumber" to "Who can use {number}?",
        "settingsMore.adminsAlwaysUse" to
            "Owners and admins can always use every number.",
        "settingsMore.noMembersToPick" to
            "No active members to pick. Everyone else on the team is an owner or admin.",
        "settingsMore.teammate" to "Teammate",
        "settingsMore.levelText" to "Can text",
        "settingsMore.levelNote" to "View & notes only",
        "settingsMore.pickAtLeastOne" to "Pick at least one person, or choose Everyone.",
        "settingsMore.accessUpdated" to "Access to {number} updated.",
        "settingsMore.accessEveryone" to "Everyone",
        "settingsMore.accessEveryoneDetail" to "The whole team can text, like today.",
        "settingsMore.accessMembersView" to "Members: view & notes only",
        "settingsMore.accessMembersViewDetail" to
            "Members can read and add notes, but not text. Admins still text.",
        "settingsMore.accessAdmins" to "Admins only",
        "settingsMore.accessAdminsDetail" to "Members can't see this number at all.",
        "settingsMore.accessUsers" to "Specific people",
        "settingsMore.accessUsersDetail" to "Only the people you pick. Admins still text.",
        "settingsMore.whatYouReach" to "What you can reach",
        "settingsMore.whatYouReachDesc" to
            "Some of this workspace's numbers are not shared with " +
            "you. Here is which, and what decided it.",
        "settingsMore.aNumber" to "A number",

        // -- Who owns the workspace ------------------------------------------
        /*
         * #228 — a handover in flight, which is the one place in Settings
         * where a person has a DEADLINE and a veto. Read in the wrong
         * language it reads as something that has already happened.
         */
        "settingsMore.ownershipOffered" to "Ownership has been offered to {name}.",
        "settingsMore.ownershipAskedToTakeOver" to
            "{name} has asked to take over this workspace.",
        "settingsMore.ownershipOfferExpires" to
            "Nothing changes until they accept. The offer expires {when}.",
        "settingsMore.ownershipWaitOver" to
            "The waiting period is over. They can complete this at any time.",
        "settingsMore.ownershipCompletesAt" to
            "This completes {when} unless the owner stops it. Stopping it " +
            "takes effect immediately.",
        /*
         * Same call, same outcome, two readers: an owner is vetoing something
         * aimed at them, and a recipient is turning something down.
         */
        "settingsMore.ownershipStopThis" to "Stop this",
        "settingsMore.ownershipTitle" to "Ownership",
        "settingsMore.ownershipCaption" to "OWNERSHIP",
        "settingsMore.ownershipDesc" to
            "The owner controls billing, the spending cap, and your numbers. " +
            "Only they can hand that on.",
        "settingsMore.owner" to "Owner",
        "settingsMore.you" to "You",
        "settingsMore.aTeammate" to "a teammate",
        "settingsMore.aTeammateCapital" to "A teammate",
        "settingsMore.them" to "them",
        "settingsMore.nobody" to "Nobody",
        "settingsMore.nobodyNamed" to "Nobody named",
        "settingsMore.backupOwner" to "Backup owner",
        "settingsMore.backupOwnerExplain" to
            "If you ever can't get in — you lose your email, or worse — this is the " +
            "one person who can ask to take over. They wait a week, you can stop " +
            "it with one click, and everyone gets told. Nothing changes today.",
        "settingsMore.inviteBackupFirst" to
            "Invite someone first — a backup has to be on the team.",
        "settingsMore.backupCleared" to "Backup owner cleared.",
        "settingsMore.backupSet" to "{name} is your backup owner.",
        "settingsMore.handOverTitle" to "Hand the workspace over",
        "settingsMore.handOverNote" to
            "They have to accept. You stay on the team as an admin.",
        "settingsMore.chooseTeammate" to "Choose a teammate",
        "settingsMore.handItOver" to "Hand it over",
        "settingsMore.handToTitle" to "Hand this workspace to {name}?",
        "settingsMore.handOverBody" to
            "Nothing changes until they accept. When they do, they control " +
            "billing, the spending cap, and your numbers — and you stay on the team " +
            "as an admin. You can cancel any time before they accept, and everyone " +
            "will be told either way.",
        "settingsMore.offerIt" to "Offer it",
        "settingsMore.offeredTo" to "Offered to {name}. They have 7 days to accept.",
        "settingsMore.youAreBackup" to "You are the backup owner",
        "settingsMore.claimExplain" to
            "If the owner can't act, you can ask to take over. They get a week to " +
            "stop it, and everyone on the team is told straight away.",
        "settingsMore.askTakeOver" to "Ask to take over",
        "settingsMore.claimTitle" to "Ask to take over this workspace?",
        "settingsMore.claimBody" to
            "The owner will be emailed straight away and can stop this with one " +
            "click for the next 7 days. Everyone on the team is told too. If nobody " +
            "stops it, you can complete the takeover after 7 days. Only do this if " +
            "the owner genuinely cannot act.",
        "settingsMore.claimAsked" to "Asked. The owner has 7 days to stop it.",
        "settingsMore.nowOwn" to "You now own this workspace.",
        "settingsMore.handoverStopped" to "Stopped. Nothing changed hands.",
        "settingsMore.acceptOwnership" to "Accept ownership",
        "settingsMore.completeTakeover" to "Complete the takeover",

        // -- Getting paid ----------------------------------------------------
        // The title and "Stripe still needs:" are PaymentsStrings' already; a
        // second copy here would be the drift the catalogue exists to prevent.
        "settingsMore.onlyOwnerConnectsBank" to
            "Only the owner can connect the bank account. Once they " +
            "have, you can open Stripe from here to issue refunds " +
            "and read payouts.",
        "settingsMore.opening" to "Opening…",
        "settingsMore.payouts" to "Payouts",
        "settingsMore.payoutsOn" to "On — money reaches your bank",
        "settingsMore.payoutsOff" to "Stripe has not switched payouts on yet",
        "settingsMore.chargedIn" to "Charged in",
        "settingsMore.stripeDashboardNote" to
            "Refunds, receipts and payout history all live in your Stripe " +
            "dashboard. We never hold your money and we take nothing on " +
            "top of what you charge — Stripe's own card fee is the only " +
            "deduction.",

        // -- Bringing a number in from another carrier -----------------------
        // SSN stays SSN — it is a US federal identifier and the form is filled
        // from a US carrier's bill. SIN's French name in Quebec is NAS, and a
        // Montreal owner reading "SIN" would be looking for a field their
        // paperwork does not have.
        "settingsMore.ssnLabel" to "SSN",
        "settingsMore.sinLabel" to "SIN",
        "settingsMore.stateLabel" to "State",
        "settingsMore.provinceLabel" to "Province",
        "settingsMore.zipLabel" to "ZIP code",
        "settingsMore.postalLabel" to "Postal code",
        "settingsMore.portFormIntro" to
            "Enter these exactly as they appear on your current carrier's bill. " +
            "Mismatches are the top cause of rejections.",
        "settingsMore.accountHolder" to "Account holder",
        "settingsMore.authorizedPerson" to "Authorized person",
        "settingsMore.accountNumber" to "Account number",
        "settingsMore.portWirelessNote" to
            "This is a mobile number. Enter the transfer PIN and the last 4 of the " +
            "account holder's {idLabel}. We store only the last 4.",
        "settingsMore.transferPin" to "Transfer PIN",
        "settingsMore.last4Of" to "Last 4 of {idLabel}",
        "settingsMore.streetAddress" to "Street address",
        "settingsMore.city" to "City",
        "settingsMore.bringNumber" to "Bring your existing number",
        "settingsMore.bringNumberDesc" to
            "Transfer a number you already own. It keeps working with " +
            "your current carrier until the switch completes, usually a few " +
            "business days. Transfers are free.",
        "settingsMore.startTransfer" to "Start a transfer",
        "settingsMore.transferTitle" to "Transfer: {number}",
        "settingsMore.focDate" to "The carriers agreed on a switch date: {date}.",
        "settingsMore.bridgeNumber" to "Temporary number while you wait: {number}.",
        "settingsMore.registrationHeld" to
            "Your number arrived, but its texting registration is still held by " +
            "your previous texting provider. Ask them to release it, and " +
            "texting switches on automatically.",
        "settingsMore.transferSubmitted" to "Transfer submitted to the carriers.",
        "settingsMore.submitting" to "Submitting…",
        "settingsMore.submitTransfer" to "Submit transfer",
        "settingsMore.fixResubmit" to "Fix and resubmit",
        "settingsMore.cancelTransfer" to "Cancel transfer",
        "settingsMore.cancelTransferTitle" to "Cancel this transfer?",
        "settingsMore.cancelTransferBody" to
            "Your number stays with your current carrier and nothing changes " +
            "there. You can start a new transfer any time.",
        "settingsMore.keepItGoing" to "Keep it going",
        "settingsMore.transferCancelled" to "Transfer cancelled.",
        "settingsMore.beforeSwitch" to "Before your number switches",
        // The order is the copy here: cancelling early is the one mistake that
        // can genuinely lose the number, so it stays first in both languages.
        "settingsMore.cutoverKeepOld" to "Keep your old service active.",
        "settingsMore.cutoverKeepOldDetail" to
            "Cancelling before the transfer finishes can release the number back to " +
            "the carrier, and that is the one way to genuinely lose it.",
        "settingsMore.cutoverExport" to "Export your message history.",
        "settingsMore.cutoverExportDetail" to
            "The number moves, your old conversations do not.",
        "settingsMore.cutoverTellCrew" to "Tell the crew the switch date.",
        "settingsMore.cutoverTellCrewDetail" to
            "From that morning, calls and texts arrive in this inbox instead of the " +
            "old one.",
        "settingsMore.cutoverTextsTrail" to "Expect texting to trail calls.",
        "settingsMore.cutoverTextsTrailDetail" to
            "Voice and texting can finish on different clocks, so texts may take an " +
            "extra day. We will tell you when both are live.",
        "settingsMore.loaUploaded" to "Letter of authorization uploaded.",
        "settingsMore.billUploaded" to "Carrier bill uploaded.",
        "settingsMore.portDocsNote" to
            "Two documents are needed: a signed letter of authorization and a recent " +
            "bill from your current carrier (PDF, PNG, or JPEG).",
        "settingsMore.replaceLoa" to "Replace LOA ✓",
        "settingsMore.uploadLoa" to "Upload LOA",
        "settingsMore.replaceBill" to "Replace bill ✓",
        "settingsMore.uploadBill" to "Upload bill",
        "settingsMore.uploading" to "Uploading…",
        "settingsMore.numberToTransfer" to "Number to transfer",
        "settingsMore.phoneSample" to "(416) 555-0182",
        "settingsMore.notPortable" to "That number can't be transferred automatically.",
        "settingsMore.canBeTransferred" to "{number} can be transferred.",
        "settingsMore.wirelessRequires" to
            " It's a mobile number, so a transfer PIN and ID check are required.",
        "settingsMore.mayNotText" to
            "Heads up: this number may not support texting after the " +
            "transfer. Calls will still work.",
        "settingsMore.wantBridge" to "Give me a temporary number while it transfers",
        "settingsMore.wantBridgeSupporting" to
            "Optional. Texting starts right away on the " +
            "temporary number; your own number takes over when the " +
            "transfer completes.",
        "settingsMore.enterFullNanp" to "Enter a full 10-digit US or Canadian number.",
        "settingsMore.checking" to "Checking…",
        "settingsMore.checkNumber" to "Check the number",
        "settingsMore.transferCreated" to
            "Transfer created. Upload the two documents to submit it.",
        "settingsMore.creating" to "Creating…",
        "settingsMore.createTransfer" to "Create the transfer",
        "settingsMore.reenterSecrets" to
            "The account number and PIN are never shown back for security. " +
            "Re-enter them.",
        "settingsMore.transferResubmitted" to "Transfer resubmitted.",
        "settingsMore.resubmitting" to "Resubmitting…",
        "settingsMore.resubmit" to "Resubmit",

        // -- A carrier or registry refusal -----------------------------------
        // The refusal ITSELF stays the carrier's own words; only our framing
        // around it is here.
        "settingsMore.subjectTransfer" to "transfer",
        "settingsMore.subjectRegistration" to "registration",
        "settingsMore.rejectionUnknownWhat" to
            "The carrier turned down this {subject} and did not say why in a way " +
            "we can translate.",
        "settingsMore.rejectionUnknownFix" to
            "Check the details below against your official registration paperwork, " +
            "and reply to us if nothing looks wrong.",
        "settingsMore.carrierSaid" to "The carrier said: {reason}",
        "settingsMore.takeMeToIt" to "Take me to it",
        "settingsMore.getHelp" to "Get help from us",

        // -- You, your account, and this device ------------------------------
        "settingsMore.yourName" to "Your name",
        "settingsMore.yourNameDesc" to
            "Shown to teammates on messages, notes, tasks, and the members list.",
        "settingsMore.nameLength" to "1 to 80 characters.",
        "settingsMore.nameSaved" to "Name saved.",
        "settingsMore.theme" to "Theme",
        "settingsMore.themeSystem" to "System",
        "settingsMore.themeLight" to "Light",
        "settingsMore.themeDark" to "Dark",
        "settingsMore.account" to "Account",
        "settingsMore.signedInAs" to "Signed in as {email}.",
        "settingsMore.signedOut" to "You're signed out.",
        "settingsMore.changeEmail" to "Change email",
        "settingsMore.newEmail" to "New email",
        "settingsMore.enterNewEmail" to "Enter your new email address.",
        "settingsMore.emailConfirmSent" to
            "Check both inboxes. Confirmation links went to your old " +
            "and new address. Nothing changes until you confirm.",
        "settingsMore.sending" to "Sending…",
        "settingsMore.sendConfirmLinks" to "Send confirmation links",
        "settingsMore.changePassword" to "Change or set password",
        // Google and Apple are product names, never translated.
        "settingsMore.passwordOauthNote" to
            "If you signed up with Google or Apple, this sets a password you can " +
            "also sign in with.",
        "settingsMore.passwordTooShort" to "Use at least 8 characters.",
        "settingsMore.passwordUpdated" to "Password updated.",
        "settingsMore.newPassword" to "New password",
        "settingsMore.atLeast8" to "At least 8 characters.",
        "settingsMore.reauthCodeNote" to
            "To confirm it's you, we emailed you a one-time code. Enter it here " +
            "and save again.",
        "settingsMore.codeFromEmail" to "Code from the email",
        "settingsMore.savePassword" to "Save password",
        "settingsMore.signOut" to "Sign out",
        "settingsMore.signOutThisDevice" to "Sign out on this device",

        // -- US carrier registration (10DLC) ---------------------------------
        "settingsMore.textingRegistration" to "Texting registration",
        "settingsMore.textingRegistrationDesc" to
            "US carriers require every business texter to register (10DLC). " +
            "Approval usually takes a few days; texting US numbers starts once both " +
            "steps are approved.",
        "settingsMore.registrationNotStarted" to
            "Registration hasn't started yet. It's created automatically when " +
            "your subscription starts.",
        "settingsMore.businessIdentity" to "Business identity",
        "settingsMore.messagingCampaign" to "Messaging campaign",
        "settingsMore.resubmitRegistration" to "Resubmit registration",
        "settingsMore.submitRegistration" to "Submit registration",
        "settingsMore.registrationResubmitted" to "Registration resubmitted.",
        "settingsMore.resubmitNoChanges" to "Resubmit without changes",
        "settingsMore.onlyAdminsRegistration" to
            "Only owners and admins can change registration.",
        "settingsMore.usTexting" to "US texting",
        "settingsMore.starting" to "Starting…",
        "settingsMore.notNow" to "Not now",
        "settingsMore.regNotStarted" to "Not started",
        "settingsMore.regApproved" to "Approved",
        "settingsMore.regRejected" to "Rejected",
        "settingsMore.regInReview" to "In review",
        "settingsMore.regDraft" to "Draft",
        "settingsMore.regDraftLine" to "Draft · not submitted yet",
        "settingsMore.agoSuffix" to " {ago} ago",
        "settingsMore.submittedSuffix" to " · submitted {ago} ago",
        "settingsMore.solePropPin" to
            "One more step: the registry texted a 6-digit PIN to your registered " +
            "mobile to confirm it's really you.",
        "settingsMore.sixDigitPin" to "6-digit PIN",
        "settingsMore.otpVerified" to "Verified. The registry review continues.",
        "settingsMore.verify" to "Verify",
        "settingsMore.newPinSent" to "A new PIN is on its way.",
        "settingsMore.resendPin" to "Resend the PIN",

        // -- The registration form -------------------------------------------
        "settingsMore.editDetails" to "Edit your details",
        "settingsMore.registryExactly" to
            "These go to the carrier registry exactly as typed.",
        "settingsMore.firstName" to "First name",
        "settingsMore.lastName" to "Last name",
        "settingsMore.legalBusinessName" to "Legal business name",
        "settingsMore.knownBusinessName" to "Business name customers know",
        "settingsMore.einLabel" to "EIN",
        "settingsMore.businessNumberLabel" to "Business number",
        "settingsMore.contactEmail" to "Contact email",
        "settingsMore.contactPhone" to "Contact phone",
        "settingsMore.mobileForCode" to "Mobile for the verification text",
        "settingsMore.websiteOptional" to "Website (optional)",
        "settingsMore.industry" to "Industry",
        "settingsMore.campaignIntro" to
            "How customers ask you to text them, and two texts you actually send. " +
            "Carriers read these.",
        "settingsMore.howCustomersOptIn" to "How customers opt in",
        "settingsMore.sampleText1" to "Sample text 1",
        "settingsMore.sampleText2" to "Sample text 2",
        "settingsMore.registrationSubmitted" to
            "Submitted. We'll email you when carriers approve it.",
        // One message at a time, and the field's name is substituted in — see
        // the note in `firstProblem`.
        "settingsMore.enterField" to "Enter {field}.",
        "settingsMore.fieldTooLong" to "Keep {field} under {max} characters.",
        "settingsMore.fieldKnownName" to "the business name customers know",
        "settingsMore.fieldStreet" to "the street address",
        "settingsMore.fieldCity" to "the city",
        "settingsMore.fieldState" to "the state",
        "settingsMore.fieldProvince" to "the province",
        "settingsMore.fieldZip" to "the ZIP code",
        "settingsMore.fieldPostal" to "the postal code",
        "settingsMore.fieldFirstName" to "your first name",
        "settingsMore.fieldLastName" to "your last name",
        "settingsMore.fieldLegalName" to "your legal business name",
        "settingsMore.enterContactEmail" to "Enter a contact email address.",
        "settingsMore.enterContactPhone" to "Enter a contact phone number.",
        "settingsMore.enterLast4" to "Enter the last 4 digits of your {idLabel}.",
        "settingsMore.enterMobileForCode" to
            "Enter a US or Canadian mobile number; it gets the verification text.",
        "settingsMore.enterEin" to "Enter your 9-digit EIN (numbers only, dashes ok).",
        "settingsMore.enterCra" to "Enter your CRA business number.",
        "settingsMore.enterWebsite" to
            "Enter a web address (e.g. mikesplumbing.com) or leave it blank.",
        "settingsMore.optInTooShort" to
            "Carriers need at least 40 characters here: describe how customers " +
            "ask you to text them.",
        "settingsMore.optInTooLong" to
            "Keep the opt-in description under 2,048 characters.",
        "settingsMore.sampleTooShort" to
            "Each sample needs at least 20 characters: a real text you'd send.",
        "settingsMore.sampleTooLong" to "Keep each sample under 1,024 characters.",

        // -- Referrals -------------------------------------------------------
        // The share draft itself lives in `core/referral/ReferralShare`, which
        // is asserted against the shared TypeScript. Only the card's own lines
        // are here.
        "settingsMore.noReferralsYet" to "Nobody has used your link yet.",
        "settingsMore.freeMonthEarned" to "1 free month earned so far.",
        "settingsMore.freeMonthsEarned" to "{count} free months earned so far.",

        // -- Appointment reminders -------------------------------------------
        "settingsMore.remindersTitle" to "Appointment reminders",
        "settingsMore.remindersDesc" to "A text before the job, so fewer people forget.",
        "settingsMore.remindersOffBody" to
            "Reminders are off. Nothing goes out automatically until you set " +
            "one up — a job booked for tomorrow gets no text from us today.",
        "settingsMore.remindersSetUpUsual" to "Set up the usual two",
        "settingsMore.remindersAddAnother" to "Add another",
        "settingsMore.remindersCap" to
            "Two is the most we send. Past that, customers stop reading them.",
        "settingsMore.remindersSave" to "Save reminders",
        "settingsMore.discard" to "Discard",
        "settingsMore.remindersBodyLabel" to "What it says",
        "settingsMore.remindersNowOff" to
            "Reminders are off. Nothing will go out automatically.",
        "settingsMore.remindersSaved" to "Saved. New jobs will carry these reminders.",

        // -- The settings index ----------------------------------------------
        "settingsMore.sectionWorkspace" to "Workspace",
        "settingsMore.sectionWorkspaceBlurb" to "Name, business identification, timezone",
        "settingsMore.sectionHours" to "Business hours & away reply",
        "settingsMore.sectionHoursBlurb" to
            "When you're open, and what after-hours texters hear",
        "settingsMore.sectionCalling" to "Calling",
        "settingsMore.sectionCallingBlurb" to
            "Missed-call text-back, voicemail, screening, caller ID",
        "settingsMore.sectionTemplates" to "Templates & tags",
        "settingsMore.sectionTemplatesBlurb" to
            "Saved replies, and the labels you file conversations under",
        "settingsMore.sectionTeam" to "Team",
        "settingsMore.sectionTeamBlurb" to
            "Who can see and answer your customers' texts",
        "settingsMore.sectionNumbers" to "Numbers",
        "settingsMore.sectionNumbersBlurb" to
            "Your numbers, ports, text-enablement, registration",
        "settingsMore.sectionUsage" to "Usage",
        "settingsMore.sectionUsageBlurb" to "Fair use, your spending cap, and the numbers",
        "settingsMore.sectionBilling" to "Billing",
        "settingsMore.sectionBillingBlurb" to "Plan, payment, and invoices",
        "settingsMore.sectionPayments" to "Getting paid",
        "settingsMore.sectionPaymentsBlurb" to
            "Take a deposit or a final payment straight from a thread",
        "settingsMore.sectionNotifications" to "Notifications",
        "settingsMore.sectionNotificationsBlurb" to "Email and push for new conversations",
        // Lou is the assistant's name and Loonext is the product's — neither is
        // translated, on any client.
        "settingsMore.sectionAi" to "Lou",
        "settingsMore.sectionAiBlurb" to
            "Loonext's assistant: drafts replies and fills in task details",
        "settingsMore.sectionProfile" to "Profile & account",
        "settingsMore.sectionProfileBlurb" to "Your name, theme, email, and password",
        "settingsMore.sectionDevices" to "Signed-in devices",
        "settingsMore.sectionDevicesBlurb" to "Every browser and phone with access right now",
        "settingsMore.sectionHelp" to "Help",
        "settingsMore.sectionHelpBlurb" to "Get in touch when something isn't right",
        "settingsMore.sectionWhatsNew" to "What's new",
        "settingsMore.sectionWhatsNewBlurb" to "What shipped recently, and where to find it",
        "settingsMore.diagnostics" to "Diagnostics",
        "settingsMore.diagnosticsBlurb" to "Call flow, crash reports, device",
        "settingsMore.diagnosticsUnlocked" to "Diagnostics unlocked",
        "settingsMore.diagnosticsHidden" to "Diagnostics hidden",
        "settingsMore.captionSpendingCap" to "SPENDING CAP",
        "settingsMore.captionPacing" to "PACING AHEAD",
        "settingsMore.captionFairUse" to "FAIR USE",
        "settingsMore.hubCapReached" to
            "Spending cap reached. Sending and calling are paused until you raise it.",
        "settingsMore.hubCapPercent" to
            "{percent}% of your spending cap used. Sending and calling pause at the cap.",
        "settingsMore.pacingMessages" to "Messages",
        "settingsMore.pacingMinutes" to "Calling minutes",
        "settingsMore.pacingBoth" to "Messages and calling minutes",
        "settingsMore.hubPacing" to "{subject} are pacing past your plan.",
        "settingsMore.hubPacingExtra" to " About {amount} extra at this pace.",
        "settingsMore.hubQuiet" to "Well within fair use this month.",
        "settingsMore.resetsToday" to "resets today",
        "settingsMore.resetsTomorrow" to "resets tomorrow",
        "settingsMore.resetsInDays" to "resets in {days} days",

        // -- Tags ------------------------------------------------------------
        "settingsMore.tagsTitle" to "Tags",
        "settingsMore.tagsDesc" to
            "What the crew has been tagging, and how often. The " +
            "quiet ones at the bottom are usually duplicates of something above.",
        "settingsMore.describe" to "Describe",
        "settingsMore.edit" to "Edit",
        "settingsMore.merge" to "Merge",
        "settingsMore.merging" to "Merging…",
        "settingsMore.tagDescribePlaceholder" to "What does this one mean?",
        // "never used" reads as a verdict; "0 threads" reads as a loading state.
        "settingsMore.tagNeverUsed" to "never used",
        "settingsMore.tagOneThread" to "1 thread",
        "settingsMore.tagThreads" to "{count} threads",
        "settingsMore.tagLastUsed" to " · last {ago}",
        "settingsMore.mergeTitle" to "Merge \"{tag}\" into another tag",
        "settingsMore.mergeBody" to
            "Every conversation tagged \"{tag}\" keeps its place under " +
            "the tag you pick, and this one goes away. Nothing is untagged.",
        // Said back in the direction people get backwards: "merge A into B" is
        // ambiguous to almost everybody, a sentence naming what survives is not.
        "settingsMore.mergeDirection" to
            "{uses} moves to \"{target}\". \"{tag}\" stops existing.",
        "settingsMore.mergedInto" to "Merged into \"{target}\".",
        "settingsMore.tagLockTitle" to "Who can create tags",
        "settingsMore.tagLockDesc" to
            "Anyone on the crew can add a tag by default. Lock it once " +
            "your list is the list.",
        "settingsMore.tagLockLabel" to "Only owners and admins can create tags",
        "settingsMore.tagLockSupporting" to
            "Everyone can still use every tag you already have. This only " +
            "stops new ones being invented mid-job.",
        "settingsMore.tagLockedNote" to
            "A tech who needs a category you do not have will leave the thread " +
            "untagged rather than ask. Check the list below now and then.",

        // -- The team --------------------------------------------------------
        "settingsMore.members" to "Members",
        "settingsMore.membersDesc" to "Who can see and answer your customers' texts.",
        "settingsMore.deactivatedHeading" to "Deactivated",
        "settingsMore.invites" to "Invites",
        "settingsMore.onlyAdminsInvite" to
            "Only owners and admins can invite or deactivate teammates.",
        "settingsMore.roleOwner" to "Owner",
        "settingsMore.roleAdmin" to "Admin",
        "settingsMore.roleMember" to "Member",
        "settingsMore.roleReadOnly" to "View only",
        "settingsMore.roleBookkeeper" to "Bookkeeper",
        "settingsMore.roleAdminBlurb" to
            "Everything except transferring ownership and closing the workspace",
        "settingsMore.roleReadOnlyBlurb" to
            "Can see conversations, cannot reply or change anything",
        "settingsMore.roleBookkeeperBlurb" to
            "Billing and invoices only; no access to conversations",
        "settingsMore.roleMemberBlurb" to
            "Read and answer customers; no billing, team or settings",
        "settingsMore.roleChanged" to "{name} is now {role}.",
        "settingsMore.giveUpAccessTitle" to "Give up your own access?",
        "settingsMore.makeMeRole" to "Make me {role}",
        "settingsMore.keepMyAccess" to "Keep my access",
        "settingsMore.nameYou" to "{name} (you)",
        "settingsMore.deactivatedAgo" to "Deactivated {ago} ago",
        "settingsMore.joinedAgo" to "Joined {ago} ago",
        "settingsMore.numbersLink" to "Numbers",
        "settingsMore.deactivate" to "Deactivate",
        "settingsMore.deactivateTitle" to "Deactivate {name}?",
        "settingsMore.deactivateBody" to
            "They lose access right away and their seat frees up. " +
            "Conversations and messages they worked on stay put.",
        "settingsMore.deactivated" to "{name} deactivated. Their seat is free.",
        "settingsMore.inviteTeammate" to "Invite a teammate",
        "settingsMore.email" to "Email",
        "settingsMore.inviteNoteLabel" to "What to tell them (optional)",
        "settingsMore.inviteNotePlaceholder" to
            "You'll be running the Bathurst jobs. Text Dave before quoting anything big.",
        "settingsMore.inviteNoteOneShot" to
            "They see this once, when they join. You cannot change it after the " +
            "invite goes out.",
        "settingsMore.enterTeammateEmail" to "Enter the teammate's email address.",
        "settingsMore.inviteEmailFailed" to
            "We couldn't email that invite. Use Copy link below and share it yourself.",
        "settingsMore.inviteSentTo" to "Invite sent to {email}.",
        "settingsMore.inviting" to "Inviting…",
        "settingsMore.invite" to "Invite",
        "settingsMore.seatsFull" to
            "All seats are taken. Deactivate a teammate or revoke a pending invite first.",
        "settingsMore.pendingInvites" to "Pending invites",
        "settingsMore.invitePending" to "{role} · {when}",
        "settingsMore.inviteExpired" to "Expired, doesn't hold a seat",
        "settingsMore.inviteExpires" to "Expires {date}",
        "settingsMore.inviteLinkClipLabel" to "Invite link",
        "settingsMore.inviteLinkCopied" to "Invite link copied.",
        "settingsMore.copyLink" to "Copy link",
        "settingsMore.inviteRevoked" to "Invite revoked.",
        "settingsMore.revoking" to "Revoking…",
        "settingsMore.revoke" to "Revoke",
        "settingsMore.done" to "Done",
        "settingsMore.memberNumbersTitle" to "Numbers {name} can reach",
        "settingsMore.memberNumbersDesc" to
            "What they can do on each number, and the rule that decided it.",
        "settingsMore.memberAccessFailed" to "Couldn't load their access. Try again.",
        "settingsMore.noNumbersInWorkspace" to "This workspace has no numbers yet.",

        // -- Saved replies ---------------------------------------------------
        // The merge-field chips are `MergeFields.VARIABLES`', in the composer.
        "settingsMore.templatesIntro" to
            "Replies you type all the time, saved once. Tap Templates in the composer " +
            "to insert one. Anyone on the crew can add or change them.",
        "settingsMore.savedReplies" to "Saved replies",
        "settingsMore.noTemplatesYet" to
            "No templates yet. Save a reply you send often, then insert " +
            "it from Templates in the composer.",
        "settingsMore.createFirstTemplate" to "Create your first template",
        "settingsMore.newTemplate" to "New template",
        "settingsMore.editTemplate" to "Edit template",
        "settingsMore.createTemplate" to "Create template",
        "settingsMore.savedReply" to "Saved reply",
        "settingsMore.updatedJustNow" to "Updated just now",
        "settingsMore.updatedAgo" to "Updated {ago} ago",
        "settingsMore.updatedOn" to "Updated {when}",
        "settingsMore.updatedBy" to "{line} by {editor}",
        "settingsMore.templateName" to "Name",
        "settingsMore.templateNameSample" to "On my way",
        "settingsMore.templateMessage" to "Message",
        "settingsMore.templateMessageSample" to
            "On our way. See you in about 20 minutes.",
        "settingsMore.templateCounter" to "{used}/{max} · ",
        "settingsMore.oneSegmentPerSend" to "1 segment per send",
        "settingsMore.segmentsPerSend" to "{count} segments per send",
        "settingsMore.templateCategory" to "Category (optional)",
        "settingsMore.templateCategorySample" to "Quoting",
        "settingsMore.variablesTapToInsert" to "Variables: tap to insert",
        "settingsMore.previewFor" to "Preview for {name}",
        "settingsMore.templateCreated" to "Template created.",
        "settingsMore.templateSaved" to "Template saved.",
        "settingsMore.deleteTemplateTitle" to "Delete \"{name}\"?",
        "settingsMore.deleteTemplateBody" to
            "It disappears from the composer's Templates picker for the whole crew. " +
            "This can't be undone.",
        "settingsMore.keepIt" to "Keep it",
        "settingsMore.templateDeleted" to "Template deleted.",

        // -- Text-enabling a landline ----------------------------------------
        "settingsMore.textEnableTitle" to "Text-enable your landline",
        "settingsMore.textEnableDesc" to
            "Keep your number: texting runs through Loonext while calls " +
            "stay exactly where they are today. The carrier review takes a few " +
            "business days.",
        "settingsMore.textEnableAction" to "Text-enable a number",
        "settingsMore.textEnableCardTitle" to "Text-enable: {number}",
        "settingsMore.teLive" to "Texting live",
        "settingsMore.teFailed" to "Didn't go through",
        "settingsMore.teReviewing" to "Carrier reviewing",
        "settingsMore.teReceived" to "Order received",
        "settingsMore.teLiveBody" to
            "Texting is live on this number. Calls stay with your current carrier.",
        "settingsMore.teFailedBody" to "The order didn't go through",
        "settingsMore.teFixAndResubmit" to " Fix what's named and resubmit.",
        "settingsMore.teActionBody" to "The carrier needs something from you",
        // The two ways a sentence above continues once the carrier's own reason
        // is or is not there. The reason itself is never translated.
        "settingsMore.colonReason" to ": {reason}",
        "settingsMore.fullStop" to ".",
        "settingsMore.teReviewingBody" to
            "The carrier reviews text-enablement over a few business days. " +
            "Texting goes live only when the review completes. We'll " +
            "keep this card honest in the meantime.",
        "settingsMore.orderResubmitted" to "Order resubmitted.",
        "settingsMore.cancelOrder" to "Cancel order",
        "settingsMore.cancelTextEnableTitle" to "Cancel text-enablement?",
        "settingsMore.cancelTextEnableBody" to
            "Nothing changes with your current carrier. The number keeps " +
            "working exactly as it does today. You can start again any time.",
        "settingsMore.textEnableCancelled" to "Text-enablement cancelled.",
        "settingsMore.plainBillUploaded" to "Bill uploaded.",
        "settingsMore.teDocsNote" to
            "Ownership proof: a signed letter of authorization and a recent bill for " +
            "the number (PDF, PNG, or JPEG).",
        "settingsMore.ownershipCheckNote" to
            "Number ownership check: the carrier sends a code to the number itself.",
        "settingsMore.codeSentBySms" to "Code sent by text to your number.",
        "settingsMore.codeComingByCall" to
            "You'll get a call at your number with the code.",
        "settingsMore.textMeTheCode" to "Text me the code",
        "settingsMore.callMeInstead" to "Call me instead",
        "settingsMore.verificationCode" to "Verification code",
        "settingsMore.numberVerified" to "Number verified.",
        "settingsMore.startTextEnableBody" to
            "Texting for this number runs through Loonext; calls stay with your " +
            "current carrier, nothing changes there. The carrier reviews the order " +
            "over a few business days, and you'll upload proof you own the number.",
        "settingsMore.start" to "Start",
        "settingsMore.teOrderCreated" to
            "Order created. Upload the documents to move it along.",
        "settingsMore.landlineNumberLabel" to "Your landline or VoIP number",

        // -- Two-factor ------------------------------------------------------
        "settingsMore.twoFactorTitle" to "Two-factor authentication",
        "settingsMore.twoFactorDesc" to
            "A code from an app, on top of your password. It is what stops a " +
            "stolen password becoming somebody texting your customers as you.",
        "settingsMore.authenticatorOn" to "Authenticator app is on",
        "settingsMore.oneRecoveryCodeLeft" to "1 recovery code left.",
        "settingsMore.recoveryCodesLeft" to "{count} recovery codes left.",
        "settingsMore.noRecoveryCodesLeft" to "No recovery codes left",
        "settingsMore.newRecoveryCodes" to "New recovery codes",
        "settingsMore.turnOff" to "Turn off",
        "settingsMore.twoFactorHow" to
            "You will add Loonext to an authenticator app — Google Authenticator, " +
            "1Password, whatever you already use — and enter the six-digit code " +
            "it shows. We will give you backup codes for the day you lose the phone.",
        "settingsMore.setUpTwoFactor" to "Set up two-factor",
        "settingsMore.addToAuthenticator" to "Add Loonext to your authenticator",
        "settingsMore.addToAuthenticatorBody" to
            "Tap below to hand it to your authenticator app, or copy the key in " +
            "by hand. Then enter the six-digit code it shows.",
        "settingsMore.turnItOn" to "Turn it on",
        "settingsMore.codeDidNotMatch" to
            "That code didn't match. Check your app and try the next one.",
        "settingsMore.noAuthenticatorApp" to
            "No authenticator app answered. Copy the key below instead.",
        "settingsMore.openAuthenticator" to "Open my authenticator app",
        "settingsMore.orEnterKey" to "Or enter this key by hand:",
        "settingsMore.setupKeyClipLabel" to "Setup key",
        "settingsMore.copyKey" to "Copy key",
        "settingsMore.sixDigitCode" to "Six-digit code",
        "settingsMore.saveRecoveryCodes" to "Save your recovery codes",
        "settingsMore.saveRecoveryCodesBody" to
            "This is the only time you will see these. If you lose your phone, one " +
            "of these codes is how you get back in — without them, getting back into " +
            "your business line takes us weeks.",
        "settingsMore.savedThem" to "I've saved them",
        "settingsMore.twoFactorOn" to "Two-factor authentication is on.",
        "settingsMore.recoveryCodesClipLabel" to "Recovery codes",
        "settingsMore.copiedToast" to "Copied.",
        "settingsMore.copied" to "Copied",
        "settingsMore.copyAllCodes" to "Copy all codes",
        "settingsMore.turnOffTwoFactorTitle" to "Turn off two-factor authentication?",
        "settingsMore.turnOffTwoFactorBody" to
            "Your account goes back to a password alone. If this workspace requires " +
            "two-factor, you will be asked to set it up again the next time you open " +
            "the app.",
        "settingsMore.turnItOff" to "Turn it off",
        "settingsMore.twoFactorOff" to "Two-factor authentication is off.",

        // -- The usage export ------------------------------------------------
        // EXPORT_USAGE_ACTION / _BLURB / _NOTE stay in `UsageExportCard` — they
        // are asserted against `packages/shared/src/usage-export.ts`.
        "settingsMore.dataExport" to "Data export",
        "settingsMore.exportFrom" to "From",
        "settingsMore.exportTo" to "To",
        "settingsMore.exportAlreadyBuilding" to
            "One is already being put together. It will appear under Data export.",
        "settingsMore.exportBuildingNow" to
            "Being put together now. It will appear under Data export.",
        "settingsMore.startIt" to "Start it",
        "settingsMore.export" to "Export",
        "settingsMore.download" to "Download",
        "settingsMore.exportQueued" to "Queued.",
        "settingsMore.exportRunning" to "Being put together…",
        "settingsMore.exportFailed" to "That one could not be built.",
        "settingsMore.exportExpired" to "Ready, but the file has expired.",
        "settingsMore.exportReady" to "Ready.",
        "settingsMore.useThisDay" to "Use this day",

        // -- Usage -----------------------------------------------------------
        "settingsMore.usageTitle" to "Usage",
        "settingsMore.usageNone" to
            "No usage yet. Finish setup under Billing to pick a plan and get your number.",
        "settingsMore.usageQuiet" to
            "Well within fair use this month. Almost every crew stays inside " +
            "what their plan covers, and we reach out early if usage ever " +
            "paces past it.",
        "settingsMore.seeFairUse" to "See the fair use policy",
        "settingsMore.headsUp" to "Heads up",
        "settingsMore.pacingBody" to
            "{subject} are pacing past what your plan includes this period.",
        "settingsMore.pacingProjection" to
            " At the current pace, that adds about {amount} in overage to your " +
            "next invoice.",
        "settingsMore.pacingReassurance" to
            "This is the early flag, not a surprise bill. Your spending cap " +
            "below is the backstop: sending and calling pause there, and " +
            "nothing bills past it.",
        "settingsMore.atCapTitle" to "At your spending cap",
        "settingsMore.nearCapTitle" to "Approaching your spending cap",
        "settingsMore.atCapBody" to
            "You've reached the spending cap you set. Sending and calling " +
            "are paused until you raise the cap. Nothing bills past it.",
        "settingsMore.nearCapBody" to
            "You've used {percent}% of the spending cap you set. At the cap, " +
            "sending and calling pause until you raise it. Nothing bills past it.",
        "settingsMore.spendingCap" to "Spending cap",
        "settingsMore.spendingCapDesc" to
            "Your protection against surprise bills. The cap is a " +
            "multiple of your included usage. At the cap, sending and calling " +
            "pause until you raise it. Nothing bills past it.",
        "settingsMore.capReadOnly" to
            "Spending cap: {cap} your included usage. Only the account owner can " +
            "change it.",
        "settingsMore.sendingPausesAt" to "SENDING PAUSES AT",
        "settingsMore.messagesThisPeriod" to "messages this period",
        "settingsMore.oneTimesIncluded" to "1x included",
        "settingsMore.capMax" to "{cap} max",
        "settingsMore.saveCap" to "Save cap",
        "settingsMore.setTheCap" to "Set the cap",
        "settingsMore.capSetTo" to "Spending cap set to {cap}.",
        "settingsMore.usedOfCap" to "{used} of {cap}",
        "settingsMore.off" to "Off",
        "settingsMore.aiNearLimit" to "Close to this month's limit. It resets on the 1st.",
        "settingsMore.aiNoOutcomes" to
            "Nothing recorded yet about whether these got used.",
        "settingsMore.storageReceived" to "Attachments received",
        "settingsMore.storageSent" to "Attachments sent",
        "settingsMore.storageNotes" to "Files on notes",
        "settingsMore.storageVoicemail" to "Voicemail recordings",
        "settingsMore.storageOther" to "Other files",
        "settingsMore.storedFree" to "{size} stored. Free on every plan, no caps.",
        "settingsMore.details" to "Details",
        "settingsMore.detailsBlurb" to "The raw numbers, month by month, if you want them.",
        "settingsMore.hideNumbers" to "Hide the numbers",
        "settingsMore.showNumbers" to "Show the numbers",
        "settingsMore.storage" to "Storage",
        "settingsMore.louThisMonth" to "Lou this month",
        "settingsMore.louThisMonthLine" to
            "What Lou has drafted, filled in, and written down. Each resets on the 1st.",
        "settingsMore.lastSixMonths" to "Last 6 months",
        "settingsMore.lastSixMonthsLine" to "Outbound messages by calendar month.",
        "settingsMore.howCounted" to "How messages are counted",
        "settingsMore.howCountedLine" to
            "A text up to 160 characters counts as one message; longer texts " +
            "split into 160-character segments (70 with emoji or accents). " +
            "A photo message counts as three. Incoming messages are always free.",
        "settingsMore.messages" to "Messages",
        "settingsMore.messagesUsed" to
            "{used} of {included} included messages used{range}.",
        "settingsMore.commaRange" to ", {range}",
        "settingsMore.messagesOverage" to
            "{over} over your included amount: {amount} in overage on your next invoice.",
        "settingsMore.messagesNoOverage" to "No overage this period. $0.00 extra so far.",
        "settingsMore.messagesPauseAt" to "Sending pauses at {count} messages",
        "settingsMore.messagesPauseMax" to
            ", the maximum, which is 10 times your included messages.",
        "settingsMore.messagesInbound" to
            "{count} messages received this period. Inbound is always free.",
        "settingsMore.callingMinutes" to "Calling minutes",
        "settingsMore.minutesUsed" to "{used} of {included} included minutes used.",
        "settingsMore.minutesOverage" to
            "{extra} extra minutes so far: {amount} on your next invoice.",
        "settingsMore.minutesBilled" to
            "Past your included minutes, extra minutes bill at 1¢ each. Calling " +
            "pauses at your spending cap, never mid-call.",
        "settingsMore.minutesNotBilled" to "Extra minutes aren't billed on your plan.",
        "settingsMore.countryUs" to "United States",
        "settingsMore.countryCa" to "Canada",
        "settingsMore.countryElsewhere" to "Elsewhere",
        "settingsMore.deliveryTitle" to "Are your texts arriving?",
        "settingsMore.deliveryDesc" to
            "Carrier-reported delivery this period. A carrier confirming it " +
            "took the message is not the same as someone reading it, so this is the " +
            "most we can honestly tell you.",
        "settingsMore.deliveryDelivered" to "{count} confirmed delivered",
        "settingsMore.deliveryFailed" to " · {count} didn't get through",
        "settingsMore.deliveryPending" to " · {count} still on their way",
        "settingsMore.deliveryByCountry" to "{country}: {figure}",
        "settingsMore.deliveryCounts" to "{delivered} of {total}",
        "settingsMore.deliveryPercent" to "{percent}%",
        "settingsMore.deliveryFailureNote" to
            "A text that doesn't get through is usually a disconnected number " +
            "or a handset that has been off for days. Open the conversation " +
            "and the message itself says what the carrier reported.",
        "settingsMore.deliveryNothingBounced" to "Nothing has bounced this period.",

        // -- A greeting in the owner's own voice ------------------------------
        "settingsMore.takeWontPlay" to "That recording would not play back. Record it again.",
        "settingsMore.micUnavailable" to
            "The microphone is not available. Close any call and try again.",
        "settingsMore.micRefused" to
            "Loonext needs the microphone to record a greeting. " +
            "Allow it in Settings, then try again.",
        "settingsMore.nothingRecorded" to
            "Nothing was recorded. Try holding the phone closer.",
        "settingsMore.greetingSaved" to "Saved. Choose it on a number to use it.",
        "settingsMore.namedGreetingSaved" to
            "\"{name}\" saved. Choose it on a number to use it.",
        "settingsMore.ownVoiceTitle" to "Your own voice",
        "settingsMore.ownVoiceDesc" to
            "Record the greeting yourself instead of having it read " +
            "aloud. Callers hear a person, which is the thing you are actually " +
            "selling.",
        "settingsMore.noGreetingsYet" to
            "Nothing recorded yet — callers hear the written greeting, read aloud.",
        "settingsMore.pickGreetingOnNumber" to
            "Pick one on a number under Numbers to use it. Anything you have " +
            "not chosen stays unused.",
        "settingsMore.recordedLength" to "Recorded {length}",
        "settingsMore.hearItBack" to "Hear it back",
        "settingsMore.exactlyWhatCallerGets" to "This is exactly what a caller gets.",
        "settingsMore.nameIt" to "Name it",
        "settingsMore.recordAgain" to "Record again",
        "settingsMore.saveGreeting" to "Save greeting",
        "settingsMore.recordingNow" to "Recording… speak now.",
        "settingsMore.stop" to "Stop",
        "settingsMore.upToTwoMinutes" to "Up to two minutes.",
        "settingsMore.record" to "Record",
        "settingsMore.haveUsCallYou" to "Have us call you instead",
        "settingsMore.ratherOnThePhone" to "Rather do it on the phone?",
        "settingsMore.deleteGreetingTitle" to "Delete \"{name}\"?",
        "settingsMore.deleteGreetingBody" to
            "Any number using it goes back to the written words, read " +
            "aloud. Callers hear the change on the next call.",
        "settingsMore.deletedToast" to "Deleted.",
        "settingsMore.callingNow" to "Calling {number} now",
        "settingsMore.answerAndListen" to "Answer, and you'll hear what to do.",
        "settingsMore.captureStep1" to "1. Wait for the beep.",
        "settingsMore.captureStep2" to "2. Say what you want your callers to hear.",
        "settingsMore.captureStep3" to "3. Hang up. It saves itself.",
        "settingsMore.captureWillAppear" to
            "It'll appear above as \"{name}\" when it lands. You can close this.",
        "settingsMore.recordOnPhone" to "Record it on the phone",
        "settingsMore.recordOnPhoneBody" to
            "We'll ring you, you speak after the beep, and you hang " +
            "up. No microphone permission, nothing to hold.",
        "settingsMore.captureNumberSample" to "(613) 555-0199",
        "settingsMore.calling" to "Calling…",
        "settingsMore.callMe" to "Call me",

        // -- What's new ------------------------------------------------------
        "settingsMore.whatsNewIntro" to
            "Everything here has already shipped and is in the product now.",
        "settingsMore.whatsNewBadge" to "New",
        "settingsMore.whatsNewFooter" to
            "Smaller repairs ship most days and are not listed. If you reported " +
            "something and want to know where it got to, ask us on the Help page.",
        "settingsMore.whatsNewSavedViewsTitle" to
            "Save the filters you use every morning",
        "settingsMore.whatsNewSavedViewsBody" to
            "Arrange the inbox how you want it, name it, and it is one tap away " +
            "tomorrow. Share one with the crew and everybody opens the same list.",
        "settingsMore.whatsNewQuotesTitle" to "See how many quotes turned into work",
        "settingsMore.whatsNewQuotesBody" to
            "Your home screen now shows how many quotes you sent, how many you won, " +
            "and how many are still waiting on an answer.",
        "settingsMore.whatsNewVoicemailTitle" to "Voicemails are written down",
        "settingsMore.whatsNewVoicemailBody" to
            "A missed call leaves a voicemail you can read at a red light instead of " +
            "listening to it. It is searchable like any other message.",
        "settingsMore.whatsNewDraftsTitle" to "Lou drafts the reply for you",
        "settingsMore.whatsNewDraftsBody" to
            "Lou reads the thread and offers a reply you can edit before it goes. " +
            "You send it, or you ignore it; nothing is sent on your behalf.",
        "settingsMore.whatsNewCallsTitle" to "Answer calls in the app",
        "settingsMore.whatsNewCallsBody" to
            "Calls to your business number ring your whole crew right here. Pick up, " +
            "put someone on hold, or hand the call to a teammate.",

        // -- The workspace itself --------------------------------------------
        // `{business_name}` in the description below is a MERGE FIELD, not an
        // interpolation: it is what an owner types into a text, so it stays
        // spelled exactly that way in both languages.
        "settingsMore.workspaceName" to "Workspace name",
        "settingsMore.workspaceNameDesc" to
            "The name your customers know you by, used on your carrier " +
            "registration and available as {business_name} in your texts.",
        "settingsMore.nameLength200" to "1 to 200 characters.",
        "settingsMore.workspaceNameSaved" to "Workspace name saved.",
        "settingsMore.onlyAdminsRename" to
            "Only owners and admins can rename the workspace.",
        "settingsMore.businessIdCard" to "Business identification",
        "settingsMore.businessIdCardDesc" to
            "What carriers have on file for your business. " +
            "It comes from your texting registration.",
        "settingsMore.noRegistrationNeeded" to
            "No registration needed. Canadian texting works without one. " +
            "Enabling US texting adds it.",
        "settingsMore.noRegistrationYet" to
            "No registration details on file yet. Manage registration under Numbers.",
        "settingsMore.changeRegistrationUnderNumbers" to
            "Need to change something? Manage registration under Numbers.",
        "settingsMore.registrationIs" to
            "Registration is {state}. Owners and admins can see the full details.",
        "settingsMore.registrationApproved" to "approved",
        "settingsMore.registrationOnFile" to "on file",
        "settingsMore.ssnLast4" to "SSN (last 4)",
        "settingsMore.sinLast4" to "SIN (last 4)",
        "settingsMore.legalName" to "Legal name",
        "settingsMore.addressLabel" to "Address",
        "settingsMore.websiteLabel" to "Website",
        "settingsMore.contactLabel" to "Contact",
        "settingsMore.registrationBeingPrepared" to
            "Registration details are being prepared.",
        "settingsMore.timezoneDesc" to
            "Dates in emails about your workspace are framed in your " +
            "business's local time.",
        "settingsMore.localTimeNow" to "It's {time} in {zone} right now.",
        "settingsMore.quietHoursNote" to
            "Texting quiet hours use each customer's local time, not this timezone.",
        "settingsMore.changeTimezone" to "Change timezone",
        "settingsMore.onlyAdminsTimezone" to
            "Only owners and admins can change the timezone.",
        "settingsMore.timezoneSaved" to "Timezone saved.",
        "settingsMore.timezoneSearchHint" to "Search, e.g. Toronto",
        "settingsMore.noTimezoneMatch" to "No timezone matches \"{query}\".",
        "settingsMore.signTextsTitle" to "Sign your texts",
        "settingsMore.signTextsDesc" to
            "Add your business name to the first text you send " +
            "someone, so a message from an unknown number says who it is from.",
        "settingsMore.signFirstText" to "Sign the first text to a new customer",
        "settingsMore.signFirstTextSupporting" to
            "Once per customer. Replies and later texts are never signed.",
        "settingsMore.whatGetsAdded" to "What gets added",
        "settingsMore.signatureLength" to
            "That is {count} characters, so a long first text can be sent in two " +
            "parts instead of one.",
        "settingsMore.onlyAdminsSigning" to
            "Only owners and admins can change how texts are signed.",
        "settingsMore.nightTextTitle" to "Texting a new customer at night",
        "settingsMore.nightTextDesc" to
            "Starting a brand-new conversation between 8pm and 8am " +
            "the customer's time asks you to confirm first.",
        "settingsMore.askMeToConfirm" to "Ask me to confirm",
        "settingsMore.askMeToConfirmSupporting" to
            "Only when you start the conversation. Replying to a " +
            "customer who texted or called you is never interrupted.",
        "settingsMore.withThisOff" to "With this off",
        "settingsMore.withThisOffBody" to
            "You will not be asked. A text you start at 2am goes " +
            "straight out, and it is on you that the customer wanted to " +
            "hear from you then.",
        "settingsMore.nightTextAutomatedNote" to
            "This does not change automated texts. Reminders and anything " +
            "else we send on your behalf still wait for the customer's " +
            "morning, whatever this is set to.",
        "settingsMore.onlyAdminsThis" to "Only owners and admins can change this.",
        "settingsMore.automatedLanguageTitle" to "Language for automated texts",
        "settingsMore.automatedLanguageDesc" to
            "The language we write in when we text a customer for you: " +
            "the after-hours away reply, the missed-call text-back, the emergency " +
            "acknowledgment, and the rating ask after a job.",
        "settingsMore.languageUpdated" to "Language updated.",
        "settingsMore.automatedLanguageNotApp" to
            "This does not change the app itself, and it never rewrites words " +
            "somebody typed. An away message you wrote is sent exactly as " +
            "you wrote it, in the language you wrote it in.",
        "settingsMore.automatedLanguagePerContact" to
            "One customer who should hear from you in the other language can be " +
            "set on their own contact.",
        "settingsMore.onlyAdminsLanguage" to
            "Only owners and admins can change the language.",

        // -- The shared confirm dialog ---------------------------------------
        "settingsMore.working" to "Working…",

        // -- #366: a crew bigger than one call can ring ----------------------
        // `{limit}` appears TWICE, which is the reason this is one sentence
        // rather than two: the number that rings and the number that takes a
        // turn are the same number, and a translation that let them drift would
        // be telling a tech two different things about their own phone.
        "settingsMore.ringCeilingLine" to
            "{targets} people could be rung by a call to this number, and one " +
            "call rings {limit}. Everyone still takes turns — a different {limit} " +
            "ring each time — but nobody is rung on every call.",

        // -- What the app calls itself inside an authenticator (#228) ---------
        // Web translates its own factor name (`tfaAuthenticatorFactorName`), so
        // this does too. Loonext is a product and Android is a platform: both
        // stay as they are in either language.
        "settingsMore.tfaFactorName" to "Loonext on Android",

        // -- The usage export, moved out of `UsageExportCard` (#228) ----------
        // These three are the words `packages/shared/src/usage-export.ts` owns
        // for all three clients, and `UsageExportCardTest` compares the English
        // here against that module character for character. Change one and the
        // guard fails, which is the point of it.
        "settingsMore.exportUsageAction" to "Export usage",
        "settingsMore.exportUsageBlurb" to
            "Your texts, calls and storage for a period, as a file for whoever does " +
            "your books.",
        "settingsMore.exportUsageNote" to
            "It counts what we measured — it is not a copy of your Stripe invoice, and " +
            "nothing on it is priced. It is put together in the background and appears " +
            "under Data export.",

        // -- The two refusals the settings screens raise themselves -----------
        // Everything the API refuses with arrives already phrased for a person
        // and is rendered as written; these two are OURS, raised before any
        // request reached anybody. `settingsMore.signedOut` above is the third.
        "settingsMore.cantReachLoonext" to "Can't reach Loonext. Check your connection.",
        "settingsMore.cantReachSignIn" to
            "Can't reach the sign-in service. Check your connection.",
        // The last resort when GoTrue refused in a shape we could not read. The
        // status code rides along because it is the one thing a support email
        // can be looked up by.
        "settingsMore.somethingWentWrongStatus" to "Something went wrong ({status}).",

        // -- A carrier is filtering this line (#235) --------------------------
        // It never says "spam" or "flagged": we know delivery fell, we do not
        // know which vendor labelled it or whether one did.
        "settingsMore.numberHealthRate" to
            "About {percent}% of your recent texts were delivered, " +
            "which is below normal for this number.",
        "settingsMore.numberHealthNoRate" to
            "Fewer of your texts are getting through than usual.",
        "settingsMore.numberHealthCause" to
            "Carriers sometimes start filtering a number — often one that was " +
            "reused from a previous business. We've been alerted and we're on it; " +
            "you don't need to do anything yet.",

        // -- Giving a number up for good (#523) -------------------------------
        // Two whole sentences, because the last clause of the plain one is false
        // for a hold: a workspace on hold is over its allowance by definition, so
        // releasing brings it back TO the allowance and no further.
        "settingsMore.releaseBody" to
            "This gives the number up for good. Customers who text it won't reach you, " +
            "and you can't get the same number back. It doesn't change your plan or " +
            "what you pay. A number is included, so you can set up a new one here " +
            "afterward. Type the number to confirm.",
        "settingsMore.releaseBodyHeld" to
            "This is a number your plan doesn't cover, and releasing it is the other way " +
            "out of that hold — it ends the hold by giving the number up rather than " +
            "by bringing it back. Customers who text it won't reach you afterward, and " +
            "you can't get the same number back. Your plan stops being over its " +
            "allowance, and what you pay doesn't change. Type the number to confirm.",

        // -- Why this workspace cannot buy one more number (#464, #522) -------
        "settingsMore.extraNumberCountry" to
            "Extra numbers are available for US and Canadian workspaces.",
        "settingsMore.extraNumberUsTexting" to
            "An extra number needs US texting turned on for your workspace first.",
        "settingsMore.extraNumberCurrency" to
            "Extra numbers are priced in US dollars and can't be added to a " +
            "subscription billed in another currency yet. Contact support and " +
            "we'll sort it out.",
    )

    override val frCA = mapOf(
        // -- Notifications ---------------------------------------------------
        "settingsMore.notifAlwaysOn" to
            "Les courriels de facturation, d'utilisation et d'inscription vont " +
            "toujours aux propriétaires et aux admins. Impossible de les désactiver.",
        "settingsMore.leadChaseLabel" to "Avertir toute l'équipe après {minutes} minutes",
        "settingsMore.leadChaseSupporting" to
            "Quand une conversation est assignée à une personne et qu'elle n'a " +
            "toujours pas répondu, avertir tous ceux qui peuvent la voir. Pendant " +
            "les heures d'ouverture seulement, et jamais quelqu'un qui a désactivé " +
            "ses propres notifications. Ce réglage vaut pour tout l'espace de " +
            "travail, pas seulement pour vous",
        "settingsMore.pushContentLabel" to
            "Afficher le texte des messages sur l'écran verrouillé",
        "settingsMore.pushContentSupporting" to
            "Les notifications montrent qui a écrit et la première ligne du texto, " +
            "pour que l'équipe distingue un client potentiel d'un « merci » sans " +
            "déverrouiller. Désactivez ce réglage et l'équipe verra encore qui a " +
            "écrit, mais jamais ce que le client a dit — utile si les téléphones " +
            "sortent sur les chantiers, chez les clients. Ce réglage vaut pour tout " +
            "l'espace de travail, pas seulement pour vous",
        "settingsMore.workspaceWideEnd" to ".",
        "settingsMore.workspaceWideAdminsOnly" to
            " — seuls les propriétaires et les admins peuvent le changer.",
        "settingsMore.emailUnreachableTitle" to
            "Impossible de vous écrire à {email}",
        "settingsMore.emailBouncingBody" to
            "Les courriels envoyés à cette adresse rebondissent, alors nous avons " +
            "cessé d'en envoyer. Les notifications poussées fonctionnent toujours. " +
            "Si l'adresse comporte une faute, corrigez-la d'abord dans votre compte, " +
            "puis demandez-nous de réessayer.",
        "settingsMore.emailRetryQueued" to
            "Nous réessaierons cette adresse à votre prochaine notification.",
        "settingsMore.emailRetrying" to "Envoi en cours…",
        "settingsMore.emailRetryAction" to "Réessayer cette adresse",
        "settingsMore.emailComplainedBody" to
            "Cette adresse a signalé nos courriels comme indésirables, alors nous " +
            "avons cessé définitivement d'y écrire. Les notifications poussées " +
            "fonctionnent toujours. Pour recevoir des courriels de nouveau, " +
            "changez l'adresse de votre compte.",

        // -- On call ---------------------------------------------------------
        "settingsMore.onCallTitle" to "De garde",
        "settingsMore.onCallChecking" to "Vérification du tour de garde…",
        "settingsMore.onCallEndShift" to "Terminer le quart",
        "settingsMore.onCallPut" to "Mettre quelqu'un de garde",
        "settingsMore.onCallNowOn" to "{name} est de garde",
        "settingsMore.someone" to "Quelqu'un",
        "settingsMore.remove" to "Retirer",

        // -- One number's own clock and identity ------------------------------
        "settingsMore.loading" to "Chargement…",
        "settingsMore.inheritSame" to "Comme votre espace de travail",
        "settingsMore.inheritUse" to "Utiliser celui de l'espace de travail",
        "settingsMore.numberHoursTitle" to "Heures d'ouverture de cette ligne",
        "settingsMore.numberHoursIntro" to
            "La réponse hors des heures sur ce numéro suit cet horaire. " +
            "Laissez-le tel quel et il suit votre espace de travail.",
        "settingsMore.timezone" to "Fuseau horaire",
        "settingsMore.chooseTimezone" to "Choisir un fuseau horaire",
        "settingsMore.openHours" to "Heures d'ouverture",
        "settingsMore.numberIdentityTitle" to "Comment cette ligne répond",
        "settingsMore.numberIdentityIntro" to
            "Tout ce que vous ne touchez pas suit votre espace de travail. " +
            "Un changement ici ne vise que ce numéro.",
        "settingsMore.voicemailVoice" to "Voix de la boîte vocale",
        "settingsMore.writtenGreeting" to "Le message écrit, lu à voix haute",
        "settingsMore.recordingFallbackHint" to
            "Un enregistrement qui ne joue pas est remplacé par les mots " +
            "ci-dessous : un appelant n'entend jamais le silence.",
        "settingsMore.afterHoursCalls" to "Appels hors des heures",
        "settingsMore.afterHoursRingEveryone" to "Faire sonner tout le monde, jour et nuit",
        "settingsMore.afterHoursOnCallOnly" to "Faire sonner seulement la personne de garde",
        "settingsMore.afterHoursVoicemail" to "Prendre un message",
        "settingsMore.afterHoursHint" to
            "En dehors des heures de cette ligne. Sans personne de garde, les " +
            "deux derniers choix diffèrent encore : l'un fait sonner l'équipe " +
            "quand même, l'autre prend un message.",
        "settingsMore.ringHow" to "Comment les téléphones sonnent",
        "settingsMore.ringAll" to "Tous en même temps",
        "settingsMore.ringInTurn" to "Un à la fois",
        "settingsMore.ringHowLong" to "Combien de temps ils sonnent",
        "settingsMore.ringSeconds" to "{seconds} secondes",
        "settingsMore.lineNameTitle" to "Nom de cette ligne",
        "settingsMore.lineNameHint" to
            "Utilisé dans le message d'accueil, dans les textos d'appel manqué " +
            "et partout où cette ligne se présente.",
        "settingsMore.voicemailGreetingTitle" to "Message de la boîte vocale",
        "settingsMore.voicemailGreetingHint" to
            "Ce qu'un appelant entend quand personne ne répond.",
        "settingsMore.afterHoursReplyTitle" to "Réponse hors des heures",
        "settingsMore.afterHoursReplyHint" to
            "Le texto envoyé quand quelqu'un écrit à cette ligne en dehors de vos heures.",
        "settingsMore.missedCallBackTitle" to "Renvoyer un texto à un appelant manqué",
        "settingsMore.missedCallBackHint" to
            "Envoyé depuis cette ligne quand un appel reste sans réponse.",
        "settingsMore.missedCallTextTitle" to "Texto d'appel manqué",
        "settingsMore.missedCallTextHint" to
            "Ce qu'un appelant reçoit quand personne ne répond et qu'il raccroche.",

        // -- Picking a number ------------------------------------------------
        "settingsMore.areaCode" to "Indicatif régional",
        "settingsMore.containsDigits" to "Contient les chiffres",
        "settingsMore.maskedPick" to
            "Les numéros canadiens sont attribués au moment de la commande : " +
            "votre choix ici est l'indicatif régional. Des numéros sont " +
            "disponibles{where}.",
        "settingsMore.inAreaCode" to " dans le {areaCode}",
        "settingsMore.enterAreaCode" to
            "Entrez ci-dessus l'indicatif régional à 3 chiffres que vous voulez.",
        "settingsMore.ordering" to "Commande en cours…",
        "settingsMore.useAreaCode" to "Utiliser l'indicatif {areaCode}",
        "settingsMore.noNumbersIn" to
            "Aucun numéro dans le {areaCode} en ce moment. Les indicatifs voisins " +
            "en ont presque toujours.",
        "settingsMore.thatAreaCode" to "cet indicatif régional",
        "settingsMore.showNearby" to "Montrer les numéros voisins",
        "settingsMore.noNumberContains" to
            "Aucun numéro disponible ne contient « {digits} ». Élargissez le filtre " +
            "ou actualisez pour une nouvelle sélection.",
        "settingsMore.noNumbersBack" to
            "Aucun numéro n'est revenu. Actualisez pour une nouvelle sélection ou " +
            "essayez un autre indicatif régional.",
        "settingsMore.refresh" to "Actualiser",
        "settingsMore.showingNearby" to
            "Voici des numéros voisins. L'indicatif exact est en rupture.",
        "settingsMore.refreshList" to "Actualiser la liste",

        // -- The numbers a workspace holds -----------------------------------
        "settingsMore.yourNumber" to "Votre numéro",
        "settingsMore.noNumberYet" to
            "Aucun numéro pour l'instant. Il est créé automatiquement au début de " +
            "votre abonnement.",
        "settingsMore.areaCodeIs" to "Indicatif {areaCode}",
        "settingsMore.sourcePorted" to "Transféré",
        "settingsMore.sourceHosted" to "Ligne fixe activée pour les textos",
        "settingsMore.sourceLoonext" to "Numéro Loonext",
        "settingsMore.phoneNumberClipLabel" to "Numéro de téléphone",
        "settingsMore.copyNumber" to "Copier le numéro",
        "settingsMore.numberCopied" to "Numéro copié.",
        "settingsMore.releasedAgo" to "Libéré il y a {ago}.",
        "settingsMore.numberUnreliable" to
            "Les textos de ce numéro n'arrivent pas de façon fiable",
        "settingsMore.chooseNumber" to "Choisir un numéro",
        "settingsMore.chooseNumberFinish" to
            "Choisir un numéro pour terminer la configuration",
        "settingsMore.whoCanUse" to "Qui peut utiliser ce numéro",
        "settingsMore.release" to "Libérer",
        "settingsMore.onlyAdminsManageNumbers" to
            "Seuls les propriétaires et les admins peuvent gérer les numéros.",
        "settingsMore.statusActive" to "Actif",
        "settingsMore.statusSettingUp" to "Configuration en cours",
        "settingsMore.statusSuspended" to "Suspendu",
        "settingsMore.statusReleased" to "Libéré",
        "settingsMore.statusActionNeeded" to "Action requise",
        "settingsMore.statusFailed" to "Configuration impossible",
        "settingsMore.releaseTitle" to "Libérer {number} ?",
        "settingsMore.releaseConfirm" to "Libérer le numéro",
        "settingsMore.keepNumber" to "Garder le numéro",
        "settingsMore.typeToConfirm" to "Tapez {number} pour confirmer",
        "settingsMore.numberReleased" to "{number} libéré.",
        "settingsMore.codeSent" to "Envoyé. Vérifiez vos courriels.",
        "settingsMore.numberBeingSetUp" to "Votre numéro est en cours de configuration.",
        "settingsMore.setupRestarted" to
            "Configuration relancée. Vous ne serez pas facturé de nouveau.",
        "settingsMore.addNumber" to "Ajouter un numéro",
        "settingsMore.planNumbersInUse" to
            "Les numéros de votre forfait sont tous utilisés. {reason}",
        "settingsMore.addNumberIncluded" to
            "Choisissez le numéro auquel vos clients écriront. Il est compris dans " +
            "votre forfait, sans frais supplémentaires.",
        "settingsMore.addNumberPriced" to
            "Un numéro supplémentaire coûte {price}, facturé aujourd'hui. Votre " +
            "quota de messages est partagé : un numéro de plus n'ajoute pas de " +
            "messages.",
        "settingsMore.addNumberBilled" to
            "Un numéro supplémentaire est facturé à votre forfait aujourd'hui. Votre " +
            "quota de messages est partagé : un numéro de plus n'ajoute pas de " +
            "messages.",

        // -- Who can use one number ------------------------------------------
        "settingsMore.thisNumber" to "ce numéro",
        "settingsMore.whoCanUseNumber" to "Qui peut utiliser {number} ?",
        "settingsMore.adminsAlwaysUse" to
            "Les propriétaires et les admins peuvent toujours utiliser chaque numéro.",
        "settingsMore.noMembersToPick" to
            "Aucun membre actif à choisir. Tous les autres membres de l'équipe sont " +
            "propriétaires ou admins.",
        "settingsMore.teammate" to "Coéquipier",
        "settingsMore.levelText" to "Peut texter",
        "settingsMore.levelNote" to "Consultation et notes seulement",
        "settingsMore.pickAtLeastOne" to
            "Choisissez au moins une personne, ou sélectionnez Tout le monde.",
        "settingsMore.accessUpdated" to "L'accès à {number} a été mis à jour.",
        "settingsMore.accessEveryone" to "Tout le monde",
        "settingsMore.accessEveryoneDetail" to
            "Toute l'équipe peut texter, comme aujourd'hui.",
        "settingsMore.accessMembersView" to "Membres : consultation et notes seulement",
        "settingsMore.accessMembersViewDetail" to
            "Les membres peuvent lire et ajouter des notes, mais pas texter. Les " +
            "admins textent toujours.",
        "settingsMore.accessAdmins" to "Admins seulement",
        "settingsMore.accessAdminsDetail" to
            "Les membres ne voient pas ce numéro du tout.",
        "settingsMore.accessUsers" to "Personnes précises",
        "settingsMore.accessUsersDetail" to
            "Seulement les personnes que vous choisissez. Les admins textent toujours.",
        "settingsMore.whatYouReach" to "Ce que vous pouvez joindre",
        "settingsMore.whatYouReachDesc" to
            "Certains numéros de cet espace de travail ne sont pas partagés avec " +
            "vous. Voici lesquels, et ce qui l'a décidé.",
        "settingsMore.aNumber" to "Un numéro",

        // -- Who owns the workspace ------------------------------------------
        "settingsMore.ownershipOffered" to "La propriété a été offerte à {name}.",
        "settingsMore.ownershipAskedToTakeOver" to
            "{name} a demandé à reprendre cet espace de travail.",
        "settingsMore.ownershipOfferExpires" to
            "Rien ne change tant que la personne n'a pas accepté. L'offre " +
            "expire le {when}.",
        "settingsMore.ownershipWaitOver" to
            "La période d'attente est terminée. La personne peut compléter la " +
            "reprise à tout moment.",
        "settingsMore.ownershipCompletesAt" to
            "Cela se conclut le {when} à moins que le propriétaire l'arrête. " +
            "L'arrêter prend effet immédiatement.",
        "settingsMore.ownershipStopThis" to "Arrêter",
        "settingsMore.ownershipTitle" to "Propriété",
        "settingsMore.ownershipCaption" to "PROPRIÉTÉ",
        "settingsMore.ownershipDesc" to
            "Le propriétaire contrôle la facturation, le plafond de dépenses et vos " +
            "numéros. Lui seul peut céder ce rôle.",
        "settingsMore.owner" to "Propriétaire",
        "settingsMore.you" to "Vous",
        "settingsMore.aTeammate" to "un coéquipier",
        "settingsMore.aTeammateCapital" to "Un coéquipier",
        "settingsMore.them" to "cette personne",
        "settingsMore.nobody" to "Personne",
        "settingsMore.nobodyNamed" to "Personne de désigné",
        "settingsMore.backupOwner" to "Propriétaire suppléant",
        "settingsMore.backupOwnerExplain" to
            "Si un jour vous ne pouvez plus entrer — vous perdez votre courriel, ou " +
            "pire — voici la seule personne qui peut demander à reprendre l'espace " +
            "de travail. Elle attend une semaine, vous pouvez l'arrêter d'un seul " +
            "clic, et tout le monde en est informé. Rien ne change aujourd'hui.",
        "settingsMore.inviteBackupFirst" to
            "Invitez d'abord quelqu'un — un suppléant doit faire partie de l'équipe.",
        "settingsMore.backupCleared" to "Propriétaire suppléant retiré.",
        "settingsMore.backupSet" to "{name} est votre propriétaire suppléant.",
        "settingsMore.handOverTitle" to "Céder l'espace de travail",
        "settingsMore.handOverNote" to
            "La personne doit accepter. Vous restez dans l'équipe comme admin.",
        "settingsMore.chooseTeammate" to "Choisir un coéquipier",
        "settingsMore.handItOver" to "Céder",
        "settingsMore.handToTitle" to "Céder cet espace de travail à {name} ?",
        "settingsMore.handOverBody" to
            "Rien ne change tant que la personne n'a pas accepté. Une fois acceptée, " +
            "elle contrôle la facturation, le plafond de dépenses et vos numéros — " +
            "et vous restez dans l'équipe comme admin. Vous pouvez annuler à tout " +
            "moment avant son acceptation, et tout le monde sera informé dans les " +
            "deux cas.",
        "settingsMore.offerIt" to "Proposer",
        "settingsMore.offeredTo" to
            "Proposé à {name}. La personne a 7 jours pour accepter.",
        "settingsMore.youAreBackup" to "Vous êtes le propriétaire suppléant",
        "settingsMore.claimExplain" to
            "Si le propriétaire ne peut pas agir, vous pouvez demander à reprendre " +
            "l'espace de travail. Il a une semaine pour l'arrêter, et toute " +
            "l'équipe en est informée sur-le-champ.",
        "settingsMore.askTakeOver" to "Demander à reprendre",
        "settingsMore.claimTitle" to "Demander à reprendre cet espace de travail ?",
        "settingsMore.claimBody" to
            "Le propriétaire recevra un courriel sur-le-champ et pourra arrêter " +
            "cette demande d'un seul clic pendant les 7 prochains jours. Toute " +
            "l'équipe en est informée aussi. Si personne ne l'arrête, vous pourrez " +
            "conclure la reprise après 7 jours. Ne faites cela que si le " +
            "propriétaire est vraiment incapable d'agir.",
        "settingsMore.claimAsked" to
            "Demande envoyée. Le propriétaire a 7 jours pour l'arrêter.",
        "settingsMore.nowOwn" to "Vous êtes maintenant propriétaire de cet espace de travail.",
        "settingsMore.handoverStopped" to "Arrêté. Rien n'a changé de mains.",
        "settingsMore.acceptOwnership" to "Accepter la propriété",
        "settingsMore.completeTakeover" to "Conclure la reprise",

        // -- Getting paid ----------------------------------------------------
        "settingsMore.onlyOwnerConnectsBank" to
            "Seul le propriétaire peut relier le compte bancaire. Une fois que ce " +
            "sera fait, vous pourrez ouvrir Stripe d'ici pour émettre des " +
            "remboursements et consulter les versements.",
        "settingsMore.opening" to "Ouverture…",
        "settingsMore.payouts" to "Versements",
        "settingsMore.payoutsOn" to "Activés — l'argent se rend à votre banque",
        "settingsMore.payoutsOff" to "Stripe n'a pas encore activé les versements",
        "settingsMore.chargedIn" to "Facturé en",
        "settingsMore.stripeDashboardNote" to
            "Les remboursements, les reçus et l'historique des versements se " +
            "trouvent tous dans votre tableau de bord Stripe. Nous ne gardons " +
            "jamais votre argent et nous ne prenons rien de plus que ce que vous " +
            "facturez — les frais de carte de Stripe sont la seule retenue.",

        // -- Bringing a number in from another carrier -----------------------
        "settingsMore.ssnLabel" to "SSN",
        "settingsMore.sinLabel" to "NAS",
        "settingsMore.stateLabel" to "État",
        "settingsMore.provinceLabel" to "Province",
        "settingsMore.zipLabel" to "Code ZIP",
        "settingsMore.postalLabel" to "Code postal",
        "settingsMore.portFormIntro" to
            "Entrez ces renseignements exactement comme ils apparaissent sur la " +
            "facture de votre fournisseur actuel. Les écarts sont la première " +
            "cause de refus.",
        "settingsMore.accountHolder" to "Titulaire du compte",
        "settingsMore.authorizedPerson" to "Personne autorisée",
        "settingsMore.accountNumber" to "Numéro de compte",
        "settingsMore.portWirelessNote" to
            "Il s'agit d'un numéro mobile. Entrez le NIP de transfert et les 4 " +
            "derniers chiffres du {idLabel} du titulaire. Nous ne conservons que " +
            "les 4 derniers.",
        "settingsMore.transferPin" to "NIP de transfert",
        "settingsMore.last4Of" to "4 derniers chiffres du {idLabel}",
        "settingsMore.streetAddress" to "Adresse",
        "settingsMore.city" to "Ville",
        "settingsMore.bringNumber" to "Transférer votre numéro actuel",
        "settingsMore.bringNumberDesc" to
            "Transférez un numéro que vous possédez déjà. Il continue de fonctionner " +
            "chez votre fournisseur actuel jusqu'à la bascule, généralement en " +
            "quelques jours ouvrables. Les transferts sont gratuits.",
        "settingsMore.startTransfer" to "Démarrer un transfert",
        "settingsMore.transferTitle" to "Transfert : {number}",
        "settingsMore.focDate" to
            "Les fournisseurs se sont entendus sur une date de bascule : {date}.",
        "settingsMore.bridgeNumber" to
            "Numéro temporaire pendant l'attente : {number}.",
        "settingsMore.registrationHeld" to
            "Votre numéro est arrivé, mais son inscription pour les textos est " +
            "encore retenue par votre ancien fournisseur de textos. Demandez-lui " +
            "de la libérer et les textos s'activeront automatiquement.",
        "settingsMore.transferSubmitted" to "Transfert soumis aux fournisseurs.",
        "settingsMore.submitting" to "Envoi en cours…",
        "settingsMore.submitTransfer" to "Soumettre le transfert",
        "settingsMore.fixResubmit" to "Corriger et soumettre de nouveau",
        "settingsMore.cancelTransfer" to "Annuler le transfert",
        "settingsMore.cancelTransferTitle" to "Annuler ce transfert ?",
        "settingsMore.cancelTransferBody" to
            "Votre numéro reste chez votre fournisseur actuel et rien n'y change. " +
            "Vous pouvez démarrer un nouveau transfert à tout moment.",
        "settingsMore.keepItGoing" to "Poursuivre",
        "settingsMore.transferCancelled" to "Transfert annulé.",
        "settingsMore.beforeSwitch" to "Avant la bascule de votre numéro",
        "settingsMore.cutoverKeepOld" to "Gardez votre ancien service actif.",
        "settingsMore.cutoverKeepOldDetail" to
            "Annuler avant la fin du transfert peut rendre le numéro au " +
            "fournisseur, et c'est la seule façon de le perdre pour de bon.",
        "settingsMore.cutoverExport" to "Exportez votre historique de messages.",
        "settingsMore.cutoverExportDetail" to
            "Le numéro change de main, pas vos anciennes conversations.",
        "settingsMore.cutoverTellCrew" to "Dites la date de bascule à l'équipe.",
        "settingsMore.cutoverTellCrewDetail" to
            "À partir de ce matin-là, les appels et les textos arrivent dans cette " +
            "boîte de réception plutôt que dans l'ancienne.",
        "settingsMore.cutoverTextsTrail" to
            "Les textos peuvent suivre les appels avec du retard.",
        "settingsMore.cutoverTextsTrailDetail" to
            "La voix et les textos peuvent se terminer à des moments différents : " +
            "les textos peuvent prendre une journée de plus. Nous vous dirons " +
            "quand les deux seront actifs.",
        "settingsMore.loaUploaded" to "Lettre d'autorisation téléversée.",
        "settingsMore.billUploaded" to "Facture du fournisseur téléversée.",
        "settingsMore.portDocsNote" to
            "Deux documents sont requis : une lettre d'autorisation signée et une " +
            "facture récente de votre fournisseur actuel (PDF, PNG ou JPEG).",
        "settingsMore.replaceLoa" to "Remplacer la lettre ✓",
        "settingsMore.uploadLoa" to "Téléverser la lettre",
        "settingsMore.replaceBill" to "Remplacer la facture ✓",
        "settingsMore.uploadBill" to "Téléverser la facture",
        "settingsMore.uploading" to "Téléversement…",
        "settingsMore.numberToTransfer" to "Numéro à transférer",
        "settingsMore.phoneSample" to "(416) 555-0182",
        "settingsMore.notPortable" to
            "Ce numéro ne peut pas être transféré automatiquement.",
        "settingsMore.canBeTransferred" to "{number} peut être transféré.",
        "settingsMore.wirelessRequires" to
            " C'est un numéro mobile : un NIP de transfert et une vérification " +
            "d'identité sont requis.",
        "settingsMore.mayNotText" to
            "À noter : ce numéro pourrait ne pas prendre les textos après le " +
            "transfert. Les appels fonctionneront quand même.",
        "settingsMore.wantBridge" to
            "Donnez-moi un numéro temporaire pendant le transfert",
        "settingsMore.wantBridgeSupporting" to
            "Facultatif. Les textos démarrent tout de suite sur le numéro " +
            "temporaire ; votre propre numéro prend le relais à la fin du transfert.",
        "settingsMore.enterFullNanp" to
            "Entrez un numéro américain ou canadien complet à 10 chiffres.",
        "settingsMore.checking" to "Vérification…",
        "settingsMore.checkNumber" to "Vérifier le numéro",
        "settingsMore.transferCreated" to
            "Transfert créé. Téléversez les deux documents pour le soumettre.",
        "settingsMore.creating" to "Création…",
        "settingsMore.createTransfer" to "Créer le transfert",
        "settingsMore.reenterSecrets" to
            "Le numéro de compte et le NIP ne sont jamais réaffichés, par sécurité. " +
            "Entrez-les de nouveau.",
        "settingsMore.transferResubmitted" to "Transfert soumis de nouveau.",
        "settingsMore.resubmitting" to "Nouvelle soumission…",
        "settingsMore.resubmit" to "Soumettre de nouveau",

        // -- A carrier or registry refusal -----------------------------------
        "settingsMore.subjectTransfer" to "transfert",
        "settingsMore.subjectRegistration" to "inscription",
        "settingsMore.rejectionUnknownWhat" to
            "Le fournisseur a refusé ce {subject} sans en donner la raison d'une " +
            "façon que nous pouvons traduire.",
        "settingsMore.rejectionUnknownFix" to
            "Comparez les renseignements ci-dessous avec vos documents officiels " +
            "d'entreprise, et répondez-nous si tout semble correct.",
        "settingsMore.carrierSaid" to "Le fournisseur a dit : {reason}",
        "settingsMore.takeMeToIt" to "M'y amener",
        "settingsMore.getHelp" to "Obtenir de l'aide",

        // -- You, your account, and this device ------------------------------
        "settingsMore.yourName" to "Votre nom",
        "settingsMore.yourNameDesc" to
            "Affiché à vos coéquipiers sur les messages, les notes, les tâches et " +
            "la liste des membres.",
        "settingsMore.nameLength" to "De 1 à 80 caractères.",
        "settingsMore.nameSaved" to "Nom enregistré.",
        "settingsMore.theme" to "Thème",
        "settingsMore.themeSystem" to "Système",
        "settingsMore.themeLight" to "Clair",
        "settingsMore.themeDark" to "Sombre",
        "settingsMore.account" to "Compte",
        "settingsMore.signedInAs" to "Connecté en tant que {email}.",
        "settingsMore.signedOut" to "Vous êtes déconnecté.",
        "settingsMore.changeEmail" to "Changer le courriel",
        "settingsMore.newEmail" to "Nouveau courriel",
        "settingsMore.enterNewEmail" to "Entrez votre nouvelle adresse courriel.",
        "settingsMore.emailConfirmSent" to
            "Vérifiez les deux boîtes de réception. Des liens de confirmation ont " +
            "été envoyés à votre ancienne et à votre nouvelle adresse. Rien ne " +
            "change tant que vous n'avez pas confirmé.",
        "settingsMore.sending" to "Envoi…",
        "settingsMore.sendConfirmLinks" to "Envoyer les liens de confirmation",
        "settingsMore.changePassword" to "Changer ou définir le mot de passe",
        "settingsMore.passwordOauthNote" to
            "Si vous vous êtes inscrit avec Google ou Apple, ceci définit un mot de " +
            "passe avec lequel vous pourrez aussi vous connecter.",
        "settingsMore.passwordTooShort" to "Utilisez au moins 8 caractères.",
        "settingsMore.passwordUpdated" to "Mot de passe mis à jour.",
        "settingsMore.newPassword" to "Nouveau mot de passe",
        "settingsMore.atLeast8" to "Au moins 8 caractères.",
        "settingsMore.reauthCodeNote" to
            "Pour confirmer que c'est bien vous, nous vous avons envoyé un code à " +
            "usage unique par courriel. Entrez-le ici et enregistrez de nouveau.",
        "settingsMore.codeFromEmail" to "Code reçu par courriel",
        "settingsMore.savePassword" to "Enregistrer le mot de passe",
        "settingsMore.signOut" to "Déconnexion",
        "settingsMore.signOutThisDevice" to "Se déconnecter sur cet appareil",

        // -- US carrier registration (10DLC) ---------------------------------
        "settingsMore.textingRegistration" to "Inscription pour les textos",
        "settingsMore.textingRegistrationDesc" to
            "Les fournisseurs américains exigent que chaque entreprise qui texte " +
            "s'inscrive (10DLC). L'approbation prend généralement quelques jours ; " +
            "les textos vers les numéros américains démarrent une fois les deux " +
            "étapes approuvées.",
        "settingsMore.registrationNotStarted" to
            "L'inscription n'a pas encore commencé. Elle est créée automatiquement " +
            "au début de votre abonnement.",
        "settingsMore.businessIdentity" to "Identité de l'entreprise",
        "settingsMore.messagingCampaign" to "Campagne de messagerie",
        "settingsMore.resubmitRegistration" to "Soumettre l'inscription de nouveau",
        "settingsMore.submitRegistration" to "Soumettre l'inscription",
        "settingsMore.registrationResubmitted" to "Inscription soumise de nouveau.",
        "settingsMore.resubmitNoChanges" to "Soumettre de nouveau sans changement",
        "settingsMore.onlyAdminsRegistration" to
            "Seuls les propriétaires et les admins peuvent modifier l'inscription.",
        "settingsMore.usTexting" to "Textos vers les États-Unis",
        "settingsMore.starting" to "Démarrage…",
        "settingsMore.notNow" to "Pas maintenant",
        "settingsMore.regNotStarted" to "Pas commencé",
        "settingsMore.regApproved" to "Approuvé",
        "settingsMore.regRejected" to "Refusé",
        "settingsMore.regInReview" to "En révision",
        "settingsMore.regDraft" to "Brouillon",
        "settingsMore.regDraftLine" to "Brouillon · pas encore soumis",
        "settingsMore.agoSuffix" to " il y a {ago}",
        "settingsMore.submittedSuffix" to " · soumis il y a {ago}",
        "settingsMore.solePropPin" to
            "Une dernière étape : le registre a envoyé un NIP à 6 chiffres par texto " +
            "à votre mobile inscrit pour confirmer que c'est bien vous.",
        "settingsMore.sixDigitPin" to "NIP à 6 chiffres",
        "settingsMore.otpVerified" to "Vérifié. La révision du registre se poursuit.",
        "settingsMore.verify" to "Vérifier",
        "settingsMore.newPinSent" to "Un nouveau NIP est en route.",
        "settingsMore.resendPin" to "Renvoyer le NIP",

        // -- The registration form -------------------------------------------
        "settingsMore.editDetails" to "Modifier vos renseignements",
        "settingsMore.registryExactly" to
            "Ces renseignements sont transmis au registre des fournisseurs " +
            "exactement comme vous les tapez.",
        "settingsMore.firstName" to "Prénom",
        "settingsMore.lastName" to "Nom de famille",
        "settingsMore.legalBusinessName" to "Dénomination sociale",
        "settingsMore.knownBusinessName" to "Nom d'entreprise que les clients connaissent",
        "settingsMore.einLabel" to "EIN",
        "settingsMore.businessNumberLabel" to "Numéro d'entreprise",
        "settingsMore.contactEmail" to "Courriel de contact",
        "settingsMore.contactPhone" to "Téléphone de contact",
        "settingsMore.mobileForCode" to "Mobile pour le texto de vérification",
        "settingsMore.websiteOptional" to "Site Web (facultatif)",
        "settingsMore.industry" to "Secteur d'activité",
        "settingsMore.campaignIntro" to
            "Comment vos clients vous demandent de leur écrire, et deux textos que " +
            "vous envoyez vraiment. Les fournisseurs les lisent.",
        "settingsMore.howCustomersOptIn" to "Comment les clients donnent leur accord",
        "settingsMore.sampleText1" to "Exemple de texto 1",
        "settingsMore.sampleText2" to "Exemple de texto 2",
        "settingsMore.registrationSubmitted" to
            "Soumis. Nous vous écrirons quand les fournisseurs l'approuveront.",
        "settingsMore.enterField" to "Entrez {field}.",
        "settingsMore.fieldTooLong" to "Limitez {field} à {max} caractères.",
        "settingsMore.fieldKnownName" to "le nom d'entreprise que les clients connaissent",
        "settingsMore.fieldStreet" to "l'adresse",
        "settingsMore.fieldCity" to "la ville",
        "settingsMore.fieldState" to "l'État",
        "settingsMore.fieldProvince" to "la province",
        "settingsMore.fieldZip" to "le code ZIP",
        "settingsMore.fieldPostal" to "le code postal",
        "settingsMore.fieldFirstName" to "votre prénom",
        "settingsMore.fieldLastName" to "votre nom de famille",
        "settingsMore.fieldLegalName" to "votre dénomination sociale",
        "settingsMore.enterContactEmail" to "Entrez une adresse courriel de contact.",
        "settingsMore.enterContactPhone" to "Entrez un numéro de téléphone de contact.",
        "settingsMore.enterLast4" to
            "Entrez les 4 derniers chiffres de votre {idLabel}.",
        "settingsMore.enterMobileForCode" to
            "Entrez un numéro mobile américain ou canadien ; c'est lui qui recevra " +
            "le texto de vérification.",
        "settingsMore.enterEin" to
            "Entrez votre EIN à 9 chiffres (chiffres seulement, tirets acceptés).",
        "settingsMore.enterCra" to "Entrez votre numéro d'entreprise de l'ARC.",
        "settingsMore.enterWebsite" to
            "Entrez une adresse Web (p. ex. mikesplumbing.com) ou laissez le champ vide.",
        "settingsMore.optInTooShort" to
            "Les fournisseurs exigent au moins 40 caractères ici : décrivez comment " +
            "vos clients vous demandent de leur écrire.",
        "settingsMore.optInTooLong" to
            "Limitez la description du consentement à 2 048 caractères.",
        "settingsMore.sampleTooShort" to
            "Chaque exemple doit compter au moins 20 caractères : un vrai texto que " +
            "vous enverriez.",
        "settingsMore.sampleTooLong" to "Limitez chaque exemple à 1 024 caractères.",

        // -- Referrals -------------------------------------------------------
        "settingsMore.noReferralsYet" to "Personne n'a encore utilisé votre lien.",
        "settingsMore.freeMonthEarned" to "1 mois gratuit obtenu jusqu'ici.",
        "settingsMore.freeMonthsEarned" to "{count} mois gratuits obtenus jusqu'ici.",

        // -- Appointment reminders -------------------------------------------
        "settingsMore.remindersTitle" to "Rappels de rendez-vous",
        "settingsMore.remindersDesc" to
            "Un texto avant le travail, pour que moins de gens oublient.",
        "settingsMore.remindersOffBody" to
            "Les rappels sont désactivés. Rien ne part automatiquement tant que " +
            "vous n'en créez pas un — un travail prévu demain ne reçoit aucun " +
            "texto de notre part aujourd'hui.",
        "settingsMore.remindersSetUpUsual" to "Créer les deux rappels habituels",
        "settingsMore.remindersAddAnother" to "Ajouter un autre rappel",
        "settingsMore.remindersCap" to
            "Deux, c'est le maximum que nous envoyons. Au-delà, les clients " +
            "cessent de les lire.",
        "settingsMore.remindersSave" to "Enregistrer les rappels",
        "settingsMore.discard" to "Abandonner",
        "settingsMore.remindersBodyLabel" to "Ce que dit le rappel",
        "settingsMore.remindersNowOff" to
            "Les rappels sont désactivés. Rien ne partira automatiquement.",
        "settingsMore.remindersSaved" to
            "Enregistré. Les nouveaux travaux porteront ces rappels.",

        // -- The settings index ----------------------------------------------
        "settingsMore.sectionWorkspace" to "Espace de travail",
        "settingsMore.sectionWorkspaceBlurb" to
            "Nom, identification de l'entreprise, fuseau horaire",
        "settingsMore.sectionHours" to "Heures d'ouverture et réponse d'absence",
        "settingsMore.sectionHoursBlurb" to
            "Quand vous êtes ouvert, et ce qu'entendent ceux qui écrivent hors des heures",
        "settingsMore.sectionCalling" to "Appels",
        "settingsMore.sectionCallingBlurb" to
            "Texto d'appel manqué, boîte vocale, filtrage, afficheur",
        "settingsMore.sectionTemplates" to "Modèles et étiquettes",
        "settingsMore.sectionTemplatesBlurb" to
            "Réponses enregistrées, et les étiquettes qui classent vos conversations",
        "settingsMore.sectionTeam" to "Équipe",
        "settingsMore.sectionTeamBlurb" to
            "Qui peut voir et répondre aux textos de vos clients",
        "settingsMore.sectionNumbers" to "Numéros",
        "settingsMore.sectionNumbersBlurb" to
            "Vos numéros, transferts, activation des textos, inscription",
        "settingsMore.sectionUsage" to "Utilisation",
        "settingsMore.sectionUsageBlurb" to
            "Usage raisonnable, votre plafond de dépenses et les chiffres",
        "settingsMore.sectionBilling" to "Facturation",
        "settingsMore.sectionBillingBlurb" to "Forfait, paiement et factures",
        "settingsMore.sectionPayments" to "Encaisser les paiements",
        "settingsMore.sectionPaymentsBlurb" to
            "Prenez un acompte ou un paiement final directement depuis une conversation",
        "settingsMore.sectionNotifications" to "Notifications",
        "settingsMore.sectionNotificationsBlurb" to
            "Courriel et notifications poussées pour les nouvelles conversations",
        "settingsMore.sectionAi" to "Lou",
        "settingsMore.sectionAiBlurb" to
            "L'assistant de Loonext : rédige des réponses et remplit les détails des tâches",
        "settingsMore.sectionProfile" to "Profil et compte",
        "settingsMore.sectionProfileBlurb" to
            "Votre nom, le thème, le courriel et le mot de passe",
        "settingsMore.sectionDevices" to "Appareils connectés",
        "settingsMore.sectionDevicesBlurb" to
            "Chaque navigateur et téléphone qui a accès en ce moment",
        "settingsMore.sectionHelp" to "Aide",
        "settingsMore.sectionHelpBlurb" to
            "Écrivez-nous quand quelque chose ne va pas",
        "settingsMore.sectionWhatsNew" to "Nouveautés",
        "settingsMore.sectionWhatsNewBlurb" to
            "Ce qui a été livré récemment, et où le trouver",
        "settingsMore.diagnostics" to "Diagnostics",
        "settingsMore.diagnosticsBlurb" to
            "Déroulement des appels, rapports de plantage, appareil",
        "settingsMore.diagnosticsUnlocked" to "Diagnostics déverrouillés",
        "settingsMore.diagnosticsHidden" to "Diagnostics masqués",
        "settingsMore.captionSpendingCap" to "PLAFOND DE DÉPENSES",
        "settingsMore.captionPacing" to "RYTHME ÉLEVÉ",
        "settingsMore.captionFairUse" to "USAGE RAISONNABLE",
        "settingsMore.hubCapReached" to
            "Plafond de dépenses atteint. Les envois et les appels sont en pause " +
            "tant que vous ne l'augmentez pas.",
        "settingsMore.hubCapPercent" to
            "{percent} % de votre plafond de dépenses est utilisé. Les envois et " +
            "les appels s'arrêtent au plafond.",
        "settingsMore.pacingMessages" to "Les textos",
        "settingsMore.pacingMinutes" to "Les minutes d'appel",
        "settingsMore.pacingBoth" to "Les textos et les minutes d'appel",
        "settingsMore.hubPacing" to "{subject} dépassent le rythme de votre forfait.",
        "settingsMore.hubPacingExtra" to " Environ {amount} de plus à ce rythme.",
        "settingsMore.hubQuiet" to "Bien à l'intérieur de l'usage raisonnable ce mois-ci.",
        "settingsMore.resetsToday" to "réinitialisation aujourd'hui",
        "settingsMore.resetsTomorrow" to "réinitialisation demain",
        "settingsMore.resetsInDays" to "réinitialisation dans {days} jours",

        // -- Tags ------------------------------------------------------------
        "settingsMore.tagsTitle" to "Étiquettes",
        "settingsMore.tagsDesc" to
            "Ce que l'équipe étiquette, et à quelle fréquence. Celles qui " +
            "traînent en bas sont souvent des doublons de quelque chose plus haut.",
        "settingsMore.describe" to "Décrire",
        "settingsMore.edit" to "Modifier",
        "settingsMore.merge" to "Fusionner",
        "settingsMore.merging" to "Fusion…",
        "settingsMore.tagDescribePlaceholder" to "Qu'est-ce que celle-ci veut dire ?",
        "settingsMore.tagNeverUsed" to "jamais utilisée",
        "settingsMore.tagOneThread" to "1 conversation",
        "settingsMore.tagThreads" to "{count} conversations",
        "settingsMore.tagLastUsed" to " · dernière il y a {ago}",
        "settingsMore.mergeTitle" to "Fusionner « {tag} » avec une autre étiquette",
        "settingsMore.mergeBody" to
            "Chaque conversation étiquetée « {tag} » garde sa place sous " +
            "l'étiquette que vous choisissez, et celle-ci disparaît. Rien n'est " +
            "laissé sans étiquette.",
        "settingsMore.mergeDirection" to
            "{uses} passe à « {target} ». « {tag} » cesse d'exister.",
        "settingsMore.mergedInto" to "Fusionnée avec « {target} ».",
        "settingsMore.tagLockTitle" to "Qui peut créer des étiquettes",
        "settingsMore.tagLockDesc" to
            "Par défaut, toute l'équipe peut ajouter une étiquette. Verrouillez " +
            "une fois que votre liste est la bonne.",
        "settingsMore.tagLockLabel" to
            "Seuls les propriétaires et les admins peuvent créer des étiquettes",
        "settingsMore.tagLockSupporting" to
            "Tout le monde peut encore utiliser les étiquettes existantes. Cela " +
            "empêche seulement d'en inventer de nouvelles en plein travail.",
        "settingsMore.tagLockedNote" to
            "Un technicien qui a besoin d'une catégorie que vous n'avez pas " +
            "laissera la conversation sans étiquette plutôt que de demander. " +
            "Revoyez la liste ci-dessous de temps en temps.",

        // -- The team --------------------------------------------------------
        "settingsMore.members" to "Membres",
        "settingsMore.membersDesc" to
            "Qui peut voir et répondre aux textos de vos clients.",
        "settingsMore.deactivatedHeading" to "Désactivés",
        "settingsMore.invites" to "Invitations",
        "settingsMore.onlyAdminsInvite" to
            "Seuls les propriétaires et les admins peuvent inviter ou désactiver " +
            "des coéquipiers.",
        "settingsMore.roleOwner" to "Propriétaire",
        "settingsMore.roleAdmin" to "Admin",
        "settingsMore.roleMember" to "Membre",
        "settingsMore.roleReadOnly" to "Consultation seulement",
        "settingsMore.roleBookkeeper" to "Comptable",
        "settingsMore.roleAdminBlurb" to
            "Tout, sauf céder la propriété et fermer l'espace de travail",
        "settingsMore.roleReadOnlyBlurb" to
            "Peut voir les conversations, sans répondre ni rien changer",
        "settingsMore.roleBookkeeperBlurb" to
            "Facturation et factures seulement ; aucun accès aux conversations",
        "settingsMore.roleMemberBlurb" to
            "Lit et répond aux clients ; ni facturation, ni équipe, ni paramètres",
        "settingsMore.roleChanged" to "{name} est maintenant {role}.",
        "settingsMore.giveUpAccessTitle" to "Renoncer à votre propre accès ?",
        "settingsMore.makeMeRole" to "Faites de moi un {role}",
        "settingsMore.keepMyAccess" to "Garder mon accès",
        "settingsMore.nameYou" to "{name} (vous)",
        "settingsMore.deactivatedAgo" to "Désactivé il y a {ago}",
        "settingsMore.joinedAgo" to "Arrivé il y a {ago}",
        "settingsMore.numbersLink" to "Numéros",
        "settingsMore.deactivate" to "Désactiver",
        "settingsMore.deactivateTitle" to "Désactiver {name} ?",
        "settingsMore.deactivateBody" to
            "Cette personne perd l'accès immédiatement et sa place se libère. " +
            "Les conversations et les messages sur lesquels elle a travaillé " +
            "restent en place.",
        "settingsMore.deactivated" to "{name} désactivé. Sa place est libre.",
        "settingsMore.inviteTeammate" to "Inviter un coéquipier",
        "settingsMore.email" to "Courriel",
        "settingsMore.inviteNoteLabel" to "Ce qu'il faut lui dire (facultatif)",
        "settingsMore.inviteNotePlaceholder" to
            "Tu t'occuperas des chantiers de Bathurst. Écris à Dave avant de " +
            "donner un gros prix.",
        "settingsMore.inviteNoteOneShot" to
            "La personne le voit une seule fois, à son arrivée. Vous ne pouvez " +
            "plus le changer une fois l'invitation partie.",
        "settingsMore.enterTeammateEmail" to
            "Entrez l'adresse courriel du coéquipier.",
        "settingsMore.inviteEmailFailed" to
            "Nous n'avons pas pu envoyer cette invitation par courriel. Utilisez " +
            "Copier le lien ci-dessous et partagez-le vous-même.",
        "settingsMore.inviteSentTo" to "Invitation envoyée à {email}.",
        "settingsMore.inviting" to "Invitation…",
        "settingsMore.invite" to "Inviter",
        "settingsMore.seatsFull" to
            "Toutes les places sont prises. Désactivez un coéquipier ou révoquez " +
            "une invitation en attente d'abord.",
        "settingsMore.pendingInvites" to "Invitations en attente",
        "settingsMore.invitePending" to "{role} · {when}",
        "settingsMore.inviteExpired" to "Expirée, n'occupe pas de place",
        "settingsMore.inviteExpires" to "Expire le {date}",
        "settingsMore.inviteLinkClipLabel" to "Lien d'invitation",
        "settingsMore.inviteLinkCopied" to "Lien d'invitation copié.",
        "settingsMore.copyLink" to "Copier le lien",
        "settingsMore.inviteRevoked" to "Invitation révoquée.",
        "settingsMore.revoking" to "Révocation…",
        "settingsMore.revoke" to "Révoquer",
        "settingsMore.done" to "Terminé",
        "settingsMore.memberNumbersTitle" to "Numéros que {name} peut joindre",
        "settingsMore.memberNumbersDesc" to
            "Ce que cette personne peut faire sur chaque numéro, et la règle qui " +
            "l'a décidé.",
        "settingsMore.memberAccessFailed" to
            "Impossible de charger son accès. Réessayez.",
        "settingsMore.noNumbersInWorkspace" to
            "Cet espace de travail n'a encore aucun numéro.",

        // -- Saved replies ---------------------------------------------------
        "settingsMore.templatesIntro" to
            "Les réponses que vous tapez tout le temps, enregistrées une fois. " +
            "Touchez Modèles dans le composeur pour en insérer une. Toute " +
            "l'équipe peut en ajouter ou les modifier.",
        "settingsMore.savedReplies" to "Réponses enregistrées",
        "settingsMore.noTemplatesYet" to
            "Aucun modèle pour l'instant. Enregistrez une réponse que vous envoyez " +
            "souvent, puis insérez-la depuis Modèles dans le composeur.",
        "settingsMore.createFirstTemplate" to "Créer votre premier modèle",
        "settingsMore.newTemplate" to "Nouveau modèle",
        "settingsMore.editTemplate" to "Modifier le modèle",
        "settingsMore.createTemplate" to "Créer le modèle",
        "settingsMore.savedReply" to "Réponse enregistrée",
        "settingsMore.updatedJustNow" to "Mis à jour à l'instant",
        "settingsMore.updatedAgo" to "Mis à jour il y a {ago}",
        "settingsMore.updatedOn" to "Mis à jour le {when}",
        "settingsMore.updatedBy" to "{line} par {editor}",
        "settingsMore.templateName" to "Nom",
        "settingsMore.templateNameSample" to "En route",
        "settingsMore.templateMessage" to "Message",
        "settingsMore.templateMessageSample" to
            "Nous sommes en route. On arrive dans une vingtaine de minutes.",
        "settingsMore.templateCounter" to "{used}/{max} · ",
        "settingsMore.oneSegmentPerSend" to "1 segment par envoi",
        "settingsMore.segmentsPerSend" to "{count} segments par envoi",
        "settingsMore.templateCategory" to "Catégorie (facultatif)",
        "settingsMore.templateCategorySample" to "Soumissions",
        "settingsMore.variablesTapToInsert" to "Variables : touchez pour insérer",
        "settingsMore.previewFor" to "Aperçu pour {name}",
        "settingsMore.templateCreated" to "Modèle créé.",
        "settingsMore.templateSaved" to "Modèle enregistré.",
        "settingsMore.deleteTemplateTitle" to "Supprimer « {name} » ?",
        "settingsMore.deleteTemplateBody" to
            "Il disparaît du sélecteur Modèles du composeur pour toute l'équipe. " +
            "Cette action est irréversible.",
        "settingsMore.keepIt" to "Le garder",
        "settingsMore.templateDeleted" to "Modèle supprimé.",

        // -- Text-enabling a landline ----------------------------------------
        "settingsMore.textEnableTitle" to "Activer les textos sur votre ligne fixe",
        "settingsMore.textEnableDesc" to
            "Gardez votre numéro : les textos passent par Loonext tandis que les " +
            "appels restent exactement où ils sont aujourd'hui. La révision du " +
            "fournisseur prend quelques jours ouvrables.",
        "settingsMore.textEnableAction" to "Activer les textos sur un numéro",
        "settingsMore.textEnableCardTitle" to "Activation des textos : {number}",
        "settingsMore.teLive" to "Textos actifs",
        "settingsMore.teFailed" to "N'a pas abouti",
        "settingsMore.teReviewing" to "Révision du fournisseur",
        "settingsMore.teReceived" to "Commande reçue",
        "settingsMore.teLiveBody" to
            "Les textos sont actifs sur ce numéro. Les appels restent chez votre " +
            "fournisseur actuel.",
        "settingsMore.teFailedBody" to "La commande n'a pas abouti",
        "settingsMore.teFixAndResubmit" to
            " Corrigez ce qui est nommé et soumettez de nouveau.",
        "settingsMore.teActionBody" to "Le fournisseur a besoin de quelque chose de vous",
        "settingsMore.colonReason" to " : {reason}",
        "settingsMore.fullStop" to ".",
        "settingsMore.teReviewingBody" to
            "Le fournisseur révise l'activation des textos sur quelques jours " +
            "ouvrables. Les textos ne s'activent qu'à la fin de la révision. Nous " +
            "garderons cette carte honnête entretemps.",
        "settingsMore.orderResubmitted" to "Commande soumise de nouveau.",
        "settingsMore.cancelOrder" to "Annuler la commande",
        "settingsMore.cancelTextEnableTitle" to "Annuler l'activation des textos ?",
        "settingsMore.cancelTextEnableBody" to
            "Rien ne change chez votre fournisseur actuel. Le numéro continue de " +
            "fonctionner exactement comme aujourd'hui. Vous pouvez recommencer à " +
            "tout moment.",
        "settingsMore.textEnableCancelled" to "Activation des textos annulée.",
        "settingsMore.plainBillUploaded" to "Facture téléversée.",
        "settingsMore.teDocsNote" to
            "Preuve de propriété : une lettre d'autorisation signée et une facture " +
            "récente pour le numéro (PDF, PNG ou JPEG).",
        "settingsMore.ownershipCheckNote" to
            "Vérification de propriété du numéro : le fournisseur envoie un code au " +
            "numéro lui-même.",
        "settingsMore.codeSentBySms" to "Code envoyé par texto à votre numéro.",
        "settingsMore.codeComingByCall" to
            "Vous recevrez un appel à votre numéro avec le code.",
        "settingsMore.textMeTheCode" to "Envoyez-moi le code par texto",
        "settingsMore.callMeInstead" to "Appelez-moi plutôt",
        "settingsMore.verificationCode" to "Code de vérification",
        "settingsMore.numberVerified" to "Numéro vérifié.",
        "settingsMore.startTextEnableBody" to
            "Les textos de ce numéro passent par Loonext ; les appels restent chez " +
            "votre fournisseur actuel, rien n'y change. Le fournisseur révise la " +
            "commande sur quelques jours ouvrables, et vous téléverserez une preuve " +
            "que le numéro vous appartient.",
        "settingsMore.start" to "Démarrer",
        "settingsMore.teOrderCreated" to
            "Commande créée. Téléversez les documents pour la faire avancer.",
        "settingsMore.landlineNumberLabel" to "Votre ligne fixe ou numéro VoIP",

        // -- Two-factor ------------------------------------------------------
        "settingsMore.twoFactorTitle" to "Authentification à deux facteurs",
        "settingsMore.twoFactorDesc" to
            "Un code venant d'une application, en plus de votre mot de passe. " +
            "C'est ce qui empêche un mot de passe volé de devenir quelqu'un qui " +
            "texte vos clients en votre nom.",
        "settingsMore.authenticatorOn" to "L'application d'authentification est active",
        "settingsMore.oneRecoveryCodeLeft" to "1 code de récupération restant.",
        "settingsMore.recoveryCodesLeft" to "{count} codes de récupération restants.",
        "settingsMore.noRecoveryCodesLeft" to "Aucun code de récupération restant",
        "settingsMore.newRecoveryCodes" to "Nouveaux codes de récupération",
        "settingsMore.turnOff" to "Désactiver",
        "settingsMore.twoFactorHow" to
            "Vous ajouterez Loonext à une application d'authentification — Google " +
            "Authenticator, 1Password, celle que vous utilisez déjà — et vous " +
            "entrerez le code à six chiffres qu'elle affiche. Nous vous donnerons " +
            "des codes de secours pour le jour où vous perdrez le téléphone.",
        "settingsMore.setUpTwoFactor" to "Configurer la double authentification",
        "settingsMore.addToAuthenticator" to
            "Ajouter Loonext à votre application d'authentification",
        "settingsMore.addToAuthenticatorBody" to
            "Touchez ci-dessous pour la transmettre à votre application " +
            "d'authentification, ou copiez la clé à la main. Entrez ensuite le " +
            "code à six chiffres qu'elle affiche.",
        "settingsMore.turnItOn" to "Activer",
        "settingsMore.codeDidNotMatch" to
            "Ce code ne correspond pas. Vérifiez votre application et essayez le suivant.",
        "settingsMore.noAuthenticatorApp" to
            "Aucune application d'authentification n'a répondu. Copiez plutôt la " +
            "clé ci-dessous.",
        "settingsMore.openAuthenticator" to "Ouvrir mon application d'authentification",
        "settingsMore.orEnterKey" to "Ou entrez cette clé à la main :",
        "settingsMore.setupKeyClipLabel" to "Clé de configuration",
        "settingsMore.copyKey" to "Copier la clé",
        "settingsMore.sixDigitCode" to "Code à six chiffres",
        "settingsMore.saveRecoveryCodes" to "Enregistrez vos codes de récupération",
        "settingsMore.saveRecoveryCodesBody" to
            "C'est la seule fois où vous les verrez. Si vous perdez votre " +
            "téléphone, l'un de ces codes est votre moyen de revenir — sans eux, " +
            "récupérer l'accès à votre ligne d'affaires nous prend des semaines.",
        "settingsMore.savedThem" to "Je les ai enregistrés",
        "settingsMore.twoFactorOn" to "L'authentification à deux facteurs est active.",
        "settingsMore.recoveryCodesClipLabel" to "Codes de récupération",
        "settingsMore.copiedToast" to "Copié.",
        "settingsMore.copied" to "Copié",
        "settingsMore.copyAllCodes" to "Copier tous les codes",
        "settingsMore.turnOffTwoFactorTitle" to
            "Désactiver l'authentification à deux facteurs ?",
        "settingsMore.turnOffTwoFactorBody" to
            "Votre compte revient au mot de passe seul. Si cet espace de travail " +
            "exige la double authentification, on vous demandera de la configurer " +
            "de nouveau à votre prochaine ouverture de l'application.",
        "settingsMore.turnItOff" to "Désactiver",
        "settingsMore.twoFactorOff" to "L'authentification à deux facteurs est désactivée.",

        // -- The usage export ------------------------------------------------
        "settingsMore.dataExport" to "Exportation de données",
        "settingsMore.exportFrom" to "Du",
        "settingsMore.exportTo" to "Au",
        "settingsMore.exportAlreadyBuilding" to
            "Une exportation est déjà en préparation. Elle apparaîtra sous " +
            "Exportation de données.",
        "settingsMore.exportBuildingNow" to
            "En préparation maintenant. Elle apparaîtra sous Exportation de données.",
        "settingsMore.startIt" to "Lancer",
        "settingsMore.export" to "Exportation",
        "settingsMore.download" to "Télécharger",
        "settingsMore.exportQueued" to "En file d'attente.",
        "settingsMore.exportRunning" to "En préparation…",
        "settingsMore.exportFailed" to "Celle-là n'a pas pu être produite.",
        "settingsMore.exportExpired" to "Prête, mais le fichier a expiré.",
        "settingsMore.exportReady" to "Prête.",
        "settingsMore.useThisDay" to "Utiliser ce jour",

        // -- Usage -----------------------------------------------------------
        "settingsMore.usageTitle" to "Utilisation",
        "settingsMore.usageNone" to
            "Aucune utilisation pour l'instant. Terminez la configuration sous " +
            "Facturation pour choisir un forfait et obtenir votre numéro.",
        "settingsMore.usageQuiet" to
            "Bien à l'intérieur de l'usage raisonnable ce mois-ci. Presque toutes " +
            "les équipes restent dans ce que leur forfait couvre, et nous " +
            "communiquons avec vous tôt si l'utilisation dépasse le rythme.",
        "settingsMore.seeFairUse" to "Voir la politique d'usage raisonnable",
        "settingsMore.headsUp" to "À noter",
        "settingsMore.pacingBody" to
            "{subject} dépassent le rythme de ce que votre forfait comprend pour " +
            "cette période.",
        "settingsMore.pacingProjection" to
            " À ce rythme, cela ajoute environ {amount} en dépassement à votre " +
            "prochaine facture.",
        "settingsMore.pacingReassurance" to
            "C'est un avertissement précoce, pas une facture-surprise. Votre " +
            "plafond de dépenses ci-dessous est le filet : les envois et les " +
            "appels s'arrêtent là, et rien n'est facturé au-delà.",
        "settingsMore.atCapTitle" to "À votre plafond de dépenses",
        "settingsMore.nearCapTitle" to "Proche de votre plafond de dépenses",
        "settingsMore.atCapBody" to
            "Vous avez atteint le plafond de dépenses que vous avez fixé. Les " +
            "envois et les appels sont en pause tant que vous ne l'augmentez pas. " +
            "Rien n'est facturé au-delà.",
        "settingsMore.nearCapBody" to
            "Vous avez utilisé {percent} % du plafond de dépenses que vous avez " +
            "fixé. Au plafond, les envois et les appels s'arrêtent tant que vous " +
            "ne l'augmentez pas. Rien n'est facturé au-delà.",
        "settingsMore.spendingCap" to "Plafond de dépenses",
        "settingsMore.spendingCapDesc" to
            "Votre protection contre les factures-surprises. Le plafond est un " +
            "multiple de l'utilisation comprise dans votre forfait. Au plafond, " +
            "les envois et les appels s'arrêtent tant que vous ne l'augmentez " +
            "pas. Rien n'est facturé au-delà.",
        "settingsMore.capReadOnly" to
            "Plafond de dépenses : {cap} l'utilisation comprise. Seul le " +
            "propriétaire du compte peut le changer.",
        "settingsMore.sendingPausesAt" to "LES ENVOIS S'ARRÊTENT À",
        "settingsMore.messagesThisPeriod" to "textos pour cette période",
        "settingsMore.oneTimesIncluded" to "1x compris",
        "settingsMore.capMax" to "{cap} max",
        "settingsMore.saveCap" to "Enregistrer le plafond",
        "settingsMore.setTheCap" to "Fixer le plafond",
        "settingsMore.capSetTo" to "Plafond de dépenses fixé à {cap}.",
        "settingsMore.usedOfCap" to "{used} sur {cap}",
        "settingsMore.off" to "Désactivé",
        "settingsMore.aiNearLimit" to
            "Proche de la limite du mois. Elle se réinitialise le 1er.",
        "settingsMore.aiNoOutcomes" to
            "Rien n'est encore enregistré sur l'utilisation qui en a été faite.",
        "settingsMore.storageReceived" to "Pièces jointes reçues",
        "settingsMore.storageSent" to "Pièces jointes envoyées",
        "settingsMore.storageNotes" to "Fichiers dans les notes",
        "settingsMore.storageVoicemail" to "Enregistrements de boîte vocale",
        "settingsMore.storageOther" to "Autres fichiers",
        "settingsMore.storedFree" to
            "{size} stockés. Gratuit sur tous les forfaits, sans plafond.",
        "settingsMore.details" to "Détails",
        "settingsMore.detailsBlurb" to
            "Les chiffres bruts, mois par mois, si vous les voulez.",
        "settingsMore.hideNumbers" to "Masquer les chiffres",
        "settingsMore.showNumbers" to "Afficher les chiffres",
        "settingsMore.storage" to "Stockage",
        "settingsMore.louThisMonth" to "Lou ce mois-ci",
        "settingsMore.louThisMonthLine" to
            "Ce que Lou a rédigé, rempli et transcrit. Chaque compteur se " +
            "réinitialise le 1er.",
        "settingsMore.lastSixMonths" to "6 derniers mois",
        "settingsMore.lastSixMonthsLine" to "Textos sortants par mois civil.",
        "settingsMore.howCounted" to "Comment les textos sont comptés",
        "settingsMore.howCountedLine" to
            "Un texto d'au plus 160 caractères compte pour un message ; les " +
            "textos plus longs se divisent en segments de 160 caractères (70 avec " +
            "des émojis ou des accents). Un message avec photo compte pour trois. " +
            "Les messages entrants sont toujours gratuits.",
        "settingsMore.messages" to "Textos",
        "settingsMore.messagesUsed" to
            "{used} des {included} textos compris utilisés{range}.",
        "settingsMore.commaRange" to ", {range}",
        "settingsMore.messagesOverage" to
            "{over} au-delà de ce qui est compris : {amount} en dépassement sur " +
            "votre prochaine facture.",
        "settingsMore.messagesNoOverage" to
            "Aucun dépassement pour cette période. 0,00 $ de plus jusqu'ici.",
        "settingsMore.messagesPauseAt" to "Les envois s'arrêtent à {count} textos",
        "settingsMore.messagesPauseMax" to
            ", le maximum, soit 10 fois les textos compris dans votre forfait.",
        "settingsMore.messagesInbound" to
            "{count} textos reçus pour cette période. La réception est toujours gratuite.",
        "settingsMore.callingMinutes" to "Minutes d'appel",
        "settingsMore.minutesUsed" to "{used} des {included} minutes comprises utilisées.",
        "settingsMore.minutesOverage" to
            "{extra} minutes de plus jusqu'ici : {amount} sur votre prochaine facture.",
        "settingsMore.minutesBilled" to
            "Au-delà des minutes comprises, chaque minute supplémentaire coûte 1 ¢. " +
            "Les appels s'arrêtent à votre plafond de dépenses, jamais en plein appel.",
        "settingsMore.minutesNotBilled" to
            "Les minutes supplémentaires ne sont pas facturées sur votre forfait.",
        "settingsMore.countryUs" to "États-Unis",
        "settingsMore.countryCa" to "Canada",
        "settingsMore.countryElsewhere" to "Ailleurs",
        "settingsMore.deliveryTitle" to "Vos textos arrivent-ils ?",
        "settingsMore.deliveryDesc" to
            "Livraison rapportée par les fournisseurs pour cette période. Qu'un " +
            "fournisseur confirme avoir pris le message ne veut pas dire que " +
            "quelqu'un l'a lu : c'est le plus que nous pouvons honnêtement vous dire.",
        "settingsMore.deliveryDelivered" to "{count} livrés avec confirmation",
        "settingsMore.deliveryFailed" to " · {count} ne se sont pas rendus",
        "settingsMore.deliveryPending" to " · {count} encore en route",
        "settingsMore.deliveryByCountry" to "{country} : {figure}",
        "settingsMore.deliveryCounts" to "{delivered} sur {total}",
        "settingsMore.deliveryPercent" to "{percent} %",
        "settingsMore.deliveryFailureNote" to
            "Un texto qui ne se rend pas vient généralement d'un numéro débranché " +
            "ou d'un appareil éteint depuis des jours. Ouvrez la conversation : le " +
            "message lui-même dit ce que le fournisseur a rapporté.",
        "settingsMore.deliveryNothingBounced" to "Rien n'a rebondi pour cette période.",

        // -- A greeting in the owner's own voice ------------------------------
        "settingsMore.takeWontPlay" to
            "Cet enregistrement ne peut pas être joué. Enregistrez-le de nouveau.",
        "settingsMore.micUnavailable" to
            "Le microphone n'est pas disponible. Terminez tout appel et réessayez.",
        "settingsMore.micRefused" to
            "Loonext a besoin du microphone pour enregistrer un message d'accueil. " +
            "Autorisez-le dans les Paramètres, puis réessayez.",
        "settingsMore.nothingRecorded" to
            "Rien n'a été enregistré. Essayez de tenir le téléphone plus près.",
        "settingsMore.greetingSaved" to
            "Enregistré. Choisissez-le sur un numéro pour l'utiliser.",
        "settingsMore.namedGreetingSaved" to
            "« {name} » enregistré. Choisissez-le sur un numéro pour l'utiliser.",
        "settingsMore.ownVoiceTitle" to "Votre propre voix",
        "settingsMore.ownVoiceDesc" to
            "Enregistrez le message d'accueil vous-même au lieu de le faire lire à " +
            "voix haute. Les appelants entendent une personne, et c'est justement " +
            "ce que vous vendez.",
        "settingsMore.noGreetingsYet" to
            "Rien d'enregistré pour l'instant — les appelants entendent le message " +
            "écrit, lu à voix haute.",
        "settingsMore.pickGreetingOnNumber" to
            "Choisissez-en un sur un numéro, sous Numéros, pour l'utiliser. Tout ce " +
            "que vous n'avez pas choisi reste inutilisé.",
        "settingsMore.recordedLength" to "Enregistré : {length}",
        "settingsMore.hearItBack" to "Réécouter",
        "settingsMore.exactlyWhatCallerGets" to
            "C'est exactement ce qu'un appelant entend.",
        "settingsMore.nameIt" to "Nommez-le",
        "settingsMore.recordAgain" to "Enregistrer de nouveau",
        "settingsMore.saveGreeting" to "Enregistrer le message",
        "settingsMore.recordingNow" to "Enregistrement… parlez maintenant.",
        "settingsMore.stop" to "Arrêter",
        "settingsMore.upToTwoMinutes" to "Jusqu'à deux minutes.",
        "settingsMore.record" to "Enregistrer",
        "settingsMore.haveUsCallYou" to "Faites-nous plutôt vous appeler",
        "settingsMore.ratherOnThePhone" to "Vous préférez le faire au téléphone ?",
        "settingsMore.deleteGreetingTitle" to "Supprimer « {name} » ?",
        "settingsMore.deleteGreetingBody" to
            "Tout numéro qui l'utilise revient aux mots écrits, lus à voix haute. " +
            "Les appelants entendent le changement au prochain appel.",
        "settingsMore.deletedToast" to "Supprimé.",
        "settingsMore.callingNow" to "Appel de {number} en cours",
        "settingsMore.answerAndListen" to "Répondez, et vous entendrez quoi faire.",
        "settingsMore.captureStep1" to "1. Attendez le bip.",
        "settingsMore.captureStep2" to "2. Dites ce que vos appelants doivent entendre.",
        "settingsMore.captureStep3" to "3. Raccrochez. Ça s'enregistre tout seul.",
        "settingsMore.captureWillAppear" to
            "Il apparaîtra ci-dessus sous « {name} » une fois reçu. Vous pouvez " +
            "fermer cette fenêtre.",
        "settingsMore.recordOnPhone" to "L'enregistrer au téléphone",
        "settingsMore.recordOnPhoneBody" to
            "Nous vous appelons, vous parlez après le bip, et vous raccrochez. " +
            "Aucune permission de microphone, rien à tenir.",
        "settingsMore.captureNumberSample" to "(613) 555-0199",
        "settingsMore.calling" to "Appel…",
        "settingsMore.callMe" to "Appelez-moi",

        // -- What's new ------------------------------------------------------
        "settingsMore.whatsNewIntro" to
            "Tout ce qui est ici est déjà livré et se trouve dans le produit.",
        "settingsMore.whatsNewBadge" to "Nouveau",
        "settingsMore.whatsNewFooter" to
            "De petites corrections sortent presque tous les jours et ne sont pas " +
            "listées. Si vous avez signalé quelque chose et voulez savoir où ça en " +
            "est, écrivez-nous depuis la page Aide.",
        "settingsMore.whatsNewSavedViewsTitle" to
            "Enregistrez les filtres que vous utilisez chaque matin",
        "settingsMore.whatsNewSavedViewsBody" to
            "Organisez la boîte de réception comme vous voulez, nommez-la, et elle " +
            "est à une touche demain matin. Partagez-en une avec l'équipe et tout " +
            "le monde ouvre la même liste.",
        "settingsMore.whatsNewQuotesTitle" to
            "Voyez combien de devis sont devenus des contrats",
        "settingsMore.whatsNewQuotesBody" to
            "Votre écran d'accueil montre maintenant combien de devis vous avez " +
            "envoyés, combien vous avez obtenus, et combien attendent encore une " +
            "réponse.",
        "settingsMore.whatsNewVoicemailTitle" to
            "Les messages vocaux sont transcrits",
        "settingsMore.whatsNewVoicemailBody" to
            "Un appel manqué laisse un message vocal que vous pouvez lire à un feu " +
            "rouge au lieu de l'écouter. Il se cherche comme n'importe quel autre " +
            "message.",
        "settingsMore.whatsNewDraftsTitle" to "Lou rédige la réponse pour vous",
        "settingsMore.whatsNewDraftsBody" to
            "Lou lit la conversation et propose une réponse que vous pouvez " +
            "modifier avant l'envoi. Vous l'envoyez, ou vous l'ignorez ; rien " +
            "n'est envoyé en votre nom.",
        "settingsMore.whatsNewCallsTitle" to "Répondez aux appels dans l'application",
        "settingsMore.whatsNewCallsBody" to
            "Les appels à votre numéro d'affaires font sonner toute votre équipe " +
            "ici même. Répondez, mettez quelqu'un en attente, ou transférez " +
            "l'appel à un coéquipier.",

        // -- The workspace itself --------------------------------------------
        "settingsMore.workspaceName" to "Nom de l'espace de travail",
        "settingsMore.workspaceNameDesc" to
            "Le nom sous lequel vos clients vous connaissent, utilisé pour votre " +
            "inscription auprès des fournisseurs et offert comme {business_name} " +
            "dans vos textos.",
        "settingsMore.nameLength200" to "De 1 à 200 caractères.",
        "settingsMore.workspaceNameSaved" to "Nom de l'espace de travail enregistré.",
        "settingsMore.onlyAdminsRename" to
            "Seuls les propriétaires et les admins peuvent renommer l'espace de travail.",
        "settingsMore.businessIdCard" to "Identification de l'entreprise",
        "settingsMore.businessIdCardDesc" to
            "Ce que les fournisseurs ont au dossier pour votre entreprise. Cela " +
            "vient de votre inscription pour les textos.",
        "settingsMore.noRegistrationNeeded" to
            "Aucune inscription requise. Les textos au Canada fonctionnent sans. " +
            "Activer les textos vers les États-Unis en ajoute une.",
        "settingsMore.noRegistrationYet" to
            "Aucun renseignement d'inscription au dossier pour l'instant. Gérez " +
            "l'inscription sous Numéros.",
        "settingsMore.changeRegistrationUnderNumbers" to
            "Besoin de changer quelque chose ? Gérez l'inscription sous Numéros.",
        "settingsMore.registrationIs" to
            "L'inscription est {state}. Les propriétaires et les admins peuvent " +
            "voir tous les détails.",
        "settingsMore.registrationApproved" to "approuvée",
        "settingsMore.registrationOnFile" to "au dossier",
        "settingsMore.ssnLast4" to "SSN (4 derniers chiffres)",
        "settingsMore.sinLast4" to "NAS (4 derniers chiffres)",
        "settingsMore.legalName" to "Dénomination sociale",
        "settingsMore.addressLabel" to "Adresse",
        "settingsMore.websiteLabel" to "Site Web",
        "settingsMore.contactLabel" to "Contact",
        "settingsMore.registrationBeingPrepared" to
            "Les renseignements d'inscription sont en préparation.",
        "settingsMore.timezoneDesc" to
            "Les dates dans les courriels au sujet de votre espace de travail sont " +
            "exprimées dans l'heure locale de votre entreprise.",
        "settingsMore.localTimeNow" to "Il est {time} à {zone} en ce moment.",
        "settingsMore.quietHoursNote" to
            "Les heures de silence des textos suivent l'heure locale de chaque " +
            "client, pas ce fuseau horaire.",
        "settingsMore.changeTimezone" to "Changer le fuseau horaire",
        "settingsMore.onlyAdminsTimezone" to
            "Seuls les propriétaires et les admins peuvent changer le fuseau horaire.",
        "settingsMore.timezoneSaved" to "Fuseau horaire enregistré.",
        "settingsMore.timezoneSearchHint" to "Rechercher, p. ex. Toronto",
        "settingsMore.noTimezoneMatch" to "Aucun fuseau horaire ne correspond à « {query} ».",
        "settingsMore.signTextsTitle" to "Signer vos textos",
        "settingsMore.signTextsDesc" to
            "Ajoutez le nom de votre entreprise au premier texto que vous envoyez " +
            "à quelqu'un, pour qu'un message venant d'un numéro inconnu dise de " +
            "qui il vient.",
        "settingsMore.signFirstText" to "Signer le premier texto à un nouveau client",
        "settingsMore.signFirstTextSupporting" to
            "Une fois par client. Les réponses et les textos suivants ne sont " +
            "jamais signés.",
        "settingsMore.whatGetsAdded" to "Ce qui est ajouté",
        "settingsMore.signatureLength" to
            "Cela fait {count} caractères : un premier texto long peut donc être " +
            "envoyé en deux parties plutôt qu'une.",
        "settingsMore.onlyAdminsSigning" to
            "Seuls les propriétaires et les admins peuvent changer la signature des textos.",
        "settingsMore.nightTextTitle" to "Écrire à un nouveau client la nuit",
        "settingsMore.nightTextDesc" to
            "Démarrer une toute nouvelle conversation entre 20 h et 8 h, heure du " +
            "client, vous demande d'abord de confirmer.",
        "settingsMore.askMeToConfirm" to "Me demander de confirmer",
        "settingsMore.askMeToConfirmSupporting" to
            "Seulement quand c'est vous qui démarrez la conversation. Répondre à " +
            "un client qui vous a écrit ou appelé n'est jamais interrompu.",
        "settingsMore.withThisOff" to "Avec ce réglage désactivé",
        "settingsMore.withThisOffBody" to
            "On ne vous demandera rien. Un texto que vous démarrez à 2 h part " +
            "directement, et c'est à vous de juger que le client voulait avoir de " +
            "vos nouvelles à ce moment-là.",
        "settingsMore.nightTextAutomatedNote" to
            "Cela ne change rien aux textos automatisés. Les rappels et tout ce " +
            "que nous envoyons en votre nom attendent toujours le matin du client, " +
            "quel que soit ce réglage.",
        "settingsMore.onlyAdminsThis" to
            "Seuls les propriétaires et les admins peuvent changer ce réglage.",
        "settingsMore.automatedLanguageTitle" to "Langue des textos automatisés",
        "settingsMore.automatedLanguageDesc" to
            "La langue dans laquelle nous écrivons quand nous textons un client " +
            "pour vous : la réponse hors des heures, le texto d'appel manqué, " +
            "l'accusé de réception d'urgence et la demande d'évaluation après un " +
            "travail.",
        "settingsMore.languageUpdated" to "Langue mise à jour.",
        "settingsMore.automatedLanguageNotApp" to
            "Cela ne change pas l'application elle-même, et cela ne réécrit jamais " +
            "les mots que quelqu'un a tapés. Un message d'absence que vous avez " +
            "écrit est envoyé exactement tel quel, dans la langue où vous l'avez " +
            "écrit.",
        "settingsMore.automatedLanguagePerContact" to
            "Un client qui devrait recevoir vos messages dans l'autre langue peut " +
            "être réglé sur sa propre fiche.",
        "settingsMore.onlyAdminsLanguage" to
            "Seuls les propriétaires et les admins peuvent changer la langue.",

        // -- The shared confirm dialog ---------------------------------------
        "settingsMore.working" to "En cours…",

        // -- #366: a crew bigger than one call can ring ----------------------
        "settingsMore.ringCeilingLine" to
            "{targets} personnes pourraient être jointes par un appel à ce numéro, " +
            "et un appel en fait sonner {limit}. Tout le monde passe à tour de " +
            "rôle — {limit} personnes différentes à chaque appel — mais personne " +
            "n'est joint à tous les appels.",

        "settingsMore.tfaFactorName" to "Loonext sur Android",

        "settingsMore.exportUsageAction" to "Exporter l'utilisation",
        "settingsMore.exportUsageBlurb" to
            "Vos textos, vos appels et votre stockage pour une période, sous forme " +
            "de fichier pour la personne qui tient vos livres.",
        "settingsMore.exportUsageNote" to
            "Le fichier compte ce que nous avons mesuré — ce n'est pas une copie de " +
            "votre facture Stripe, et rien n'y est chiffré en dollars. Il est " +
            "assemblé en arrière-plan et apparaît sous Exportation de données.",

        // Copié de `thread.cantReachLoonext` : même refus, mêmes mots.
        "settingsMore.cantReachLoonext" to
            "Impossible de joindre Loonext. Vérifiez votre connexion.",
        "settingsMore.cantReachSignIn" to
            "Impossible de joindre le service de connexion. Vérifiez votre connexion.",
        "settingsMore.somethingWentWrongStatus" to
            "Une erreur s'est produite ({status}).",

        // Copié de `settingsMore.numberHealthRate` / `numberHealthRateUnknown` /
        // `numberHealthBody` sur le web, caractère pour caractère.
        "settingsMore.numberHealthRate" to
            "Environ {percent} % de vos textos récents ont été livrés, ce qui est " +
            "sous la normale pour ce numéro.",
        "settingsMore.numberHealthNoRate" to
            "Moins de vos textos se rendent à destination qu'à l'habitude.",
        "settingsMore.numberHealthCause" to
            "Les fournisseurs se mettent parfois à filtrer un numéro — souvent un " +
            "numéro réutilisé d'une entreprise précédente. Nous avons été avertis et " +
            "nous nous en occupons ; vous n'avez rien à faire pour le moment.",

        // Copié de `settingsMore.releaseBodyPlain` / `releaseBodyOverAllowance`
        // sur le web, caractère pour caractère.
        "settingsMore.releaseBody" to
            "Cela abandonne le numéro pour de bon. Les clients qui le textent ne vous " +
            "joindront plus, et vous ne pouvez pas récupérer le même numéro. Cela ne " +
            "change ni votre forfait ni ce que vous payez — un numéro est inclus, " +
            "alors vous pouvez en configurer un nouveau ici par la suite. Tapez le " +
            "numéro pour confirmer.",
        "settingsMore.releaseBodyHeld" to
            "Ce numéro n'est pas couvert par votre forfait, et le libérer est l'autre " +
            "façon de sortir de cette attente — cela met fin à l'attente en " +
            "abandonnant le numéro plutôt qu'en le rétablissant. Les clients qui le " +
            "textent ne vous joindront plus par la suite, et vous ne pouvez pas " +
            "récupérer le même numéro. Votre forfait cesse de dépasser son allocation, " +
            "et ce que vous payez ne change pas. Tapez le numéro pour confirmer.",

        "settingsMore.extraNumberCountry" to
            "Les numéros supplémentaires sont offerts aux espaces de travail " +
            "américains et canadiens.",
        "settingsMore.extraNumberUsTexting" to
            "Un numéro supplémentaire exige d'abord que les textos américains " +
            "soient activés pour votre espace de travail.",
        "settingsMore.extraNumberCurrency" to
            "Les numéros supplémentaires sont facturés en dollars américains et ne " +
            "peuvent pas encore être ajoutés à un abonnement facturé dans une autre " +
            "devise. Écrivez au soutien et nous arrangerons cela.",
    )
}
