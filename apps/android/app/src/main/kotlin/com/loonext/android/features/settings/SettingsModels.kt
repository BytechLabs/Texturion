package com.loonext.android.features.settings

import com.loonext.android.core.model.DayHours
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

/**
 * GET /v1/billing/missed-while-off (#490) — how many customers rang while the
 * line could not take them, and when it last happened.
 *
 * The argument for reinstating, with evidence attached. Before #490 the
 * business was never told those calls had happened at all.
 */
@Serializable
data class MissedWhileOff(
    val count: Int = 0,
    /** The window's start — the count is bounded to the last 90 days. */
    val since: String? = null,
    /** The most recent one, or null. Says WHEN, not only how many. */
    val last_at: String? = null,
)

/**
 * GET /v1/billing/cancellation-reason (#277 follow-up) — what they told us on
 * the way out, read back so the canceled-state card can answer during the grace
 * window what the cancel card answered on the way out.
 *
 * A dedicated route rather than a field on the company view, for the same
 * reason [MissedWhileOff] beside it is one: `loadCompanyView` runs on every app
 * boot for every role, and this can only ever be non-null for a workspace that
 * has already cancelled.
 *
 * NEVER THE FREE TEXT. The route does not serve `detail` and this model must
 * never grow a field for it — that is what somebody wrote about us in their own
 * words, and reading it back to them on a win-back card would be quoting them
 * at themselves. The CODE is all the card needs to pick an answer.
 */
@Serializable
data class StatedCancellationReason(
    /**
     * The stored code, or null. Null is a real answer and is NOT the same as no
     * row: it means somebody opened the cancel screen and skipped the question,
     * which is allowed on purpose. Both render nothing.
     */
    val reason: String? = null,
    /** When they said it. Not shown; kept so the shape matches the route. */
    val stated_at: String? = null,
)

// ---------------------------------------------------------------------------
// #277 — the paid pause (GET/POST /v1/billing/pause, POST /v1/billing/resume)
// ---------------------------------------------------------------------------

/**
 * GET /v1/billing/pause — may this workspace pause, what would it cost, and is
 * it paused already?
 *
 * One read answers all three because the billing screen needs all three: the
 * offer renders only when eligible, a workspace already paused should be told
 * since when rather than offered it again, and the price has to be on screen
 * before anybody presses anything.
 *
 * Its OWN route rather than a field on the company view, for the reason
 * [MissedWhileOff] above is one too: `loadCompanyView` runs on every app boot
 * for every role, and this is a billing fact that costs a Stripe round trip.
 */
@Serializable
data class PauseState(
    /**
     * THE ONLY THING THAT MAY PUT A PAUSE CONTROL ON SCREEN.
     *
     * The server has already folded the price into it — the route answers
     * `eligibility.eligible && offer !== null` — so a pause we cannot QUOTE
     * reports false here rather than arriving as an offer with no figure beside
     * it. A client that ORs anything into this, or that renders the control
     * while working out what to charge, has re-opened the one hole the route
     * closes.
     */
    val eligible: Boolean = false,
    /**
     * Why not, when [eligible] is false. `not_provisioned`, `no_subscription`,
     * `already_paused`, `subscription_unhealthy`, `plan_change_pending`,
     * `referral_month_pending`, `already_prepaid`, `prepaid_coupon_orphaned`.
     *
     * DELIBERATELY NEVER RENDERED. `not_provisioned` means the offer does not
     * exist, and the whole block is absent rather than greyed out; the rest are
     * conditions on a thing that was never offered, and a screen that explains
     * why an absent control is absent has invented a control. Modelled so a
     * failure can be read in a bug report, not so it can be shown.
     */
    val reason: String? = null,
    /** ISO. Non-null means paused RIGHT NOW — the whole of the paused state. */
    val paused_at: String? = null,
    /**
     * The REAL monthly figure, in cents: the Stripe catalog price while the
     * offer is being made, and the mirror of what this workspace is actually
     * charged once it is paused. Null is "we cannot say", and nothing may
     * substitute a figure for it.
     */
    val monthly_cents: Long? = null,
    /**
     * What they come back to. The pause never touches `companies.plan` — that
     * is the whole reason it is a price swap rather than a third plan — so this
     * is a real answer months into a quiet season.
     */
    val resume_plan: String? = null,
)

