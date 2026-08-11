/**
 * #228 — the words Settings (second half) says, in both languages.
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

export const settingsMoreEn = {
  /* Words this half of Settings says in more than one card. */
  saveFailed: "Couldn't save. Try again.",
  teammate: "Teammate",

  /* Who can use this number (#106) */
  numberAccessTitle: "Who can use {number}?",
  numberAccessDescription:
    "Owners and admins can always use every number. Limiting a number hides " +
    "its conversations from everyone else you don't include.",
  numberAccessGroupAria: "Who can use this number",
  numberAccessEveryone: "Everyone",
  numberAccessEveryoneHint: "The whole team can text, like today.",
  numberAccessMembersView: "Members: view & notes only",
  numberAccessMembersViewHint:
    "Members can read and add notes, but not text. Admins still text.",
  numberAccessAdmins: "Admins only",
  numberAccessAdminsHint: "Members can't see this number at all.",
  numberAccessUsers: "Specific people",
  numberAccessUsersHint:
    "Only the people you pick. Admins still text.",
  numberAccessNoTeammates: "No teammates yet — invite them from Settings › Team.",
  numberAccessLevelAria: "What the picked people can do",
  numberAccessCanText: "Can text",
  numberAccessNoteOnly: "View & notes only",
  numberAccessPickSomeone: "Pick at least one person, or choose Everyone.",
  numberAccessSaved: "Saved who can use this number.",

  /* One number's card on Settings → Numbers */
  numberStatusActive: "Active",
  numberStatusSettingUp: "Setting up",
  numberStatusActionNeeded: "Action needed",
  numberStatusSetupFailed: "Couldn't set up",
  numberStatusSuspended: "Suspended",
  numberStatusReleased: "Released",
  numberAreaCode: "Area code {code}",
  numberCopyAria: "Copy number",
  numberCopied: "Number copied.",
  numberCopyFailed: "Couldn't copy the number.",
  numberSetupSlow:
    "We're still setting up your number. This is taking a little longer " +
    "than usual.",
  numberSetupStalled:
    "Setup is taking longer than expected. Choose a number to finish — you " +
    "won't be charged again.",
  numberAreaCodeEmpty:
    "Area code {code} is out of new numbers right now. Choose another number " +
    "to finish setup.",
  numberSetupFailed:
    "We couldn't finish setting up your number. Choose a number to try again.",
  numberReleasedOn: "Released {date}.",
  numberChooseAction: "Choose a number",
  numberWhoCanUseAction: "Who can use this number…",
  numberHowItAnswersAction: "How this line answers…",
  numberWhenOpenAction: "When this line is open…",
  numberReleaseAction: "Release this number…",

  /* A carrier is filtering this line (#235) */
  numberHealthTitle: "Messages from this number aren't arriving reliably",
  numberHealthBody:
    "Carriers sometimes start filtering a number — often one that was reused " +
    "from a previous business. We've been alerted and we're on it; you don't " +
    "need to do anything yet.",
  numberHealthRateUnknown: "Fewer of your texts are getting through than usual.",
  numberHealthRate:
    "About {percent}% of your recent texts were delivered, which is below " +
    "normal for this number.",
  numberHealthSince: "Since {date}",

  /* Why a suspended number is suspended (#523) */
  numberHoldOverAllowanceUnknown:
    "On hold — your plan covers fewer numbers than you have. Texts and calls " +
    "still come through and nothing has been given up; you just can't send or " +
    "answer from it.",
  numberHoldOverAllowanceOne:
    "On hold — your plan covers {count} number and you have more. Texts and " +
    "calls still come through and nothing has been given up; you just can't " +
    "send or answer from it.",
  numberHoldOverAllowanceMany:
    "On hold — your plan covers {count} numbers and you have more. Texts and " +
    "calls still come through and nothing has been given up; you just can't " +
    "send or answer from it.",
  numberHoldBringBackLink: "See how to bring it back",
  numberHoldPaused: "Texting is paused.",
  numberHoldUpdatePaymentLink: "Update your payment method",
  numberHoldTurnBackOn: "to turn it back on.",
  numberHoldPausedHere: "Texting is paused on this number.",
  numberHoldCheckBillingLink: "Check billing",
  numberHoldToSeeWhy: "to see why.",

  /* Said by both per-number dialogs (#307) */
  loading: "Loading…",
  sameAsWorkspace: "Same as your workspace",
  useWorkspaces: "Use the workspace's",
  backToWorkspace: "Back to your workspace's.",
  numberNotLoaded: "That number could not be loaded.",
  saveFailedGeneric: "That could not be saved.",
  changeFailedGeneric: "That could not be changed.",

  /* When this line is open (#307) */
  numberHoursTitle: "When this line is open",
  numberHoursDescription:
    "The after-hours reply on this number follows this clock. Leave it alone " +
    "and it follows your workspace.",
  timezoneLabel: "Timezone",
  numberOpenHoursLabel: "Open hours",
  numberHoursSaved: "Saved. This line keeps these hours from now on.",

  /* How this line answers (#307) */
  numberIdentityTitle: "How this line answers",
  numberIdentityDescription:
    "Anything you leave alone follows your workspace. Change one here and it " +
    "only affects this number.",
  numberIdentitySaved: "Saved. New callers hear this straight away.",
  numberIdentityMctbLabel: "Text back a missed caller",
  numberIdentityMctbHint: "Sent from this line when a call goes unanswered.",
  numberIdentityVoiceLabel: "Voicemail voice",
  numberIdentityWrittenGreeting: "The written greeting, read aloud",
  numberIdentityVoiceHint:
    "A recording that will not play falls back to the words below, so a " +
    "caller never hears silence.",
  numberIdentityAfterHoursLabel: "After-hours calls",
  numberIdentityRingEveryone: "Ring everyone, day or night",
  numberIdentityOnCallOnly: "Ring only whoever's on call",
  numberIdentityTakeMessage: "Take a message",
  numberIdentityAfterHoursHint:
    "Outside this line's hours. With nobody on call, the last two still " +
    "differ — one rings the crew anyway, the other takes a message.",
  numberIdentityRingLabel: "How the phones ring",
  numberIdentityRingAll: "All at once",
  numberIdentityRingInTurn: "One at a time",
  numberIdentityRingSecondsLabel: "How long they ring",
  numberRingLength: "{seconds} seconds · about {rings} rings",
  numberIdentityLeadSourceLabel: "Where this line is advertised",
  numberIdentityUntracked: "Not advertised anywhere",
  numberIdentityLeadSourceHint:
    "Every new conversation on this line is counted here, with nobody tapping " +
    "anything. Changing it later does not relabel the customers you already " +
    "have.",
  numberIdentityNameLabel: "Name for this line",
  numberIdentityNameHint:
    "Used in the greeting, on missed-call texts, and wherever this line " +
    "introduces itself.",
  numberIdentityVoicemailLabel: "Voicemail greeting",
  numberIdentityVoicemailHint: "What a caller hears when nobody picks up.",
  numberIdentityAwayLabel: "After-hours reply",
  numberIdentityAwayHint:
    "The text sent when somebody messages this line outside your hours.",
  numberIdentityMctbTextLabel: "Missed-call text",
  numberIdentityMctbTextHint:
    "What a caller gets when nobody picks up and they hang up.",

  /* Tell your customers where you went (#481) */
  offRampTitle: "Tell your customers where you went",
  offRampLead: "Anyone who texts your old number gets this back, once each.",
  offRampHoldEndedOn: "The hold ended on",
  offRampStopsOn: "It stops on",
  offRampAfterEnded:
    ". We are not holding the number for you any more. Once it goes back to " +
    "the phone company we can't answer it, and texts to it reach whoever gets " +
    "it next.",
  offRampAfterUpcoming:
    ", when the number goes back to the phone company. After that we can't " +
    "answer it, and texts to it reach whoever gets it next.",
  offRampNoDate:
    "It stops when the number goes back to the phone company. After that we " +
    "can't answer it, and texts to it reach whoever gets it next.",
  offRampPlaceholder:
    "We've moved to (416) 555-0123 — call or text us there and we'll pick " +
    "right up.",
  offRampAria: "Message sent to customers who text your old number",
  offRampNothingSent: "Nothing is sent until you write something here.",
  offRampCharacterCount:
    "{count} of {max} characters. Your words, sent as they are.",
  offRampTurnOff: "Turn off",
  offRampStartSending: "Start sending this",

  /* Who is holding the phone tonight (#244) */
  someone: "Someone",
  remove: "Remove",
  onCallPersonOnCall: "{name} is on call",
  onCallSetFailed: "Could not set that shift",
  onCallEndShift: "End shift",
  onCallPutSomebody: "Put somebody on call",

  /* The paid pause (#277) */
  pauseOfferHeading: "Pause instead — keep the number for {amount} a month",
  pauseOfferBody:
    "{amount} a month instead of your plan fee. Your number and your whole " +
    "message history stay exactly where they are, and texts your customers " +
    "send still arrive — you cannot send or take calls until you are back, " +
    "and anything you had scheduled waits rather than fails. Nothing expires " +
    "while you are paused, so there is no deadline on the number and nothing " +
    "to set up again. Come back to the same plan whenever the work does.",
  pauseOfferAction: "Pause for {amount} a month",
  pauseConfirmation:
    "Your plan is paused. Your number and your history are held.",
  resumeConfirmation: "You're back. Texting is on again.",
  didNotGoThrough: "That didn't go through. Try again in a moment.",
  pausing: "Pausing…",
  pausedTitle: "Your plan is paused",
  pausedTextingOff:
    "Texting is off. You can't send messages or take calls while your plan is " +
    "paused.",
  pausedNothingLost:
    "Texts your customers send still arrive, so nothing is lost — and " +
    "anything you had scheduled is waiting rather than failed. Your number " +
    "and your whole message history are exactly where you left them.",
  pausedPayingLead: "You're paying",
  pausedPayingAmount: "{amount} a month",
  pausedPayingTail: "to hold them.",
  pausedPayingSince: "to hold them, since {date}.",
  resuming: "Resuming…",
  resume: "Resume",
  pausedResumeNote:
    "{plan} starts again at its usual price, with everything where it is.",

  /* Add-ons (#12) */
  modulesTitle: "Add-ons",
  modulesDescription:
    "Turn extra features on or off. Changes prorate to today, so you never " +
    "pay for time you didn't have them.",
  modulesLoading: "Loading add-ons",
  modulesLoadFailed: "We couldn't load your add-ons.",
  moduleAdded: "{name} added. The prorated charge is on today's invoice.",
  moduleRemoved:
    "{name} turned off. If it was on your bill, the unused time is credited " +
    "toward your next invoice.",
  moduleUpdateFailed: "We couldn't update that add-on. Try again.",
  /**
   * One add-on's toggle card (billing/module-card.tsx), shared by this screen
   * and the onboarding plan step. `{name}` is the add-on's own label, which
   * comes from the API catalogue and is not ours to translate here.
   */
  moduleCardAria: "{name} add-on",
  modulePricePerMonth: "{price}/mo",

  /* Ownership (#332) */
  ownershipTitle: "Ownership",
  ownershipDescription:
    "The owner controls billing, the spending cap, and your numbers. Only " +
    "they can hand that on.",
  ownershipTeammateFallback: "a teammate",
  ownershipTeammateOption: "A teammate",
  ownershipActionFailed: "That didn't go through. Try again.",
  ownershipOffered: "Ownership has been offered to {name}.",
  ownershipAskedToTakeOver: "{name} has asked to take over this workspace.",
  ownershipOfferExpires:
    "Nothing changes until they accept. The offer expires {when}.",
  ownershipWaitOver:
    "The waiting period is over. They can complete this at any time.",
  ownershipCompletesAt:
    "This completes {when} unless the owner stops it. Stopping it takes " +
    "effect immediately.",
  ownershipNowYours: "You now own this workspace.",
  ownershipAccept: "Accept ownership",
  ownershipCompleteTakeover: "Complete the takeover",
  ownershipStopped: "Stopped. Nothing changed hands.",
  ownershipStopThis: "Stop this",
  ownershipDecline: "Decline",
  ownershipOwnerLabel: "Owner",
  ownershipYou: "You",
  ownershipBackupOwner: "Backup owner",
  ownershipNobodyNamed: "Nobody named",
  ownershipBackupBody:
    "If you ever can't get in — you lose your email, or worse — this is the " +
    "one person who can ask to take over. They wait a week, you can stop it " +
    "with one click, and everyone gets told. Nothing changes today.",
  ownershipBackupCleared: "Backup owner cleared.",
  ownershipBackupSet: "{name} is your backup owner.",
  ownershipChooseTeammate: "Choose a teammate",
  ownershipNobody: "Nobody",
  ownershipInviteFirst: "Invite someone first — a backup has to be on the team.",
  ownershipHandOverTitle: "Hand the workspace over",
  ownershipHandOverBody:
    "They have to accept. You stay on the team as an admin.",
  ownershipHandItOver: "Hand it over",
  ownershipYouAreBackup: "You are the backup owner",
  ownershipClaimBody:
    "If the owner can't act, you can ask to take over. They get a week to " +
    "stop it, and everyone on the team is told straight away.",
  ownershipAskToTakeOver: "Ask to take over",
  ownershipOfferDialogTitle: "Hand this workspace to {name}?",
  ownershipClaimDialogTitle: "Ask to take over this workspace?",
  ownershipOfferDialogBody:
    "Nothing changes until they accept. When they do, they control billing, " +
    "the spending cap, and your numbers — and you stay on the team as an " +
    "admin. You can cancel any time before they accept, and everyone will be " +
    "told either way.",
  ownershipClaimDialogBody:
    "The owner will be emailed straight away and can stop this with one click " +
    "for the next 7 days. Everyone on the team is told too. If nobody stops " +
    "it, you can complete the takeover after 7 days. Only do this if the " +
    "owner genuinely cannot act.",
  ownershipOfferIt: "Offer it",
  ownershipOfferSent: "Offered to {name}. They have 7 days to accept.",
  ownershipClaimSent: "Asked. The owner has 7 days to stop it.",

  /* Transferring a number in (PORTING.md) */
  portSwitchDateUnknown: "your switch-over date",
  portStepDone: ", done",
  portStepInProgress: ", in progress",
  portStepUpcoming: ", upcoming",
  portCancelAction: "Cancel this transfer…",
  portCancelTitle: "Cancel the transfer of {number}?",
  portCancelDescription:
    "Your number stays with your current carrier and nothing changes. You can " +
    "start the transfer again later.",
  portKeepTransferring: "Keep transferring",
  portCancelConfirm: "Cancel transfer",
  portCancelling: "Cancelling…",
  portCancelled: "Transfer cancelled.",
  portCancelFailed: "Couldn't cancel the transfer. Try again.",
  portCancelledPill: "Transfer cancelled",
  portCancelledBody:
    "This number stayed with your previous carrier. You can start a new " +
    "transfer any time.",
  portSubmitted: "Transfer sent to your carrier. We'll keep you posted.",
  portSubmitFailed: "Couldn't send the transfer. Try again in a moment.",
  portOnHold: "On hold",
  portLive: "Live on Loonext",
  portTransferring: "Transferring to Loonext",
  portSending: "Sending…",
  portSubmitAction: "Submit transfer",
  portUploadThenSubmit:
    "Upload your signed authorization and a recent bill above, then submit " +
    "the transfer.",
  portOwnerSubmits:
    "An owner or admin uploads the documents and submits the transfer.",
  portAskOwnerToFix:
    "Ask an owner or admin to fix the flagged details and resubmit.",

  /* The two documents a transfer needs */
  portDocOnFile: "On file",
  portDocNoFile: "No file chosen",
  portDocReplace: "Replace",
  portDocChoose: "Choose",
  portDocReplaceAria: "Replace file: {label}",
  portDocChooseAria: "Choose file: {label}",
  portDocSizeError: "Each file must be a non-empty document under 10 MB.",
  portDocNothingChosen:
    "Choose your signed authorization and/or a recent bill to upload.",
  portDocUploaded: "Documents uploaded.",
  portDocUploadFailed: "Couldn't upload your documents. Try again in a moment.",
  portDocLoaLabel: "Signed authorization (LOA)",
  portDocCaTemplate: "Download the Canadian authorization template",
  portDocInvoiceLabel: "Recent bill",
  portDocUploading: "Uploading…",
  portDocUploadAction: "Upload documents",

  /* Fix what the carrier flagged, then resubmit */
  portFixEntityName: "Account holder name",
  portFixAuthPerson: "Authorized person",
  portFixAccountNumber: "Account number",
  portFixServiceStreet: "Service street address",
  portFixCity: "City",
  portFixState: "State",
  portFixProvince: "Province",
  portFixZip: "ZIP code",
  portFixPostalCode: "Postal code",
  portFixRequired: "Every field except the account number needs a value.",
  portFixResubmitted: "Resubmitted. We'll email you as it moves along.",
  portFixResubmitFailed:
    "Couldn't resubmit the transfer. Try again in a moment.",
  portFixAccountOnFile: "On file, leave blank to keep it",
  portFixDocuments: "Documents",
  portFixResubmitting: "Resubmitting…",
  portFixResubmitAction: "Fix and resubmit",
  portFixUploadFirst:
    "Upload your signed authorization and a recent bill above before " +
    "resubmitting.",

  /* The transfers section on Settings → Numbers */
  portSectionTitle: "Number transfers",
  portSectionDescription: "Bringing your existing number over to Loonext.",
  portBringNumberTitle: "Bring your existing number",
  portBringNumberDescription:
    "Transfer the number your customers already know to Loonext. It's free, " +
    "and it keeps working until the switch completes.",

  /* The tracker, the state banners and the document hints that `porting/copy.ts`
     holds as data (PORTING.md §8/§9).

     They live in a plain module rather than in the port card because the
     onboarding wizard and Settings both draw them, and a customer mid-transfer
     checks whichever screen is to hand. The timing words are the load-bearing
     part: no "instant", no invented percentage, and a window a carrier can
     actually meet. */
  portStepSubmittedLabel: "Transfer requested",
  portStepSubmittedMeaning:
    "We've sent the transfer request to your current carrier.",
  portStepDateConfirmedLabel: "Switch-over date confirmed",
  portStepDateConfirmedMeaning:
    "Your carrier confirmed the date your number moves to Loonext.",
  portStepNumberSwitchedLabel: "Number switched",
  portStepNumberSwitchedMeaning:
    "Your number moved to Loonext. Turning on texting now.",
  portStepTextingLiveLabel: "Texting live",
  portStepTextingLiveMeaning: "Text your customers straight from Loonext.",

  /* The portability check, before any money changes hands. */
  portabilityOk:
    "Good news: {number} can move to Loonext. It'll keep working with your current carrier until the switch-over date.",
  /** The carrier gave no reason, so the sentence says that rather than nothing. */
  portabilityFailReasonUnknown:
    "the carrier reports it can't be transferred right now",
  portabilityFail:
    "We can't transfer this number: {reason}. You can start with a new local number instead.",

  /* The honest window, and the three lines of it shown before payment. */
  portHonestWindow:
    "Your number keeps working with your current provider until the switch completes, usually 1 to 7 business days. We'll email you when it's ready.",
  portTimelineKeepsWorking:
    "Your number keeps working on your current carrier the whole time.",
  portTimelineSwitchDate:
    "It switches to Loonext on the transfer date, usually a few business days to about two weeks (US), often faster in Canada.",
  portTimelineTextingStarts:
    "Texting through Loonext starts once the switch completes. We'll show you exactly where it is and email you at each step.",

  /* One banner per state the transfer can be in. */
  portStateSubmitted:
    "Transfer in progress. We've sent the request to your current carrier. They usually respond within a couple of business days. Your number still works on your old carrier for now.",
  portStateFocConfirmed:
    "Locked in. Your number switches to Loonext on {date}. Nothing works differently until then. We'll email you when it switches.",
  portStateNumberSwitched:
    "Your number moved to Loonext. We're turning on texting now, usually about 10 minutes, occasionally a business day or two. We'll email you the moment it's ready.",
  portStateTextingLive:
    "Your number is live on Loonext. Text your customers straight from here.",
  /** The carrier flagged something and did not say what. */
  portStateVoiceExceptionReasonUnknown:
    "they didn't say exactly what, so check your details below",
  portStateVoiceException:
    "Your carrier flagged something on the transfer: {reason}. Fix it and resubmit. It usually takes a couple of minutes, and there's no fee to try again.",
  portStateMessagingException:
    "Your number moved over, but texting is taking a bit longer. Your old provider hasn't released the texting routing yet. We're escalating with the carrier on your behalf; this usually clears within a business day or two and there's nothing you need to do.",
  portStateAssignmentBlocked:
    "One more step: ask your previous texting provider to remove {number} from their carrier campaign, then we'll finish connecting it. We'll retry automatically once they do.",
  portStateDocumentsPending:
    "Almost there. Upload your signed authorization (LOA) and a recent bill, then submit the transfer to your carrier.",
  portStateBridgeAvailable:
    "Your temporary number {bridge} is ready so you can text today. Once your real number finishes transferring, you can release the temporary one.",

  /* What each of the two required documents actually is, in plain words. */
  portHintLoa:
    "A signed letter authorizing the transfer. Sign it within the last 90 days, and make sure it lists this number and your service address.",
  portHintLoaCa:
    "Canadian carriers use a standard letter. Download the template, sign it, and upload it here.",
  portHintInvoice:
    "A recent bill from your current carrier, less than 30 days old, showing this number and your service address.",

  /* Pay for a year (#400) */
  prepaidYearOpenTitle: "Your year",
  prepaidYearOpenLead:
    "You paid for a year on this plan. Your monthly plan fee is covered until",
  prepaidYearOpenTail:
    ". Texts beyond your included allowance are still billed each month.",
  prepaidYearTitle: "Pay for a year",
  prepaidYearPriceLead: "{price} for {months} months",
  prepaidYearComparison:
    "instead of {twelve} — that's {saving} saved, about {perDay}¢ a day.",
  prepaidYearOneCharge:
    "One charge today. Your plan fee is covered for {months} months; texts " +
    "beyond your included allowance are still billed each month, as now. " +
    "Nothing else about your account changes.",
  prepaidYearOpeningCheckout: "Opening checkout...",
  prepaidYearPayAction: "Pay {price}",

  /* Adding a second number */
  provisionAddNumber: "Add a number",
  provisionDescription:
    "Choose the number your customers will see. It's ready in about a minute.",
  provisionSettingUp: "Setting up…",
  provisionAddAction: "Add number",
  provisionStarted: "Number on the way, usually under a minute.",
  provisionFailed: "Couldn't start the number setup. Try again.",

  /* Notifications rows */
  saveThatFailed: "Couldn't save that.",
  saveThatFailedRetry: "Couldn't save that. Try again.",
  pushContentLabel: "Show message text on lock screens",
  pushContentBody:
    "Notifications show who texted and the first line of what they said, so " +
    "the crew can tell a lead from a “thanks” without unlocking. Turn this " +
    "off and they'll still see who it was, but never what a customer wrote — " +
    "useful if phones are out on the job, in other people's homes.",
  pushContentScope: "This one is for the whole workspace, not just you",
  pushContentScopeEnd: ".",
  pushContentScopeOwnersOnly: " — only owners and admins can change it.",
  quietFromAria: "Quiet from",
  quietUntilAria: "Quiet until",
  quietTo: "to",

  /* Refer another crew (#399) */
  referralTitle: "Refer another crew",
  referralRewardEach: "— {amount} each.",
  referralNobodyYet: "Nobody has used your link yet.",
  referralMonthsEarnedOne: "{count} free month earned so far.",
  referralMonthsEarnedMany: "{count} free months earned so far.",

  /* A carrier said no (#352) */
  rejectionUnknownPort:
    "The carrier turned down this transfer and did not say why in a way we " +
    "can translate.",
  rejectionUnknownRegistration:
    "The carrier turned down this registration and did not say why in a way " +
    "we can translate.",
  rejectionUnknownFix:
    "Check the details below against your official registration paperwork, " +
    "and reply to us if nothing looks wrong.",
  rejectionCarrierSaid: "The carrier said: {reason}",
  rejectionTakeMeToIt: "Take me to it",
  rejectionGetHelp: "Get help from us",
  rejectionMailSubjectPort: "My number transfer keeps getting rejected",
  rejectionMailSubjectRegistration: "My registration keeps getting rejected",

  /* Giving a number up for good (#523) */
  releaseTitle: "Release {number}?",
  releaseTypeToConfirm: "Type {number} to confirm",
  releaseKeep: "Keep the number",
  releaseConfirm: "Release number",
  releasing: "Releasing…",
  releaseDone: "{number} released.",
  releaseFailed: "Couldn't release the number. Try again.",
  releaseBodyPlain:
    "This gives the number up for good. Customers who text it won't reach " +
    "you, and you can't get the same number back. It doesn't change your " +
    "plan or what you pay — a number is included, so you can set up a new " +
    "one here afterward. Type the number to confirm.",
  releaseBodyOverAllowance:
    "This is a number your plan doesn't cover, and releasing it is the other " +
    "way out of that hold — it ends the hold by giving the number up rather " +
    "than by bringing it back. Customers who text it won't reach you " +
    "afterward, and you can't get the same number back. Your plan stops " +
    "being over its allowance, and what you pay doesn't change. Type the " +
    "number to confirm.",
  releaseBodyUnknownHold:
    "This number is already on hold, and releasing it ends the hold by giving " +
    "the number up rather than by bringing it back. Customers who text it " +
    "won't reach you afterward, and you can't get the same number back. What " +
    "you pay doesn't change. We can't tell from here whether your plan has " +
    "room for a replacement — check Billing before you give this one up. Type " +
    "the number to confirm.",

  /* Appointment reminders (#237) */
  discard: "Discard",
  saveFailedGenericRetry: "That could not be saved. Try again.",
  remindersTitle: "Appointment reminders",
  remindersDescription: "A text before the job, so fewer people forget",
  remindersOffBody:
    "Reminders are off. Nothing goes out automatically until you set one up — " +
    "a job booked for tomorrow gets no text from us today.",
  remindersSetUpUsual: "Set up the usual two",
  remindersOffsetLabel: "How long before the job",
  remindersToggleAria: "{when} reminder",
  remindersRemoveAria: "Remove the {when} reminder",
  remindersBodyAria: "What the {when} reminder says",
  remindersAddAnother: "Add another",
  remindersCap: "Two is the most we send. Past that, customers stop reading them.",
  remindersSaveAction: "Save reminders",
  remindersAllOff: "Reminders are off. Nothing will go out automatically.",
  remindersSaved: "Saved. New jobs will carry these reminders.",

  /* Require two-factor for everyone (#314) */
  mfaTitle: "Require two-factor for everyone",
  mfaDescription:
    "Every person on this workspace has to set up an authenticator app. You " +
    "choose how long they get.",
  mfaStateInForce: "Required — in force now",
  mfaStateGrace: "Required — grace period running",
  mfaStateOff: "Not required",
  mfaInForceBody:
    "Anyone without it is asked to set it up before they can use the " +
    "workspace.",
  mfaGraceBody:
    "In force from {when}. Until then everyone keeps working as normal.",
  mfaOffBody:
    "A stolen password is enough to text your customers as you. This is the " +
    "setting that stops that.",
  mfaSwitchAria: "Require two-factor authentication",
  mfaDeadlineFixed:
    "This deadline is fixed. Saving again won't move it — so what you tell " +
    "your crew stays true.",
  mfaConfirmTitle: "Require two-factor for everyone?",
  mfaConfirmBody:
    "Everyone gets a grace period to set it up. After that, anyone without it " +
    "is sent to the setup screen instead of the app — so give the crew long " +
    "enough to do it between jobs.",
  mfaGraceLabel: "Grace period",
  mfaGrace7: "7 days",
  mfaGrace14: "14 days (recommended)",
  mfaGrace30: "30 days",
  mfaGrace0: "Immediately",
  mfaGrace0Warning:
    "Anyone without it right now — including you, if you have not set it up — " +
    "is locked out of the workspace until they do.",
  mfaRequireIt: "Require it",
  mfaOn: "Two-factor is now required.",
  mfaOnWithDeadline: "On. Everyone has until {when}.",
  mfaOff: "Two-factor is no longer required.",

  /* How the phones ring (#278, #366) */
  ringCardTitle: "How the phones ring",
  ringCardDescription:
    "When a call comes in, every phone on the crew can ring together, or they " +
    "can join one at a time so whoever answers most gets first refusal.",
  ringAllDetail:
    "What happens today. Every phone on the crew rings for the whole time, " +
    "and the first to pick up takes the call.",
  ringInTurnDetail:
    "The longest-serving member's phone rings first, alone. Twelve seconds " +
    "later the next joins them, then the next — nobody's phone is ever cut " +
    "off mid-reach.",
  ringWindowOnePhone:
    "Then the caller gets your greeting. In {seconds} seconds, 1 phone gets a " +
    "turn — anyone after that never rings on this line.",
  ringWindowManyPhones:
    "Then the caller gets your greeting. In {seconds} seconds, {phones} " +
    "phones get a turn — anyone after that never rings on this line.",
  ringWindowAll:
    "Then the caller gets your greeting. Longer than 45 seconds isn't " +
    "offered: the call legs themselves end there, so it would be ringing " +
    "nobody could hear.",
  ringOwnersOnly: "Only owners and admins can change how the phones ring.",
  ringStrategySaved: "Ringing updated.",
  ringSecondsSaved: "Ring length updated.",
  ringCeilingLine:
    "{targets} people could be rung by a call to this number, and one call " +
    "rings {limit}. Everyone still takes turns — a different {limit} ring " +
    "each time — but nobody is rung on every call.",

  /* The Settings shell and its nav (G8) */
  settingsHeading: "Settings",
  navSectionsAria: "Settings sections",
  navSomethingNew: "Something new",
  navWorkspace: "Workspace",
  navWorkspaceDesc: "Company name, business identity, timezone",
  navTeam: "Team",
  navTeamDesc: "Members, roles, and invites",
  navNumbers: "Numbers",
  navNumbersDesc: "Your business numbers and US registration",
  navHours: "Hours, away reply & reminders",
  navHoursDesc: "Auto-replies and appointment reminders, in your own words",
  navCalling: "Calling",
  navCallingDesc: "Voicemail, screening, caller ID, text-back",
  navTemplates: "Templates & tags",
  navTemplatesDesc: "Saved replies, and the tags your work is filed under",
  navAi: "Lou",
  navAiDesc: "Pre-fill task address and due date from messages",
  navUsage: "Usage",
  navUsageDesc: "Fair use and the spending cap you control",
  navBilling: "Billing",
  navBillingDesc: "Plan, payment method, and invoices",
  navPayments: "Getting paid",
  navPaymentsDesc: "Take a deposit or a final payment over the thread",
  navNotifications: "Notifications",
  navNotificationsDesc: "Email and push, per person",
  navProfile: "Profile",
  navProfileDesc: "Your name, theme, and sign out",
  navAccount: "Account",
  navAccountDesc: "Email, password, and sign-in methods",
  navDevices: "Devices",
  navDevicesDesc: "What's signed in, and signing it out",
  navHistory: "History",
  navHistoryDesc: "Who changed what, and when",
  navHelp: "Help",
  navHelpDesc: "Get in touch when something isn't right",
  navWhatsNew: "What's new",
  navWhatsNewDesc: "What shipped recently, and where to find it",

  /* Fixing a rejected US registration (§4.4) */
  regEnter: "Enter {what}.",
  regTooLong: "Keep it under {max} characters.",
  regFieldDisplayName: "the business name customers know",
  regFieldStreet: "the street address",
  regFieldCity: "the city",
  regFieldState: "the state",
  regFieldProvince: "the province",
  regFieldZip: "the ZIP code",
  regFieldPostal: "the postal code",
  regFieldFirstName: "your first name",
  regFieldLastName: "your last name",
  regFieldCompanyName: "your legal business name",
  regEmailInvalid: "Enter a contact email address.",
  regPhoneInvalid: "Enter a contact phone number.",
  regSsnLast4: "Enter the last 4 digits of your SSN.",
  regSinLast4: "Enter the last 4 digits of your SIN.",
  regMobileInvalid:
    "Enter a US or Canadian mobile number; it gets the verification text.",
  regWebsiteInvalid:
    "Enter a web address (e.g. mikesplumbing.com) or leave it blank.",
  regEinInvalid: "Enter your 9-digit EIN (numbers only, dashes ok).",
  regCraInvalid: "Enter your CRA business number.",
  regMessageFlowShort:
    "Carriers need at least 40 characters here: describe how customers ask " +
    "you to text them.",
  regMessageFlowLong: "Keep it under 2,048 characters.",
  regSampleShort: "At least 20 characters: a real text you'd send.",
  regSampleLong: "Keep it under 1,024 characters.",
  regFirstNameLabel: "First name",
  regLastNameLabel: "Last name",
  regSsnLabel: "Last 4 of your SSN",
  regSinLabel: "Last 4 of your SIN",
  regSsnHelp:
    "Carriers use it to verify you're a real person. We never store the full " +
    "number.",
  regMobileLabel: "Your mobile number",
  regMobileHelp: "A verification code is texted here after you resubmit.",
  regLegalNameLabel: "Legal business name",
  regLegalNameHelpUs: "Exactly as it appears on your EIN letter.",
  regLegalNameHelpCa: "Exactly as it appears on your CRA registration.",
  regEinLabel: "EIN",
  regBusinessNumberLabel: "Business number",
  regDisplayNameLabel: "Business name customers know",
  regEmailLabel: "Contact email",
  regPhoneLabel: "Contact phone",
  regStreetLabel: "Street address",
  regWebsiteLabel: "Website",
  regWebsiteOptionalLabel: "Website (optional)",
  regVerticalLabel: "Line of work",
  regMessageFlowLabel: "How customers ask you to text them",
  regMessageFlowHelp:
    "Plain words work best. For example, “Customers text our business number " +
    "first, or ask us in person or by phone to text them.”",
  regSample1Label: "Example text you send",
  regSample2Label: "Another example",
  regSubmitting: "Submitting…",
  regResubmitAction: "Resubmit registration",
  regSubmitAction: "Submit registration",
  regSubmitted: "Submitted. We'll email you when carriers approve it.",
  regResubmitFailed: "Couldn't resubmit. Try again in a moment.",

  /* TCR's line-of-work list */
  verticalAgriculture: "Agriculture",
  verticalCommunication: "Communication",
  verticalConstruction: "Construction",
  verticalEducation: "Education",
  verticalEnergy: "Energy",
  verticalEntertainment: "Entertainment",
  verticalFinancial: "Financial",
  verticalGambling: "Gambling",
  verticalGovernment: "Government",
  verticalHealthcare: "Healthcare",
  verticalHospitality: "Hospitality",
  verticalHumanResources: "Human resources",
  verticalInsurance: "Insurance",
  verticalLegal: "Legal",
  verticalManufacturing: "Manufacturing",
  verticalNgo: "Ngo",
  verticalPolitical: "Political",
  verticalPostal: "Postal",
  verticalProfessional: "Professional",
  verticalRealEstate: "Real estate",
  verticalRetail: "Retail",
  verticalTechnology: "Technology",
  verticalTransportation: "Transportation",

  /* The registration section, and its sole-prop code (§4.2/§4.4) */
  regOtpYourMobile: "your mobile",
  regOtpLead:
    "One step left: enter the verification code we sent to {phone} to finish " +
    "US registration.",
  regOtpCodeInvalid: "Enter the 6-digit code from the text.",
  regOtpVerified: "Verified. Registration is moving again.",
  regOtpFailed: "That code didn't work. Try again.",
  regOtpLabel: "Verification code",
  regOtpPlaceholder: "6-digit code",
  regOtpChecking: "Checking…",
  regOtpVerify: "Verify",
  regOtpResent: "New code texted to {phone}.",
  regOtpResendFailed: "Couldn't resend the code. Try again.",
  regOtpSending: "Sending…",
  regOtpResend: "Resend code",
  regUsTextingTitle: "US texting",
  regUsTextingDescription:
    "Texting Canadian numbers already works. Texting US numbers needs a " +
    "one-time carrier registration.",
  regEnableUsAction: "Enable US texting: {fee} one-time",
  regEnableUsConfirmTitle: "Enable US texting?",
  regNotNow: "Not now",
  regStarting: "Starting…",
  regEnableUs: "Enable US texting",
  regEnableUsFailed: "Couldn't start US registration. Try again.",
  regAskOwnerEnableUs:
    "Ask your account owner to enable US texting; it's a one-time {fee} " +
    "carrier registration.",
  regSectionTitle: "US texting registration",
  regSectionDescription:
    "Carriers require every business to register before it can text US " +
    "numbers. We run the process for you.",
  regNotStartedYet:
    "Registration starts automatically once your subscription begins. Nothing " +
    "to do here yet.",
  regStepSubmitted: "Business details submitted",
  regStepSubmittedOn: "Submitted {date}",
  regStepNotSubmitted: "Your details are saved but not submitted yet",
  regStepReview: "Carrier review",
  regStepReviewDetail: "Usually 3 to 7 business days, we handle it",
  regStepLive: "US texting on",
  regStepApprovedOn: "Approved {date}",
  regLive: "US texting is live.",
  regInReview:
    "US texting activates in ~3 to 7 business days (carrier approval). " +
    "Calling, receiving texts, and texting Canadian numbers already work.",
  regDeactivated:
    "US texting is paused while your subscription is inactive. Resubscribing " +
    "restarts carrier approval automatically.",
  regAskOwnerResubmit:
    "Ask an owner or admin to update and resubmit the registration.",
  regAskOwnerSubmit:
    "An owner or admin needs to finish and submit the registration.",

  /* Buying US registration while the plan is paused (#525) */
  usRegPausedHeading: "You can start this while your plan is paused",
  usRegPausedNote:
    "Carrier review takes days either way, and none of it needs your plan " +
    "running. Doing it now means the waiting happens in your quiet season " +
    "rather than in your first week back.",
  usRegTerms:
    "A one-time {fee} registration fee is charged to your card on file, and " +
    "we register your business with US carriers. Approval usually takes 3 to " +
    "7 business days.",
  usRegRunningTail: "We handle it and email you when it's live.",
  usRegPausedTermMoney:
    "The {fee} is charged today, and it is charged once ever — not again when " +
    "you come back.",
  usRegPausedTermWait:
    "Carriers review you while your plan is paused. The pause does not hold " +
    "the registration up.",
  usRegPausedTermLimit:
    "Sending stays off until you resume. Approval means US texting is set up " +
    "and waiting for you, not that a paused plan starts sending.",
  usRegStartedPaused:
    "US registration started. We'll email you when the carriers approve it, " +
    "and US texting works when you resume.",
  usRegStartedRunning:
    "US registration started. We'll email you when it's approved.",

  /* Bringing a number in (PORTING.md §6) */
  startPortTrigger: "Bring a number",
  startPortNumberLabel: "Number to transfer",
  startPortCheck: "Check",
  startPortNumberInvalid: "Enter your 10-digit US or Canadian number.",
  startPortCheckFailed:
    "We couldn't check this number just now. Try again in a moment.",
  startPortFieldsMissing: "Fill in the account details and service address.",
  startPortSsn: "SSN",
  startPortSin: "SIN",
  startPortWirelessMissing:
    "This is a mobile number. Enter the transfer PIN and the last 4 of the " +
    "account holder's {idKind}.",
  startPortStarted: "Transfer started. Upload your documents to send it.",
  startPortFailed: "Couldn't start the transfer. Try again in a moment.",
  startPortCarrierAccount: "Your current carrier account",
  startPortAccountHolder: "Account holder",
  startPortTransferPin: "Transfer PIN",
  startPortLast4: "Last 4 of {idKind}",
  startPortWirelessNote:
    "Mobile numbers need these to release. We store only the last 4 of the " +
    "{idKind}.",
  startPortServiceAddress: "Service address on file",
  startPortAddressNote:
    "From your latest bill. A mismatch is the #1 reason a transfer gets held " +
    "up.",
  startPortBridgeAria:
    "Give me a temporary number while my number transfers",
  startPortBridge:
    "Give me a temporary number to text from while this one transfers. You " +
    "can release it later.",
  startPortAction: "Start transfer",

  /* Text-enabling a landline you already have */
  textEnableTrigger: "Text-enable a landline",
  textEnableDialogTitle: "Text-enable your existing landline",
  textEnableDialogBody:
    "Your number and your carrier stay exactly as they are; calls don't " +
    "change. Loonext adds texting to the number; the carrier review usually " +
    "takes a few business days, and texting goes live once it completes.",
  textEnableNumberLabel: "Number to text-enable",
  textEnableNumberHint:
    "A US or Canada local landline or VoIP number. You'll upload a signed " +
    "authorization and a recent bill for the carrier next.",
  textEnableNumberInvalid:
    "Enter your US or Canada business number, like +16135551234.",
  textEnableStartAction: "Start text-enablement",
  textEnableStarted:
    "Text-enablement started. Upload your signed authorization and a recent " +
    "bill next.",
  textEnableStartFailed:
    "Couldn't start text-enabling this number. Try again in a moment.",

  /* What the workspace is storing (#121/D34) */
  storageReceived: "Attachments received",
  storageSent: "Attachments sent",
  storageNotes: "Files on notes",
  storageVoicemail: "Voicemail recordings",
  storageOther: "Other files",
  storageEmpty:
    "Nothing stored yet. Attachments in and out, files on notes, and " +
    "voicemail recordings are all free on every plan, with no caps.",
  storageTotal: "{size} stored",
  storageFree: "Free on every plan, no caps",
  storageBarAria: "Storage: {parts}. Free on every plan, no caps.",
  storageBarPart: "{size} {kind}",

  /* The timezone picker (D15) */
  timezoneSearchPlaceholder: "Search timezones…",
  timezoneNoMatch: "No timezone matches that.",

  /* The seven-row week (#307) */
  hoursOpenAria: "{day} open time",
  hoursCloseAria: "{day} close time",
  hoursClosed: "Closed",

  /* Tags, and who may invent one (#298) */
  tagsTitle: "Tags",
  tagsDescription:
    "What the crew has been tagging, and how often. The quiet ones at the " +
    "bottom are usually duplicates of something above.",
  tagNeverUsed: "never used",
  tagUsesOne: "{count} thread",
  tagUsesMany: "{count} threads",
  tagLastUsed: " · last {when}",
  tagDescribeAria: "Describe {name}",
  tagEditDescriptionAria: "Edit the description for {name}",
  tagMerge: "Merge",
  tagMerging: "Merging…",
  tagDescriptionPlaceholder: "What does this one mean?",
  tagMergeTitle: "Merge “{name}” into another tag",
  tagMergeBody:
    "Every conversation tagged “{name}” keeps its place under the tag you " +
    "pick, and this one goes away. Nothing is untagged.",
  tagMergeKeepWhich: "Keep which tag?",
  tagMergeOutcomeOne:
    "{count} thread moves to “{into}”. “{name}” stops existing.",
  tagMergeOutcomeMany:
    "{count} threads move to “{into}”. “{name}” stops existing.",
  tagMergeFailed: "Could not merge those. Try again in a moment.",
  tagLockTitle: "Who can create tags",
  tagLockDescription:
    "Anyone on the crew can add a tag by default. Lock it once your list is " +
    "the list.",
  tagLockLabel: "Only owners and admins can create tags",
  tagLockHint:
    "Everyone can still use every tag you already have. This only stops new " +
    "ones being invented mid-job.",
  tagLockedNote:
    "A tech who needs a category you do not have will leave the thread " +
    "untagged rather than ask. Check the list below now and then.",

  /* One hosted-SMS order, and the section that lists them */
  hostedSectionTitle: "Text-enabled numbers",
  hostedSectionDescription:
    "Adding texting to numbers that keep their current carrier.",
  hostedStartDescription:
    "Keep the number and the carrier you have; Loonext adds texting to it. " +
    "Calls don't change; the carrier review takes a few business days, and " +
    "texting goes live once it completes.",
  hostedStatePending:
    "Waiting on carrier review, typically a few business days. Calls keep " +
    "working with your current carrier the whole time.",
  hostedStateActionRequired:
    "The carrier needs your signed authorization (LOA) and a recent bill " +
    "before it can continue.",
  hostedStateInProgress:
    "Your documents are with the carrier for review. Nothing to do; texting " +
    "turns on here the moment it completes.",
  hostedStateCompleted:
    "Texting is live on this number. Calls are unchanged; they stay with your " +
    "current carrier.",
  hostedStateCancelled:
    "Text-enablement cancelled. Your number is untouched with your current " +
    "carrier.",
  hostedStateFailedFallback:
    "The carrier couldn't complete this. Check your documents and resubmit.",
  hostedLoaHint:
    "A signed letter authorizing texting on this number. PDF only, under " +
    "5 MB, signed within the last 90 days, listing this number.",
  hostedBillHint:
    "A recent bill from your current carrier, less than 30 days old, showing " +
    "this number. PDF only, under 5 MB.",
  hostedDocSizeError:
    "Each file must be a non-empty PDF under 5 MB (the carrier's limit for " +
    "these documents).",
  hostedDocTypeError:
    "The carrier accepts only PDF files for these documents.",
  hostedVerified: "Number ownership verified. Nothing else to do for this step.",
  hostedVerifyTitle: "Verify you own this number",
  hostedVerifyBody:
    "If the carrier asks for proof, get a one-time code at {number} (by text, " +
    "or an automated call if it can't receive texts) and enter it below.",
  hostedTextACode: "Text a code",
  hostedCallWithCode: "Call with a code",
  hostedVerifying: "Verifying…",
  hostedCodeTexted: "Code texted to {number}.",
  hostedCodeCalling: "Calling {number} with your code.",
  hostedCodeSendFailed: "Couldn't send a code. Try again in a moment.",
  hostedNumberVerified: "Number verified.",
  hostedCodeCheckFailed: "Couldn't check that code. Try again in a moment.",
  hostedRemoveTitle: "Remove texting from {number}?",
  hostedRemoveBody:
    "This releases the number from Loonext: texting stops and its plan slot " +
    "frees up. Calls aren't affected; the number itself stays with your " +
    "current carrier. Text-enabling it again later means a fresh carrier " +
    "review. Type the number to confirm.",
  hostedKeepTexting: "Keep texting",
  hostedRemoveTexting: "Remove texting",
  hostedTextingRemoved: "Texting removed from {number}.",
  hostedCancelAction: "Cancel text-enablement…",
  hostedCancelTitle: "Stop adding texting to {number}?",
  hostedCancelBody:
    "Your number is untouched; calls and service stay with your current " +
    "carrier. You can start again any time.",
  hostedKeepGoing: "Keep going",
  hostedCancelConfirm: "Cancel text-enablement",
  hostedCancelled: "Text-enablement cancelled.",
  hostedCancelFailed: "Couldn't cancel this. Try again.",
  hostedCancelledPill: "Text-enablement cancelled",
  hostedStartedOn: "Started {date}.",
  hostedLive: "Texting live, calls unchanged",
  hostedAdding: "Adding texting",
  hostedOwnerUploads: "An owner or admin uploads the authorization and bill.",
  hostedResubmit: "Resubmit",
  hostedResubmitted: "Resubmitted. We'll run it past the carrier again.",
  hostedAskOwnerToFix:
    "Ask an owner or admin to fix the documents and resubmit.",

  /* Two-factor authentication (#314, #473) */
  tfaTitle: "Two-factor authentication",
  tfaDescription:
    "A code from your phone, on top of your password. It is what stops a " +
    "stolen password becoming somebody texting your customers as you.",
  tfaAuthenticatorFactorName: "Authenticator app · {date}",
  tfaPasskeyFactorName: "Passkey · {date}",
  tfaStartFailed: "Couldn't start setup. Try again.",
  tfaUnexpectedStep: "Unexpected passkey step. Start again.",
  tfaPasskeyFailed:
    "Couldn't add a passkey. Try again, or use an authenticator app.",
  tfaCodeMismatch: "That code didn't match. Check your app and try the next one.",
  tfaTurnedOff: "Two-factor authentication is off.",
  tfaTurnOffFailed: "Couldn't turn it off. Try again.",
  tfaIssueCodesFailed: "Couldn't issue new codes.",
  tfaBothOn: "Passkey and authenticator app are on",
  tfaPasskeyOn: "Passkey is on",
  tfaAuthenticatorOn: "Authenticator app is on",
  tfaOn: "Two-factor authentication is on.",
  tfaCodesLeftOne: "{count} recovery code left.",
  tfaCodesLeftMany: "{count} recovery codes left.",
  tfaNoCodesLeft: "No recovery codes left — issue a new set now.",
  tfaNewCodes: "New recovery codes",
  tfaPasskeyPitch:
    "Use your face, fingerprint or screen lock as the second step. Nothing to " +
    "type and nothing to lose — it stays on this device. We'll give you " +
    "backup codes for the day the device doesn't.",
  tfaUsePasskey: "Use a passkey",
  tfaUseAuthenticator: "Use an authenticator app",
  tfaAuthenticatorPitch:
    "You'll scan a QR code with an authenticator app — Google Authenticator, " +
    "1Password, whatever you already use — and enter a six-digit code to " +
    "prove it worked. We'll give you backup codes for the day you lose the " +
    "phone.",
  tfaSetUp: "Set up two-factor",
  tfaScanTitle: "Scan this with your authenticator app",
  tfaScanBody: "Then type the six-digit code it shows.",
  tfaQrAlt: "QR code for your authenticator app",
  tfaManualKey: "Can't scan? Enter this key instead",
  tfaSixDigitCode: "Six-digit code",
  tfaTurnItOn: "Turn it on",
  tfaCodesTitle: "Save your recovery codes",
  tfaCodesBody:
    "This is the only time you will see these. If you lose your phone, one of " +
    "these codes is how you get back in — without them, getting back into " +
    "your business line takes us weeks.",
  tfaCopy: "Copy",
  tfaCopied: "Copied.",
  tfaDownload: "Download",
  tfaFileHeading: "Loonext recovery codes",
  tfaFileFooter:
    "Each code works once. Keep them somewhere you can reach without your " +
    "phone.",
  tfaSavedThem: "I've saved them",
  tfaTurnOffTitle: "Turn off two-factor authentication?",
  tfaTurnOffBody:
    "Your account goes back to a password alone. If this workspace requires " +
    "two-factor, you will be asked to set it up again the next time you open " +
    "the app.",
  tfaKeepItOn: "Keep it on",
  tfaTurnItOff: "Turn it off",

  /* Your own voice (#309) */
  greetingTitle: "Your own voice",
  greetingDescription:
    "Record the greeting yourself instead of having it read aloud. Callers " +
    "hear a person, which is the thing you are actually selling.",
  greetingDefaultName: "After hours",
  greetingNoneYet:
    "Nothing recorded yet — callers hear the written greeting, read aloud.",
  greetingPickOne:
    "Pick one on a number under Settings → Numbers to use it. Anything you " +
    "have not chosen stays unused.",
  greetingDeleteAria: "Delete {name}",
  greetingMicDenied:
    "Your browser did not give us the microphone. Allow it in the address " +
    "bar, then try again.",
  greetingTooLong:
    "That is longer than two minutes. A caller waiting for the beep will hang " +
    "up first.",
  greetingSaved: "Saved. Choose it on a number to use it.",
  greetingNamedSaved: "“{name}” saved. Choose it on a number to use it.",
  greetingDeleted: "Deleted.",
  greetingDeleteFailed: "That could not be deleted.",
  greetingCallFailed: "We could not start that call.",
  greetingHearItBack: "Hear it back",
  greetingTakeLength: "{length} · this is exactly what a caller gets.",
  greetingNameIt: "Name it",
  greetingRecordAgain: "Record again",
  greetingSaveAction: "Save greeting",
  greetingRecordingNow: "Recording… speak now.",
  greetingStop: "Stop",
  greetingUpToTwoMinutes: "Up to two minutes.",
  greetingRecord: "Record",
  greetingCallMeInstead: "Have us call you instead",
  greetingRatherPhone: "Rather do it on the phone?",
  greetingCallingNow: "Calling {number} now",
  greetingAnswerAndListen: "Answer, and you'll hear what to do.",
  greetingStepBeep: "Wait for the beep.",
  greetingStepSpeak: "Say what you want your callers to hear.",
  greetingStepHangUp: "Hang up. It saves itself.",
  greetingWillAppear:
    "It'll appear below as “{name}” when it lands. You can close this.",
  greetingPhoneTitle: "Record it on the phone",
  greetingPhoneBody:
    "We'll ring you, you speak after the beep, and you hang up. No microphone " +
    "permission, nothing to hold.",
  greetingYourNumber: "Your number",
  greetingCalling: "Calling…",
  greetingCallMe: "Call me",
  greetingDeleteTitle: "Delete “{name}”?",
  greetingDeleteBody:
    "Any number using it goes back to the written words, read aloud. Callers " +
    "hear the change on the next call.",
  greetingKeepIt: "Keep it",

  /* When the plan's own state could not be read (#277) */
  planStateUnknown:
    "We couldn't check this plan's status just now, so nothing here is " +
    "claimed either way. Your plan and your number are untouched.",
} as const;

