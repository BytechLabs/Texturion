import Foundation

/// Settings-only wire models missing from Core/Model, verified against the
/// route files (apps/api/src/routes/{porting,text-enablement,numbers,
/// available-numbers,registration,notifications}.ts) and mirroring the Android
/// twin's SettingsModels.kt 1:1. Core models (CompanyView, PhoneNumberSummary,
/// Member, Invite, Usage, BillingModules, NotificationPrefs, …) are reused —
/// never redefined. Property names ARE the wire names (CodableDefaults rule).

// MARK: - Port-in (routes/porting.ts sanitizePort)

enum PortStatus {
    static let draft = "draft"
    static let submitted = "submitted"
    static let inProcess = "in-process"
    static let exception = "exception"
    static let focDateConfirmed = "foc-date-confirmed"
    static let activationInProgress = "activation-in-progress"
    static let ported = "ported"
    static let cancelPending = "cancel-pending"
    static let cancelled = "cancelled"
}

struct PortabilityCheck: Codable, Sendable {
    let portable: Bool
    let country: String?
    @Default<DefaultFalse> var is_wireless: Bool
    @Default<DefaultFalse> var fast_portable: Bool
    @Default<DefaultFalse> var messaging_capable: Bool
    let reason: String?
}

/// PII never leaves the server — only `has_*` on-file booleans arrive.
struct PortRequest: Codable, Sendable {
    let id: String
    let phone_e164: String
    let country: String
    let status: String
    let messaging_port_status: String?
    let foc_date: String?
    let foc_datetime_requested: String?
    let rejection_reason: String?
    @Default<DefaultZero> var submission_count: Int
    @Default<DefaultEmptyString> var entity_name: String
    @Default<DefaultEmptyString> var auth_person_name: String
    let billing_phone_number: String?
    @Default<DefaultEmptyString> var service_street: String
    let service_extended: String?
    @Default<DefaultEmptyString> var service_locality: String
    @Default<DefaultEmptyString> var service_admin_area: String
    @Default<DefaultEmptyString> var service_postal_code: String
    @Default<DefaultFalse> var is_wireless: Bool
    @Default<DefaultFalse> var wants_bridge_number: Bool
    let bridge_number_id: String?
    let bridge_number_e164: String?
    @Default<DefaultFalse> var has_pin: Bool
    @Default<DefaultFalse> var has_account_number: Bool
    @Default<DefaultFalse> var has_ssn_sin_last4: Bool
    @Default<DefaultFalse> var has_loa: Bool
    @Default<DefaultFalse> var has_invoice: Bool
    @Default<DefaultFalse> var assignment_blocked: Bool
    let submitted_at: String?
    let ported_at: String?
    let cancelled_at: String?
    let created_at: String?
}

// MARK: - Text-enablement (routes/text-enablement.ts sanitize)

enum TextEnablementStatus {
    static let pending = "pending"
    static let actionRequired = "action-required"
    static let inProgress = "in-progress"
    static let completed = "completed"
    static let failed = "failed"
    static let cancelled = "cancelled"
}

struct TextEnablementOrder: Codable, Sendable {
    let id: String
    let phone_e164: String
    let country: String
    let status: String
    @Default<DefaultFalse> var has_loa: Bool
    @Default<DefaultFalse> var has_bill: Bool
    let last_error: String?
    let completed_at: String?
    let cancelled_at: String?
    let created_at: String?
}

// MARK: - Number picker (GET /v1/available-numbers → telnyx/inventory.ts)

struct AvailableNumber: Codable, Sendable {
    let phone_number: String
    let region: String?
    @Default<DefaultEmptyList<String>> var features: [String]
}

struct AvailableNumbersResult: Codable, Sendable {
    @Default<DefaultEmptyList<AvailableNumber>> var data: [AvailableNumber]
    @Default<DefaultFalse> var best_effort_exhausted: Bool
    /// CA inventory arrives digit-masked — the pick becomes an area code.
    @Default<DefaultFalse> var masked: Bool
}

