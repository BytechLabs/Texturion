package com.loonext.android.features.settings

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.Usage
import com.loonext.android.ui.common.absoluteTime
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

    /**
     * Plan change, modules, portal/checkout — `billing.manage`, which is
     * admin+ AND the bookkeeper preset (#315). Asked as an axis rather than a
     * rank because the bookkeeper is not on the rank line: a rank check here
     * would hand them the one screen their role exists for and then refuse
     * every button on it.
     */
    fun canManageBilling(role: String?): Boolean =
        MemberRole.has(role, Capability.BILLING_MANAGE)

    /**
     * End the subscription — OWNER only, because that is what the hosted
     * portal actually offers.
     *
     * POST /v1/billing/portal mints a full portal session for an owner and a
     * `payment_method_update` one for everybody else, and the card-update flow
     * has no cancellation surface at all. A bookkeeper told to "cancel from the
     * payment portal" arrives at a page with no such button and no explanation,
     * which is the worst version of this screen: it reads as friction we put
     * there on purpose.
     */
    fun canCancelSubscription(role: String?): Boolean = role == MemberRole.OWNER

    /** Overage cap — OWNER only. */
    fun canChangeOverageCap(role: String?): Boolean = role == MemberRole.OWNER

    /** Release a number for good — OWNER only. */
    fun canReleaseNumber(role: String?): Boolean = role == MemberRole.OWNER

    /** Cancel a port-in — OWNER only. */
    fun canCancelPort(role: String?): Boolean = role == MemberRole.OWNER

    /** Cancel a text-enablement — OWNER only. */
    fun canCancelTextEnablement(role: String?): Boolean = role == MemberRole.OWNER

    /** CA workspace turning on US texting ([usRegistrationFee]) — OWNER only. */
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

/**
 * Business numbers per plan — mirror of `PLAN_NUMBERS` in
 * packages/shared/src/seats.ts.
 *
 * Here for the same reason the seat counts are, and it arrived later because
 * nothing outside the API needed to SAY the number until a cancel screen had to
 * name what Starter actually covers. It is a real limit rather than a marketing
 * figure: POST /v1/billing/change-plan refuses a downgrade while the workspace
 * holds more numbers than this, so an offer that named a different count would
 * be describing a plan the server will not sell.
 */
const val STARTER_NUMBERS = 1
const val PRO_NUMBERS = 2

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

/**
 * #521: the joining note's ceiling, matching the column's CHECK and the API's
 * schema. Stopping the field here turns a 422 into a box that simply stops
 * taking characters, which is the difference between a limit and a rejection.
 */
const val INVITE_NOTE_MAX = 500

/**
 * The note as the invite body should carry it, or null for "there is none".
 *
 * A field somebody opened and left alone, and a field they never touched, are
 * the same invite. Collapsing whitespace-only to null here is what keeps them
 * that way on this client, so nothing downstream has to ask whether `""` meant
 * anything.
 *
 * Takes a nullable because the same question is asked of a note coming BACK
 * from the server, where "there is none" arrives as null. One rule for both
 * directions is what stops a pending row drawing quotation marks around a
 * blank the form would never have sent.
 */
fun inviteNoteOrNull(typed: String?): String? = typed?.trim()?.ifEmpty { null }

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
 * #178: which meter runs hot in the 'pacing' state. Compares each meter's use
 * of its own allowance; names both only when both are past their included
 * amounts. Always a plural noun phrase, so "are" follows.
 *
 * #228 SPLIT THE DECISION FROM THE WORD, and it is one function rather than
 * two copies of the comparison on purpose — a rule written twice is a rule that
 * drifts, and this one decides what a customer is told about their bill.
 */
fun pacingSubjectKey(usage: Usage): String {
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
        messages >= 1.0 && minutes >= 1.0 -> "settingsMore.pacingBoth"
        minutes > messages -> "settingsMore.pacingMinutes"
        else -> "settingsMore.pacingMessages"
    }
}

/**
 * The same answer in words, for one locale. Pass null outside composition and
 * it reads English, which is what every caller did before there was a choice.
 */
fun pacingSubject(usage: Usage, locale: String? = null): String =
    AppStrings.translate(locale, pacingSubjectKey(usage))

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
/**
 * Money in the reader's OWN currency: a bare "$", always two decimals.
 *
 * #522: the bare sign is correct here and the reason is worth stating, because
 * the neighbouring [formatMoney] exists precisely to add a "US$"/"CA$" prefix.
 * Every figure this formats is the workspace's own money — `GET /v1/usage` prices
 * the segment overage, the voice overage and the month-end projection at
 * `OVERAGE_CENTS_PER_SEGMENT[their currency]` — and a Canadian reading their own
 * invoice should see "$40.00", not "CA$40.00". The qualifier belongs on a
 * FOREIGN price.
 *
 * So this is only right as long as the amount really is the reader's currency.
 * Use [formatMoney] for anything filed in one currency and quoted to everybody,
 * like the USD-only extra-number line.
 */
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

/**
 * The plan card's facts, in the currency this workspace is actually charged.
 *
 * #328: the price used to be the literal "$29/mo" / "$79/mo", which is the USD
 * price and only the USD price. `api_create_company` sets `billing_currency`
 * to 'cad' for every Canadian workspace and the column is `not null default
 * 'usd'`, so a Canadian owner was reading "Pro · $79/mo" against a Canadian
 * invoice for $109 — and, once the cancellation answer landed below it,
 * against "Starter is $39 a month instead of $109" an inch further down the
 * same card. One of the two was provably wrong and both were on screen at
 * once.
 *
 * THE CURRENCY IS A REQUIRED ARGUMENT, not a defaulted one. A default would
 * silently answer USD for the next caller that forgets, which is exactly the
 * failure this changed. Both call sites hold a `CompanyView` and can answer.
 * Mirrors `planFactsFor(currency)` in web's plan-facts.ts, whose comment names
 * this same contradiction.
 *
 * @param billingCurrency `companies.billing_currency` — what the card is
 *   charged. Wins whenever it is one we bill in.
 * @param country `companies.country`, consulted ONLY when there is no stored
 *   currency: `checkout-currency.ts` bills a Canadian workspace in USD when
 *   the Stripe catalog cannot honour CAD, so the country alone would print a
 *   CAD price to somebody whose card is charged in US dollars.
 */
fun planFacts(
    plan: String?,
    billingCurrency: String?,
    country: String?,
): PlanFacts? = when (plan) {
    "starter" -> PlanFacts(
        name = "Starter",
        price = planPrice("starter", billingCurrency, country),
        seats = STARTER_SEATS,
        numbers = STARTER_NUMBERS,
        voiceMinutes = 2500,
    )

    "pro" -> PlanFacts(
        name = "Pro",
        price = planPrice("pro", billingCurrency, country),
        seats = PRO_SEATS,
        numbers = PRO_NUMBERS,
        voiceMinutes = 6000,
    )

    else -> null
}

/** "$29/mo" or "$39/mo" — the same price book both routes charge from. */
private fun planPrice(plan: String, billingCurrency: String?, country: String?): String {
    val currency = resolveBillingCurrency(billingCurrency, country)
    return formatMoney(PLAN_PRICE_CENTS.getValue(currency).getValue(plan), currency) + "/mo"
}

/**
 * What the plan card lists under the plan name — the terms of a plan that is
 * RUNNING.
 *
 * #524: out of the composable, because these five sentences are a claim about
 * what this workspace may do today and the branch that decides whether to print
 * them is one of the things that regressed. Inside a `forEach` in a card body
 * they could only be guarded by reading the file as text; here a test can render
 * the screen and ask whether these exact lines are on it, and the answer is the
 * same strings the screen paints rather than a phrase retyped into an assertion.
 *
 * Every line is either a fact about the plan or a limit on it — none of them is
 * true of a paused or a lapsed workspace, which is why the render site gates
 * them on the pause read rather than on "we have no pause in hand".
 */
fun planAllowanceLines(facts: PlanFacts, locale: String? = null): List<String> = listOf(
    AppStrings.translate(locale, "settings.planLineTexting"),
    AppStrings.translate(locale, "settings.planLineCalling"),
    AppStrings.translate(locale, "settings.planLineExtraTexts"),
    AppStrings.translate(locale, "settings.planLineSeats", mapOf("count" to facts.seats.toString())),
    // #228: the plural is TWO KEYS rather than an English "s" appended to a
    // translated stem. French forms this one the same way, which is exactly why
    // the append looks safe and is not — the next language to arrive would get
    // an English suffix welded onto its own noun, and nothing would fail.
    AppStrings.translate(
        locale,
        if (facts.numbers == 1) "settings.planLineNumberOne" else "settings.planLineNumbers",
        mapOf("count" to facts.numbers.toString()),
    ),
)

/** Included outbound segments (SPEC §2) — for downgrade checklists only;
 *  live figures always come from GET /v1/usage. */
fun planIncludedSegments(plan: String?): Long = when (plan) {
    "pro" -> 2500L
    "starter" -> 500L
    else -> 0L
}

// ---------------------------------------------------------------------------
// #277 — why a workspace is leaving, asked once, before the Stripe handoff
// ---------------------------------------------------------------------------

/**
 * One answer: the code the API stores, and the KEY of the words the owner
 * reads.
 *
 * #228: a key rather than a sentence, because this list is built outside
 * composition — it is a top-level `val` — and `t()` is @Composable. The row
 * that renders it resolves the key, which is the same shape `AuthError.Ours`
 * and `ApiException.messageKey` use, and the one `CatalogueKeysTest` already
 * walks the sources for.
 */
