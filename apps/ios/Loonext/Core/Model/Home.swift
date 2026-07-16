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

/// GET /v1/for-you — the four-section focus queue.
struct ForYou: Codable, Sendable {
    @Default<DefaultEmptyList<ForYouWaiting>> var waiting_on_you: [ForYouWaiting]
    @Default<DefaultEmptyList<ForYouTask>> var my_tasks: [ForYouTask]
    @Default<DefaultEmptyList<ForYouUnread>> var unread: [ForYouUnread]
    let triage: ForYouTriage?
}

// MARK: - Notifications (D24 derived feed)

enum NotificationType {
    static let inboundMessage = "inbound_message"
    static let assigned = "assigned"
    static let taskAssigned = "task_assigned"
    static let missedCall = "missed_call"
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

struct UnreadCount: Codable, Sendable {
    let count: Int
}

struct MarkReadResult: Codable, Sendable {
    let last_seen_at: String
}

/// GET /v1/notification-prefs (+ vapid_public_key for web; unused natively).
struct NotificationPrefs: Codable, Sendable {
    let email_enabled: Bool
    let push_enabled: Bool
}
