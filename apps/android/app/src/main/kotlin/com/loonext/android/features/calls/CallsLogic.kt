package com.loonext.android.features.calls

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallEffects
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.allows
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.telephony.AudioRoute
import com.loonext.android.telephony.CallPhase
import com.loonext.android.ui.common.formatPhone
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

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

/**
 * The caller HERO line for the ring / connecting surfaces (#212): the trusted
 * name when we have one, else the formatted number, else a stable "Unknown
 * caller". Never a bare +1XXXXXXXXXX — a raw E.164 as the hero reads as a bug,
 * not a caller. The name/number values themselves are exactly what the caller-id
 * plumbing resolved; this only decides which to show and how it is formatted.
 */
fun callerHeroLine(name: String, number: String): String {
    name.trim().takeIf { it.isNotBlank() }?.let { return it }
    number.takeIf { it.isNotBlank() }?.let { return formatPhone(it) }
    return "Unknown caller"
}

/**
 * The secondary number line under the hero (#212): the formatted number, shown
 * only when the hero is a NAME. When there is no name the number is already the
 * hero, so repeating it below is noise — return null and show nothing.
 */
fun callerSubLine(name: String, number: String): String? {
    if (number.isBlank()) return null
    if (name.trim().isBlank()) return null
    return formatPhone(number)
}

/** "4m 32s" / "58s" — talk time for answered calls (never ring time). */
fun formatCallDuration(seconds: Int): String {
    val whole = maxOf(0, seconds)
    // #570: hours were missing, so a three-hour call read as "183m 12s". Nothing
    // caps talk time — the call code's timeouts bound RINGING and a transfer, not a
    // connected call. Past an hour the seconds are dropped: "3h 3m 12s" is three
    // facts where the reader wanted one. Under an hour they stay, because 58s
    // against 4m 32s is exactly what somebody is scanning for.
    val hours = whole / 3600
    val minutes = (whole % 3600) / 60
    val rest = whole % 60
    if (hours > 0) return if (minutes == 0) "${hours}h" else "${hours}h ${minutes}m"
    if (minutes == 0) return "${rest}s"
    return if (rest == 0) "${minutes}m" else "${minutes}m ${rest}s"
}

/**
 * #721: why no phone rang, in the web's words (checked against
 * `vectors/call-routing.json`); null when the call rang or predates the column.
 */
fun callRoutingReason(routing: String?, locale: String? = null): String? {
    val key = when (routing) {
        "blocked" -> "shell.callRoutingBlocked"
        "line_busy" -> "shell.callRoutingLineBusy"
        "screened" -> "shell.callRoutingScreened"
        "after_hours" -> "shell.callRoutingAfterHours"
        "paused" -> "shell.callRoutingPaused"
        "over_cap" -> "shell.callRoutingOverCap"
        "nobody_reachable" -> "shell.callRoutingNobodyReachable"
        else -> return null
    }
    return AppStrings.translate(locale, key)
}

/**
 * #725: how a call finished, in the web's words (checked against
 * `vectors/call-end-reasons.json`). Null for the two plain endings (answered,
 * a voicemail left, a customer who never answered) and for an unknown reason.
 */
fun callEndReason(reason: String?, locale: String? = null): String? {
    val key = when (reason) {
        "caller_hung_up" -> "shell.callEndedCallerHungUp"
        "no_answer_in_time" -> "shell.callEndedNoAnswerInTime"
        "declined_by_everyone" -> "shell.callEndedDeclinedByEveryone"
        "nobody_reachable" -> "shell.callEndedNobodyReachable"
        "rejected_blocked" -> "shell.callEndedRejectedBlocked"
        "rejected_over_limit" -> "shell.callEndedRejectedOverLimit"
        "line_paused" -> "shell.callEndedLinePaused"
        "stuck_call_cleaned_up" -> "shell.callEndedStuckCallCleanedUp"
        "intent_expired" -> "shell.callEndedIntentExpired"
        "voicemail_failed" -> "shell.callEndedVoicemailFailed"
        "carrier_refused" -> "shell.callEndedCarrierRefused"
        "placer_hung_up" -> "shell.callEndedPlacerHungUp"
        "customer_hung_up" -> "shell.callEndedCustomerHungUp"
        else -> return null
    }
    return AppStrings.translate(locale, key)
}

/** Where the call went beats how it ended: "After hours" over "The caller hung up". */
fun callWhyLine(call: Call, locale: String? = null): String? =
    callRoutingReason(call.routing, locale) ?: callEndReason(call.ended_reason, locale)

/**
 * The row's plain-language outcome line (web parity). Outbound speaks from
 * the crew's side ("You called…", "No answer" — nothing was missed by the
 * crew). An answered call NAMES the acting member (#191): the placer of an
 * outbound call, the answerer of an inbound one — so a crew's log doesn't
 * mis-attribute every member's call to whoever is looking. The bare
 * "You called"/"Answered" is the fallback for legacy rows with no actor.
 * A null outcome is a session still in flight.
 */