data class CancellationReason(val code: String, val labelKey: String)

/**
 * The six answers, in this order, identical on every client.
 *
 * Order is not ranking and must not become one: it runs from the reason we can
 * do something about to the reason we cannot, and reordering it to put a
 * "winnable" answer first would be tuning the question to flatter the report.
 *
 * The codes are what land in the database and what every count is grouped by,
 * so they are frozen. Change a LABEL freely; changing a code silently splits
 * one reason into two in every report that spans the change.
 */
val CANCELLATION_REASONS: List<CancellationReason> = listOf(
    CancellationReason("too_expensive", "settings.cancelReasonTooExpensive"),
    CancellationReason("seasonal", "settings.cancelReasonSeasonal"),
    CancellationReason("missing_feature", "settings.cancelReasonMissingFeature"),
    CancellationReason("switched", "settings.cancelReasonSwitched"),
    CancellationReason("not_using", "settings.cancelReasonNotUsing"),
    CancellationReason("other", "settings.cancelReasonOther"),
)

/** The API's ceiling on the free-text half (`detail`, trimmed then max 2000). */
const val CANCELLATION_DETAIL_MAX = 2000

/** The API's ceiling on the code (`reason`, trimmed then max 40). */
const val CANCELLATION_REASON_MAX = 40

/**
 * What POST /v1/billing/cancellation-reason should carry. Both halves nullable:
 * neither is required, and a statement with nothing in it is the honest record
 * that somebody was asked and chose not to answer.
 */
data class CancellationStatement(val reason: String?, val detail: String?)

/**
 * Normalise what the screen holds into what the wire should carry.
 *
 * Blank collapses to null so "opened the box and typed nothing" and "never
 * touched the box" store the same row — otherwise every report has to know that
 * `""` means nothing, forever.
 *
 * The clamp matters more than it looks. Over-length is a 422, and this call is
 * deliberately never awaited, so a rejected body would fail INVISIBLY: the
 * person cancels, the screen behaves perfectly, and the sentence they took the
 * trouble to write is simply never stored.
 */
fun cancellationStatement(code: String?, typedDetail: String?): CancellationStatement =
    CancellationStatement(
        reason = code?.trim()?.ifEmpty { null }?.take(CANCELLATION_REASON_MAX),
        detail = typedDetail?.trim()?.ifEmpty { null }?.take(CANCELLATION_DETAIL_MAX),
    )

// ---------------------------------------------------------------------------
// #328 billing currency — mirror of packages/shared/src/billing-currency.ts
// ---------------------------------------------------------------------------

/** The currencies a workspace can be billed in. */
enum class BillingCurrency { USD, CAD }

/**
 * Flat monthly plan price in the minor unit of each currency.
 *
 * The CAD figures are DECIDED, not converted — see the shared module. Copied
 * here rather than derived from a rate for exactly that reason: a rate would
 * make this screen quote a different number every month.
 *
 * `internal` rather than private so `CancellationOfferTest` can compare these
 * four integers against `PLAN_PRICE_CENTS` in
 * packages/shared/src/billing-currency.ts. A hand-ported price book with no
 * cross-language check is a repricing away from quoting last quarter's figure
 * at somebody standing on the cancel screen because of the figure.
 */
internal val PLAN_PRICE_CENTS: Map<BillingCurrency, Map<String, Int>> = mapOf(
    BillingCurrency.USD to mapOf("starter" to 2900, "pro" to 7900),
    BillingCurrency.CAD to mapOf("starter" to 3900, "pro" to 10900),
)

/**
 * The one-time US texting registration fee — mirror of
 * `US_REGISTRATION_FEE_CENTS` in packages/shared/src/billing-currency.ts.
 *
 * THE CAD ROW IS THE ONE THAT GETS READ, and that is why this constant had to
 * exist here at all. The only screen on this client that quotes the fee is the
 * enable-US card, and it is drawn for `country == "CA" && !us_texting_enabled`
 * — so every reader of that sentence is Canadian, and `api_create_company` sets
 * `billing_currency` to 'cad' for a Canadian workspace against a column that is
 * `not null default 'usd'`. The card said "$29" and the invoice said CA$39, on
 * the one button whose whole purpose is to get consent to that charge.
 *
 * The USD row is not dead weight: a Canadian workspace grandfathered onto USD
 * billing, or one `checkout-currency.ts` had to fall back to USD for because
 * the Stripe catalog could not honour CAD, is genuinely charged in US dollars
 * and must read the US figure.
 *
 * `internal` for the same reason [PLAN_PRICE_CENTS] is: `RegistrationFeeTest`
 * compares these two integers against the TypeScript. A hand-ported price with
 * no cross-language check is one repricing away from naming a figure on the
 * button that authorises a charge and billing a different one.
 */
internal val US_REGISTRATION_FEE_CENTS: Map<BillingCurrency, Int> = mapOf(
    BillingCurrency.USD to 2900,
    BillingCurrency.CAD to 3900,
)

/**
 * "$39" — the one-time US registration fee, in the money that card is charged.
 *
 * RESOLVED AND FORMATTED IN ONE PLACE because the screen says it three times:
 * on the button, inside the confirm dialog, and in the read-only line everybody
 * who is not the owner reads instead. Three call sites answering "which price
 * book" separately is three chances for two of them to agree and one not to,
 * which is the shape of #328 itself.
 *
 * Resolved exactly the way [planFacts] resolves a plan price — stored currency
 * first, country only when there is none — and deliberately the same rule
 * rather than a second one. Both figures are read on the same Settings screen
 * by the same person, and a screen quoting two currencies at one reader is the
 * defect, not the fix.
 */
fun usRegistrationFee(billingCurrency: String?, country: String?): String {
    val currency = resolveBillingCurrency(billingCurrency, country)
    return formatMoney(US_REGISTRATION_FEE_CENTS.getValue(currency), currency)
}

/** `companies.billing_currency`, narrowed. Null for anything we do not bill in. */
fun billingCurrencyOrNull(value: String?): BillingCurrency? =
    when (value?.trim()?.lowercase()) {
        "usd" -> BillingCurrency.USD
        "cad" -> BillingCurrency.CAD
        else -> null
    }

/**
 * The currency a workspace in this country is OFFERED — a default, not a rule.
 *
 * Only ever a fallback for a workspace with no stored currency, which is what
 * every workspace predating #328 looks like. It must never override
 * `billing_currency`: `checkout-currency.ts` will bill a Canadian workspace in
 * USD when the Stripe catalog cannot honour CAD, so country alone would print a
 * CAD price to somebody whose card is charged in US dollars.
 */
fun currencyForCountry(country: String?): BillingCurrency =
    if (country?.trim()?.uppercase() == "CA") BillingCurrency.CAD else BillingCurrency.USD

/**
 * "$29" / "$109" / "US$5" — mirror of `formatMoney` in
 * packages/shared/src/billing-currency.ts, including its [audience] rule.
 *
 * Whole dollars stay whole: a trailing ".00" on a plan price reads as machine
 * output and takes up space on a phone.
 *
 * BARE "$" IS CORRECT WHEN THE TWO MATCH and is not an oversight. A workspace
 * reading its own plan price is its own audience, and "US$29" to somebody
 * billed in US dollars is noise. [currency] was still taken before [audience]
 * existed, because the caller has to have decided which price book the cents
 * came out of before it can call this at all.
 *
 * [audience] IS THE HALF #523 NEEDED. The extra-number price book
 * ([EXTRA_NUMBER_MONTHLY_CENTS]) is filed in USD only — there is no CAD amount
 * to quote — so a Canadian workspace bringing a held number back is genuinely
 * charged US$5. Printing a bare "$5" at that reader means CA$5 to them, which
 * is the #522 defect with a different figure: a consent button naming a price
 * lower than the one the card takes.
 */
fun formatMoney(
    cents: Int,
    currency: BillingCurrency,
    audience: BillingCurrency = currency,
): String {
    val amount = if (cents % 100 == 0) {
        String.format(Locale.CANADA, "%,d", cents / 100)
    } else {
        String.format(Locale.CANADA, "%,.2f", cents / 100.0)
    }
    if (currency == audience) return "\$$amount"
    return if (currency == BillingCurrency.USD) "US\$$amount" else "CA\$$amount"
}

// ---------------------------------------------------------------------------
// #583 / D131 — the two sentences that promise a customer their money back
// ---------------------------------------------------------------------------

/**
 * Hand-port of `prepaidConversionCopy` in
 * packages/shared/src/prepaid-conversion-copy.ts, held to it by
 * `ParityVectorsTest`.
 *
 * A plan change inside a prepaid window ends the year and credits the unconsumed
 * value back, and three clients ask for that consent. What they say is not
 * decoration — it is the promise — so it is composed once in the shared package and
 * the ports are checked against generated cases.
 *
 * IT SAYS CREDIT AND AN AMOUNT, NEVER MONTHS OF FREE SERVICE. Stripe spends a
 * credit balance on the whole invoice, so a heavy month can consume it and leave
 * the plan fee on the card anyway; "two months of Pro free" is a promise the
 * mechanism cannot keep. That is the same promise D107 rejected customer credit for
 * making at the other end of this feature.
 *
 * @param credit already formatted for this reader by [formatMoney], or null when the
 *   server sent no figure. Null promises no number, which is the only honest thing
 *   to say without one.
 */
