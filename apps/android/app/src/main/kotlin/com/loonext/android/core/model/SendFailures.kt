package com.loonext.android.core.model

import com.loonext.android.core.i18n.AppStrings

/**
 * Why a text did not arrive, in words the person reading the thread can act on.
 *
 * Every failed send except a carrier opt-out used to read "Not delivered",
 * which tells you nothing about whether to fix the number, wait, or stop
 * trying. The provider does tell us: it stores an error code on the row, and
 * the codes below are the ones a small business actually hits.
 *
 * Codes and their meanings come from Telnyx's messaging error reference. An
 * unknown or absent code keeps the old wording, because inventing a reason is
 * worse than admitting we do not have one.
 *
 * Twin of packages/shared/src/send-failures.ts and
 * apps/ios/Loonext/Core/Model/SendFailures.swift. Keep the three identical.
 */

/**
 * The fallback, and the whole of what a failed send used to say.
 *
 * #228: the KEY is the constant now — this table is built at class-init, before
 * any reader exists. [GENERIC_SEND_FAILURE] still reads as the English sentence
 * for any caller that has not been handed a reader's language yet.
 */
const val GENERIC_SEND_FAILURE_KEY = "domain.sendFailureGeneric"

val GENERIC_SEND_FAILURE: String
    get() = AppStrings.translate(null, GENERIC_SEND_FAILURE_KEY)

private val SEND_FAILURE_KEYS = mapOf(
    // The recipient's own choice. Only they can undo it, by texting START.
    "40300" to "domain.sendFailureOptedOut",

    // Nothing on the other end can receive it.
    "40001" to "domain.sendFailureUnreachable",
    "40012" to "domain.sendFailureNotTextable",
    "40310" to "domain.sendFailureNotTextable",

    // Carriers judged the content. Worth rewording and trying again in the
    // temporary cases; pointless in the permanent ones, so the wording differs.
    "40002" to "domain.sendFailureBlockedNow",
    "40017" to "domain.sendFailureBlockedNow",
    "40003" to "domain.sendFailureSpam",
    "40015" to "domain.sendFailureSpam",
    "40322" to "domain.sendFailureSpam",

    // Volume, not content.
    "40011" to "domain.sendFailureRateLimited",
    "40016" to "domain.sendFailureRateLimited",
    "40018" to "domain.sendFailureRateLimited",
    "40318" to "domain.sendFailureRateLimited",

    // Their phone, momentarily.
    "40004" to "domain.sendFailureHandsetRejected",
    "40006" to "domain.sendFailureHandsetUnavailable",
    "40008" to "domain.sendFailureHandsetUnavailable",

    // It sat too long to still be worth sending.
    "40005" to "domain.sendFailureExpired",
    "40014" to "domain.sendFailureExpired",

    // Something about the message itself.
    "40009" to "domain.sendFailureContent",
    "40316" to "domain.sendFailureEmpty",
    "40317" to "domain.sendFailureAttachment",
    "40328" to "domain.sendFailureTooLong",

    // Registration and number setup, which the owner can actually go and fix.
    "40010" to "domain.sendFailureRegistration",
    "40329" to "domain.sendFailureRegistration",
    "40330" to "domain.sendFailureNumberNotReady",
    "40100" to "domain.sendFailureNumberNotReady",
    "40314" to "domain.sendFailureTextingOff",
    "40305" to "domain.sendFailureNoSms",
    "40308" to "domain.sendFailureNoMms",
)

/**
 * The sentence to show under a failed message. Falls back to the plain
 * "Not delivered" for a code we cannot explain honestly.
 *
 * #228: [locale] is last and defaulted, so the tables that pin the English are
 * untouched while the thread that knows the reader's language can pass it.
 */
fun sendFailureMessage(errorCode: String?, locale: String? = null): String =
    AppStrings.translate(
        locale,
        SEND_FAILURE_KEYS[errorCode?.trim().orEmpty()] ?: GENERIC_SEND_FAILURE_KEY,
    )

/**
 * #241 — why a send failed, in OUR vocabulary rather than the carrier's.
 *
 * Hand-ported from `packages/shared/src/carrier-failure.ts`;
 * `CarrierFailureTest.kt` asserts the same table of cases.
 *
 * This file used to hold `CARRIER_OPT_OUT_ERROR_CODE = "40300"` and the app
 * branched on it to decide whether to offer a retry button — a Telnyx constant
 * shipped inside an Android build. A second carrier would have meant editing
 * three apps and shipping them, which #339 established takes weeks to reach
 * everybody and never reaches some phones at all.
 */
