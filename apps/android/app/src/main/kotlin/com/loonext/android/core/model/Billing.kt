package com.loonext.android.core.model

import kotlinx.serialization.Serializable

/** POST /v1/billing/checkout and /portal — open in an EXTERNAL browser. */
@Serializable
data class HostedUrl(val url: String)

/**
 * #583 — a prepaid year, as far as this client needs it.
 *
 * The phones do not SELL a year (that lives on web, where the up-front payment
 * belongs), so this is deliberately not the whole `GET /v1/billing/prepay` shape.
 * What a phone needs is the half that changes what a plan switch does: a year is
 * running, and this much of it comes back if you end it.
 *
 * EVERY FIGURE IS IN `currency`, which is what was COLLECTED — a year bought before
 * the CAD option was filed is genuinely USD even on a workspace billed in CAD today.
 * Printing it in the workspace's current currency would relabel somebody's payment.
 *
 * Defaults everywhere, because this decodes a response written by a newer or older
 * server than the app: an absent `conversion` reads as "no figure to show" and the
 * panel says the year ends without quoting an amount, rather than crashing.
 */
@Serializable
data class PrepaidConversion(
    val consumed_months: Int = 0,
    val credit_cents: Int = 0,
)

@Serializable
data class OpenPrepaidYear(
    val plan: String = "starter",
    val amount_cents: Int = 0,
    val currency: String = "usd",
    val granted_through: String? = null,
    val conversion: PrepaidConversion? = null,
)

@Serializable
data class PrepayOffer(
    val open: OpenPrepaidYear? = null,
)


@Serializable
data class UsageMonth(val month: String, val segments: Long)

@Serializable
data class UsageStorage(
    val attachments_bytes: Long = 0,
    val mms_bytes: Long = 0,
    /** Media a customer sent us. */
    val received_media_bytes: Long = 0,
    /** Media we sent out. */
    val sent_media_bytes: Long = 0,
    /** Voicemail recordings we keep in our own bucket. */
    val voicemail_bytes: Long = 0,
    /** Anything stored that the named kinds do not account for. */
    val other_bytes: Long = 0,
    /** Every byte this workspace holds, measured from the buckets themselves. */
    val total_bytes: Long = 0,
) {
    /**
     * What is really stored. The old line added two figures together and so
     * left voicemail recordings out entirely; the server measures the buckets
     * now, and the sum is only a fallback for a response that predates it.
     */
    val totalStored: Long
        get() = if (total_bytes > 0) total_bytes else attachments_bytes + mms_bytes
}

@Serializable
data class UsageVoice(
    val used_minutes: Long = 0,
    val included_minutes: Long = 0,
    val cap_minutes: Long? = null,
    val overage_minutes: Long = 0,
    val projected_overage_cents: Long = 0,
    val overage_billed: Boolean = true,
)

@Serializable
data class UsageOverageProjection(
    val trending_over: Boolean = false,
    val projected_overage_cents: Long = 0,
)

/**
 * #178: the fair-use presentation contract. GET /v1/usage derives `status`
 * server-side so every client renders the same philosophy: 'quiet' shows no
 * meters anywhere, 'pacing' shows the early warning, 'capped' shows the
 * owner-set spending cap approaching (>=90%) or reached.
 */
object UsageStatus {
    const val QUIET = "quiet"
    const val PACING = "pacing"
    const val CAPPED = "capped"
}