data class PrepaidConversionCopy(
    val heading: String,
    val explanation: String,
    val acknowledgement: String,
)

fun prepaidConversionCopy(
    fromPlan: String,
    toPlan: String,
    credit: String?,
    locale: String? = null,
): PrepaidConversionCopy {
    val heading = AppStrings.translate(
        locale,
        "settings.prepaidHeading",
        mapOf("plan" to prepaidPlanLabel(fromPlan)),
    )
    val target = prepaidPlanLabel(toPlan)
    // #228: the credited and uncredited forms are separate keys. The credited
    // one is not the other with a clause bolted on — it says a different thing
    // about the money, and French orders it differently.
    if (credit == null) {
        return PrepaidConversionCopy(
            heading = heading,
            explanation = AppStrings.translate(
                locale,
                "settings.prepaidEndsPlain",
                mapOf("plan" to target),
            ),
            acknowledgement = AppStrings.translate(locale, "settings.prepaidAckPlain"),
        )
    }
    return PrepaidConversionCopy(
        heading = heading,
        explanation = AppStrings.translate(
            locale,
            "settings.prepaidEndsCredited",
            mapOf("plan" to target, "credit" to credit),
        ),
        acknowledgement = AppStrings.translate(
            locale,
            "settings.prepaidAckCredited",
            mapOf("credit" to credit),
        ),
    )
}

private fun prepaidPlanLabel(plan: String): String =
    if (plan == "pro") "Pro" else "Starter"

// ---------------------------------------------------------------------------
// #523 — the extra-number price book
// ---------------------------------------------------------------------------

/**
 * Mirror of `EXTRA_NUMBER_MONTHLY_CENTS` in apps/api/src/billing/extra-numbers.ts.
 *
 * THIS CLIENT ALREADY PRINTED THESE TWO FIGURES, typed, as `"$4/mo"` and
 * `"$5/mo"` on the add-a-number card. That is the shape rule 2 of #523 forbids
 * and the shape #522 was: a price written into a sentence, in a currency the
 * workspace may not be billed in, on the surface that asks for consent to the
 * charge.
 *
 * The held-numbers card does NOT read this — it prints the server's
 * `extra_number_cents`, because that route quotes the figure it is about to
 * charge and a served figure always beats a hand-port. The mirror exists for
 * the add-a-number card, which has no route to ask before its picker opens.
 * `ExtraNumberPriceTest` pins both entries against the TypeScript.
 */
internal val EXTRA_NUMBER_MONTHLY_CENTS: Map<String, Int> = mapOf(
    "starter" to 500,
    "pro" to 400,
)

/**
 * The currency [EXTRA_NUMBER_MONTHLY_CENTS] is denominated in — mirror of
 * `EXTRA_NUMBER_PRICE_CURRENCY`.
 *
 * USD ONLY, and it is not an oversight to be tidied up later. There is no CAD
 * extra-number price filed in Stripe, so a Canadian workspace's extra number is
 * genuinely billed in US dollars — which is exactly why every surface quoting it
 * has to pass this as the [formatMoney] `currency` and the WORKSPACE's currency
 * as the audience.
 */
internal val EXTRA_NUMBER_PRICE_CURRENCY: BillingCurrency = BillingCurrency.USD

/**
 * "US$5/mo" for a Canadian workspace, "$5/mo" for a US one — what one extra
 * number costs on [plan].
 *
 * Null when the plan is not one we sell extras on, so a caller renders no price
 * rather than a zero. Same resolution as [planFacts] and [usRegistrationFee]:
 * the stored currency wins, the country is only consulted when there is none.
 */
fun extraNumberMonthly(plan: String?, billingCurrency: String?, country: String?): String? {
    // Looked up STRICTLY rather than defaulted to Starter. A workspace with no
    // plan is not a Starter workspace, and quoting it Starter's extra-number
    // price would be naming a figure for a purchase that cannot happen.
    val cents = EXTRA_NUMBER_MONTHLY_CENTS[plan] ?: return null
    val audience = resolveBillingCurrency(billingCurrency, country)
    return formatMoney(cents, EXTRA_NUMBER_PRICE_CURRENCY, audience) + "/mo"
}

// ---------------------------------------------------------------------------
// #277 follow-up — answering the reason somebody gave for leaving, once.
//
// HAND-PORT of packages/shared/src/cancellation-offers.ts. Read that file's
// header before changing a word below. Every sentence here is checkable in this
// repository, and the three reasons that answer nothing answer nothing ON
// PURPOSE.
//
// THE PAUSE NOW EXISTS AND THIS BLOCK IS TOLD ABOUT IT, which is the one thing
// that changed since it was written. It is told as a FACT — this workspace's
// plan is paused right now — and never as an offer: whether a pause is
// AVAILABLE is eight server-side gates and a live Stripe price, none of which a
// pure function can see, and that half still lives below in the pause block. So
// these sentences may describe a pause the reader is already in, and may not
// promise one to anybody else.
//
// This is not a retention funnel. Nothing derived from it may be rendered in a
// way that adds a step, a scroll past the exit, or a disabled state to leaving.
// ---------------------------------------------------------------------------

/**
 * A server timestamp as an instant, or null when there is none to read.
 *
 * Both spellings, because both arrive: PostgREST sends `+00:00` offsets and the
 * Workers send `Z`, and `Instant.parse` is documented against ISO_INSTANT. A
 * client that understood only one of them would silently lose the release
 * deadline on half its reads and fall back to copy carrying no date at all.
 */
internal fun parseServerInstant(iso: String?): Instant? {
    val text = iso?.trim().orEmpty()
    if (text.isEmpty()) return null
    return runCatching { java.time.OffsetDateTime.parse(text).toInstant() }.getOrNull()
        ?: runCatching { Instant.parse(text) }.getOrNull()
}

/**
 * SPEC §1 key rule 2 / §9: how long the number is held after cancellation.
 *
 * THE CLOCK RUNS FROM `companies.canceled_at`, not from the period end, because
 * that is what the job does — `runGraceJob` measures `now - canceled_at` and
 * releases at 30. `subscription.canceled_at` is stamped when cancelling is
 * REQUESTED, so for a cancel-at-period-end the clock can start up to a month
 * before the period ends. Copy that says "30 days after your last period"
 * names a different date from the one the number actually dies on, and a
 * deadline wrong in the customer's favour is the expensive direction.
 */
const val CANCELLATION_GRACE_DAYS = 30

/**
 * When this workspace's number goes back to the carrier, or null if it is not
 * cancelled. Mirror of `numberReleaseAt`.
 */
fun numberReleaseAt(canceledAt: String?): Instant? =
    parseServerInstant(canceledAt)
        ?.plus(java.time.Duration.ofDays(CANCELLATION_GRACE_DAYS.toLong()))

/**
 * Is this workspace still inside the window where coming back keeps the number?
 *
 * The win-back must not render outside it. Past the release the number is gone
 * — back in carrier inventory and reassignable to another business (#413) — so
 * "resubscribe and keep your number" becomes false at exactly this boundary,
 * and it is the sort of false that gets discovered by the person it was
 * promised to.
 */
fun isWithinCancellationGrace(canceledAt: String?, now: Instant = Instant.now()): Boolean {
    val release = numberReleaseAt(canceledAt) ?: return false
    return now.isBefore(release)
}

/**
 * Has the win-back already been waved away for THIS cancellation?
 *
 * A timestamp compared against `canceled_at` rather than a boolean, because a
 * dismissal belongs to one cancellation: somebody who dismisses this,
 * resubscribes, and cancels again a year later gets the offer back, since the
 * second cancellation stamps a newer `canceled_at`. Nothing has to clear it.
 *
 * A stamp we cannot parse counts as dismissed. The press demonstrably happened
 * — the column is non-empty — and re-showing something after somebody asked us
 * to stop is the worse of the two failures.
 */
fun winbackWavedAway(winbackDismissedAt: String?, canceledAt: String?): Boolean {
    if (winbackDismissedAt.isNullOrBlank()) return false
    val dismissed = parseServerInstant(winbackDismissedAt) ?: return true
    val canceled = parseServerInstant(canceledAt) ?: return true
    return !dismissed.isBefore(canceled)
}

/** Whether the canceled-state card should carry the win-back at all. */
fun shouldOfferWinback(
    canceledAt: String?,
    winbackDismissedAt: String?,
    now: Instant = Instant.now(),
): Boolean = isWithinCancellationGrace(canceledAt, now) &&
    !winbackWavedAway(winbackDismissedAt, canceledAt)

/**
 * Where the offer is being read.
 *
 * The same reason gets the same ANSWER in both places and a different verb: on
 * the cancel card the subscription is still live, so the control is the plan
 * switch; during grace it is over, so the control is coming back.
 */
enum class CancellationOfferPhase { Before, Grace }

/**
 * A control this screen ALREADY HAS. Never a route — a route string would be
 * wrong on two of the three platforms.
 *
 *   ChangePlan          the plan switcher (ChangePlanDialog), targeting Starter.
 *   ResubscribeStarter  the resubscribe control, with Starter as the plan
 *                       rather than the old one.
 *   OpenHelp            the in-product help surface (#382) — HelpSection here.
 */
enum class CancellationOfferAction { ChangePlan, ResubscribeStarter, OpenHelp }

