import Foundation

/// Tasks feature data access. Mutations honor the binding invariants:
/// completion is ALWAYS `PATCH /v1/messages/{message_id} {done}` (a task has
/// no done column), task PATCH is metadata-only, and attachment URLs are
/// minted per view (never cached).
///
/// The request bodies are built by the pure functions below so the exact wire
/// shapes (explicit JSON nulls for clears) are unit-testable without a mock
/// server — the vectors mirror the Android TaskMutationsTest.

// MARK: - Wire bodies (pure, tested)

/// `{"body": "…"}` — a comment on a task (#689).
func taskCommentBody(_ body: String) -> JSONValue {
    .object(["body": .string(body)])
}

/// `{"title": "…"}`
func taskRenameBody(_ title: String) -> JSONValue {
    .object(["title": .string(title)])
}

/// `{"description": "…"}`
func taskDescribeBody(_ description: String) -> JSONValue {
    .object(["description": .string(description)])
}

/// `{"assigned_user_id": "…"}"` — nil MUST send an explicit JSON null (unassign).
func taskAssignBody(_ userId: String?) -> JSONValue {
    .object(["assigned_user_id": userId.map(JSONValue.string) ?? .null])
}

/// `{"due_at": "…"}` — nil MUST send an explicit JSON null (clear).
func taskDueBody(_ dueAt: String?) -> JSONValue {
    .object(["due_at": dueAt.map(JSONValue.string) ?? .null])
}

/// D64: the done write for ANY task, branched on its source. A message task
/// writes its source message; a task promoted from a call has no message and
/// owns its done state, so it is written on the task. The API answers 422 if a
/// message task is patched on the task route.
func taskDoneRoute(messageId: String?, taskId: String) -> String {
    messageId.map { "/v1/messages/\($0)" } ?? "/v1/tasks/\(taskId)"
}

func writeTaskDone(
    api: ApiClient,
    companyId: String,
    taskId: String,
    messageId: String?,
    done: Bool
) async throws {
    let _: JSONValue = try await api.patch(
        taskDoneRoute(messageId: messageId, taskId: taskId),
        body: messageDoneBody(done),
        companyId: companyId
    )
}

/// `{"done": true|false}` — the ONE completion body: the message route for a
/// message task, the task route for a call task (D64).
func messageDoneBody(_ done: Bool) -> JSONValue {
    .object(["done": .bool(done)])
}

/// `{"body": "…", "task_id": "…"}` — a task-linked internal note (D-D).
func taskNoteBody(body: String, taskId: String) -> JSONValue {
    .object(["body": .string(body), "task_id": .string(taskId)])
}

/// POST /v1/tasks body — optional fields are OMITTED, not nulled. #214: an
/// optional structured `address` block (built by `taskAddressBody`) rides along
/// when the make-task sheet confirmed one; omitted when there is none.
func taskCreateBody(
    messageId: String?,
    title: String?,
    assignedUserId: String?,
    dueAt: String?,
    address: JSONValue? = nil,
    /// D64: an answered call to promote instead. At most one of the two.
    sourceCallId: String? = nil,
    /// #689: with neither source, a standalone task may link to these.
    contactId: String? = nil,
    conversationId: String? = nil,
    /// #693: omitted when the task is the default (normal) priority.
    priority: String? = nil,
    labelIds: [String] = [],
    /// The repeat rule from `TaskRepeatDraft.wireBody`.
    repeatRule: JSONValue? = nil
) -> JSONValue {
    var object: [String: JSONValue] = [:]
    if let messageId { object["message_id"] = .string(messageId) }
    if let sourceCallId { object["source_call_id"] = .string(sourceCallId) }
    if let title { object["title"] = .string(title) }
    if let assignedUserId { object["assigned_user_id"] = .string(assignedUserId) }
    if let dueAt { object["due_at"] = .string(dueAt) }
    if let address { object["address"] = address }
    if let contactId { object["contact_id"] = .string(contactId) }
    if let conversationId { object["conversation_id"] = .string(conversationId) }
    if let priority { object["priority"] = .string(priority) }
    if !labelIds.isEmpty { object["label_ids"] = .array(labelIds.map { .string($0) }) }
    if let repeatRule { object["repeat"] = repeatRule }
    return .object(object)
}

// MARK: - #693 priority, labels, repeat and scope bodies

