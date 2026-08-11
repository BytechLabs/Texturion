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
    /// #286: how many rows this member cannot see. Sent only by /v1/numbers
    /// today; optional so every other list decodes unchanged.
    ///
    /// `var` with a DEFAULT, not `let`. A stored property with no default is
    /// a required argument of the memberwise init, and eight call sites in
    /// LoonextTests construct a Page directly — which CI found and a grep of
    /// `apps/ios/Loonext/` did not, because the tests live in the sibling
    /// `apps/ios/LoonextTests/`.
    var hidden_count: Int? = nil
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
    /// #315: the view-only observer — an owner's partner, an accountant, a
    /// consultant who should SEE the work and never text a customer as the
    /// business. Deliberately absent from the rank map below: it is a
    /// capability SET, not a rung, so `atLeast` refuses it everywhere. That is
    /// the same fail-closed answer the server gives.
    static let readOnly = "read_only"

    /// #315: the bookkeeper or the spouse doing the books. Billing, and NOT
    /// the inbox — the only role that never sees a customer conversation,
    /// which is why the shell gives it a screen of its own rather than four
    /// tabs that each answer 403. Also off the rank map, for the same reason
    /// `readOnly` is.
    static let bookkeeper = "bookkeeper"

    /// The role → capability table, hand-ported from
    /// packages/shared/src/capabilities.ts. Only the axes this app actually
    /// asks about are listed; adding one here means adding it there first.
    ///
    /// A SET per role, not a rank, because two of these five roles are not on
    /// the owner ⊃ admin ⊃ member line at all.
    private static let capabilities: [String: Set<String>] = [
        readOnly: [Capability.workspaceAccess, Capability.conversationsRead],
        bookkeeper: [Capability.workspaceAccess, Capability.billingManage],
        member: [
            Capability.workspaceAccess,
            Capability.conversationsRead,
            Capability.conversationsSend,
        ],
        admin: [
            Capability.workspaceAccess,
            Capability.conversationsRead,
            Capability.conversationsSend,
            Capability.billingManage,
            Capability.settingsManage,
            Capability.teamManage,
            Capability.numbersManage,
            Capability.historyRead,
        ],
        owner: Capability.all,
    ]

    /// Does `role` hold `capability`? An unknown role holds nothing — the same
    /// fail-closed answer `atLeast` and the server both give, so a build that
    /// has not heard of a newer preset refuses rather than guesses.
    static func has(_ role: String?, _ capability: String) -> Bool {
        guard let role else { return false }
        return capabilities[role]?.contains(capability) ?? false
    }

    /// #315: can this role open the inbox at all? Every one of this app's four
    /// tabs is a conversation surface, so this decides whether the tab shell is
    /// even the right thing to render.
    static func canReadConversations(_ role: String?) -> Bool {
        has(role, Capability.conversationsRead)
    }

    /// Hierarchical check: does `role` meet `required`?
    static func atLeast(_ role: String?, required: String) -> Bool {
        let rank = [owner: 3, admin: 2, member: 1]
        let held = role.flatMap { rank[$0] } ?? 0
        let needed = rank[required] ?? Int.max
        return held >= needed
    }
}

/// #315: the authorization axes, hand-ported from packages/shared. A role is a
/// set of these, so a permission question is always "which axis does this
/// need?" rather than "how senior must they be?" — the second question has no
/// answer for a role that is not on the line.
enum Capability {
    static let workspaceAccess = "workspace.access"
    static let conversationsRead = "conversations.read"
    static let conversationsSend = "conversations.send"
    static let billingManage = "billing.manage"
    static let settingsManage = "settings.manage"
    static let teamManage = "team.manage"
    static let numbersManage = "numbers.manage"
    static let historyRead = "history.read"

    /// Everything — the owner's set, and the list a test can iterate.
    static let all: Set<String> = [
        workspaceAccess,
        conversationsRead,
        conversationsSend,
        billingManage,
        settingsManage,
        teamManage,
        numbersManage,
        historyRead,
    ]
}

