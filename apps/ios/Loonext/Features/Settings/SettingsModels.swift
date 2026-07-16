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
