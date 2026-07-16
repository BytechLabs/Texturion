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
    val attachment_budget_bytes: Long = 0,
    val mms_budget_bytes: Long = 0,
)

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

/** GET /v1/usage — nulls when the company has never checked out. */
@Serializable
data class Usage(
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
)

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
