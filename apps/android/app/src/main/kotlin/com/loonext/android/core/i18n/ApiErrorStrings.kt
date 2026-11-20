package com.loonext.android.core.i18n

/**
 * #228 — what a refusal from the server says to somebody who does not read
 * English.
 *
 * Hand-port of `apps/web/src/i18n/sections/apiErrors.ts`, and the reasoning
 * lives there in full. The short version, because it is the part somebody would
 * reasonably undo:
 *
 * The API composes one English sentence per call site — 370 of them — and all
 * three clients render it exactly as it arrived. That stays for an English
 * reader: "No such API key" is specific in a way no per-code sentence can be.
 *
 * It is the wrong default for the reader this issue exists for. The comparison
 * is not against that sentence as READ but as MET by somebody who does not read
 * English, which carries nothing but the fact that something failed. A correct
 * generic sentence in their own language is less specific and strictly more
 * informative — so this only ever replaces a sentence the reader could not use.
 *
 * The key set is held equal to web's and iOS's, in both directions, by
 * `packages/shared/src/api-error-vocabulary-parity.test.ts`. A code added to
 * `packages/shared/src/error-codes.ts` and missed here would resolve to its own
 * name on screen, which is worse than the English it replaced.
 */
object ApiErrorStrings : AppStrings.Section {
    override val en = mapOf(
        "apiRefusals.areaCodeChooseCountry" to
            "Area code {areaCode} does not match the selected country ({country}).",
        "apiRefusals.billingAddOnsRequireSubscription" to
            "Complete checkout before changing add-ons.",
        "apiRefusals.billingAlreadyOnPlan" to
            "You’re already on the {plan} plan.",
        "apiRefusals.billingAlreadyPaused" to
            "Your plan is already paused.",
        "apiRefusals.billingCallingIncluded" to
            "Calling is included on every plan. Refresh the app to see your current plan.",
        "apiRefusals.billingCheckoutSeatLimit" to
            "The {plan} plan allows {seats} members. Your workspace has {members}. Deactivate {over} before checking out.",
        "apiRefusals.billingConfirmPrepaidConversion" to
            "Your prepaid year of {plan} runs through {date}. Switching plans ends it. Confirm the change to continue.",
        "apiRefusals.billingConfirmPrepaidConversionCredit" to
            "Your prepaid year of {plan} runs through {date}. Confirm the change to end it and apply {credit} to your next invoices.",
        "apiRefusals.billingDowngradeMemberLimit" to
            "Starter allows {seats} members. Deactivate extra members before downgrading.",
        "apiRefusals.billingDowngradeSeatLimit" to
            "Starter allows {seats} seats. Revoke extra invites or remove members before downgrading.",
        "apiRefusals.billingInvalidModuleRequest" to
            "Provide the add-on name and whether you want to enable it.",
        "apiRefusals.billingInvalidNumberId" to
            "Provide a valid phone number ID.",
        "apiRefusals.billingInvalidPlan" to
            "Choose the Starter or Pro plan.",
        "apiRefusals.billingModuleUnavailable" to
            "The {module} add-on isn't available yet.",
        "apiRefusals.billingNumberChangeRetry" to
            "Another change to your numbers is being processed. Try again in a moment.",
        "apiRefusals.billingPauseFixPayment" to
            "Sort out your payment method first, then you can pause.",
        "apiRefusals.billingPauseMayTakeTime" to
            "Your plan hasn’t paused yet. If you resumed today, try again tomorrow. You won’t be charged twice for pausing.",
        "apiRefusals.billingPausePrepaid" to
            "You have already paid for a year, through {date}. Pausing would put those months toward the hold.",
        "apiRefusals.billingPausePrepaidContact" to
            "Your prepaid year is still active. Contact us before pausing.",
        "apiRefusals.billingPauseSubscribeFirst" to
            "Subscribe before putting a plan on hold.",
        "apiRefusals.billingPauseUnavailable" to
            "Pausing isn't available right now.",
        "apiRefusals.billingPauseWaitForPlanChange" to
            "Wait for your scheduled plan change before pausing.",
        "apiRefusals.billingPauseWaitForReferral" to
            "You have a free referral month on your next bill. Wait for it to apply before pausing.",
        "apiRefusals.billingPrepaidCurrencyMismatch" to
            "Your prepaid year was paid in {paid}. Your workspace is billed in {current}. Contact us to apply the unused credit.",
        "apiRefusals.billingPrepaidPlanLocked" to
            "Your prepaid year is still active. Contact us before switching plans.",
        "apiRefusals.billingPrepayActivateFirst" to
            "Send your first message first, then you can pay for a year up front.",
        "apiRefusals.billingPrepayAlreadyPaid" to
            "You have already paid for a year. It runs until {date}.",
        "apiRefusals.billingPrepayFixPayment" to
            "Sort out your payment method before paying for a year up front.",
        "apiRefusals.billingPrepaySubscribeFirst" to
            "Subscribe before paying for a year up front.",
        "apiRefusals.billingPrepayUnavailable" to
            "Paying for a year up front isn't available right now.",
        "apiRefusals.billingPrepayWaitForPlanChange" to
            "Wait for your scheduled plan change before paying for a year up front.",
        "apiRefusals.billingPrepayWaitForReferral" to
            "You have a free referral month on your next bill. Wait for it to apply before paying for a year.",
        "apiRefusals.billingRestoreNumberLimit" to
            "Starter allows up to {count} numbers. Switch to Pro to restore this one.",
        "apiRefusals.billingRestoreWaitForNumberSetup" to
            "Another number is still being set up. Try restoring this number once setup finishes.",
        "apiRefusals.billingRestoreWaitForPlanChange" to
            "Restore this number after the scheduled plan change takes effect.",
        "apiRefusals.billingResubscribeForAddOns" to
            "Your subscription is cancelled. Resubscribe to change add-ons.",
        "apiRefusals.billingResumeBeforeAddingModule" to
            "Resume your plan before turning on {module}. Choose when the add-on starts billing.",
        "apiRefusals.billingResumeBeforeChanging" to
            "Resume your plan before changing it. This lets you choose when the new rate starts.",
        "apiRefusals.billingResumeMayTakeTime" to
            "Your plan hasn’t resumed yet. Try again in a minute. You won’t be charged twice for resuming.",
        "apiRefusals.billingResumeUnavailable" to
            "Resuming isn't available right now.",
        "apiRefusals.billingResumeWaitForPlanChange" to
            "Resume after your scheduled plan change takes effect.",
        "apiRefusals.billingSessionRequired" to
            "Provide a checkout session ID.",
        "apiRefusals.billingSubscriptionChanged" to
            "Your subscription just changed. Refresh Billing and try again.",
        "apiRefusals.billingUnknownModule" to
            "Unknown add-on: {module}.",
        "apiRefusals.extraNumberPlanLimit" to
            "Check the plan and its number limit before adding another number.",
        "apiRefusals.numberBillingChangedRetry" to
            "Billing was just updated. Try adding the number again.",
        "apiRefusals.numberCheckNewPurchase" to
            "Another number was just added. Check Settings › Numbers before trying again.",
        "apiRefusals.numberDocumentFileRequired" to
            "Attach a file for {field}.",
        "apiRefusals.numberDocumentSize" to
            "Upload a non-empty file under {limit} MB for {field}.",
        "apiRefusals.numberInvalidBusinessHours" to
            "Enter opening and closing times in HH:MM for weekdays mon through sun.",
        "apiRefusals.numberInvalidClosedDates" to
            "Enter a start and end date in YYYY-MM-DD for each closure. The end date must be on or after the start date. Hours, if supplied, use HH:MM.",
        "apiRefusals.numberInvalidTimezone" to
            "Enter a valid IANA time zone such as America/Toronto.",
        "apiRefusals.numberLocalCountryRequired" to
            "Choose a local number in {country}.",
        "apiRefusals.numberMembersMustBeActive" to
            "Every person must be an active member of this workspace.",
        "apiRefusals.numberNotAwaitingSetup" to
            "This number isn't waiting to be set up.",
        "apiRefusals.numberOrderStillRunning" to
            "We're finishing an earlier order. Try choosing again in a minute.",
        "apiRefusals.numberPurchaseInProgress" to
            "Another number purchase just went through. Try again in a moment.",
        "apiRefusals.numberSetupLimit" to
            "You've set up new numbers many times on this account. Contact support to add another.",
        "apiRefusals.numberSetupUnavailable" to
            "This number can't be set up this way.",
        "apiRefusals.numberWaitForPlanChange" to
            "A plan change is scheduled. Add the number after it takes effect.",
        "apiRefusals.portCannotCancel" to
            "This transfer can no longer be cancelled.",
        "apiRefusals.portCannotEdit" to
            "This transfer can no longer be edited.",
        "apiRefusals.portCannotSubmit" to
            "This transfer cannot be submitted in its current state.",
        "apiRefusals.portCarrierRefused" to
            "The carrier says this number cannot be transferred.",
        "apiRefusals.portDocumentType" to
            "Upload a PDF, PNG, or JPEG for {field}.",
        "apiRefusals.portNeedsFreeNumberSlot" to
            "Your plan has room for {count} numbers. Release one or upgrade before transferring a number.",
        "apiRefusals.portNumberIneligible" to
            "Enter an eligible US or Canadian local number.",
        "apiRefusals.portResubmitUnavailable" to
            "This transfer could not be resubmitted. Check its status before trying again.",
        "apiRefusals.portTollFreeUnsupported" to
            "Toll-free numbers can't be transferred in this flow. Start with a new local number instead.",
        "apiRefusals.portUploadDocumentRequired" to
            "Attach the letter of authorization or a recent bill.",
        "apiRefusals.portUploadForm" to
            "Use multipart/form-data to upload the letter of authorization or a recent bill.",
        "apiRefusals.teamCannotLeave" to
            "You can't leave this workspace.",
        "apiRefusals.teamHandoffRequiresActiveMember" to
            "Assign the work to an active team member or leave it unassigned.",
        "apiRefusals.teamInviteSeatLimit" to
            "The {plan} plan allows {seats} seats. This workspace has {active} active members and {pending} pending invitations.",
        "apiRefusals.teamSeatLimit" to
            "The {plan} plan allows {seats} seats.",
        "apiRefusals.textEnablementCannotCancel" to
            "This request can no longer be cancelled.",
        "apiRefusals.textEnablementCannotResubmit" to
            "Only a request that failed or requires action can be resubmitted.",
        "apiRefusals.textEnablementCannotUpload" to
            "Documents can no longer be uploaded to this request.",
        "apiRefusals.textEnablementCannotVerify" to
            "Ownership verification no longer applies to this request.",
        "apiRefusals.textEnablementCodeSendFailed" to
            "The verification code could not be sent. Try again or choose another method.",
        "apiRefusals.textEnablementDocumentType" to
            "Upload a PDF for {field}.",
        "apiRefusals.textEnablementNeedsFreeSlot" to
            "Your plan has room for {count} numbers. Release one or upgrade before enabling texting on another number.",
        "apiRefusals.textEnablementUploadDocumentRequired" to
            "Attach the letter of authorization or a bill.",
        "apiRefusals.textEnablementUploadForm" to
            "Use multipart/form-data to upload the letter of authorization or a bill.",
        "apiRefusals.workspaceNumberCountry" to
            "The number is from {numberCountry}. Your workspace is registered in {workspaceCountry}.",
        "apiRefusals.billingAccountRequired" to
            "No billing account yet — complete checkout first.",
        "apiRefusals.billingDowngradeReleaseNumber" to
            "Release your extra phone number before downgrading to Starter.",
        "apiRefusals.billingNoSubscriptionToResume" to
            "No subscription to resume.",
        "apiRefusals.billingPlanChangeApplied" to
            "The plan change has already taken effect. Refresh Billing.",
        "apiRefusals.billingPlanNotPaused" to
            "Your plan isn't paused.",
        "apiRefusals.billingResubscribeToChange" to
            "Your subscription is canceled — resubscribe to change plans.",
        "apiRefusals.billingStartBeforeRestoringNumber" to
            "Start your subscription again first — then you can bring this number back.",
        "apiRefusals.billingSubscriptionRequired" to
            "No subscription to change — complete checkout first.",
        "apiRefusals.extraNumberUnavailable" to
            "Extra numbers aren't available yet. Contact support.",
        "apiRefusals.idempotencyKeyRequired" to
            "Idempotency-Key header (a client-generated UUID) is required.",
        "apiRefusals.numberAlreadyReleased" to
            "This number is already released.",
        "apiRefusals.numberRetryInProgress" to
            "A retry is already in progress.",
        "apiRefusals.portDocumentsRequired" to
            "Upload the signed LOA and a recent bill before submitting the transfer.",
        "apiRefusals.portResubmitDocumentsRequired" to
            "Upload the signed LOA and a recent bill before resubmitting the transfer.",
        "apiRefusals.portResubmitNeedsFix" to
            "Only a port that needs a fix can be resubmitted.",
        "apiRefusals.portWirelessPinRequired" to
            "This is a wireless number — the port-out PIN / passcode from your current carrier is required to transfer it.",
        "apiRefusals.scheduledPlanNumberLimit" to
            "Your scheduled plan has no room for another phone number.",
        "apiRefusals.soleProprietorNumberLimit" to
            "Sole Proprietor registration allows 1 phone number.",
        "apiRefusals.teamAlreadyMember" to
            "Already a member of this company.",
        "apiRefusals.teamInviteNoLongerValid" to
            "This invite is no longer valid (accepted, revoked, or expired).",
        "apiRefusals.teamInvitePlanChanged" to
            "Your plan changed. Try the invite again.",
        "apiRefusals.teamInviteScheduledSeatLimit" to
            "This workspace has reached the seat limit for its scheduled plan.",
        "apiRefusals.teamOwnerCannotDeactivate" to
            "The owner cannot be deactivated.",
        "apiRefusals.teamOwnerCannotLeave" to
            "An owner can't leave their own workspace. Close it in settings, or contact us to move it to someone else.",
        "apiRefusals.teamOwnerRoleFixed" to
            "The owner role cannot be changed.",
        "apiRefusals.textEnablementResubmitLimit" to
            "This order has been resubmitted too many times — cancel it and start again, or contact support.",
        "apiRefusals.textEnablementUnsupportedNumber" to
            "This number isn't a US or Canadian local number we can text-enable.",
        "apiRefusals.textEnablementVerificationLimit" to
            "Too many verification attempts for this order — cancel it and start again, or contact support.",
        "apiRefusals.textEnablementVerificationUnavailable" to
            "The hosted-messaging order hasn't been created yet; verification isn't available until it exists.",
        "apiRefusals.areaCodeCountryMismatch" to
            "requested_area_code must be a {country} area code (the company's country).",
        "apiRefusals.areaCodeNotAssigned" to
            "requested_area_code is not an assigned US/CA geographic area code.",
        "apiRefusals.billingAlreadySubscribed" to
            "This company already has a subscription.",
        "apiRefusals.carrierOptOutNeedsStart" to
            "This customer texted STOP, so their carrier is blocking your texts. Only they can undo it, by texting START to your number.",
        "apiRefusals.contactNotFound" to "No such contact.",
        "apiRefusals.contactNumberNotFound" to
            "No such contact number.",
        "apiRefusals.contactUnmergeMainNumberInUse" to
            "Choose a different main number before undoing this merge.",
        "apiRefusals.conversationNotFound" to "No such conversation.",
        "apiRefusals.idempotencyKeyLength" to "Idempotency-Key must contain 1 to 255 characters.",
        "apiRefusals.billingCheckoutTextingRequired" to
            "Complete the US texting details before checkout.",
        "apiRefusals.inviteAlreadyPending" to
            "A pending invite for this email already exists.",
        "apiRefusals.numberCountryMismatch" to
            "chosen_number_e164 must be a {country} number (the company's country).",
        "apiRefusals.privateLinkRetryUnavailable" to "Send a new private link to this customer.",
        "apiRefusals.quoteTextRetry" to "The quote text failed. Retry it in the conversation.",
        "apiRefusals.quoteNotFound" to "No such quote.",
        "apiRefusals.quoteExpiryFuture" to "Choose a future expiry for this quote.",
        "apiRefusals.quoteDraftLocked" to "This quote draft can no longer be changed.",
        "apiRefusals.quoteDeclineUnavailable" to "This quote can no longer be declined.",
        "apiRefusals.quoteUndoUnavailable" to "This quote can no longer be reopened.",
        "apiRefusals.quoteWithdrawalUnavailable" to "This quote can no longer be withdrawn.",
        "apiRefusals.numberNotAssigned" to
            "chosen_number_e164 is not an assigned US/CA geographic number.",
        "apiRefusals.optOutNotActive" to "This number is not opted out.",
        "apiRefusals.outboundDestination" to
            "Use a US or Canadian number, or a supported toll-free number.",
        "apiRefusals.outboundLocalTextDestination" to
            "This text can only go to an eligible US or Canadian number.",
        "apiRefusals.outboundSendPaused" to
            "Texting is paused while we deal with an issue. Nothing you sent was lost.",
        "apiRefusals.paymentsNotSetUp" to
            "This workspace has not set up payments yet.",
        "apiRefusals.portAlreadyPending" to
            "A transfer for this number is already in progress.",
        "apiRefusals.publicTaskInvalidRepeat" to "repeat: not a valid rule.",
        "apiRefusals.publicTaskInvalidRepeatField" to "repeat: {field}.",
        "apiRefusals.publicTaskRepeatNeedsDueDate" to "repeat: a schedule needs a due date to start from.",
        "apiRefusals.publicTaskUnknownTag" to "That tag is not in this workspace.",
        "apiRefusals.remindersNeedCustomer" to "Link a customer conversation to turn on reminders.",
        "apiRefusals.bookingNotFound" to "No such task.",
        "apiRefusals.dispatchStale" to "The plan changed. Reload the schedule and review your changes.",
        "apiRefusals.dispatchLocked" to "Reschedule the locked appointment explicitly before moving it.",
        "apiRefusals.dispatchOverlap" to "This person already has work during that time.",
        "apiRefusals.dispatchWindow" to "The work falls outside the customer's available times.",
        "apiRefusals.dispatchTravel" to "This plan leaves too little travel time between visits.",
        "apiRefusals.taskSourceRequired" to "Choose a text or call source for the task.",
        "apiRefusals.dispatchAddress" to "Confirm the service address before scheduling the visit.",
        "apiRefusals.dispatchHours" to "Choose a time within the dispatch day and available hours.",
        "apiRefusals.dispatchShift" to "Use a shift with a start before its end and breaks that fit without overlapping.",
        "apiRefusals.dispatchDuration" to "Use a duration between 5 minutes and 12 hours.",
        "apiRefusals.dispatchAssignee" to "Choose an active teammate who can open this task.",
        "apiRefusals.bookingSourceCustomer" to "A task created from a text or call keeps its customer.",
        "apiRefusals.bookingCustomerUnavailable" to "Choose an available customer or conversation.",
        "apiRefusals.bookingConfirmationNeedsDate" to "Set a date for this open job before confirming it.",
        "apiRefusals.bookingDuePrecision" to "Provide a time or a date for this job.",
        "apiRefusals.remindersWorkspaceNotFound" to "No such workspace.",
        "apiRefusals.scheduledTextHorizon" to "We can hold a message for up to {days} days.",
        "apiRefusals.scheduledTextKeyUsed" to
            "Idempotency-Key was already used for a different scheduled text.",
        "apiRefusals.taskCreateKeyUsed" to "Idempotency-Key was already used for a task.",
        "apiRefusals.registrationChanged" to
            "The registration changed. Refresh before editing it.",
        "apiRefusals.registrationCheckoutRequired" to
            "Finish checkout before entering business details.",
        "apiRefusals.registrationSubmissionInProgress" to
            "The registration is being submitted. Refresh before editing it.",
        "apiRefusals.textEnablementAlreadyPending" to
            "This number already has a text-enablement in progress.",
        "apiRefusals.textEnablementNumberInUse" to
            "This number is already in service on Loonext and can't be text-enabled.",
        "apiRefusals.textEnablementWrongCode" to
            "That code didn't match. Request a new code and try again.",
        "apiRefusals.contactImportInvalidCustomFields" to
            "Custom fields must be a JSON object of text values.",
        "apiRefusals.contactImportTooManyOtherNumbers" to
            "Row {row} exceeds {limit} other phone numbers.",
        "apiRefusals.exportFileNotFound" to
            "No such export file.",
        "apiRefusals.exportFileSizeUnavailable" to
            "This file's size could not be read. Try again later.",
        "apiRefusals.noActiveSendingNumber" to
            "There is no active number available to send from.",
        "apiRefusals.workspaceExportNotReady" to
            "No ready workspace export with that ID.",
        "apiErrors.unauthorized" to "You're signed out. Sign in again to carry on.",
        "apiErrors.forbidden" to "You don't have access to that.",
        "apiErrors.subscription_inactive" to "Your subscription isn't active.",
        // #303 — a person, not a button. The English at the call sites is
        // careful not to accuse anybody, and this is careful in the same way.
        "apiErrors.sending_suspended" to
            "Sending is paused on this workspace. Get in touch and we'll sort it out.",
        // #277 — nothing lapsed and nothing is at risk. Says the remedy,
        // because the remedy is one button.
        "apiErrors.workspace_paused" to
            "Your plan is paused. Resume it in billing to carry on.",
        "apiErrors.usage_cap_reached" to "You've reached a spending cap for this period.",
        "apiErrors.registration_pending" to "Your texting registration is still being reviewed.",
        "apiErrors.recipient_opted_out" to "This person asked us to stop texting them.",
        "apiErrors.unsupported_service_code" to "Use your phone to dial this service code.",
        "apiErrors.validation_failed" to
            "Something in that wasn't right. Check the details and try again.",
        "apiErrors.not_found" to "We couldn't find that.",
        "apiErrors.conflict" to
            "That can't be done as things stand. Refresh and take another look.",
        "apiErrors.quiet_hours_confirmation_required" to
            "It's quiet hours where they are. Confirm to send anyway.",
        "apiErrors.mfa_required" to "Two-step verification is needed first.",
        "apiErrors.mfa_challenge_required" to "Confirm it's you to carry on.",
        "apiErrors.confirmation_code_required" to "Enter the confirmation code to carry on.",
        "apiErrors.mfa_reprove_required" to "Confirm it's you again to carry on.",
        "apiErrors.rate_limited" to "Too many tries. Wait a minute and try again.",
        "apiErrors.service_unavailable" to "That's busy right now. Try again in a moment.",
        "apiErrors.internal_error" to
            "Something went wrong on our end. Try again in a moment.",
        "apiErrors.contactImportUndeclaredColumnsOne" to
            "File column {columns} was not declared. This import never guesses what a column means because treating a do-not-text column as empty could message somebody who opted out. Every file column ({total} total) must be mapped or explicitly ignored. Send one `{field}` value per column as `<index>:<field or {ignore}>:<header>`. Nothing was imported.",
        "apiErrors.contactImportUndeclaredColumnsMany" to
            "File columns {columns} were not declared. This import never guesses what a column means because treating a do-not-text column as empty could message somebody who opted out. Every file column ({total} total) must be mapped or explicitly ignored. Send one `{field}` value per column as `<index>:<field or {ignore}>:<header>`. Nothing was imported.",
        "apiErrors.contactImportUndeclaredPropertiesOne" to
            "{properties} is a vCard property this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value for it as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
        "apiErrors.contactImportUndeclaredPropertiesMany" to
            "{properties} are vCard properties this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value per property as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
        "apiErrors.contactImportUndeclaredPropertiesCapped" to
            "{properties}, and {more} more, are vCard properties this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value per property as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
        "apiErrors.contactImportUnreadableFlag" to
            "The do-not-text column “{header}” contains values this import cannot read as yes or no: {values}. Use true/false (yes/no, 1/0, or x on rows to block), then import again. Nothing was imported.",
        "apiErrors.contactImportUnreadableFlagCapped" to
            "The do-not-text column “{header}” contains values this import cannot read as yes or no: {values}, and {more} more. Use true/false (yes/no, 1/0, or x on rows to block), then import again. Nothing was imported.",
        "apiErrors.selfDowngradeAcknowledgementRequired" to
            "Confirm that you understand what you'll lose before changing your own role.",
        // #555 — a whole template rather than a suffix, because French does not
        // have to put the reference where English does.
        "apiErrors.withReference" to "{message} Reference {id}.",
    )