data class CancellationOffer(
    /** The reason this answers, so a screen can key its state on it. */
    val reason: String,
    val heading: String,
    val body: String,
    /** Null when the words are the whole answer and there is nothing to press. */
    val action: CancellationOfferAction? = null,
    /** The words on that control — the SAME words on all three clients. */
    val actionLabel: String? = null,
)

/** `companies.plan`, narrowed. Null means no checkout has happened yet. */
private fun resolveOfferPlan(plan: String?): String = if (plan == "pro") "pro" else "starter"

/**
 * What this workspace is charged in. The stored currency wins whenever it is
 * one we bill in; the country is consulted only when there is none.
 *
 * Shared with [planFacts] and [usRegistrationFee] rather than kept private to
 * the offer. Two ways of answering "which price book" on one screen is how the
 * plan card and the cancellation answer directly below it ended up quoting two
 * different currencies at the same reader, and the registration fee was a third
 * surface answering it with no price book at all.
 */
private fun resolveBillingCurrency(billingCurrency: String?, country: String?): BillingCurrency =
    billingCurrencyOrNull(billingCurrency) ?: currencyForCountry(country)

/**
 * The cheaper-plan answer, and the ONE case it is not offered.
 *
 * A workspace already on Starter gets NULL, because there is nothing below it.
 * The alternative — some softer sentence about how the price is fair — is an
 * argument with somebody who has just told us it is not, on the screen they
 * came to leave from. Inventing a cheaper plan is the dishonesty #277 forbids.
 *
 * A FIGURE MAY ONLY BE PRINTED ON THE PATH THAT ENFORCES IT. The two routes
 * back to Starter are not the same route and do not enforce the same things:
 *
 *   Before  POST /v1/billing/change-plan. Answers 409 while the workspace holds
 *           more numbers than [STARTER_NUMBERS], and again while active members
 *           exceed [STARTER_SEATS]. Both allowances are real there, so both are
 *           stated.
 *   Grace   Stripe checkout. Its only gates are "one live subscription" and the
 *           US registration draft — it counts neither members nor numbers — and
 *           `checkout.session.completed` then un-suspends EVERY suspended number
 *           with no plan filter. A Pro workspace with two numbers and eight
 *           members can come back on Starter holding two and eight, so the seat
 *           and number allowances are NOT stated there. The price still is:
 *           checkout charges it.
 *
 * WHY THE BEFORE PHASE NAMES A REFUSAL. It used to end "your number and your
 * message history stay exactly as they are", which is true for a workspace that
 * fits Starter and false for exactly the one being spoken to: a Pro tenant
 * holding a second number is REFUSED the downgrade until it is released, so the
 * second number is the one thing that does not stay as it is. The history
 * genuinely does survive and is still promised.
 *
 * WHY THE PAUSED ANSWER HAS NOTHING TO PRESS. [CancellationOfferAction.ChangePlan]
 * names the plan switcher, and POST /v1/billing/change-plan refuses outright
 * while `companies.paused_at` is set — a plan change during a pause is ambiguous
 * in a way only the customer can settle (resume onto the new plan now, or land
 * on it in spring?), so the API asks for the two steps in order rather than
 * guessing. The plan card's own switcher is gated on the same fact, so a button
 * here would be the ONLY pressable route to that 409 on the whole screen, drawn
 * by us, an inch under an answer somebody volunteered.
 *
 * The WORDS stay, and returning null for the whole offer was the wrong fix:
 * somebody cancelling over $79 would then be told nothing at all about the $29
 * plan they can have. What the API refuses is the click, not the fact.
 *
 * There is no resume action either, and that is not an oversight: Resume already
 * sits on the paused card at the top of this same screen, and a second one down
 * here would be a retention funnel growing a control — see the header. The words
 * name the order instead, in the API's own words, so somebody who goes and does
 * it reads the same sentence twice rather than a contradiction.
 */
private fun tooExpensiveOffer(
    plan: String?,
    phase: CancellationOfferPhase,
    billingCurrency: String?,
    country: String?,
    paused: Boolean,
    locale: String? = null,
): CancellationOffer? {
    if (resolveOfferPlan(plan) != "pro") return null

    val currency = resolveBillingCurrency(billingCurrency, country)
    val prices = PLAN_PRICE_CENTS.getValue(currency)
    val starter = formatMoney(prices.getValue("starter"), currency)
    val pro = formatMoney(prices.getValue("pro"), currency)
    val numbers = STARTER_NUMBERS

    // True on both routes back, because both end at a Starter subscription
    // built from the Starter prices — the schedule phase a downgrade writes,
    // and the session a resubscribe checks out through.
    val price = AppStrings.translate(
        locale,
        "settings.offerStarterPrice",
        mapOf("starter" to starter, "pro" to pro),
    )

    /**
     * Seats and numbers, and so only for the phase whose route refuses them.
     *
     * #228: the singular is ITS OWN KEY rather than an appended "s". French
     * pluralises the noun and its article together, so a suffix cannot express
     * it — this is the kind of sentence that reads fine in English right up
     * until somebody translates it.
     */
    val limits = AppStrings.translate(
        locale,
        if (numbers == 1) "settings.offerStarterCoversOne" else "settings.offerStarterCovers",
        mapOf("seats" to STARTER_SEATS.toString(), "numbers" to numbers.toString()),
    )

    // Same heading as the unpaused answer, on purpose. It is a fact about the
    // two plans and the pause does not touch it; a second heading would be a
    // second string for three clients to hand-port and drift.
    if (paused) {
        return CancellationOffer(
            reason = "too_expensive",
            heading = AppStrings.translate(locale, "settings.offerStarterHeading"),
            body = "$price $limits " + AppStrings.translate(
                locale,
                "settings.offerStarterTailPaused",
                mapOf("seats" to STARTER_SEATS.toString()),
            ),
            action = null,
            actionLabel = null,
        )
    }

    return if (phase == CancellationOfferPhase.Grace) {
        CancellationOffer(
            reason = "too_expensive",
            heading = AppStrings.translate(locale, "settings.offerStarterHeadingGrace"),
            body = "$price " + AppStrings.translate(locale, "settings.offerStarterTailGrace"),
            action = CancellationOfferAction.ResubscribeStarter,
            actionLabel = AppStrings.translate(locale, "settings.offerComeBackOnStarter"),
        )
    } else {
        CancellationOffer(
            reason = "too_expensive",
            heading = "Starter is the same product, priced for a smaller crew",
            body = "$price $limits " + AppStrings.translate(
                locale,
                "settings.offerStarterTail",
                mapOf("seats" to STARTER_SEATS.toString()),
            ),
            action = CancellationOfferAction.ChangePlan,
            actionLabel = AppStrings.translate(locale, "settings.planSwitchToStarter"),
        )
    }
}

/**
 * The fee sentence, only for a workspace that has actually paid it.
 *
 * Gated on the TIMESTAMP rather than on country, because the timestamp is
 * exactly what checkout tests: the one-time line is added only when
 * `registration_fee_paid_at IS NULL`, and the webhook stamps it once per company
 * ever. A workspace that has not paid it WILL be charged on return, so for them
 * this sentence is simply absent rather than softened.
 *
 * SAID TO THE PAUSED READER TOO. It answers "what does coming back cost", and
 * that question survives the pause unchanged: the fee is charged at most once
 * per workspace ever, so neither resuming nor cancelling-and-returning charges
 * it again. Lifted out of [seasonalOffer] when the paused answer needed the same
 * sentence — one copy, because two would be one promise about money typed twice.
 */
private fun registrationFeeSentence(
    registrationFeePaidAt: String?,
    locale: String? = null,
): String =
    if (!registrationFeePaidAt.isNullOrBlank()) {
        AppStrings.translate(locale, "settings.offerRegistrationFeePaid")
    } else {
        ""
    }

/**
 * The seasonal answer for somebody who ALREADY PAUSED, and is cancelling anyway.
 *
 * They are not choosing between leaving and a 30-day hold; they are choosing
 * between the thing they already have and giving it up, and only one of those
 * two has a deadline. So this answer states both sides of exactly that:
 *
 *   what they have   the number and the history are held, and nothing expires
 *                    while the plan is paused. The pause is a licensed-price
 *                    swap with no clock attached — `runGraceJob` measures
 *                    `now - canceled_at` and a paused workspace has no
 *                    `canceled_at`, so there is genuinely nothing counting.
 *   what they lose   cancelling ends the pause and starts the hold, and the hold
 *                    is the only countdown in this product. Anchored to the
 *                    cancellation for the reason [seasonalOffer] gives at length.
 *
 * IT REPLACES THE UNPAUSED WORDS RATHER THAN JOINING THEM. That answer's
 * load-bearing clause — "a quiet season longer than that outruns the hold" — is
 * FALSE for a paused workspace, and it would be read twelve lines under a paused
 * card saying the pause starts no clock at all. Two sentences, one card,
 * contradicting each other about the thing the reader came to find out.
 *
 * NO CONTROL, same as every other seasonal answer. Resume is already on the
 * paused card on this screen, and the point of the paragraph is not to press
 * anything — it is that somebody about to trade an open-ended hold for a 30-day
 * one should know that is the trade.
 *
 * IT SAYS "PAUSED" OUT LOUD, which every other string in this block may not.
 * Safe here and only here: they are in a pause, so it is a description of their
 * account rather than an offer whose eligibility this function cannot see.
 */