/// Add `"scope"` to a PATCH body. Nil leaves the body alone, which the server
/// reads as "this one": only a task that repeats is ever asked, so only a task
/// that repeats sends it.
func taskScoped(_ body: JSONValue, scope: String?) -> JSONValue {
    guard let scope else { return body }
    guard case .object(let object) = body else { return body }
    var copy = object
    copy["scope"] = .string(scope)
    return .object(copy)
}

/// `{"priority": "high"}`
func taskPriorityBody(_ priority: TaskPriority) -> JSONValue {
    .object(["priority": .string(priority.rawValue)])
}

/// PATCH `{"repeat": {...}}`; nil MUST send an explicit JSON null (stop repeating).
func taskRepeatPatchBody(_ rule: JSONValue?) -> JSONValue {
    .object(["repeat": rule ?? .null])
}

/// POST /v1/tasks/:id/tags body: an existing tag by id, else a name that is
/// created on the way. Exactly one of the two is sent.
func taskTagAddBody(tagId: String?, name: String?, scope: String?) -> JSONValue {
    var object: [String: JSONValue] = [:]
    if let tagId {
        object["tag_id"] = .string(tagId)
    } else if let name {
        object["name"] = .string(name)
    }
    return taskScoped(.object(object), scope: scope)
}

/// POST /v1/tasks/bulk body. Pulled out of `TasksApi.bulk` so the exact shapes
/// (the filter keys, the null that means unassign) are testable.
func taskBulkBody(
    action: String,
    ids: [String]?,
    filters: TaskListFilters?,
    targetUserId: String?,
    unassign: Bool,
    priority: String? = nil,
    tagId: String? = nil
) -> JSONValue {
    var body: [String: JSONValue] = ["action": .string(action)]
    if let ids {
        body["ids"] = .array(ids.map { .string($0) })
    } else if let filters {
        var filter: [String: JSONValue] = [:]
        if let status = filters.status { filter["status"] = .string(status) }
        if let assignee = filters.assignedUserId {
            filter["assigned_user_id"] = .string(assignee)
        }
        if filters.unassigned { filter["unassigned"] = .bool(true) }
        if filters.overdue { filter["overdue"] = .bool(true) }
        if !filters.priority.isEmpty {
            filter["priority"] = .array(filters.priority.map { .string($0) })
        }
        if let filterTag = filters.tagId { filter["tag_id"] = .string(filterTag) }
        body["filter"] = .object(filter)
    }
    // Explicit null is meaningful (unassign), so it is only written when the
    // caller says so rather than whenever the id is absent.
    if let targetUserId {
        body["target_user_id"] = .string(targetUserId)
    } else if unassign {
        body["target_user_id"] = .null
    }
    if let priority { body["priority"] = .string(priority) }
    if let tagId { body["tag_id"] = .string(tagId) }
    return .object(body)
}

/// #214: the structured `address` block for POST /v1/tasks and PATCH
/// /v1/tasks/:id. Each field trims to a JSON string-or-null; `provenance` is
/// the enrichment's own value for a confirmed suggestion, or "manual" once the
/// user hand-edits. Returns nil when EVERY field is blank — the caller then
/// omits the key (create) or sends an explicit null (patch, to clear).
func taskAddressBody(_ fields: AddressFieldValues, provenance: String) -> JSONValue? {
    if fields.isEmpty { return nil }
    func value(_ raw: String) -> JSONValue {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? .null : .string(trimmed)
    }
    return .object([
        "street": value(fields.street),
        "unit": value(fields.unit),
        "city": value(fields.city),
        "state": value(fields.state),
        "postal_code": value(fields.postalCode),
        "country": value(fields.country),
        "provenance": .string(provenance),
    ])
}

/// #214 PATCH /v1/tasks/:id body — replaces the whole address block. An empty
/// address sends `{"address": null}` (clear); otherwise the structured block.
func taskAddressPatchBody(_ fields: AddressFieldValues, provenance: String) -> JSONValue {
    .object(["address": taskAddressBody(fields, provenance: provenance) ?? .null])
}

// MARK: - PATCH/POST response projection

