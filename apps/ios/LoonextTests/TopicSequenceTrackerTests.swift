import XCTest
@testable import Loonext

final class TopicSequenceTrackerTests: XCTestCase {
    private let topic = "realtime:company:c1:number:n1"
    private let window = TopicSequenceTracker.reorderWindow

    func testEventsInOrderStayQuiet() {
        var tracker = TopicSequenceTracker()
        for seq in 1 ... 4 { tracker.observe(topic, seq: seq, now: 0) }
        XCTAssertNil(tracker.nextDeadline)
        XCTAssertEqual(tracker.expired(now: window * 2), [])
    }

    func testADuplicateAndAnOlderSequenceAreIgnored() {
        var tracker = TopicSequenceTracker()
        for seq in [5, 6, 6, 5, 7] { tracker.observe(topic, seq: seq, now: 0) }
        XCTAssertNil(tracker.nextDeadline)
        XCTAssertEqual(tracker.expired(now: window * 2), [])
    }

    func testALateEventInsideTheWindowDoesNotResync() {
        var tracker = TopicSequenceTracker()
        tracker.observe(topic, seq: 1, now: 0)
        tracker.observe(topic, seq: 3, now: 0)
        XCTAssertEqual(tracker.nextDeadline, window)
        XCTAssertEqual(tracker.expired(now: window - 0.1), [])
        tracker.observe(topic, seq: 2, now: window - 0.1)
        XCTAssertNil(tracker.nextDeadline)
        XCTAssertEqual(tracker.expired(now: window * 2), [])
    }

    func testAHoleStillOpenAfterTheWindowResyncsOnce() {
        var tracker = TopicSequenceTracker()
        tracker.observe(topic, seq: 1, now: 0)
        tracker.observe(topic, seq: 3, now: 0)
        tracker.observe(topic, seq: 4, now: 0.5)
        XCTAssertEqual(tracker.expired(now: window - 0.1), [])
        XCTAssertEqual(tracker.expired(now: window), [topic])
        XCTAssertEqual(tracker.expired(now: window * 3), [])

        // The resync covers what was skipped, so the next event continues from 4.
        tracker.observe(topic, seq: 5, now: window * 3)
        XCTAssertNil(tracker.nextDeadline)
        XCTAssertEqual(tracker.expired(now: window * 6), [])
    }

    func testTheFirstEventAfterAJoinOnlySetsTheBaseline() {
        var tracker = TopicSequenceTracker()
        tracker.observe(topic, seq: 900, now: 0)
        tracker.reset(topic)
        tracker.observe(topic, seq: 4000, now: 1)
        tracker.observe(topic, seq: 4001, now: 1)
        XCTAssertNil(tracker.nextDeadline)
        XCTAssertEqual(tracker.expired(now: window * 4), [])
    }

    func testAResetCancelsAnOpenHole() {
        var tracker = TopicSequenceTracker()
        tracker.observe(topic, seq: 1, now: 0)
        tracker.observe(topic, seq: 3, now: 0)
        tracker.resetAll()
        XCTAssertNil(tracker.nextDeadline)
        XCTAssertEqual(tracker.expired(now: window * 2), [])
    }

    func testTopicsCountIndependentlyAndAMissingSequenceIsIgnored() {
        var tracker = TopicSequenceTracker()
        tracker.observe("a", seq: 1, now: 0)
        tracker.observe("b", seq: 10, now: 0)
        tracker.observe("a", seq: nil, now: 0)
        tracker.observe("a", seq: 2, now: 0)
        tracker.observe("b", seq: 11, now: 0)
        XCTAssertEqual(tracker.expired(now: window * 2), [])
    }

    func testSequenceNumberReadsOnlyAWholeJSONNumber() {
        XCTAssertEqual(RealtimeClient.sequenceNumber(.object(["seq": .number(7)])), 7)
        XCTAssertNil(RealtimeClient.sequenceNumber(.object(["seq": .string("7")])))
        XCTAssertNil(RealtimeClient.sequenceNumber(.object(["seq": .number(1.5)])))
        XCTAssertNil(RealtimeClient.sequenceNumber(.object([:])))
    }
}
