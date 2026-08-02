import Foundation

/// POST /v1/messages/send request body.
struct SendBody: Codable, Sendable {
    let conversation_id: String
    let body: String
    let media: [OutboundMedia]?
    /// #475: the saved reply this was built from, if any.
    var template_id: String?
    /// #274: whether the words changed after it was inserted. Omitted entirely
    /// without a template, so an ordinary typed send carries exactly the
    /// payload it always did.
    var template_edited: Bool?
}

/// POST /v1/conversations (outbound-first compose) request body.
struct ComposeBody: Codable, Sendable {
    let contact_id: String?
    let phone_e164: String?
    let phone_number_id: String
    let body: String
    let quiet_hours_confirmed: Bool?
    let media: [OutboundMedia]?
    /// #475: the saved reply this was built from, if any.
    var template_id: String?
    /// #274: whether the words changed after it was inserted.
    var template_edited: Bool?

    /// The quiet-hours 409 resend: the SAME body with the confirmation set.
    func confirmed() -> ComposeBody {
        ComposeBody(
            contact_id: contact_id,
            phone_e164: phone_e164,
            phone_number_id: phone_number_id,
            body: body,
            quiet_hours_confirmed: true,
            media: media,
            // #475: the resend is the SAME message, so it came from the same
            // saved reply. Dropping these would undercount every template a
            // quiet-hours confirmation happened to touch.
            template_id: template_id,
            template_edited: template_edited
        )
    }
}

/// POST /v1/conversations/:id/notes request body.
struct NoteBody: Codable, Sendable {
    let body: String
    let task_id: String?
    /// Teammates named in the body. Omitted when empty so the no-mention case
    /// sends exactly what it always did.
    var mention_user_ids: [String]?
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

