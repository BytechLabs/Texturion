import Foundation

/// Thin, typed /v1 readers mirroring the Android repositories. Feature
/// modules own their mutation calls; these are the shared list/bootstrap
/// reads the shell and the four tabs need.
struct MeApi: Sendable {
    let api: ApiClient

    /// Company-exempt without `companyId`; hydrated company view with it.
    func me(companyId: String? = nil) async throws -> Me {
        try await api.get("/v1/me", companyId: companyId)
    }

    func updateDisplayName(_ name: String) async throws {
        let _: JSONValue = try await api.patch(
            "/v1/me",
            body: JSONValue.object(["display_name": .string(name)])
        )
    }
}

struct ForYouApi: Sendable {
    let api: ApiClient

    func forYou(companyId: String) async throws -> ForYou {
        try await api.get("/v1/for-you", companyId: companyId)
    }
}

struct InboxApi: Sendable {
    let api: ApiClient

    func conversations(
        companyId: String,
        status: String? = nil,
        assignedUserId: String? = nil,
        tagId: String? = nil,
        spam: Bool? = nil,
        unread: Bool? = nil,
        pinned: String? = nil,
        q: String? = nil,
        cursor: String? = nil,
        limit: Int = 25
    ) async throws -> Page<ConversationListItem> {
        try await api.get(
            "/v1/conversations",
            query: [
                "status": status,
                "assigned_user_id": assignedUserId,
                "tag_id": tagId,
                "is_spam": spam.map { $0 ? "true" : "false" },
                "unread": unread.map { $0 ? "true" : "false" },
                "pinned": pinned,
                "q": q,
                "cursor": cursor,
                "limit": String(limit),
            ],
            companyId: companyId
        )
    }
}

struct TasksApi: Sendable {
    let api: ApiClient

    /// NO params silently means status=open + assignee=me; ANY explicit filter
    /// param disables BOTH defaults — `taskQueryParams` carries the frozen
    /// route semantics (incl. the "all" sentinel).
    func list(
        companyId: String,
        filters: TaskListFilters = TaskListFilters(),
        cursor: String? = nil,
        limit: Int = 25
    ) async throws -> Page<TaskItem> {
        try await api.get(
            "/v1/tasks",
            query: taskQueryParams(filters, cursor: cursor, limit: limit),
            companyId: companyId
        )
    }

    /// THE one completion path (D14/T2): flip done on the SOURCE MESSAGE.
    /// Idempotent server-side; derived task done updates ride message.status.
    func setDone(companyId: String, messageId: String, done: Bool) async throws -> Message {
        try await api.patch(
            "/v1/messages/\(messageId)",
            body: JSONValue.object(["done": .bool(done)]),
            companyId: companyId
        )
    }

    func members(companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", companyId: companyId)
    }
}

struct ContactsApi: Sendable {
    let api: ApiClient

    func contacts(
        companyId: String,
        q: String? = nil,
        cursor: String? = nil,
        limit: Int = 25
    ) async throws -> Page<Contact> {
        try await api.get(
            "/v1/contacts",
            query: ["q": q, "cursor": cursor, "limit": String(limit)],
            companyId: companyId
        )
    }
}

struct NotificationsApi: Sendable {
    let api: ApiClient

    func feed(companyId: String, cursor: String? = nil) async throws -> Page<NotificationItem> {
        try await api.get(
            "/v1/notifications",
            query: ["cursor": cursor],
            companyId: companyId
        )
    }

    func unreadCount(companyId: String) async throws -> UnreadCount {
        try await api.get("/v1/notifications/unread-count", companyId: companyId)
    }

    func markAllRead(companyId: String) async throws -> MarkReadResult {
        try await api.post("/v1/notifications/mark-all-read", companyId: companyId)
    }
}

struct SearchApi: Sendable {
    let api: ApiClient

    func search(companyId: String, q: String, cursor: String? = nil) async throws -> SearchResult {
        try await api.get(
            "/v1/search",
            query: ["q": q, "cursor": cursor],
            companyId: companyId
        )
    }
}
