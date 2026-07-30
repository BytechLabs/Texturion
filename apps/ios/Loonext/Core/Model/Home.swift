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

struct ResponseTimeBaseline: Codable, Sendable {
    var leads: Int = 0
    var answered: Int = 0
    var median_seconds: Double? = nil
}

struct ResponseTimeWindowInfo: Codable, Sendable {
    var days: Int = 30
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
    var per_member_enabled: Bool = false
    var baseline: ResponseTimeBaseline? = nil
    /// "too_new" | "no_answered_leads" | nil — why there is no arc.
    var baseline_unavailable: String? = nil
    var improved_by_seconds: Double? = nil
    var split_truncated: Bool = false
    var split_row_limit: Int = 0
}

struct ForYou: Codable, Sendable {
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
    let email_enabled: Bool
    let push_enabled: Bool
}
