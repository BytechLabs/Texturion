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
    /// #414: when this thread last carried an emergency reply (URGENT/
    /// EMERGENCY/911/SOS). The inbox badges it while the thread is open.
    /// `var … = nil` rather than `let`: a `let` optional becomes a REQUIRED
    /// memberwise-init parameter and breaks every existing construction site.
    var emergency_at: String? = nil
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
    /// How many attachments ride the last message. Optional so a response from
    /// a server that predates migration 20260724080000 still decodes.
    var attachment_count: Int?
    /// The kind they all share, "file" for a mixed set, nil when there are
    /// none. The inbox labels from THIS instead of guessing a noun.
    var attachment_kind: String?
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
    /// #414: set when a customer replied URGENT; badged while the thread is
    /// open. `var … = nil` rather than `let` so it does not become a required
    /// memberwise-init parameter at every existing construction site.
    var emergency_at: String? = nil
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
    ///
    /// `var` so a merge can keep a status a stale page would otherwise walk
    /// backwards (see mergeMessage). The error fields travel with it, since
    /// they describe the state being kept.
    var status: String?
    let segments: Int?
    let encoding: String?
    let sent_by_user_id: String?
    var error_code: String?
    var error_detail: String?
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

    /// The task this message links to — the tap target for the thread's task
    /// indicator (#217): a source message's promoted task, or a task-linked
    /// note's task. Nil when the message carries no task.
    var linkedTaskId: String? {
        promoted_task?.id ?? task?.id ?? task_id
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
    /// #396: when an inbound message here last READ as a plain-English
    /// opt-out. A warning for whoever replies next, never an opt-out — only
    /// the contact can opt out, and only they can lift it. `var … = nil` so it
    /// does not become a required memberwise-init parameter everywhere.
    var opt_out_hint_at: String? = nil
    let created_at: String
    let updated_at: String
    let contact: ConversationDetailContact
    @Default<DefaultEmptyList<Tag>> var tags: [Tag]
    let messages: Page<Message>
    /// #106: 'note' = read + internal notes only (composer hides SMS mode).
    @Default<DefaultViewerText> var viewer_level: String
    /// #225 / D49: what time it is where the customer is. Resolved server-side
    /// by the same module the send gate uses, so the composer's hint and the
    /// gate's decision cannot disagree. `var … = nil` so it does not become a
    /// required memberwise-init parameter in every fixture.
    var destination_clock: DestinationClock? = nil
}

/// #225 / D49 — the destination's clock, and which rung of the ladder answered.
///
/// `source` matters as much as the hour: an area code is a GUESS that can be
/// wrong (a mobile keeps its code when its owner moves), so a screen shows the
/// provenance rather than presenting an inference as a fact.
struct DestinationClock: Codable, Sendable {
    let timezone: String
    /// 'contact' | 'area_code' | 'company'.
    let source: String?
    let local_hour: Int?
    /// Inside their quiet window, including state rules (Texas Sundays).
    let quiet: Bool?

    var rung: String { source ?? "company" }
    var hour: Int { local_hour ?? 0 }
    var isQuiet: Bool { quiet ?? false }
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
