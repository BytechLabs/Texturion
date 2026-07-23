import Foundation

/// POST /v1/messages/send request body.
struct SendBody: Codable, Sendable {
    let conversation_id: String
    let body: String
    let media: [OutboundMedia]?
}

/// POST /v1/conversations (outbound-first compose) request body.
struct ComposeBody: Codable, Sendable {
    let contact_id: String?
    let phone_e164: String?
    let phone_number_id: String
    let body: String
    let quiet_hours_confirmed: Bool?
    let media: [OutboundMedia]?

    /// The quiet-hours 409 resend: the SAME body with the confirmation set.
    func confirmed() -> ComposeBody {
        ComposeBody(
            contact_id: contact_id,
            phone_e164: phone_e164,
            phone_number_id: phone_number_id,
            body: body,
            quiet_hours_confirmed: true,
            media: media
        )
    }
}

/// POST /v1/conversations/:id/notes request body.
struct NoteBody: Codable, Sendable {
    let body: String
    let task_id: String?
}

/// All messaging reads + mutations for the inbox / thread / composer features
/// (#159), mirroring the Android MessagingRepository 1:1. Honors the binding
/// invariants: Bearer + X-Company-Id ride every call via `ApiClient`, sends
/// carry a client Idempotency-Key, cursor pagination is opaque, and signed
/// attachment URLs are minted per view — never cached.
struct MessagingRepository: Sendable {
    let api: ApiClient

    // MARK: - Thread reads

    func detail(companyId: String, conversationId: String) async throws -> ConversationDetail {
        try await api.get("/v1/conversations/\(conversationId)", companyId: companyId)
    }

