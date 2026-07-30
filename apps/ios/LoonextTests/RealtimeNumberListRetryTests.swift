import XCTest
@testable import Loonext

/// #483 — the bootstrap number list had no retry. GET /v1/numbers is the only
/// source of the access-filtered list that decides which per-number realtime
/// topics this client joins, and one transient failure opened the socket with an
/// EMPTY one: the company topic joined, not a single per-number topic. The
/// reconnect observer heals that on the next re-JOIN, which on a healthy socket
/// can be hours away, and after D88's contract step those are hours of an inbox
/// that never updates.
///
/// The ladder is exercised with millisecond waits — XCTest has no virtual clock
/// to skip the production seventeen seconds the way Android's `runTest` does —
/// plus the production schedule's own properties, which is the part that must not
/// drift.
final class RealtimeNumberListRetryTests: XCTestCase {
    /// The attempts, behind an actor: `retryNumberList` takes a `@Sendable`
    /// closure, so a plain captured counter would be a data race.
    private actor Attempts {
        private let succeedOn: Int
        private(set) var count = 0
        private(set) var firstAt: Date?

        init(succeedOn: Int) { self.succeedOn = succeedOn }

        func record() -> Bool {
            count += 1
            if firstAt == nil { firstAt = Date() }
            return count >= succeedOn
        }
    }

    /// One fast rung per production rung: the shape of the ladder is the real one
    /// and the test costs milliseconds.
    private var fastLadder: [Duration] {
        numberListRetryDelays.map { _ in Duration.milliseconds(10) }
    }

    func testItStopsAtTheFirstAttemptThatLands() async {
        let attempts = Attempts(succeedOn: 2)

        let healed = await retryNumberList(delays: fastLadder) { await attempts.record() }

        let count = await attempts.count
        XCTAssertTrue(healed)
        // Two, not three: nothing keeps re-reading /v1/numbers once the list it
        // was missing is in hand.
        XCTAssertEqual(count, 2)
    }

    /// Bounded, because the re-JOIN heal is still behind it. An unbounded ladder
    /// would be a background poll of /v1/numbers for the life of the process.
    func testItGivesUpAfterOneAttemptPerRung() async {
        let attempts = Attempts(succeedOn: .max)

        let healed = await retryNumberList(delays: fastLadder) { await attempts.record() }

        let count = await attempts.count
        XCTAssertFalse(healed)
        XCTAssertEqual(count, numberListRetryDelays.count)
    }

    /// Never immediate: the read that just failed fails the same way in the same
    /// millisecond, so a ladder that fired before its first wait would spend a
    /// rung on nothing.
    func testItWaitsBeforeTheFirstAttempt() async {
        let attempts = Attempts(succeedOn: 1)
        let started = Date()

        _ = await retryNumberList(delays: [Duration.milliseconds(120)]) {
            await attempts.record()
        }

        let firstAt = await attempts.firstAt
        XCTAssertNotNil(firstAt)
        XCTAssertGreaterThanOrEqual(firstAt?.timeIntervalSince(started) ?? 0, 0.1)
    }

    /// Cancellation has to stop it. `Task.sleep` throws when the task is cancelled
    /// and the ladder swallows that with `try?`, so without the explicit
    /// `Task.isCancelled` check every remaining rung would fire back to back the
    /// moment a new bootstrap cancelled the old ladder — reading /v1/numbers three
    /// times for a company the app has already moved off.
    func testACancelledLadderStopsAttempting() async {
        let attempts = Attempts(succeedOn: .max)
        let ladder = Task {
            _ = await retryNumberList(
                delays: [Duration.seconds(5), Duration.seconds(5), Duration.seconds(5)]
            ) {
                await attempts.record()
            }
        }

        ladder.cancel()
        _ = await ladder.value

        let count = await attempts.count
        XCTAssertEqual(count, 0)
    }

    /// The production schedule itself: it exists, it widens, and it ends. Widening
    /// is what covers both a provider blip and a short outage without polling;
    /// ending is what keeps this from becoming one.
    func testTheProductionLadderWidensAndEnds() {
        XCTAssertFalse(numberListRetryDelays.isEmpty)
        for (earlier, later) in zip(numberListRetryDelays, numberListRetryDelays.dropFirst()) {
            XCTAssertLessThan(earlier, later)
        }
        let total = numberListRetryDelays.reduce(Duration.zero, +)
        XCTAssertLessThan(total, Duration.seconds(30))
    }
}