/**
 * POST /v1/billing/pause.
 *
 * Every field is RE-READ from the database mirror after the Stripe swap, and
 * the route answers 409 rather than success when the mirror disagrees. So this
 * is what happened, not what was asked for.
 */
@Serializable
data class PauseResult(
    val paused_at: String? = null,
    val monthly_cents: Long? = null,
    val resume_plan: String? = null,
)

/** POST /v1/billing/resume — re-read the same way, so `paused_at` is null. */
@Serializable
data class ResumeResult(
    val plan: String? = null,
    val paused_at: String? = null,
)

// ---------------------------------------------------------------------------
// Two-factor authentication (#314 — routes/mfa.ts)
// ---------------------------------------------------------------------------

@Serializable
data class MfaFactor(
    val id: String,
    val type: String = "totp",
    val name: String? = null,
    val created_at: String? = null,
)

/**
 * GET /v1/mfa. `aal` is this token's assurance level — `aal2` once a factor
 * has been verified for the session.
 */
@Serializable
data class MfaState(
    val factors: List<MfaFactor> = emptyList(),
    val enrolled: Boolean = false,
    val recovery_codes_remaining: Int = 0,
    val aal: String = "aal1",
)

/**
 * The ONLY time recovery codes exist outside the person's hands. They are
 * never retrievable again — a code we could re-display is one an attacker
 * with our database could re-display too.
 */
@Serializable
data class RecoveryCodes(val codes: List<String> = emptyList())

/** PUT /v1/company/mfa. The grace deadline never moves once set. */
@Serializable
data class WorkspaceMfa(
    val required: Boolean = false,
    val grace_until: String? = null,
)

/**
 * #307 — one field of a line's identity: what a caller gets, and whether it
 * came from the workspace rather than from this line.
 */
@Serializable
data class ResolvedField(
    val value: String? = null,
    val inherited: Boolean = true,
)

/** GET/PATCH /v1/numbers/{id}/identity. */
@Serializable
data class NumberIdentity(
    val label: ResolvedField = ResolvedField(),
    val voicemail_greeting: ResolvedField = ResolvedField(),
    val away_message: ResolvedField = ResolvedField(),
    val mctb_enabled: ResolvedBool = ResolvedBool(),
    val mctb_message: ResolvedField = ResolvedField(),
    val timezone: ResolvedField = ResolvedField(),
    val business_hours: ResolvedHours = ResolvedHours(),
    /** #309: which RECORDING plays. Null is the written words, read aloud. */
    val voicemail_greeting_id: ResolvedField = ResolvedField(),
    /**
     * #278: what a call to this line does outside its hours.
     *
     * A ResolvedField rather than a ResolvedBool for the same reason it is a
     * three-value column: "ring everyone" and "follow the workspace" are
     * different answers, and only a nullable value can say the second.
     */
    val after_hours_calls: ResolvedField = ResolvedField(),
    /** #278: the recording played after hours; null is the ordinary greeting. */
    val after_hours_greeting_id: ResolvedField = ResolvedField(),
    /** #278: how this line's phones ring. */
    val ring_strategy: ResolvedField = ResolvedField(),
    /** #278: how long they ring. A ResolvedInt because the value is a number
     *  and a string-shaped resolver would parse it back at every read. */
    val ring_seconds: ResolvedInt = ResolvedInt(),
)

/** A resolved NUMBER, and whether it came from the workspace. */
@Serializable
data class ResolvedInt(
    val value: Int? = null,
    val inherited: Boolean = true,
)

/**
 * The week, resolved. #307: `business_hours` is ONE column, so a line either
 * keeps its own week or follows the workspace's — inheritance is per week,
 * never per day.
 */
@Serializable
data class ResolvedHours(
    val value: Map<String, DayHours?>? = null,
    val inherited: Boolean = true,
)

/**
 * The same shape for the one field that is not text.
 *
 * A separate type rather than a nullable value on [ResolvedField]: the toggle
 * always resolves to a real boolean, and giving it a `String?` would put a
 * "true"/"false" parse between the server and a switch for no reason.
 */
@Serializable
data class ResolvedBool(
    val value: Boolean = false,
    val inherited: Boolean = true,
)
