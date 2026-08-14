package com.loonext.android.core.model

import com.loonext.android.core.i18n.AppStrings

/**
 * #310 — making the wait legible.
 *
 * Hand-ported from `packages/shared/src/registration-progress.ts`;
 * `RegistrationProgressTest.kt` asserts the same table.
 *
 * A drift means "under review" on the phone and "submitted" on the laptop,
 * which is worse than either alone — it teaches the customer to distrust both
 * at exactly the moment they are already wondering whether the wait is broken.
 */
enum class RegistrationStage {
    NEEDS_DETAILS,
    SUBMITTING,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
}

data class RegistrationProgress(
    val stage: RegistrationStage,
    /** 0-100. Never 0 once anything has been submitted — see below. */
    val percent: Int,
    val title: String,
    val next: String,
    /** How long from here, or null when there is nothing to wait for. */
    val expected: String?,
    /** Whether anything is required FROM THEM. Everything else is waiting. */
    val actionNeeded: Boolean,
)

/**
 * The campaign outranks the brand: the campaign is what actually unlocks
 * texting, so an approved brand with a campaign still under review is NOT
 * further along than the campaign says.
 */
fun registrationStage(brand: String?, campaign: String?): RegistrationStage = when {
    // A rejection anywhere is the headline — it is the only state that needs
    // them, and burying it under a cheerful campaign status would be a lie of
    // emphasis.
    brand == "rejected" || campaign == "rejected" -> RegistrationStage.REJECTED
    campaign == "approved" -> RegistrationStage.APPROVED
    campaign == "pending" || brand == "pending" -> RegistrationStage.UNDER_REVIEW
    campaign == "submitted" || brand == "submitted" -> RegistrationStage.SUBMITTING
    brand == "approved" -> RegistrationStage.SUBMITTING
    else -> RegistrationStage.NEEDS_DETAILS
}

/**
 * THE PERCENTAGES ARE DELIBERATELY NOT LINEAR-IN-TIME, and never 0 once
 * anything has been sent. A bar sitting at 0% for four days is the spinner
 * this exists to replace. The value marks how many steps are BEHIND you —
 * a true statement, rather than a fabricated estimate of time remaining.
 *
 * #228: [locale] is last and defaulted, so `RegistrationProgressTest` keeps
 * asserting the same table while the waiting-room screen can pass the reader's
 * language. The percentages and [RegistrationProgress.actionNeeded] state the
 * same facts in either language and are untouched by it.
 */
fun registrationProgress(
    brand: String?,
    campaign: String?,
    locale: String? = null,
): RegistrationProgress {
    fun say(key: String) = AppStrings.translate(locale, key)
    return when (registrationStage(brand, campaign)) {
        RegistrationStage.NEEDS_DETAILS -> RegistrationProgress(
            stage = RegistrationStage.NEEDS_DETAILS,
            percent = 10,
            title = say("domain.regStageNeedsDetailsTitle"),
            next = say("domain.regStageNeedsDetailsNext"),
            expected = null,
            actionNeeded = true,
        )
        RegistrationStage.SUBMITTING -> RegistrationProgress(
            stage = RegistrationStage.SUBMITTING,
            percent = 40,
            title = say("domain.regStageSubmittingTitle"),
            next = say("domain.regStageSubmittingNext"),
            expected = say("domain.regStageExpected"),
            actionNeeded = false,
        )
        RegistrationStage.UNDER_REVIEW -> RegistrationProgress(
            stage = RegistrationStage.UNDER_REVIEW,
            percent = 70,
            title = say("domain.regStageUnderReviewTitle"),
            next = say("domain.regStageUnderReviewNext"),
            expected = say("domain.regStageExpected"),
            actionNeeded = false,
        )
        RegistrationStage.APPROVED -> RegistrationProgress(
            stage = RegistrationStage.APPROVED,
            percent = 100,
            title = say("domain.regStageApprovedTitle"),
            next = say("domain.regStageApprovedNext"),
            expected = null,
            actionNeeded = false,
        )
        RegistrationStage.REJECTED -> RegistrationProgress(
            stage = RegistrationStage.REJECTED,
            percent = 40,
            title = say("domain.regStageRejectedTitle"),
            next = say("domain.regStageRejectedNext"),
            expected = null,
            actionNeeded = true,
        )
    }
}

/**
 * Is this workspace in the waiting room?
 *
 * Approved is out; so is NEEDS_DETAILS, because that workspace is not waiting
 * on anybody — it is being waited ON, and offering it optional setup work
 * would point away from the thing blocking it.
 */
fun isWaitingOnRegistration(brand: String?, campaign: String?): Boolean =
    when (registrationStage(brand, campaign)) {
        RegistrationStage.SUBMITTING, RegistrationStage.UNDER_REVIEW -> true
        else -> false
    }