export const settingsMoreFr: Translated<typeof settingsMoreEn> = {
  saveFailed: "Impossible d'enregistrer. Réessayez.",
  teammate: "Coéquipier",

  numberAccessTitle: "Qui peut utiliser {number} ?",
  numberAccessDescription:
    "Les propriétaires et les administrateurs peuvent toujours utiliser tous " +
    "les numéros. Limiter un numéro cache ses conversations à toutes les " +
    "personnes que vous n'incluez pas.",
  numberAccessGroupAria: "Qui peut utiliser ce numéro",
  numberAccessEveryone: "Tout le monde",
  numberAccessEveryoneHint:
    "Toute l'équipe peut texter, comme aujourd'hui.",
  numberAccessMembersView: "Membres : consultation et notes seulement",
  numberAccessMembersViewHint:
    "Les membres peuvent lire et ajouter des notes, mais pas texter. Les " +
    "administrateurs peuvent toujours texter.",
  numberAccessAdmins: "Administrateurs seulement",
  numberAccessAdminsHint: "Les membres ne voient pas ce numéro du tout.",
  numberAccessUsers: "Personnes précises",
  numberAccessUsersHint:
    "Seulement les personnes que vous choisissez. Les administrateurs peuvent " +
    "toujours texter.",
  numberAccessNoTeammates:
    "Aucun coéquipier pour l'instant — invitez-les depuis Paramètres › Équipe.",
  numberAccessLevelAria: "Ce que les personnes choisies peuvent faire",
  numberAccessCanText: "Peut texter",
  numberAccessNoteOnly: "Consultation et notes seulement",
  numberAccessPickSomeone:
    "Choisissez au moins une personne, ou sélectionnez Tout le monde.",
  numberAccessSaved: "Accès au numéro enregistré.",

  numberStatusActive: "Actif",
  numberStatusSettingUp: "Configuration en cours",
  numberStatusActionNeeded: "Action requise",
  numberStatusSetupFailed: "Configuration impossible",
  numberStatusSuspended: "Suspendu",
  numberStatusReleased: "Libéré",
  numberAreaCode: "Indicatif régional {code}",
  numberCopyAria: "Copier le numéro",
  numberCopied: "Numéro copié.",
  numberCopyFailed: "Impossible de copier le numéro.",
  numberSetupSlow:
    "Nous configurons encore votre numéro. Cela prend un peu plus de temps " +
    "que d'habitude.",
  numberSetupStalled:
    "La configuration prend plus de temps que prévu. Choisissez un numéro " +
    "pour terminer — vous ne serez pas facturé de nouveau.",
  numberAreaCodeEmpty:
    "L'indicatif régional {code} n'a plus de nouveaux numéros pour l'instant. " +
    "Choisissez un autre numéro pour terminer la configuration.",
  numberSetupFailed:
    "Nous n'avons pas pu terminer la configuration de votre numéro. " +
    "Choisissez un numéro pour réessayer.",
  numberReleasedOn: "Libéré le {date}.",
  numberChooseAction: "Choisir un numéro",
  numberWhoCanUseAction: "Qui peut utiliser ce numéro…",
  numberHowItAnswersAction: "Comment cette ligne répond…",
  numberWhenOpenAction: "Quand cette ligne est ouverte…",
  numberReleaseAction: "Libérer ce numéro…",

  numberHealthTitle:
    "Les messages envoyés de ce numéro n'arrivent pas de façon fiable",
  numberHealthBody:
    "Les fournisseurs se mettent parfois à filtrer un numéro — souvent un " +
    "numéro réutilisé d'une entreprise précédente. Nous avons été avertis et " +
    "nous nous en occupons ; vous n'avez rien à faire pour le moment.",
  numberHealthRateUnknown:
    "Moins de vos textos se rendent à destination qu'à l'habitude.",
  numberHealthRate:
    "Environ {percent} % de vos textos récents ont été livrés, ce qui est " +
    "sous la normale pour ce numéro.",
  numberHealthSince: "Depuis le {date}",

  numberHoldOverAllowanceUnknown:
    "En attente — votre forfait couvre moins de numéros que vous en avez. Les " +
    "textos et les appels entrent toujours et rien n'a été perdu ; vous ne " +
    "pouvez simplement pas envoyer ni répondre à partir de ce numéro.",
  numberHoldOverAllowanceOne:
    "En attente — votre forfait couvre {count} numéro et vous en avez " +
    "davantage. Les textos et les appels entrent toujours et rien n'a été " +
    "perdu ; vous ne pouvez simplement pas envoyer ni répondre à partir de ce " +
    "numéro.",
  numberHoldOverAllowanceMany:
    "En attente — votre forfait couvre {count} numéros et vous en avez " +
    "davantage. Les textos et les appels entrent toujours et rien n'a été " +
    "perdu ; vous ne pouvez simplement pas envoyer ni répondre à partir de ce " +
    "numéro.",
  numberHoldBringBackLink: "Voyez comment le rétablir",
  numberHoldPaused: "L'envoi de textos est en pause.",
  numberHoldUpdatePaymentLink: "Mettez à jour votre mode de paiement",
  numberHoldTurnBackOn: "pour le réactiver.",
  numberHoldPausedHere: "L'envoi de textos est en pause sur ce numéro.",
  numberHoldCheckBillingLink: "Consultez la facturation",
  numberHoldToSeeWhy: "pour savoir pourquoi.",

  loading: "Chargement…",
  sameAsWorkspace: "Comme votre espace de travail",
  useWorkspaces: "Revenir à l'espace de travail",
  backToWorkspace: "Retour aux réglages de votre espace de travail.",
  numberNotLoaded: "Ce numéro n'a pas pu être chargé.",
  saveFailedGeneric: "L'enregistrement a échoué.",
  changeFailedGeneric: "La modification a échoué.",

  numberHoursTitle: "Quand cette ligne est ouverte",
  numberHoursDescription:
    "La réponse en dehors des heures d'ouverture de ce numéro suit cet " +
    "horaire. Laissez-le tel quel et il suit votre espace de travail.",
  timezoneLabel: "Fuseau horaire",
  numberOpenHoursLabel: "Heures d'ouverture",
  numberHoursSaved:
    "Enregistré. Cette ligne conserve ces heures à partir de maintenant.",

  numberIdentityTitle: "Comment cette ligne répond",
  numberIdentityDescription:
    "Tout ce que vous laissez tel quel suit votre espace de travail. Un " +
    "changement fait ici ne touche que ce numéro.",
  numberIdentitySaved:
    "Enregistré. Les nouveaux appelants l'entendront immédiatement.",
  numberIdentityMctbLabel: "Texter un appelant manqué",
  numberIdentityMctbHint:
    "Envoyé de cette ligne lorsqu'un appel reste sans réponse.",
  numberIdentityVoiceLabel: "Voix de la boîte vocale",
  numberIdentityWrittenGreeting: "Le message écrit, lu à voix haute",
  numberIdentityVoiceHint:
    "Un enregistrement qui ne joue pas revient aux mots ci-dessous, pour " +
    "qu'un appelant n'entende jamais le silence.",
  numberIdentityAfterHoursLabel: "Appels en dehors des heures d'ouverture",
  numberIdentityRingEveryone: "Faire sonner tout le monde, jour et nuit",
  numberIdentityOnCallOnly: "Faire sonner seulement la personne de garde",
  numberIdentityTakeMessage: "Prendre un message",
  numberIdentityAfterHoursHint:
    "En dehors des heures de cette ligne. Sans personne de garde, les deux " +
    "derniers choix diffèrent encore — l'un fait sonner l'équipe quand même, " +
    "l'autre prend un message.",
  numberIdentityRingLabel: "Comment les téléphones sonnent",
  numberIdentityRingAll: "Tous en même temps",
  numberIdentityRingInTurn: "Un à la fois",
  numberIdentityRingSecondsLabel: "Combien de temps ils sonnent",
  numberRingLength: "{seconds} secondes · environ {rings} sonneries",
  numberIdentityLeadSourceLabel: "Où cette ligne est annoncée",
  numberIdentityUntracked: "Annoncée nulle part",
  numberIdentityLeadSourceHint:
    "Chaque nouvelle conversation sur cette ligne est comptée ici, sans que " +
    "personne ait à toucher à quoi que ce soit. La modifier plus tard ne " +
    "réétiquette pas les clients que vous avez déjà.",
  numberIdentityNameLabel: "Nom de cette ligne",
  numberIdentityNameHint:
    "Utilisé dans le message d'accueil, dans les textos d'appel manqué et " +
    "partout où cette ligne se présente.",
  numberIdentityVoicemailLabel: "Message d'accueil de la boîte vocale",
  numberIdentityVoicemailHint:
    "Ce qu'un appelant entend quand personne ne répond.",
  numberIdentityAwayLabel: "Réponse en dehors des heures d'ouverture",
  numberIdentityAwayHint:
    "Le texto envoyé quand quelqu'un écrit à cette ligne en dehors de vos " +
    "heures d'ouverture.",
  numberIdentityMctbTextLabel: "Texto d'appel manqué",
  numberIdentityMctbTextHint:
    "Ce qu'un appelant reçoit quand personne ne répond et qu'il raccroche.",

  offRampTitle: "Dites à vos clients où vous êtes rendus",
  offRampLead:
    "Toute personne qui texte votre ancien numéro reçoit ceci en retour, une " +
    "seule fois.",
  offRampHoldEndedOn: "La retenue a pris fin le",
  offRampStopsOn: "Cela s'arrête le",
  offRampAfterEnded:
    ". Nous ne retenons plus le numéro pour vous. Une fois qu'il est retourné " +
    "à la compagnie de téléphone, nous ne pouvons plus y répondre, et les " +
    "textos qui y sont envoyés se rendent à la personne qui l'obtient ensuite.",
  offRampAfterUpcoming:
    ", quand le numéro retourne à la compagnie de téléphone. Après cela, nous " +
    "ne pouvons plus y répondre, et les textos qui y sont envoyés se rendent " +
    "à la personne qui l'obtient ensuite.",
  offRampNoDate:
    "Cela s'arrête quand le numéro retourne à la compagnie de téléphone. " +
    "Après cela, nous ne pouvons plus y répondre, et les textos qui y sont " +
    "envoyés se rendent à la personne qui l'obtient ensuite.",
  offRampPlaceholder:
    "Nous avons déménagé au (416) 555-0123 — appelez-nous ou textez-nous là " +
    "et nous répondrons tout de suite.",
  offRampAria: "Message envoyé aux clients qui textent votre ancien numéro",
  offRampNothingSent: "Rien n'est envoyé tant que vous n'écrivez rien ici.",
  offRampCharacterCount:
    "{count} caractères sur {max}. Vos mots, envoyés tels quels.",
  offRampTurnOff: "Désactiver",
  offRampStartSending: "Commencer à l'envoyer",

  someone: "Quelqu'un",
  remove: "Retirer",
  onCallPersonOnCall: "{name} est de garde",
  onCallSetFailed: "Impossible d'établir ce quart",
  onCallEndShift: "Terminer le quart",
  onCallPutSomebody: "Mettre quelqu'un de garde",

  pauseOfferHeading:
    "Faites plutôt une pause — gardez le numéro pour {amount} par mois",
  pauseOfferBody:
    "{amount} par mois au lieu des frais de votre forfait. Votre numéro et " +
    "tout votre historique de messages restent exactement où ils sont, et les " +
    "textos que vos clients envoient arrivent toujours — vous ne pouvez pas " +
    "envoyer ni prendre d'appels avant votre retour, et tout ce que vous aviez " +
    "planifié attend plutôt que d'échouer. Rien n'expire pendant la pause, " +
    "alors il n'y a aucune échéance sur le numéro et rien à reconfigurer. " +
    "Revenez au même forfait quand le travail revient.",
  pauseOfferAction: "Mettre en pause pour {amount} par mois",
  pauseConfirmation:
    "Votre forfait est en pause. Votre numéro et votre historique sont " +
    "conservés.",
  resumeConfirmation: "Vous êtes de retour. L'envoi de textos est réactivé.",
  didNotGoThrough: "Cela n'a pas fonctionné. Réessayez dans un moment.",
  pausing: "Mise en pause…",
  pausedTitle: "Votre forfait est en pause",
  pausedTextingOff:
    "L'envoi de textos est désactivé. Vous ne pouvez pas envoyer de messages " +
    "ni prendre d'appels pendant que votre forfait est en pause.",
  pausedNothingLost:
    "Les textos que vos clients envoient arrivent toujours, alors rien n'est " +
    "perdu — et tout ce que vous aviez planifié attend plutôt que d'échouer. " +
    "Votre numéro et tout votre historique de messages sont exactement où " +
    "vous les avez laissés.",
  pausedPayingLead: "Vous payez",
  pausedPayingAmount: "{amount} par mois",
  pausedPayingTail: "pour les conserver.",
  pausedPayingSince: "pour les conserver, depuis le {date}.",
  resuming: "Reprise…",
  resume: "Reprendre",
  pausedResumeNote:
    "{plan} reprend à son prix habituel, avec tout exactement où c'est.",

  modulesTitle: "Modules complémentaires",
  modulesDescription:
    "Activez ou désactivez des fonctions supplémentaires. Les changements sont " +
    "calculés au prorata à partir d'aujourd'hui, alors vous ne payez jamais " +
    "pour du temps où vous ne les aviez pas.",
  modulesLoading: "Chargement des modules complémentaires",
  modulesLoadFailed:
    "Nous n'avons pas pu charger vos modules complémentaires.",
  moduleAdded:
    "{name} ajouté. Les frais calculés au prorata figurent sur la facture " +
    "d'aujourd'hui.",
  moduleRemoved:
    "{name} désactivé. Si c'était sur votre facture, le temps non utilisé est " +
    "crédité sur votre prochaine facture.",
  moduleUpdateFailed:
    "Nous n'avons pas pu mettre à jour ce module complémentaire. Réessayez.",
  moduleCardAria: "Module complémentaire {name}",
  modulePricePerMonth: "{price}/mois",

  ownershipTitle: "Propriété",
  ownershipDescription:
    "Le propriétaire contrôle la facturation, le plafond de dépenses et vos " +
    "numéros. Lui seul peut céder ce rôle.",
  ownershipTeammateFallback: "un coéquipier",
  ownershipTeammateOption: "Un coéquipier",
  ownershipActionFailed: "Cela n'a pas fonctionné. Réessayez.",
  ownershipOffered: "La propriété a été offerte à {name}.",
  ownershipAskedToTakeOver:
    "{name} a demandé à reprendre cet espace de travail.",
  ownershipOfferExpires:
    "Rien ne change tant que la personne n'a pas accepté. L'offre expire le " +
    "{when}.",
  ownershipWaitOver:
    "La période d'attente est terminée. La personne peut compléter la reprise " +
    "à tout moment.",
  ownershipCompletesAt:
    "Cela se conclut le {when} à moins que le propriétaire l'arrête. " +
    "L'arrêter prend effet immédiatement.",
  ownershipNowYours: "Vous êtes maintenant propriétaire de cet espace de travail.",
  ownershipAccept: "Accepter la propriété",
  ownershipCompleteTakeover: "Compléter la reprise",
  ownershipStopped: "Arrêté. Rien n'a changé de mains.",
  ownershipStopThis: "Arrêter",
  ownershipDecline: "Refuser",
  ownershipOwnerLabel: "Propriétaire",
  ownershipYou: "Vous",
  ownershipBackupOwner: "Propriétaire de relève",
  ownershipNobodyNamed: "Personne de désigné",
  ownershipBackupBody:
    "Si un jour vous ne pouvez plus entrer — vous perdez votre courriel, ou " +
    "pire — c'est la seule personne qui peut demander à reprendre l'espace de " +
    "travail. Elle attend une semaine, vous pouvez l'arrêter d'un seul clic, " +
    "et tout le monde est prévenu. Rien ne change aujourd'hui.",
  ownershipBackupCleared: "Propriétaire de relève retiré.",
  ownershipBackupSet: "{name} est votre propriétaire de relève.",
  ownershipChooseTeammate: "Choisissez un coéquipier",
  ownershipNobody: "Personne",
  ownershipInviteFirst:
    "Invitez d'abord quelqu'un — la relève doit faire partie de l'équipe.",
  ownershipHandOverTitle: "Céder l'espace de travail",
  ownershipHandOverBody:
    "La personne doit accepter. Vous restez dans l'équipe comme " +
    "administrateur.",
  ownershipHandItOver: "Céder l'espace",
  ownershipYouAreBackup: "Vous êtes le propriétaire de relève",
  ownershipClaimBody:
    "Si le propriétaire ne peut pas agir, vous pouvez demander à reprendre " +
    "l'espace de travail. Il a une semaine pour l'arrêter, et toute l'équipe " +
    "est prévenue immédiatement.",
  ownershipAskToTakeOver: "Demander à reprendre",
  ownershipOfferDialogTitle: "Céder cet espace de travail à {name} ?",
  ownershipClaimDialogTitle: "Demander à reprendre cet espace de travail ?",
  ownershipOfferDialogBody:
    "Rien ne change tant que la personne n'a pas accepté. Quand elle le fera, " +
    "elle contrôlera la facturation, le plafond de dépenses et vos numéros — " +
    "et vous resterez dans l'équipe comme administrateur. Vous pouvez annuler " +
    "à tout moment avant qu'elle accepte, et tout le monde sera prévenu dans " +
    "les deux cas.",
  ownershipClaimDialogBody:
    "Le propriétaire recevra un courriel immédiatement et pourra arrêter cela " +
    "d'un seul clic pendant les 7 prochains jours. Toute l'équipe est " +
    "prévenue elle aussi. Si personne ne l'arrête, vous pourrez compléter la " +
    "reprise après 7 jours. Ne faites cela que si le propriétaire est " +
    "vraiment incapable d'agir.",
  ownershipOfferIt: "Céder",
  ownershipOfferSent: "Offert à {name}. La personne a 7 jours pour accepter.",
  ownershipClaimSent: "Demande envoyée. Le propriétaire a 7 jours pour l'arrêter.",

  portSwitchDateUnknown: "votre date de basculement",
  portStepDone: ", terminé",
  portStepInProgress: ", en cours",
  portStepUpcoming: ", à venir",
  portCancelAction: "Annuler ce transfert…",
  portCancelTitle: "Annuler le transfert du {number} ?",
  portCancelDescription:
    "Votre numéro reste chez votre fournisseur actuel et rien ne change. Vous " +
    "pouvez recommencer le transfert plus tard.",
  portKeepTransferring: "Poursuivre le transfert",
  portCancelConfirm: "Annuler le transfert",
  portCancelling: "Annulation…",
  portCancelled: "Transfert annulé.",
  portCancelFailed: "Impossible d'annuler le transfert. Réessayez.",
  portCancelledPill: "Transfert annulé",
  portCancelledBody:
    "Ce numéro est resté chez votre fournisseur précédent. Vous pouvez lancer " +
    "un nouveau transfert à tout moment.",
  portSubmitted:
    "Transfert envoyé à votre fournisseur. Nous vous tiendrons au courant.",
  portSubmitFailed:
    "Impossible d'envoyer le transfert. Réessayez dans un moment.",
  portOnHold: "En attente",
  portLive: "En service sur Loonext",
  portTransferring: "Transfert vers Loonext en cours",
  portSending: "Envoi…",
  portSubmitAction: "Envoyer le transfert",
  portUploadThenSubmit:
    "Téléversez votre autorisation signée et une facture récente ci-dessus, " +
    "puis envoyez le transfert.",
  portOwnerSubmits:
    "Un propriétaire ou un administrateur téléverse les documents et envoie " +
    "le transfert.",
  portAskOwnerToFix:
    "Demandez à un propriétaire ou à un administrateur de corriger les " +
    "renseignements signalés et de renvoyer la demande.",

  portDocOnFile: "Au dossier",
  portDocNoFile: "Aucun fichier choisi",
  portDocReplace: "Remplacer",
  portDocChoose: "Choisir",
  portDocReplaceAria: "Remplacer le fichier : {label}",
  portDocChooseAria: "Choisir un fichier : {label}",
  portDocSizeError:
    "Chaque fichier doit être un document non vide de moins de 10 Mo.",
  portDocNothingChosen:
    "Choisissez votre autorisation signée ou une facture récente à téléverser.",
  portDocUploaded: "Documents téléversés.",
  portDocUploadFailed:
    "Impossible de téléverser vos documents. Réessayez dans un moment.",
  portDocLoaLabel: "Autorisation signée (LOA)",
  portDocCaTemplate: "Télécharger le modèle d'autorisation canadien",
  portDocInvoiceLabel: "Facture récente",
  portDocUploading: "Téléversement…",
  portDocUploadAction: "Téléverser les documents",

  portFixEntityName: "Nom du titulaire du compte",
  portFixAuthPerson: "Personne autorisée",
  portFixAccountNumber: "Numéro de compte",
  portFixServiceStreet: "Adresse du service",
  portFixCity: "Ville",
  portFixState: "État",
  portFixProvince: "Province",
  portFixZip: "Code ZIP",
  portFixPostalCode: "Code postal",
  portFixRequired:
    "Tous les champs sauf le numéro de compte doivent être remplis.",
  portFixResubmitted:
    "Demande renvoyée. Nous vous écrirons au fur et à mesure.",
  portFixResubmitFailed:
    "Impossible de renvoyer le transfert. Réessayez dans un moment.",
  portFixAccountOnFile: "Au dossier, laissez vide pour le conserver",
  portFixDocuments: "Documents",
  portFixResubmitting: "Renvoi…",
  portFixResubmitAction: "Corriger et renvoyer",
  portFixUploadFirst:
    "Téléversez votre autorisation signée et une facture récente ci-dessus " +
    "avant de renvoyer la demande.",

  portSectionTitle: "Transferts de numéro",
  portSectionDescription:
    "Le transfert de votre numéro actuel vers Loonext.",
  portBringNumberTitle: "Amenez votre numéro actuel",
  portBringNumberDescription:
    "Transférez vers Loonext le numéro que vos clients connaissent déjà. " +
    "C'est gratuit, et il continue de fonctionner jusqu'à la fin du " +
    "basculement.",

  portStepSubmittedLabel: "Transfert demandé",
  portStepSubmittedMeaning:
    "Nous avons envoyé la demande de transfert à votre fournisseur actuel.",
  portStepDateConfirmedLabel: "Date de basculement confirmée",
  portStepDateConfirmedMeaning:
    "Votre fournisseur a confirmé la date à laquelle votre numéro passe à Loonext.",
  portStepNumberSwitchedLabel: "Numéro basculé",
  portStepNumberSwitchedMeaning:
    "Votre numéro est passé à Loonext. Activation des textos en cours.",
  portStepTextingLiveLabel: "Textos en service",
  portStepTextingLiveMeaning:
    "Écrivez à vos clients directement depuis Loonext.",

  portabilityOk:
    "Bonne nouvelle : le {number} peut être transféré vers Loonext. Il continuera de fonctionner chez votre fournisseur actuel jusqu'à la date de basculement.",
  portabilityFailReasonUnknown:
    "le fournisseur indique qu'il ne peut pas être transféré pour l'instant",
  portabilityFail:
    "Nous ne pouvons pas transférer ce numéro : {reason}. Vous pouvez commencer avec un nouveau numéro local.",

  portHonestWindow:
    "Votre numéro continue de fonctionner chez votre fournisseur actuel jusqu'à la fin du basculement, généralement de 1 à 7 jours ouvrables. Nous vous écrirons dès qu'il sera prêt.",
  portTimelineKeepsWorking:
    "Votre numéro continue de fonctionner chez votre fournisseur actuel pendant tout ce temps.",
  portTimelineSwitchDate:
    "Il passe à Loonext à la date du transfert, généralement de quelques jours ouvrables à environ deux semaines (États-Unis), souvent plus vite au Canada.",
  portTimelineTextingStarts:
    "Les textos par Loonext commencent une fois le basculement terminé. Nous vous montrerons exactement où en est la demande et nous vous écrirons à chaque étape.",

  portStateSubmitted:
    "Transfert en cours. Nous avons envoyé la demande à votre fournisseur actuel. Il répond habituellement en deux jours ouvrables. Votre numéro fonctionne encore chez votre ancien fournisseur pour l'instant.",
  portStateFocConfirmed:
    "C'est confirmé. Votre numéro passe à Loonext le {date}. Rien ne change d'ici là. Nous vous écrirons au moment du basculement.",
  portStateNumberSwitched:
    "Votre numéro est passé à Loonext. Nous activons les textos, généralement en une dizaine de minutes, parfois en un ou deux jours ouvrables. Nous vous écrirons dès que ce sera prêt.",
  portStateTextingLive:
    "Votre numéro est en service sur Loonext. Écrivez à vos clients directement d'ici.",
  portStateVoiceExceptionReasonUnknown:
    "il n'a pas précisé quoi, alors vérifiez vos renseignements ci-dessous",
  portStateVoiceException:
    "Votre fournisseur a signalé un problème sur le transfert : {reason}. Corrigez-le et renvoyez la demande. Cela prend habituellement quelques minutes, et il n'y a aucuns frais pour réessayer.",
  portStateMessagingException:
    "Votre numéro a été transféré, mais les textos prennent un peu plus de temps. Votre ancien fournisseur n'a pas encore libéré l'acheminement des textos. Nous faisons le suivi auprès du fournisseur pour vous ; cela se règle habituellement en un ou deux jours ouvrables et vous n'avez rien à faire.",
  portStateAssignmentBlocked:
    "Une dernière étape : demandez à votre ancien fournisseur de textos de retirer le {number} de sa campagne, puis nous terminerons le raccordement. Nous réessaierons automatiquement dès que ce sera fait.",
  portStateDocumentsPending:
    "Presque terminé. Téléversez votre autorisation signée (LOA) et une facture récente, puis envoyez le transfert à votre fournisseur.",
  portStateBridgeAvailable:
    "Votre numéro temporaire {bridge} est prêt : vous pouvez écrire à vos clients dès aujourd'hui. Une fois le transfert de votre vrai numéro terminé, vous pourrez libérer le numéro temporaire.",

  portHintLoa:
    "Une lettre signée autorisant le transfert. Signez-la dans les 90 derniers jours et assurez-vous qu'elle indique ce numéro et l'adresse de votre service.",
  portHintLoaCa:
    "Les fournisseurs canadiens utilisent une lettre normalisée. Téléchargez le modèle, signez-le et téléversez-le ici.",
  portHintInvoice:
    "Une facture récente de votre fournisseur actuel, datant de moins de 30 jours, indiquant ce numéro et l'adresse de votre service.",

  prepaidYearOpenTitle: "Votre année",
  prepaidYearOpenLead:
    "Vous avez payé une année sur ce forfait. Vos frais mensuels sont " +
    "couverts jusqu'au",
  prepaidYearOpenTail:
    ". Les textos au-delà de votre allocation incluse sont toujours facturés " +
    "chaque mois.",
  prepaidYearTitle: "Payer une année",
  prepaidYearPriceLead: "{price} pour {months} mois",
  prepaidYearComparison:
    "au lieu de {twelve} — c'est {saving} d'économie, soit environ " +
    "{perDay} ¢ par jour.",
  prepaidYearOneCharge:
    "Un seul paiement aujourd'hui. Vos frais de forfait sont couverts pour " +
    "{months} mois ; les textos au-delà de votre allocation incluse sont " +
    "toujours facturés chaque mois, comme maintenant. Rien d'autre ne change " +
    "dans votre compte.",
  prepaidYearOpeningCheckout: "Ouverture du paiement...",
  prepaidYearPayAction: "Payer {price}",

  provisionAddNumber: "Ajouter un numéro",
  provisionDescription:
    "Choisissez le numéro que vos clients verront. Il est prêt en une minute " +
    "environ.",
  provisionSettingUp: "Configuration…",
  provisionAddAction: "Ajouter le numéro",
  provisionStarted: "Numéro en route, généralement en moins d'une minute.",
  provisionFailed:
    "Impossible de lancer la configuration du numéro. Réessayez.",

  saveThatFailed: "Impossible d'enregistrer cela.",
  saveThatFailedRetry: "Impossible d'enregistrer cela. Réessayez.",
  pushContentLabel: "Afficher le texte des messages sur l'écran verrouillé",
  pushContentBody:
    "Les notifications montrent qui a texté et la première ligne du message, " +
    "pour que l'équipe distingue une demande d'un « merci » sans déverrouiller. " +
    "Désactivez cette option et l'équipe verra encore qui a écrit, mais jamais " +
    "ce que le client a écrit — utile si les téléphones sortent sur les " +
    "chantiers, chez d'autres personnes.",
  pushContentScope:
    "Ce réglage vaut pour tout l'espace de travail, pas seulement pour vous",
  pushContentScopeEnd: ".",
  pushContentScopeOwnersOnly:
    " — seuls les propriétaires et les administrateurs peuvent le modifier.",
  quietFromAria: "Silence à partir de",
  quietUntilAria: "Silence jusqu'à",
  quietTo: "à",

  referralTitle: "Recommander une autre équipe",
  referralRewardEach: "— {amount} chacun.",
  referralNobodyYet: "Personne n'a encore utilisé votre lien.",
  referralMonthsEarnedOne: "{count} mois gratuit obtenu jusqu'à maintenant.",
  referralMonthsEarnedMany: "{count} mois gratuits obtenus jusqu'à maintenant.",

  rejectionUnknownPort:
    "Le fournisseur a refusé ce transfert sans dire pourquoi d'une façon que " +
    "nous pouvons traduire.",
  rejectionUnknownRegistration:
    "Le fournisseur a refusé cette inscription sans dire pourquoi d'une façon " +
    "que nous pouvons traduire.",
  rejectionUnknownFix:
    "Vérifiez les renseignements ci-dessous avec vos documents d'entreprise " +
    "officiels, et écrivez-nous si rien ne semble erroné.",
  rejectionCarrierSaid: "Le fournisseur a dit : {reason}",
  rejectionTakeMeToIt: "Amenez-moi au champ",
  rejectionGetHelp: "Obtenir de l'aide",
  rejectionMailSubjectPort:
    "Mon transfert de numéro est refusé chaque fois",
  rejectionMailSubjectRegistration:
    "Mon inscription est refusée chaque fois",

  releaseTitle: "Libérer le {number} ?",
  releaseTypeToConfirm: "Tapez {number} pour confirmer",
  releaseKeep: "Garder le numéro",
  releaseConfirm: "Libérer le numéro",
  releasing: "Libération…",
  releaseDone: "{number} libéré.",
  releaseFailed: "Impossible de libérer le numéro. Réessayez.",
  releaseBodyPlain:
    "Cela abandonne le numéro pour de bon. Les clients qui le textent ne vous " +
    "joindront plus, et vous ne pouvez pas récupérer le même numéro. Cela ne " +
    "change ni votre forfait ni ce que vous payez — un numéro est inclus, " +
    "alors vous pouvez en configurer un nouveau ici par la suite. Tapez le " +
    "numéro pour confirmer.",
  releaseBodyOverAllowance:
    "Ce numéro n'est pas couvert par votre forfait, et le libérer est l'autre " +
    "façon de sortir de cette attente — cela met fin à l'attente en " +
    "abandonnant le numéro plutôt qu'en le rétablissant. Les clients qui le " +
    "textent ne vous joindront plus par la suite, et vous ne pouvez pas " +
    "récupérer le même numéro. Votre forfait cesse de dépasser son allocation, " +
    "et ce que vous payez ne change pas. Tapez le numéro pour confirmer.",
  releaseBodyUnknownHold:
    "Ce numéro est déjà en attente, et le libérer met fin à l'attente en " +
    "abandonnant le numéro plutôt qu'en le rétablissant. Les clients qui le " +
    "textent ne vous joindront plus par la suite, et vous ne pouvez pas " +
    "récupérer le même numéro. Ce que vous payez ne change pas. Nous ne " +
    "pouvons pas savoir d'ici si votre forfait a de la place pour un " +
    "remplacement — consultez la facturation avant d'abandonner celui-ci. " +
    "Tapez le numéro pour confirmer.",

  discard: "Abandonner",
  saveFailedGenericRetry: "L'enregistrement a échoué. Réessayez.",
  remindersTitle: "Rappels de rendez-vous",
  remindersDescription:
    "Un texto avant la tâche, pour que moins de gens oublient",
  remindersOffBody:
    "Les rappels sont désactivés. Rien ne part automatiquement tant que vous " +
    "n'en configurez pas un — une tâche prévue pour demain ne reçoit aucun " +
    "texto de notre part aujourd'hui.",
  remindersSetUpUsual: "Configurer les deux habituels",
  remindersOffsetLabel: "Combien de temps avant la tâche",
  remindersToggleAria: "Rappel {when}",
  remindersRemoveAria: "Retirer le rappel {when}",
  remindersBodyAria: "Ce que dit le rappel {when}",
  remindersAddAnother: "Ajouter un autre",
  remindersCap:
    "Deux, c'est le maximum que nous envoyons. Au-delà, les clients cessent " +
    "de les lire.",
  remindersSaveAction: "Enregistrer les rappels",
  remindersAllOff:
    "Les rappels sont désactivés. Rien ne partira automatiquement.",
  remindersSaved:
    "Enregistré. Les nouvelles tâches porteront ces rappels.",

  mfaTitle: "Exiger la double authentification pour tout le monde",
  mfaDescription:
    "Chaque personne de cet espace de travail doit configurer une application " +
    "d'authentification. Vous choisissez combien de temps elle a pour le faire.",
  mfaStateInForce: "Exigée — en vigueur maintenant",
  mfaStateGrace: "Exigée — période de grâce en cours",
  mfaStateOff: "Non exigée",
  mfaInForceBody:
    "Toute personne qui ne l'a pas doit la configurer avant de pouvoir " +
    "utiliser l'espace de travail.",
  mfaGraceBody:
    "En vigueur à partir du {when}. D'ici là, tout le monde continue de " +
    "travailler normalement.",
  mfaOffBody:
    "Un mot de passe volé suffit pour texter vos clients en votre nom. C'est " +
    "le réglage qui empêche cela.",
  mfaSwitchAria: "Exiger la double authentification",
  mfaDeadlineFixed:
    "Cette échéance est fixe. Enregistrer de nouveau ne la déplacera pas — " +
    "ce que vous dites à votre équipe reste donc vrai.",
  mfaConfirmTitle: "Exiger la double authentification pour tout le monde ?",
  mfaConfirmBody:
    "Tout le monde obtient une période de grâce pour la configurer. Après " +
    "cela, toute personne qui ne l'a pas est dirigée vers l'écran de " +
    "configuration plutôt que vers l'application — donnez donc à l'équipe " +
    "assez de temps pour le faire entre deux tâches.",
  mfaGraceLabel: "Période de grâce",
  mfaGrace7: "7 jours",
  mfaGrace14: "14 jours (recommandé)",
  mfaGrace30: "30 jours",
  mfaGrace0: "Immédiatement",
  mfaGrace0Warning:
    "Toute personne qui ne l'a pas en ce moment — vous y compris, si vous ne " +
    "l'avez pas configurée — est bloquée hors de l'espace de travail jusqu'à " +
    "ce qu'elle le fasse.",
  mfaRequireIt: "L'exiger",
  mfaOn: "La double authentification est maintenant exigée.",
  mfaOnWithDeadline: "Activée. Tout le monde a jusqu'au {when}.",
  mfaOff: "La double authentification n'est plus exigée.",

  ringCardTitle: "Comment les téléphones sonnent",
  ringCardDescription:
    "Quand un appel entre, tous les téléphones de l'équipe peuvent sonner " +
    "ensemble, ou ils peuvent se joindre un à la fois pour que la personne qui " +
    "répond le plus souvent ait le premier choix.",
  ringAllDetail:
    "Ce qui se passe aujourd'hui. Tous les téléphones de l'équipe sonnent " +
    "pendant toute la durée, et la première personne qui répond prend l'appel.",
  ringInTurnDetail:
    "Le téléphone du membre le plus ancien sonne en premier, seul. Douze " +
    "secondes plus tard, le suivant se joint à lui, puis le suivant — le " +
    "téléphone de personne n'est jamais coupé en cours de route.",
  ringWindowOnePhone:
    "Ensuite, l'appelant entend votre message d'accueil. En {seconds} " +
    "secondes, 1 téléphone a son tour — toute personne après cela ne sonne " +
    "jamais sur cette ligne.",
  ringWindowManyPhones:
    "Ensuite, l'appelant entend votre message d'accueil. En {seconds} " +
    "secondes, {phones} téléphones ont leur tour — toute personne après cela " +
    "ne sonne jamais sur cette ligne.",
  ringWindowAll:
    "Ensuite, l'appelant entend votre message d'accueil. Plus de 45 secondes " +
    "n'est pas offert : les segments d'appel se terminent là, ce serait donc " +
    "une sonnerie que personne ne pourrait entendre.",
  ringOwnersOnly:
    "Seuls les propriétaires et les administrateurs peuvent modifier la façon " +
    "dont les téléphones sonnent.",
  ringStrategySaved: "Sonnerie mise à jour.",
  ringSecondsSaved: "Durée de sonnerie mise à jour.",
  ringCeilingLine:
    "{targets} personnes pourraient être jointes par un appel à ce numéro, et " +
    "un appel en fait sonner {limit}. Tout le monde prend encore son tour — " +
    "{limit} différentes personnes sonnent chaque fois — mais personne n'est " +
    "joint à chaque appel.",

  settingsHeading: "Paramètres",
  navSectionsAria: "Sections des paramètres",
  navSomethingNew: "Quelque chose de nouveau",
  navWorkspace: "Espace de travail",
  navWorkspaceDesc:
    "Nom de l'entreprise, identité d'entreprise, fuseau horaire",
  navTeam: "Équipe",
  navTeamDesc: "Membres, rôles et invitations",
  navNumbers: "Numéros",
  navNumbersDesc: "Vos numéros d'entreprise et l'inscription américaine",
  navHours: "Heures, réponse d'absence et rappels",
  navHoursDesc:
    "Réponses automatiques et rappels de rendez-vous, dans vos propres mots",
  navCalling: "Appels",
  navCallingDesc:
    "Boîte vocale, filtrage, afficheur, rappel par texto",
  navTemplates: "Modèles et étiquettes",
  navTemplatesDesc:
    "Réponses enregistrées, et les étiquettes qui classent votre travail",
  navAi: "Lou",
  navAiDesc:
    "Pré-remplir l'adresse et la date d'échéance d'une tâche à partir des " +
    "messages",
  navUsage: "Utilisation",
  navUsageDesc: "Utilisation raisonnable et le plafond de dépenses que vous contrôlez",
  navBilling: "Facturation",
  navBillingDesc: "Forfait, mode de paiement et factures",
  navPayments: "Encaisser les paiements",
  navPaymentsDesc:
    "Prenez un acompte ou le paiement final directement dans la conversation",
  navNotifications: "Notifications",
  navNotificationsDesc: "Courriel et notifications poussées, par personne",
  navProfile: "Profil",
  navProfileDesc: "Votre nom, votre thème et la déconnexion",
  navAccount: "Compte",
  navAccountDesc: "Courriel, mot de passe et méthodes de connexion",
  navDevices: "Appareils",
  navDevicesDesc: "Ce qui est connecté, et comment le déconnecter",
  navHistory: "Historique",
  navHistoryDesc: "Qui a changé quoi, et quand",
  navHelp: "Aide",
  navHelpDesc: "Communiquez avec nous quand quelque chose ne va pas",
  navWhatsNew: "Nouveautés",
  navWhatsNewDesc: "Ce qui a été livré récemment, et où le trouver",

  regEnter: "Entrez {what}.",
  regTooLong: "Restez sous les {max} caractères.",
  regFieldDisplayName: "le nom d'entreprise que vos clients connaissent",
  regFieldStreet: "l'adresse municipale",
  regFieldCity: "la ville",
  regFieldState: "l'État",
  regFieldProvince: "la province",
  regFieldZip: "le code ZIP",
  regFieldPostal: "le code postal",
  regFieldFirstName: "votre prénom",
  regFieldLastName: "votre nom de famille",
  regFieldCompanyName: "votre dénomination sociale",
  regEmailInvalid: "Entrez une adresse courriel de contact.",
  regPhoneInvalid: "Entrez un numéro de téléphone de contact.",
  regSsnLast4: "Entrez les 4 derniers chiffres de votre SSN.",
  regSinLast4: "Entrez les 4 derniers chiffres de votre NAS.",
  regMobileInvalid:
    "Entrez un numéro de cellulaire américain ou canadien ; c'est lui qui " +
    "reçoit le texto de vérification.",
  regWebsiteInvalid:
    "Entrez une adresse web (par exemple plomberiemichel.com) ou laissez le " +
    "champ vide.",
  regEinInvalid:
    "Entrez votre EIN à 9 chiffres (chiffres seulement, tirets acceptés).",
  regCraInvalid: "Entrez votre numéro d'entreprise de l'ARC.",
  regMessageFlowShort:
    "Les fournisseurs exigent au moins 40 caractères ici : décrivez comment " +
    "les clients vous demandent de leur écrire.",
  regMessageFlowLong: "Restez sous les 2 048 caractères.",
  regSampleShort:
    "Au moins 20 caractères : un vrai texto que vous enverriez.",
  regSampleLong: "Restez sous les 1 024 caractères.",
  regFirstNameLabel: "Prénom",
  regLastNameLabel: "Nom de famille",
  regSsnLabel: "4 derniers chiffres de votre SSN",
  regSinLabel: "4 derniers chiffres de votre NAS",
  regSsnHelp:
    "Les fournisseurs s'en servent pour vérifier que vous êtes une vraie " +
    "personne. Nous ne conservons jamais le numéro complet.",
  regMobileLabel: "Votre numéro de cellulaire",
  regMobileHelp:
    "Un code de vérification y est envoyé par texto après votre renvoi.",
  regLegalNameLabel: "Dénomination sociale",
  regLegalNameHelpUs: "Exactement comme sur votre lettre d'EIN.",
  regLegalNameHelpCa: "Exactement comme sur votre inscription à l'ARC.",
  regEinLabel: "EIN",
  regBusinessNumberLabel: "Numéro d'entreprise",
  regDisplayNameLabel: "Nom d'entreprise que vos clients connaissent",
  regEmailLabel: "Courriel de contact",
  regPhoneLabel: "Téléphone de contact",
  regStreetLabel: "Adresse municipale",
  regWebsiteLabel: "Site web",
  regWebsiteOptionalLabel: "Site web (facultatif)",
  regVerticalLabel: "Secteur d'activité",
  regMessageFlowLabel: "Comment les clients vous demandent de leur écrire",
  regMessageFlowHelp:
    "Des mots simples fonctionnent le mieux. Par exemple : « Les clients " +
    "textent d'abord notre numéro d'entreprise, ou nous demandent en personne " +
    "ou par téléphone de leur écrire. »",
  regSample1Label: "Exemple de texto que vous envoyez",
  regSample2Label: "Un autre exemple",
  regSubmitting: "Envoi…",
  regResubmitAction: "Renvoyer l'inscription",
  regSubmitAction: "Envoyer l'inscription",
  regSubmitted:
    "Envoyé. Nous vous écrirons quand les fournisseurs l'auront approuvée.",
  regResubmitFailed: "Impossible de renvoyer. Réessayez dans un moment.",

  verticalAgriculture: "Agriculture",
  verticalCommunication: "Communication",
  verticalConstruction: "Construction",
  verticalEducation: "Éducation",
  verticalEnergy: "Énergie",
  verticalEntertainment: "Divertissement",
  verticalFinancial: "Finance",
  verticalGambling: "Jeux d'argent",
  verticalGovernment: "Gouvernement",
  verticalHealthcare: "Santé",
  verticalHospitality: "Hôtellerie et restauration",
  verticalHumanResources: "Ressources humaines",
  verticalInsurance: "Assurance",
  verticalLegal: "Droit",
  verticalManufacturing: "Fabrication",
  verticalNgo: "Organisme sans but lucratif",
  verticalPolitical: "Politique",
  verticalPostal: "Services postaux",
  verticalProfessional: "Services professionnels",
  verticalRealEstate: "Immobilier",
  verticalRetail: "Commerce de détail",
  verticalTechnology: "Technologie",
  verticalTransportation: "Transport",

  regOtpYourMobile: "votre cellulaire",
  regOtpLead:
    "Une dernière étape : entrez le code de vérification que nous avons " +
    "envoyé au {phone} pour terminer l'inscription américaine.",
  regOtpCodeInvalid: "Entrez le code à 6 chiffres reçu par texto.",
  regOtpVerified: "Vérifié. L'inscription reprend son cours.",
  regOtpFailed: "Ce code n'a pas fonctionné. Réessayez.",
  regOtpLabel: "Code de vérification",
  regOtpPlaceholder: "Code à 6 chiffres",
  regOtpChecking: "Vérification…",
  regOtpVerify: "Vérifier",
  regOtpResent: "Nouveau code envoyé par texto au {phone}.",
  regOtpResendFailed: "Impossible de renvoyer le code. Réessayez.",
  regOtpSending: "Envoi…",
  regOtpResend: "Renvoyer le code",
  regUsTextingTitle: "Textos vers les États-Unis",
  regUsTextingDescription:
    "Texter des numéros canadiens fonctionne déjà. Texter des numéros " +
    "américains exige une inscription unique auprès des fournisseurs.",
  regEnableUsAction: "Activer les textos américains : {fee} une seule fois",
  regEnableUsConfirmTitle: "Activer les textos vers les États-Unis ?",
  regNotNow: "Pas maintenant",
  regStarting: "Démarrage…",
  regEnableUs: "Activer les textos américains",
  regEnableUsFailed:
    "Impossible de lancer l'inscription américaine. Réessayez.",
  regAskOwnerEnableUs:
    "Demandez au propriétaire du compte d'activer les textos américains ; " +
    "c'est une inscription unique de {fee} auprès des fournisseurs.",
  regSectionTitle: "Inscription pour les textos américains",
  regSectionDescription:
    "Les fournisseurs exigent que chaque entreprise s'inscrive avant de " +
    "pouvoir texter des numéros américains. Nous nous occupons de la démarche " +
    "pour vous.",
  regNotStartedYet:
    "L'inscription commence automatiquement dès le début de votre abonnement. " +
    "Rien à faire ici pour l'instant.",
  regStepSubmitted: "Renseignements d'entreprise envoyés",
  regStepSubmittedOn: "Envoyés le {date}",
  regStepNotSubmitted:
    "Vos renseignements sont enregistrés mais pas encore envoyés",
  regStepReview: "Examen par les fournisseurs",
  regStepReviewDetail:
    "Habituellement de 3 à 7 jours ouvrables, nous nous en occupons",
  regStepLive: "Textos américains activés",
  regStepApprovedOn: "Approuvés le {date}",
  regLive: "Les textos américains sont en service.",
  regInReview:
    "Les textos américains s'activent dans environ 3 à 7 jours ouvrables " +
    "(approbation des fournisseurs). Les appels, la réception de textos et " +
    "les textos vers les numéros canadiens fonctionnent déjà.",
  regDeactivated:
    "Les textos américains sont en pause pendant que votre abonnement est " +
    "inactif. Vous réabonner relance automatiquement l'approbation des " +
    "fournisseurs.",
  regAskOwnerResubmit:
    "Demandez à un propriétaire ou à un administrateur de mettre à jour et de " +
    "renvoyer l'inscription.",
  regAskOwnerSubmit:
    "Un propriétaire ou un administrateur doit terminer et envoyer " +
    "l'inscription.",

  usRegPausedHeading:
    "Vous pouvez commencer même si votre forfait est en pause",
  usRegPausedNote:
    "L'examen par les fournisseurs prend des jours de toute façon, et rien " +
    "n'exige que votre forfait soit actif. Le faire maintenant, c'est " +
    "attendre pendant votre saison tranquille plutôt que pendant votre " +
    "première semaine de retour.",
  usRegTerms:
    "Des frais d'inscription uniques de {fee} sont portés à la carte que nous " +
    "avons au dossier, et nous inscrivons votre entreprise auprès des " +
    "fournisseurs américains. L'approbation prend habituellement de 3 à 7 " +
    "jours ouvrables.",
  usRegRunningTail:
    "Nous nous en occupons et vous écrivons quand c'est en service.",
  usRegPausedTermMoney:
    "Les {fee} sont facturés aujourd'hui, et une seule fois — pas de nouveau " +
    "à votre retour.",
  usRegPausedTermWait:
    "Les fournisseurs vous examinent pendant que votre forfait est en pause. " +
    "La pause ne retarde pas l'inscription.",
  usRegPausedTermLimit:
    "L'envoi reste désactivé jusqu'à votre reprise. L'approbation signifie " +
    "que les textos américains sont configurés et vous attendent, pas qu'un " +
    "forfait en pause se met à envoyer.",
  usRegStartedPaused:
    "Inscription américaine lancée. Nous vous écrirons quand les fournisseurs " +
    "l'auront approuvée, et les textos américains fonctionneront à votre " +
    "reprise.",
  usRegStartedRunning:
    "Inscription américaine lancée. Nous vous écrirons quand elle sera " +
    "approuvée.",

  startPortTrigger: "Amener un numéro",
  startPortNumberLabel: "Numéro à transférer",
  startPortCheck: "Vérifier",
  startPortNumberInvalid:
    "Entrez votre numéro américain ou canadien à 10 chiffres.",
  startPortCheckFailed:
    "Nous n'avons pas pu vérifier ce numéro pour l'instant. Réessayez dans un " +
    "moment.",
  startPortFieldsMissing:
    "Remplissez les renseignements du compte et l'adresse du service.",
  startPortSsn: "SSN",
  startPortSin: "NAS",
  startPortWirelessMissing:
    "C'est un numéro de cellulaire. Entrez le NIP de transfert et les 4 " +
    "derniers chiffres du {idKind} du titulaire du compte.",
  startPortStarted:
    "Transfert lancé. Téléversez vos documents pour l'envoyer.",
  startPortFailed:
    "Impossible de lancer le transfert. Réessayez dans un moment.",
  startPortCarrierAccount: "Votre compte chez votre fournisseur actuel",
  startPortAccountHolder: "Titulaire du compte",
  startPortTransferPin: "NIP de transfert",
  startPortLast4: "4 derniers chiffres du {idKind}",
  startPortWirelessNote:
    "Les numéros de cellulaire en ont besoin pour être libérés. Nous ne " +
    "conservons que les 4 derniers chiffres du {idKind}.",
  startPortServiceAddress: "Adresse du service au dossier",
  startPortAddressNote:
    "Selon votre facture la plus récente. Une adresse qui ne correspond pas " +
    "est la première cause de retard d'un transfert.",
  startPortBridgeAria:
    "Donnez-moi un numéro temporaire pendant le transfert de mon numéro",
  startPortBridge:
    "Donnez-moi un numéro temporaire d'où texter pendant que celui-ci est " +
    "transféré. Vous pourrez le libérer plus tard.",
  startPortAction: "Lancer le transfert",

  textEnableTrigger: "Ajouter les textos à une ligne fixe",
  textEnableDialogTitle: "Ajouter les textos à votre ligne fixe actuelle",
  textEnableDialogBody:
    "Votre numéro et votre fournisseur restent exactement les mêmes ; les " +
    "appels ne changent pas. Loonext ajoute les textos au numéro ; l'examen " +
    "par le fournisseur prend habituellement quelques jours ouvrables, et les " +
    "textos entrent en service une fois qu'il est terminé.",
  textEnableNumberLabel: "Numéro à activer pour les textos",
  textEnableNumberHint:
    "Un numéro local, fixe ou VoIP, aux États-Unis ou au Canada. Vous " +
    "téléverserez ensuite une autorisation signée et une facture récente pour " +
    "le fournisseur.",
  textEnableNumberInvalid:
    "Entrez votre numéro d'entreprise américain ou canadien, par exemple " +
    "+16135551234.",
  textEnableStartAction: "Lancer l'activation des textos",
  textEnableStarted:
    "Activation des textos lancée. Téléversez ensuite votre autorisation " +
    "signée et une facture récente.",
  textEnableStartFailed:
    "Impossible d'activer les textos pour ce numéro. Réessayez dans un moment.",

  storageReceived: "Pièces jointes reçues",
  storageSent: "Pièces jointes envoyées",
  storageNotes: "Fichiers sur les notes",
  storageVoicemail: "Enregistrements de boîte vocale",
  storageOther: "Autres fichiers",
  storageEmpty:
    "Rien de stocké pour l'instant. Les pièces jointes reçues et envoyées, " +
    "les fichiers sur les notes et les enregistrements de boîte vocale sont " +
    "gratuits sur tous les forfaits, sans plafond.",
  storageTotal: "{size} stockés",
  storageFree: "Gratuit sur tous les forfaits, sans plafond",
  storageBarAria:
    "Stockage : {parts}. Gratuit sur tous les forfaits, sans plafond.",
  storageBarPart: "{size} de {kind}",

  timezoneSearchPlaceholder: "Rechercher un fuseau horaire…",
  timezoneNoMatch: "Aucun fuseau horaire ne correspond.",

  hoursOpenAria: "Heure d'ouverture le {day}",
  hoursCloseAria: "Heure de fermeture le {day}",
  hoursClosed: "Fermé",

  tagsTitle: "Étiquettes",
  tagsDescription:
    "Ce que l'équipe étiquette, et à quelle fréquence. Les plus discrètes, en " +
    "bas, sont souvent des doublons de quelque chose au-dessus.",
  tagNeverUsed: "jamais utilisée",
  tagUsesOne: "{count} conversation",
  tagUsesMany: "{count} conversations",
  tagLastUsed: " · dernière fois {when}",
  tagDescribeAria: "Décrire {name}",
  tagEditDescriptionAria: "Modifier la description de {name}",
  tagMerge: "Fusionner",
  tagMerging: "Fusion…",
  tagDescriptionPlaceholder: "Qu'est-ce que celle-ci veut dire ?",
  tagMergeTitle: "Fusionner « {name} » avec une autre étiquette",
  tagMergeBody:
    "Chaque conversation étiquetée « {name} » garde sa place sous " +
    "l'étiquette que vous choisissez, et celle-ci disparaît. Rien n'est " +
    "désétiqueté.",
  tagMergeKeepWhich: "Quelle étiquette garder ?",
  tagMergeOutcomeOne:
    "{count} conversation passe à « {into} ». « {name} » cesse d'exister.",
  tagMergeOutcomeMany:
    "{count} conversations passent à « {into} ». « {name} » cesse d'exister.",
  tagMergeFailed: "Impossible de les fusionner. Réessayez dans un moment.",
  tagLockTitle: "Qui peut créer des étiquettes",
  tagLockDescription:
    "Par défaut, toute personne de l'équipe peut ajouter une étiquette. " +
    "Verrouillez une fois que votre liste est la bonne.",
  tagLockLabel:
    "Seuls les propriétaires et les administrateurs peuvent créer des " +
    "étiquettes",
  tagLockHint:
    "Tout le monde peut encore utiliser chaque étiquette que vous avez déjà. " +
    "Cela empêche seulement d'en inventer de nouvelles en pleine tâche.",
  tagLockedNote:
    "Un technicien qui a besoin d'une catégorie que vous n'avez pas laissera " +
    "la conversation sans étiquette plutôt que de demander. Vérifiez la liste " +
    "ci-dessous de temps en temps.",

  hostedSectionTitle: "Numéros activés pour les textos",
  hostedSectionDescription:
    "Ajouter les textos à des numéros qui gardent leur fournisseur actuel.",
  hostedStartDescription:
    "Gardez le numéro et le fournisseur que vous avez ; Loonext y ajoute les " +
    "textos. Les appels ne changent pas ; l'examen par le fournisseur prend " +
    "quelques jours ouvrables, et les textos entrent en service une fois " +
    "qu'il est terminé.",
  hostedStatePending:
    "En attente de l'examen du fournisseur, habituellement quelques jours " +
    "ouvrables. Les appels continuent de fonctionner avec votre fournisseur " +
    "actuel pendant tout ce temps.",
  hostedStateActionRequired:
    "Le fournisseur a besoin de votre autorisation signée (LOA) et d'une " +
    "facture récente avant de pouvoir continuer.",
  hostedStateInProgress:
    "Vos documents sont chez le fournisseur pour examen. Rien à faire ; les " +
    "textos s'activent ici dès que c'est terminé.",
  hostedStateCompleted:
    "Les textos sont en service sur ce numéro. Les appels sont inchangés ; " +
    "ils restent chez votre fournisseur actuel.",
  hostedStateCancelled:
    "Activation des textos annulée. Votre numéro reste intact chez votre " +
    "fournisseur actuel.",
  hostedStateFailedFallback:
    "Le fournisseur n'a pas pu compléter la demande. Vérifiez vos documents " +
    "et renvoyez-la.",
  hostedLoaHint:
    "Une lettre signée autorisant les textos sur ce numéro. PDF seulement, " +
    "moins de 5 Mo, signée dans les 90 derniers jours, indiquant ce numéro.",
  hostedBillHint:
    "Une facture récente de votre fournisseur actuel, de moins de 30 jours, " +
    "indiquant ce numéro. PDF seulement, moins de 5 Mo.",
  hostedDocSizeError:
    "Chaque fichier doit être un PDF non vide de moins de 5 Mo (la limite du " +
    "fournisseur pour ces documents).",
  hostedDocTypeError:
    "Le fournisseur accepte uniquement des fichiers PDF pour ces documents.",
  hostedVerified:
    "Propriété du numéro vérifiée. Rien d'autre à faire pour cette étape.",
  hostedVerifyTitle: "Vérifiez que ce numéro vous appartient",
  hostedVerifyBody:
    "Si le fournisseur demande une preuve, obtenez un code à usage unique au " +
    "{number} (par texto, ou par appel automatisé si la ligne ne reçoit pas " +
    "de textos) et entrez-le ci-dessous.",
  hostedTextACode: "Envoyer un code par texto",
  hostedCallWithCode: "Appeler avec un code",
  hostedVerifying: "Vérification…",
  hostedCodeTexted: "Code envoyé par texto au {number}.",
  hostedCodeCalling: "Appel en cours au {number} avec votre code.",
  hostedCodeSendFailed:
    "Impossible d'envoyer un code. Réessayez dans un moment.",
  hostedNumberVerified: "Numéro vérifié.",
  hostedCodeCheckFailed:
    "Impossible de vérifier ce code. Réessayez dans un moment.",
  hostedRemoveTitle: "Retirer les textos du {number} ?",
  hostedRemoveBody:
    "Cela libère le numéro de Loonext : les textos s'arrêtent et sa place " +
    "dans le forfait se libère. Les appels ne sont pas touchés ; le numéro " +
    "lui-même reste chez votre fournisseur actuel. Y réactiver les textos " +
    "plus tard exige un nouvel examen du fournisseur. Tapez le numéro pour " +
    "confirmer.",
  hostedKeepTexting: "Garder les textos",
  hostedRemoveTexting: "Retirer les textos",
  hostedTextingRemoved: "Textos retirés du {number}.",
  hostedCancelAction: "Annuler l'activation des textos…",
  hostedCancelTitle: "Arrêter l'ajout des textos au {number} ?",
  hostedCancelBody:
    "Votre numéro reste intact ; les appels et le service restent chez votre " +
    "fournisseur actuel. Vous pouvez recommencer à tout moment.",
  hostedKeepGoing: "Continuer",
  hostedCancelConfirm: "Annuler l'activation des textos",
  hostedCancelled: "Activation des textos annulée.",
  hostedCancelFailed: "Impossible d'annuler. Réessayez.",
  hostedCancelledPill: "Activation des textos annulée",
  hostedStartedOn: "Commencé le {date}.",
  hostedLive: "Textos en service, appels inchangés",
  hostedAdding: "Ajout des textos en cours",
  hostedOwnerUploads:
    "Un propriétaire ou un administrateur téléverse l'autorisation et la " +
    "facture.",
  hostedResubmit: "Renvoyer",
  hostedResubmitted:
    "Demande renvoyée. Nous la soumettrons de nouveau au fournisseur.",
  hostedAskOwnerToFix:
    "Demandez à un propriétaire ou à un administrateur de corriger les " +
    "documents et de renvoyer la demande.",

  tfaTitle: "Double authentification",
  tfaDescription:
    "Un code venant de votre téléphone, en plus de votre mot de passe. C'est " +
    "ce qui empêche un mot de passe volé de devenir quelqu'un qui texte vos " +
    "clients en votre nom.",
  tfaAuthenticatorFactorName: "Application d'authentification · {date}",
  tfaPasskeyFactorName: "Clé d'accès · {date}",
  tfaStartFailed: "Impossible de lancer la configuration. Réessayez.",
  tfaUnexpectedStep: "Étape de clé d'accès inattendue. Recommencez.",
  tfaPasskeyFailed:
    "Impossible d'ajouter une clé d'accès. Réessayez, ou utilisez une " +
    "application d'authentification.",
  tfaCodeMismatch:
    "Ce code ne correspond pas. Vérifiez votre application et essayez le " +
    "suivant.",
  tfaTurnedOff: "La double authentification est désactivée.",
  tfaTurnOffFailed: "Impossible de la désactiver. Réessayez.",
  tfaIssueCodesFailed: "Impossible d'émettre de nouveaux codes.",
  tfaBothOn:
    "La clé d'accès et l'application d'authentification sont activées",
  tfaPasskeyOn: "La clé d'accès est activée",
  tfaAuthenticatorOn: "L'application d'authentification est activée",
  tfaOn: "La double authentification est activée.",
  tfaCodesLeftOne: "{count} code de récupération restant.",
  tfaCodesLeftMany: "{count} codes de récupération restants.",
  tfaNoCodesLeft:
    "Aucun code de récupération restant — émettez-en un nouveau lot " +
    "maintenant.",
  tfaNewCodes: "Nouveaux codes de récupération",
  tfaPasskeyPitch:
    "Utilisez votre visage, votre empreinte ou le verrouillage de votre écran " +
    "comme deuxième étape. Rien à taper et rien à perdre — cela reste sur cet " +
    "appareil. Nous vous donnerons des codes de secours pour le jour où " +
    "l'appareil vous fera défaut.",
  tfaUsePasskey: "Utiliser une clé d'accès",
  tfaUseAuthenticator: "Utiliser une application d'authentification",
  tfaAuthenticatorPitch:
    "Vous scannerez un code QR avec une application d'authentification — " +
    "Google Authenticator, 1Password, celle que vous utilisez déjà — et vous " +
    "entrerez un code à six chiffres pour prouver que ça fonctionne. Nous " +
    "vous donnerons des codes de secours pour le jour où vous perdrez le " +
    "téléphone.",
  tfaSetUp: "Configurer la double authentification",
  tfaScanTitle: "Scannez ceci avec votre application d'authentification",
  tfaScanBody: "Tapez ensuite le code à six chiffres qu'elle affiche.",
  tfaQrAlt: "Code QR pour votre application d'authentification",
  tfaManualKey:
    "Impossible de scanner ? Entrez plutôt cette clé",
  tfaSixDigitCode: "Code à six chiffres",
  tfaTurnItOn: "L'activer",
  tfaCodesTitle: "Enregistrez vos codes de récupération",
  tfaCodesBody:
    "C'est la seule fois où vous les verrez. Si vous perdez votre téléphone, " +
    "un de ces codes est votre façon de revenir — sans eux, revenir à votre " +
    "ligne d'entreprise nous prend des semaines.",
  tfaCopy: "Copier",
  tfaCopied: "Copié.",
  tfaDownload: "Télécharger",
  tfaFileHeading: "Codes de récupération Loonext",
  tfaFileFooter:
    "Chaque code fonctionne une seule fois. Gardez-les à un endroit " +
    "accessible sans votre téléphone.",
  tfaSavedThem: "Je les ai enregistrés",
  tfaTurnOffTitle: "Désactiver la double authentification ?",
  tfaTurnOffBody:
    "Votre compte revient au mot de passe seul. Si cet espace de travail " +
    "exige la double authentification, on vous demandera de la reconfigurer " +
    "la prochaine fois que vous ouvrirez l'application.",
  tfaKeepItOn: "La garder activée",
  tfaTurnItOff: "La désactiver",

  greetingTitle: "Votre propre voix",
  greetingDescription:
    "Enregistrez vous-même le message d'accueil au lieu de le faire lire à " +
    "voix haute. Les appelants entendent une personne, ce qui est justement " +
    "ce que vous vendez.",
  greetingDefaultName: "En dehors des heures",
  greetingNoneYet:
    "Rien d'enregistré pour l'instant — les appelants entendent le message " +
    "écrit, lu à voix haute.",
  greetingPickOne:
    "Choisissez-en un sur un numéro sous Paramètres → Numéros pour l'utiliser. " +
    "Tout ce que vous n'avez pas choisi reste inutilisé.",
  greetingDeleteAria: "Supprimer {name}",
  greetingMicDenied:
    "Votre navigateur ne nous a pas donné accès au microphone. Autorisez-le " +
    "dans la barre d'adresse, puis réessayez.",
  greetingTooLong:
    "C'est plus long que deux minutes. Un appelant qui attend le bip " +
    "raccrochera avant.",
  greetingSaved:
    "Enregistré. Choisissez-le sur un numéro pour l'utiliser.",
  greetingNamedSaved:
    "« {name} » enregistré. Choisissez-le sur un numéro pour l'utiliser.",
  greetingDeleted: "Supprimé.",
  greetingDeleteFailed: "La suppression a échoué.",
  greetingCallFailed: "Nous n'avons pas pu lancer cet appel.",
  greetingHearItBack: "Réécoutez-le",
  greetingTakeLength:
    "{length} · c'est exactement ce qu'un appelant reçoit.",
  greetingNameIt: "Nommez-le",
  greetingRecordAgain: "Enregistrer de nouveau",
  greetingSaveAction: "Enregistrer le message",
  greetingRecordingNow: "Enregistrement… parlez maintenant.",
  greetingStop: "Arrêter",
  greetingUpToTwoMinutes: "Jusqu'à deux minutes.",
  greetingRecord: "Enregistrer",
  greetingCallMeInstead: "Appelez-moi plutôt",
  greetingRatherPhone: "Vous préférez le faire au téléphone ?",
  greetingCallingNow: "Appel en cours au {number}",
  greetingAnswerAndListen: "Répondez, et vous entendrez quoi faire.",
  greetingStepBeep: "Attendez le bip.",
  greetingStepSpeak: "Dites ce que vous voulez que vos appelants entendent.",
  greetingStepHangUp: "Raccrochez. Cela s'enregistre tout seul.",
  greetingWillAppear:
    "Il apparaîtra ci-dessous sous « {name} » une fois arrivé. Vous pouvez " +
    "fermer cette fenêtre.",
  greetingPhoneTitle: "L'enregistrer au téléphone",
  greetingPhoneBody:
    "Nous vous appelons, vous parlez après le bip, et vous raccrochez. Aucune " +
    "permission de microphone, rien à tenir.",
  greetingYourNumber: "Votre numéro",
  greetingCalling: "Appel en cours…",
  greetingCallMe: "Appelez-moi",
  greetingDeleteTitle: "Supprimer « {name} » ?",
  greetingDeleteBody:
    "Tout numéro qui l'utilise revient aux mots écrits, lus à voix haute. Les " +
    "appelants entendent le changement au prochain appel.",
  greetingKeepIt: "Le garder",

  planStateUnknown:
    "Nous n'avons pas pu vérifier l'état de ce forfait pour l'instant, alors " +
    "rien ici n'est affirmé dans un sens ou dans l'autre. Votre forfait et " +
    "votre numéro sont intacts.",
};