/// #228: the languages an automated text can go out in.
///
/// Hand-ported from packages/shared/src/locale.ts, which two of the four
/// clients import and this one cannot. The values and the labels have to be
/// edited in step with it.
///
/// "Francais (Canada)" carries no cedilla, and that is deliberate rather than
/// sloppy: the shared table is written inside the GSM-7 alphabet, because
/// everything beside it in that file is a message body billed by the segment
/// and one character outside GSM-7 halves how much fits in one.
enum MessageLocale {
    static let en = "en"
    static let frCA = "fr-CA"

    /// The order a picker offers them in.
    static let all = [en, frCA]

    /// How each language names itself. Never translated.
    ///
    /// Takes a NON-optional on purpose. A nil contact locale means "follow the
    /// workspace", so an overload that accepted one would answer "English" for
    /// a customer whose texts are about to go out in French.
    static func label(_ locale: String) -> String {
        locale == frCA ? "Francais (Canada)" : "English"
    }

    /// The language THIS customer's automated texts go out in.
    ///
    /// The contact's own setting wins; otherwise the workspace's. Hand-ported
    /// from `resolveLocale`, including the fallback on both sides: a row
    /// carrying a language some later migration added must resolve to something
    /// rather than leave a screen blank.
    static func resolve(contact: String?, company: String?) -> String {
        if let contact, all.contains(contact) { return contact }
        if let company, all.contains(company) { return company }
        return en
    }
}

