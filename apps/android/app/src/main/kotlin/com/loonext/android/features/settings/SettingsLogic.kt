package com.loonext.android.features.settings

import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.Usage
import java.time.Instant
import java.util.Locale

/**
 * Pure settings logic (#157): the client-side mirrors of the server's seat
 * formula, role matrix, CNAM rule, and cap semantics — plus the shared
 * merge-field substituter's drop-empty behavior. Everything here is unit
 * tested; the composables render it.
 */

// ---------------------------------------------------------------------------
// Role matrix (SPEC §10, mirrored client-side; the server independently 403s)
// ---------------------------------------------------------------------------

object SettingsRoleGate {
    /** Workspace name/timezone/hours/away/calling writes — admin+. */
    fun canEditWorkspace(role: String?): Boolean = MemberRole.atLeast(role, MemberRole.ADMIN)

    /** Invite / role change / deactivate — admin+ (owner row immutable). */
    fun canManageTeam(role: String?): Boolean = MemberRole.atLeast(role, MemberRole.ADMIN)

    /** Buy/port/text-enable numbers, registration writes — admin+. */
    fun canManageNumbers(role: String?): Boolean = MemberRole.atLeast(role, MemberRole.ADMIN)

    /** #106 per-number access dialog — admin+. */
    fun canManageNumberAccess(role: String?): Boolean = MemberRole.atLeast(role, MemberRole.ADMIN)

    /** Plan change, modules, portal/checkout — admin+. */
    fun canManageBilling(role: String?): Boolean = MemberRole.atLeast(role, MemberRole.ADMIN)

    /** Overage cap — OWNER only. */
    fun canChangeOverageCap(role: String?): Boolean = role == MemberRole.OWNER

    /** Release a number for good — OWNER only. */
    fun canReleaseNumber(role: String?): Boolean = role == MemberRole.OWNER

    /** Cancel a port-in — OWNER only. */
    fun canCancelPort(role: String?): Boolean = role == MemberRole.OWNER

    /** Cancel a text-enablement — OWNER only. */
    fun canCancelTextEnablement(role: String?): Boolean = role == MemberRole.OWNER

    /** CA workspace turning on US texting ($29) — OWNER only. */
    fun canEnableUsTexting(role: String?): Boolean = role == MemberRole.OWNER

    /** A member's role can change only between admin and member, by an
     *  admin+, never their own owner row and never a deactivated row. */
    fun canChangeRoleOf(actorRole: String?, target: Member): Boolean =
        canManageTeam(actorRole) &&
            target.role != MemberRole.OWNER &&
            target.deactivated_at == null

    fun canDeactivate(actorRole: String?, target: Member, selfUserId: String): Boolean =
        canManageTeam(actorRole) &&
            target.role != MemberRole.OWNER &&
            target.deactivated_at == null &&
            target.user_id != selfUserId
}

// ---------------------------------------------------------------------------
// Seat math
// ---------------------------------------------------------------------------
// #392: the server SENDS the allowance now (CompanyView.seat_limit). Starter 3
// / Pro 15 was written out four times in four languages, it had already moved
// twice, and it is a pricing lever rather than an architectural fact — pulling
// it should not require an App Store review before it is true everywhere.
//
// The literal below is now only the offline fallback, used when this client has
// never successfully loaded a company. A stale fallback while disconnected is a
// far smaller hazard than four authoritative copies, and it makes the drift
// visible rather than silent.

/**
 * The ONE place these integers are written in Kotlin (#392).
 *
 * They were in three: here, `planFacts`, and BillingSection's downgrade gate.
 * The downgrade one is the nastiest — a native gate that disagrees with the
 * API blocks or permits a plan change the server does not, so an owner is
 * either stopped from downgrading for no reason or told they may and then
 * refused.
 */
const val STARTER_SEATS = 3
const val PRO_SEATS = 15

/** Fallback allowance ONLY. Prefer `CompanyView.seat_limit` from the server. */
fun seatLimit(plan: String?): Int = if (plan == "pro") PRO_SEATS else STARTER_SEATS

/** Active members — the API's filter (`deactivated_at IS NULL`). */
fun countActiveMembers(members: List<Member>): Int =
    members.count { it.deactivated_at == null }

