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
    /// Media a customer sent us.
    @Default<DefaultZero> var received_media_bytes: Int
    /// Media we sent out.
    @Default<DefaultZero> var sent_media_bytes: Int
    /// Voicemail recordings we keep in our own bucket.
    @Default<DefaultZero> var voicemail_bytes: Int
    /// Anything stored that the named kinds do not account for.
    @Default<DefaultZero> var other_bytes: Int
    /// Every byte this workspace holds, measured from the buckets themselves.
    @Default<DefaultZero> var total_bytes: Int

    /// What is really stored. The old line added two figures together and so
    /// left voicemail recordings out entirely; the server measures the buckets
    /// now, and the sum is only a fallback for a response that predates it.
    var totalStored: Int {
        total_bytes > 0 ? total_bytes : attachments_bytes + mms_bytes
    }

    // The storage budgets went away with #121 (storage is free and capless), so
    // the fields went with them rather than lingering as zeros nothing reads.
    init(
        attachments_bytes: Int = 0,
        mms_bytes: Int = 0,
        received_media_bytes: Int = 0,
        sent_media_bytes: Int = 0,
        voicemail_bytes: Int = 0,
        other_bytes: Int = 0,
        total_bytes: Int = 0
    ) {
        self.attachments_bytes = attachments_bytes
        self.mms_bytes = mms_bytes
        self.received_media_bytes = received_media_bytes
        self.sent_media_bytes = sent_media_bytes
        self.voicemail_bytes = voicemail_bytes
        self.other_bytes = other_bytes
        self.total_bytes = total_bytes
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
    /// What Lou has done this month, per feature. Empty against a server that
    /// predates it, so the section simply does not render.
    @Default<DefaultEmptyList<AiFeatureUsage>> var ai: [AiFeatureUsage]
    /// #426: carrier-reported delivery for the period. Nil against a server
    /// that predates it, or when the read failed — the page still renders.
    var delivery: UsageDelivery? = nil

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
        voice: UsageVoice = UsageVoice(),
        ai: [AiFeatureUsage] = []
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
        self.ai = ai
    }
}

/// One AI feature's month: what has been used against its limit.
struct AiFeatureUsage: Codable, Sendable, Identifiable {
    /// The ledger key, so a row is identified without matching on copy.
    let key: String
    let label: String
    @Default<DefaultZero> var used: Int
    @Default<DefaultZero> var cap: Int
    @Default<DefaultTrue> var enabled: Bool
    /// #431 ask 3 — what people did with the output, beside what it cost.
    ///
    /// Labelled by the server in each feature's own words ("sent as written",
    /// "cleared") so all three clients say the same thing. EMPTY until outcomes
    /// arrive, and an empty list must render as "not measured yet" rather than as
    /// zeroes: a feature used forty times with nothing recorded is an
    /// instrumentation gap, and "0 sent as written" would report that gap as a
    /// verdict on the quality.
    @Default<DefaultEmptyList<AiOutcomeLine>> var outcomes: [AiOutcomeLine]
    /// How many outcomes those lines cover. Separate from `used` because they
    /// will not match — a draft offered and never read is a request with no
    /// outcome — and no rate is computed anywhere, deliberately.
    @Default<DefaultZero> var outcomesRecorded: Int

    var id: String { key }
}

/// #431: what a person did with one feature's output, ready to render.
struct AiOutcomeLine: Codable, Sendable, Identifiable {
    let label: String
    @Default<DefaultZero> var count: Int

    var id: String { label }
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
///
/// `reinstated` / `held` arrive with #523: an upgrade raises the allowance, and
/// the API claims against the new one in the same call — so a switch to Pro can
/// bring numbers back, and the client is told which rather than having to
/// refetch and diff.
struct ChangePlanResult: Codable, Sendable {
    let plan: String
    let effective: String
    let effective_at: String?
    @Default<DefaultEmptyList<HeldNumber>> var reinstated: [HeldNumber]
    @Default<DefaultEmptyList<HeldNumber>> var held: [HeldNumber]
}

// MARK: - Numbers the plan does not cover (#523)

/// One number this workspace holds that its plan does not currently cover.
///
/// It is NOT released and it is not gone: the row is intact, texts and calls
/// still land on it, and its history is untouched. What it cannot do is send or
/// answer. The whole point of the surface this feeds is that the state is
/// visible and has a way out, because before #523 a resubscribe onto a smaller
/// plan un-suspended everything and we paid the carrier rent forever.
struct HeldNumber: Codable, Sendable, Identifiable {
    let id: String
    let number_e164: String?
    /// When the hold started. Decoded because it is part of the contract, and
    /// deliberately not rendered — see `HeldNumbersCard`.
    var suspended_at: String? = nil

