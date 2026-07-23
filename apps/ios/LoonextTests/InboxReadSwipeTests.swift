import XCTest
@testable import Loonext

/// The inbox leading read/unread swipe target — the Android InboxTab
/// toggleRead semantics, pinned so both clients read identically: an unread
/// row marks read (POST /read), a read row marks unread (DELETE /read), and
/// the button title/symbol track the row's current state.
final class InboxReadSwipeTests: XCTestCase {
    func testUnreadRowMarksReadWithOpenEnvelope() {
        XCTAssertTrue(InboxReadSwipe.marksRead(unread: true))
        XCTAssertEqual("Read", InboxReadSwipe.title(unread: true))
        XCTAssertEqual("envelope.open", InboxReadSwipe.symbol(unread: true))
    }

    func testReadRowMarksUnreadWithBadgeEnvelope() {
        XCTAssertFalse(InboxReadSwipe.marksRead(unread: false))
        XCTAssertEqual("Unread", InboxReadSwipe.title(unread: false))
        XCTAssertEqual("envelope.badge", InboxReadSwipe.symbol(unread: false))
    }
}
