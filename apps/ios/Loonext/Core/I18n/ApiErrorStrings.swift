import Foundation

/// #228 — what a refusal from the server says to somebody who does not read
/// English.
///
/// Hand-port of `apps/web/src/i18n/sections/apiErrors.ts`, and the reasoning
/// lives there in full. The short version, because it is the part somebody
/// would reasonably undo:
///
/// The API composes one English sentence per call site — 370 of them — and all
/// three clients render it exactly as it arrived. That stays for an English
/// reader: "No such API key" is specific in a way no per-code sentence can be.
///
/// It is the wrong default for the reader this issue exists for. The comparison
/// is not against that sentence as READ but as MET by somebody who does not
/// read English, which carries nothing but the fact that something failed. A
/// correct generic sentence in their own language is less specific and strictly
/// more informative — so this only ever replaces a sentence the reader could
/// not use.
///
/// The key set is held equal to web's and Android's, in both directions, by
/// `packages/shared/src/api-error-vocabulary-parity.test.ts`. A code added to
/// `packages/shared/src/error-codes.ts` and missed here would resolve to its
/// own name on screen, which is worse than the English it replaced.
enum ApiErrorStrings {
    static let section = AppStrings.Section(
        name: "ApiErrorStrings",
        en: [
            "apiRefusals.areaCodeChooseCountry":
                "Area code {areaCode} does not match the selected country ({country}).",
            "apiRefusals.billingAddOnsRequireSubscription":
                "Complete checkout before changing add-ons.",
            "apiRefusals.billingAlreadyOnPlan":
                "You’re already on the {plan} plan.",
            "apiRefusals.billingAlreadyPaused":
                "Your plan is already paused.",
            "apiRefusals.billingCallingIncluded":
                "Calling is included on every plan. Refresh the app to see your current plan.",
            "apiRefusals.billingCheckoutSeatLimit":
                "The {plan} plan allows {seats} members. Your workspace has {members}. Deactivate {over} before checking out.",
            "apiRefusals.billingConfirmPrepaidConversion":
                "Your prepaid year of {plan} runs through {date}. Switching plans ends it. Confirm the change to continue.",
            "apiRefusals.billingConfirmPrepaidConversionCredit":
                "Your prepaid year of {plan} runs through {date}. Confirm the change to end it and apply {credit} to your next invoices.",
            "apiRefusals.billingDowngradeMemberLimit":
                "Starter allows {seats} members. Deactivate extra members before downgrading.",
            "apiRefusals.billingDowngradeSeatLimit":
                "Starter allows {seats} seats. Revoke extra invites or remove members before downgrading.",
            "apiRefusals.billingInvalidModuleRequest":
                "Provide the add-on name and whether you want to enable it.",
            "apiRefusals.billingInvalidNumberId":
                "Provide a valid phone number ID.",
            "apiRefusals.billingInvalidPlan":
                "Choose the Starter or Pro plan.",
            "apiRefusals.billingModuleUnavailable":
                "The {module} add-on isn't available yet.",
            "apiRefusals.billingNumberChangeRetry":
                "Another change to your numbers is being processed. Try again in a moment.",
            "apiRefusals.billingPauseFixPayment":
                "Sort out your payment method first, then you can pause.",
            "apiRefusals.billingPauseMayTakeTime":
                "Your plan hasn’t paused yet. If you resumed today, try again tomorrow. You won’t be charged twice for pausing.",
            "apiRefusals.billingPausePrepaid":
                "You have already paid for a year, through {date}. Pausing would put those months toward the hold.",
            "apiRefusals.billingPausePrepaidContact":
                "Your prepaid year is still active. Contact us before pausing.",
            "apiRefusals.billingPauseSubscribeFirst":
                "Subscribe before putting a plan on hold.",
            "apiRefusals.billingPauseUnavailable":
                "Pausing isn't available right now.",
            "apiRefusals.billingPauseWaitForPlanChange":
                "Wait for your scheduled plan change before pausing.",
            "apiRefusals.billingPauseWaitForReferral":
                "You have a free referral month on your next bill. Wait for it to apply before pausing.",
            "apiRefusals.billingPrepaidCurrencyMismatch":
                "Your prepaid year was paid in {paid}. Your workspace is billed in {current}. Contact us to apply the unused credit.",
            "apiRefusals.billingPrepaidPlanLocked":
                "Your prepaid year is still active. Contact us before switching plans.",
            "apiRefusals.billingPrepayActivateFirst":
                "Send your first message first, then you can pay for a year up front.",
            "apiRefusals.billingPrepayAlreadyPaid":
                "You have already paid for a year. It runs until {date}.",
            "apiRefusals.billingPrepayFixPayment":
                "Sort out your payment method before paying for a year up front.",
            "apiRefusals.billingPrepaySubscribeFirst":
                "Subscribe before paying for a year up front.",
            "apiRefusals.billingPrepayUnavailable":
                "Paying for a year up front isn't available right now.",
            "apiRefusals.billingPrepayWaitForPlanChange":
                "Wait for your scheduled plan change before paying for a year up front.",
            "apiRefusals.billingPrepayWaitForReferral":
                "You have a free referral month on your next bill. Wait for it to apply before paying for a year.",
            "apiRefusals.billingRestoreNumberLimit":
                "Starter allows up to {count} numbers. Switch to Pro to restore this one.",
            "apiRefusals.billingRestoreWaitForNumberSetup":
                "Another number is still being set up. Try restoring this number once setup finishes.",
            "apiRefusals.billingRestoreWaitForPlanChange":
                "Restore this number after the scheduled plan change takes effect.",
            "apiRefusals.billingResubscribeForAddOns":
                "Your subscription is cancelled. Resubscribe to change add-ons.",
            "apiRefusals.billingResumeBeforeAddingModule":
                "Resume your plan before turning on {module}. Choose when the add-on starts billing.",
            "apiRefusals.billingResumeBeforeChanging":
                "Resume your plan before changing it. This lets you choose when the new rate starts.",
            "apiRefusals.billingResumeMayTakeTime":
                "Your plan hasn’t resumed yet. Try again in a minute. You won’t be charged twice for resuming.",
            "apiRefusals.billingResumeUnavailable":
                "Resuming isn't available right now.",
            "apiRefusals.billingResumeWaitForPlanChange":
                "Resume after your scheduled plan change takes effect.",
            "apiRefusals.billingSessionRequired":
                "Provide a checkout session ID.",
            "apiRefusals.billingSubscriptionChanged":
                "Your subscription just changed. Refresh Billing and try again.",
            "apiRefusals.billingUnknownModule":
                "Unknown add-on: {module}.",
            "apiRefusals.extraNumberPlanLimit":
                "Check the plan and its number limit before adding another number.",
            "apiRefusals.numberBillingChangedRetry":
                "Billing was just updated. Try adding the number again.",
            "apiRefusals.numberCheckNewPurchase":
                "Another number was just added. Check Settings › Numbers before trying again.",
            "apiRefusals.numberDocumentFileRequired":
                "Attach a file for {field}.",
            "apiRefusals.numberDocumentSize":
                "Upload a non-empty file under {limit} MB for {field}.",
            "apiRefusals.numberInvalidBusinessHours":
                "Enter opening and closing times in HH:MM for weekdays mon through sun.",
            "apiRefusals.numberInvalidClosedDates":
                "Enter a start and end date in YYYY-MM-DD for each closure. The end date must be on or after the start date. Hours, if supplied, use HH:MM.",
            "apiRefusals.numberInvalidTimezone":
                "Enter a valid IANA time zone such as America/Toronto.",
            "apiRefusals.numberLocalCountryRequired":
                "Choose a local number in {country}.",
            "apiRefusals.numberMembersMustBeActive":
                "Every person must be an active member of this workspace.",
            "apiRefusals.numberNotAwaitingSetup":
                "This number isn't waiting to be set up.",
            "apiRefusals.numberOrderStillRunning":
                "We're finishing an earlier order. Try choosing again in a minute.",
            "apiRefusals.numberPurchaseInProgress":
                "Another number purchase just went through. Try again in a moment.",
            "apiRefusals.numberSetupLimit":
                "You've set up new numbers many times on this account. Contact support to add another.",
            "apiRefusals.numberSetupUnavailable":
                "This number can't be set up this way.",
            "apiRefusals.numberWaitForPlanChange":
                "A plan change is scheduled. Add the number after it takes effect.",
            "apiRefusals.portCannotCancel":
                "This transfer can no longer be cancelled.",
            "apiRefusals.portCannotEdit":
                "This transfer can no longer be edited.",
            "apiRefusals.portCannotSubmit":
                "This transfer cannot be submitted in its current state.",
            "apiRefusals.portCarrierRefused":
                "The carrier says this number cannot be transferred.",
            "apiRefusals.portDocumentType":
                "Upload a PDF, PNG, or JPEG for {field}.",
            "apiRefusals.portNeedsFreeNumberSlot":
                "Your plan has room for {count} numbers. Release one or upgrade before transferring a number.",
            "apiRefusals.portNumberIneligible":
                "Enter an eligible US or Canadian local number.",
            "apiRefusals.portResubmitUnavailable":
                "This transfer could not be resubmitted. Check its status before trying again.",
            "apiRefusals.portTollFreeUnsupported":
                "Toll-free numbers can't be transferred in this flow. Start with a new local number instead.",
            "apiRefusals.portUploadDocumentRequired":
                "Attach the letter of authorization or a recent bill.",
            "apiRefusals.portUploadForm":
                "Use multipart/form-data to upload the letter of authorization or a recent bill.",
            "apiRefusals.teamCannotLeave":
                "You can't leave this workspace.",
            "apiRefusals.teamHandoffRequiresActiveMember":
                "Assign the work to an active team member or leave it unassigned.",
            "apiRefusals.teamInviteSeatLimit":
                "The {plan} plan allows {seats} seats. This workspace has {active} active members and {pending} pending invitations.",
            "apiRefusals.teamSeatLimit":
                "The {plan} plan allows {seats} seats.",
            "apiRefusals.textEnablementCannotCancel":
                "This request can no longer be cancelled.",
            "apiRefusals.textEnablementCannotResubmit":
                "Only a request that failed or requires action can be resubmitted.",
            "apiRefusals.textEnablementCannotUpload":
                "Documents can no longer be uploaded to this request.",
            "apiRefusals.textEnablementCannotVerify":
                "Ownership verification no longer applies to this request.",
            "apiRefusals.textEnablementCodeSendFailed":
                "The verification code could not be sent. Try again or choose another method.",
            "apiRefusals.textEnablementDocumentType":
                "Upload a PDF for {field}.",
            "apiRefusals.textEnablementNeedsFreeSlot":
                "Your plan has room for {count} numbers. Release one or upgrade before enabling texting on another number.",
            "apiRefusals.textEnablementUploadDocumentRequired":
                "Attach the letter of authorization or a bill.",
            "apiRefusals.textEnablementUploadForm":
                "Use multipart/form-data to upload the letter of authorization or a bill.",
            "apiRefusals.workspaceNumberCountry":
                "The number is from {numberCountry}. Your workspace is registered in {workspaceCountry}.",
            "apiRefusals.billingAccountRequired":
                "No billing account yet — complete checkout first.",
            "apiRefusals.billingDowngradeReleaseNumber":
                "Release your extra phone number before downgrading to Starter.",
            "apiRefusals.billingNoSubscriptionToResume":
                "No subscription to resume.",
            "apiRefusals.billingPlanChangeApplied":
                "The plan change has already taken effect. Refresh Billing.",
            "apiRefusals.billingPlanNotPaused":
                "Your plan isn't paused.",
            "apiRefusals.billingResubscribeToChange":
                "Your subscription is canceled — resubscribe to change plans.",
            "apiRefusals.billingStartBeforeRestoringNumber":
                "Start your subscription again first — then you can bring this number back.",
            "apiRefusals.billingSubscriptionRequired":
                "No subscription to change — complete checkout first.",
            "apiRefusals.extraNumberUnavailable":
                "Extra numbers aren't available yet. Contact support.",
            "apiRefusals.idempotencyKeyRequired":
                "Idempotency-Key header (a client-generated UUID) is required.",
            "apiRefusals.numberAlreadyReleased":
                "This number is already released.",
            "apiRefusals.numberRetryInProgress":
                "A retry is already in progress.",
            "apiRefusals.portDocumentsRequired":
                "Upload the signed LOA and a recent bill before submitting the transfer.",
            "apiRefusals.portResubmitDocumentsRequired":
                "Upload the signed LOA and a recent bill before resubmitting the transfer.",
            "apiRefusals.portResubmitNeedsFix":
                "Only a port that needs a fix can be resubmitted.",
            "apiRefusals.portWirelessPinRequired":
                "This is a wireless number — the port-out PIN / passcode from your current carrier is required to transfer it.",
            "apiRefusals.scheduledPlanNumberLimit":
                "Your scheduled plan has no room for another phone number.",
            "apiRefusals.soleProprietorNumberLimit":
                "Sole Proprietor registration allows 1 phone number.",
            "apiRefusals.teamAlreadyMember":
                "Already a member of this company.",
            "apiRefusals.teamInviteNoLongerValid":
                "This invite is no longer valid (accepted, revoked, or expired).",
            "apiRefusals.teamInvitePlanChanged":
                "Your plan changed. Try the invite again.",
            "apiRefusals.teamInviteScheduledSeatLimit":
                "This workspace has reached the seat limit for its scheduled plan.",
            "apiRefusals.teamOwnerCannotDeactivate":
                "The owner cannot be deactivated.",
            "apiRefusals.teamOwnerCannotLeave":
                "An owner can't leave their own workspace. Close it in settings, or contact us to move it to someone else.",
            "apiRefusals.teamOwnerRoleFixed":
                "The owner role cannot be changed.",
            "apiRefusals.textEnablementResubmitLimit":
                "This order has been resubmitted too many times — cancel it and start again, or contact support.",
            "apiRefusals.textEnablementUnsupportedNumber":
                "This number isn't a US or Canadian local number we can text-enable.",
            "apiRefusals.textEnablementVerificationLimit":
                "Too many verification attempts for this order — cancel it and start again, or contact support.",
            "apiRefusals.textEnablementVerificationUnavailable":
                "The hosted-messaging order hasn't been created yet; verification isn't available until it exists.",
            "apiRefusals.areaCodeCountryMismatch":
                "requested_area_code must be a {country} area code (the company's country).",
            "apiRefusals.areaCodeNotAssigned":
                "requested_area_code is not an assigned US/CA geographic area code.",
            "apiRefusals.billingAlreadySubscribed":
                "This company already has a subscription.",
            "apiRefusals.carrierOptOutNeedsStart":
                "This customer texted STOP, so their carrier is blocking your texts. Only they can undo it, by texting START to your number.",
            "apiRefusals.contactNotFound": "No such contact.",
            "apiRefusals.contactNumberNotFound":
                "No such contact number.",
            "apiRefusals.contactUnmergeMainNumberInUse":
                "Choose a different main number before undoing this merge.",
            "apiRefusals.conversationNotFound": "No such conversation.",
            "apiRefusals.idempotencyKeyLength": "Idempotency-Key must contain 1 to 255 characters.",
            "apiRefusals.billingCheckoutTextingRequired":
                "Complete the US texting details before checkout.",
            "apiRefusals.inviteAlreadyPending":
                "A pending invite for this email already exists.",
            "apiRefusals.numberCountryMismatch":
                "chosen_number_e164 must be a {country} number (the company's country).",
            "apiRefusals.privateLinkRetryUnavailable": "Send a new private link to this customer.",
            "apiRefusals.quoteTextRetry": "The quote text failed. Retry it in the conversation.",
            "apiRefusals.quoteNotFound": "No such quote.",
            "apiRefusals.quoteExpiryFuture": "Choose a future expiry for this quote.",
            "apiRefusals.quoteDraftLocked": "This quote draft can no longer be changed.",
            "apiRefusals.quoteDeclineUnavailable": "This quote can no longer be declined.",
            "apiRefusals.quoteUndoUnavailable": "This quote can no longer be reopened.",
            "apiRefusals.quoteWithdrawalUnavailable": "This quote can no longer be withdrawn.",
            "apiRefusals.numberNotAssigned":
                "chosen_number_e164 is not an assigned US/CA geographic number.",
            "apiRefusals.optOutNotActive": "This number is not opted out.",
            "apiRefusals.outboundSendPaused":
                "Texting is paused while we deal with an issue. Nothing you sent was lost.",
            "apiRefusals.paymentsNotSetUp":
                "This workspace has not set up payments yet.",
            "apiRefusals.portAlreadyPending":
                "A transfer for this number is already in progress.",
            "apiRefusals.publicTaskInvalidRepeat": "repeat: not a valid rule.",
            "apiRefusals.publicTaskInvalidRepeatField": "repeat: {field}.",
            "apiRefusals.publicTaskRepeatNeedsDueDate": "repeat: a schedule needs a due date to start from.",
            "apiRefusals.publicTaskUnknownTag": "That tag is not in this workspace.",
            "apiRefusals.remindersNeedCustomer": "Link a customer conversation to turn on reminders.",
            "apiRefusals.bookingNotFound": "No such task.",
            "apiRefusals.bookingSourceCustomer": "A task created from a text or call keeps its customer.",
            "apiRefusals.bookingCustomerUnavailable": "Choose an available customer or conversation.",
            "apiRefusals.bookingConfirmationNeedsDate": "Set a date for this open job before confirming it.",
            "apiRefusals.bookingDuePrecision": "Provide a time or a date for this job.",
            "apiRefusals.remindersWorkspaceNotFound": "No such workspace.",
            "apiRefusals.scheduledTextHorizon": "We can hold a message for up to {days} days.",
            "apiRefusals.scheduledTextKeyUsed":
                "Idempotency-Key was already used for a different scheduled text.",
            "apiRefusals.taskCreateKeyUsed": "Idempotency-Key was already used for a task.",
            "apiRefusals.registrationChanged":
                "The registration changed. Refresh before editing it.",
            "apiRefusals.registrationCheckoutRequired":
                "Finish checkout before entering business details.",
            "apiRefusals.registrationSubmissionInProgress":
                "The registration is being submitted. Refresh before editing it.",
            "apiRefusals.textEnablementAlreadyPending":
                "This number already has a text-enablement in progress.",
            "apiRefusals.textEnablementNumberInUse":
                "This number is already in service on Loonext and can't be text-enabled.",
            "apiRefusals.textEnablementWrongCode":
                "That code didn't match. Request a new code and try again.",
            "apiRefusals.contactImportInvalidCustomFields":
                "Custom fields must be a JSON object of text values.",
            "apiRefusals.contactImportTooManyOtherNumbers":
                "Row {row} exceeds {limit} other phone numbers.",
            "apiRefusals.exportFileNotFound":
                "No such export file.",
            "apiRefusals.exportFileSizeUnavailable":
                "This file's size could not be read. Try again later.",
            "apiRefusals.noActiveSendingNumber":
                "There is no active number available to send from.",
            "apiRefusals.workspaceExportNotReady":
                "No ready workspace export with that ID.",
            "apiErrors.unauthorized": "You're signed out. Sign in again to carry on.",
            "apiErrors.forbidden": "You don't have access to that.",
            "apiErrors.subscription_inactive": "Your subscription isn't active.",
            // #303 — a person, not a button. The English at the call sites is
            // careful not to accuse anybody, and this is careful the same way.
            "apiErrors.sending_suspended":
                "Sending is paused on this workspace. Get in touch and we'll sort it out.",
            // #277 — nothing lapsed and nothing is at risk. Says the remedy,
            // because the remedy is one button.
            "apiErrors.workspace_paused":
                "Your plan is paused. Resume it in billing to carry on.",
            "apiErrors.usage_cap_reached": "You've reached a spending cap for this period.",
            "apiErrors.registration_pending":
                "Your texting registration is still being reviewed.",
            "apiErrors.recipient_opted_out": "This person asked us to stop texting them.",
            "apiErrors.unsupported_service_code": "Use your phone to dial this service code.",
            "apiErrors.validation_failed":
                "Something in that wasn't right. Check the details and try again.",
            "apiErrors.not_found": "We couldn't find that.",
            "apiErrors.conflict":
                "That can't be done as things stand. Refresh and take another look.",
            "apiErrors.quiet_hours_confirmation_required":
                "It's quiet hours where they are. Confirm to send anyway.",
            "apiErrors.mfa_required": "Two-step verification is needed first.",
            "apiErrors.mfa_challenge_required": "Confirm it's you to carry on.",
            "apiErrors.confirmation_code_required":
                "Enter the confirmation code to carry on.",
            "apiErrors.mfa_reprove_required": "Confirm it's you again to carry on.",
            "apiErrors.rate_limited": "Too many tries. Wait a minute and try again.",
            "apiErrors.service_unavailable": "That's busy right now. Try again in a moment.",
            "apiErrors.internal_error":
                "Something went wrong on our end. Try again in a moment.",
            "apiErrors.contactImportUndeclaredColumnsOne":
                "File column {columns} was not declared. This import never guesses what a column means because treating a do-not-text column as empty could message somebody who opted out. Every file column ({total} total) must be mapped or explicitly ignored. Send one `{field}` value per column as `<index>:<field or {ignore}>:<header>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredColumnsMany":
                "File columns {columns} were not declared. This import never guesses what a column means because treating a do-not-text column as empty could message somebody who opted out. Every file column ({total} total) must be mapped or explicitly ignored. Send one `{field}` value per column as `<index>:<field or {ignore}>:<header>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredPropertiesOne":
                "{properties} is a vCard property this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value for it as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredPropertiesMany":
                "{properties} are vCard properties this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value per property as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
            "apiErrors.contactImportUndeclaredPropertiesCapped":
                "{properties}, and {more} more, are vCard properties this import does not read. CATEGORIES, NOTE, and property parameters can carry do-not-text instructions. Send one `{field}` value per property as `<PROPERTY>:<{ignore} or opted_out>`. Nothing was imported.",
            "apiErrors.contactImportUnreadableFlag":
                "The do-not-text column “{header}” contains values this import cannot read as yes or no: {values}. Use true/false (yes/no, 1/0, or x on rows to block), then import again. Nothing was imported.",
            "apiErrors.contactImportUnreadableFlagCapped":
                "The do-not-text column “{header}” contains values this import cannot read as yes or no: {values}, and {more} more. Use true/false (yes/no, 1/0, or x on rows to block), then import again. Nothing was imported.",
            "apiErrors.selfDowngradeAcknowledgementRequired":
                "Confirm that you understand what you'll lose before changing your own role.",
            // #555 — a whole template rather than a suffix, because French does
            // not have to put the reference where English does.
            "apiErrors.withReference": "{message} Reference {id}.",
        ],
        frCA: [
            "apiRefusals.areaCodeChooseCountry":
                "L’indicatif {areaCode} ne correspond pas au pays sélectionné ({country}).",
            "apiRefusals.billingAddOnsRequireSubscription":
                "Terminez le paiement initial avant de modifier vos options.",
            "apiRefusals.billingAlreadyOnPlan":
                "Vous avez déjà le forfait {plan}.",
            "apiRefusals.billingAlreadyPaused":
                "Votre forfait est déjà en pause.",
            "apiRefusals.billingCallingIncluded":
                "Les appels sont inclus dans tous les forfaits. Actualisez l’application pour voir votre forfait.",
            "apiRefusals.billingCheckoutSeatLimit":
                "Le forfait {plan} permet {seats} membres. Votre espace de travail en compte {members}. Désactivez-en {over} avant de payer.",
            "apiRefusals.billingConfirmPrepaidConversion":
                "Votre année prépayée au forfait {plan} se termine le {date}. Le changement de forfait y mettra fin. Confirmez le changement pour continuer.",
            "apiRefusals.billingConfirmPrepaidConversionCredit":
                "Votre année prépayée au forfait {plan} se termine le {date}. Confirmez le changement pour y mettre fin et appliquer un crédit de {credit} à vos prochaines factures.",
            "apiRefusals.billingDowngradeMemberLimit":
                "Le forfait Starter permet {seats} membres. Désactivez les membres excédentaires avant de changer de forfait.",
            "apiRefusals.billingDowngradeSeatLimit":
                "Le forfait Starter permet {seats} places. Révoquez des invitations ou retirez des membres avant de changer de forfait.",
            "apiRefusals.billingInvalidModuleRequest":
                "Indiquez le nom de l’option et si vous voulez l’activer.",
            "apiRefusals.billingInvalidNumberId":
                "Indiquez un identifiant de numéro de téléphone valide.",
            "apiRefusals.billingInvalidPlan":
                "Choisissez le forfait Starter ou Pro.",
            "apiRefusals.billingModuleUnavailable":
                "L’option {module} n’est pas encore disponible.",
            "apiRefusals.billingNumberChangeRetry":
                "Une autre modification de vos numéros est en cours. Réessayez dans un instant.",
            "apiRefusals.billingPauseFixPayment":
                "Mettez à jour votre mode de paiement avant de mettre votre forfait en pause.",
            "apiRefusals.billingPauseMayTakeTime":
                "Votre forfait n’est pas encore en pause. Si vous l’avez repris aujourd’hui, réessayez demain. La mise en pause ne vous sera pas facturée deux fois.",
            "apiRefusals.billingPausePrepaid":
                "Vous avez déjà payé pour un an, jusqu’au {date}. Une mise en pause utiliserait les mois déjà payés pour garder votre ligne.",
            "apiRefusals.billingPausePrepaidContact":
                "Votre année prépayée est toujours en cours. Communiquez avec nous avant de mettre votre forfait en pause.",
            "apiRefusals.billingPauseSubscribeFirst":
                "Abonnez-vous avant de mettre un forfait en pause.",
            "apiRefusals.billingPauseUnavailable":
                "La mise en pause n’est pas disponible pour le moment.",
            "apiRefusals.billingPauseWaitForPlanChange":
                "Attendez que le changement de forfait prévu entre en vigueur avant de le mettre en pause.",
            "apiRefusals.billingPauseWaitForReferral":
                "Vous avez un mois gratuit de recommandation sur votre prochaine facture. Attendez qu’il soit appliqué avant de mettre votre forfait en pause.",
            "apiRefusals.billingPrepaidCurrencyMismatch":
                "Votre année prépayée a été payée en {paid} et votre espace de travail est facturé en {current}. Communiquez avec nous pour appliquer le crédit inutilisé.",
            "apiRefusals.billingPrepaidPlanLocked":
                "Votre année prépayée est toujours en cours. Communiquez avec nous avant de changer de forfait.",
            "apiRefusals.billingPrepayActivateFirst":
                "Envoyez votre premier texto avant de payer pour un an.",
            "apiRefusals.billingPrepayAlreadyPaid":
                "Vous avez déjà payé pour un an. La période prépayée se termine le {date}.",
            "apiRefusals.billingPrepayFixPayment":
                "Mettez à jour votre mode de paiement avant de payer pour un an.",
            "apiRefusals.billingPrepaySubscribeFirst":
                "Abonnez-vous avant de payer pour un an.",
            "apiRefusals.billingPrepayUnavailable":
                "Le paiement à l’avance pour un an n’est pas disponible pour le moment.",
            "apiRefusals.billingPrepayWaitForPlanChange":
                "Attendez que le changement de forfait prévu entre en vigueur avant de payer pour un an.",
            "apiRefusals.billingPrepayWaitForReferral":
                "Vous avez un mois gratuit de recommandation sur votre prochaine facture. Attendez qu’il soit appliqué avant de payer pour un an.",
            "apiRefusals.billingRestoreNumberLimit":
                "Le forfait Starter permet jusqu’à {count} numéros. Passez à Pro pour récupérer celui-ci.",
            "apiRefusals.billingRestoreWaitForNumberSetup":
                "Un autre numéro est toujours en cours de configuration. Réessayez de récupérer ce numéro après la configuration.",
            "apiRefusals.billingRestoreWaitForPlanChange":
                "Récupérez ce numéro une fois le changement de forfait prévu en vigueur.",
            "apiRefusals.billingResubscribeForAddOns":
                "Votre abonnement est annulé. Réabonnez-vous pour modifier vos options.",
            "apiRefusals.billingResumeBeforeAddingModule":
                "Reprenez votre forfait avant d’activer l’option {module}. Vous pourrez choisir sa date de facturation.",
            "apiRefusals.billingResumeBeforeChanging":
                "Reprenez votre forfait avant de le modifier. Vous pourrez ainsi choisir la date d’entrée en vigueur du nouveau tarif.",
            "apiRefusals.billingResumeMayTakeTime":
                "Votre forfait n’est pas encore réactivé. Réessayez dans une minute. La reprise ne vous sera pas facturée deux fois.",
            "apiRefusals.billingResumeUnavailable":
                "La reprise du forfait n’est pas disponible pour le moment.",
            "apiRefusals.billingResumeWaitForPlanChange":
                "Reprenez votre forfait une fois le changement prévu en vigueur.",
            "apiRefusals.billingSessionRequired":
                "Indiquez l’identifiant de la session de paiement.",
            "apiRefusals.billingSubscriptionChanged":
                "Votre abonnement vient de changer. Actualisez la page Facturation et réessayez.",
            "apiRefusals.billingUnknownModule":
                "Option inconnue : {module}.",
            "apiRefusals.extraNumberPlanLimit":
                "Vérifiez votre forfait et sa limite de numéros avant d’en ajouter un autre.",
            "apiRefusals.numberBillingChangedRetry":
                "La facturation vient d’être mise à jour. Réessayez d’ajouter le numéro.",
            "apiRefusals.numberCheckNewPurchase":
                "Un autre numéro vient d’être ajouté. Vérifiez Paramètres › Numéros avant de réessayer.",
            "apiRefusals.numberDocumentFileRequired":
                "Joignez un fichier au champ {field}.",
            "apiRefusals.numberDocumentSize":
                "Téléversez un fichier non vide de moins de {limit} Mo pour le champ {field}.",
            "apiRefusals.numberInvalidBusinessHours":
                "Entrez les heures d’ouverture et de fermeture au format HH:MM pour les jours de mon à sun.",
            "apiRefusals.numberInvalidClosedDates":
                "Entrez des dates de début et de fin au format AAAA-MM-JJ pour chaque fermeture. La fin doit suivre le début ou tomber le même jour. Les heures, si précisées, sont au format HH:MM.",
            "apiRefusals.numberInvalidTimezone":
                "Entrez un fuseau horaire IANA valide, comme America/Toronto.",
            "apiRefusals.numberLocalCountryRequired":
                "Choisissez un numéro local dans le pays {country}.",
            "apiRefusals.numberMembersMustBeActive":
                "Chaque personne doit être membre actif de cet espace de travail.",
            "apiRefusals.numberNotAwaitingSetup":
                "Ce numéro n’est pas en attente de configuration.",
            "apiRefusals.numberOrderStillRunning":
                "Une commande précédente est en cours de traitement. Réessayez dans une minute.",
            "apiRefusals.numberPurchaseInProgress":
                "Un autre achat de numéro vient d’aboutir. Réessayez dans un instant.",
            "apiRefusals.numberSetupLimit":
                "Vous avez configuré plusieurs nouveaux numéros pour ce compte. Communiquez avec le soutien pour en ajouter un autre.",
            "apiRefusals.numberSetupUnavailable":
                "Ce numéro ne peut pas être configuré de cette façon.",
            "apiRefusals.numberWaitForPlanChange":
                "Un changement de forfait est prévu. Ajoutez le numéro une fois ce changement en vigueur.",
            "apiRefusals.portCannotCancel":
                "Ce transfert ne peut plus être annulé.",
            "apiRefusals.portCannotEdit":
                "Ce transfert ne peut plus être modifié.",
            "apiRefusals.portCannotSubmit":
                "Ce transfert ne peut pas être soumis dans son état actuel.",
            "apiRefusals.portCarrierRefused":
                "Le fournisseur indique que ce numéro ne peut pas être transféré.",
            "apiRefusals.portDocumentType":
                "Téléversez un fichier PDF, PNG ou JPEG pour le champ {field}.",
            "apiRefusals.portNeedsFreeNumberSlot":
                "Votre forfait permet {count} numéros. Libérez-en un ou changez de forfait avant d’en transférer un.",
            "apiRefusals.portNumberIneligible":
                "Entrez un numéro local admissible du Canada ou des États-Unis.",
            "apiRefusals.portResubmitUnavailable":
                "La demande de transfert n’a pas pu être soumise de nouveau. Vérifiez son état avant de réessayer.",
            "apiRefusals.portTollFreeUnsupported":
                "Les numéros sans frais ne peuvent pas être transférés de cette façon. Choisissez un nouveau numéro local.",
            "apiRefusals.portUploadDocumentRequired":
                "Joignez la lettre d’autorisation ou une facture récente.",
            "apiRefusals.portUploadForm":
                "Utilisez multipart/form-data pour téléverser la lettre d’autorisation ou une facture récente.",
            "apiRefusals.teamCannotLeave":
                "Vous ne pouvez pas quitter cet espace de travail.",
            "apiRefusals.teamHandoffRequiresActiveMember":
                "Assignez le travail à un membre actif de l’équipe ou laissez-le sans responsable.",
            "apiRefusals.teamInviteSeatLimit":
                "Le forfait {plan} permet {seats} places. Cet espace de travail compte {active} membres actifs et {pending} invitations en attente.",
            "apiRefusals.teamSeatLimit":
                "Le forfait {plan} permet {seats} places.",
            "apiRefusals.textEnablementCannotCancel":
                "Cette demande ne peut plus être annulée.",
            "apiRefusals.textEnablementCannotResubmit":
                "Vous pouvez soumettre de nouveau une demande qui a échoué ou qui nécessite une action.",
            "apiRefusals.textEnablementCannotUpload":
                "Vous ne pouvez plus téléverser de documents pour cette demande.",
            "apiRefusals.textEnablementCannotVerify":
                "La vérification de propriété ne s’applique plus à cette demande.",
            "apiRefusals.textEnablementCodeSendFailed":
                "Le code de vérification n’a pas pu être envoyé. Réessayez ou choisissez une autre méthode.",
            "apiRefusals.textEnablementDocumentType":
                "Téléversez un PDF pour le champ {field}.",
            "apiRefusals.textEnablementNeedsFreeSlot":
                "Votre forfait permet {count} numéros. Libérez-en un ou changez de forfait avant d’activer les textos sur un autre numéro.",
            "apiRefusals.textEnablementUploadDocumentRequired":
                "Joignez la lettre d’autorisation ou une facture.",
            "apiRefusals.textEnablementUploadForm":
                "Utilisez multipart/form-data pour téléverser la lettre d’autorisation ou une facture.",
            "apiRefusals.workspaceNumberCountry":
                "Ce numéro provient du pays {numberCountry}. Votre espace de travail est inscrit dans le pays {workspaceCountry}.",
            "apiRefusals.billingAccountRequired":
                "Terminez le paiement initial pour créer votre compte de facturation.",
            "apiRefusals.billingDowngradeReleaseNumber":
                "Libérez votre numéro supplémentaire avant de passer au forfait Starter.",
            "apiRefusals.billingNoSubscriptionToResume":
                "Il n’y a aucun abonnement à reprendre.",
            "apiRefusals.billingPlanChangeApplied":
                "Le changement de forfait est déjà en vigueur. Actualisez la page Facturation.",
            "apiRefusals.billingPlanNotPaused":
                "Votre forfait est déjà actif.",
            "apiRefusals.billingResubscribeToChange":
                "Votre abonnement est annulé. Réabonnez-vous pour changer de forfait.",
            "apiRefusals.billingStartBeforeRestoringNumber":
                "Réactivez votre abonnement pour récupérer ce numéro.",
            "apiRefusals.billingSubscriptionRequired":
                "Terminez le paiement initial pour activer votre abonnement avant de changer de forfait.",
            "apiRefusals.extraNumberUnavailable":
                "Les numéros supplémentaires ne sont pas encore disponibles. Communiquez avec le soutien.",
            "apiRefusals.idempotencyKeyRequired":
                "L’en-tête Idempotency-Key doit contenir un UUID généré par le client.",
            "apiRefusals.numberAlreadyReleased":
                "Ce numéro a déjà été libéré.",
            "apiRefusals.numberRetryInProgress":
                "Une nouvelle tentative est déjà en cours.",
            "apiRefusals.portDocumentsRequired":
                "Téléversez la lettre d’autorisation signée et une facture récente avant de soumettre le transfert.",
            "apiRefusals.portResubmitDocumentsRequired":
                "Téléversez la lettre d’autorisation signée et une facture récente avant de soumettre de nouveau le transfert.",
            "apiRefusals.portResubmitNeedsFix":
                "Vous pouvez soumettre de nouveau un transfert qui nécessite une correction.",
            "apiRefusals.portWirelessPinRequired":
                "Pour transférer ce numéro mobile, entrez le NIP de transfert fourni par votre fournisseur actuel.",
            "apiRefusals.scheduledPlanNumberLimit":
                "Le forfait prévu ne permet pas d’ajouter un autre numéro.",
            "apiRefusals.soleProprietorNumberLimit":
                "L’inscription comme entreprise individuelle permet un seul numéro.",
            "apiRefusals.teamAlreadyMember":
                "Cette personne est déjà membre de cet espace de travail.",
            "apiRefusals.teamInviteNoLongerValid":
                "Cette invitation a été acceptée ou révoquée, ou elle a expiré.",
            "apiRefusals.teamInvitePlanChanged":
                "Votre forfait a changé. Réessayez d’envoyer l’invitation.",
            "apiRefusals.teamInviteScheduledSeatLimit":
                "Cet espace de travail a atteint la limite de places du forfait prévu.",
            "apiRefusals.teamOwnerCannotDeactivate":
                "Le compte du propriétaire ne peut pas être désactivé.",
            "apiRefusals.teamOwnerCannotLeave":
                "Un propriétaire ne peut pas quitter son espace de travail. Fermez l’espace dans les paramètres ou écrivez-nous pour transférer la propriété.",
            "apiRefusals.teamOwnerRoleFixed":
                "Le rôle du propriétaire ne peut pas être modifié.",
            "apiRefusals.textEnablementResubmitLimit":
                "Vous avez atteint la limite de soumissions pour cette demande. Annulez-la et recommencez, ou communiquez avec le soutien.",
            "apiRefusals.textEnablementUnsupportedNumber":
                "L’activation des textos est offerte pour les numéros locaux admissibles du Canada et des États-Unis.",
            "apiRefusals.textEnablementVerificationLimit":
                "Vous avez atteint la limite de tentatives de vérification. Annulez la demande et recommencez, ou communiquez avec le soutien.",
            "apiRefusals.textEnablementVerificationUnavailable":
                "Attendez la création de la demande d’activation des textos avant de vérifier le numéro.",
            "apiRefusals.areaCodeCountryMismatch":
                "Choisissez un indicatif régional du pays où votre espace de travail est enregistré ({country}).",
            "apiRefusals.areaCodeNotAssigned":
                "Choisissez un indicatif régional géographique attribué au Canada ou aux États-Unis.",
            "apiRefusals.billingAlreadySubscribed":
                "Cet espace de travail a déjà un abonnement.",
            "apiRefusals.carrierOptOutNeedsStart":
                "Ce client a texté STOP. Son fournisseur bloque vos textos. Seul le client peut lever ce blocage en textant START à votre numéro.",
            "apiRefusals.contactNotFound": "Ce contact est introuvable.",
            "apiRefusals.contactNumberNotFound":
                "Ce numéro ne figure pas dans cette fiche de contact.",
            "apiRefusals.contactUnmergeMainNumberInUse":
                "Choisissez un autre numéro principal avant d’annuler la fusion.",
            "apiRefusals.conversationNotFound": "Cette conversation est introuvable.",
            "apiRefusals.idempotencyKeyLength": "L’en-tête Idempotency-Key doit contenir de 1 à 255 caractères.",
            "apiRefusals.billingCheckoutTextingRequired":
                "Fournissez les renseignements sur vos textos vers les États-Unis avant de passer au paiement.",
            "apiRefusals.inviteAlreadyPending":
                "Une invitation à cette adresse courriel est déjà en attente.",
            "apiRefusals.numberCountryMismatch":
                "Choisissez un numéro du pays où votre espace de travail est enregistré ({country}).",
            "apiRefusals.privateLinkRetryUnavailable": "Envoyez un nouveau lien privé à ce client.",
            "apiRefusals.quoteTextRetry": "Le texto du devis a échoué. Réessayez dans la conversation.",
            "apiRefusals.quoteNotFound": "Devis introuvable.",
            "apiRefusals.quoteExpiryFuture": "Choisissez une date d’expiration future pour ce devis.",
            "apiRefusals.quoteDraftLocked": "Ce brouillon de devis ne peut plus être modifié.",
            "apiRefusals.quoteDeclineUnavailable": "Ce devis ne peut plus être refusé.",
            "apiRefusals.quoteUndoUnavailable": "Ce devis ne peut plus être rouvert.",
            "apiRefusals.quoteWithdrawalUnavailable": "Ce devis ne peut plus être retiré.",
            "apiRefusals.numberNotAssigned":
                "Choisissez un numéro géographique attribué au Canada ou aux États-Unis.",
            "apiRefusals.optOutNotActive": "Ce numéro ne figure pas dans la liste de désabonnement.",
            "apiRefusals.outboundSendPaused":
                "L’envoi de textos est suspendu pendant que nous réglons un problème. Vos textos ont été conservés.",
            "apiRefusals.paymentsNotSetUp":
                "Les paiements ne sont pas encore configurés dans cet espace de travail.",
            "apiRefusals.portAlreadyPending":
                "Un transfert est déjà en cours pour ce numéro.",
            "apiRefusals.publicTaskInvalidRepeat": "La règle de récurrence n’est pas valide.",
            "apiRefusals.publicTaskInvalidRepeatField":
                "La règle de récurrence est invalide pour le champ {field}.",
            "apiRefusals.publicTaskRepeatNeedsDueDate":
                "Choisissez une date d’échéance pour démarrer la récurrence.",
            "apiRefusals.publicTaskUnknownTag": "Cette étiquette est introuvable dans cet espace de travail.",
            "apiRefusals.remindersNeedCustomer": "Associez une conversation avec un client pour activer les rappels.",
            "apiRefusals.bookingNotFound": "Cette tâche est introuvable.",
            "apiRefusals.bookingSourceCustomer": "Une tâche créée à partir d’un texto ou d’un appel conserve son client.",
            "apiRefusals.bookingCustomerUnavailable": "Choisissez un client ou une conversation disponible.",
            "apiRefusals.bookingConfirmationNeedsDate": "Fixez une date pour cette tâche ouverte avant de la confirmer.",
            "apiRefusals.bookingDuePrecision": "Indiquez une heure ou une date pour cette tâche.",
            "apiRefusals.remindersWorkspaceNotFound": "Cet espace de travail est introuvable.",
            "apiRefusals.scheduledTextHorizon": "Vous pouvez planifier un texto jusqu’à {days} jours à l’avance.",
            "apiRefusals.scheduledTextKeyUsed":
                "Cet en-tête Idempotency-Key a déjà servi à programmer un autre texto.",
            "apiRefusals.taskCreateKeyUsed": "Cet en-tête Idempotency-Key a déjà servi à créer une tâche.",
            "apiRefusals.registrationChanged":
                "L’inscription a changé. Actualisez la page avant de la modifier.",
            "apiRefusals.registrationCheckoutRequired":
                "Terminez le paiement avant de saisir les renseignements sur votre entreprise.",
            "apiRefusals.registrationSubmissionInProgress":
                "La demande d’inscription est en cours d’envoi. Actualisez la page avant de la modifier.",
            "apiRefusals.textEnablementAlreadyPending":
                "L’activation des textos est déjà en cours pour ce numéro.",
            "apiRefusals.textEnablementNumberInUse":
                "Ce numéro est déjà en service sur Loonext. Vous ne pouvez pas y activer les textos de cette façon.",
            "apiRefusals.textEnablementWrongCode":
                "Ce code ne correspond pas. Demandez un nouveau code, puis réessayez.",
            "apiRefusals.contactImportInvalidCustomFields":
                "Les champs personnalisés doivent être dans un objet JSON contenant des valeurs textuelles.",
            "apiRefusals.contactImportTooManyOtherNumbers":
                "La ligne {row} contient plus de {limit} autres numéros de téléphone.",
            "apiRefusals.exportFileNotFound":
                "Ce fichier d’exportation est introuvable.",
            "apiRefusals.exportFileSizeUnavailable":
                "Impossible de lire la taille de ce fichier. Réessayez plus tard.",
            "apiRefusals.noActiveSendingNumber":
                "Il n’y a aucun numéro actif pour envoyer ce texto.",
            "apiRefusals.workspaceExportNotReady":
                "Aucune exportation prête ne correspond à cet identifiant.",
            "apiErrors.unauthorized":
                "Vous êtes déconnecté. Reconnectez-vous pour continuer.",
            "apiErrors.forbidden": "Vous n'avez pas accès à cela.",
            "apiErrors.subscription_inactive": "Votre abonnement n'est pas actif.",
            "apiErrors.sending_suspended":
                "L'envoi est suspendu pour cet espace de travail. Écrivez-nous et nous réglerons cela.",
            "apiErrors.workspace_paused":
                "Votre forfait est en pause. Reprenez-le dans la facturation pour continuer.",
            "apiErrors.usage_cap_reached":
                "Vous avez atteint une limite de dépenses pour cette période.",
            "apiErrors.registration_pending":
                "Votre inscription pour les textos est encore à l'étude.",
            "apiErrors.recipient_opted_out":
                "Cette personne nous a demandé de ne plus lui écrire.",
            "apiErrors.unsupported_service_code": "Composez ce numéro sur votre téléphone.",
            "apiErrors.validation_failed":
                "Quelque chose ne va pas dans cette demande. Vérifiez les détails et réessayez.",
            "apiErrors.not_found": "Nous n'avons pas trouvé cela.",
            "apiErrors.conflict":
                "Impossible dans l'état actuel. Actualisez et regardez de nouveau.",
            "apiErrors.quiet_hours_confirmation_required":
                "C'est une heure de tranquillité chez cette personne. Confirmez pour envoyer quand même.",
            "apiErrors.mfa_required": "La vérification en deux étapes est requise d'abord.",
            "apiErrors.mfa_challenge_required": "Confirmez votre identité pour continuer.",
            "apiErrors.confirmation_code_required":
                "Entrez le code de confirmation pour continuer.",
            "apiErrors.mfa_reprove_required":
                "Confirmez de nouveau votre identité pour continuer.",
            "apiErrors.rate_limited": "Trop de tentatives. Attendez une minute et réessayez.",
            "apiErrors.service_unavailable":
                "C'est occupé en ce moment. Réessayez dans un instant.",
            "apiErrors.internal_error":
                "Une erreur s'est produite de notre côté. Réessayez dans un instant.",
            "apiErrors.contactImportUndeclaredColumnsOne":
                "La colonne {columns} du fichier n’a pas été déclarée. Cette importation ne devine jamais le sens d’une colonne, car traiter une colonne d’interdiction de textos comme vide pourrait envoyer un message à une personne désabonnée. Chaque colonne du fichier ({total} au total) doit être associée à un champ ou explicitement ignorée. Envoyez une valeur `{field}` par colonne au format `<index>:<field ou {ignore}>:<header>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredColumnsMany":
                "Les colonnes {columns} du fichier n’ont pas été déclarées. Cette importation ne devine jamais le sens d’une colonne, car traiter une colonne d’interdiction de textos comme vide pourrait envoyer un message à une personne désabonnée. Chaque colonne du fichier ({total} au total) doit être associée à un champ ou explicitement ignorée. Envoyez une valeur `{field}` par colonne au format `<index>:<field ou {ignore}>:<header>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredPropertiesOne":
                "{properties} est une propriété vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez pour cette propriété une valeur `{field}` au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredPropertiesMany":
                "{properties} sont des propriétés vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez une valeur `{field}` par propriété au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUndeclaredPropertiesCapped":
                "{properties}, ainsi que {more} autres, sont des propriétés vCard que cette importation ne lit pas. CATEGORIES, NOTE et les paramètres de propriété peuvent contenir une consigne de ne pas envoyer de textos. Envoyez une valeur `{field}` par propriété au format `<PROPERTY>:<{ignore} ou opted_out>`. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUnreadableFlag":
                "La colonne d’interdiction de textos « {header} » contient des valeurs que cette importation ne peut pas interpréter comme oui ou non : {values}. Utilisez true/false (yes/no, 1/0 ou x sur les lignes à bloquer), puis recommencez l’importation. Aucune donnée n’a été importée.",
            "apiErrors.contactImportUnreadableFlagCapped":
                "La colonne d’interdiction de textos « {header} » contient des valeurs que cette importation ne peut pas interpréter comme oui ou non : {values}, ainsi que {more} autres. Utilisez true/false (yes/no, 1/0 ou x sur les lignes à bloquer), puis recommencez l’importation. Aucune donnée n’a été importée.",
            "apiErrors.selfDowngradeAcknowledgementRequired":
                "Confirmez que vous comprenez ce que vous perdrez avant de modifier votre propre rôle.",
            "apiErrors.withReference": "{message} Référence {id}.",
        ]
    )
}
