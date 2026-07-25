package com.loonext.android.core.model

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

/** The fallback, and the whole of what a failed send used to say. */
const val GENERIC_SEND_FAILURE = "Not delivered"

private val SEND_FAILURE_MESSAGES = mapOf(
    // The recipient's own choice. Only they can undo it, by texting START.
    CARRIER_OPT_OUT_ERROR_CODE to "This customer opted out",

    // Nothing on the other end can receive it.
    "40001" to "That number can't receive texts",
    "40012" to "That number isn't textable",
    "40310" to "That number isn't textable",

    // Carriers judged the content. Worth rewording and trying again in the
    // temporary cases; pointless in the permanent ones, so the wording differs.
    "40002" to "Carriers are blocking this right now",
    "40017" to "Carriers are blocking this right now",
    "40003" to "Carriers blocked this as spam",
    "40015" to "Carriers blocked this as spam",
    "40322" to "Carriers blocked this as spam",

    // Volume, not content.
    "40011" to "Sent too fast for carriers. Try again shortly",
    "40016" to "Sent too fast for carriers. Try again shortly",
    "40018" to "Sent too fast for carriers. Try again shortly",
    "40318" to "Sent too fast for carriers. Try again shortly",

    // Their phone, momentarily.
    "40004" to "Their phone rejected it",
    "40006" to "Their phone couldn't receive it",
    "40008" to "Their phone couldn't receive it",

    // It sat too long to still be worth sending.
    "40005" to "It expired before it could send",
    "40014" to "It expired before it could send",

    // Something about the message itself.
    "40009" to "Carriers wouldn't accept this message",
    "40316" to "There was nothing to send",
    "40317" to "Carriers wouldn't accept that attachment",
    "40328" to "Too long to send",

    // Registration and number setup, which the owner can actually go and fix.
    "40010" to "Your US texting registration isn't approved yet",
    "40329" to "Your US texting registration isn't approved yet",
    "40330" to "This number isn't set up for texting yet",
    "40100" to "This number isn't set up for texting yet",
    "40314" to "Texting is turned off for this number",
    "40305" to "This number can't send texts",
    "40308" to "This number can't send pictures",
)

/**
 * The sentence to show under a failed message. Falls back to the plain
 * "Not delivered" for a code we cannot explain honestly.
 */
fun sendFailureMessage(errorCode: String?): String =
    SEND_FAILURE_MESSAGES[errorCode?.trim().orEmpty()] ?: GENERIC_SEND_FAILURE
