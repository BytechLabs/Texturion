package com.loonext.android.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Wire models mirror apps/web/src/lib/api/types.ts (the route files are the
 * truth). Server string-enums stay Kotlin Strings with named constants so a
 * lagging mobile build never crashes on a value added server-side; UI `when`
 * blocks always carry an `else`.
 */

/** SPEC §7 list envelope — cursor-based only, opaque cursor. */
@Serializable
data class Page<T>(
    val data: List<T>,
    val next_cursor: String? = null,
)

object SubscriptionStatus {
    const val INCOMPLETE = "incomplete"
    const val INCOMPLETE_EXPIRED = "incomplete_expired"
    const val ACTIVE = "active"
    const val PAST_DUE = "past_due"
    const val UNPAID = "unpaid"
    const val CANCELED = "canceled"
}

object MemberRole {
    const val OWNER = "owner"
    const val ADMIN = "admin"
    const val MEMBER = "member"

    /** Hierarchical check: does [role] meet [required]? */
    fun atLeast(role: String?, required: String): Boolean {
        val rank = mapOf(OWNER to 3, ADMIN to 2, MEMBER to 1)
        return (rank[role] ?: 0) >= (rank[required] ?: Int.MAX_VALUE)
    }
}

@Serializable
data class Membership(
    val company_id: String,
    val name: String,
    val role: String,
    val subscription_status: String,
)

/** GET /v1/me — optionally hydrated with `company` when X-Company-Id is sent. */
@Serializable
data class Me(
    val user_id: String,
    val display_name: String,
    val memberships: List<Membership>,
    val company: CompanyView? = null,
)

object NumberStatus {
    const val PROVISIONING = "provisioning"
    const val ACTIVE = "active"
    const val SUSPENDED = "suspended"
    const val RELEASED = "released"
    const val PROVISION_FAILED = "provision_failed"
}

/** Numbers summary embedded in company views + GET /v1/numbers rows. */
@Serializable
data class PhoneNumberSummary(
    val id: String,
    val status: String,
    val country: String,
    val number_e164: String? = null,
    val requested_area_code: String? = null,
    val created_at: String,
    val source: String? = null,
    val voice_enabled: Boolean? = null,
    val suspended_at: String? = null,
    val released_at: String? = null,
    val failure_reason: String? = null,
    val provision_attempts: Int? = null,
    val retrying: Boolean? = null,
)

@Serializable
data class RegistrationSummary(
    val kind: String,
    val status: String,
    val sole_proprietor: Boolean,
    val rejection_reason: String? = null,
    val submission_count: Int,
    val submitted_at: String? = null,
    val approved_at: String? = null,
    val rejected_at: String? = null,
    val deactivated_at: String? = null,
)

@Serializable
data class RegistrationPair(
    val brand: RegistrationSummary? = null,
    val campaign: RegistrationSummary? = null,
)

@Serializable
data class DayHours(val open: String, val close: String)

/** GET /v1/company and the GET /v1/me `company` hydration. */
@Serializable
data class CompanyView(
    val id: String,
    val name: String,
    val country: String,
    val us_texting_enabled: Boolean,
    val requested_area_code: String,
    val chosen_number_e164: String? = null,
    val timezone: String,
    val plan: String? = null,
    val subscription_status: String,
    val current_period_start: String? = null,
    val current_period_end: String? = null,
    /** Wire union number|string|null — parse via [overageCapMultiplier]. */
    val overage_cap_multiplier: kotlinx.serialization.json.JsonPrimitive? = null,
    val registration_fee_paid_at: String? = null,
    val canceled_at: String? = null,
    val cancel_at_period_end: Boolean = false,
    /** weekday (mon..sun) -> window; missing/null weekday = closed all day. */
    val business_hours: Map<String, DayHours?> = emptyMap(),
    val away_enabled: Boolean = false,
    val away_message: String? = null,
    val mctb_enabled: Boolean = false,
    val mctb_message: String? = null,
    val voicemail_greeting: String? = null,
    val call_screening: String = "off",
    val cnam_display_name: String? = null,
    val caller_id_lookup: Boolean = false,
    val created_at: String,
    val updated_at: String,
    val numbers: List<PhoneNumberSummary> = emptyList(),
    val enabled_modules: List<String> = emptyList(),
    val registration: RegistrationPair = RegistrationPair(),
) {
    val subscriptionActive: Boolean get() = subscription_status == SubscriptionStatus.ACTIVE

    /** null = no cap. */
    val overageCapMultiplier: Double?
        get() = overage_cap_multiplier?.content?.toDoubleOrNull()
}

/** One realtime broadcast payload is always an ID-bag; kept as raw JSON. */
typealias EventPayload = JsonObject
