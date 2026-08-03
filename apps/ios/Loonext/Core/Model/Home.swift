import Foundation

// MARK: - For You (D23)

enum DefaultUrgencyNew: DefaultCodableProvider {
    /// 0 overdue-task · 1 waiting · 2 unread · 3 new (lower = more urgent).
    static var defaultValue: Int { 3 }
}

struct ForYouWaiting: Codable, Sendable {
    let conversation_id: String
    let status: String
    let contact: ContactSummary?
    let assigned_user_id: String?
    let last_message_at: String
    @Default<DefaultFalse> var unread: Bool
    @Default<DefaultFalse> var has_overdue_task: Bool
    @Default<DefaultUrgencyNew> var urgency: Int
}

struct ForYouTask: Codable, Sendable {
    let task_id: String
    let title: String
    let conversation_id: String
    let message_id: String
    let assigned_user_id: String?
    let due_at: String?
    @Default<DefaultFalse> var overdue: Bool
}

struct ForYouUnread: Codable, Sendable {
    let conversation_id: String
    let status: String
    let contact: ContactSummary?
    let assigned_user_id: String?
    let last_message_at: String
}

struct ForYouTriageConversation: Codable, Sendable {
    let conversation_id: String
    let status: String
    let contact: ContactSummary?
    let last_message_at: String
    @Default<DefaultFalse> var unread: Bool
}

struct ForYouTriageTask: Codable, Sendable {
    let task_id: String
    let title: String
    let conversation_id: String
    let message_id: String
    let due_at: String?
    @Default<DefaultFalse> var overdue: Bool
}

/// #293 — one follow-up reminder that has come DUE.
///
/// Its own section rather than folded into "waiting on you": that one means
/// "you have not answered them". This means "they have not answered YOU, and
/// you asked to be told" — a different job, and the highest-value one in the
/// business to be reminded about.
struct ForYouFollowUp: Codable, Sendable {
    let conversation_id: String
    let status: String
    let contact: ContactSummary?
    let last_message_at: String
    @Default<DefaultFalse> var unread: Bool
    /// When you asked to be reminded. Always past by the time it is here.
    let due_at: String
    /// The reason you gave, if you gave one.
    let note: String?
}

/// Owner/admin-only strip; the whole field is nil for a member.
struct ForYouTriage: Codable, Sendable {
    @Default<DefaultEmptyList<ForYouTriageConversation>> var conversations: [ForYouTriageConversation]
    @Default<DefaultEmptyList<ForYouTriageTask>> var tasks: [ForYouTriageTask]
}

/// #342 — one spam-marked thread whose activity does not look like spam.
///
/// A spam-marked thread appends silently, never notifies, and is frozen at the
/// moment it was marked, so it sinks in every list including the spam filter.
/// Right for a robotexter, catastrophic for a mis-tap: the customer keeps
/// texting and the business believes they stopped.
struct SpamReviewItem: Codable, Sendable {
    let conversation_id: String
    let contact: ContactSummary?
    let marked_at: String
    let marked_by_user_id: String?
    /// Inbound since the mark, or since it was last confirmed.
    @Default<DefaultZero> var inbound_since: Int
    /// The REAL latest inbound time — not the frozen list sort key.
    let last_inbound_at: String
    /// We texted this number before marking it. The strongest signal by far.
    @Default<DefaultFalse> var we_texted_them: Bool
    /// Messages spread across days rather than one burst.
    @Default<DefaultFalse> var sustained: Bool
    @Default<DefaultFalse> var high_volume: Bool
}

struct SpamReviewPage: Codable, Sendable {
    @Default<DefaultEmptyList<SpamReviewItem>> var data: [SpamReviewItem]
}

/// #342: why this thread was raised, in the order the signals are trusted. A
/// count alone reads as a counter; naming the signal reads as the mistake it
/// probably is.
func spamReviewReason(_ item: SpamReviewItem) -> String {
    if item.we_texted_them { return "You texted them before this was marked" }
    if item.sustained { return "Still texting, over several days" }
    return "\(item.inbound_since) messages since it was marked"
}

/// #306 — what each section ACTUALLY holds, independent of the 20 rows returned.
///
/// Counting the rows was counting the PAGE: a member with 60 conversations
/// waiting on them was told "20 things need you" and the queue looked finished.
/// `distinct_work` is the only one to render as that headline — the per-section
/// totals overlap, and a client cannot dedupe them because it only ever holds
/// 20 of the N ids.
struct ForYouTotals: Codable, Sendable {
    @Default<DefaultZero> var waiting_on_you: Int
    @Default<DefaultZero> var my_tasks: Int
    @Default<DefaultZero> var unread: Int
    @Default<DefaultZero> var triage_conversations: Int
    @Default<DefaultZero> var triage_tasks: Int
    /// #293: follow-up reminders that have come due.
    @Default<DefaultZero> var follow_ups: Int
    @Default<DefaultZero> var distinct_work: Int
}

