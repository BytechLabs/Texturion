package com.loonext.android.features.calls

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.telephony.AudioRoute
import com.loonext.android.telephony.CallPhase
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

// -------------------------------------------- #202 in-call controls honesty

/**
 * A route toggle (Speaker / Bluetooth) is LIT exactly when the route it
 * represents is the one the audio actually follows: the OS-confirmed route,
 * overridden briefly by the user's optimistic pending choice until the OS
 * confirms or reverts it. One route value drives every toggle, so Speaker and
 * Bluetooth can never both read lit.
 */
fun routeToggleLit(toggle: AudioRoute, pending: AudioRoute?, confirmed: AudioRoute?): Boolean =
    (pending ?: confirmed) == toggle

/** The Bluetooth toggle exists only while the OS reports a BT endpoint - a
 *  button no endpoint backs is a lie, not a control. */
fun bluetoothToggleAvailable(available: Set<AudioRoute>): Boolean =
    AudioRoute.BLUETOOTH in available

/** Tapping a lit toggle returns to the earpiece; tapping an unlit one requests
 *  that route. The OS owning a single route is what keeps the pair mutually
 *  exclusive. */
fun routeTapTarget(toggle: AudioRoute, lit: Boolean): AudioRoute =
    if (lit) AudioRoute.EARPIECE else toggle

/**
 * The Note control's caption: an honest "Linking…" while the conversation
 * link is still resolving after answer (a plain greyed Note read as broken),
 * "Note" once linked or once resolution has genuinely given up.
 */
fun noteControlLabel(linked: Boolean, resolving: Boolean): String =
    if (!linked && resolving) "Linking…" else "Note"

// ------------------------------------------------------ #204 living backdrop

/**
 * How the call backdrop carries the moment (#204). [drift] scales blob travel:
 * 1 while a call rings or dials (calm drift), near 0 during the call (the
 * backdrop nearly stills so the conversation owns the screen). [glow] scales
 * blob alpha: full while the line is alive, cooling toward quiet as the call
 * ends. Pure so the phase-to-mood mapping unit-tests on the JVM.
 */
data class BackdropSpec(val drift: Float, val glow: Float)

/** Call phase -> backdrop mood. A null phase reads as an ended/cooling line. */
fun backdropSpec(phase: CallPhase?): BackdropSpec = when (phase) {
    CallPhase.RINGING, CallPhase.CONNECTING -> BackdropSpec(drift = 1f, glow = 1f)
    CallPhase.ACTIVE -> BackdropSpec(drift = 0.28f, glow = 0.85f)
    CallPhase.HELD -> BackdropSpec(drift = 0.2f, glow = 0.6f)
    CallPhase.ENDED, null -> BackdropSpec(drift = 0.1f, glow = 0.25f)
}

/**
 * The one soft brightening pulse fires exactly when a ringing or dialing call
 * CONNECTS. Never on resume from hold, and never when a surface composes onto
 * an already-active call (arriving late must not flash).
 */
fun connectPulseFires(previous: CallPhase?, current: CallPhase?): Boolean =
    current == CallPhase.ACTIVE &&
        (previous == CallPhase.RINGING || previous == CallPhase.CONNECTING)

/**
 * The standalone call surface's backdrop phase - mirrors CallActivity's branch
 * order exactly (live call > failed answer > answering > ring > cold connect)
 * so the backdrop always matches the surface actually shown.
 */
fun activityBackdropPhase(
    livePhase: CallPhase?,
    answerFailed: Boolean,
    answering: Boolean,
    ringing: Boolean,
): CallPhase = when {
    livePhase != null -> livePhase
    answerFailed -> CallPhase.ENDED
    answering -> CallPhase.CONNECTING
    ringing -> CallPhase.RINGING
    else -> CallPhase.CONNECTING
}

// ---------------------------------------------------- #210 ongoing call card