/** Pending invites — the API's exact formula (not accepted/revoked/expired). */
fun pendingInviteCount(invites: List<Invite>, now: Instant = Instant.now()): Int =
    invites.count { invite ->
        invite.accepted_at == null &&
            invite.revoked_at == null &&
            runCatching { Instant.parse(invite.expires_at) }
                .getOrNull()?.isAfter(now) == true
    }

data class SeatUsage(
    val used: Int,
    val limit: Int,
    val full: Boolean,
    /** Full AND there is a bigger self-serve plan: show the upgrade action. */
    val canUpgrade: Boolean,
    /** The G8 seat line, e.g. "2 of 3 seats. Upgrade for more". */
    val line: String,
)

/**
 * @param servedLimit the server's allowance ([CompanyView.seat_limit]). Wins
 *   whenever we have it; the plan-derived fallback is for a client that has
 *   never loaded. A client number HIGHER than the API's tells an owner they
 *   have room and then the invite is refused, at the exact moment they are
 *   trying to add somebody.
 */
fun seatUsage(
    activeMembers: Int,
    pendingInvites: Int,
    plan: String?,
    servedLimit: Int? = null,
): SeatUsage {
    val limit = if (servedLimit != null && servedLimit > 0) servedLimit else seatLimit(plan)
    val used = activeMembers + pendingInvites
    val full = used >= limit
    val canUpgrade = full && plan != "pro"
    val line =
        if (canUpgrade) "$used of $limit seats. Upgrade for more"
        else "$used of $limit seats"
    return SeatUsage(used = used, limit = limit, full = full, canUpgrade = canUpgrade, line = line)
}

// ---------------------------------------------------------------------------
// CNAM (carrier rule: 1-15 letters, digits, or spaces)
// ---------------------------------------------------------------------------

private val CNAM_PATTERN = Regex("^[A-Za-z0-9 ]{1,15}$")

fun isValidCnam(value: String): Boolean = CNAM_PATTERN.matches(value)

/**
 * #193 mirror of the server's sanitizer (telnyx/voice.ts): the company name
 * reduced to the carrier CNAM alphabet — punctuation drops, whitespace
 * collapses, 15-char cut, no trailing space. Empty when nothing survives.
 */
fun cnamFromCompanyName(name: String): String = name
    .replace(Regex("[^A-Za-z0-9 ]+"), " ")
    .replace(Regex("\\s+"), " ")
    .trim()
    .take(15)
    .trim()

/** #193: how long a submitted CNAM change reads as "on its way" (carriers
 *  take 1 to 3 days and report no completion, so this mirrors that window). */
private const val CNAM_PROPAGATION_MS: Long = 3L * 24 * 60 * 60 * 1000

fun cnamChangePending(submittedAtIso: String?, now: Instant = Instant.now()): Boolean {
    if (submittedAtIso == null) return false
    val submitted = runCatching { java.time.OffsetDateTime.parse(submittedAtIso).toInstant() }
        .getOrNull()
        ?: runCatching { Instant.parse(submittedAtIso) }.getOrNull()
        ?: return false
    return now.toEpochMilli() - submitted.toEpochMilli() < CNAM_PROPAGATION_MS
}

// ---------------------------------------------------------------------------
// Overage cap — mirror of web lib/settings/cap-control.ts (#42 honesty:
// there is no "no cap"; null clamps to the 10× hard ceiling)
// ---------------------------------------------------------------------------

const val MAX_CAP_MULTIPLIER = 10.0


fun normalizeCapMultiplier(value: Double?): Double =
    if (value != null && value.isFinite() && value > 0) minOf(value, MAX_CAP_MULTIPLIER)
    else MAX_CAP_MULTIPLIER

/** "2×", "2.5×", or "Maximum (10×)" for the ceiling. */
fun capLabel(multiplier: Double?): String {
    if (multiplier == null || multiplier >= MAX_CAP_MULTIPLIER) return "Maximum (10×)"
    val whole = multiplier.toLong()
    return if (multiplier == whole.toDouble()) "$whole×"
    else "${multiplier.toString().trimEnd('0').trimEnd('.')}×"
}