private fun pausedSeasonalOffer(
    registrationFeePaidAt: String?,
    locale: String? = null,
): CancellationOffer =
    CancellationOffer(
        reason = "seasonal",
        heading = AppStrings.translate(locale, "settings.offerPausedSeasonalHeading"),
        body = AppStrings.translate(
            locale,
            "settings.offerPausedSeasonalBody",
            mapOf("days" to CANCELLATION_GRACE_DAYS.toString()),
        ) + registrationFeeSentence(registrationFeePaidAt, locale),
        action = null,
        actionLabel = null,
    )

/**
 * The seasonal answer: what is already true about going quiet and coming back.
 *
 * THIS COPY IS FOR SOMEBODY WHO HAS NOT PAUSED — [pausedSeasonalOffer] answers
 * the one who has. What this describes is the 30-day hold, and it must never
 * imply a pause: whether one is on offer is the API's read, not this function's.
 * "You cannot reply" is in there on purpose: `runPreSendGates` requires an
 * active subscription and answers 402 otherwise, so a cancelled workspace can
 * receive and cannot send. Leaving that out would let somebody plan a quiet
 * season around a product that answers their customers, and find out otherwise
 * from a customer.
 *
 * THE HEADING MAY NOT COVER THE SEASON. It used to read "Your number is held
 * while you are gone", over a body that said 30 days, to a reader who had just
 * said they would be back next spring. A trades quiet season is months; the
 * hold is 30 days; and the heading is the line that gets read. So the heading
 * carries the duration and the anchor, and the body says plainly that a longer
 * season outruns it.
 *
 * THE ANCHOR IS THE CANCELLATION, NOT THE PERIOD END. `runGraceJob` measures
 * `now - canceled_at`, and `startCancellationLifecycle` stamps that column from
 * Stripe's `canceled_at`, which for a `cancel_at_period_end` cancellation is the
 * time of the REQUEST — the vendored `Subscriptions.d.ts` says so in as many
 * words. Somebody who cancels on day 2 of a month and reads "your period ends,
 * then we hold it for 30 days" counts about 59 days and has about 30. What they
 * lose at the end of the miscount is the number on the side of the van.
 */
private fun seasonalOffer(
    phase: CancellationOfferPhase,
    registrationFeePaidAt: String?,
    locale: String? = null,
): CancellationOffer {
    val fee = registrationFeeSentence(registrationFeePaidAt, locale)
    val days = mapOf("days" to CANCELLATION_GRACE_DAYS.toString())

    return if (phase == CancellationOfferPhase.Grace) {
        CancellationOffer(
            reason = "seasonal",
            heading = AppStrings.translate(locale, "settings.offerSeasonalGraceHeading"),
            body = AppStrings.translate(locale, "settings.offerSeasonalGraceBody", days) + fee,
        )
    } else {
        CancellationOffer(
            reason = "seasonal",
            heading = AppStrings.translate(locale, "settings.offerSeasonalHeading", days),
            body = AppStrings.translate(locale, "settings.offerSeasonalBody", days) + fee,
        )
    }
}

/**
 * The missing-feature answer: the route to a human, and what it promises.
 *
 * Both sentences are read from the support constants rather than restated, for
 * the reason that module gives — a response time typed in separately is a
 * promise somebody made without knowing they were making it. Same words the
 * help screen shows, so the offer cannot promise what the help screen does not.
 */
private fun missingFeatureOffer(locale: String? = null): CancellationOffer = CancellationOffer(
    reason = "missing_feature",
    heading = AppStrings.translate(locale, "settings.offerMissingHeading"),
    // The two promises come from the keys the help screen reads, so the offer
    // cannot promise something that screen does not — in either language.
    body = AppStrings.translate(
        locale,
        "settings.offerMissingBody",
        mapOf(
            "when" to AppStrings.translate(locale, "settings.helpResponseTime"),
            "promise" to AppStrings.translate(locale, "settings.helpFixPromise"),
        ),
    ),
    action = CancellationOfferAction.OpenHelp,
    actionLabel = AppStrings.translate(locale, "settings.offerGetHelp"),
)

/**
 * The answer to a stated reason, or null for "say nothing".
 *
 * NULL IS THE COMMON CASE and it is a real answer. Three of the six reasons
 * return it always (`switched` — we do not know what they went to; `not_using`
 * and `other` — the export and the exit are already on the card and are what
 * those answers actually need), one returns it on Starter, and an unrecognised
 * or absent reason returns it too: a client reading a code from a newer build
 * must render nothing rather than guess. Never substitute copy for a null.
 *
 * @param paused is this workspace's plan paused RIGHT NOW — `companies.paused_at
 *   != null`, as GET /v1/billing/pause reports it.
 *
 *   FALSE BY DEFAULT, and that is deliberate rather than lazy: every answer this
 *   function gave before the pause existed is the answer for an unpaused
 *   workspace, so a caller that does not pass this reads exactly what it read
 *   before, word for word. Three clients hand-port these strings and their tests
 *   compare them.
 *
 *   PASS THE FACT YOU HAVE READ, NOT THE ABSENCE OF ONE. A boolean cannot tell
 *   "not paused" apart from "not read yet", and on a paused workspace `false` is
 *   the claim that draws "Switch to Starter" in front of a 409. On this client
 *   the unread state is [PauseRead], and the rule the billing screen follows is
 *   [mayDrawOfferControl] — the words come from this flag, the CONTROL comes
 *   from the read having answered.
 */
fun cancellationOffer(
    reason: String?,
    plan: String?,
    phase: CancellationOfferPhase = CancellationOfferPhase.Before,
    billingCurrency: String? = null,
    country: String? = null,
    registrationFeePaidAt: String? = null,
    paused: Boolean = false,
    /**
     * #228 — the language the reader is in.
     *
     * LAST AND DEFAULTED, like every other locale added to this file: a caller
     * that does not pass it reads exactly what it read before, word for word,
     * which is what keeps the cross-language pins comparing English to English.
     */
    locale: String? = null,
): CancellationOffer? {
    // The pause fact, narrowed to the phase it can be true in.
    //
    // `paused_at` OUTLIVES THE SUBSCRIPTION IT BELONGED TO — nothing clears it
    // on cancellation (the reconcile skips cancelled tenants, and
    // `claim_checkout_activation` clears it only on the way back in) — so a
    // grace-phase caller reading a company row can hand us a `true` for a
    // workspace whose pause died with its subscription and whose 30-day clock is
    // running right now. Honouring it there would answer "nothing expires" to
    // the one reader for whom something is expiring, on a date this same card
    // prints two lines further down.
    val inPause = paused && phase == CancellationOfferPhase.Before

    return when (reason) {
        "too_expensive" ->
            tooExpensiveOffer(plan, phase, billingCurrency, country, inPause, locale)
        "seasonal" -> if (inPause) {
            pausedSeasonalOffer(registrationFeePaidAt, locale)
        } else {
            seasonalOffer(phase, registrationFeePaidAt, locale)
        }
        // The support promise does not change because the plan is paused, for
        // the same reason it does not change between the two phases: it is a
        // promise about us, not about their subscription.
        "missing_feature" -> missingFeatureOffer(locale)
        // switched / not_using / other, and anything unrecognised: nothing
        // honest to add, paused or not — a pause does not tell us what somebody
        // switched to. See the header.
        else -> null
    }
}

// ---------------------------------------------------------------------------
// #277 — the paid pause: a quiet season that keeps the number
//
// NOT A HAND-PORT, and it is the one billing block on this screen that is not.
// Everything above mirrors `packages/shared/src/cancellation-offers.ts`, which
// can be shared because it is pure. A pause cannot be: the price is read out of
// the live Stripe catalog per workspace, and whether it is offered at all is
// decided by eight server-side gates. The only honest source for both is the
// answer to GET /v1/billing/pause, so what is written here is the wording around
// the API's figures and nothing else.
//
// The rule the rest of this file lives under still holds and matters more here,
// not less: the pause is an OFFER. Nothing built from it may add a step, a
// scroll past the exit, or a disabled control to leaving.
// ---------------------------------------------------------------------------

/**
 * The one cancellation reason the pause answers better than words can.
 *
 * "Quiet season, I'll be back" is a description of the pause, said by somebody
 * who does not know it exists. Every other reason gets the answer
 * [cancellationOffer] gives it — a pause offered to "too expensive" is a second
 * bill, and offered to "not using it" is a subscription to nothing.
 */
const val PAUSE_ANSWERS_REASON = "seasonal"

/**
 * WHAT STOPS. Said first, and in the offer as well as in the paused state,
 * because it is the half somebody could plan a season around being wrong about.
 *
 * `runPreSendGates` refuses with `workspace_paused` (402) and the call runtime
 * puts a paused workspace in the same arm as a suspended one — no dial command,
 * in or out. What the caller hears is #490's line-is-down notice, which is
 * worth saying out loud: an owner imagining their phone ringing unanswered all
 * winter is imagining something that does not happen.
 */
private fun pauseStops(locale: String?) =
    AppStrings.translate(locale, "settings.pauseStops")

/**
 * WHAT DOES NOT. Every clause is enforced somewhere: inbound messages are never
 * gated on billing, a scheduled send is HELD under `workspace_paused` rather
 * than failed (and that reason is marked recoverable, so it goes out on the way
 * back), and the number and history are simply never touched.
 */
private fun pauseKeeps(locale: String?) =
    AppStrings.translate(locale, "settings.pauseKeeps")

/**
 * The pause, offered — heading, body, and the words on every control.
 *
 * THE PRICE IS ON THE CONTROL, not only in the paragraph above it. A button
 * that says "Pause my plan" over a price two lines up is a button somebody
 * presses without having read the amount, and this one starts a recurring
 * charge.
 */