/// The raw tasks-table row PATCH /v1/tasks/:id and POST /v1/tasks return
/// (`to_jsonb(v_task)` from the update_task/assign_task/create_task RPCs).
/// Unlike list/detail reads it carries NO derived done/status — decoding it
/// into `TaskItem` would fail, so mutations decode this projection and the
/// caller merges the metadata fields into its fetched detail.
struct TaskRowPatch: Codable, Sendable {
    let id: String
    let title: String
    @Default<DefaultEmptyString> var description: String
    let assigned_user_id: String?
    let due_at: String?
    let updated_at: String
    /// #214: the raw row (`to_jsonb(v_task)`) carries the address columns for
    /// every mutation, so `merged()` re-reads the current address after ANY
    /// patch (never drops it). Optional — absent on pre-#214 rows → nil.
    var addr_street: String? = nil
    var addr_unit: String? = nil
    var addr_city: String? = nil
    var addr_state: String? = nil
    var addr_postal_code: String? = nil
    var addr_country: String? = nil
    var addr_provenance: String? = nil
    /// #237: carried on every mutation row for the same reason the address is —
    /// `merged()` re-reads them, so a rename or a due edit never drops the
    /// reminder state the screen is showing.
    var reminders_off: Bool? = nil
    var confirmed_at: String? = nil
    var confirmed_by: String? = nil
    /// #693: carried on every mutation row, optional so an older server still
    /// decodes. `merged()` keeps the detail's own when a row leaves them out.
    var priority: String? = nil
    var labels: [TaskLabel]? = nil
    var series_id: String? = nil
    var occurrence_no: Int? = nil
    var `repeat`: TaskRepeatRule? = nil
}

/// POST /v1/tasks/:id/tags: the tag that was attached and the task's labels now.
struct TaskTagAdded: Decodable, Sendable {
    let tag: TaskLabel
    var labels: [TaskLabel]? = nil
}

// MARK: - Mutations

struct TaskMutations: Sendable {
    let api: ApiClient

    func detail(companyId: String, taskId: String) async throws -> TaskDetail {
        try await api.get("/v1/tasks/\(taskId)", companyId: companyId)
    }

    func members(companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", companyId: companyId)
    }

    /// #294 — a link to this job's photos, for the customer.
    ///
    /// The plaintext token comes back exactly ONCE (D75) and is never retrievable
    /// again, so whatever the caller does with the URL it does immediately.
    func shareJobPhotos(companyId: String, taskId: String) async throws -> JobPhotoLink {
        try await api.post("/v1/tasks/\(taskId)/photos/share", companyId: companyId)
    }

    /// #294 — the customer should not be able to open it any more.
    func revokeJobPhotos(companyId: String, taskId: String) async throws {
        try await api.delete("/v1/tasks/\(taskId)/photos/share", companyId: companyId)
    }

    /// Metadata-only edit. Null-bearing fields must SEND null (clear).
    private func patch(
        companyId: String,
        taskId: String,
        body: JSONValue
    ) async throws -> TaskRowPatch {
        try await api.patch("/v1/tasks/\(taskId)", body: body, companyId: companyId)
    }

    func rename(
        companyId: String,
        taskId: String,
        title: String,
        scope: String? = nil
    ) async throws -> TaskRowPatch {
        try await patch(
            companyId: companyId,
            taskId: taskId,
            body: taskScoped(taskRenameBody(title), scope: scope)
        )
    }

    func describe(
        companyId: String,
        taskId: String,
        description: String,
        scope: String? = nil
    ) async throws -> TaskRowPatch {
        try await patch(
            companyId: companyId,
            taskId: taskId,
            body: taskScoped(taskDescribeBody(description), scope: scope)
        )
    }

    func assign(
        companyId: String,
        taskId: String,
        userId: String?,
        scope: String? = nil
    ) async throws -> TaskRowPatch {
        try await patch(
            companyId: companyId,
            taskId: taskId,
            body: taskScoped(taskAssignBody(userId), scope: scope)
        )
    }

    /// #693: how much this matters. On a repeating task `scope` says whether the
    /// later ones follow.
    func setPriority(
        companyId: String,
        taskId: String,
        priority: TaskPriority,
        scope: String? = nil
    ) async throws -> TaskRowPatch {
        try await patch(
            companyId: companyId,
            taskId: taskId,
            body: taskScoped(taskPriorityBody(priority), scope: scope)
        )
    }

