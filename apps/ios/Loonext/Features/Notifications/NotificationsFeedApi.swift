import Foundation

/// POST /v1/notifications/mark-read body — the tapped item's `created_at`
/// (ISO-8601 with offset). The watermark RPC keeps the greatest value, so this
/// marks the item and everything older read; newer items stay unread
/// (apps/api/src/routes/notifications.ts markReadSchema).
struct MarkReadBody: Encodable, Sendable {
    let before: String
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

    /// Advance the watermark to one item's `created_at` (it + older = read).
    func markRead(companyId: String, before: String) async throws -> MarkReadResult {
        try await api.post(
            "/v1/notifications/mark-read",
            body: MarkReadBody(before: before),
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
