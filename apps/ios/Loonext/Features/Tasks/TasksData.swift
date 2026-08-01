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

/// `{"done": true|false}` — the ONE completion body, sent to the message route.
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
    messageId: String,
    title: String?,
    assignedUserId: String?,
    dueAt: String?,
    address: JSONValue? = nil
) -> JSONValue {
    var object: [String: JSONValue] = ["message_id": .string(messageId)]
    if let title { object["title"] = .string(title) }
    if let assignedUserId { object["assigned_user_id"] = .string(assignedUserId) }
    if let dueAt { object["due_at"] = .string(dueAt) }
    if let address { object["address"] = address }
    return .object(object)
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

    /// Metadata-only edit. Null-bearing fields must SEND null (clear).
    private func patch(
        companyId: String,
        taskId: String,
        body: JSONValue
    ) async throws -> TaskRowPatch {
        try await api.patch("/v1/tasks/\(taskId)", body: body, companyId: companyId)
    }

    func rename(companyId: String, taskId: String, title: String) async throws -> TaskRowPatch {
        try await patch(companyId: companyId, taskId: taskId, body: taskRenameBody(title))
    }

    func describe(
        companyId: String,
        taskId: String,
        description: String
    ) async throws -> TaskRowPatch {
        try await patch(companyId: companyId, taskId: taskId, body: taskDescribeBody(description))
    }

    func assign(companyId: String, taskId: String, userId: String?) async throws -> TaskRowPatch {
        try await patch(companyId: companyId, taskId: taskId, body: taskAssignBody(userId))
    }

    /// `dueAt` must be ISO 8601 WITH offset (`encodeDueAt`); nil clears.
    func setDue(companyId: String, taskId: String, dueAt: String?) async throws -> TaskRowPatch {
        try await patch(companyId: companyId, taskId: taskId, body: taskDueBody(dueAt))
    }

    /// #214: replace the whole structured job address (empty fields clear it).
    /// `provenance` is "manual" once the user hand-edits, else the enrichment's
    /// own value.
    func updateAddress(
        companyId: String,
        taskId: String,
        fields: AddressFieldValues,
        provenance: String
    ) async throws -> TaskRowPatch {
        try await patch(
            companyId: companyId,
            taskId: taskId,
            body: taskAddressPatchBody(fields, provenance: provenance)
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

    /// Soft-delete; creator or owner/admin only (403 otherwise).
    func delete(companyId: String, taskId: String) async throws {
        try await api.delete("/v1/tasks/\(taskId)", companyId: companyId)
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

    /// Mint a short-lived signed URL for one derived-union attachment.
    func attachmentUrl(companyId: String, attachmentId: String) async throws -> AttachmentUrl {
        try await api.get("/v1/attachments/\(attachmentId)/url", companyId: companyId)
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