fun callOutcomeLabel(call: Call): String {
    val outbound = call.direction == "outbound"
    val dur =
        if (call.forward_seconds > 0) " · ${formatCallDuration(call.forward_seconds)}" else ""
    val actor = call.answered_by_name?.takeIf { it.isNotBlank() }
    val why = callWhyLine(call)?.let { " · $it" } ?: ""
    return when (call.outcome) {
        CallOutcome.MISSED -> if (outbound) "No answer" else "Missed$why"
        CallOutcome.VOICEMAIL -> "Voicemail$why"
        CallOutcome.ANSWERED ->
            if (outbound) {
                "${if (actor != null) "$actor called" else "You called"}$dur"
            } else {
                "${if (actor != null) "Answered by $actor" else "Answered"}$dur"
            }

        else -> if (outbound) "Calling…" else "In progress"
    }
}

/**
 * #734: the ONE action a call row draws inline. A missed inbound call or a
 * voicemail wants a call back; an answered or outbound one wants a message.
 * Everything else is in the row's more / long-press menu. Mirrors the web's
 * callPrimaryAction: when the preferred action cannot be done the other one
 * stands in, and a caller we cannot reach at all gets none.
 */
enum class CallRowAction { MESSAGE, CALL_BACK }

/** Message goes to the thread, or starts a text to the number. */
fun callCanMessage(call: Call): Boolean =
    call.conversation_id != null || !call.caller_e164.isNullOrBlank()

/** Call back goes through the dialer, so it needs a number. */
fun callCanCallBack(call: Call): Boolean =
    !call.caller_e164.isNullOrBlank() && call.allowed_actions.allows("call_back")

fun callPrimaryAction(call: Call): CallRowAction? {
    val canMessage = callCanMessage(call)
    val canCallBack = callCanCallBack(call)
    val wantsCallBack = call.direction != "outbound" &&
        (call.outcome == CallOutcome.MISSED || call.outcome == CallOutcome.VOICEMAIL)
    return if (wantsCallBack) {
        when {
            canCallBack -> CallRowAction.CALL_BACK
            canMessage -> CallRowAction.MESSAGE
            else -> null
        }
    } else {
        when {
            canMessage -> CallRowAction.MESSAGE
            canCallBack -> CallRowAction.CALL_BACK
            else -> null
        }
    }
}

/** The catalogue key naming an action for TalkBack; it takes the caller's {name}. */
fun callRowActionLabelKey(action: CallRowAction): String = when (action) {
    CallRowAction.MESSAGE -> "shell.callActionMessageFor"
    CallRowAction.CALL_BACK -> "shell.callActionCallBackFor"
}

/**
 * #725: the reasons the calls list can be narrowed to: every routing and every
 * end reason, from the shared lists. Anything else in a link is ignored.
 */
val CALL_ROUTING_FILTERS = setOf(
    "blocked", "line_busy", "screened", "after_hours", "paused", "over_cap",
    "nobody_reachable", "rang",
)
val CALL_END_REASON_FILTERS = setOf(
    "answered", "caller_hung_up", "no_answer_in_time", "declined_by_everyone",
    "nobody_reachable", "left_voicemail", "rejected_blocked", "rejected_over_limit",
    "line_paused", "stuck_call_cleaned_up", "intent_expired", "voicemail_failed",
    "carrier_refused", "placer_hung_up", "customer_hung_up", "no_answer",
)

fun isCallReasonFilter(value: String?): Boolean =
    value != null && (value in CALL_ROUTING_FILTERS || value in CALL_END_REASON_FILTERS)

/** The chip's words: the routing wording first (as on a row), else the end reason, else the id. */
fun callReasonLabel(reason: String, locale: String? = null): String =
    callRoutingReason(reason, locale) ?: callEndReason(reason, locale) ?: reason

/**
 * #725: "This touched N calls in the last 30 days." The settings notes stay
 * silent at zero, so this is null then.
 */
fun callEffectCount(effects: CallEffects?, reason: String): Int = effects?.counts?.get(reason) ?: 0

/** What the call page says happened, in the owner's words (web `outcomeLine`). */
fun callOutcomeLineKey(call: Call): String {
    if (call.outcome == null) return "shell.outcomeInProgress"
    if (call.direction == "outbound") {
        return if (call.outcome == CallOutcome.ANSWERED) {
            "shell.outcomeAnswered"
        } else {
            "shell.outcomeNoAnswer"
        }
    }
    return when (call.outcome) {
        CallOutcome.ANSWERED -> "shell.outcomeAnswered"
        CallOutcome.VOICEMAIL -> "shell.outcomeLeftVoicemail"
        else -> "shell.outcomeMissed"
    }
}

