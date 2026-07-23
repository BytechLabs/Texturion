import XCTest
@testable import Loonext

/// #201 regression pins: every badge surface (shell avatar dot, account sheet,
/// notifications screen) reads ONE `CompanyReadState`, and its process-lifetime
/// guards keep a server refetch from resurrecting a dot the user already
/// cleared. These drive the exact write sequences the shell's `reloadCounts`
/// and `NotificationsFeedModel`'s mark paths perform.
///
/// `CompanyReadState` is `@MainActor`, so the suite is too — the writes run on
/// the actor exactly as they do in the app.
@MainActor
final class NotificationsReadStateTests: XCTestCase {
    private func item(_ id: String, createdAt: String, unread: Bool = true) -> NotificationItem {
        NotificationItem(
            id: id,
            type: NotificationType.inboundMessage,
            conversation_id: "conv-\(id)",
            message_id: nil,
            task_id: nil,
            contact: nil,
            created_at: createdAt,
            unread: unread
        )
    }

    // MARK: - The mark-in-flight guard (the load-bearing part)

    func testServerCountIsDroppedWhileAMarkIsInFlightThenReconciledOnSettle() {
        let state = NotificationsReadState().forCompany("co-1")
        state.offerServerCount(2) // primed by the shell / screen poll
        XCTAssertEqual(state.unreadCount, 2)

        state.beginMark()
        // A realtime tick lands mid-POST carrying the pre-mark server count.
        state.offerServerCount(3)
        XCTAssertEqual(state.unreadCount, 2, "a server count mid-mark must not resurrect the badge")
        XCTAssertTrue(state.marksInFlight)

        // The POST settles; the reconcile refetch now writes the true count.
        XCTAssertTrue(state.settleMark())
        XCTAssertFalse(state.marksInFlight)
        state.offerServerCount(1)
        XCTAssertEqual(state.unreadCount, 1)
    }

    func testTapReadDecrementsTheSharedCountImmediately() {
        // markItemRead's optimistic sequence: one loaded row flips read.
        let state = NotificationsReadState().forCompany("co-1")
        state.offerServerCount(3)

        state.setUnreadCount(3 - 1) // decrement by the rows the watermark flipped
        state.beginMark()

        XCTAssertEqual(state.unreadCount, 2)
        XCTAssertTrue(state.marksInFlight)
    }

    func testOptimisticCountLandsEvenWhileAMarkIsInFlight() {
        // The local delta is NOT gated (offerServerCount is): a second tap's
        // clear must show while the first tap's POST is still out.
        let state = NotificationsReadState().forCompany("co-1")
        state.offerServerCount(2)
        state.beginMark()

        state.setUnreadCount(0)
        XCTAssertEqual(state.unreadCount, 0)
    }

    func testSetUnreadCountNeverGoesNegative() {
        let state = NotificationsReadState().forCompany("co-1")
        state.offerServerCount(0)
        state.setUnreadCount(-1) // a delta that overshoots stays clamped
        XCTAssertEqual(state.unreadCount, 0)
    }

    func testOverlappingMarksReconcileOnlyOnceOnTheLastSettle() {
        let state = NotificationsReadState().forCompany("co-1")
        state.beginMark()
        state.beginMark()

        XCTAssertFalse(state.settleMark(), "first of two settles is not the last")
        XCTAssertTrue(state.settleMark(), "last settle is the reconcile cue")
    }

    // MARK: - mark-all-read + the forward-only watermark

    func testReadAllZeroesTheSharedCountAndItsWatermarkHoldsOverARefetch() throws {
        let state = NotificationsReadState().forCompany("co-1")
        state.offerServerCount(4)

        // markAllRead's optimistic sequence, then the server watermark lands.
        state.setUnreadCount(0)
        state.beginMark()
        state.localWatermark = advanceWatermark(
            current: state.localWatermark, candidate: "2026-07-22T12:00:00Z"
        )

        // A racing refetch: stale count dropped, stale page flips read via the
        // watermark; items newer than the advance keep their dot (D24).
        state.offerServerCount(4)
        XCTAssertEqual(state.unreadCount, 0)

        let page = state.withLocalReads([
            item("older", createdAt: "2026-07-22T11:00:00Z"),
            item("newer", createdAt: "2026-07-22T13:00:00Z"),
        ])
        XCTAssertFalse(try XCTUnwrap(page.first { $0.id == "older" }).unread)
        XCTAssertTrue(try XCTUnwrap(page.first { $0.id == "newer" }).unread)
    }

    func testWithLocalReadsKeepsTappedRowsReadAcrossARacingFeedRefetch() throws {
        let state = NotificationsReadState().forCompany("co-1")
        // A single tap advanced the watermark to the tapped row's timestamp.
        state.localWatermark = "2026-07-22T12:00:00Z"

        // The refetched page still carries the pre-mark unread flags.
        let result = state.withLocalReads([
            item("tapped", createdAt: "2026-07-22T11:00:00Z"),
            item("other", createdAt: "2026-07-22T13:00:00Z"),
        ])
        XCTAssertFalse(try XCTUnwrap(result.first { $0.id == "tapped" }).unread)
        XCTAssertTrue(try XCTUnwrap(result.first { $0.id == "other" }).unread)
    }

    func testWithLocalReadsIsANoOpWithoutAWatermark() throws {
        let state = NotificationsReadState().forCompany("co-1")
        let result = state.withLocalReads([item("a", createdAt: "2026-07-22T11:00:00Z")])
        XCTAssertTrue(try XCTUnwrap(result.first).unread)
    }

    // MARK: - Single source of truth across screen unmounts + sign-out

    func testForCompanyResolvesTheSameInstanceSoTheShellAndScreenShareOneSource() {
        // The tap that marks a row read swaps the shell's sheet and can unmount
        // the screen; a fresh model must resolve the SAME in-flight guards.
        let holder = NotificationsReadState()
        let state = holder.forCompany("co-1")
        state.beginMark()

        XCTAssertTrue(holder.forCompany("co-1") === state)
        XCTAssertTrue(holder.forCompany("co-1").marksInFlight)
    }

    func testDifferentCompaniesGetIndependentState() {
        let holder = NotificationsReadState()
        holder.forCompany("co-1").offerServerCount(5)
        XCTAssertEqual(holder.forCompany("co-2").unreadCount, 0)
        XCTAssertFalse(holder.forCompany("co-1") === holder.forCompany("co-2"))
    }

    func testClearDropsTheGuards() {
        let holder = NotificationsReadState()
        holder.forCompany("co-1").beginMark()
        holder.clear()
        XCTAssertFalse(holder.forCompany("co-1").marksInFlight)
    }

    func testAFreshProcessPaintsThePostReadServerCount() {
        // A restart resolves a clean state; the server watermark advanced at
        // mark time, so the cold prime paints zero with no stale guard blocking.
        let state = NotificationsReadState().forCompany("co-1")
        state.offerServerCount(0)
        XCTAssertEqual(state.unreadCount, 0)
        XCTAssertFalse(state.marksInFlight)
    }
}
