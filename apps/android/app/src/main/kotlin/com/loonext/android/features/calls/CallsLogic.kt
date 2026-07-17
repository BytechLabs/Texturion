package com.loonext.android.features.calls

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.telephony.CallDirection
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.telephony.SoftphoneSnapshot
import com.loonext.android.ui.common.formatPhone

/**
 * Pure call-display helpers — a Kotlin port of the web's
 * lib/format/call.ts + voicemail-player.tsx screeningLabel, kept free of
 * Android/Compose imports so they unit-test on the JVM.
 */

/** Display resolution order: contact > CNAM dip > formatted number. */
fun callerDisplayName(call: Call): String {
    call.contact_name?.takeIf { it.isNotBlank() }?.let { return it }
    call.caller_name?.takeIf { it.isNotBlank() }?.let { return it }
    call.caller_e164?.takeIf { it.isNotBlank() }?.let { return formatPhone(it) }
    return "Unknown caller"
}

/** "4m 32s" / "58s" — talk time for answered calls (never ring time). */
fun formatCallDuration(seconds: Int): String {
    val whole = maxOf(0, seconds)
    val minutes = whole / 60
    val rest = whole % 60
    if (minutes == 0) return "${rest}s"
    return if (rest == 0) "${minutes}m" else "${minutes}m ${rest}s"
}

/**
 * The row's plain-language outcome line (web parity). Outbound speaks from
 * the crew's side ("You called…", "No answer" — nothing was missed by the
 * crew). A null outcome is a session still in flight.
 */
fun callOutcomeLabel(call: Call): String {
    val outbound = call.direction == "outbound"
    return when (call.outcome) {
        CallOutcome.MISSED -> if (outbound) "No answer" else "Missed"
        CallOutcome.VOICEMAIL -> "Voicemail"
        CallOutcome.ANSWERED -> when {
            outbound && call.forward_seconds > 0 ->
                "You called · ${formatCallDuration(call.forward_seconds)}"

            outbound -> "You called"
            call.forward_seconds > 0 ->
                "Answered · ${formatCallDuration(call.forward_seconds)}"

            else -> "Answered"
        }

        else -> if (outbound) "Calling…" else "In progress"
    }
}

/** An INBOUND miss is the row's one urgent element (amber); nothing else is. */
fun isActionableMiss(call: Call): Boolean =
    call.outcome == CallOutcome.MISSED && call.direction != "outbound"

/**
 * Honest carrier-screening label from the raw verdict (web parity). Quiet by
 * design — the verdict came from the network, not from us.
 */
fun screeningLabel(result: String?): String? {
    if (result.isNullOrBlank()) return null
    val value = result.lowercase()
    if ("no_flag" in value || "clean" in value) return null
    val markers = listOf("spam", "fraud", "scam", "robo", "flag", "spoof")
    return if (markers.any { it in value }) "Spam likely" else null
}

/** "0:42" / "12:04" / "1:02:33" — the live in-call timer. */
fun formatTimer(elapsedMs: Long): String {
    val total = maxOf(0L, elapsedMs / 1000)
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) {
        "%d:%02d:%02d".format(hours, minutes, seconds)
    } else {
        "%d:%02d".format(minutes, seconds)
    }
}

/** "0:42" for a voicemail length. */
fun formatVoicemailLength(seconds: Int): String = formatTimer(seconds * 1000L)

/**
 * Normalize dialed digits to the E.164 the API dials: 10 NANP digits, 11
 * with a leading 1, or an already-+1 string. null = not dialable yet (the
 * Call button stays disabled — an obviously-short number can't be dialed).
 */
fun dialableE164(raw: String): String? {
    val digits = raw.filter { it.isDigit() }
    return when {
        raw.trim().startsWith("+") && digits.length == 11 && digits.first() == '1' ->
            "+$digits"

        digits.length == 10 -> "+1$digits"
        digits.length == 11 && digits.first() == '1' -> "+$digits"
        else -> null
    }
}

/**
 * The banner presentation reducer (#167): the ONE inbound call the top-pinned
 * incoming banner presents, or null for no banner. Only a live RINGING
 * inbound qualifies — answered/connecting/held/ended states belong to the
 * chip and the in-call screen; outbound calls never ring here. With two
 * ringing inbounds (call waiting on a quiet line) the earliest wins — its
 * end promotes the next one.
 */
fun bannerRingingCall(snapshot: SoftphoneSnapshot): CallSnapshot? =
    snapshot.calls.firstOrNull {
        it.phase == CallPhase.RINGING && it.direction == CallDirection.INBOUND
    }

/**
 * "to (555) 123-4567" — which workspace number the caller dialed, shown on
 * the banner. The ring invite doesn't carry the dialed number, so this is
 * only claimed when it's unambiguous: exactly one active number on the
 * workspace (the overwhelmingly common shape). Multi-number workspaces get
 * null — never a guess.
 */
fun calledNumberLine(company: CompanyView?): String? {
    val active = company?.numbers.orEmpty()
        .filter { it.status == NumberStatus.ACTIVE && !it.number_e164.isNullOrBlank() }
    val only = active.singleOrNull()?.number_e164 ?: return null
    return "to ${formatPhone(only)}"
}

/** "(415) 555-01…" progressive format while typing (NANP-shaped input). */
fun formatAsYouDial(raw: String): String {
    val digits = raw.filter { it.isDigit() }
    val national = when {
        digits.length == 11 && digits.first() == '1' -> digits.drop(1)
        digits.length <= 10 -> digits
        else -> return raw
    }
    return when {
        national.isEmpty() -> ""
        national.length <= 3 -> "(${national}"
        national.length <= 6 -> "(${national.take(3)}) ${national.drop(3)}"
        else -> "(${national.take(3)}) ${national.substring(3, 6)}-${national.drop(6)}"
    }
}
