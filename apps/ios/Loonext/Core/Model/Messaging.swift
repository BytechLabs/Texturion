import Foundation

enum ConversationStatus {
    static let new = "new"
    static let open = "open"
    static let waiting = "waiting"
    static let closed = "closed"
}

enum MessageDirection {
    static let inbound = "inbound"
    static let outbound = "outbound"
    static let note = "note"
}

enum MessageStatus {
    static let received = "received"
    static let queued = "queued"
    static let sent = "sent"
    static let delivered = "delivered"
    static let failed = "failed"
}

/// Carrier code for "recipient opted out at the carrier" — retry never offered.
let carrierOptOutErrorCode = "40300"

struct ContactSummary: Codable, Sendable {
    let id: String
    let name: String?
    let phone_e164: String
}

struct Tag: Codable, Sendable {
    let id: String
    let name: String
    let color: String?
    let created_at: String?
    let updated_at: String?
}

struct Conversation: Codable, Sendable {
    let id: String
    let company_id: String
    let contact_id: String
    let phone_number_id: String
    let status: String
    let is_spam: Bool
    let assigned_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let last_message_at: String
    let closed_at: String?
    let created_at: String
    let updated_at: String
}

/// Newest-message snippet embedded on every GET /v1/conversations row.
struct ConversationSnippet: Codable, Sendable {
    let id: String
    let direction: String
    let body: String
    let created_at: String
    let has_attachments: Bool
}

/// GET /v1/conversations row (api_list_conversations RPC).
struct ConversationListItem: Codable, Sendable {
    let id: String
    let company_id: String
    let contact_id: String
    let phone_number_id: String
    let status: String
    let is_spam: Bool
    let assigned_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let last_message_at: String
    let closed_at: String?
    let created_at: String
    let updated_at: String
    let contact: ContactSummary
    @Default<DefaultEmptyList<Tag>> var tags: [Tag]
    @Default<DefaultFalse> var unread: Bool
    let last_message: ConversationSnippet?
}

struct AttachmentSummary: Codable, Sendable {
    let id: String
    let content_type: String
    let size_bytes: Int?
}

/// The linked-task chip a promoted message / task-linked note carries.
struct MessageTaskLink: Codable, Sendable {
    let id: String
    let title: String
}

struct Message: Codable, Sendable {
    let id: String
    let conversation_id: String
    let direction: String
    let body: String
    /// nil iff direction='note'.
    let status: String?
    let segments: Int?
    let encoding: String?
    let sent_by_user_id: String?
    let error_code: String?
    let error_detail: String?
    let telnyx_message_id: String?
    let done_at: String?
    let done_by_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let created_at: String
    @Default<DefaultEmptyList<AttachmentSummary>> var attachments: [AttachmentSummary]
    @Default<DefaultFalse> var has_task: Bool
    let promoted_task: MessageTaskLink?
    let task_id: String?
    let task: MessageTaskLink?

    /// The one retry affordance rule: API-level failure only (no carrier id),
    /// and never a carrier opt-out block.
    var retryable: Bool {
        direction == MessageDirection.outbound &&
            status == MessageStatus.failed &&
            telnyx_message_id == nil &&
            error_code != carrierOptOutErrorCode
    }
}

/// Contact embed on GET /v1/conversations/:id.
struct ConversationDetailContact: Codable, Sendable {
    let id: String
    let name: String?
    let phone_e164: String
    let address: String?
    let notes: String?
    let consent_source: String?
    let consent_at: String?
    let deleted_at: String?
}

enum DefaultViewerText: DefaultCodableProvider {
    static var defaultValue: String { "text" }
}

/// GET /v1/conversations/:id — embeds the first page of messages.
struct ConversationDetail: Codable, Sendable {
    let id: String
    let company_id: String
    let contact_id: String
    let phone_number_id: String
    let status: String
    let is_spam: Bool
    let assigned_user_id: String?
    let pinned_at: String?
    let pinned_by_user_id: String?
    let last_message_at: String
    let closed_at: String?
    let created_at: String
    let updated_at: String
    let contact: ConversationDetailContact
    @Default<DefaultEmptyList<Tag>> var tags: [Tag]
    let messages: Page<Message>
    /// #106: 'note' = read + internal notes only (composer hides SMS mode).
    @Default<DefaultViewerText> var viewer_level: String
}

struct ConversationEvent: Codable, Sendable {
    let id: String
    let conversation_id: String
    /// nil = system.
    let actor_user_id: String?
    let type: String
    let payload: JSONValue
    let created_at: String
}

struct ReadReceipt: Codable, Sendable {
    let conversation_id: String
    let user_id: String
    let last_read_at: String
}

/// POST /v1/conversations (compose) response.
struct ComposeResult: Codable, Sendable {
    let conversation: Conversation
    let message: Message
}

struct Template: Codable, Sendable {
    let id: String
    let name: String
    let body: String
    let created_by: String?
    let created_at: String
    let updated_at: String
}

/// GET /v1/attachments/:id/url — short-lived signed URL; never cache.
struct AttachmentUrl: Codable, Sendable {
    let url: String
    let expires_at: String
}

/// A generic (note/task) attachment row (D19; upload door is notes-only).
struct Attachment: Codable, Sendable {
    let id: String
    let owner_type: String
    let owner_id: String
    let conversation_id: String?
    let file_name: String?
    let content_type: String?
    let size_bytes: Int?
    let created_at: String
}

/// One item from GET /v1/conversations/:id/attachments (gallery).
struct GalleryItem: Codable, Sendable {
    let id: String
    let source: String
    let kind: String
    let file_name: String?
    let content_type: String?
    let size_bytes: Int?
    let created_at: String
    let url: String
}

/// Outbound media item for compose/send (base64 inline, jpeg/png/gif ≤1MB).
struct OutboundMedia: Codable, Sendable {
    let content_type: String
    let base64: String
}