    /// #693: set or change the repeat rule; nil stops it. Always applies to this
    /// one and the future, so no scope.
    func setRepeat(
        companyId: String,
        taskId: String,
        rule: JSONValue?
    ) async throws -> TaskRowPatch {
        try await patch(companyId: companyId, taskId: taskId, body: taskRepeatPatchBody(rule))
    }

    /// #693: put a workspace tag on a task, by id or by a name that is created.
    func addTag(
        companyId: String,
        taskId: String,
        tagId: String?,
        name: String?,
        scope: String? = nil
    ) async throws -> TaskTagAdded {
        try await api.post(
            "/v1/tasks/\(taskId)/tags",
            body: taskTagAddBody(tagId: tagId, name: name, scope: scope),
            companyId: companyId
        )
    }

    func removeTag(
        companyId: String,
        taskId: String,
        tagId: String,
        scope: String? = nil
    ) async throws {
        _ = try await api.raw(
            "DELETE",
            "/v1/tasks/\(taskId)/tags/\(tagId)",
            query: ["scope": scope],
            companyId: companyId
        )
    }

    /// The workspace's tag list, the same one conversations and contacts use.
    func tags(companyId: String) async throws -> Page<Tag> {
        try await api.get("/v1/tags", companyId: companyId)
    }

    /// `dueAt` must be ISO 8601 WITH offset (`encodeDueAt`); nil clears.
    func setDue(
        companyId: String,
        taskId: String,
        dueAt: String?,
        scope: String? = nil
    ) async throws -> TaskRowPatch {
        try await patch(
            companyId: companyId,
            taskId: taskId,
            body: taskScoped(taskDueBody(dueAt), scope: scope)
        )
    }

    /// #237 — stop (or restart) this job's reminders.
    ///
    /// Its own route rather than a field on the metadata patch: the patch
    /// describes the JOB, and this decides whether we text somebody about it.
    /// The server clears the queued reminders BEFORE answering, so by the time
    /// this returns the thread strip is already right.
    func setReminders(
        companyId: String,
        taskId: String,
        off: Bool
    ) async throws -> TaskRowPatch {
        try await api.put(
            "/v1/tasks/\(taskId)/reminders",
            body: JSONValue.object(["off": .bool(off)]),
            companyId: companyId
        )
    }

    /// #214: replace the whole structured job address (empty fields clear it).
    /// `provenance` is "manual" once the user hand-edits, else the enrichment's
    /// own value.
    func updateAddress(
        companyId: String,
        taskId: String,
        fields: AddressFieldValues,
        provenance: String,
        scope: String? = nil
    ) async throws -> TaskRowPatch {
        try await patch(
            companyId: companyId,
            taskId: taskId,
            body: taskScoped(taskAddressPatchBody(fields, provenance: provenance), scope: scope)
        )
    }

    /// THE one completion path (D14/T2): flip done on the SOURCE MESSAGE.
    /// Idempotent server-side; derived task done updates ride message.status.
    func setDone(companyId: String, messageId: String, done: Bool) async throws -> Message {
        try await api.patch(
            "/v1/messages/\(messageId)",
            body: messageDoneBody(done),
            companyId: companyId
        )
    }

    /// D64: done for a task of either source (see `taskDoneRoute`).
    func setTaskDone(companyId: String, taskId: String, messageId: String?, done: Bool) async throws {
        try await writeTaskDone(
            api: api, companyId: companyId, taskId: taskId, messageId: messageId, done: done
        )
    }

    /// D64: promote an answered call to a task ("Make a task" on a call).
    func createFromCall(
        companyId: String,
        callId: String,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: JSONValue? = nil
    ) async throws -> TaskRowPatch {
        try await api.post(
            "/v1/tasks",
            body: taskCreateBody(
                messageId: nil,
                title: title,
                assignedUserId: assignedUserId,
                dueAt: dueAt,
                address: address,
                sourceCallId: callId
            ),
            companyId: companyId
        )
    }