/** Segments allowed under a cap — mirrors GET /v1/usage's Math.round. */
fun capSegments(includedSegments: Long, multiplier: Double?): Long =
    Math.round(includedSegments * normalizeCapMultiplier(multiplier))

/**
 * #178: which meter runs hot in the 'pacing' state, named plainly. Compares
 * each meter's use of its own allowance; names both only when both are past
 * their included amounts. Always a plural noun phrase, so "are" follows.
 */
fun pacingSubject(usage: Usage): String {
    val messages =
        if (usage.included_segments > 0) {
            usage.used_segments.toDouble() / usage.included_segments
        } else {
            0.0
        }
    val minutes =
        if (usage.voice.included_minutes > 0) {
            usage.voice.used_minutes.toDouble() / usage.voice.included_minutes
        } else {
            0.0
        }
    return when {
        messages >= 1.0 && minutes >= 1.0 -> "Messages and calling minutes"
        minutes > messages -> "Calling minutes"
        else -> "Messages"
    }
}

/** #178 'capped': how far along the owner-set spending cap the hotter meter is. */
fun capUseRatio(usage: Usage): Double {
    val capSegments = usage.cap_segments
    val messages =
        if (capSegments != null && capSegments > 0) {
            usage.used_segments.toDouble() / capSegments
        } else {
            0.0
        }
    val capMinutes = usage.voice.cap_minutes
    val minutes =
        if (capMinutes != null && capMinutes > 0) {
            usage.voice.used_minutes.toDouble() / capMinutes
        } else {
            0.0
        }
    return maxOf(messages, minutes)
}

/** Whole-percent cap use for display, clamped to 100. */
fun capUsePercent(usage: Usage): Int =
    (capUseRatio(usage) * 100).toInt().coerceIn(0, 100)

data class CapChange(
    val requiresConfirmation: Boolean,
    /** Dialog title, e.g. "Set the cap to 3×?". */
    val title: String,
    /** One sentence naming the new pause point ("" when nothing changes). */
    val summary: String,
)

/** Group digits like JS toLocaleString ("2,500"). */
fun groupDigits(value: Long): String = String.format(Locale.US, "%,d", value)

/**
 * Confirm-dialog copy for a cap change — mirrors describeCapChange in the
 * web's cap-control.ts so both clients promise the same pause point.
 */
fun describeCapChange(current: Double?, next: Double?, includedSegments: Long): CapChange {
    val currentValue = normalizeCapMultiplier(current)
    val nextValue = normalizeCapMultiplier(next)
    if (currentValue == nextValue) {
        return CapChange(requiresConfirmation = false, title = "", summary = "")
    }
    val nextTotal = capSegments(includedSegments, nextValue)
    val currentTotal = capSegments(includedSegments, currentValue)
    val title = "Set the cap to ${capLabel(nextValue)}?"
    if (nextValue > currentValue) {
        val atCeiling = nextValue >= MAX_CAP_MULTIPLIER
        val summary = if (atCeiling) {
            "Sending pauses at ${groupDigits(nextTotal)} messages this period instead of " +
                "${groupDigits(currentTotal)}. That's the highest the cap goes. Every message " +
                "over your ${groupDigits(includedSegments)} included is billed at the overage " +
                "rate until sending pauses."
        } else {
            "Sending pauses at ${groupDigits(nextTotal)} messages this period instead of " +
                "${groupDigits(currentTotal)}."
        }
        return CapChange(requiresConfirmation = true, title = title, summary = summary)
    }
    return CapChange(
        requiresConfirmation = true,
        title = title,
        summary = "Sending pauses at ${groupDigits(nextTotal)} messages this period. " +
            "If you're already past that, sends pause right away.",
    )
}

// ---------------------------------------------------------------------------
// Merge fields — byte-for-byte mirror of packages/shared/src/merge-fields.ts
// (drop-empty semantics: unknown/empty tokens vanish and whitespace tidies)
// ---------------------------------------------------------------------------

/** The sample name used to show {first_name} resolving in a preview. */
const val SAMPLE_FIRST_NAME = "Dana"

private val TOKEN_PATTERN = Regex("\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}")

