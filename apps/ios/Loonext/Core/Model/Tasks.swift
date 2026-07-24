import Foundation

/// A task is metadata over a real message; `done`/`status` are DERIVED from
/// the source message's done_at. Toggling done is
/// `PATCH /v1/messages/{message_id}`, never a task route.
///
/// Named `TaskItem` (not `Task`) so the wire model never collides with Swift
/// Concurrency's `Task`.
struct TaskItem: Codable, Sendable {
    let id: String
    let company_id: String
    let message_id: String
    let conversation_id: String
    let title: String
    @Default<DefaultEmptyString> var description: String
    let assigned_user_id: String?
    let due_at: String?
    let created_by_user_id: String
    let created_at: String
    let updated_at: String
    let done: Bool
    let status: String
    let contact: TaskContactLocation?
    /// Present on checklist rows (GET /v1/conversations/:id/tasks).
    let attachment_count: Int?
    /// #214 structured job address + provenance. All nil for a task without an
    /// address and for every pre-#214 row (absent keys decode to nil). Optional
    /// with a default so the memberwise init stays source-compatible with the
    /// existing call sites.
    var addr_street: String? = nil
    var addr_unit: String? = nil
    var addr_city: String? = nil
    var addr_state: String? = nil
    var addr_postal_code: String? = nil
    var addr_country: String? = nil
    var addr_provenance: String? = nil
}

struct TaskContactLocation: Codable, Sendable {
    let id: String
    let name: String?
    let lat: Double?
    let lng: Double?
}

struct TaskProfile: Codable, Sendable {
    let user_id: String
    let display_name: String?
}

struct TaskSourceMessage: Codable, Sendable {
    let id: String
    let body: String
    let done_at: String?
    let done_by_user_id: String?
    let created_at: String
    let direction: String
}

/// Merged activity+discussion item: kind 'event' (task_* audit) or 'note'
/// (task-linked internal note). Modeled flat — the absent kind's fields nil.
struct TaskActivityItem: Codable, Sendable {
    let kind: String
    let id: String
    let created_at: String
    // kind = event
    let type: String?
    let payload: JSONValue?
    let actor_user_id: String?
    let actor: TaskProfile?
    // kind = note
    let body: String?
    let author_user_id: String?
    let author: TaskProfile?
}

/// One item of the D28 derived attachments union (no URL — mint per item).
struct TaskAttachmentItem: Codable, Sendable {
    let id: String
    let source: String
    let kind: String
    let file_name: String?
    let content_type: String?
    let size_bytes: Int?
    let created_at: String
}

enum DefaultViewerLevelText: DefaultCodableProvider {
    static var defaultValue: String { "text" }
}

/// GET /v1/tasks/:id. viewer_level 'none' withholds conversation content.
struct TaskDetail: Codable, Sendable {
    let id: String
    let company_id: String
    let message_id: String
    let conversation_id: String
    let title: String
    @Default<DefaultEmptyString> var description: String
    let assigned_user_id: String?
    let due_at: String?
    let created_by_user_id: String
    let created_at: String
    let updated_at: String
    let done: Bool
    let status: String
    let assignee: TaskProfile?
    let created_by: TaskProfile?
    let source_message: TaskSourceMessage?
    @Default<DefaultEmptyList<TaskAttachmentItem>> var attachments: [TaskAttachmentItem]
    @Default<DefaultEmptyList<TaskActivityItem>> var activity: [TaskActivityItem]
    @Default<DefaultViewerLevelText> var viewer_level: String
    /// #214 structured job address + provenance (all nil for a task without an
    /// address, and for every pre-#214 row). Optional with a default so the
    /// memberwise init stays source-compatible with the existing call sites.
    var addr_street: String? = nil
    var addr_unit: String? = nil
    var addr_city: String? = nil
    var addr_state: String? = nil
    var addr_postal_code: String? = nil
    var addr_country: String? = nil
    var addr_provenance: String? = nil

    /// The 6 address columns as editable field values (nil columns → "").
    var addressFields: AddressFieldValues {
        AddressFieldValues(
            street: addr_street ?? "",
            unit: addr_unit ?? "",
            city: addr_city ?? "",
            state: addr_state ?? "",
            postalCode: addr_postal_code ?? "",
            country: addr_country ?? ""
        )
    }
}