    /// #275 — one action over many conversations.
    ///
    /// Pass `ids` for a pointed-at selection, or leave it nil and pass the filter so
    /// the SERVER resolves the set. That distinction is the whole point: the client
    /// never enumerates "everything matching", so it cannot include rows the #106
    /// deny list would have excluded.
    ///
    /// There is deliberately no send action — bulk management only.
    func bulkConversations(
        companyId: String,
        action: String,
        ids: [String]? = nil,
        filterStatus: String? = nil,
        targetStatus: String? = nil,
        targetSpam: Bool? = nil,
        targetUserId: String? = nil,
        /// True when the caller means "unassign", which the server needs as an
        /// explicit null rather than an absent field.
        unassign: Bool = false
    ) async throws -> BulkConversationsResult {
        var body: [String: JSONValue] = ["action": .string(action)]
        if let ids {
            body["ids"] = .array(ids.map { .string($0) })
        } else {
            var filter: [String: JSONValue] = [:]
            if let filterStatus { filter["status"] = .string(filterStatus) }
            body["filter"] = .object(filter)
        }
        if let targetStatus { body["target_status"] = .string(targetStatus) }
        if let targetSpam { body["target_spam"] = .bool(targetSpam) }
        if let targetUserId {
            body["target_user_id"] = .string(targetUserId)
        } else if unassign {
            body["target_user_id"] = .null
        }
        return try await api.post(
            "/v1/conversations/bulk",
            body: JSONValue.object(body),
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

    /// #250: "this is not spam" against the CLASSIFIER, which is a
    /// different sentence from `setSpam` against a person's own mark. No
    /// Bool parameter, because the server accepts only false — nothing may
    /// set a suspicion from outside, or it stops being the machine's own
    /// opinion.
    func clearSpamSuspicion(
        companyId: String,
        conversationId: String
    ) async throws -> Conversation {
        try await patchConversation(
            companyId: companyId,
            conversationId: conversationId,
            body: .object(["spam_suspected": .bool(false)])
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

    /// #293 — defer a thread out of MY list until `untilISO`.
    ///
    /// The instant is absolute and resolved on the DEVICE, because #292 says
    /// "tomorrow morning" is the user's morning and only the device knows what
    /// that is. A customer reply cancels it in the database, whatever the timer
    /// said, so nothing on this side has to remember that rule.
    func snooze(
        companyId: String,
        conversationId: String,
        untilISO: String,
        note: String? = nil,
        kind: DeferralKind = .snooze
    ) async throws {
        var body: [String: JSONValue] = [
            "until": .string(untilISO),
            "kind": .string(kind.rawValue),
        ]
        if let note { body["note"] = .string(note) }
        let _: JSONValue = try await api.post(
            "/v1/conversations/\(conversationId)/snooze",
            body: JSONValue.object(body),
            companyId: companyId
        )
    }

    /// #293 — bring it back now. Idempotent, so one tap is always safe.
    func unsnooze(companyId: String, conversationId: String) async throws {
        try await api.delete(
            "/v1/conversations/\(conversationId)/snooze",
            companyId: companyId
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
        idempotencyKey: String,
        templateId: String? = nil,
        templateEdited: Bool = false
    ) async throws -> Message {
        try await api.post(
            "/v1/messages/send",
            body: SendBody(
                conversation_id: conversationId,
                body: body,
                media: media,
                template_id: templateId,
                template_edited: templateId == nil ? nil : templateEdited
            ),
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
        taskId: String? = nil,
        mentionUserIds: [String] = []
    ) async throws -> Message {
        try await api.post(
            "/v1/conversations/\(conversationId)/notes",
            body: NoteBody(
                body: body,
                task_id: taskId,
                mention_user_ids: mentionUserIds.isEmpty ? nil : mentionUserIds
            ),
            companyId: companyId
        )
    }

    /// Who this member may name on a note here (already number-access filtered).
    func mentionableMembers(
        companyId: String,
        conversationId: String
    ) async throws -> [MentionableMember] {
        let page: Page<MentionableMember> = try await api.get(
            "/v1/conversations/\(conversationId)/mentionable-members",
            companyId: companyId
        )
        return page.data
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
    /// #214: threads the optional confirmed due + structured address from the
    /// make-task sheet through the shared, tested `taskCreateBody` builder.
    func createTask(
        companyId: String,
        messageId: String,
        title: String,
        assignedUserId: String? = nil,
        dueAt: String? = nil,
        address: JSONValue? = nil
    ) async throws -> TaskRowPatch {
        // POST /v1/tasks returns to_jsonb(v_task) = TASK_COLUMNS, which has NO
        // done/status column (completion derives from messages.done_at), so the
        // 201 body must decode into TaskRowPatch (the projection of the raw row)
        // — NOT TaskItem, whose non-optional done/status would throw keyNotFound
        // and make every "Make a task" report a false failure. makeTask reads
        // only id/title, both present on TaskRowPatch.
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

    // MARK: - AI task enrichment (#214)

    /// GET /v1/company/ai-settings — member-visible read of the per-company
    /// enrichment opt-in (the make-task sheet needs it before calling enrich).
    func aiSettings(companyId: String) async throws -> CompanyAiSettings {
        try await api.get("/v1/company/ai-settings", companyId: companyId)
    }

    /// POST /v1/conversations/:id/reply-suggestions — drafted replies for the
    /// open thread. `draft` is whatever is already typed, so the server finishes
    /// that sentence instead of talking past it.
    ///
    /// NOT cached: each call is a metered request the person asked for, and a
    /// draft is only useful for the conversation as it stands right now. NEVER
    /// throws — any failure resolves to no suggestions, so the composer degrades
    /// to exactly what it was before.
    func suggestReplies(
        companyId: String,
        conversationId: String,
        draft: String
    ) async -> ReplySuggestions {
        var body: [String: JSONValue] = [:]
        if !draft.isBlank { body["draft"] = .string(draft) }
        do {
            return try await api.post(
                "/v1/conversations/\(conversationId)/reply-suggestions",
                body: JSONValue.object(body),
                companyId: companyId
            )
        } catch {
            return ReplySuggestions(suggestions: [], reason: "model_error")
        }
    }

    /// POST /v1/tasks/enrich — infer an address + due date/time from task text,
    /// a pure SUGGESTION the user reviews before saving. NEVER throws to the
    /// caller: any error resolves to the empty enrichment, so task creation is
    /// never blocked by the AI path. Session-cached per (company, message):
    /// reopening the make-task sheet for the same message reuses the result
    /// instead of spending another AI call (mirrors task-enrichment.ts).
    func enrichTask(
        companyId: String,
        messageId: String?,
        conversationId: String?,
        text: String
    ) async -> TaskEnrichment {
        if let messageId,
           let cached = await TaskEnrichmentCache.shared.cached(
               companyId: companyId, messageId: messageId
           ) {
            return cached
        }
        var body: [String: JSONValue] = ["text": .string(text)]
        if let messageId { body["message_id"] = .string(messageId) }
        if let conversationId { body["conversation_id"] = .string(conversationId) }

        let result: TaskEnrichment
        do {
            result = try await api.post(
                "/v1/tasks/enrich",
                body: JSONValue.object(body),
                companyId: companyId
            )
        } catch {
            result = TaskEnrichment.empty
        }
        // Cache even the empty/failed result so a failed call doesn't re-fire
        // within the session (the web caches unconditionally too).
        if let messageId {
            await TaskEnrichmentCache.shared.store(
                result, companyId: companyId, messageId: messageId
            )
        }
        return result
    }

    /// POST /v1/ai/outcome (#431) — record what a human did with one piece of AI
    /// output.
    ///
    /// We metered every AI unit we spent and recorded nothing about whether anyone
    /// used it, so "is Lou worth what it costs?" was unanswerable rather than
    /// merely unanswered. `feature` is a LEDGER key (see `AiOutcome`) and
    /// `outcome` one of three enum strings; no message content ever leaves the
    /// device for this.
    ///
    /// NEVER throws. Losing an outcome costs a data point; surfacing an error
    /// here would cost the person sending a text their attention at the worst
    /// possible moment.
    func reportAiOutcome(companyId: String, feature: String, outcome: String) async {
        do {
            let _: JSONValue = try await api.post(
                "/v1/ai/outcome",
                body: JSONValue.object([
                    "feature": .string(feature),
                    "outcome": .string(outcome),
                ]),
                companyId: companyId
            )
        } catch {
            // Intentionally silent. See above.
        }
    }

    // MARK: - Supporting reads

    /// #274 — two orders, because two people are asking different questions.
    ///
    /// `byUse` is the composer's picker: somebody about to send wants the reply
    /// they send twenty times a day, and alphabetical puts it wherever its name
    /// falls. The default is the settings list, where a stable place to find a
    /// template beats a list that reorders itself as the crew works.
    func templates(
        companyId: String,
        byUse: Bool = false
    ) async throws -> Page<Template> {
        try await api.get(
            "/v1/templates",
            query: byUse ? ["sort": "use"] : [:],
            companyId: companyId
        )
    }

    // MARK: - Saved replies (Settings → Templates)
    // Member-level for every operation (routes/templates.ts): any active
    // teammate may write them, so these carry no extra role check.

    func createTemplate(
        companyId: String,
        name: String,
        body: String,
        /// #274: the crew's own grouping. Blank travels as "" and the API
        /// normalises it to null, which is how a clear is expressed.
        category: String = ""
    ) async throws -> Template {
        try await api.post(
            "/v1/templates",
            body: JSONValue.object([
                "name": .string(name),
                "body": .string(body),
                "category": .string(category),
            ]),
            companyId: companyId
        )
    }

    func updateTemplate(
        companyId: String,
        templateId: String,
        name: String,
        body: String,
        category: String = ""
    ) async throws -> Template {
        try await api.patch(
            "/v1/templates/\(templateId)",
            body: JSONValue.object([
                "name": .string(name),
                "body": .string(body),
                "category": .string(category),
            ]),
            companyId: companyId
        )
    }

    func deleteTemplate(companyId: String, templateId: String) async throws {
        try await api.delete("/v1/templates/\(templateId)", companyId: companyId)
    }

    func tags(companyId: String) async throws -> Page<Tag> {
        try await api.get("/v1/tags", companyId: companyId)
    }

    /// #298: the same list with use counts, busiest first (member-readable).
    func tagUsage(companyId: String) async throws -> Page<TagUsage> {
        try await api.get("/v1/tags/usage", companyId: companyId)
    }

    /// #298: say what a tag means. Blank clears it back to unexplained.
    func describeTag(
        companyId: String,
        tagId: String,
        description: String
    ) async throws -> Tag {
        let trimmed = description.trimmingCharacters(in: .whitespacesAndNewlines)
        return try await api.patch(
            "/v1/tags/\(tagId)",
            body: JSONValue.object([
                "description": trimmed.isEmpty ? .null : .string(trimmed),
            ]),
            companyId: companyId
        )
    }

    /// #298: fold `from` into `into`, keeping every association. Delete was the
    /// only cleanup and it loses them all, so an admin who found six variants
    /// could previously only destroy five.
    func mergeTags(
        companyId: String,
        fromTagId: String,
        intoTagId: String
    ) async throws -> TagMergeResult {
        try await api.post(
            "/v1/tags/\(fromTagId)/merge",
            body: JSONValue.object(["into_tag_id": .string(intoTagId)]),
            companyId: companyId
        )
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

    /// #317 — pull a file back for the WHOLE workspace.
    ///
    /// The scan (D101) stops what it can recognise and is explicitly not
    /// antivirus, so this is the path for whatever gets past it. Available to
    /// any member on purpose: behind owner-only, the person holding the phone
    /// cannot stop the thing they just spotted, and waiting is how somebody
    /// ends up opening it to check.
    func reportAttachment(
        companyId: String,
        attachmentId: String
    ) async throws -> AttachmentReport {
        try await api.post("/v1/attachments/\(attachmentId)/report", companyId: companyId)
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

// MARK: - The destination clock (#225 / D49)

/// "It's about 9pm where they are (from their area code)." — the line above
/// the composer, and only when it would change what somebody does.
///
/// A reply inside a thread the customer started is reply-exempt and never
/// blocked: a trade owner texting their own customer back at 9:15pm is their
/// call. But most people have no idea what time it is in a 613 area code, and
/// finding out from an annoyed customer is the expensive way.
///
/// Returns nil when it is daytime there, because a clock that sits on screen
/// all day is furniture and furniture is not read.
///
/// Hand-ported to three clients, so it has a test: the failure mode is one app
/// telling somebody a different hour than another, which is worse than no hint.
func theirTimeLine(_ clock: DestinationClock?) -> String? {
    guard let clock, clock.isQuiet else { return nil }
    let suffix = clock.hour < 12 ? "am" : "pm"
    let twelve = clock.hour % 12 == 0 ? 12 : clock.hour % 12
    return "It's about \(twelve)\(suffix) where they are (\(clockProvenance(clock.rung)))."
}

/// Which rung answered, said plainly.
///
/// The weakest one admits itself outright: showing our own timezone as though
/// it were the customer's would be the quiet lie, and the whole value of the
/// ladder is that a screen can say how much to trust it.
func clockProvenance(_ source: String) -> String {
    switch source {
    case "contact": "set on their contact"
    case "area_code": "from their area code"
    default: "your workspace's timezone — we don't know theirs"
    }
}