    init(id: String, number_e164: String?, suspended_at: String? = nil) {
        self.id = id
        self.number_e164 = number_e164
        self.suspended_at = suspended_at
    }
}

/// Why a workspace's numbers are suspended — the server's word for it, not the
/// client's inference.
///
/// The two states look identical in `phone_numbers.status` and mean opposite
/// things: one is "your plan is smaller than your workspace", the other is "your
/// subscription is over and the 30-day hold is running". `GET
/// /v1/billing/held-numbers` decides between them so three clients do not each
/// derive it from two fields and describe the same state three ways.
enum HeldNumbersReason {
    static let overPlanAllowance = "over_plan_allowance"
    static let subscriptionInactive = "subscription_inactive"
}

/// GET /v1/billing/held-numbers (#523) — what this workspace holds beyond what
/// its plan covers, and both ways back.
///
/// EVERY FIGURE THIS SCREEN PRINTS IS IN HERE. The allowance, the plan's hard
/// cap, the price of buying one back and the currency that price is denominated
/// in are all served rather than derived, because a client that renders "$5" out
/// of its own head at a workspace billed in CAD is #522 happening again.
struct HeldNumbers: Codable, Sendable {
    /// "starter" | "pro", or nil when the workspace has never checked out.
    let plan: String?
    /// Numbers the plan itself covers. Nil when `plan` is.
    let included: Int?
    /// Extra numbers actually billed on the subscription right now.
    @Default<DefaultZero> var paid_extras: Int
    /// `included + paid_extras` — what may be active at once.
    let allowance: Int?
    /// The plan's hard TOTAL cap (#80), or nil when it has none (Pro).
    let max_total: Int?
    /// `HeldNumbersReason`, or nil when nothing is held.
    let reason: String?
    @Default<DefaultEmptyList<HeldNumber>> var held: [HeldNumber]
    /// What buying capacity for ONE held number costs, from the price book.
    let extra_number_cents: Int?
    /// The currency `extra_number_cents` is denominated in. OPTIONAL and with
    /// no default: an absent currency means the figure cannot be labelled
    /// honestly, and an unlabelled price is the defect #522 was.
    let extra_number_currency: String?
    /// Whether POST …/reinstate would be accepted right now. Served so the
    /// button can be ABSENT rather than fail — being told "no" after pressing
    /// it is how somebody concludes the product is broken.
    @Default<DefaultFalse> var can_reinstate: Bool
    /// Starter only: the other way back, and it buys no extra number.
    @Default<DefaultFalse> var can_upgrade: Bool

    init(
        plan: String? = nil,
        included: Int? = nil,
        paid_extras: Int = 0,
        allowance: Int? = nil,
        max_total: Int? = nil,
        reason: String? = nil,
        held: [HeldNumber] = [],
        extra_number_cents: Int? = nil,
        extra_number_currency: String? = nil,
        can_reinstate: Bool = false,
        can_upgrade: Bool = false
    ) {
        self.plan = plan
        self.included = included
        self.paid_extras = paid_extras
        self.allowance = allowance
        self.max_total = max_total
        self.reason = reason
        self.held = held
        self.extra_number_cents = extra_number_cents
        self.extra_number_currency = extra_number_currency
        self.can_reinstate = can_reinstate
        self.can_upgrade = can_upgrade
    }
}

/// POST /v1/billing/held-numbers/:id/reinstate (#523).
///
/// THREE OUTCOMES, and they are not the same sentence:
///
///   `reinstated`                  paid, and the number is back.
///   `already_active`              nothing was bought — it was already back.
///                                 A double-press, or an upgrade beat us to it.
///   neither                       the charge landed and the un-hold did not
///                                 (the #110 raise fence refused a capacity
///                                 raise formed against a stale epoch). The
///                                 caller must not invite an immediate retry:
///                                 the money has moved.
struct ReinstatedNumber: Codable, Sendable {
    @Default<DefaultFalse> var reinstated: Bool
    @Default<DefaultFalse> var already_active: Bool
    let paid_extras: Int?
    let allowance: Int?
    @Default<DefaultEmptyList<HeldNumber>> var held: [HeldNumber]

    init(
        reinstated: Bool = false,
        already_active: Bool = false,
        paid_extras: Int? = nil,
        allowance: Int? = nil,
        held: [HeldNumber] = []
    ) {
        self.reinstated = reinstated
        self.already_active = already_active
        self.paid_extras = paid_extras
        self.allowance = allowance
        self.held = held
    }
}

/// #426 — carrier-reported delivery, split by where the message was going.
///
/// The NAME is load-bearing: a receipt means a carrier acknowledged handoff,
/// not that a person read it, so every surface says "carrier-reported".
struct UsageDeliveryCountry: Codable, Sendable {
    /// "US" | "CA" | "other", from the destination's area code.
    @Default<DefaultOtherCountry> var country: String
    @Default<DefaultZero> var delivered: Int
    @Default<DefaultZero> var failed: Int
    /// Accepted by us, not yet acknowledged by a carrier. Not a failure.
    @Default<DefaultZero> var pending: Int
    /// delivered / (delivered + failed), or NIL when too few have settled to
    /// mean anything. Render counts and never a percentage when nil: one
    /// failure out of forty reads as 2.5% and usually means a disconnected
    /// number, which is manufactured worry rather than information.
    let rate: Double?
}

struct UsageDelivery: Codable, Sendable {
    @Default<DefaultEmptyList<UsageDeliveryCountry>> var by_country: [UsageDeliveryCountry]
    @Default<DefaultZero> var delivered: Int
    @Default<DefaultZero> var failed: Int
    @Default<DefaultZero> var pending: Int
}

enum DefaultOtherCountry: DefaultCodableProvider {
    static var defaultValue: String { "other" }
}