private fun firstNameOf(contactName: String?): String {
    val trimmed = contactName?.trim().orEmpty()
    if (trimmed.isEmpty()) return ""
    return trimmed.split(Regex("\\s+")).firstOrNull().orEmpty()
}

private fun tidyDroppedTokens(text: String): String = text
    .replace(Regex("[ \\t]+([,.;:!?])"), "$1")
    .replace(Regex("[ \\t]{2,}"), " ")
    .replace(Regex("[ \\t]+$", RegexOption.MULTILINE), "")
    .replace(Regex("^[ \\t]+", RegexOption.MULTILINE), "")

/**
 * Substitute {first_name}/{business_name}; unknown or empty tokens are
 * dropped cleanly — exactly what the server does at send time.
 */
fun applyMergeFields(text: String, contactName: String?, businessName: String?): String {
    if (!text.contains("{")) return text
    var anyDropped = false
    val substituted = TOKEN_PATTERN.replace(text) { match ->
        val replacement = when (match.groupValues[1].lowercase()) {
            "first_name" -> firstNameOf(contactName)
            "business_name" -> businessName?.trim().orEmpty()
            else -> ""
        }
        if (replacement.isEmpty()) anyDropped = true
        replacement
    }
    return if (anyDropped) tidyDroppedTokens(substituted) else substituted
}

// ---------------------------------------------------------------------------
// Voicemail default — mirror of apps/api messaging/inbound-ring.ts
// ---------------------------------------------------------------------------

/** The greeting spoken when the owner has not written one. */
fun defaultVoicemailGreeting(companyName: String): String =
    "You've reached $companyName. We can't take your call right now. " +
        "Please leave a message after the beep, or hang up and text us at this number."

// ---------------------------------------------------------------------------
// Number status honesty — mirror of web components/settings/number-card.tsx
// ---------------------------------------------------------------------------

/** A provision_failed row the auto-retry loop can't fix — needs a new pick. */
fun needsNumberChoice(number: PhoneNumberSummary): Boolean =
    number.status == NumberStatus.PROVISION_FAILED &&
        (number.failure_reason == "no_inventory" || (number.provision_attempts ?: 0) >= 5)

/**
 * What to say while a number is still being set up, tiered on how long it has
 * actually been. The flat "usually under a minute" line was true for the first
 * minute and a lie for every one after it, and a number that stalls is exactly
 * when a stale promise reads worst. The web twin is provisioningWaitCopy in
 * apps/web/src/components/registration/copy.ts.
 */
fun provisioningWaitCopy(createdAtIso: String?, nowMillis: Long): String {
    val created = createdAtIso?.let {
        runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull()
    }
    val elapsed = created?.let { nowMillis - it } ?: 0L
    return when {
        elapsed >= 4 * 60_000L ->
            "Your number is taking a little longer than usual. We're still on it, " +
                "you don't have to wait here."

        elapsed >= 90_000L ->
            "Still setting up your number, this is taking a little longer than " +
                "usual. Hang tight."

        else -> "We're setting up your number. This usually takes under a minute."
    }
}

/** Honest, reason-driven copy for a provision_failed number. */
fun failedNumberCopy(number: PhoneNumberSummary): String = when {
    !needsNumberChoice(number) ->
        "We're still setting up your number. This is taking a little longer than usual."

    number.failure_reason == "timeout" ->
        "Setup is taking longer than expected. Choose a number to finish. " +
            "You won't be charged again."

    number.failure_reason == "no_inventory" && number.requested_area_code != null ->
        "Area code ${number.requested_area_code} is out of new numbers right now. " +
            "Choose another number to finish setup."

    else -> "We couldn't finish setting up your number. Choose a number to try again."
}

// ---------------------------------------------------------------------------
// Business hours (weekday map mon..sun → { open, close } HH:MM, null=closed)
// ---------------------------------------------------------------------------

val WEEKDAY_KEYS = listOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")

val WEEKDAY_LABELS = mapOf(
    "mon" to "Monday", "tue" to "Tuesday", "wed" to "Wednesday", "thu" to "Thursday",
    "fri" to "Friday", "sat" to "Saturday", "sun" to "Sunday",
)