    /// #689: a task with no text or call behind it. A conversation fixes the
    /// contact, so only one of the two links is sent.
    func createStandalone(
        companyId: String,
        title: String,
        assignedUserId: String?,
        dueAt: String?,
        address: JSONValue? = nil,
        conversationId: String?,
        contactId: String?,
        priority: String? = nil,
        labelIds: [String] = [],
        repeatRule: JSONValue? = nil
    ) async throws -> TaskRowPatch {
        try await api.post(
            "/v1/tasks",
            body: taskCreateBody(
                messageId: nil,
                title: title,
                assignedUserId: assignedUserId,
                dueAt: dueAt,
                address: address,
                contactId: conversationId == nil ? contactId : nil,
                conversationId: conversationId,
                priority: priority,
                labelIds: labelIds,
                repeatRule: repeatRule
            ),
            companyId: companyId
        )
    }

    /// #689 D: follow or unfollow a task. Following asks for a push when it
    /// changes; an unfollow is remembered by the server, so a later comment does
    /// not bring it back.
    func follow(companyId: String, taskId: String, follow: Bool) async throws {
        let path = "/v1/tasks/\(taskId)/subscription"
        if follow {
            let _: TaskSubscription = try await api.post(
                path,
                body: JSONValue.object([:]),
                companyId: companyId
            )
        } else {
            try await api.delete(path, companyId: companyId)
        }
    }

    /// Soft-delete; creator or owner/admin only (403 otherwise).
    /// #693: on a repeating task `scope` is "this" (skip this one) or "future"
    /// (end the repeat and remove the later unfinished ones).
    func delete(companyId: String, taskId: String, scope: String? = nil) async throws {
        _ = try await api.raw(
            "DELETE",
            "/v1/tasks/\(taskId)",
            query: ["scope": scope],
            companyId: companyId
        )
    }

    /// One page of a task's history and comments, newest page first (#689).
    func activity(
        companyId: String,
        taskId: String,
        cursor: String? = nil
    ) async throws -> Page<TaskFeedItem> {
        try await api.get(
            "/v1/tasks/\(taskId)/activity",
            query: ["cursor": cursor],
            companyId: companyId
        )
    }

    func addComment(companyId: String, taskId: String, body: String) async throws -> TaskFeedItem {
        try await api.post(
            "/v1/tasks/\(taskId)/comments",
            body: taskCommentBody(body),
            companyId: companyId
        )
    }

    func editComment(
        companyId: String,
        taskId: String,
        commentId: String,
        body: String
    ) async throws -> TaskFeedItem {
        try await api.patch(
            "/v1/tasks/\(taskId)/comments/\(commentId)",
            body: taskCommentBody(body),
            companyId: companyId
        )
    }

    func deleteComment(companyId: String, taskId: String, commentId: String) async throws {
        try await api.delete("/v1/tasks/\(taskId)/comments/\(commentId)", companyId: companyId)
    }

    /// Task discussion: an internal note linked to a live task (D-D).
    func postNote(
        companyId: String,
        conversationId: String,
        body: String,
        taskId: String
    ) async throws -> Message {
        try await api.post(
            "/v1/conversations/\(conversationId)/notes",
            body: taskNoteBody(body: body, taskId: taskId),
            companyId: companyId
        )
    }

    /// Mint a short-lived signed URL — call per view, NEVER cache the result.
    ///
    /// #240: the DEFAULT is the preview, because the callers that mint the most
    /// of these are thread bubbles and gallery tiles, and a 25 MB original
    /// behind a thumbnail was the single worst egress shape in the product — on
    /// our allowance and on the tech's own mobile data (#289).
    ///
    /// Pass "original" to OPEN or DOWNLOAD the file: a deliberate act by a
    /// caller that wants the file rather than a picture of it. A row with no
    /// preview serves its original either way.
    func attachmentUrl(
        companyId: String,
        attachmentId: String,
        variant: String = "preview"
    ) async throws -> AttachmentUrl {
        try await api.get(
            "/v1/attachments/\(attachmentId)/url",
            query: variant == "original" ? ["variant": "original"] : [:],
            companyId: companyId
        )
    }

    /// Promote a message to a task ("Make a task"). 409 = already a task.
    /// #214: an optional confirmed `address` block rides the create body.
    func create(
        companyId: String,
        messageId: String,
        title: String?,
        assignedUserId: String?,
        dueAt: String?,
        address: JSONValue? = nil
    ) async throws -> TaskRowPatch {
        try await api.post(
            "/v1/tasks",
            body: taskCreateBody(
                messageId: messageId,
                title: title,
                assignedUserId: assignedUserId,
                dueAt: dueAt,
                address: address
            ),
            companyId: companyId
        )
    }
}