data class PauseOfferCopy(
    val heading: String,
    val body: String,
    val actionLabel: String,
    val confirmTitle: String,
    val confirmBody: String,
    val confirmLabel: String,
)

/**
 * The offer, or null — and null is the common case.
 *
 * [PauseState.eligible] IS THE GATE, and this function adds exactly one thing
 * to it: a null price is also null here. The route already refuses to report
 * `eligible` without a figure, so this is the belt to that braces rather than a
 * second opinion — the failure it exists to make impossible is a Pause button
 * rendered beside a blank where the amount should be.
 *
 * NOTHING IS SAID WHEN THE ANSWER IS NO. Not "pausing isn't available", not a
 * greyed control, not [PauseState.reason]: `not_provisioned` means the offer
 * does not exist, and the seven other reasons are conditions on something the
 * reader was never shown. The seasonal answer that was already there is a whole
 * answer on its own, and it is what renders instead.
 */
fun pauseOfferCopy(pause: PauseState?, locale: String? = null): PauseOfferCopy? {
    if (pause == null || !pause.eligible) return null
    val cents = pause.monthly_cents ?: return null
    val price = formatMonthlyCents(cents)
    val money = mapOf("price" to price)

    return PauseOfferCopy(
        heading = AppStrings.translate(locale, "settings.pauseOfferHeading", money),
        // The contrast with the sentence at the top of this card is the whole
        // argument, so it is made explicitly: cancelling starts a clock that a
        // trades quiet season outruns, and pausing starts no clock at all.
        body = AppStrings.translate(
            locale,
            "settings.pauseOfferBody",
            mapOf("price" to price, "days" to CANCELLATION_GRACE_DAYS.toString()),
        ) + " ${pauseStops(locale)} ${pauseKeeps(locale)} " + AppStrings.translate(
            locale,
            "settings.pauseOfferNoClock",
            mapOf("days" to CANCELLATION_GRACE_DAYS.toString()),
        ),
        actionLabel = AppStrings.translate(locale, "settings.pauseOfferAction", money),
        confirmTitle = AppStrings.translate(locale, "settings.pauseOfferConfirmTitle"),
        // Says "every month until you resume" rather than naming a term,
        // because there is no term: the swap holds until somebody presses
        // Resume. A recurring charge has to be described as recurring.
        confirmBody = AppStrings.translate(locale, "settings.pauseOfferConfirmBody", money) +
            " ${pauseStops(locale)} ${pauseKeeps(locale)}",
        confirmLabel = AppStrings.translate(locale, "settings.pauseOfferConfirmLabel", money),
    )
}

/** The paused state itself: what is true now, and the way back. */
data class PausedStateCopy(
    val heading: String,
    val body: String,
    val resumeLabel: String,
    val confirmTitle: String,
    val confirmBody: String,
    val confirmLabel: String,
)

/**
 * What a paused workspace is told, or null when it is not paused.
 *
 * [PauseState.paused_at] IS THE STATE. It is non-null only while the mirror
 * says the subscription carries the pause price, which is the same fact every
 * send gate reads, so this card and the composer cannot disagree.
 *
 * THE PRICE IS THE MIRROR'S, not the catalog's, and it may be absent. A pause
 * priced last winter is what this workspace is actually charged; a repricing
 * since then belongs to the next pause, not to this one. Where the mirror has
 * no figure the heading simply does not name one — inventing today's catalog
 * price to fill the gap would be quoting a charge nobody is on.
 *
 * @param resumePlanName the plan they come back to, in the words the plan card
 *   uses ([planFacts]). Null when it is a plan this build does not know, in
 *   which case the way back is named without it rather than guessed at.
 */
fun pausedStateCopy(
    pause: PauseState?,
    resumePlanName: String?,
    locale: String? = null,
): PausedStateCopy? {
    if (pause?.paused_at == null) return null
    val price = pause.monthly_cents?.let { formatMonthlyCents(it) }

    // #228: the named-plan and unnamed forms are SEPARATE KEYS rather than one
    // sentence with an optional insert. A plan name is a noun that has to sit in
    // a grammatical slot, and French does not put it where English does — a
    // single template with a hole would translate one of the two badly.
    val back = if (resumePlanName != null) {
        AppStrings.translate(locale, "settings.pauseResumeNamed", mapOf("plan" to resumePlanName))
    } else {
        AppStrings.translate(locale, "settings.pauseResumeAny")
    }

    return PausedStateCopy(
        heading = if (price != null) {
            AppStrings.translate(locale, "settings.pausedHeadingPrice", mapOf("price" to price))
        } else {
            AppStrings.translate(locale, "settings.pausedHeading")
        },
        body = "${pauseStops(locale)} ${pauseKeeps(locale)} $back",
        resumeLabel = if (resumePlanName != null) {
            AppStrings.translate(locale, "settings.pauseResumeLabelNamed", mapOf("plan" to resumePlanName))
        } else {
            AppStrings.translate(locale, "settings.pauseResumeLabelAny")
        },
        confirmTitle = if (resumePlanName != null) {
            AppStrings.translate(locale, "settings.pauseConfirmTitleNamed", mapOf("plan" to resumePlanName))
        } else {
            AppStrings.translate(locale, "settings.pauseConfirmTitleAny")
        },
        confirmBody = "$back ${AppStrings.translate(locale, "settings.pauseConfirmTail")}",
        confirmLabel = AppStrings.translate(locale, "settings.pauseResumeNow"),
    )
}

/**
 * WHAT THE BILLING SCREEN KNOWS ABOUT THE PAUSE — which is a different question
 * from whether the workspace is paused.
 *
 * This exists because a nullable [PauseState] carried three separate meanings in
 * one value: nobody has asked, the API said no, and the ask failed. Every one of
 * them rendered as "not paused", so a paused workspace whose read failed — or
 * whose read had merely not landed yet — was shown a green Active pill, five
 * allowance lines describing a plan that is not running, and a plan-switch
 * button whose POST 409s by design. A failed re-read did the same thing to a
 * card that had already been told the truth once.
 *
 * A SCREEN MAY NOT STATE A FACT IT HAS NOT READ. These are the four things this
 * screen can honestly be in, and only [Answered] licenses a claim in either
 * direction. Neutral until the answer lands is honest; a green pill is not.
 */
sealed interface PauseRead {
    /**
     * Nobody has asked.
     *
     * Two ways to be here, and neither is "not paused". The question is moot —
     * a workspace with no plan, or one already cancelled, can neither pause nor
     * be paused — or the viewer cannot ask at all: GET /v1/billing/pause sits
     * behind `billing.manage`, so a member is never told about a pause by this
     * client and this screen must not invent a status for them.
     */
    data object Unasked : PauseRead

    /** Asked, no answer yet. The load window, which used to render as Active. */
    data object Loading : PauseRead

    /** Asked and answered. The ONLY state that licenses a claim either way. */
    data class Answered(val state: PauseState) : PauseRead

    /**
     * Asked, and the ask failed.
     *
     * Deliberately NOT collapsed into [Unasked]: the route throws rather than
     * degrading to null on a Stripe failure, precisely so the screen is never
     * "the offer visible with no price beside it", and a client that turns that
     * throw back into a shrug has undone it.
     */
    data object Failed : PauseRead
}

/**
 * The answer, or null when there is not one.
 *
 * Null here means "no answer", never "not paused" — every caller has to decide
 * what to do with that, which is the point of the type.
 */
val PauseRead.answer: PauseState? get() = (this as? PauseRead.Answered)?.state

/** Paused, and we were told so. Never true on a guess. */
val PauseRead.isPaused: Boolean get() = answer?.paused_at != null

/**
 * Running, and we were told so.
 *
 * NOT `!isPaused`. That is the whole defect in one expression: it is true of a
 * read that has not landed and of one that failed, and it is what let a paused
 * workspace be told it was active. Everything that claims the plan is running —
 * the pill, the allowances, the plan switch, the add-ons — hangs off this.
 */
val PauseRead.isRunning: Boolean get() = this is PauseRead.Answered && state.paused_at == null

/** What the plan card may say about this plan's state, if anything. */
enum class PlanBadge {
    /** The API says so. Amber: the plan named beside it is not what is charged. */
    Paused,

    /** The API says so, and Stripe says the subscription is live and staying. */
    Active,

    /** We asked and are waiting. Says only that we are asking. */
    Checking,
}

/**
 * The pill on the plan card, or none.
 *
 * PURE, AND THAT IS DELIBERATE. This is the one rule on this screen that cannot
 * bend — no "Active" over a workspace nobody has asked about — and a rule that
 * lives inside a composable can only be guarded by reading source text. Here it
 * can be broken in a test.
 *
 * `cancelAtPeriodEnd` and an inactive subscription both answer NOTHING rather
 * than a third pill: the amber banner at the top of the screen already says
 * cancelling is scheduled or that payment failed, and a second badge saying it
 * again next to the plan name is noise on a screen somebody is reading in a
 * hurry.
 */
fun planBadge(
    pause: PauseRead,
    subscriptionActive: Boolean,
    cancelAtPeriodEnd: Boolean,
): PlanBadge? = when {
    pause.isPaused -> PlanBadge.Paused
    pause.isRunning && subscriptionActive && !cancelAtPeriodEnd -> PlanBadge.Active
    // Answered, and there is nothing to badge: past due, unpaid, or on its way
    // out. The banner above has already said which.
    pause is PauseRead.Answered -> null
    pause is PauseRead.Loading -> PlanBadge.Checking
    // Unasked or Failed. Nothing was read, so nothing is claimed.
    else -> null
}

