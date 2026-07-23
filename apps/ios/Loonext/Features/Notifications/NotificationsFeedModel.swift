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
    /// Transient bottom notice (the Android snackbar equivalent).
    private(set) var toast: String?

    /// The shared, app-lifetime unread state (#201) — the SAME instance the
    /// shell avatar dot and the account sheet read, so a mark-read here clears
    /// every surface in the same frame. The unread count, the forward-only
    /// watermark, and the in-flight-mark guard all live here now, not on this
    /// screen-scoped model.
    let readState: CompanyReadState

    private var toastTask: Task<Void, Never>?

    init(api: NotificationsFeedApi, companyId: String) {
        self.api = api
        self.companyId = companyId
        self.readState = NotificationsReadState.shared.forCompany(companyId)
    }

    /// Passthrough to the shared count (kept for the screen's own reads).
    var unreadCount: Int { readState.unreadCount }

    var hasUnread: Bool {
        readState.unreadCount > 0 || items.contains { $0.unread }
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
            items = readState.withLocalReads(page.data)
            nextCursor = page.next_cursor
            state = .ready(())
        } catch {
            if Task.isCancelled { return }
            if case .ready = state {} else { state = .failed(error.userMessage) }
        }
        await pollUnread()
    }

    /// Badge refresh (also the 60s poll body). The shared guard drops the
    /// server count while a mark POST is in flight (it would resurrect the
    /// pre-mark badge).
    func pollUnread() async {
        guard let count = (try? await api.unreadCount(companyId: companyId))?.count else {
            return
        }
        readState.offerServerCount(count)
    }

    func markItemRead(_ item: NotificationItem) {
        guard item.unread else { return }
        let previousItems = items
        let previousCount = readState.unreadCount
        let previousWatermark = readState.localWatermark
        readState.localWatermark = advanceWatermark(
            current: readState.localWatermark, candidate: item.created_at
        )
        // The watermark advance marks the tapped item AND everything older
        // read; decrement the shared server total by however many loaded rows
        // it actually flipped (the reconcile refetch on settle corrects any
        // drift from unloaded older rows).
        let before = items.filter { $0.unread }.count
        items = applyWatermark(items: items, lastSeenAt: item.created_at)
        let flipped = before - items.filter { $0.unread }.count
        readState.setUnreadCount(previousCount - flipped)
        readState.beginMark()
        Task {
            do {
                let result = try await api.markRead(companyId: companyId, before: item.created_at)
                // The server may be further ahead (another device read more).
                readState.localWatermark = advanceWatermark(
                    current: readState.localWatermark, candidate: result.last_seen_at
                )
                items = applyWatermark(items: items, lastSeenAt: result.last_seen_at)
            } catch {
                items = previousItems
                readState.setUnreadCount(previousCount)
                readState.localWatermark = previousWatermark
                showToast("Couldn't mark that read.")
            }
            // The last mark to settle runs one guarded reconcile — no realtime
            // event follows a mark, so this is the only thing that corrects the
            // shared count back to server truth.
            if readState.settleMark() {
                await pollUnread()
            }
        }
    }

    func markAllRead() {
        guard hasUnread else { return }
        let previousItems = items
        let previousCount = readState.unreadCount
        let previousWatermark = readState.localWatermark
        items = items.map { item in
            guard item.unread else { return item }
            var read = item
            read.unread = false
            return read
        }
        readState.setUnreadCount(0)
        readState.beginMark()
        Task {
            do {
                let result = try await api.markAllRead(companyId: companyId)
                readState.localWatermark = advanceWatermark(
                    current: readState.localWatermark, candidate: result.last_seen_at
                )
            } catch {
                items = previousItems
                readState.setUnreadCount(previousCount)
                readState.localWatermark = previousWatermark
                showToast("Couldn't mark all read.")
            }
            if readState.settleMark() {
                await pollUnread()
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
                for row in items + readState.withLocalReads(page.data) {
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
