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
    /// #386: nil when email can reach this person, which is the common case.
    /// Present when their address hard-bounced or reported us as spam — the
    /// only other symptom is that their notifications stop, which looks
    /// exactly like a quiet week.
    let email_state: EmailState?
    let company: CompanyView?
    /// #283: the client-side flags for the active workspace.
    ///
    /// Only `kill:realtime` today, and only because it is the one switch the
    /// server cannot enforce — clients hold their own Supabase token and open
    /// their own socket, so there is nothing for the Worker to refuse.
    /// `var … = [:]` rather than `let` so it does not become a required
    /// memberwise-init parameter at every existing construction site, and so
    /// absent reads as "no statement" rather than "off".
    var flags: [String: Bool] = [:]
}

/// #386: why we cannot email this member, and whether they can fix it.
struct EmailState: Codable, Sendable {
    let email: String
    /// "hard_bounce" — the address rejected us. "complaint" — reported as spam.
    let reason: String
    let since: String?
    /// True only for a hard bounce. A complaint is not ours to undo: tapping a
    /// button in our app is not consent to resume mailing somebody who marked
    /// us as spam.
    @Default<DefaultFalse> var fixable: Bool
}

enum NumberStatus {
    static let provisioning = "provisioning"
    static let active = "active"
    static let suspended = "suspended"
    static let released = "released"
    static let provisionFailed = "provision_failed"
}

/// Numbers summary embedded in company views + GET /v1/numbers rows.
/// #235: a number a carrier has started filtering or labelling.
struct NumberHealth: Codable, Sendable {
    /// Always "degraded" when present — a healthy number carries no row.
    let state: String
    /// 0-1 over the assessment window, or nil when there was too little to say.
    let delivery_rate: Double?
    /// When it first left healthy, so the notice can say how long.
    let degraded_since: String?
    /// Plain language, for support rather than the customer.
    let detail: String?
}

struct PhoneNumberSummary: Codable, Sendable {
    let id: String
    let status: String
    let country: String
    let number_e164: String?
    let requested_area_code: String?
    let created_at: String
    let source: String?
    let voice_enabled: Bool?
    /// #235: present only when a carrier is filtering or labelling this number.
    /// nil means healthy — which is also what an unassessed number reads as.
    /// The internal 'watch' state never reaches a client. `var … = nil` so it
    /// does not become a required memberwise-init parameter everywhere.
    var health: NumberHealth? = nil
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
    /// #414 ask 5: the template that will ACTUALLY send — the owner's text if
    /// they wrote one, else the product default, resolved by the SERVER. This
    /// screen used to carry its own copy of that default; so did web and
    /// Android, and nothing kept the three equal.
    @Default<DefaultEmptyString> var away_effective_message: String
    /// True when the owner's own away text is in effect.
    @Default<DefaultFalse> var away_message_is_custom: Bool
    /// #414: whether a customer replying URGENT/EMERGENCY/911/SOS wakes the
    /// whole crew at high priority, exempt from the daily notification limit.
    /// Defaults TRUE against a lagging server, matching it — the away copy
    /// that asks a homeowner to send it is on by default too.
    @Default<DefaultTrue> var emergency_keyword_enabled: Bool
    /// #388: chase a new lead nobody has answered. The defaults MATCH the
    /// server's and are asymmetric on purpose — rung one re-alerts only people
    /// already told once, so it ships on; rung two reaches people who were not
    /// told, so an owner opts in. A lagging client that guessed the second one
    /// true would render a klaxon as already-enabled.
    /// #392: the seat allowance, served rather than recomputed. Nil only when
    /// talking to a Worker older than #392, in which case the plan-derived
    /// fallback in SettingsLogic applies.
    let seat_limit: Int?
    @Default<DefaultTrue> var lead_chase_enabled: Bool
    @Default<DefaultFalse> var lead_chase_crew_enabled: Bool
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
