import Foundation

struct SearchConversationHit: Codable, Sendable {
    let id: String
    let status: String
    @Default<DefaultFalse> var is_spam: Bool
    let last_message_at: String
    let contact: ContactSummary
    let matched_message_id: String
    let matched_at: String
    let direction: String
    let snippet: String
}

struct SearchTaskHit: Codable, Sendable {
    let id: String
    let title: String
    let conversation_id: String
    @Default<DefaultFalse> var done: Bool
    let matched_at: String
}

struct SearchAttachmentHit: Codable, Sendable {
    let id: String
    let file_name: String
    let owner_type: String
    let conversation_id: String?
    let content_type: String?
    let created_at: String
}

struct SearchTemplateHit: Codable, Sendable {
    let id: String
    let name: String
    let snippet: String
}

/// GET /v1/search — conversations paginate; other arms first-page-only.
struct SearchResult: Codable, Sendable {
    @Default<DefaultEmptyList<SearchConversationHit>> var conversations: [SearchConversationHit]
    @Default<DefaultEmptyList<ContactSummary>> var contacts: [ContactSummary]
    @Default<DefaultEmptyList<SearchTaskHit>> var tasks: [SearchTaskHit]
    @Default<DefaultEmptyList<SearchAttachmentHit>> var attachments: [SearchAttachmentHit]
    @Default<DefaultEmptyList<SearchTemplateHit>> var templates: [SearchTemplateHit]
    let next_cursor: String?
}
