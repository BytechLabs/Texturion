import Foundation
import Observation

/// Process-lifetime mark-read bookkeeping (#201), one entry per company — the
/// iOS twin of Android's NotificationsReadState. The unread badge count and
/// its guards used to live inside the notifications screen's model; but that
/// model is screen-scoped, while the shell avatar dot and the account-sheet
/// badge derived from a SEPARATE `notificationsApi.unreadCount()` fetch with no
/// shared store. So a mark-all-read in the feed never cleared the avatar dot,
/// and an in-flight server count could resurrect a just-cleared dot.
///
/// Hoisted here, ONE `CompanyReadState` is the single source of truth every
/// surface reads (avatar dot, account sheet, the screen). Its guards live
/// exactly as long as the mark POSTs they protect — longer than any one screen.
///
/// Contract: every write of the shared count from a SERVER fetch goes through
/// `CompanyReadState.offerServerCount` (dropped while a mark is in flight); the
/// optimistic delta of a mark and its rollback go through `setUnreadCount`;
/// every fetched feed page goes through `CompanyReadState.withLocalReads`.
@MainActor
final class NotificationsReadState {
    /// Shared app-lifetime instance — the iOS idiom (AppRouter.shared,
    /// PushCoordinator.shared) standing in for Android's AppGraph-held holder.
    static let shared = NotificationsReadState()

    private var companies: [String: CompanyReadState] = [:]

    /// The per-company guards. A workspace switch hands the shell a different
    /// `companyId`, so it naturally resolves a fresh state; the same company
    /// always resolves the SAME instance (identity is load-bearing — the shell
    /// and the screen must share it).
    func forCompany(_ companyId: String) -> CompanyReadState {
        if let existing = companies[companyId] { return existing }
        let created = CompanyReadState()
        companies[companyId] = created
        return created
    }

    /// Drop every per-company guard (sign-out parity with the Android cache
    /// clear).
    func clear() {
        companies.removeAll()
    }
}

/// One company's shared unread state. `@Observable` so the shell avatar dot,
/// the account sheet, and the notifications screen all re-render the instant
/// the count changes — a mark-all-read in the feed clears every surface in the
/// same frame, with no unrelated refetch to wait on.
@MainActor
@Observable
final class CompanyReadState {
    /// The ONE shared unread badge count every surface reads.
    private(set) var unreadCount = 0

    /// The furthest watermark this process has advanced to (forward-only, the
    /// server RPC's semantics). Re-applied to every fetched page so a refetch
    /// racing an in-flight mark POST can't resurrect a stale unread dot.
    var localWatermark: String?

    /// In-flight mark POSTs. Plain Int, not an atomic: everything here runs on
    /// the main actor, so the increments/decrements are already serialized.
    @ObservationIgnored private var pendingMarks = 0

    /// True while any mark POST is in flight.
    var marksInFlight: Bool { pendingMarks > 0 }

    func beginMark() {
        pendingMarks += 1
    }

    /// Returns true when this settle was the LAST in-flight mark: the caller's
    /// cue to run one reconcile refetch (mark endpoints emit no realtime event,
    /// so nothing else corrects drift).
    func settleMark() -> Bool {
        pendingMarks = max(pendingMarks - 1, 0)
        return pendingMarks == 0
    }

    /// A LOCAL write of the shared count — a mark's own optimistic delta or its
    /// rollback. Always applied: it is the local truth, and the whole point is
    /// that it lands even while a mark is in flight (a gated write would be a
    /// no-op exactly when the optimistic clear matters most).
    func setUnreadCount(_ count: Int) {
        unreadCount = max(count, 0)
    }

    /// The one write gate for a SERVER count: dropped while a mark POST is in
    /// flight (it would briefly resurrect the pre-mark badge); reconciled on
    /// settle.
    func offerServerCount(_ count: Int) {
        guard !marksInFlight else { return }
        unreadCount = max(count, 0)
    }

    /// Re-apply this process's forward-only watermark over a fetched page.
    /// Watermark-only (no per-item id set): the iOS feed marks a tapped item
    /// AND everything older read by advancing the watermark to its timestamp,
    /// so the watermark already captures every optimistic read.
    func withLocalReads(_ fetched: [NotificationItem]) -> [NotificationItem] {
        guard let localWatermark else { return fetched }
        return applyWatermark(items: fetched, lastSeenAt: localWatermark)
    }
}