enum class CarrierFailureReason {
    OPT_OUT,
    UNREACHABLE,
    CONTENT_BLOCKED,
    SPAM_BLOCKED,
    RATE_LIMITED,
    EXPIRED,
    NOT_PROVISIONED,
    UNKNOWN,
}

/** The wire values the server sends. Unknown decodes to UNKNOWN, never a crash (D44). */
private val REASON_BY_WIRE = mapOf(
    "opt_out" to CarrierFailureReason.OPT_OUT,
    "unreachable" to CarrierFailureReason.UNREACHABLE,
    "content_blocked" to CarrierFailureReason.CONTENT_BLOCKED,
    "spam_blocked" to CarrierFailureReason.SPAM_BLOCKED,
    "rate_limited" to CarrierFailureReason.RATE_LIMITED,
    "expired" to CarrierFailureReason.EXPIRED,
    "not_provisioned" to CarrierFailureReason.NOT_PROVISIONED,
    "unknown" to CarrierFailureReason.UNKNOWN,
)

/**
 * Telnyx codes → our reasons. The ONLY place a vendor code appears in a
 * decision on this client, and it exists only to classify rows written before
 * the server sent a reason.
 */
private val TELNYX_REASONS = mapOf(
    "40300" to CarrierFailureReason.OPT_OUT,
    "40001" to CarrierFailureReason.UNREACHABLE,
    "40012" to CarrierFailureReason.UNREACHABLE,
    "40310" to CarrierFailureReason.UNREACHABLE,
    "40004" to CarrierFailureReason.UNREACHABLE,
    "40006" to CarrierFailureReason.UNREACHABLE,
    "40008" to CarrierFailureReason.UNREACHABLE,
    "40002" to CarrierFailureReason.CONTENT_BLOCKED,
    "40017" to CarrierFailureReason.CONTENT_BLOCKED,
    "40009" to CarrierFailureReason.CONTENT_BLOCKED,
    "40316" to CarrierFailureReason.CONTENT_BLOCKED,
    "40317" to CarrierFailureReason.CONTENT_BLOCKED,
    "40328" to CarrierFailureReason.CONTENT_BLOCKED,
    "40003" to CarrierFailureReason.SPAM_BLOCKED,
    "40015" to CarrierFailureReason.SPAM_BLOCKED,
    "40322" to CarrierFailureReason.SPAM_BLOCKED,
    "40011" to CarrierFailureReason.RATE_LIMITED,
    "40016" to CarrierFailureReason.RATE_LIMITED,
    "40018" to CarrierFailureReason.RATE_LIMITED,
    "40318" to CarrierFailureReason.RATE_LIMITED,
    "40005" to CarrierFailureReason.EXPIRED,
    "40014" to CarrierFailureReason.EXPIRED,
    "40010" to CarrierFailureReason.NOT_PROVISIONED,
    "40329" to CarrierFailureReason.NOT_PROVISIONED,
    "40330" to CarrierFailureReason.NOT_PROVISIONED,
    "40100" to CarrierFailureReason.NOT_PROVISIONED,
    "40314" to CarrierFailureReason.NOT_PROVISIONED,
    "40305" to CarrierFailureReason.NOT_PROVISIONED,
    "40308" to CarrierFailureReason.NOT_PROVISIONED,
)

/**
 * UNKNOWN for anything unmapped, and that is honest rather than a soft
 * default: an unrecognised failure must never become OPT_OUT, because that is
 * the one reason with a legal meaning — only the customer can lift a STOP.
 */
fun classifySendFailure(errorCode: String?): CarrierFailureReason {
    val code = errorCode?.trim().orEmpty()
    if (code.isEmpty()) return CarrierFailureReason.UNKNOWN
    return TELNYX_REASONS[code] ?: CarrierFailureReason.UNKNOWN
}

/**
 * The reason to act on: what the server classified, falling back to the code.
 *
 * The fallback is not defensive padding — rows written before the server sent
 * a reason will sit on somebody's phone for months (#339), and a client that
 * only understood the new field would show the wrong affordance on every one.
 */
fun failureReasonOf(reason: String?, errorCode: String?): CarrierFailureReason {
    val wire = reason?.trim().orEmpty()
    if (wire.isNotEmpty()) REASON_BY_WIRE[wire]?.let { return it }
    return classifySendFailure(errorCode)
}

/**
 * Is offering "try again" honest? An opt-out never is: the block is the
 * customer's own choice and only they can lift it.
 */
fun isRetryableFailure(reason: CarrierFailureReason): Boolean =
    reason != CarrierFailureReason.OPT_OUT