/**
 * What the plan card says when it could not find out, or null when it did.
 *
 * ONLY THE FAILURE SPEAKS. [PauseRead.Loading] is covered by the Checking pill
 * and adding a sentence to it would be narrating a network request at somebody
 * reading their plan. [PauseRead.Unasked] says nothing because there is nothing
 * to report — nobody asked, and for a member nobody can.
 *
 * The sentence says what is NOT known rather than apologising, and it says that
 * nothing changed, because the reader's next thought after "couldn't check" is
 * "did something happen to my plan".
 */
fun planStateUnknownNote(pause: PauseRead): String? = when (pause) {
    is PauseRead.Failed ->
        "We couldn't check this plan's status just now, so nothing here is claimed " +
            "either way. Your plan and your number are untouched."

    else -> null
}

/**
 * #524 — the cancel card, corrected for the one reader its standing sentence
 * cannot serve.
 *
 * THE SENTENCE THAT WAS FALSE. The cancel card opens with "your plan runs to
 * the end of your billing period, and you can't send once it ends", which used
 * to read "texting stops at the end of your billing period" — a promise of
 * texting until then, made to somebody whose texting stopped the day they
 * paused, on the same screen as a card telling them so. The header is now true
 * for both readers and says nothing about the pause, because it sits ABOVE the
 * button that leaves and may not change shape when a Stripe round trip lands.
 * This is the rest of the truth, and the render site puts it BELOW that button.
 *
 * WHAT IT ADDS is the fact a paused reader is most likely to be wrong about,
 * and it is not the reassuring half: pausing is the thing that has been keeping
 * the release clock off their number, and cancelling starts it. That is the
 * same contrast [pauseOfferCopy] makes to somebody choosing between the two —
 * said here to somebody who already chose the pause and is now on their way out
 * anyway.
 *
 * ONLY AN ANSWERED READ SPEAKS. [PauseRead.isPaused] is false while the read is
 * in flight and false after one that failed, so an unread pause says nothing at
 * all rather than guessing in either direction.
 */
/*
 * #529 — AND IT NAMES WHERE THE CLOCK IS COUNTED FROM.
 *
 * This said "It also starts the 30-day clock on your number" and stopped there.
 * A duration with no anchor is the single most expensive kind of sentence on this
 * card, and this reader is the one most likely to anchor it wrongly: they are
 * being told about a clock in the same breath as "your plan runs to the end of
 * the billing period", so "30 days" reads as 30 days from THAT. It is 30 days
 * from the day they cancel — `runGraceJob` measures `now - companies.canceled_at`
 * and Stripe stamps that column at the time of the REQUEST, not the period end.
 * Somebody who cancels on day 2 of a monthly period counts about 59 days and has
 * about 30, and what they lose at the end of the miscount is the number on the
 * side of their van.
 *
 * Found by the web client's OFFER-13, which asserts that every duration anywhere
 * on that card names its anchor, and which this copy would have failed. Nothing
 * on Android checks it — the note is Android-only, so no shared assertion ever
 * read it. The sentence is now the same shape as `CANCEL_CONSEQUENCE` on web:
 * the number of days, and immediately what they are counted from.
 */
fun pausedCancelNote(pause: PauseRead): String? = if (pause.isPaused) {
    "Your plan is paused, so texting is already off — what cancelling ends is the " +
        "plan itself. It also starts the clock on your number: " +
        "$CANCELLATION_GRACE_DAYS days from the day you cancel, not from the day " +
        "the plan ends. That is the clock a pause keeps off it."
} else {
    null
}

/**
 * May the cancellation answer's own control be DRAWN, given what this screen
 * knows about the pause?
 *
 * THE HOLE THE BOOLEAN LEAVES, CLOSED WHERE THE SCREEN CAN SEE IT.
 * [cancellationOffer] takes a `paused: Boolean`, and a boolean has no way to say
 * "nobody has asked yet" — so an unread pause arrives there as `false`, and on a
 * workspace that turns out to be paused the `too_expensive` answer comes back
 * carrying [CancellationOfferAction.ChangePlan] and "Switch to Starter". POST
 * /v1/billing/change-plan answers 409 to exactly that press. It is the same
 * defect [PauseRead] was built for, one layer down: a claim made from a read
 * that has not landed.
 *
 * So the WORDS are decided by the flag and the CONTROL is decided by the read,
 * which is what the plan card above already does — its own switcher is gated on
 * [PauseRead.isRunning], and this is that gate applied to the second switch an
 * inch below it. `isRunning` rather than `!isPaused` for the usual reason: a
 * read in flight and a read that failed are not permission to draw anything.
 *
 * ONLY [CancellationOfferAction.ChangePlan] IS WITHHELD. `OpenHelp` opens a
 * screen no billing state can refuse, and `ResubscribeStarter` belongs to a
 * cancelled subscription, which has no live pause to read — withholding either
 * would be this function inventing a rule the API does not have.
 *
 * NOTHING IS DISABLED, EVER. The control is drawn or it is not; a greyed button
 * on the cancel screen is the friction that whole screen is built against, and
 * the exit is not on this path at all.
 */
fun mayDrawOfferControl(action: CancellationOfferAction?, pause: PauseRead): Boolean =
    action != CancellationOfferAction.ChangePlan || pause.isRunning

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
fun mentionsEmergencyKeyword(
    copy: String,
    // #460: the workspace's own words. Defaults to the product list so a caller
    // not yet taught about custom keywords gets the old answer, not a wrong one.
    keywords: List<String> = EMERGENCY_KEYWORDS,
): Boolean = keywords.any { keyword ->
    Regex("\\b$keyword\\b", RegexOption.IGNORE_CASE).containsMatchIn(copy)
}

/**
 * Owners capitalise the word they want sent back. The verb matches
 * case-insensitively; the WORD's capitalisation is checked separately, since
 * it is the only thing telling a keyword instruction apart from a sentence
 * that merely contains "reply".
 */
/*
 * #228 — the verbs, in both languages. Mirror of REPLY_INSTRUCTION in shared;
 * see that file for why the left guard is not \b.
 *
 * (?u) is NOT decoration. Kotlin's RegexOption.IGNORE_CASE is Java's
 * CASE_INSENSITIVE, which folds ASCII only — so "RÉPONDEZ URGENT", written by
 * an owner who types the whole message in capitals, would not match the
 * lowercase "répondez" in this list. UNICODE_CASE has no RegexOption, so it is
 * set inline. The other two clients are Unicode-aware here already.
 */
private val REPLY_INSTRUCTION = Regex(
    """(?u)(?:^|[^A-Za-zÀ-ÖØ-öø-ÿ])(?:reply|replying|text|respond|send|répondez|repondez|répondre|repondre|répondez-nous|envoyez|envoyer|textez|écrivez|ecrivez|écrire|ecrire)\s+(?:back\s+)?(?:with\s+|avec\s+)?["'“‘]?([A-Za-z0-9]{2,15})\b""",
    RegexOption.IGNORE_CASE,
)

private val ALL_CAPS_WORD = Regex("^[A-Z]{2,}$")

/**
 * #453 — the word an owner told customers to send that nothing listens for.
 * Returns it so the screen can quote it back; an owner cannot fix what we
 * will not name. Mirror of `unrecognizedReplyKeyword` in shared.
 */