/**
 * The honest transcript state (web `transcriptState`): the words when there
 * are some, else which of the four not-transcribed sentences is true. [muted]
 * means the page is talking, not the caller.
 */
data class TranscriptState(val key: String?, val text: String?, val muted: Boolean)

fun callTranscriptState(call: Call): TranscriptState {
    call.voicemail_transcript?.takeIf { it.isNotBlank() }?.let {
        return TranscriptState(null, it, muted = false)
    }
    if (call.has_voicemail != true) {
        return TranscriptState(
            if (call.outcome == CallOutcome.VOICEMAIL) {
                "shell.transcriptRecordingLost"
            } else {
                "shell.transcriptNoVoicemail"
            },
            null,
            muted = true,
        )
    }
    return TranscriptState(
        if (call.voicemail_transcript_attempted_at != null) {
            "shell.transcriptNoWords"
        } else {
            "shell.transcriptNotYet"
        },
        null,
        muted = true,
    )
}

/** An INBOUND miss is the row's one urgent element (amber); nothing else is. */
fun isActionableMiss(call: Call): Boolean =
    call.outcome == CallOutcome.MISSED && call.direction != "outbound"

private const val SPAM_LIKELY = "spam_likely"
private val SPAM_WORD_SEPARATORS = Regex("""[\s-]+""")

private fun isSpamLikelyWord(value: String): Boolean =
    value.trim().lowercase().replace(SPAM_WORD_SEPARATORS, "_") == SPAM_LIKELY

private fun resultSaysSpamLikely(result: String): Boolean {
    if (isSpamLikelyWord(result)) return true
    val parsed = try {
        Json.parseToJsonElement(result)
    } catch (_: IllegalArgumentException) {
        return false
    }
    return when (parsed) {
        is JsonPrimitive -> parsed.isString && isSpamLikelyWord(parsed.content)
        is JsonObject -> parsed.entries.any { (key, value) ->
            when {
                key == "action" || value !is JsonPrimitive -> false
                value.isString -> isSpamLikelyWord(value.content)
                else -> value.booleanOrNull == true && isSpamLikelyWord(key)
            }
        }
        else -> false
    }
}

/**
 * #721: Kotlin port of `packages/shared/src/call-screening.ts`, checked against
 * `vectors/call-screening.json`. True only on Telnyx's explicit `spam_likely`;
 * the `"action":"flag_calls"` every call carries is our own mode, not a verdict.
 */
fun callLooksSpam(result: String?, callerName: String?): Boolean {
    if (!result.isNullOrBlank() && resultSaysSpamLikely(result)) return true
    return !callerName.isNullOrBlank() && isSpamLikelyWord(callerName)
}

/** The carrier's spam verdict as a label (web parity); anything else shows nothing. */
fun screeningLabel(result: String?, callerName: String?): String? =
    if (callLooksSpam(result, callerName)) "Spam likely" else null

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
fun ongoingStatusLabel(
    phase: OngoingPhase,
    memberName: String?,
    // #228: last and defaulted, so the vectors that pin the English are
    // untouched while the screen that knows the reader's language can pass it.
    locale: String? = null,
): String = when (phase) {
    OngoingPhase.RINGING -> AppStrings.translate(locale, "contactsTasks.ringing")
    OngoingPhase.DIALING -> AppStrings.translate(locale, "contactsTasks.phaseCalling")
    OngoingPhase.VOICEMAIL ->
        AppStrings.translate(locale, "contactsTasks.leavingVoicemail")

    OngoingPhase.ANSWERED ->
        memberName?.takeIf { it.isNotBlank() }
            ?.let {
                AppStrings.translate(locale, "contactsTasks.withMember", mapOf("who" to it))
            }
            ?: AppStrings.translate(locale, "contactsTasks.onTheLine")
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

/** #691: the log without a deleted call. */
internal fun withoutCall(calls: List<Call>, callId: String): List<Call> =
    calls.filterNot { it.id == callId }

/**
 * #691: a call whose voicemail went to the Trash. The call stays in the log;
 * the recording, its length, its words and what was pulled from them do not.
 */
internal fun withoutVoicemail(call: Call): Call = call.copy(
    voicemail_seconds = null,
    voicemail_transcript = null,
    voicemail_intake = null,
)

internal fun withoutVoicemail(calls: List<Call>, callId: String): List<Call> =
    calls.map { if (it.id == callId) withoutVoicemail(it) else it }

/**
 * #691: Undo puts the call back where its start time belongs, newest first,
 * so a restore from deep in the log does not wait for the next full read.
 */
internal fun reinsertCall(calls: List<Call>, call: Call): List<Call> =
    if (calls.any { it.id == call.id }) {
        calls.map { if (it.id == call.id) call else it }
    } else {
        (calls + call).sortedByDescending { it.started_at }
    }