struct Membership: Codable, Sendable {
    let company_id: String
    let name: String
    let role: String
    let subscription_status: String
    /// #540: the dashboard panels THIS member has put away in THIS workspace.
    ///
    /// On the membership rather than on `Me` because it belongs to the pair — the
    /// bookkeeper and the foreman are the same two people in one workspace, and
    /// somebody in two workspaces reasonably wants a different screen in each.
    ///
    /// Optional with a default so a build running against an older Worker still
    /// decodes, and so the three places that construct a Membership for a preview
    /// keep compiling. `nil` and `[]` mean the same thing: the whole screen.
    var dashboard_hidden: [String]? = nil
    /// #228: the language the BUSINESS works in — the LAST step of
    /// `UiLocale.resolve`, after the member's own setting and their phone's.
    ///
    /// Optional and defaulted, at the end, so every existing construction site
    /// (three previews and the tests) keeps compiling untouched.
    var locale: String? = nil
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
    ///
    /// OPTIONAL, not a defaulted dictionary. In Swift a default value on a
    /// NON-optional property does not make the key optional to the synthesized
    /// `init(from:)` — decoding still demands it, and a server that omits the
    /// field (or any older response) fails to decode entirely. Kotlin's
    /// kotlinx.serialization treats a default the opposite way, which is
    /// exactly how this got hand-ported wrong once already.
    var flags: [String: Bool]? = nil
    /// #228: the language THIS PERSON reads the app in — the first step of
    /// `UiLocale.resolve`.
    ///
    /// `nil` is a REAL value and not an absence: it means "ask the device, then
    /// the workspace". The route sends null rather than resolving, because the
    /// device half of that answer only exists here.
    ///
    /// Optional so a build running against an older Worker still decodes — a
    /// synthesized `init(from:)` reads an Optional with `decodeIfPresent`, which
    /// a defaulted non-Optional does not get (see `flags` above).
    var locale: String? = nil
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

/// GET /v1/me/firsts — #405/#476. Has THIS member replied, written a note, and
/// marked something done, in THIS workspace.
///
/// Its own route rather than a field on /v1/me: that one is the hottest in the
/// product, and this answers a question that only matters for a few days of one
/// person's life. `@Default` rather than a bare `let` because a Swift default
/// on a non-optional property does NOT make the key optional to the synthesized
/// `init(from:)` — decoding still demands it, and the card must never turn a
/// half-understood payload into a thrown error.
struct MemberFirsts: Codable, Sendable {
    @Default<DefaultFalse> var replied: Bool
    @Default<DefaultFalse> var noted: Bool
    @Default<DefaultFalse> var marked_done: Bool
    /// #286: has this member been through the joining orientation — the one
    /// piece of their first-run state that cannot be derived from rows they
    /// wrote, because it is a thing we did to them rather than a thing they did.
    ///
    /// Defaults to TRUE, not false. Every other field here defaults to "not
    /// done yet", which is the harmless answer for a checklist row; the
    /// harmless answer for a FLOW is "already seen". A server one release
    /// behind that omits the key must not walk somebody through four screens
    /// they have been past for a month.
    @Default<DefaultTrue> var oriented: Bool
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
    /// #366: how many people an inbound call to this number could ring, and
    /// the ceiling on how many it actually will. Nil when the server could not
    /// resolve it, which reads as "nothing to say" rather than as zero.
    ///
    /// `var`, unlike its `let` neighbours, and deliberately: a `var` Optional
    /// gets an implicit nil default in the memberwise initialiser while a
    /// `let` one does not, so this stays additive instead of breaking the four
    /// existing construction sites that pass every field by name.
    var ring_targets: Int?
    var ring_target_limit: Int?
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

/// #402: a date, or a run of dates, that overrides the weekly schedule.
///
/// A RANGE rather than a list of single dates, so a week off is one entry the
/// owner can read back and delete rather than seven kept in step. `hours` nil
/// means closed all day.
struct HoursException: Codable, Sendable, Equatable {
    let from: String
    let to: String
    var hours: DayHours?
    var note: String?
}

enum DefaultScreeningOff: DefaultCodableProvider {
    static var defaultValue: String { "off" }
}

/// #228: a business always works in SOME language, so there is no unset state
/// to represent. A payload from a Worker that predates the column reads as
/// English, which is what those workspaces were already being sent.
enum DefaultLocaleEnglish: DefaultCodableProvider {
    static var defaultValue: String { MessageLocale.en }
}

/// #278: what an inbound call does outside business hours. `ring_everyone` is
/// the product exactly as it behaved before this existed, so a lagging payload
/// without the field keeps that rather than inventing a routing decision.
enum DefaultRingEveryone: DefaultCodableProvider {
    static var defaultValue: String { "ring_everyone" }
}

/// #278: every phone at once is how the product rang before this existed, so a
/// lagging payload without the field keeps that.
enum DefaultRingAll: DefaultCodableProvider {
    static var defaultValue: String { "all" }
}

/// #278: 45 seconds is both the pre-#278 window and the ceiling.
enum DefaultRingSeconds: DefaultCodableProvider {
    static var defaultValue: Int { 45 }
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
    /// #328 — what this workspace's card is actually charged in ("usd"/"cad").
    ///
    /// Modelled because COUNTRY is not a safe stand-in for it: a Canadian
    /// workspace can end up billed in US dollars, and a screen deriving the
    /// currency from `country` alone would print a CAD plan price to somebody
    /// whose card is charged in USD. Nil on any workspace predating #328 — the
    /// country is the fallback THEN, and only then.
    ///
    /// In BILLING_ONLY_COMPANY_FIELDS, so the key is ABSENT rather than null
    /// for a caller without `billing.manage`. An Optional decodes a missing key
    /// rather than throwing, which is what makes that redaction safe here.
    let billing_currency: String?
    /// #277 follow-up — when the grace-window win-back was waved away.
    ///
    /// A TIMESTAMP compared against `canceled_at`, never a boolean: a dismissal
    /// belongs to ONE cancellation. Somebody who waves this away, resubscribes,
    /// and cancels again next winter gets the offer back, because that second
    /// cancellation stamps a newer `canceled_at` than the dismissal. Nothing
    /// has to clear it, and nothing has to remember to.
    ///
    /// Billing-only as well, and absent for everybody else — a tech has no
    /// business reading the owner's decisions about leaving off their own boot
    /// payload.
    let winback_dismissed_at: String?
    /// #481: what a departing owner's customers are told. Nil = off.
    let offramp_message: String?
    let offramp_opted_in_at: String?
    @Default<DefaultFalse> var cancel_at_period_end: Bool
    /// #163 store-rules kill-switch: false = hide in-app billing WRITES (plan
    /// change, module toggles) and route them to the external-browser Stripe
    /// surfaces. Defaults TRUE so a lagging server never strips affordances.
    @Default<DefaultTrue> var billing_writes_enabled: Bool
    /// weekday (mon..sun) -> window; missing/null weekday = closed all day.
    @Default<DefaultEmptyBusinessHours> var business_hours: [String: DayHours?]
    /// #402: dates that override the weekly loop. `@Default` rather than a
    /// bare `= []` — a default VALUE on a non-Optional does not make the
    /// Codable key optional, and a Worker predating #402 omits it entirely.
    @Default<DefaultEmptyList<HoursException>> var business_hours_exceptions: [HoursException]
    /// #228: the language the AUTOMATED texts below go out in: the away reply,
    /// the missed-call text-back, the emergency acknowledgment and the rating
    /// ask. Not the app's own interface, and not a message somebody typed.
    ///
    /// Never null on the wire. Every contact without a language of its own
    /// inherits this one, so changing it moves the whole customer list, and the
    /// server re-resolves the `*_effective_message` previews to match.
    @Default<DefaultLocaleEnglish> var locale: String
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
    /// #553: whether we TEXT BACK, separately from whether we notice at all.
    @Default<DefaultTrue> var emergency_reply_enabled: Bool
    /// #460: the workspace's own emergency words, or nil for the product list.
    /// Nil means "use the default", never "watch for nothing".
    var emergency_keywords: [String]?
    /// #460: the workspace's own emergency reply, or nil for the default.
    var emergency_message: String?
    /// #460: the words the inbound handler will really match on, resolved by
    /// the SERVER. The unrecognised-reply-word warning reads THIS — warning
    /// against a list nothing uses teaches an owner to ignore warnings.
    @Default<DefaultEmptyList<String>> var emergency_effective_keywords: [String]
    /// #460: what actually lands on the customer's phone — the effective body
    /// PLUS the safety sentence no setting removes. Composed by the server for
    /// the same reason `away_effective_message` is.
    @Default<DefaultEmptyString> var emergency_effective_message: String
    /// True when the owner's own emergency reply is in effect.
    @Default<DefaultFalse> var emergency_message_is_custom: Bool
    /// True when the owner set their own words rather than the defaults.
    @Default<DefaultFalse> var emergency_keywords_are_custom: Bool
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
    /// #430: whether a push may carry words a person typed. Workspace-wide.
    /// `@Default` rather than a bare `= true` — a default VALUE on a
    /// non-Optional does not make the Codable key optional, and a Worker that
    /// omits the field would fail to decode the whole response.
    @Default<DefaultTrue> var push_include_content: Bool
    @Default<DefaultFalse> var mctb_enabled: Bool
    let mctb_message: String?
    /// #192: server-resolved template that will actually send (custom else the
    /// shared product default) — the client renders server truth, never guesses.
    let mctb_effective_message: String?
    /// #192: true when the effective message is the owner's custom text.
    @Default<DefaultFalse> var mctb_message_is_custom: Bool
    /// #393: whether the first text to a customer is signed with the business
    /// name. Default false — D4's 2026-07 reversal stands until an owner opts in.
    @Default<DefaultFalse> var first_message_identification: Bool
    /// #393: the EXACT suffix such a text will carry (nil when signing is off,
    /// and also when the company name is blank). Render and METER this string —
    /// never build it here, or the part count can drift from what is billed.
    let first_message_identification_suffix: String?
    /// #225: whether STARTING a conversation inside the destination's 8pm-8am
    /// local window asks for a confirmation. That prompt only — automated sends
    /// are held to the window regardless. Defaults TRUE, so a payload decoded
    /// without the field keeps the prompt.
    @Default<DefaultTrue> var quiet_hours_confirm_enabled: Bool
    /// #298: whether members may INVENT tags, or only use the set that already
    /// exists. Attaching an existing tag is never restricted — a tech who
    /// cannot categorise a thread leaves it uncategorised rather than filing it
    /// somewhere else. Defaults FALSE: most shops want no taxonomy at all.
    @Default<DefaultFalse> var tags_locked: Bool
    let voicemail_greeting: String?
    /// #309: the workspace's default RECORDING; nil = the written words.
    let voicemail_greeting_id: String?
    /// #278: what an inbound call does outside business hours.
    @Default<DefaultRingEveryone> var after_hours_calls: String
    /// #278: the recording played after hours; nil falls back to the ordinary
    /// greeting, never to silence.
    let after_hours_greeting_id: String?
    /// #278: every phone at once, or joining the ring one at a time.
    @Default<DefaultRingAll> var ring_strategy: String
    /// #278: how long they ring. 45 is the ceiling — the legs end there.
    @Default<DefaultRingSeconds> var ring_seconds: Int
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

// MARK: - The paid pause (#277)

/// GET /v1/billing/pause — may this workspace pause, what would it cost, and is
/// it paused right now?
///
/// # Why it is not a field on `CompanyView`
///
/// `paused_at` is deliberately kept off the company view, and that is the API's
/// decision rather than this client's: `GET /v1/company` runs on every app boot
/// for every role, and whether the plan is paused is a billing fact. The whole
/// `/v1/billing` router sits behind `billing.manage`, so this is asked for only
/// on the billing screen and only by somebody who can act on the answer.
///
/// # Every field is optional here
///
/// The route always sends all five, so this is not modelling a real absence —
/// it is choosing the direction to fail in. A response this build cannot fully
/// read renders NOTHING rather than throwing, and nothing is the safe answer
/// for a control that starts a recurring charge.
struct BillingPause: Codable, Sendable {
    /// The ONLY thing that may put a Pause control on screen.
    ///
    /// Already `eligibility.eligible && offer !== null` server-side — a pause we
    /// cannot quote reports false — so no client re-derives it from `reason`,
    /// and none of them has to know what the reasons mean.
    let eligible: Bool?
    /// Why not, when `eligible` is false: `not_provisioned`, `no_subscription`,
    /// `already_paused`, `subscription_unhealthy`, `plan_change_pending`,
    /// `referral_month_pending`, `already_prepaid`, `prepaid_coupon_orphaned`.
    ///
    /// Nothing on this screen branches on it and nothing prints it. Most of them
    /// are not worth explaining to somebody who never asked to pause, and
    /// `not_provisioned` means the offer does not exist — so the block is absent
    /// rather than greyed out with a sentence about our Stripe configuration.
    /// Modelled so it is readable in a diagnostic rather than invisible.
    let reason: String?
    /// Non-nil means paused RIGHT NOW.
    let paused_at: String?
    /// The REAL monthly price, read from Stripe before anybody presses anything:
    /// the live catalog price while the offer is open, and once paused the
    /// mirror of what this workspace is actually being charged.
    let monthly_cents: Int?
    /// What they come back to. The pause never touches `plan`, so this is still
    /// a real answer months in.
    let resume_plan: String?