private const val STATE_RINGING = "ringing"
private const val STATE_ANSWERED = "answered"
private const val STATE_VOICEMAIL_GREETING = "voicemail_greeting"
private const val STATE_VOICEMAIL_RECORDING = "voicemail_recording"
private const val STATE_ENDED_PREFIX = "ended"

/**
 * A row still holding the line: outcome unstamped AND the #208 state mirror
 * does not already say ended_*. An outcome-null row whose state is terminal
 * is mirror lag (the outcome stamp is seconds behind) — pinning it as
 * "ongoing" would show a ghost call, so it counts as resolved.
 */
fun isOngoingCall(call: Call): Boolean =
    call.outcome == null && call.state?.startsWith(STATE_ENDED_PREFIX) != true

/** The rows the Ongoing card pins, kept in the log's newest-first order. */
fun ongoingCalls(calls: List<Call>): List<Call> = calls.filter(::isOngoingCall)

/** The log below the card — everything that has actually resolved. */
fun resolvedCalls(calls: List<Call>): List<Call> = calls.filterNot(::isOngoingCall)

/** What an ongoing row is doing right now. */
enum class OngoingPhase { RINGING, DIALING, ANSWERED, VOICEMAIL }

/**
 * Phase resolution: the #208 state is the truth when present; a null state
 * (outbound rows, pre-backfill rows) falls back to the answer stamps, then
 * direction — an unstamped outbound row is the crew dialing out.
 */
fun ongoingPhase(call: Call): OngoingPhase = when (call.state) {
    STATE_ANSWERED -> OngoingPhase.ANSWERED
    STATE_VOICEMAIL_GREETING, STATE_VOICEMAIL_RECORDING -> OngoingPhase.VOICEMAIL
    STATE_RINGING -> OngoingPhase.RINGING
    else -> when {
        call.answered_at != null || call.answered_by_user_id != null -> OngoingPhase.ANSWERED
        call.direction == "outbound" -> OngoingPhase.DIALING
        else -> OngoingPhase.RINGING
    }
}

/**
 * The card's status line. Ringing shows no member (nobody has the line yet);
 * an answered call names who does; an answered call whose member cannot be
 * resolved still says the line is taken instead of naming no one.
 */
fun ongoingStatusLabel(phase: OngoingPhase, memberName: String?): String = when (phase) {
    OngoingPhase.RINGING -> "Ringing…"
    OngoingPhase.DIALING -> "Calling…"
    OngoingPhase.VOICEMAIL -> "Leaving a voicemail"
    OngoingPhase.ANSWERED ->
        memberName?.takeIf { it.isNotBlank() }?.let { "With $it" } ?: "On the line"
}

/** Only an answered call has talk time to tick. */
fun ongoingShowsTimer(phase: OngoingPhase): Boolean = phase == OngoingPhase.ANSWERED

/**
 * The live timer's anchor: answered_at (true talk time). A row the API has
 * not stamped yet falls back to started_at — a few seconds of ring time is
 * a smaller lie than a frozen timer.
 */
fun ongoingAnchorIso(call: Call): String = call.answered_at ?: call.started_at

/** answered_by user id → roster display name; null when unresolvable. */
fun memberDisplayName(userId: String?, members: List<Member>): String? {
    if (userId == null) return null
    return members.firstOrNull { it.user_id == userId }
        ?.display_name?.takeIf { it.isNotBlank() }
}

/**
 * The business-line chip label: only when the company owns MORE than one
 * number (one number = zero ambiguity, the chip is noise) and the row's
 * number resolves to a listable E.164.
 */
fun ongoingNumberLabel(phoneNumberId: String?, numbers: List<PhoneNumberSummary>): String? {
    if (numbers.size <= 1 || phoneNumberId == null) return null
    return numbers.firstOrNull { it.id == phoneNumberId }
        ?.number_e164?.takeIf { it.isNotBlank() }
        ?.let(::formatPhone)
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