/** GET /v1/usage — nulls when the company has never checked out. */
@Serializable
data class Usage(
    /** #178 presentation status; the default keeps pre-#178 cached payloads
     *  decoding as the calm state (unknown values also render quiet). */
    val status: String = UsageStatus.QUIET,
    /**
     * #522: the currency EVERY *_cents figure on this payload is quoted in.
     *
     * The server states it rather than leaving this client to pair the numbers
     * with `companies.billing_currency` read separately — those two can
     * disagree, and the failure is silent: the screen labels a CAD figure USD.
     * Defaults to USD so a payload from a server that predates it reads as what
     * every workspace was actually charged then.
     */
    val currency: String? = null,
    val period_start: String? = null,
    val period_end: String? = null,
    val included_segments: Long = 0,
    val used_segments: Long = 0,
    val inbound_segments: Long = 0,
    val overage_segments: Long = 0,
    val cap_segments: Long? = null,
    val projected_overage_cents: Long = 0,
    val overage_projection: UsageOverageProjection = UsageOverageProjection(),
    val history: List<UsageMonth> = emptyList(),
    val storage: UsageStorage = UsageStorage(),
    val voice: UsageVoice = UsageVoice(),
    /**
     * What Lou has done this month, per feature. Defaults to empty so a client
     * talking to a server that predates it renders no section rather than
     * failing to decode.
     */
    val ai: List<AiFeatureUsage> = emptyList(),
    /**
     * #426: carrier-reported delivery for the period. Null on a server that
     * predates it, or when the read failed — the rest of the page still shows.
     */
    val delivery: UsageDelivery? = null,
)

/**
 * #426 — carrier-reported delivery, split by where the message was going.
 *
 * The NAME is load-bearing: a receipt means a carrier acknowledged handoff,
 * not that a person read it, so every surface says "carrier-reported".
 */
@Serializable
data class UsageDeliveryCountry(
    /** "US" | "CA" | "other", from the destination's area code. */
    val country: String = "other",
    val delivered: Long = 0,
    val failed: Long = 0,
    /** Accepted by us, not yet acknowledged by a carrier. Not a failure. */
    val pending: Long = 0,
    /**
     * delivered / (delivered + failed), or NULL when too few have settled to
     * mean anything. Render counts and never a percentage when null: one
     * failure out of forty reads as 2.5% and usually means a disconnected
     * number, which is manufactured worry rather than information.
     */
    val rate: Double? = null,
)

@Serializable
data class UsageDelivery(
    val by_country: List<UsageDeliveryCountry> = emptyList(),
    val delivered: Long = 0,
    val failed: Long = 0,
    val pending: Long = 0,
)

/** One AI feature's month: what has been used against its limit. */
@Serializable
data class AiFeatureUsage(
    /** The ledger key, so a row is identified without matching on copy. */
    val key: String,
    val label: String,
    val used: Long = 0,
    val cap: Long = 0,
    val enabled: Boolean = true,
    /**
     * #431 ask 3 — what people did with the output, beside what it cost.
     *
     * Labelled by the server in each feature's own words ("sent as written",
     * "cleared") so all three clients say the same thing. EMPTY until outcomes
     * arrive, and an empty list must render as "not measured yet" rather than as
     * zeroes: a feature used forty times with nothing recorded is an
     * instrumentation gap, and "0 sent as written" would report that gap as a
     * verdict on the quality.
     */
    val outcomes: List<AiOutcomeLine> = emptyList(),
    /**
     * How many outcomes those lines cover. Separate from `used` because they
     * will not match — a draft offered and never read is a request with no
     * outcome — and no rate is computed anywhere, deliberately.
     */
    val outcomesRecorded: Long = 0,
)

/** #431: what a person did with one feature's output, ready to render. */
@Serializable
data class AiOutcomeLine(val label: String, val count: Long = 0)

/** GET /v1/billing/modules — admin-only add-on catalog with enabled state. */
@Serializable
data class BillingModules(val modules: List<BillingModule> = emptyList())

@Serializable
data class BillingModule(
    val id: String,
    val label: String,
    val blurb: String,
    val detail: String? = null,
    val monthly_cents: Long,
    val enabled: Boolean = false,
    /** #41: deliverable AND priced in this environment; refuse to sell otherwise. */
    val available: Boolean = false,
)

/**
 * #523 — a number this workspace holds that its plan does not currently cover.
 *
 * NOT RELEASED, and the word is chosen: the row is still ours, still receiving,
 * and its history is untouched. It simply cannot send or answer. Every surface
 * that renders one of these has to carry that distinction, because "suspended"
 * on its own reads as "gone" to the person whose van has the number on it.
 */