    override val frCA = mapOf(
        "apiRefusals.areaCodeChooseCountry" to
            "L’indicatif {areaCode} ne correspond pas au pays sélectionné ({country}).",
        "apiRefusals.billingAddOnsRequireSubscription" to
            "Terminez le paiement initial avant de modifier vos options.",
        "apiRefusals.billingAlreadyOnPlan" to
            "Vous avez déjà le forfait {plan}.",
        "apiRefusals.billingAlreadyPaused" to
            "Votre forfait est déjà en pause.",
        "apiRefusals.billingCallingIncluded" to
            "Les appels sont inclus dans tous les forfaits. Actualisez l’application pour voir votre forfait.",
        "apiRefusals.billingCheckoutSeatLimit" to
            "Le forfait {plan} permet {seats} membres. Votre espace de travail en compte {members}. Désactivez-en {over} avant de payer.",
        "apiRefusals.billingConfirmPrepaidConversion" to
            "Votre année prépayée au forfait {plan} se termine le {date}. Le changement de forfait y mettra fin. Confirmez le changement pour continuer.",
        "apiRefusals.billingConfirmPrepaidConversionCredit" to
            "Votre année prépayée au forfait {plan} se termine le {date}. Confirmez le changement pour y mettre fin et appliquer un crédit de {credit} à vos prochaines factures.",
        "apiRefusals.billingDowngradeMemberLimit" to
            "Le forfait Starter permet {seats} membres. Désactivez les membres excédentaires avant de changer de forfait.",
        "apiRefusals.billingDowngradeSeatLimit" to
            "Le forfait Starter permet {seats} places. Révoquez des invitations ou retirez des membres avant de changer de forfait.",
        "apiRefusals.billingInvalidModuleRequest" to
            "Indiquez le nom de l’option et si vous voulez l’activer.",
        "apiRefusals.billingInvalidNumberId" to
            "Indiquez un identifiant de numéro de téléphone valide.",
        "apiRefusals.billingInvalidPlan" to
            "Choisissez le forfait Starter ou Pro.",
        "apiRefusals.billingModuleUnavailable" to
            "L’option {module} n’est pas encore disponible.",
        "apiRefusals.billingNumberChangeRetry" to
            "Une autre modification de vos numéros est en cours. Réessayez dans un instant.",
        "apiRefusals.billingPauseFixPayment" to
            "Mettez à jour votre mode de paiement avant de mettre votre forfait en pause.",
        "apiRefusals.billingPauseMayTakeTime" to
            "Votre forfait n’est pas encore en pause. Si vous l’avez repris aujourd’hui, réessayez demain. La mise en pause ne vous sera pas facturée deux fois.",
        "apiRefusals.billingPausePrepaid" to
            "Vous avez déjà payé pour un an, jusqu’au {date}. Une mise en pause utiliserait les mois déjà payés pour garder votre ligne.",
        "apiRefusals.billingPausePrepaidContact" to
            "Votre année prépayée est toujours en cours. Communiquez avec nous avant de mettre votre forfait en pause.",
        "apiRefusals.billingPauseSubscribeFirst" to
            "Abonnez-vous avant de mettre un forfait en pause.",
        "apiRefusals.billingPauseUnavailable" to
            "La mise en pause n’est pas disponible pour le moment.",
        "apiRefusals.billingPauseWaitForPlanChange" to
            "Attendez que le changement de forfait prévu entre en vigueur avant de le mettre en pause.",
        "apiRefusals.billingPauseWaitForReferral" to
            "Vous avez un mois gratuit de recommandation sur votre prochaine facture. Attendez qu’il soit appliqué avant de mettre votre forfait en pause.",
        "apiRefusals.billingPrepaidCurrencyMismatch" to
            "Votre année prépayée a été payée en {paid} et votre espace de travail est facturé en {current}. Communiquez avec nous pour appliquer le crédit inutilisé.",
        "apiRefusals.billingPrepaidPlanLocked" to
            "Votre année prépayée est toujours en cours. Communiquez avec nous avant de changer de forfait.",
        "apiRefusals.billingPrepayActivateFirst" to
            "Envoyez votre premier texto avant de payer pour un an.",
        "apiRefusals.billingPrepayAlreadyPaid" to
            "Vous avez déjà payé pour un an. La période prépayée se termine le {date}.",
        "apiRefusals.billingPrepayFixPayment" to
            "Mettez à jour votre mode de paiement avant de payer pour un an.",
        "apiRefusals.billingPrepaySubscribeFirst" to
            "Abonnez-vous avant de payer pour un an.",
        "apiRefusals.billingPrepayUnavailable" to
            "Le paiement à l’avance pour un an n’est pas disponible pour le moment.",
        "apiRefusals.billingPrepayWaitForPlanChange" to
            "Attendez que le changement de forfait prévu entre en vigueur avant de payer pour un an.",
        "apiRefusals.billingPrepayWaitForReferral" to
            "Vous avez un mois gratuit de recommandation sur votre prochaine facture. Attendez qu’il soit appliqué avant de payer pour un an.",
        "apiRefusals.billingRestoreNumberLimit" to
            "Le forfait Starter permet jusqu’à {count} numéros. Passez à Pro pour récupérer celui-ci.",
        "apiRefusals.billingRestoreWaitForNumberSetup" to
            "Un autre numéro est toujours en cours de configuration. Réessayez de récupérer ce numéro après la configuration.",
        "apiRefusals.billingRestoreWaitForPlanChange" to
            "Récupérez ce numéro une fois le changement de forfait prévu en vigueur.",
        "apiRefusals.billingResubscribeForAddOns" to
            "Votre abonnement est annulé. Réabonnez-vous pour modifier vos options.",
        "apiRefusals.billingResumeBeforeAddingModule" to
            "Reprenez votre forfait avant d’activer l’option {module}. Vous pourrez choisir sa date de facturation.",
        "apiRefusals.billingResumeBeforeChanging" to
            "Reprenez votre forfait avant de le modifier. Vous pourrez ainsi choisir la date d’entrée en vigueur du nouveau tarif.",
        "apiRefusals.billingResumeMayTakeTime" to
            "Votre forfait n’est pas encore réactivé. Réessayez dans une minute. La reprise ne vous sera pas facturée deux fois.",
        "apiRefusals.billingResumeUnavailable" to
            "La reprise du forfait n’est pas disponible pour le moment.",
        "apiRefusals.billingResumeWaitForPlanChange" to
            "Reprenez votre forfait une fois le changement prévu en vigueur.",
        "apiRefusals.billingSessionRequired" to
            "Indiquez l’identifiant de la session de paiement.",
        "apiRefusals.billingSubscriptionChanged" to
            "Votre abonnement vient de changer. Actualisez la page Facturation et réessayez.",
        "apiRefusals.billingUnknownModule" to
            "Option inconnue : {module}.",
        "apiRefusals.extraNumberPlanLimit" to
            "Vérifiez votre forfait et sa limite de numéros avant d’en ajouter un autre.",
        "apiRefusals.numberBillingChangedRetry" to
            "La facturation vient d’être mise à jour. Réessayez d’ajouter le numéro.",
        "apiRefusals.numberCheckNewPurchase" to
            "Un autre numéro vient d’être ajouté. Vérifiez Paramètres › Numéros avant de réessayer.",
        "apiRefusals.numberDocumentFileRequired" to
            "Joignez un fichier au champ {field}.",
        "apiRefusals.numberDocumentSize" to
            "Téléversez un fichier non vide de moins de {limit} Mo pour le champ {field}.",
        "apiRefusals.numberInvalidBusinessHours" to
            "Entrez les heures d’ouverture et de fermeture au format HH:MM pour les jours de mon à sun.",
        "apiRefusals.numberInvalidClosedDates" to
            "Entrez des dates de début et de fin au format AAAA-MM-JJ pour chaque fermeture. La fin doit suivre le début ou tomber le même jour. Les heures, si précisées, sont au format HH:MM.",
        "apiRefusals.numberInvalidTimezone" to
            "Entrez un fuseau horaire IANA valide, comme America/Toronto.",
        "apiRefusals.numberLocalCountryRequired" to
            "Choisissez un numéro local dans le pays {country}.",
        "apiRefusals.numberMembersMustBeActive" to
            "Chaque personne doit être membre actif de cet espace de travail.",
        "apiRefusals.numberNotAwaitingSetup" to
            "Ce numéro n’est pas en attente de configuration.",
        "apiRefusals.numberOrderStillRunning" to
            "Une commande précédente est en cours de traitement. Réessayez dans une minute.",
        "apiRefusals.numberPurchaseInProgress" to
            "Un autre achat de numéro vient d’aboutir. Réessayez dans un instant.",
        "apiRefusals.numberSetupLimit" to
            "Vous avez configuré plusieurs nouveaux numéros pour ce compte. Communiquez avec le soutien pour en ajouter un autre.",
        "apiRefusals.numberSetupUnavailable" to
            "Ce numéro ne peut pas être configuré de cette façon.",
        "apiRefusals.numberWaitForPlanChange" to
            "Un changement de forfait est prévu. Ajoutez le numéro une fois ce changement en vigueur.",
        "apiRefusals.portCannotCancel" to
            "Ce transfert ne peut plus être annulé.",
        "apiRefusals.portCannotEdit" to
            "Ce transfert ne peut plus être modifié.",
        "apiRefusals.portCannotSubmit" to
            "Ce transfert ne peut pas être soumis dans son état actuel.",
        "apiRefusals.portCarrierRefused" to
            "Le fournisseur indique que ce numéro ne peut pas être transféré.",
        "apiRefusals.portDocumentType" to
            "Téléversez un fichier PDF, PNG ou JPEG pour le champ {field}.",
        "apiRefusals.portNeedsFreeNumberSlot" to
            "Votre forfait permet {count} numéros. Libérez-en un ou changez de forfait avant d’en transférer un.",
        "apiRefusals.portNumberIneligible" to
            "Entrez un numéro local admissible du Canada ou des États-Unis.",
        "apiRefusals.portResubmitUnavailable" to
            "La demande de transfert n’a pas pu être soumise de nouveau. Vérifiez son état avant de réessayer.",
        "apiRefusals.portTollFreeUnsupported" to
            "Les numéros sans frais ne peuvent pas être transférés de cette façon. Choisissez un nouveau numéro local.",
        "apiRefusals.portUploadDocumentRequired" to
            "Joignez la lettre d’autorisation ou une facture récente.",
        "apiRefusals.portUploadForm" to
            "Utilisez multipart/form-data pour téléverser la lettre d’autorisation ou une facture récente.",
        "apiRefusals.teamCannotLeave" to
            "Vous ne pouvez pas quitter cet espace de travail.",
        "apiRefusals.teamHandoffRequiresActiveMember" to
            "Assignez le travail à un membre actif de l’équipe ou laissez-le sans responsable.",
        "apiRefusals.teamInviteSeatLimit" to
            "Le forfait {plan} permet {seats} places. Cet espace de travail compte {active} membres actifs et {pending} invitations en attente.",
        "apiRefusals.teamSeatLimit" to
            "Le forfait {plan} permet {seats} places.",
        "apiRefusals.textEnablementCannotCancel" to
            "Cette demande ne peut plus être annulée.",
        "apiRefusals.textEnablementCannotResubmit" to
            "Vous pouvez soumettre de nouveau une demande qui a échoué ou qui nécessite une action.",
        "apiRefusals.textEnablementCannotUpload" to
            "Vous ne pouvez plus téléverser de documents pour cette demande.",
        "apiRefusals.textEnablementCannotVerify" to
            "La vérification de propriété ne s’applique plus à cette demande.",
        "apiRefusals.textEnablementCodeSendFailed" to
            "Le code de vérification n’a pas pu être envoyé. Réessayez ou choisissez une autre méthode.",
        "apiRefusals.textEnablementDocumentType" to
            "Téléversez un PDF pour le champ {field}.",
        "apiRefusals.textEnablementNeedsFreeSlot" to
            "Votre forfait permet {count} numéros. Libérez-en un ou changez de forfait avant d’activer les textos sur un autre numéro.",
        "apiRefusals.textEnablementUploadDocumentRequired" to
            "Joignez la lettre d’autorisation ou une facture.",
        "apiRefusals.textEnablementUploadForm" to
            "Utilisez multipart/form-data pour téléverser la lettre d’autorisation ou une facture.",
        "apiRefusals.workspaceNumberCountry" to
            "Ce numéro provient du pays {numberCountry}. Votre espace de travail est inscrit dans le pays {workspaceCountry}.",
        "apiRefusals.billingAccountRequired" to
            "Terminez le paiement initial pour créer votre compte de facturation.",
        "apiRefusals.billingDowngradeReleaseNumber" to
            "Libérez votre numéro supplémentaire avant de passer au forfait Starter.",
        "apiRefusals.billingNoSubscriptionToResume" to
            "Il n’y a aucun abonnement à reprendre.",
        "apiRefusals.billingPlanChangeApplied" to
            "Le changement de forfait est déjà en vigueur. Actualisez la page Facturation.",
        "apiRefusals.billingPlanNotPaused" to
            "Votre forfait est déjà actif.",
        "apiRefusals.billingResubscribeToChange" to
            "Votre abonnement est annulé. Réabonnez-vous pour changer de forfait.",
        "apiRefusals.billingStartBeforeRestoringNumber" to
            "Réactivez votre abonnement pour récupérer ce numéro.",
        "apiRefusals.billingSubscriptionRequired" to
            "Terminez le paiement initial pour activer votre abonnement avant de changer de forfait.",
        "apiRefusals.extraNumberUnavailable" to
            "Les numéros supplémentaires ne sont pas encore disponibles. Communiquez avec le soutien.",
        "apiRefusals.idempotencyKeyRequired" to
            "L’en-tête Idempotency-Key doit contenir un UUID généré par le client.",
        "apiRefusals.numberAlreadyReleased" to
            "Ce numéro a déjà été libéré.",
        "apiRefusals.numberRetryInProgress" to
            "Une nouvelle tentative est déjà en cours.",
        "apiRefusals.portDocumentsRequired" to
            "Téléversez la lettre d’autorisation signée et une facture récente avant de soumettre le transfert.",
        "apiRefusals.portResubmitDocumentsRequired" to
            "Téléversez la lettre d’autorisation signée et une facture récente avant de soumettre de nouveau le transfert.",
        "apiRefusals.portResubmitNeedsFix" to
            "Vous pouvez soumettre de nouveau un transfert qui nécessite une correction.",
        "apiRefusals.portWirelessPinRequired" to
            "Pour transférer ce numéro mobile, entrez le NIP de transfert fourni par votre fournisseur actuel.",
        "apiRefusals.scheduledPlanNumberLimit" to
            "Le forfait prévu ne permet pas d’ajouter un autre numéro.",
        "apiRefusals.soleProprietorNumberLimit" to
            "L’inscription comme entreprise individuelle permet un seul numéro.",
        "apiRefusals.teamAlreadyMember" to
            "Cette personne est déjà membre de cet espace de travail.",
        "apiRefusals.teamInviteNoLongerValid" to
            "Cette invitation a été acceptée ou révoquée, ou elle a expiré.",
        "apiRefusals.teamInvitePlanChanged" to
            "Votre forfait a changé. Réessayez d’envoyer l’invitation.",
        "apiRefusals.teamInviteScheduledSeatLimit" to
            "Cet espace de travail a atteint la limite de places du forfait prévu.",
        "apiRefusals.teamOwnerCannotDeactivate" to
            "Le compte du propriétaire ne peut pas être désactivé.",
        "apiRefusals.teamOwnerCannotLeave" to
            "Un propriétaire ne peut pas quitter son espace de travail. Fermez l’espace dans les paramètres ou écrivez-nous pour transférer la propriété.",
        "apiRefusals.teamOwnerRoleFixed" to
            "Le rôle du propriétaire ne peut pas être modifié.",
        "apiRefusals.textEnablementResubmitLimit" to
            "Vous avez atteint la limite de soumissions pour cette demande. Annulez-la et recommencez, ou communiquez avec le soutien.",
        "apiRefusals.textEnablementUnsupportedNumber" to
            "L’activation des textos est offerte pour les numéros locaux admissibles du Canada et des États-Unis.",
        "apiRefusals.textEnablementVerificationLimit" to
            "Vous avez atteint la limite de tentatives de vérification. Annulez la demande et recommencez, ou communiquez avec le soutien.",
        "apiRefusals.textEnablementVerificationUnavailable" to
            "Attendez la création de la demande d’activation des textos avant de vérifier le numéro.",
        "apiRefusals.areaCodeCountryMismatch" to
            "Choisissez un indicatif régional du pays où votre espace de travail est enregistré ({country}).",
        "apiRefusals.areaCodeNotAssigned" to
            "Choisissez un indicatif régional géographique attribué au Canada ou aux États-Unis.",
        "apiRefusals.billingAlreadySubscribed" to
            "Cet espace de travail a déjà un abonnement.",
        "apiRefusals.carrierOptOutNeedsStart" to
            "Ce client a texté STOP. Son fournisseur bloque vos textos. Seul le client peut lever ce blocage en textant START à votre numéro.",
        "apiRefusals.contactNotFound" to "Ce contact est introuvable.",
        "apiRefusals.contactNumberNotFound" to
            "Ce numéro ne figure pas dans cette fiche de contact.",
        "apiRefusals.contactUnmergeMainNumberInUse" to
            "Choisissez un autre numéro principal avant d’annuler la fusion.",
        "apiRefusals.conversationNotFound" to "Cette conversation est introuvable.",
        "apiRefusals.idempotencyKeyLength" to "L’en-tête Idempotency-Key doit contenir de 1 à 255 caractères.",
        "apiRefusals.billingCheckoutTextingRequired" to
            "Fournissez les renseignements sur vos textos vers les États-Unis avant de passer au paiement.",
        "apiRefusals.inviteAlreadyPending" to
            "Une invitation à cette adresse courriel est déjà en attente.",
        "apiRefusals.numberCountryMismatch" to
            "Choisissez un numéro du pays où votre espace de travail est enregistré ({country}).",
        "apiRefusals.privateLinkRetryUnavailable" to "Envoyez un nouveau lien privé à ce client.",
        "apiRefusals.quoteTextRetry" to "Le texto du devis a échoué. Réessayez dans la conversation.",
        "apiRefusals.quoteNotFound" to "Devis introuvable.",
        "apiRefusals.quoteExpiryFuture" to "Choisissez une date d’expiration future pour ce devis.",
        "apiRefusals.quoteDraftLocked" to "Ce brouillon de devis ne peut plus être modifié.",
        "apiRefusals.quoteDeclineUnavailable" to "Ce devis ne peut plus être refusé.",
        "apiRefusals.quoteUndoUnavailable" to "Ce devis ne peut plus être rouvert.",
        "apiRefusals.quoteWithdrawalUnavailable" to "Ce devis ne peut plus être retiré.",
        "apiRefusals.numberNotAssigned" to
            "Choisissez un numéro géographique attribué au Canada ou aux États-Unis.",
        "apiRefusals.optOutNotActive" to "Ce numéro ne figure pas dans la liste de désabonnement.",
        "apiRefusals.outboundDestination" to
            "Utilisez un numéro américain ou canadien, ou un numéro sans frais pris en charge.",
        "apiRefusals.outboundLocalTextDestination" to
            "Ce texto ne peut être envoyé qu’à un numéro américain ou canadien admissible.",
        "apiRefusals.outboundSendPaused" to
            "L’envoi de textos est suspendu pendant que nous réglons un problème. Vos textos ont été conservés.",
        "apiRefusals.paymentsNotSetUp" to
            "Les paiements ne sont pas encore configurés dans cet espace de travail.",
        "apiRefusals.portAlreadyPending" to
            "Un transfert est déjà en cours pour ce numéro.",
        "apiRefusals.publicTaskInvalidRepeat" to "La règle de récurrence n’est pas valide.",
        "apiRefusals.publicTaskInvalidRepeatField" to
            "La règle de récurrence est invalide pour le champ {field}.",
        "apiRefusals.publicTaskRepeatNeedsDueDate" to
            "Choisissez une date d’échéance pour démarrer la récurrence.",
        "apiRefusals.publicTaskUnknownTag" to "Cette étiquette est introuvable dans cet espace de travail.",
        "apiRefusals.remindersNeedCustomer" to "Associez une conversation avec un client pour activer les rappels.",
        "apiRefusals.bookingNotFound" to "Cette tâche est introuvable.",
        "apiRefusals.dispatchStale" to "Le plan a changé. Rechargez l’horaire et vérifiez vos modifications.",
        "apiRefusals.dispatchLocked" to "Replanifiez explicitement le rendez-vous verrouillé avant de le déplacer.",
        "apiRefusals.dispatchOverlap" to "Cette personne a déjà du travail prévu à ce moment-là.",
        "apiRefusals.dispatchWindow" to "Le travail est en dehors des disponibilités du client.",
        "apiRefusals.dispatchTravel" to "Ce plan prévoit trop peu de temps de déplacement entre les visites.",
        "apiRefusals.taskSourceRequired" to "Choisissez un texto ou un appel comme source de la tâche.",
        "apiRefusals.dispatchAddress" to "Confirmez l’adresse de service avant de planifier la visite.",
        "apiRefusals.dispatchHours" to "Choisissez une heure dans la journée et les heures disponibles.",
        "apiRefusals.dispatchShift" to "Indiquez les heures de début et de fin du quart, puis des pauses sans chevauchement comprises dans ce quart.",
        "apiRefusals.dispatchDuration" to "Utilisez une durée de 5 minutes à 12 heures.",
        "apiRefusals.dispatchAssignee" to "Choisissez un collègue actif qui peut ouvrir cette tâche.",
        "apiRefusals.bookingSourceCustomer" to "Une tâche créée à partir d’un texto ou d’un appel conserve son client.",
        "apiRefusals.bookingCustomerUnavailable" to "Choisissez un client ou une conversation disponible.",
        "apiRefusals.bookingConfirmationNeedsDate" to "Fixez une date pour cette tâche ouverte avant de la confirmer.",
        "apiRefusals.bookingDuePrecision" to "Indiquez une heure ou une date pour cette tâche.",
        "apiRefusals.remindersWorkspaceNotFound" to "Cet espace de travail est introuvable.",
        "apiRefusals.scheduledTextHorizon" to "Vous pouvez planifier un texto jusqu’à {days} jours à l’avance.",
        "apiRefusals.scheduledTextKeyUsed" to
            "Cet en-tête Idempotency-Key a déjà servi à programmer un autre texto.",
        "apiRefusals.taskCreateKeyUsed" to "Cet en-tête Idempotency-Key a déjà servi à créer une tâche.",
        "apiRefusals.registrationChanged" to
            "L’inscription a changé. Actualisez la page avant de la modifier.",
        "apiRefusals.registrationCheckoutRequired" to
            "Terminez le paiement avant de saisir les renseignements sur votre entreprise.",
        "apiRefusals.registrationSubmissionInProgress" to
            "La demande d’inscription est en cours d’envoi. Actualisez la page avant de la modifier.",
        "apiRefusals.textEnablementAlreadyPending" to
            "L’activation des textos est déjà en cours pour ce numéro.",
        "apiRefusals.textEnablementNumberInUse" to
            "Ce numéro est déjà en service sur Loonext. Vous ne pouvez pas y activer les textos de cette façon.",
        "apiRefusals.textEnablementWrongCode" to
            "Ce code ne correspond pas. Demandez un nouveau code, puis réessayez.",
        "apiRefusals.contactImportInvalidCustomFields" to
            "Les champs personnalisés doivent être dans un objet JSON contenant des valeurs textuelles.",
        "apiRefusals.contactImportTooManyOtherNumbers" to
            "La ligne {row} contient plus de {limit} autres numéros de téléphone.",
        "apiRefusals.exportFileNotFound" to
            "Ce fichier d’exportation est introuvable.",
        "apiRefusals.exportFileSizeUnavailable" to
            "Impossible de lire la taille de ce fichier. Réessayez plus tard.",
        "apiRefusals.noActiveSendingNumber" to
            "Il n’y a aucun numéro actif pour envoyer ce texto.",
        "apiRefusals.workspaceExportNotReady" to
            "Aucune exportation prête ne correspond à cet identifiant.",
        "apiErrors.unauthorized" to "Vous êtes déconnecté. Reconnectez-vous pour continuer.",
        "apiErrors.forbidden" to "Vous n'avez pas accès à cela.",
        "apiErrors.subscription_inactive" to "Votre abonnement n'est pas actif.",
        "apiErrors.sending_suspended" to
            "L'envoi est suspendu pour cet espace de travail. Écrivez-nous et nous réglerons cela.",
        "apiErrors.workspace_paused" to
            "Votre forfait est en pause. Reprenez-le dans la facturation pour continuer.",
        "apiErrors.usage_cap_reached" to
            "Vous avez atteint une limite de dépenses pour cette période.",
        "apiErrors.registration_pending" to "Votre inscription pour les textos est encore à l'étude.",
        "apiErrors.recipient_opted_out" to "Cette personne nous a demandé de ne plus lui écrire.",
        "apiErrors.unsupported_service_code" to "Composez ce numéro sur votre téléphone.",
        "apiErrors.validation_failed" to
            "Quelque chose ne va pas dans cette demande. Vérifiez les détails et réessayez.",
        "apiErrors.not_found" to "Nous n'avons pas trouvé cela.",
        "apiErrors.conflict" to
            "Impossible dans l'état actuel. Actualisez et regardez de nouveau.",
        "apiErrors.quiet_hours_confirmation_required" to
            "C'est une heure de tranquillité chez cette personne. Confirmez pour envoyer quand même.",
        "apiErrors.mfa_required" to "La vérification en deux étapes est requise d'abord.",
        "apiErrors.mfa_challenge_required" to "Confirmez votre identité pour continuer.",
        "apiErrors.confirmation_code_required" to "Entrez le code de confirmation pour continuer.",
        "apiErrors.mfa_reprove_required" to "Confirmez de nouveau votre identité pour continuer.",
        "apiErrors.rate_limited" to "Trop de tentatives. Attendez une minute et réessayez.",
        "apiErrors.service_unavailable" to "C'est occupé en ce moment. Réessayez dans un instant.",
        "apiErrors.internal_error" to
            "Une erreur s'est produite de notre côté. Réessayez dans un instant.",
        "apiErrors.contactImportUndeclaredColumnsOne" to
            "La colonne {columns} du fichier n’a pas été déclarée. Cette importation ne devine jamais le sens d’une colonne, car traiter une colonne d’interdiction de textos comme vide pourrait envoyer un message à une personne désabonnée. Chaque colonne du fichier ({total} au total) doit être associée à un champ ou explicitement ignorée. Envoyez une valeur `{field}` par colonne au format `<index>:<field ou {ignore}>:<header>`. Aucune donnée n’a été importée.",
        "apiErrors.contactImportUndeclaredColumnsMany" to
            "Les colonnes {columns} du fichier n’ont pas été déclarées. Cette importation ne devine jamais le sens d’une colonne, car traiter une colonne d’interdiction de textos comme vide pourrait envoyer un message à une personne désabonnée. Chaque colonne du fichier ({total} au total) doit être associée à un champ ou explicitement ignorée. Envoyez une valeur `{field}` par colonne au format `<index>:<field ou {ignore}>:<header>`. Aucune donnée n’a été importée.",
        "apiErrors.contactImportUndeclaredPropertiesOne" to
            "{properties} est une propriété vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez pour cette propriété une valeur `{field}` au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
        "apiErrors.contactImportUndeclaredPropertiesMany" to
            "{properties} sont des propriétés vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez une valeur `{field}` par propriété au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
        "apiErrors.contactImportUndeclaredPropertiesCapped" to
            "{properties}, ainsi que {more} autres, sont des propriétés vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez une valeur `{field}` par propriété au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
        "apiErrors.contactImportUnreadableFlag" to
            "La colonne d’interdiction de textos « {header} » contient des valeurs que cette importation ne peut pas interpréter comme oui ou non : {values}. Utilisez true/false (yes/no, 1/0 ou x sur les lignes à bloquer), puis recommencez l’importation. Aucune donnée n’a été importée.",
        "apiErrors.contactImportUnreadableFlagCapped" to
            "La colonne d’interdiction de textos « {header} » contient des valeurs que cette importation ne peut pas interpréter comme oui ou non : {values}, ainsi que {more} autres. Utilisez true/false (yes/no, 1/0 ou x sur les lignes à bloquer), puis recommencez l’importation. Aucune donnée n’a été importée.",
        "apiErrors.selfDowngradeAcknowledgementRequired" to
            "Confirmez que vous comprenez ce que vous perdrez avant de modifier votre propre rôle.",
        "apiErrors.withReference" to "{message} Référence {id}.",
    )
}