    func messages(
        companyId: String,
        conversationId: String,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> Page<Message> {
        try await api.get(
            "/v1/conversations/\(conversationId)/messages",
            query: ["cursor": cursor, "limit": String(limit)],
            companyId: companyId
        )
    }

    func events(
        companyId: String,
        conversationId: String,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> Page<ConversationEvent> {
        try await api.get(
            "/v1/conversations/\(conversationId)/events",
            query: ["cursor": cursor, "limit": String(limit)],
            companyId: companyId
        )
    }

    /// The COMPLETE pinned-message set, pinned_at DESC (banner endpoint).
    func pinnedMessages(companyId: String, conversationId: String) async throws -> Page<Message> {
        try await api.get("/v1/conversations/\(conversationId)/pinned", companyId: companyId)
    }

    func markRead(companyId: String, conversationId: String) async throws {
        let _: ReadReceipt = try await api.post(
            "/v1/conversations/\(conversationId)/read",
            companyId: companyId
        )
    }

    /// Drop the caller's read watermark so the unread dot returns and survives
    /// revalidation (the inbox read/unread swipe's mark-UNREAD leg). The Android
    /// MessagingData.markUnread twin: DELETE /v1/conversations/:id/read.
    func markUnread(companyId: String, conversationId: String) async throws {
        try await api.delete(
            "/v1/conversations/\(conversationId)/read",
            companyId: companyId
        )
    }

    // MARK: - Conversation mutations

    private func patchConversation(
        companyId: String,
        conversationId: String,
        body: JSONValue
    ) async throws -> Conversation {
        try await api.patch(
            "/v1/conversations/\(conversationId)",
            body: body,
            companyId: companyId
        )
    }

    func setStatus(
        companyId: String,
        conversationId: String,
        status: String
    ) async throws -> Conversation {
        try await patchConversation(
            companyId: companyId,
            conversationId: conversationId,
            body: .object(["status": .string(status)])
        )
    }

    /// nil = unassign (the server needs an explicit null).
    func setAssignee(
        companyId: String,
        conversationId: String,
        userId: String?
    ) async throws -> Conversation {
        try await patchConversation(
            companyId: companyId,
            conversationId: conversationId,
            body: .object(["assigned_user_id": userId.map { .string($0) } ?? .null])
        )
    }

    func setSpam(
        companyId: String,
        conversationId: String,
        spam: Bool
    ) async throws -> Conversation {
        try await patchConversation(
            companyId: companyId,
            conversationId: conversationId,
            body: .object(["is_spam": .bool(spam)])
        )
    }

    func setConversationPinned(
        companyId: String,
        conversationId: String,
        pinned: Bool
    ) async throws -> Conversation {
        try await patchConversation(
            companyId: companyId,
            conversationId: conversationId,
            body: .object(["pinned": .bool(pinned)])
        )
    }

    // MARK: - Tags (#159 gap-close; Android twin MessagingData.kt)

    /// Attach an existing tag by id. Attaching an attached tag is a no-op.
    func attachTag(companyId: String, conversationId: String, tagId: String) async throws -> Tag {
        try await api.post(
            "/v1/conversations/\(conversationId)/tags",
            body: JSONValue.object(["tag_id": .string(tagId)]),
            companyId: companyId
        )
    }

    /// Create-on-attach (SPEC §7): the server reuses the company's tag with
    /// this name (case-insensitive) or creates it, then attaches.
    func attachTagByName(companyId: String, conversationId: String, name: String) async throws -> Tag {
        try await api.post(
            "/v1/conversations/\(conversationId)/tags",
            body: JSONValue.object(["name": .string(name)]),
            companyId: companyId
        )
    }

    /// Detach. 404 = it wasn't attached (already removed elsewhere).
    func detachTag(companyId: String, conversationId: String, tagId: String) async throws {
        try await api.delete(
            "/v1/conversations/\(conversationId)/tags/\(tagId)",
            companyId: companyId
        )
    }

    // MARK: - Contact panel

    /// This contact's conversations, found the way the web contact panel does
    /// (G6): the list endpoint's `q` matches the phone exactly, which is unique
    /// per company — an honest "conversations with this number" query.
    func conversationsForPhone(
        companyId: String,
        phoneE164: String
    ) async throws -> Page<ConversationListItem> {
        try await api.get(
            "/v1/conversations",
            query: ["q": phoneE164, "limit": "25"],
            companyId: companyId
        )
    }

    /// The conversation checklist (T5.2): all live tasks, created_at ASC.
    func conversationTasks(
        companyId: String,
        conversationId: String
    ) async throws -> Page<TaskItem> {
        try await api.get("/v1/conversations/\(conversationId)/tasks", companyId: companyId)
    }

    // MARK: - Sending

    func send(
        companyId: String,
        conversationId: String,
        body: String,
        media: [OutboundMedia]?,
        idempotencyKey: String
    ) async throws -> Message {
        try await api.post(
            "/v1/messages/send",
            body: SendBody(conversation_id: conversationId, body: body, media: media),
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    func compose(
        companyId: String,
        body: ComposeBody,
        idempotencyKey: String
    ) async throws -> ComposeResult {
        try await api.post(
            "/v1/conversations",
            body: body,
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    func retry(companyId: String, messageId: String) async throws -> Message {
        try await api.post("/v1/messages/\(messageId)/retry", companyId: companyId)
    }

    func createNote(
        companyId: String,
        conversationId: String,
        body: String,
        taskId: String? = nil
    ) async throws -> Message {
        try await api.post(
            "/v1/conversations/\(conversationId)/notes",
            body: NoteBody(body: body, task_id: taskId),
            companyId: companyId
        )
    }

    // MARK: - Per-message facets

    func setDone(companyId: String, messageId: String, done: Bool) async throws -> Message {
        try await api.patch(
            "/v1/messages/\(messageId)",
            body: JSONValue.object(["done": .bool(done)]),
            companyId: companyId
        )
    }

    func setMessagePinned(
        companyId: String,
        messageId: String,
        pinned: Bool
    ) async throws -> Message {
        try await api.patch(
            "/v1/messages/\(messageId)",
            body: JSONValue.object(["pinned": .bool(pinned)]),
            companyId: companyId
        )
    }

    /// Promote a message into a task ("Make a task"). 409 = already promoted.
    func createTask(companyId: String, messageId: String, title: String) async throws -> TaskItem {
        try await api.post(
            "/v1/tasks",
            body: JSONValue.object([
                "message_id": .string(messageId),
                "title": .string(title),
            ]),
            companyId: companyId
        )
    }

    // MARK: - Supporting reads

    func templates(companyId: String) async throws -> Page<Template> {
        try await api.get("/v1/templates", companyId: companyId)
    }

    func tags(companyId: String) async throws -> Page<Tag> {
        try await api.get("/v1/tags", companyId: companyId)
    }

    func members(companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", companyId: companyId)
    }

    func contact(companyId: String, contactId: String) async throws -> Contact {
        try await api.get("/v1/contacts/\(contactId)", companyId: companyId)
    }

    func contacts(
        companyId: String,
        q: String? = nil,
        limit: Int = 10
    ) async throws -> Page<Contact> {
        try await api.get(
            "/v1/contacts",
            query: ["q": q, "limit": String(limit)],
            companyId: companyId
        )
    }

    func usage(companyId: String) async throws -> Usage {
        try await api.get("/v1/usage", companyId: companyId)
    }

    // MARK: - Opt-out

    func optOut(companyId: String, contactId: String) async throws -> OptOut {
        try await api.post("/v1/contacts/\(contactId)/opt-out", companyId: companyId)
    }

    func revokeOptOut(companyId: String, contactId: String) async throws -> OptOut {
        try await api.post("/v1/contacts/\(contactId)/opt-out/revoke", companyId: companyId)
    }

    // MARK: - Attachments

    /// Mint a short-lived signed URL — call per view, NEVER cache the result.
    func attachmentUrl(companyId: String, attachmentId: String) async throws -> AttachmentUrl {
        try await api.get("/v1/attachments/\(attachmentId)/url", companyId: companyId)
    }

    /// One note's live file attachments (renders the note bubble Files section).
    func noteAttachments(companyId: String, noteId: String) async throws -> Page<Attachment> {
        try await api.get(
            "/v1/attachments",
            query: ["owner_type": "note", "owner_id": noteId],
            companyId: companyId
        )
    }

    /// The conversation gallery (D21): MMS + note/task attachments merged,
    /// newest first, cursor-paged. Every item carries a freshly-minted
    /// short-lived signed URL — fetched per view, NEVER cached (each visit to
    /// the gallery refetches, which is the per-view mint).
    func gallery(
        companyId: String,
        conversationId: String,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> Page<GalleryItem> {
        try await api.get(
            "/v1/conversations/\(conversationId)/attachments",
            query: ["cursor": cursor, "limit": String(limit)],
            companyId: companyId
        )
    }
}