@Serializable
data class HeldNumber(
    val id: String,
    val number_e164: String? = null,
    /** When it went on hold. Null for a row suspended before #523 shipped. */
    val suspended_at: String? = null,
)

/**
 * #523 — why a number is on hold, as the SERVER decides it.
 *
 * Two values, not three, and the split is the one thing this client must not
 * re-derive: `over_plan_allowance` means the subscription is live and the
 * workspace simply holds more numbers than it pays for, which is the state with
 * a way out; `subscription_inactive` means the suspension belongs to the
 * cancellation or the failed payment, which other cards on the same screen
 * already own. Rendering both from one card would be two explanations of one
 * suspension sitting an inch apart.
 */
object HeldNumberReason {
    const val OVER_PLAN_ALLOWANCE = "over_plan_allowance"
    const val SUBSCRIPTION_INACTIVE = "subscription_inactive"
}

/**
 * GET /v1/billing/held-numbers (#523) — owner/admin only (`billing.manage`).
 *
 * EVERY FIGURE ON THIS CARD ARRIVES HERE. The allowance, the plan's hard cap
 * and the price of un-holding one are served rather than derived, and
 * [extra_number_cents] carries [extra_number_currency] beside it because the
 * extra-number price book is filed in USD only — a bare "$5" in front of a
 * Canadian reader means CAD and is the #522 defect verbatim.
 *
 * Defaults everywhere, so a client talking to a Worker that predates the route
 * decodes an empty state and draws nothing rather than failing the read.
 */
@Serializable
data class HeldNumbers(
    /** "starter" | "pro" | null (no checkout yet). */
    val plan: String? = null,
    /** Numbers the plan itself covers. Null when [plan] is null. */
    val included: Int? = null,
    /** Extra-number capacity actually billed today. */
    val paid_extras: Int = 0,
    /** included + paid_extras — what may be live at once. Null with no plan. */
    val allowance: Int? = null,
    /** The plan's hard TOTAL cap (#80), or null when it has none (Pro). */
    val max_total: Int? = null,
    /** [HeldNumberReason], or null when nothing is held. */
    val reason: String? = null,
    val held: List<HeldNumber> = emptyList(),
    /** What buying capacity for ONE held number costs. */
    val extra_number_cents: Int? = null,
    /** The currency [extra_number_cents] is denominated in ("usd"). */
    val extra_number_currency: String? = null,
    /**
     * Whether the reinstate route would be accepted right now. Served so the
     * button can be ABSENT rather than fail — being told "no" after pressing it
     * is how somebody concludes the product is broken.
     */
    val can_reinstate: Boolean = false,
    /** Starter only: the other way back, which buys no extra number. */
    val can_upgrade: Boolean = false,
)

/** POST /v1/billing/held-numbers/:id/reinstate (#523). */
@Serializable
data class ReinstateResult(
    val reinstated: Boolean = false,
    /**
     * It was already back — a double-press, or an upgrade reinstated it between
     * the card painting and the button being pressed. Not an error, and
     * emphatically not a second charge.
     */
    val already_active: Boolean = false,
    val paid_extras: Int? = null,
    val allowance: Int? = null,
    val held: List<HeldNumber> = emptyList(),
)

/** POST /v1/billing/change-plan result. */
@Serializable
data class ChangePlanResult(
    val plan: String,
    val effective: String,
    val effective_at: String? = null,
    /**
     * #523: what the bigger allowance brought back with it. Pro includes two
     * numbers, so an upgrade is one of the two routes out of a hold — and an
     * owner who pays $79 to get their second line back needs to be told it
     * worked rather than left to go and look. Empty on every ordinary upgrade.
     */
    val reinstated: List<HeldNumber> = emptyList(),
    /** Still on hold after the upgrade — a Pro workspace can hold three. */
    val held: List<HeldNumber> = emptyList(),
)