fun unrecognizedReplyKeyword(
    copy: String,
    keywords: List<String> = EMERGENCY_KEYWORDS,
): String? {
    for (match in REPLY_INSTRUCTION.findAll(copy)) {
        val raw = match.groupValues[1]
        val word = raw.uppercase()
        // #460: a word the owner has just ADDED must stop being warned about
        // the moment they add it, or the warning teaches them to ignore it.
        if (word in keywords || word in CARRIER_REPLY_KEYWORDS) continue
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
    keywords: List<String> = EMERGENCY_KEYWORDS,
    locale: String? = null,
): AwayEmergencyNotice? {
    val invites = mentionsEmergencyKeyword(awayMessage, keywords)
    val unknown = unrecognizedReplyKeyword(awayMessage, keywords)

    if (!emergencyEnabled) {
        if (!invites && unknown == null) return null
        return AwayEmergencyNotice(
            AwayNoticeTone.Warn,
            AppStrings.translate(locale, "settings.awayEmergencyOff"),
        )
    }

    if (unknown != null) {
        return AwayEmergencyNotice(
            AwayNoticeTone.Warn,
            AppStrings.translate(
                locale,
                "settings.awayEmergencyUnknownWord",
                mapOf(
                    "word" to unknown,
                    "words" to emergencyWordList(keywords, locale),
                ),
            ),
        )
    }

    if (!invites) {
        return AwayEmergencyNotice(
            AwayNoticeTone.Hint,
            AppStrings.translate(locale, "settings.awayEmergencyNotMentioned"),
        )
    }

    return null
}


/**
 * #460 — the words this workspace really watches for, safe against a lagging
 * server that has not learned to send them yet.
 *
 * An empty list from an older API must read as "the product list", not as
 * "nothing" — a switch labelled "texts starting with nothing reach the crew" is
 * worse than the hardcoded copy it replaced.
 */
val CompanyView.effectiveEmergencyWords: List<String>
    get() = emergency_effective_keywords.ifEmpty { EMERGENCY_KEYWORDS }

/**
 * "URGENT, EMERGENCY, 911 or SOS" — an owner reads a list, not an array.
 * Mirror of `emergencyWordList` in shared; keep the joining identical or the
 * same switch reads differently on three phones.
 */
fun emergencyWordList(words: List<String>, locale: String? = null): String = when {
    words.isEmpty() -> AppStrings.translate(locale, "settings.wordListNothing")
    words.size == 1 -> words[0]
    // The conjunction is a key rather than " or ": French joins the last pair
    // with "ou", and the spaces around it belong to the word.
    else -> words.dropLast(1).joinToString(", ") +
        AppStrings.translate(locale, "settings.wordListOr") +
        words.last()
}

/**
 * #460 — why a keyword was refused, in the owner's terms, or null when it is
 * fine. Mirror of `emergencyKeywordError` in shared.
 *
 * The client checks first so an owner is told immediately rather than after a
 * round trip, but the server and the CHECK constraint remain the authority —
 * this is a courtesy, not the gate.
 */
fun emergencyKeywordError(rawInput: String, locale: String? = null): String? {
    val trimmed = rawInput.trim()
    val word = trimmed.uppercase()
    if (word.isEmpty()) return AppStrings.translate(locale, "settings.keywordEmpty")
    if (trimmed.any { it.isWhitespace() }) {
        return AppStrings.translate(locale, "settings.keywordOneWord")
    }
    if (!Regex("^[A-Z0-9]+$").matches(word)) {
        return AppStrings.translate(locale, "settings.keywordAlphanumeric")
    }
    if (word.length < 2) return AppStrings.translate(locale, "settings.keywordTooShort")
    if (word.length > 15) return AppStrings.translate(locale, "settings.keywordTooLong")
    if (word in CARRIER_REPLY_KEYWORDS) {
        return AppStrings.translate(
            locale,
            "settings.keywordCarrierOwned",
            mapOf("word" to word),
        )
    }
    return null
}

// ---------------------------------------------------------------------------
// Signed-in devices (#236)
// ---------------------------------------------------------------------------

/**
 * What to call a signed-in device.
 *
 * `unknown` is a real answer, not a gap: it is what a client that predates the
 * X-Client header looks like, and a row that says "Unrecognised device" is
 * exactly the row somebody should look twice at.
 */
fun deviceClientLabel(client: String): String = when (client) {
    SessionClient.WEB -> "Web browser"
    SessionClient.ANDROID -> "Android app"
    SessionClient.IOS -> "iPhone or iPad"
    else -> "Unrecognised device"
}

/** "1 device" / "3 devices" — used in three sentences that each read wrong otherwise. */
fun deviceCountLabel(count: Int): String = if (count == 1) "1 device" else "$count devices"

/**
 * The order a person reads their own device list in: the one they are holding
 * first, then everything else by most recently active.
 *
 * Sorting is done here rather than trusted from the server because "this
 * device" has to be identified and dismissed before any other row means
 * anything, and the server orders by activity alone.
 */
fun orderMyDevices(sessions: List<DeviceSession>): List<DeviceSession> =
    sessions.sortedWith(
        compareByDescending<DeviceSession> { it.current }.thenByDescending { it.last_active_at },
    )

// ---------------------------------------------------------------------------
// Ownership (#332)
// ---------------------------------------------------------------------------

/**
 * The headline of a handover in flight: what is happening, in one sentence.
 *
 * Hand-ported to three clients, so it lives here with a test rather than
 * inline in a composable — the failure mode is one client telling a workspace
 * something subtly different about who is taking it over.
 */
fun handoverHeadline(kind: String, who: String, locale: String? = null): String =
    AppStrings.translate(
        locale,
        if (kind == HandoverKind.OFFER) {
            "settingsMore.ownershipOffered"
        } else {
            "settingsMore.ownershipAskedToTakeOver"
        },
        mapOf("name" to who),
    )

/**
 * The line underneath it: what happens next, and by when.
 *
 * The claim branch is the one that matters — it is where the owner learns they
 * have a deadline and a veto, and it must never read as though the handover
 * has already happened.
 */
fun handoverDetail(
    kind: String,
    ready: Boolean,
    ripensAt: String,
    expiresAt: String,
    locale: String? = null,
): String = when {
    kind == HandoverKind.OFFER ->
        AppStrings.translate(
            locale,
            "settingsMore.ownershipOfferExpires",
            mapOf("when" to absoluteTime(expiresAt)),
        )

    ready -> AppStrings.translate(locale, "settingsMore.ownershipWaitOver")

    else ->
        AppStrings.translate(
            locale,
            "settingsMore.ownershipCompletesAt",
            mapOf("when" to absoluteTime(ripensAt)),
        )
}

/**
 * What the button that ends a handover says.
 *
 * "Stop this" and "Decline" are the same call and the same outcome, but a
 * person reading them is doing two different things: an owner is vetoing
 * something aimed at them, and a recipient is turning something down.
 */
fun handoverCancelLabel(isOwner: Boolean, isMine: Boolean, locale: String? = null): String =
    AppStrings.translate(
        locale,
        if (isOwner && !isMine) "settingsMore.ownershipStopThis" else "settingsMore.ownershipDecline",
    )

// ---------------------------------------------------------------------------
// The handover, read by the person it is happening TO (#515)
// ---------------------------------------------------------------------------

/**
 * The four states somebody can be in with respect to a handover of their own.
 *
 * Hand-ported from packages/shared/src/handover.ts (vectors in
 * handover.test.ts). The three functions above describe a handover to a crew;
 * these describe one to its recipient, which is a different reader — the Team
 * card said "Ownership has been offered to Dana", and Dana could not open it.
 */
object HandoverPrompt {
    /** An offer is open and addressed to them. */
    const val ACCEPT_OFFER = "accept_offer"

    /** Their own claim outlasted the owner's veto window. */
    const val COMPLETE_CLAIM = "complete_claim"

    /** Their own claim is still inside it. */
    const val CLAIM_WAITING = "claim_waiting"

    /** They are the named backup and nothing is in flight. */
    const val BACKUP_STANDING = "backup_standing"
}

/**
 * The prompt this caller is owed, or null when they are not party to anything.
 *
 * `can_claim` rather than `i_am_backup` for the standing state: they differ
 * exactly when something is already in flight, and the server's answer to "may
 * they act" is the one that must not be second-guessed.
 */
fun viewerHandoverPrompt(state: Ownership): String? {
    val pending = state.pending
    if (pending != null && pending.mine) {
        // Only a claim can be theirs and unripe: an offer ripens the moment it
        // is made (api_offer_ownership sets ripens_at = now()), so a pending
        // offer addressed to somebody is always ready to accept.
        if (!pending.ready) return HandoverPrompt.CLAIM_WAITING
        return if (pending.kind == HandoverKind.OFFER) {
            HandoverPrompt.ACCEPT_OFFER
        } else {
            HandoverPrompt.COMPLETE_CLAIM
        }
    }
    return if (state.can_claim) HandoverPrompt.BACKUP_STANDING else null
}

/** The one sentence the prompt leads with. */
fun handoverPromptHeadline(kind: String, locale: String? = null): String = when (kind) {
    HandoverPrompt.ACCEPT_OFFER ->
        AppStrings.translate(locale, "settings.handoverPromptOffered")
    HandoverPrompt.COMPLETE_CLAIM ->
        AppStrings.translate(locale, "settings.handoverPromptReady")
    HandoverPrompt.CLAIM_WAITING ->
        AppStrings.translate(locale, "settings.handoverPromptAsked")
    else -> AppStrings.translate(locale, "settings.handoverPromptBackup")
}

/**
 * What happens next, in the second person.
 *
 * The `backup_standing` branch is loss aversion, stated once and plainly, and
 * it is deliberately the same sentence the OWNER read when they named this
 * person — both ends of the arrangement should understand it identically.
 */
fun handoverPromptDetail(
    kind: String,
    ripensAt: String,
    expiresAt: String,
    locale: String? = null,
): String = when (kind) {
    HandoverPrompt.ACCEPT_OFFER ->
        AppStrings.translate(
            locale,
            "misc.ownershipDetailAcceptOffer",
            mapOf("when" to absoluteTime(expiresAt)),
        )

    HandoverPrompt.COMPLETE_CLAIM ->
        AppStrings.translate(locale, "misc.ownershipDetailCompleteClaim")

    HandoverPrompt.CLAIM_WAITING ->
        AppStrings.translate(
            locale,
            "misc.ownershipDetailClaimWaiting",
            mapOf("when" to absoluteTime(ripensAt)),
        )

    else -> AppStrings.translate(locale, "misc.ownershipDetailBackupStanding")
}

/**
 * What the button that ends it says, to the person it is happening to.
 *
 * [handoverCancelLabel] covers the Team card, where an owner reads about their
 * crew. Neither of its labels fits a claimant reading about their OWN request —
 * being told to "decline" something you asked for is the app misreading the
 * room. Null for the standing nomination, which has nothing to call off.
 */
fun handoverPromptCancelLabel(kind: String, locale: String? = null): String? = when (kind) {
    HandoverPrompt.ACCEPT_OFFER ->
        AppStrings.translate(locale, "settingsMore.ownershipDecline")
    HandoverPrompt.COMPLETE_CLAIM, HandoverPrompt.CLAIM_WAITING ->
        AppStrings.translate(locale, "settings.handoverWithdraw")
    else -> null
}
