import Foundation

/// POST /v1/notifications/:id/read body — the tapped item's `created_at`
/// exactly as the feed returned it (re-serializing it would drop the
/// milliseconds the server matches on, #188).
struct MarkReadItemBody: Encodable, Sendable {
    let created_at: String
}

/// POST /v1/notifications/:id/read result: whether this call was the one that
/// flipped the dot.
struct NewlyRead: Decodable, Sendable {
    let newly_read: Bool
}

/// The notifications feature's own /v1 surface: derived feed + watermark
/// advances + per-user prefs (D24). Read semantics live in
/// `applyWatermark`/`advanceWatermark` (NotificationsLogic.swift); this struct
/// is transport only — the Android twin is NotificationsFeedRepository.
struct NotificationsFeedApi: Sendable {
    let api: ApiClient

    func feed(
        companyId: String,
        cursor: String? = nil,
        limit: Int = 25
    ) async throws -> Page<NotificationItem> {
        try await api.get(
            "/v1/notifications",
            query: ["cursor": cursor, "limit": String(limit)],
            companyId: companyId
        )
    }

    func unreadCount(companyId: String) async throws -> UnreadCount {
        try await api.get("/v1/notifications/unread-count", companyId: companyId)
    }

    /// Mark ONE item read (#188). Everything else, newer AND older, keeps its
    /// unread dot.
    func markReadItem(
        companyId: String,
        id: String,
        createdAt: String
    ) async throws -> NewlyRead {
        try await api.post(
            "/v1/notifications/\(id)/read",
            body: MarkReadItemBody(created_at: createdAt),
            companyId: companyId
        )
    }

    /// Advance the watermark to now — every current item reads as read.
    func markAllRead(companyId: String) async throws -> MarkReadResult {
        try await api.post("/v1/notifications/mark-all-read", companyId: companyId)
    }

    func prefs(companyId: String) async throws -> NotificationPrefs {
        try await api.get("/v1/notification-prefs", companyId: companyId)
    }

    /// PUT upserts BOTH toggles — always send the full pair.
    func updatePrefs(
        companyId: String,
        prefs: NotificationPrefs
    ) async throws -> NotificationPrefs {
        try await api.put("/v1/notification-prefs", body: prefs, companyId: companyId)
    }
}
