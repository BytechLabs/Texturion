package com.loonext.android.core.model

import kotlinx.serialization.Serializable

/** POST /v1/billing/checkout and /portal — open in an EXTERNAL browser. */
@Serializable
data class HostedUrl(val url: String)

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

/** POST /v1/billing/change-plan result. */
@Serializable
data class ChangePlanResult(
    val plan: String,
    val effective: String,
    val effective_at: String? = null,
)