// MARK: - #106 per-number access (GET/PUT /v1/numbers/:id/access)

enum NumberAccessKind {
    static let everyone = "everyone"
    static let role = "role"
    static let users = "users"
}

enum NumberAccessLevel {
    static let text = "text"
    static let note = "note"
}

struct NumberAccess: Codable, Sendable {
    let access: String
    let role: String?
    let level: String?
    @Default<DefaultEmptyList<String>> var user_ids: [String]
}

// MARK: - 10DLC registration (GET /v1/registration — O/A additionally receive `data`)

enum RegistrationStatus {
    static let draft = "draft"
    static let submitted = "submitted"
    static let pending = "pending"
    static let approved = "approved"
    static let rejected = "rejected"
}

/// Richer than Core's RegistrationSummary (the company-view embed): the
/// settings GET /v1/registration adds `id` and the O/A-only wizard `data` bag.
struct RegistrationDetail: Codable, Sendable {
    let id: String?
    let kind: String
    let status: String
    @Default<DefaultFalse> var sole_proprietor: Bool
    let rejection_reason: String?
    @Default<DefaultZero> var submission_count: Int
    let submitted_at: String?
    let approved_at: String?
    let rejected_at: String?
    let deactivated_at: String?
    /// Wizard draft (carries EIN/BN) — present for owner/admin only.
    let data: JSONValue?
}

/// POST /v1/registration/enable-us. `invoice_id` is null when the one-time
/// fee was already paid (it is charged at most once per company, ever).
struct EnableUsResult: Codable, Sendable {
    @Default<DefaultTrue> var us_texting_enabled: Bool
    let invoice_id: String?
    let action: String?
}

struct RegistrationDetailPair: Codable, Sendable {
    let brand: RegistrationDetail?
    let campaign: RegistrationDetail?
}

// MARK: - Document upload (multipart PUT routes)

/// One document part for the multipart PUT upload routes.
struct DocumentUpload: Sendable {
    let fieldName: String
    let fileName: String
    let mimeType: String
    let bytes: Data
}

// MARK: - Account deletion (#346)

/// GET /v1/account/deletion-preview — what deleting your account would touch,
/// asked before anything happens. `blocked_by == "owner"` means the workspaces
/// below have to be handed on or closed first: a workspace cannot be left with
/// no owner, and there is no transfer path yet (#332).
struct AccountDeletionPreview: Codable, Sendable {
    let blocked_by: String?
    let owned_workspaces: [OwnedWorkspace]
    let memberships: Int
    let open_conversations: Int
    let open_tasks: Int

    var blockedByOwnership: Bool { blocked_by == "owner" }

    /// What the crew picks up when this person leaves.
    var openWork: Int { open_conversations + open_tasks }
}

struct OwnedWorkspace: Codable, Sendable {
    let id: String
    let name: String
}

/// DELETE /v1/account (#346).
struct AccountDeletionResult: Codable, Sendable {
    let deleted: Bool
    let workspaces_left: Int
    let personal_rows_removed: Int
    /// #371: sent before the address itself was removed, or not sent at all.
    /// Optional so an older server that does not send it still decodes.
    let receipt_emailed: Bool?
}

// MARK: - Signed-in devices (#236 — routes/sessions.ts)

enum SessionClient {
    static let web = "web"
    static let android = "android"
    static let ios = "ios"
    static let unknown = "unknown"
}

/// GET /v1/sessions — one device signed in as YOU. Company-exempt: a session
/// belongs to the person, not to one of their workspaces.
///
/// `location` is approximate and arrives absent rather than partial ("we do
/// not know" is a fact worth rendering; half a city is not). `current` is
/// decided by the server from the token's own session id, so the app never has
/// to work out which row it is looking at.
struct DeviceSession: Codable, Sendable, Identifiable {
    let id: String
    let client: String?
    let user_agent: String?
    let location: String?
    let signed_in_at: String
    let last_active_at: String
    let current: Bool?

