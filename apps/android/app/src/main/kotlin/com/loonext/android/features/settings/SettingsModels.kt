package com.loonext.android.features.settings

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Settings-only wire models missing from core/model, verified against the
 * route files (apps/api/src/routes/{porting,text-enablement,numbers,
 * available-numbers,registration,notifications}.ts). Core models (CompanyView,
 * PhoneNumberSummary, Member, Invite, Usage, BillingModules, …) are reused.
 */

// ---------------------------------------------------------------------------
// Port-in (routes/porting.ts sanitizePort)
// ---------------------------------------------------------------------------

object PortStatus {
    const val DRAFT = "draft"
    const val SUBMITTED = "submitted"
    const val IN_PROCESS = "in-process"
    const val EXCEPTION = "exception"
    const val FOC_DATE_CONFIRMED = "foc-date-confirmed"
    const val ACTIVATION_IN_PROGRESS = "activation-in-progress"
    const val PORTED = "ported"
    const val CANCEL_PENDING = "cancel-pending"
    const val CANCELLED = "cancelled"
}

@Serializable
data class PortabilityCheck(
    val portable: Boolean,
    val country: String? = null,
    val is_wireless: Boolean = false,
    val fast_portable: Boolean = false,
    val messaging_capable: Boolean = false,
    val reason: String? = null,
)

/** PII never leaves the server — only `has_*` on-file booleans arrive. */
@Serializable
data class PortRequest(
    val id: String,
    val phone_e164: String,
    val country: String,
    val status: String,
    val messaging_port_status: String? = null,
    val foc_date: String? = null,
    val foc_datetime_requested: String? = null,
    val rejection_reason: String? = null,
    val submission_count: Int = 0,
    val entity_name: String = "",
    val auth_person_name: String = "",
    val billing_phone_number: String? = null,
    val service_street: String = "",
    val service_extended: String? = null,
    val service_locality: String = "",
    val service_admin_area: String = "",
    val service_postal_code: String = "",
    val is_wireless: Boolean = false,
    val wants_bridge_number: Boolean = false,
    val bridge_number_id: String? = null,
    val bridge_number_e164: String? = null,
    val has_pin: Boolean = false,
    val has_account_number: Boolean = false,
    val has_ssn_sin_last4: Boolean = false,
    val has_loa: Boolean = false,
    val has_invoice: Boolean = false,
    val assignment_blocked: Boolean = false,
    val submitted_at: String? = null,
    val ported_at: String? = null,
    val cancelled_at: String? = null,
    val created_at: String? = null,
)

// ---------------------------------------------------------------------------
// Text-enablement (routes/text-enablement.ts sanitize)
// ---------------------------------------------------------------------------

object TextEnablementStatus {
    const val PENDING = "pending"
    const val ACTION_REQUIRED = "action-required"
    const val IN_PROGRESS = "in-progress"
    const val COMPLETED = "completed"
    const val FAILED = "failed"
    const val CANCELLED = "cancelled"
}

@Serializable
data class TextEnablementOrder(
    val id: String,
    val phone_e164: String,
    val country: String,
    val status: String,
    val has_loa: Boolean = false,
    val has_bill: Boolean = false,
    val last_error: String? = null,
    val completed_at: String? = null,
    val cancelled_at: String? = null,
    val created_at: String? = null,
)

// ---------------------------------------------------------------------------
// Number picker (GET /v1/available-numbers → telnyx/inventory.ts)
// ---------------------------------------------------------------------------

@Serializable
data class AvailableNumber(
    val phone_number: String,
    val region: String? = null,
    val features: List<String> = emptyList(),
)

@Serializable
data class AvailableNumbersResult(
    val data: List<AvailableNumber> = emptyList(),
    val best_effort_exhausted: Boolean = false,
    /** CA inventory arrives digit-masked — the pick becomes an area code. */
    val masked: Boolean = false,
)

// ---------------------------------------------------------------------------
// #106 per-number access (GET/PUT /v1/numbers/:id/access)
// ---------------------------------------------------------------------------

object NumberAccessKind {
    const val EVERYONE = "everyone"
    const val ROLE = "role"
    const val USERS = "users"
}

object NumberAccessLevel {
    const val TEXT = "text"
    const val NOTE = "note"
}

@Serializable
data class NumberAccess(
    val access: String,
    val role: String? = null,
    val level: String? = null,
    val user_ids: List<String> = emptyList(),
)

// ---------------------------------------------------------------------------
// 10DLC registration (GET /v1/registration — O/A additionally receive `data`)
// ---------------------------------------------------------------------------

object RegistrationStatus {
    const val DRAFT = "draft"
    const val SUBMITTED = "submitted"
    const val PENDING = "pending"
    const val APPROVED = "approved"
    const val REJECTED = "rejected"
}

@Serializable
data class RegistrationDetail(
    val id: String? = null,
    val kind: String,
    val status: String,
    val sole_proprietor: Boolean = false,
    val rejection_reason: String? = null,
    val submission_count: Int = 0,
    val submitted_at: String? = null,
    val approved_at: String? = null,
    val rejected_at: String? = null,
    val deactivated_at: String? = null,
    /** Wizard draft (carries EIN/BN) — present for owner/admin only. */
    val data: JsonObject? = null,
)

@Serializable
data class RegistrationDetailPair(
    val brand: RegistrationDetail? = null,
    val campaign: RegistrationDetail? = null,
)
