import Foundation

/// #691 — what the Trash can hold, spelled the way `POST /v1/trash/restore`
/// names it.
enum TrashKind: String, Sendable {
    case message
    case conversation
    case call
    case voicemail
}

/// The delete and restore calls for messages, conversations, calls and
/// voicemails. A delete moves the record to the workspace Trash for 30 days;
/// restore is what an Undo calls. The Trash screen (#735) restores and purges
/// through `TrashModel`.
struct RecordDeletionRepository: Sendable {
    let api: ApiClient

    func deleteMessage(companyId: String, messageId: String) async throws {
        try await api.delete("/v1/messages/\(messageId)", companyId: companyId)
    }

    func deleteConversation(companyId: String, conversationId: String) async throws {
        try await api.delete("/v1/conversations/\(conversationId)", companyId: companyId)
    }

    /// `callId` is the call log row's own `id`, not its `call_session_id`.
    func deleteCall(companyId: String, callId: String) async throws {
        try await api.delete("/v1/calls/\(callId)", companyId: companyId)
    }

    /// The voicemail alone; the call row stays in the log.
    func deleteVoicemail(companyId: String, callId: String) async throws {
        try await api.delete("/v1/calls/\(callId)/voicemail", companyId: companyId)
    }

    /// 409 when the record's conversation is still in the Trash.
    func restore(companyId: String, kind: TrashKind, id: String) async throws {
        let _: JSONValue = try await api.post(
            "/v1/trash/restore",
            body: JSONValue.object([
                "kind": .string(kind.rawValue),
                "id": .string(id),
            ]),
            companyId: companyId
        )
    }
}

/// The decisions around deleting, kept pure so they can be tested without a
/// view: who may, which messages need a confirmation, and which sentence each
/// outcome says.
enum RecordDeletion {
    /// Deleting is its own capability, held by admins and owners. Members never
    /// see the control; the server refuses them with a 403 regardless.
    static func canDelete(role: String?) -> Bool {
        MemberRole.has(role, Capability.recordsDelete)
    }

    /// A text the carrier has taken. Deleting it removes it from Loonext only,
    /// so it is the one message that gets a confirmation saying the customer
    /// still has it. A failed or queued send never reached them.
    static func isSentText(_ message: Message) -> Bool {
        message.direction == MessageDirection.outbound
            && (message.status == MessageStatus.sent
                || message.status == MessageStatus.delivered)
    }

    static func isNote(_ message: Message) -> Bool {
        message.direction == MessageDirection.note
    }

    static func menuLabelKey(_ message: Message) -> String {
        isNote(message) ? "thread.deleteNote" : "thread.deleteMessage"
    }

    static func messageDeletedKey(_ message: Message) -> String {
        if isSentText(message) { return "thread.sentMessageDeleted" }
        return isNote(message) ? "thread.noteDeleted" : "thread.messageDeleted"
    }

    static func restoredKey(_ kind: TrashKind) -> String {
        switch kind {
        case .message: return "thread.messageRestored"
        case .conversation: return "thread.conversationRestored"
        case .call: return "thread.callRestored"
        case .voicemail: return "thread.voicemailRestored"
        }
    }

    /// The sentence for a failed restore, or nil to fall back to the server's.
    /// 409 means the conversation holding it is still in the Trash.
    static func restoreFailureKey(httpStatus: Int) -> String? {
        httpStatus == 409 ? "thread.restoreBlocked" : nil
    }
}
