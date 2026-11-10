import Foundation

/// A task is metadata over a real message; `done`/`status` are DERIVED from
/// the source message's done_at. Toggling done is
/// `PATCH /v1/messages/{message_id}`. D64: a task promoted from an answered
/// call has no message (`message_id` nil) and owns its done state, written with
/// `PATCH /v1/tasks/{id}`; `source` says which.
///
/// Named `TaskItem` (not `Task`) so the wire model never collides with Swift
/// Concurrency's `Task`.
struct TaskItem: Codable, Sendable {
    let id: String
    let company_id: String
    let message_id: String?
    /// Nil only for a standalone task that was not linked to a conversation (#689).
    let conversation_id: String?
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
    /// #214/Map: the task's OWN geocoded coordinates (from its addr_* address,
    /// cached by the geocode-tasks cron; projected by TASK_COLUMNS). Nil until
    /// geocoded or when the task has no address. The Map prefers these over the
    /// contact's saved location so a job pins at its SITE, not where the customer
    /// lives — the founder-reported wrong-pin fix (web parity, map-types.ts).
    var lat: Double? = nil
    var lng: Double? = nil
    /// D64: which kind of thing the task promotes. Nil on an older server.
    var source: TaskSource? = nil
    /// D64: the promoted call (list and checklist rows); nil for a message task.
    var call: TaskSourceCall? = nil

    /// #693: how much it matters, the workspace labels it wears, the series it
    /// belongs to and the rule that makes the next one. All optional with
    /// defaults so a row from before #693 decodes and the memberwise init stays
    /// source-compatible with every call site and preview. `repeat` is a Swift
    /// keyword, hence the backticks; the wire name is still "repeat".
    var priority: String? = nil
    var labels: [TaskLabel]? = nil
    var series_id: String? = nil
    var occurrence_no: Int? = nil
    var `repeat`: TaskRepeatRule? = nil

    /// #689 C: everyone on the task, first assignee first, and the same people
    /// with their names. Optional with defaults so a row from an older server
    /// decodes and the memberwise init stays source-compatible; read through
    /// `assigneeIds` / `assigneeFaces`, which fall back to `assigned_user_id`.
    var assignee_ids: [String]? = nil
    var assignees: [TaskProfile]? = nil

    /// #690: the workspace-wide task number, shown as "T-142". Nil on a row from a
    /// server that predates numbers. Declared last so no call site reorders.
    var number: Int? = nil

    var priorityValue: TaskPriority { TaskPriority.from(priority) }
    var labelList: [TaskLabel] { labels ?? [] }
    var repeatRule: TaskRepeatRule? { `repeat` }

    /// A task with no message owns its done state (D64).
    var isCallTask: Bool { message_id == nil }
}

/// D64: `source` on every task row: a message or an answered call.
struct TaskSource: Codable, Sendable {
    let kind: String
    let id: String
}