    var clientKind: String { client ?? SessionClient.unknown }
    var isCurrent: Bool { current ?? false }
}

/// GET /v1/members/sessions — the crew's devices, admin+. Deliberately
/// narrower than `DeviceSession`: an owner needs to recognise a phone that has
/// not been near the business in three weeks, not to read a teammate's user
/// agent.
struct WorkspaceSession: Codable, Sendable, Identifiable {
    let id: String
    let member_id: String?
    let client: String?
    let location: String?
    let signed_in_at: String
    let last_active_at: String

    var clientKind: String { client ?? SessionClient.unknown }
}

/// What a revoke actually ended.
struct SessionRevokeResult: Codable, Sendable {
    let sessions: Int?
    let devices: Int?

    var endedSessions: Int { sessions ?? 0 }
    var endedDevices: Int { devices ?? 0 }
}

// MARK: - Ownership (#332 — routes/ownership.ts)

enum HandoverKind {
    static let offer = "offer"
    static let claim = "claim"
}

/// A handover in flight. Until it lands, nothing about the workspace changed.
struct PendingHandover: Codable, Sendable {
    /// 'offer' — the owner is handing it over. 'claim' — the backup is taking it.
    let kind: String
    let to_member_id: String?
    let ripens_at: String
    let expires_at: String
    let created_at: String
    /// This caller is the person it is addressed to.
    let mine: Bool?
    /// The waiting period is over (an offer is ready the moment it is made).
    let ready: Bool?

    var isMine: Bool { mine ?? false }
    var isReady: Bool { ready ?? false }
}

/// GET /v1/company/ownership.
///
/// Every permission arrives as a boolean the SERVER decided. Three clients
/// each re-deriving `can_claim` from a pile of ids is three chances to show
/// somebody a button that takes a business.
struct Ownership: Codable, Sendable {
    let owner_member_id: String?
    let backup_member_id: String?
    let i_am_backup: Bool?
    let i_am_owner: Bool?
    let pending: PendingHandover?
    let can_offer: Bool?
    let can_claim: Bool?
    let can_cancel: Bool?

    var isOwner: Bool { i_am_owner ?? false }
    var isBackup: Bool { i_am_backup ?? false }
    var canOffer: Bool { can_offer ?? false }
    var canClaim: Bool { can_claim ?? false }
    var canCancel: Bool { can_cancel ?? false }
}

/// GET /v1/billing/missed-while-off (#490) — how many customers rang while the
/// line could not take them, and when it last happened.
///
/// The argument for reinstating, with evidence attached. Before #490 the
/// business was never told those calls had happened at all.
struct MissedWhileOff: Codable, Sendable {
    let count: Int?
    /// The window's start — the count is bounded to the last 90 days.
    let since: String?
    /// The most recent one, or nil. Says WHEN, not only how many.
    let last_at: String?

    var total: Int { count ?? 0 }
}

// MARK: - Two-factor authentication (#314 — routes/mfa.ts)

struct MfaFactor: Codable, Sendable, Identifiable {
    let id: String
    let type: String?
    let name: String?
    let created_at: String?
}

/// GET /v1/mfa. `aal` is this token's assurance level — `aal2` once a factor
/// has been verified for the session.
struct MfaState: Codable, Sendable {
    let factors: [MfaFactor]?
    let enrolled: Bool?
    let recovery_codes_remaining: Int?
    let aal: String?

    var isEnrolled: Bool { enrolled ?? false }
    var allFactors: [MfaFactor] { factors ?? [] }
    var codesRemaining: Int { recovery_codes_remaining ?? 0 }
}

/// The ONLY time recovery codes exist outside the person's hands. They are
/// never retrievable again — a code we could re-display is one an attacker
/// with our database could re-display too.
struct RecoveryCodes: Codable, Sendable {
    let codes: [String]?
    var all: [String] { codes ?? [] }
}

/// PUT /v1/company/mfa. The grace deadline never moves once set.
struct WorkspaceMfa: Codable, Sendable {
    let required: Bool?
    let grace_until: String?
}