private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

fun isValidHhmm(value: String): Boolean = HHMM.matches(value)

/**
 * A day window is valid when both ends parse and differ. The server supports
 * overnight windows (close < open, e.g. 18:00–02:00) but reads open == close
 * as closed all day — an enabled row saying that would lie, so block it here.
 */
fun isValidDayWindow(open: String, close: String): Boolean =
    isValidHhmm(open) && isValidHhmm(close) && open != close

/** "09:00" → "9:00 AM" for the grid's human labels. */
fun formatHhmm(value: String): String {
    if (!isValidHhmm(value)) return value
    val hour = value.substring(0, 2).toInt()
    val minute = value.substring(3)
    val suffix = if (hour < 12) "AM" else "PM"
    val display = when {
        hour == 0 -> 12
        hour > 12 -> hour - 12
        else -> hour
    }
    return "$display:$minute $suffix"
}

// ---------------------------------------------------------------------------
// Number picker digit filter (client-side "contains" over national digits)
// ---------------------------------------------------------------------------

fun matchesDigitFilter(e164: String, filter: String): Boolean {
    val digits = filter.filter(Char::isDigit)
    if (digits.isEmpty()) return true
    val national = e164.removePrefix("+1").filter(Char::isDigit)
    return national.contains(digits)
}

// ---------------------------------------------------------------------------
// Port tracker stepper
// ---------------------------------------------------------------------------

val PORT_STEPS = listOf("Draft", "Submitted", "In progress", "Ported")

/** Index into [PORT_STEPS] for the calm 4-step tracker; -1 = terminal/off-track. */
fun portStepIndex(status: String): Int = when (status) {
    PortStatus.DRAFT -> 0
    PortStatus.SUBMITTED, PortStatus.EXCEPTION -> 1
    PortStatus.IN_PROCESS, PortStatus.FOC_DATE_CONFIRMED,
    PortStatus.ACTIVATION_IN_PROGRESS,
    -> 2

    PortStatus.PORTED -> 3
    else -> -1
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "$5" for 500 cents, "$7.50" for 750 — whole dollars drop the cents. */
fun formatMonthlyCents(cents: Long): String {
    val dollars = cents / 100.0
    return if (cents % 100 == 0L) "$${cents / 100}"
    else "$" + String.format(Locale.US, "%.2f", dollars)
}

/** "$12.34" — always two decimals (projected overage dollars). */
fun formatCents(cents: Long): String =
    "$" + String.format(Locale.US, "%.2f", cents / 100.0)

/** Human bytes: "0 B", "412 KB", "1.2 GB". */
fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return "${Math.round(kb)} KB"
    val mb = kb / 1024.0
    if (mb < 1024) return if (mb < 10) String.format(Locale.US, "%.1f MB", mb)
    else "${Math.round(mb)} MB"
    val gb = mb / 1024.0
    return String.format(Locale.US, "%.1f GB", gb)
}

/** The shareable invite accept link (same origin the web copies). */
fun inviteLink(inviteId: String): String = "https://app.loonext.com/invite/$inviteId"

/** Plan display facts (SPEC §2, mirrored from web plan-facts.ts). */
data class PlanFacts(
    val name: String,
    val price: String,
    val seats: Int,
    val numbers: Int,
    val voiceMinutes: Int,
)

fun planFacts(plan: String?): PlanFacts? = when (plan) {
    "starter" -> PlanFacts("Starter", "$29/mo", STARTER_SEATS, 1, 2500)
    "pro" -> PlanFacts("Pro", "$79/mo", PRO_SEATS, 2, 6000)
    else -> null
}

/** Included outbound segments (SPEC §2) — for downgrade checklists only;
 *  live figures always come from GET /v1/usage. */
fun planIncludedSegments(plan: String?): Long = when (plan) {
    "pro" -> 2500L
    "starter" -> 500L
    else -> 0L
}

// ---------------------------------------------------------------------------
// #414 emergency keyword — mirror of packages/shared/src/emergency.ts
// ---------------------------------------------------------------------------

/** The words the away-message default asks a homeowner to send. */
val EMERGENCY_KEYWORDS = listOf("URGENT", "EMERGENCY", "911", "SOS")