/// D64: the call a task was promoted from. The recording path stays server-side.
struct TaskSourceCall: Codable, Sendable {
    let id: String
    let call_session_id: String
    let caller_e164: String?
    let caller_name: String?
    let outcome: String?
    @Default<DefaultZero> var forward_seconds: Int
    let started_at: String
    let ended_at: String?
    let contact_id: String?
    @Default<DefaultFalse> var has_voicemail: Bool
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

/// A file on a task comment (#689).
struct TaskFeedFile: Codable, Sendable {
    let id: String
    let file_name: String?
    let content_type: String?
    let size_bytes: Int?
    let created_at: String
}

/// One entry of GET /v1/tasks/:id/activity (#689): kind 'event' (a change to
/// the task), 'comment' (written on the task) or 'note' (the thread note a
/// message task came from). Flat: the other kinds' fields stay nil.
struct TaskFeedItem: Codable, Sendable {
    let kind: String
    let id: String
    let created_at: String
    // kind = event: a task_events.kind and the stored before/after values.
    let event: String?
    let from: JSONValue?
    let to: JSONValue?
    let from_user: TaskProfile?
    let to_user: TaskProfile?
    let actor: TaskProfile?
    // kind = comment or note
    let body: String?
    let author: TaskProfile?
    let edited_at: String?
    let attachments: [TaskFeedFile]?
    // #690 kind = reference: a note, task description or comment that points
    // at this task (direction "in"), or that this task points out from
    // ("out"). All nil for the other kinds; declared last so no call site reorders.
    var direction: String? = nil
    var source_kind: String? = nil
    var target_kind: String? = nil
    var conversation_id: String? = nil
    var contact: ReferenceContactStub? = nil
    var task: ReferenceTaskStub? = nil
}

/// One item of the D28 derived attachments union (no URL — mint per item).
/// #294 — POST /v1/tasks/:id/photos/share.
///
/// `url` is the ONLY time the plaintext token exists outside the customer's hands
/// (D75); it is never returned again, by any route, to anybody.
struct JobPhotoLink: Codable, Sendable {
    let url: String
    let expires_at: String
}

struct TaskAttachmentItem: Codable, Sendable, JobPhotoLike {
    let id: String
    let source: String
    let kind: String
    let file_name: String?
    let content_type: String?
    let size_bytes: Int?
    let created_at: String
    /// #294 — the three fields that make a job record out of a file list.
    ///
    /// All inherited from the NOTE a file arrived on, never set per file: D28 keeps a
    /// task's attachments a derived view, and a per-file label would be the third
    /// upload path it removed. All nil for the customer's own texted media, which did
    /// not arrive in visits and is nobody's before.
    ///
    /// Optional so a client running against an older server still decodes.
    var note_id: String?
    var work_phase: String?
    var added_by_user_id: String?

    var noteId: String? { note_id }
    var workPhase: String? { work_phase }
    var addedByUserId: String? { added_by_user_id }
    var createdAt: String { created_at }
}

enum DefaultViewerLevelText: DefaultCodableProvider {
    static var defaultValue: String { "text" }
}

/// GET /v1/tasks/:id. viewer_level 'none' withholds conversation content.
/// The answer to following or unfollowing a task (#689 D).
struct TaskSubscription: Decodable, Sendable {
    let subscribed: Bool
}

struct TaskDetail: Codable, Sendable {
    let id: String
    let company_id: String
    let message_id: String?
    /// Nil only for a standalone task that was not linked to a conversation (#689).
    let conversation_id: String?
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
    /// #237: whether this job texts its customer before it happens, and whether
    /// they said they would be there.
    ///
    /// `confirmed_by` matters as much as `confirmed_at`: 'crew' is a note to
    /// ourselves and 'customer' is a promise, and a screen showing them the
    /// same way would let a dispatcher trust the weaker of the two. Optional
    /// with defaults so the memberwise init stays source-compatible with every
    /// existing construction site and #Preview.
    var reminders_off: Bool? = nil
    var confirmed_at: String? = nil
    var confirmed_by: String? = nil
    /// D64: which kind of thing the task promotes, and the promoted call (nil
    /// for a message task or when the conversation is withheld, #107).
    var source: TaskSource? = nil
    var source_call: TaskSourceCall? = nil
    /// #689: the contact a standalone task was linked to.
    var contact: TaskContactLocation? = nil
    /// #689 D: whether the caller follows this task. Optional with a default so
    /// the memberwise init stays source-compatible; nil reads as not following.
    var subscribed: Bool? = nil

    /// #693: how much it matters, the workspace labels it wears, the series it
    /// belongs to and the rule that makes the next one. All optional with
    /// defaults so a row from before #693 decodes and the memberwise init stays
    /// source-compatible with every call site and preview. `repeat` is a Swift
    /// keyword, hence the backticks; the wire name is still "repeat".
    var priority: String? = nil
    var labels: [TaskLabel]? = nil
    var series_id: String? = nil
    var occurrence_no: Int? = nil
    var `repeat`: TaskRepeatRule? = nil

    /// #689 C: everyone on the task, first assignee first, and the same people
    /// with their names (see `TaskItem`). `assignee` stays the first one.
    var assignee_ids: [String]? = nil
    var assignees: [TaskProfile]? = nil

    /// #690: see `TaskItem.number`.
    var number: Int? = nil

    var priorityValue: TaskPriority { TaskPriority.from(priority) }
    var labelList: [TaskLabel] { labels ?? [] }
    var repeatRule: TaskRepeatRule? { `repeat` }

    /// A task with no message owns its done state (D64).
    var isCallTask: Bool { message_id == nil }

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
