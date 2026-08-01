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

    /// #239: the response-time report. Its own call rather than a section of
    /// /v1/for-you — it answers a different question (how are we doing) from the
    /// queue (what needs doing), and it is windowed, so folding it in would make
    /// the queue refetch every time somebody switched 7/30/90 days.
    func responseTime(companyId: String, days: Int) async throws -> ResponseTimeReport {
        try await api.get("/v1/reports/response-time?days=\(days)", companyId: companyId)
    }

    /// #342: spam marks that do not look like spam. Its own call rather than a
    /// section of /v1/for-you — it answers a different question and is empty
    /// on nearly every day.
    func spamReview(companyId: String) async throws -> SpamReviewPage {
        try await api.get("/v1/spam-review", companyId: companyId)
    }

    /// The two answers. Lifting the mark puts the thread back in the inbox;
    /// confirming it says "yes, still spam" without making the decision
    /// permanent again — new activity can raise it later.
    func answerSpamReview(
        companyId: String,
        conversationId: String,
        notSpam: Bool
    ) async throws {
        let body: JSONValue = notSpam
            ? .object(["is_spam": .bool(false)])
            : .object(["spam_reviewed": .bool(true)])
        let _: Conversation = try await api.patch(
            "/v1/conversations/\(conversationId)",
            body: body,
            companyId: companyId
        )
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
        // #293: nil is the server's default — the ordinary inbox hides what
        // this member deferred. Only "only" (the Snoozed view) and "all"
        // (opting out of the filter entirely) ever travel.
        snoozed: String? = nil,
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
                "snoozed": snoozed,
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

    /// #478: one action, every task matching either explicit ids or the
    /// CURRENT filter.
    ///
    /// The filter branch sends the SAME field names GET /v1/tasks takes,
    /// because the server resolves them with the same query builder the list
    /// uses — "everything I am looking at" cannot mean something different
    /// here.
    ///
    /// There is no send action and there never can be: the server's zod enum
    /// and the SQL enum are the two gates, and this method cannot express one.
    func bulk(
        companyId: String,
        action: String,
        ids: [String]? = nil,
        filters: TaskListFilters? = nil,
        targetUserId: String? = nil,
        /// True when the caller means "unassign", which is a null the server needs.
        unassign: Bool = false
    ) async throws -> BulkTasksResult {
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
            body["filter"] = .object(filter)
        }
        // Explicit null is meaningful (unassign), so it is only written when the
        // caller says so rather than whenever the id is absent.
        if let targetUserId {
            body["target_user_id"] = .string(targetUserId)
        } else if unassign {
            body["target_user_id"] = .null
        }
        return try await api.post(
            "/v1/tasks/bulk",
            body: JSONValue.object(body),
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
        limit: Int = 25,
        /// #459: read the digits in `q` as keypad letters too, so 2-6-2 finds
        /// "Bob". Opt-in, because in a search box "416" means an area code and
        /// quietly returning names as well would answer a question nobody asked.
        t9: Bool = false
    ) async throws -> Page<Contact> {
        try await api.get(
            "/v1/contacts",
            query: [
                "q": q,
                "cursor": cursor,
                "limit": String(limit),
                "t9": (t9 && !(q ?? "").isEmpty) ? "1" : nil
            ],
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
