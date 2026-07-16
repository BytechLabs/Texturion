import XCTest
@testable import Loonext

/// D24 watermark semantics: one per-user/per-company last-seen timestamp;
/// unread iff created_at > watermark; the watermark only moves forward.
final class WatermarkTests: XCTestCase {
    private func item(_ id: String, createdAt: String, unread: Bool = true) -> NotificationItem {
        NotificationItem(
            id: id,
            type: NotificationType.inboundMessage,
            conversation_id: nil,
            message_id: nil,
            task_id: nil,
            contact: nil,
            created_at: createdAt,
            unread: unread
        )
    }

    // MARK: applyWatermark

    func testFlipsOlderAndEqualKeepsNewer() {
        let items = [
            item("newer", createdAt: "2026-07-15T12:00:01Z"),
            item("equal", createdAt: "2026-07-15T12:00:00Z"),
            item("older", createdAt: "2026-07-15T11:59:59Z"),
        ]
        let applied = applyWatermark(items: items, lastSeenAt: "2026-07-15T12:00:00Z")
        XCTAssertTrue(applied[0].unread) // strictly newer stays unread
        XCTAssertFalse(applied[1].unread) // equal flips read
        XCTAssertFalse(applied[2].unread) // older flips read
    }

    func testAcceptsOffsetAndZuluForms() {
        // Postgres emits +00:00, JS toISOString emits Z — same instant.
        let items = [item("a", createdAt: "2026-07-15T11:00:00+00:00")]
        let applied = applyWatermark(items: items, lastSeenAt: "2026-07-15T12:00:00Z")
        XCTAssertFalse(applied[0].unread)
    }

    func testRespectsNonUtcOffsets() {
        // 07:00-04:00 == 11:00Z: at the watermark, so read.
        let items = [item("eastern", createdAt: "2026-07-15T07:00:00-04:00")]
        let applied = applyWatermark(items: items, lastSeenAt: "2026-07-15T11:00:00Z")
        XCTAssertFalse(applied[0].unread)
    }

    func testUnparseableItemTimestampIsLeftAlone() {
        let items = [item("odd", createdAt: "not-a-date")]
        let applied = applyWatermark(items: items, lastSeenAt: "2026-07-15T12:00:00Z")
        XCTAssertTrue(applied[0].unread) // never guess read state
    }

    func testUnparseableWatermarkIsANoOp() {
        let items = [item("a", createdAt: "2026-07-15T11:00:00Z")]
        let applied = applyWatermark(items: items, lastSeenAt: "garbage")
        XCTAssertTrue(applied[0].unread)
    }

    func testAlreadyReadStaysRead() {
        let items = [item("read", createdAt: "2026-07-15T13:00:00Z", unread: false)]
        let applied = applyWatermark(items: items, lastSeenAt: "2026-07-15T12:00:00Z")
        XCTAssertFalse(applied[0].unread)
    }

    // MARK: advanceWatermark

    func testAdvanceIsForwardOnly() {
        XCTAssertEqual(
            advanceWatermark(current: "2026-07-15T12:00:00Z", candidate: "2026-07-15T13:00:00Z"),
            "2026-07-15T13:00:00Z"
        )
        // A backwards candidate never wins — the RPC keeps the greatest.
        XCTAssertEqual(
            advanceWatermark(current: "2026-07-15T12:00:00Z", candidate: "2026-07-15T11:00:00Z"),
            "2026-07-15T12:00:00Z"
        )
        // Equal keeps current.
        XCTAssertEqual(
            advanceWatermark(current: "2026-07-15T12:00:00Z", candidate: "2026-07-15T12:00:00+00:00"),
            "2026-07-15T12:00:00Z"
        )
    }

    func testAdvanceFromNilOrUnparseableCurrentTakesCandidate() {
        XCTAssertEqual(
            advanceWatermark(current: nil, candidate: "2026-07-15T12:00:00Z"),
            "2026-07-15T12:00:00Z"
        )
        XCTAssertEqual(
            advanceWatermark(current: "garbage", candidate: "2026-07-15T12:00:00Z"),
            "2026-07-15T12:00:00Z"
        )
    }

    func testAdvanceUnparseableCandidateKeepsCurrent() {
        XCTAssertEqual(
            advanceWatermark(current: "2026-07-15T12:00:00Z", candidate: "garbage"),
            "2026-07-15T12:00:00Z"
        )
    }

    func testEqualOffsetAndZuluWatermarksDoNotRegressEachOther() {
        // Same instant spelled two ways — either spelling is an acceptable
        // "kept" value; the instant must not move.
        let kept = advanceWatermark(
            current: "2026-07-15T12:00:00+00:00",
            candidate: "2026-07-15T12:00:00Z"
        )
        XCTAssertEqual(
            parseWireTimestamp(kept),
            parseWireTimestamp("2026-07-15T12:00:00Z")
        )
    }
}
