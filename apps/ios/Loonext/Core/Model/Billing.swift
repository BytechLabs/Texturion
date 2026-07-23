import Foundation

/// POST /v1/billing/checkout and /portal — open in an EXTERNAL browser.
struct HostedUrl: Codable, Sendable {
    let url: String
}

struct UsageMonth: Codable, Sendable {
    let month: String
    let segments: Int
}

struct UsageStorage: Codable, Sendable {
    @Default<DefaultZero> var attachments_bytes: Int
    @Default<DefaultZero> var mms_bytes: Int
    @Default<DefaultZero> var attachment_budget_bytes: Int
    @Default<DefaultZero> var mms_budget_bytes: Int

    init(
        attachments_bytes: Int = 0,
        mms_bytes: Int = 0,
        attachment_budget_bytes: Int = 0,
        mms_budget_bytes: Int = 0
    ) {
        self.attachments_bytes = attachments_bytes
        self.mms_bytes = mms_bytes
        self.attachment_budget_bytes = attachment_budget_bytes
        self.mms_budget_bytes = mms_budget_bytes
    }
}

struct UsageVoice: Codable, Sendable {
    @Default<DefaultZero> var used_minutes: Int
    @Default<DefaultZero> var included_minutes: Int
    let cap_minutes: Int?
    @Default<DefaultZero> var overage_minutes: Int
    @Default<DefaultZero> var projected_overage_cents: Int
    @Default<DefaultTrue> var overage_billed: Bool

    init(
        used_minutes: Int = 0,
        included_minutes: Int = 0,
        cap_minutes: Int? = nil,
        overage_minutes: Int = 0,
        projected_overage_cents: Int = 0,
        overage_billed: Bool = true
    ) {
        self.used_minutes = used_minutes
        self.included_minutes = included_minutes
        self.cap_minutes = cap_minutes
        self.overage_minutes = overage_minutes
        self.projected_overage_cents = projected_overage_cents
        self.overage_billed = overage_billed
    }
}

struct UsageOverageProjection: Codable, Sendable {
    @Default<DefaultFalse> var trending_over: Bool
    @Default<DefaultZero> var projected_overage_cents: Int

    init(trending_over: Bool = false, projected_overage_cents: Int = 0) {
        self.trending_over = trending_over
        self.projected_overage_cents = projected_overage_cents
    }
}

enum DefaultEmptyStorage: DefaultCodableProvider {
    static var defaultValue: UsageStorage { UsageStorage() }
}

enum DefaultEmptyVoice: DefaultCodableProvider {
    static var defaultValue: UsageVoice { UsageVoice() }
}

enum DefaultEmptyProjection: DefaultCodableProvider {
    static var defaultValue: UsageOverageProjection { UsageOverageProjection() }
}

/// #178: the fair-use presentation contract. GET /v1/usage derives `status`
/// server-side so every client renders the same philosophy: 'quiet' shows no
/// meters anywhere, 'pacing' shows the early warning, 'capped' shows the
/// owner-set spending cap approaching or reached. Server string-enum, so a
/// lagging build never crashes; unknown values render the calm 'quiet' state.
enum UsageStatus {
    static let quiet = "quiet"
    static let pacing = "pacing"
    static let capped = "capped"
}

/// #178 decode default: keeps pre-#178 cached payloads (and unknown values)
/// decoding as the calm state.
enum DefaultUsageStatusQuiet: DefaultCodableProvider {
    static var defaultValue: String { UsageStatus.quiet }
}

/// GET /v1/usage — nils when the company has never checked out.
struct Usage: Codable, Sendable {
    /// #178 presentation status; the default keeps pre-#178 payloads decoding
    /// as the calm state (unknown values also render quiet).
    @Default<DefaultUsageStatusQuiet> var status: String
    let period_start: String?
    let period_end: String?
    @Default<DefaultZero> var included_segments: Int
    @Default<DefaultZero> var used_segments: Int
    @Default<DefaultZero> var inbound_segments: Int
    @Default<DefaultZero> var overage_segments: Int
    let cap_segments: Int?
    @Default<DefaultZero> var projected_overage_cents: Int
    @Default<DefaultEmptyProjection> var overage_projection: UsageOverageProjection
    @Default<DefaultEmptyList<UsageMonth>> var history: [UsageMonth]
    @Default<DefaultEmptyStorage> var storage: UsageStorage
    @Default<DefaultEmptyVoice> var voice: UsageVoice

    init(
        status: String = UsageStatus.quiet,
        period_start: String? = nil,
        period_end: String? = nil,
        included_segments: Int = 0,
        used_segments: Int = 0,
        inbound_segments: Int = 0,
        overage_segments: Int = 0,
        cap_segments: Int? = nil,
        projected_overage_cents: Int = 0,
        overage_projection: UsageOverageProjection = UsageOverageProjection(),
        history: [UsageMonth] = [],
        storage: UsageStorage = UsageStorage(),
        voice: UsageVoice = UsageVoice()
    ) {
        self.status = status
        self.period_start = period_start
        self.period_end = period_end
        self.included_segments = included_segments
        self.used_segments = used_segments
        self.inbound_segments = inbound_segments
        self.overage_segments = overage_segments
        self.cap_segments = cap_segments
        self.projected_overage_cents = projected_overage_cents
        self.overage_projection = overage_projection
        self.history = history
        self.storage = storage
        self.voice = voice
    }
}

/// GET /v1/billing/modules — admin-only add-on catalog with enabled state.
struct BillingModules: Codable, Sendable {
    @Default<DefaultEmptyList<BillingModule>> var modules: [BillingModule]
}

struct BillingModule: Codable, Sendable {
    let id: String
    let label: String
    let blurb: String
    let detail: String?
    let monthly_cents: Int
    @Default<DefaultFalse> var enabled: Bool
    /// #41: deliverable AND priced in this environment; refuse to sell otherwise.
    @Default<DefaultFalse> var available: Bool
}

/// POST /v1/billing/change-plan result.
struct ChangePlanResult: Codable, Sendable {
    let plan: String
    let effective: String
    let effective_at: String?
}
