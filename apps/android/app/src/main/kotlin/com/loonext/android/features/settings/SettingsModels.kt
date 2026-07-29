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

/** POST /v1/registration/enable-us. `invoice_id` is null when the one-time
 *  fee was already paid (it is charged at most once per company, ever). */
@Serializable
data class EnableUsResult(
    val us_texting_enabled: Boolean = true,
    val invoice_id: String? = null,
    val action: String? = null,
)

@Serializable
data class RegistrationDetailPair(
    val brand: RegistrationDetail? = null,
    val campaign: RegistrationDetail? = null,
)

/**
 * GET /v1/account/deletion-preview (#346) — what deleting your account would
 * touch, asked before anything happens. `blocked_by == "owner"` means the
 * workspaces below have to be handed on or closed first: a workspace cannot be
 * left with no owner, and there is no transfer path yet (#332).
 */
@Serializable
data class AccountDeletionPreview(
    val blocked_by: String? = null,
    val owned_workspaces: List<OwnedWorkspace> = emptyList(),
    val memberships: Int = 0,
    val open_conversations: Int = 0,
    val open_tasks: Int = 0,
) {
    val blockedByOwnership: Boolean get() = blocked_by == "owner"

    /** What the crew picks up when this person leaves. */
    val openWork: Int get() = open_conversations + open_tasks
}

@Serializable
data class OwnedWorkspace(val id: String, val name: String)

/** DELETE /v1/account (#346). */
@Serializable
data class AccountDeletionResult(
    val deleted: Boolean = false,
    val workspaces_left: Int = 0,
    val personal_rows_removed: Int = 0,
    /** #371: sent before the address itself was removed, or not sent at all. */
    val receipt_emailed: Boolean = false,
)

// ---------------------------------------------------------------------------
// Signed-in devices (#236 — routes/sessions.ts)
// ---------------------------------------------------------------------------

object SessionClient {
    const val WEB = "web"
    const val ANDROID = "android"
    const val IOS = "ios"
    const val UNKNOWN = "unknown"
}

/**
 * GET /v1/sessions — one device signed in as YOU. Company-exempt: a session
 * belongs to the person, not to one of their workspaces.
 *
 * `location` is approximate and arrives absent rather than partial ("we do
 * not know" is a fact worth rendering; half a city is not). `current` is
 * decided by the server from the token's own session id — the app never has
 * to work out which row it is looking at itself.
 */
@Serializable
data class DeviceSession(
    val id: String,
    val client: String = SessionClient.UNKNOWN,
    val user_agent: String? = null,
    val location: String? = null,
    val signed_in_at: String,
    val last_active_at: String,
    val current: Boolean = false,
)

/**
 * GET /v1/members/sessions — the crew's devices, admin+. Deliberately narrower
 * than [DeviceSession]: an owner needs to recognise a phone that has not been
 * near the business in three weeks, not to read a teammate's user agent.
 */
@Serializable
data class WorkspaceSession(
    val id: String,
    val member_id: String? = null,
    val client: String = SessionClient.UNKNOWN,
    val location: String? = null,
    val signed_in_at: String,
    val last_active_at: String,
)

/** What a revoke actually ended. */
@Serializable
data class SessionRevokeResult(
    val sessions: Int = 0,
    val devices: Int = 0,
)

// ---------------------------------------------------------------------------
// Ownership (#332 — routes/ownership.ts)
// ---------------------------------------------------------------------------

/** A handover in flight. Until it lands, nothing about the workspace changed. */
@Serializable
data class PendingHandover(
    /** 'offer' — the owner is handing it over. 'claim' — the backup is taking it. */
    val kind: String,
    val to_member_id: String? = null,
    val ripens_at: String,
    val expires_at: String,
    val created_at: String,
    /** This caller is the person it is addressed to. */
    val mine: Boolean = false,
    /** The waiting period is over (an offer is ready the moment it is made). */
    val ready: Boolean = false,
)

/**
 * GET /v1/company/ownership.
 *
 * Every permission arrives as a boolean the SERVER decided. Three clients each
 * re-deriving `can_claim` from a pile of ids is three chances to show somebody
 * a button that takes a business.
 */
@Serializable
data class Ownership(
    val owner_member_id: String? = null,
    val backup_member_id: String? = null,
    val i_am_backup: Boolean = false,
    val i_am_owner: Boolean = false,
    val pending: PendingHandover? = null,
    val can_offer: Boolean = false,
    val can_claim: Boolean = false,
    val can_cancel: Boolean = false,
)

object HandoverKind {
    const val OFFER = "offer"
    const val CLAIM = "claim"
}
