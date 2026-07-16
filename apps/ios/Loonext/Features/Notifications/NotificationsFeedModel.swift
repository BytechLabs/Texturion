import Foundation
import Observation

/// Screen state for the derived notifications feed (D24) — the exact
/// optimistic-read semantics of the Android NotificationsScreen:
///
/// - Tap = optimistic watermark advance (that item and everything older flips
///   read; newer stays unread), rollback on error.
/// - `localWatermark` is the furthest advance this session has made
///   (forward-only, the server RPC's semantics). It is re-applied to every
///   fetched page so a refetch racing an in-flight mark-read POST can't
///   resurrect stale unread dots.
/// - Server unread counts are ignored while a mark POST is in flight (they'd
///   briefly resurrect the pre-mark badge); reconciled on settle.
@MainActor
@Observable
final class NotificationsFeedModel {
    private let api: NotificationsFeedApi
    private let companyId: String

    private(set) var state: LoadState<Void> = .loading
    private(set) var items: [NotificationItem] = []
    private(set) var nextCursor: String?
    private(set) var loadingMore = false
    private(set) var unreadCount = 0
    /// Transient bottom notice (the Android snackbar equivalent).
    private(set) var toast: String?

    private var localWatermark: String?
    private var pendingMarks = 0
    private var toastTask: Task<Void, Never>?

    init(api: NotificationsFeedApi, companyId: String) {
        self.api = api
        self.companyId = companyId
    }

    var hasUnread: Bool {
        unreadCount > 0 || items.contains { $0.unread }
    }

    /// The failed screen's retry: show the spinner again before refetching.
    func prepareRetry() {
        state = .loading
    }

    /// First page + badge. Realtime events re-trigger this and trim back to
    /// page 1 (web reconnect parity); a quiet refresh failure keeps shown data.
    func refresh() async {
        do {
            let page = try await api.feed(companyId: companyId)
            items = withLocalReads(page.data)
            nextCursor = page.next_cursor
            state = .ready(())
        } catch {
            if Task.isCancelled { return }
            if case .ready = state {} else { state = .failed(error.userMessage) }
        }
        await pollUnread()
    }

    /// Badge refresh (also the 60s poll body). Ignored mid-mark.
    func pollUnread() async {
        guard let count = (try? await api.unreadCount(companyId: companyId))?.count else {
            return
        }
        if pendingMarks == 0 {
            unreadCount = count
        }
    }

    func markItemRead(_ item: NotificationItem) {
        guard item.unread else { return }
        let previousItems = items
        let previousCount = unreadCount
        let previousWatermark = localWatermark
        localWatermark = advanceWatermark(current: localWatermark, candidate: item.created_at)
        items = applyWatermark(items: items, lastSeenAt: item.created_at)
        // Everything newer than a loaded item is also loaded (contiguous DESC
        // feed), so counting loaded unread rows is exact after the advance.
        unreadCount = items.filter { $0.unread }.count
        pendingMarks += 1
        Task {
            defer { pendingMarks -= 1 }
            do {
                let result = try await api.markRead(companyId: companyId, before: item.created_at)
                // The server may be further ahead (another device read more).
                localWatermark = advanceWatermark(
                    current: localWatermark, candidate: result.last_seen_at
                )
                items = applyWatermark(items: items, lastSeenAt: result.last_seen_at)
                unreadCount = items.filter { $0.unread }.count
            } catch {
                items = previousItems
                unreadCount = previousCount
                localWatermark = previousWatermark
                showToast("Couldn't mark that read.")
            }
        }
    }

    func markAllRead() {
        guard hasUnread else { return }
        let previousItems = items
        let previousCount = unreadCount
        let previousWatermark = localWatermark
        items = items.map { item in
            guard item.unread else { return item }
            var read = item
            read.unread = false
            return read
        }
        unreadCount = 0
        pendingMarks += 1
        Task {
            defer { pendingMarks -= 1 }
            do {
                let result = try await api.markAllRead(companyId: companyId)
                localWatermark = advanceWatermark(
                    current: localWatermark, candidate: result.last_seen_at
                )
            } catch {
                items = previousItems
                unreadCount = previousCount
                localWatermark = previousWatermark
                showToast("Couldn't mark all read.")
            }
        }
    }

    func loadOlder() {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        Task {
            defer { loadingMore = false }
            do {
                let page = try await api.feed(companyId: companyId, cursor: cursor)
                var seen = Set<String>()
                var merged: [NotificationItem] = []
                for row in items + withLocalReads(page.data) {
                    if seen.insert(row.feedKey).inserted {
                        merged.append(row)
                    }
                }
                items = merged
                nextCursor = page.next_cursor
            } catch {
                showToast("Couldn't load older notifications.")
            }
        }
    }

    private func withLocalReads(_ fetched: [NotificationItem]) -> [NotificationItem] {
        guard let localWatermark else { return fetched }
        return applyWatermark(items: fetched, lastSeenAt: localWatermark)
    }

    private func showToast(_ message: String) {
        toastTask?.cancel()
        toast = message
        toastTask = Task {
            try? await Task.sleep(for: .seconds(3))
            if !Task.isCancelled {
                toast = nil
            }
        }
    }
}

extension NotificationItem {
    /// Feed row identity: item ids are message/event UUIDs from a UNION, so a
    /// message id and an event id could theoretically collide — key by
    /// type+id like the Android and web feeds do.
    var feedKey: String { "\(type):\(id)" }
}