/// GET /v1/for-you — the four-section focus queue.
/// GET /v1/reports/response-time (#239) — how fast this workspace answers a NEW
/// customer, and how that changed since they started.
///
/// Every number here is computed server-side; the client does no arithmetic on
/// them. A median computed twice is a median that can disagree with itself, and
/// the whole value of this metric is that the crew trusts it. The definition
/// lives in docs/RESPONSE-TIME.md.
///
/// Every property is `var` with a default so a hand-written fixture and an older
/// server response both decode — a `let` optional gets NO implicit memberwise
/// default in Swift, which has broken every fixture in this target before.
struct ResponseTimeSide: Codable, Sendable {
    var leads: Int = 0
    var answered: Int = 0
    var median_seconds: Double? = nil
}

struct ResponseTimeMember: Codable, Sendable, Identifiable {
    var user_id: String = ""
    var answered: Int = 0
    var median_seconds: Double? = nil

    var id: String { user_id }
}

/// #482: one line's response time.
///
/// ALREADY labelled and already filtered by the server — an empty list means
/// the leads arrived on one number, where this row would repeat the headline.
/// There is no condition here to get wrong, which is the point: the same rule
/// written in three clients is three chances to disagree about it.
struct ResponseTimeNumber: Codable, Sendable, Identifiable {
    var phone_number_id: String = ""
    /// The number a person would recognise, e.g. "+14165551234".
    var number_e164: String = ""
    var leads: Int = 0
    var answered: Int = 0
    var median_seconds: Double? = nil

    var id: String { phone_number_id }
}

struct ResponseTimeBaseline: Codable, Sendable {
    var leads: Int = 0
    var answered: Int = 0
    var median_seconds: Double? = nil
}

struct ResponseTimeWindowInfo: Codable, Sendable {
    var days: Int = 30
}

/// #244 — a shift with an owner.
///
/// `phone_number_id` nil means the whole workspace, which is what a one-number
/// crew always means.
struct OnCallShift: Codable, Sendable, Identifiable {
    var id: String = ""
    var user_id: String = ""
    var phone_number_id: String? = nil
    var starts_at: String = ""
    var ends_at: String = ""
    var created_by: String? = nil
}

struct OnCallShiftsResponse: Codable, Sendable {
    var data: [OnCallShift] = []
}

struct OnCallShiftBody: Codable, Sendable {
    var user_id: String
    var starts_at: String
    var ends_at: String
    var phone_number_id: String? = nil
}

struct OnCallShiftCreated: Codable, Sendable {
    var data: OnCallShift = OnCallShift()
}

/// GET /v1/reports/satisfaction (#313) — how customers rate the finished work.
///
/// Every refusal in here is the SERVER's: `average` arrives nil when the sample
/// is too thin to mean anything, and `by_member` arrives nil when the owner has
/// not turned per-person scores on. This client never fills either gap — three
/// clients cannot disagree about a rule they were never given (#482).
struct SatisfactionMember: Codable, Sendable, Identifiable {
    var user_id: String = ""
    /// nil when the profile row is missing — our gap, not "Unknown".
    var name: String? = nil
    var answered: Int = 0
    /// nil when this member alone is under the floor.
    var average: Double? = nil

    var id: String { user_id }
}

struct SatisfactionBaseline: Codable, Sendable {
    var since: String = ""
    var until: String = ""
    var answered: Int = 0
    var average: Double = 0
}

struct SatisfactionReport: Codable, Sendable {
    var window: ResponseTimeWindowInfo = ResponseTimeWindowInfo()
    var asked: Int = 0
    var answered: Int = 0
    var average: Double? = nil
    var sample_too_small: Bool = false
    var minimum_sample: Int = 0
    var distribution: [String: Int] = [:]
    /// Jobs that needed a call back. Each already woke somebody that day.
    var poor: Int = 0
    var by_member: [SatisfactionMember]? = nil
    var per_member_enabled: Bool = false
    var baseline: SatisfactionBaseline? = nil
    var improved_by: Double? = nil
    var truncated: Bool = false
    var row_limit: Int = 0
}

struct ResponseTimeReport: Codable, Sendable {
    var window: ResponseTimeWindowInfo = ResponseTimeWindowInfo()
    var leads: Int = 0
    var answered: Int = 0
    /// The leak, named. Never shown apart from the median it would otherwise flatter.
    var unanswered: Int = 0
    var median_seconds: Double? = nil
    var p90_seconds: Double? = nil
    var business_hours: ResponseTimeSide = ResponseTimeSide()
    var after_hours: ResponseTimeSide = ResponseTimeSide()
    /// nil means the owner has not opted in — NOT that the crew answered nothing.
    var by_member: [ResponseTimeMember]? = nil
    /// #482: slowest line first. Empty for a one-number workspace.
    var by_number: [ResponseTimeNumber]? = nil
    var per_member_enabled: Bool = false
    var baseline: ResponseTimeBaseline? = nil
    /// "too_new" | "no_answered_leads" | nil — why there is no arc.
    var baseline_unavailable: String? = nil
    var improved_by_seconds: Double? = nil
    var split_truncated: Bool = false
    var split_row_limit: Int = 0
}