/**
 * The §5/D3 carrier keywords, answered by Telnyx before we see them. "Reply
 * STOP to unsubscribe" is required compliance copy, so naming it unrecognised
 * would be both wrong and the fastest way to teach an owner to ignore this
 * warning. Mirrors `CARRIER_REPLY_KEYWORDS` in shared.
 */
val CARRIER_REPLY_KEYWORDS = listOf(
    "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT",
    "START", "UNSTOP", "YES",
    "HELP", "INFO",
)

/**
 * True when OWNER-AUTHORED copy still invites the emergency reply.
 *
 * Reads what the owner wrote, not what a customer sent, so it must not
 * UNDER-fire: missing an invitation means the settings screen tells an owner
 * their message is fine while it promises a callback nothing will make. That
 * is the whole of #414, re-created by the owner's own hand.
 *
 * The boundaries are `\\b` in SOURCE, which is `\b` in the pattern. Written as
 * "\b" they would be a literal BACKSPACE — Kotlin's own escape — and the regex
 * would never match anything, leaving this function silently returning false
 * for every message and the warning permanently invisible.
 */
fun mentionsEmergencyKeyword(copy: String): Boolean = EMERGENCY_KEYWORDS.any { keyword ->
    Regex("\\b$keyword\\b", RegexOption.IGNORE_CASE).containsMatchIn(copy)
}

/**
 * Owners capitalise the word they want sent back. The verb matches
 * case-insensitively; the WORD's capitalisation is checked separately, since
 * it is the only thing telling a keyword instruction apart from a sentence
 * that merely contains "reply".
 */
private val REPLY_INSTRUCTION = Regex(
    """\b(?:reply|replying|text|respond|send)\s+(?:back\s+)?(?:with\s+)?["'“‘]?([A-Za-z0-9]{2,15})\b""",
    RegexOption.IGNORE_CASE,
)

private val ALL_CAPS_WORD = Regex("^[A-Z]{2,}$")

/**
 * #453 — the word an owner told customers to send that nothing listens for.
 * Returns it so the screen can quote it back; an owner cannot fix what we
 * will not name. Mirror of `unrecognizedReplyKeyword` in shared.
 */
fun unrecognizedReplyKeyword(copy: String): String? {
    for (match in REPLY_INSTRUCTION.findAll(copy)) {
        val raw = match.groupValues[1]
        val word = raw.uppercase()
        if (word in EMERGENCY_KEYWORDS || word in CARRIER_REPLY_KEYWORDS) continue
        if (raw != word || !ALL_CAPS_WORD.matches(word)) continue
        return word
    }
    return null
}

/** How loudly the away-reply screen should speak. */
enum class AwayNoticeTone { Warn, Hint }

/** What the away-reply screen should say about the emergency path, if anything. */
data class AwayEmergencyNotice(val tone: AwayNoticeTone, val text: String)

/**
 * #453 — the one decision every client renders, so all three say the SAME
 * thing. Mirror of `awayEmergencyNotice` in shared; keep the copy identical.
 */
fun awayEmergencyNotice(
    emergencyEnabled: Boolean,
    awayMessage: String,
): AwayEmergencyNotice? {
    val invites = mentionsEmergencyKeyword(awayMessage)
    val unknown = unrecognizedReplyKeyword(awayMessage)

    if (!emergencyEnabled) {
        if (!invites && unknown == null) return null
        return AwayEmergencyNotice(
            AwayNoticeTone.Warn,
            "Your away message tells customers to reply for an emergency, but nothing " +
                "will treat that reply as one. Turn this back on, or take the offer out of " +
                "the message.",
        )
    }

    if (unknown != null) {
        return AwayEmergencyNotice(
            AwayNoticeTone.Warn,
            "Your away message tells customers to reply $unknown, which nothing " +
                "watches for. Use URGENT, EMERGENCY, 911 or SOS instead, or take the offer " +
                "out of the message.",
        )
    }

    if (!invites) {
        return AwayEmergencyNotice(
            AwayNoticeTone.Hint,
            "Nobody has been told they can. Mention it in your away message if you " +
                "want customers to know.",
        )
    }

    return null
}
