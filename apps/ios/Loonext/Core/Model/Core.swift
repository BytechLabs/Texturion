import Foundation

/// Wire models mirror apps/web/src/lib/api/types.ts (the route files are the
/// truth). Server string-enums stay Swift Strings with namespaces of static
/// constants so a lagging mobile build never crashes on a value added
/// server-side; UI switches always carry a default arm.
///
/// Key mapping: property names are the wire names (snake_case, no CodingKeys,
/// no key strategy) — see CodableDefaults.swift for the rule.

/// SPEC §7 list envelope — cursor-based only, opaque cursor.
struct Page<T: Codable & Sendable>: Codable, Sendable {
    let data: [T]
    let next_cursor: String?
}

enum SubscriptionStatus {
    static let incomplete = "incomplete"
    static let incompleteExpired = "incomplete_expired"
    static let active = "active"
    static let pastDue = "past_due"
    static let unpaid = "unpaid"
    static let canceled = "canceled"
}

enum MemberRole {
    static let owner = "owner"
    static let admin = "admin"
    static let member = "member"

    /// Hierarchical check: does `role` meet `required`?
    static func atLeast(_ role: String?, required: String) -> Bool {
        let rank = [owner: 3, admin: 2, member: 1]
        let held = role.flatMap { rank[$0] } ?? 0
        let needed = rank[required] ?? Int.max
        return held >= needed
    }
}

struct Membership: Codable, Sendable {
    let company_id: String
    let name: String
    let role: String
    let subscription_status: String
}

/// GET /v1/me — optionally hydrated with `company` when X-Company-Id is sent.
struct Me: Codable, Sendable {
    let user_id: String
    let display_name: String
    let memberships: [Membership]
    let company: CompanyView?
}

enum NumberStatus {
    static let provisioning = "provisioning"
    static let active = "active"
    static let suspended = "suspended"
    static let released = "released"
    static let provisionFailed = "provision_failed"
}

/// Numbers summary embedded in company views + GET /v1/numbers rows.
struct PhoneNumberSummary: Codable, Sendable {
    let id: String
    let status: String
    let country: String
    let number_e164: String?
    let requested_area_code: String?
    let created_at: String
    let source: String?
    let voice_enabled: Bool?
    let suspended_at: String?
    let released_at: String?
    let failure_reason: String?
    let provision_attempts: Int?
    let retrying: Bool?
}

struct RegistrationSummary: Codable, Sendable {
    let kind: String
    let status: String
    let sole_proprietor: Bool
    let rejection_reason: String?
    let submission_count: Int
    let submitted_at: String?
    let approved_at: String?
    let rejected_at: String?
    let deactivated_at: String?
}

struct RegistrationPair: Codable, Sendable {
    let brand: RegistrationSummary?
    let campaign: RegistrationSummary?

    init(brand: RegistrationSummary? = nil, campaign: RegistrationSummary? = nil) {
        self.brand = brand
        self.campaign = campaign
    }
}

/// A weekday open/close window in 24h "HH:MM" company-local time.
struct DayHours: Codable, Sendable, Equatable {
    let open: String
    let close: String
}

enum DefaultScreeningOff: DefaultCodableProvider {
    static var defaultValue: String { "off" }
}

/// #193: caller ID defaults to the company name platform-wide, so a lagging
/// payload without the field reads as the company-name default.
enum DefaultCallerIdCompanyName: DefaultCodableProvider {
    static var defaultValue: String { "company_name" }
}

enum DefaultEmptyBusinessHours: DefaultCodableProvider {
    static var defaultValue: [String: DayHours?] { [:] }
}

enum DefaultEmptyRegistrationPair: DefaultCodableProvider {
    static var defaultValue: RegistrationPair { RegistrationPair() }
}

/// GET /v1/company and the GET /v1/me `company` hydration.
struct CompanyView: Codable, Sendable {
    let id: String
    let name: String
    let country: String
    let us_texting_enabled: Bool
    let requested_area_code: String
    let chosen_number_e164: String?
    let timezone: String
    let plan: String?
    let subscription_status: String
    let current_period_start: String?
    let current_period_end: String?
    /// Wire union number|string|null — read via `overageCapMultiplier`.
    let overage_cap_multiplier: JSONValue?
    let registration_fee_paid_at: String?
    let canceled_at: String?
    @Default<DefaultFalse> var cancel_at_period_end: Bool
    /// #163 store-rules kill-switch: false = hide in-app billing WRITES (plan
    /// change, module toggles) and route them to the external-browser Stripe
    /// surfaces. Defaults TRUE so a lagging server never strips affordances.
    @Default<DefaultTrue> var billing_writes_enabled: Bool
    /// weekday (mon..sun) -> window; missing/null weekday = closed all day.
    @Default<DefaultEmptyBusinessHours> var business_hours: [String: DayHours?]
    @Default<DefaultFalse> var away_enabled: Bool
    let away_message: String?
    @Default<DefaultFalse> var mctb_enabled: Bool
    let mctb_message: String?
    /// #192: server-resolved template that will actually send (custom else the
    /// shared product default) — the client renders server truth, never guesses.
    let mctb_effective_message: String?
    /// #192: true when the effective message is the owner's custom text.
    @Default<DefaultFalse> var mctb_message_is_custom: Bool
    let voicemail_greeting: String?
    @Default<DefaultScreeningOff> var call_screening: String
    let cnam_display_name: String?
    @Default<DefaultFalse> var caller_id_lookup: Bool
    /// #193: the outbound caller ID actually in effect (server-resolved: the
    /// explicit override, else the company name in the carrier alphabet). Nil
    /// only when neither yields a listable name.
    let caller_id_effective: String?
    /// #193: 'company_name' = platform default; 'custom' = owner-set.
    @Default<DefaultCallerIdCompanyName> var caller_id_source: String
    /// #193: when the listing last went to the carrier side (propagation takes
    /// days with no completion signal, so the timestamp IS the state).
    let cnam_submitted_at: String?
    let created_at: String
    let updated_at: String
    @Default<DefaultEmptyList<PhoneNumberSummary>> var numbers: [PhoneNumberSummary]
    @Default<DefaultEmptyList<String>> var enabled_modules: [String]
    @Default<DefaultEmptyRegistrationPair> var registration: RegistrationPair

    var subscriptionActive: Bool { subscription_status == SubscriptionStatus.active }

    /// nil = no cap.
    var overageCapMultiplier: Double? {
        switch overage_cap_multiplier {
        case .number(let value): value
        case .string(let value): Double(value)
        default: nil
        }
    }
}