struct ForYou: Codable, Sendable {
    /// #293. Empty from an older Worker, which is "no reminders" — the state
    /// every client written before this shipped was already rendering.
    ///
    /// `= []`, and that is not decoration. A wrapped property with NO default
    /// becomes a REQUIRED parameter of the synthesized memberwise initializer,
    /// so adding this one broke every preview that builds a `ForYou` — the same
    /// trap the `totals` comment below records, arriving from the other side.
    /// The default makes the parameter optional, so the NEXT field added here
    /// costs nobody a compile error.
    @Default<DefaultEmptyList<ForYouFollowUp>> var follow_ups: [ForYouFollowUp] = []
    @Default<DefaultEmptyList<ForYouWaiting>> var waiting_on_you: [ForYouWaiting]
    @Default<DefaultEmptyList<ForYouTask>> var my_tasks: [ForYouTask]
    @Default<DefaultEmptyList<ForYouUnread>> var unread: [ForYouUnread]
    let triage: ForYouTriage?
    /// #306. Nil from an older Worker; see `ForYouTotals`.
    ///
    /// Declared `var … = nil`, NOT `let`: a `let` optional has no implicit
    /// default, so it becomes a REQUIRED parameter of the synthesized
    /// memberwise initializer and every preview that builds a `ForYou` stops
    /// compiling. That exact trap broke the iOS build earlier today.
    var totals: ForYouTotals? = nil
}

/// #306: the headline number — honest when the server sends totals, and the
/// old row-derived count when it does not.
///
/// The fallback deduplicates the way the shipped web helper does: "waiting on
/// you" and "unread" overlap by design, since the second is a cross-cut of the
/// first rather than a separate pile of work.
func forYouHeadlineWork(_ forYou: ForYou) -> Int {
    if let totals = forYou.totals { return totals.distinct_work }
    var conversations = Set<String>()
    for row in forYou.waiting_on_you { conversations.insert(row.conversation_id) }
    for row in forYou.unread { conversations.insert(row.conversation_id) }
    // #293: a due reminder is work. Leaving it out made the header say "all
    // caught up" while a section below listed a quote to chase — the count
    // lying in exactly the direction #293 is about. The Set keeps it honest
    // when the same thread is also unread.
    for row in forYou.follow_ups { conversations.insert(row.conversation_id) }
    for row in forYou.triage?.conversations ?? [] {
        conversations.insert(row.conversation_id)
    }
    var tasks = Set<String>()
    for row in forYou.my_tasks { tasks.insert(row.task_id) }
    for row in forYou.triage?.tasks ?? [] { tasks.insert(row.task_id) }
    return conversations.count + tasks.count
}

// MARK: - Notifications (D24 derived feed)

enum NotificationType {
    static let inboundMessage = "inbound_message"
    static let assigned = "assigned"
    static let taskAssigned = "task_assigned"
    static let missedCall = "missed_call"
    static let mention = "mention"
}

struct NotificationItem: Codable, Sendable {
    let id: String
    let type: String
    let conversation_id: String?
    let message_id: String?
    let task_id: String?
    let contact: ContactSummary?
    let created_at: String
    @Default<DefaultFalse> var unread: Bool
}

/// #343 - whether the workspace's daily notification allowance is spent.
///
/// At the ceiling notifications stop reaching EVERY member while only the owner
/// is emailed, so a tech's phone just goes quiet and the reasonable inference is
/// that the business had a slow afternoon. `resets_at` is the company's next
/// LOCAL midnight.
struct AlertPause: Codable, Sendable {
    @Default<DefaultFalse> var email_paused: Bool
    @Default<DefaultFalse> var push_paused: Bool
    var resets_at: String?

    var anyPaused: Bool { email_paused || push_paused }
}

struct UnreadCount: Codable, Sendable {
    let count: Int
    /// #343. Nil from an older Worker - treat as nothing paused.
    ///
    /// Declared `var ... = nil`: a `let` optional becomes a REQUIRED parameter
    /// of the synthesized memberwise init and breaks every construction site.
    var alert_pause: AlertPause? = nil
}

struct MarkReadResult: Codable, Sendable {
    let last_seen_at: String
}

/// GET /v1/notification-prefs (+ vapid_public_key for web; unused natively).
struct NotificationPrefs: Codable, Sendable {
    // `var`, so a caller changing one switch can copy-and-mutate rather than
    // rebuilding the struct from two fields — which would silently drop the
    // quiet-hours window below every time somebody touched Email or Push.
    var email_enabled: Bool
    var push_enabled: Bool
    /// #244: this member's own do-not-disturb window, "22:00"/"07:00". Both or
    /// neither — half a window is not a window. `var … = nil` so it does not
    /// become a required memberwise-init parameter at every existing
    /// construction site.
    var quiet_from: String? = nil
    var quiet_to: String? = nil
    /// Their own zone; nil falls back to the workspace's.
    var quiet_timezone: String? = nil
}