    var isEligible: Bool { eligible ?? false }
}

/// POST /v1/billing/pause — the pause as the server RE-READ it after the Stripe
/// swap.
///
/// Never an assumption: the route compares its own mirror against the swap it
/// just made and answers 409 when they disagree, rather than reporting a success
/// it cannot see. So a caller uses what comes back and never what it sent.
struct BillingPaused: Codable, Sendable {
    let paused_at: String?
    let monthly_cents: Int?
    let resume_plan: String?
}

/// POST /v1/billing/resume — likewise re-read, and likewise 409 when the mirror
/// disagrees. `plan` is where the plan came from: untouched the whole time.
struct BillingResumed: Codable, Sendable {
    let plan: String?
    let paused_at: String?
}

/// #307 — one field of a line's identity: what a caller gets, and whether it
/// came from the workspace rather than from this line.
///
/// Both properties are `var` with defaults, per the rule a red build taught
/// this repo: an optional `let` is a REQUIRED argument of the memberwise init,
/// and every construction site in both iOS targets has to change for it.
struct ResolvedField: Codable, Sendable {
    var value: String? = nil
    var inherited: Bool = true
}

/// GET/PATCH /v1/numbers/{id}/identity.
struct NumberIdentity: Codable, Sendable {
    var label = ResolvedField()
    var voicemail_greeting = ResolvedField()
    var away_message = ResolvedField()
    var mctb_enabled = ResolvedBool()
    var mctb_message = ResolvedField()
    var timezone = ResolvedField()
    var business_hours = ResolvedHours()
    /// #309: which RECORDING plays. Null is the written words, read aloud.
    var voicemail_greeting_id = ResolvedField()
    /// #278: what a call to this line does outside its hours. A ResolvedField
    /// rather than a ResolvedBool for the same reason it is a three-value
    /// column: "ring everyone" and "follow the workspace" are different
    /// answers, and only a nullable value can say the second.
    var after_hours_calls = ResolvedField()
    /// #278: the recording played after hours; nil is the ordinary greeting.
    var after_hours_greeting_id = ResolvedField()
    /// #278: how this line's phones ring.
    var ring_strategy = ResolvedField()
    /// #278: how long they ring. A ResolvedInt because the value is a number
    /// and a string-shaped resolver would parse it back at every read.
    var ring_seconds = ResolvedInt()
}

/// A resolved NUMBER, and whether it came from the workspace.
struct ResolvedInt: Codable, Sendable {
    var value: Int?
    var inherited: Bool = true
}

/// The week, resolved.
///
/// #307: `business_hours` is ONE column, so a line either keeps its own week
/// or follows the workspace's — inheritance is per week, never per day.
///
/// Both properties are `var` with defaults, per the rule a red build taught
/// this repo: an optional `let` is a REQUIRED argument of the memberwise init.
struct ResolvedHours: Codable, Sendable {
    var value: [String: DayHours?]? = nil
    var inherited = true
}

/// The same shape for the one field that is not text.
///
/// A separate type rather than a nullable value on `ResolvedField`: the toggle
/// always resolves to a real boolean, and giving it a `String?` would put a
/// "true"/"false" parse between the server and a switch for no reason.
///
/// Both properties are `var` with defaults, per the rule a red build taught
/// this repo: an optional `let` is a REQUIRED argument of the memberwise init.
struct ResolvedBool: Codable, Sendable {
    var value = false
    var inherited = true
}

/**
 #301 — where these customers came from.

 `coverage` and `note` are computed SERVER-side, like every other number on the
 home surface and for the same reason: three clients deciding independently how
 much of a thin ranking to believe is three chances to show an owner a
 confidence the others would not.
 */
struct LeadSourceCount: Codable, Sendable, Identifiable {
    let lead_source_id: String
    let name: String
    /// Attributed automatically, by which line rang.
    @Default<DefaultZero> var by_number: Int
    /// A person said so.
    @Default<DefaultZero> var by_person: Int
    @Default<DefaultZero> var total: Int

    var id: String { lead_source_id }
}

struct LeadSourceReport: Codable, Sendable {
    /// The window this covers. A plain Int with a default in the initialiser's
    /// place is not available on a Codable struct, so it reuses the zero
    /// provider and the card never reads it — the copy says "Last 30 days"
    /// from its own constant, which is the value the API is asked for.
    @Default<DefaultZero> var days: Int
    @Default<DefaultEmptyList<LeadSourceCount>> var sources: [LeadSourceCount]
    /// Conversations with no source at all. A row, never an omission.
    @Default<DefaultZero> var unknown: Int
    @Default<DefaultZero> var total: Int
    /// 0-1, or nil when the window held no conversations at all.
    let coverage: Double?
    /// The caveat to print above the table, or nil when there is none.
    let note: String?
}

/// #301: the workspace's own list of where customers come from.
struct LeadSource: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    /// Non-nil once retired: off the pickers, kept in the record.
    let archived_at: String?
}
