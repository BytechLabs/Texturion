import XCTest

@testable import Loonext

/// #540 — the landing screen leads with the queue that needs doing first.
///
/// The same set the Kotlin twin asserts, plus a read of the shared TypeScript,
/// because this is the third hand-port of one rule and nothing about Swift says
/// the original moved.
final class DashboardTilesTests: XCTestCase {
    private let minute: TimeInterval = 60
    private let hour: TimeInterval = 3600

    private let empty = DashboardTiles.Input(
        unassignedAges: [],
        waiting: [],
        tasks: [],
        unreadAges: []
    )

    private func order(_ input: DashboardTiles.Input) -> [DashboardTiles.Tile] {
        DashboardTiles.order(input).map(\.tile)
    }

    func testAnOverdueTaskLeadsWhateverTheReadingOrderSays() {
        let result = order(
            DashboardTiles.Input(
                unassignedAges: [],
                waiting: [],
                tasks: [DashboardTiles.Row(ageSeconds: 2 * hour, overdue: true)],
                unreadAges: [5 * minute]
            )
        )
        XCTAssertEqual(result.first, .tasks)
    }

    func testAStaleQueueBeatsABusierFreshOne() {
        // Count is not urgency. Twelve unread from five minutes ago is an ordinary
        // morning; one thread waiting since yesterday is a customer wondering
        // whether anybody read it.
        let result = order(
            DashboardTiles.Input(
                unassignedAges: [],
                waiting: [DashboardTiles.Row(ageSeconds: 26 * hour, overdue: false)],
                tasks: [],
                unreadAges: Array(repeating: 5 * minute, count: 12)
            )
        )
        XCTAssertEqual(result.first, .waiting)
    }

    func testTwoFreshQueuesDoNotShuffle() {
        // A minute between them must not swap them, or the screen has rearranged
        // every time somebody looked at it.
        func run(_ waitingAge: TimeInterval) -> [DashboardTiles.Tile] {
            order(
                DashboardTiles.Input(
                    unassignedAges: [],
                    waiting: [DashboardTiles.Row(ageSeconds: waitingAge, overdue: false)],
                    tasks: [],
                    unreadAges: [31 * minute]
                )
            )
        }
        XCTAssertEqual(Array(run(30 * minute).prefix(2)), [.waiting, .unread])
        XCTAssertEqual(Array(run(32 * minute).prefix(2)), [.waiting, .unread])
    }

    func testEmptyQueuesKeepTheirPlaceAtTheEnd() {
        let result = order(
            DashboardTiles.Input(
                unassignedAges: [],
                waiting: [],
                tasks: [],
                unreadAges: [10 * minute]
            )
        )
        XCTAssertEqual(result.count, 4)
        XCTAssertEqual(result.first, .unread)
    }

    func testNothingHappeningLeavesTheDeclaredOrderAlone() {
        XCTAssertEqual(order(empty), [.unassigned, .waiting, .tasks, .unread])
    }

    func testUnassignedWorkIsNeverCalledOverdue() {
        // Nobody owns it, so it cannot be late to a person.
        let entry = DashboardTiles.order(
            DashboardTiles.Input(
                unassignedAges: [40 * hour],
                waiting: [],
                tasks: [],
                unreadAges: []
            )
        ).first { $0.tile == .unassigned }
        XCTAssertEqual(entry?.signal, .oldest(ageSeconds: 40 * hour))
    }

    func testATaskWithNoDueDateCannotBeOverdue() {
        let entry = DashboardTiles.order(
            DashboardTiles.Input(
                unassignedAges: [],
                waiting: [],
                tasks: [
                    DashboardTiles.Row(ageSeconds: nil, overdue: false),
                    DashboardTiles.Row(ageSeconds: 2 * hour, overdue: false),
                ],
                unreadAges: []
            )
        ).first { $0.tile == .tasks }
        XCTAssertEqual(entry?.count, 2)
        XCTAssertEqual(entry?.signal, .oldest(ageSeconds: 2 * hour))
    }

    // ------------------------------------------------ against the original

    /// The four-hour line is the same number on all three clients.
    ///
    /// It is the one value a crew would notice differing — the point at which the
    /// screen decides a queue has gone stale — so it is read out of the shared
    /// module rather than pinned three times and left to drift.
    func testTheAgedThresholdMatchesTheSharedModule() throws {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var found: URL?
        while true {
            let candidate = dir.appendingPathComponent("packages/shared/src/dashboard-tiles.ts")
            if FileManager.default.fileExists(atPath: candidate.path) {
                found = candidate
                break
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        let shared = try String(contentsOf: try XCTUnwrap(found), encoding: .utf8)
        XCTAssertTrue(
            shared.contains("export const AGED_MILLIS = 4 * 60 * 60 * 1000"),
            "the stale threshold has drifted from packages/shared/src/dashboard-tiles.ts"
        )
        XCTAssertEqual(DashboardTiles.agedSeconds, 4 * 60 * 60)
        // And the same four queues, in the same declared order.
        XCTAssertTrue(
            shared.contains(
                #"export type DashboardTileId = "unassigned" | "waiting" | "tasks" | "unread""#
            ),
            "the four queue ids have drifted from the shared module"
        )
    }
}
