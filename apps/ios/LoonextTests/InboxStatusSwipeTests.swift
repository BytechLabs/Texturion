import XCTest

@testable import Loonext

/// #295 — the swipe status change's copy and its undo decision.
///
/// A full swipe closes a conversation and the row leaves the pane, so without an
/// Undo the way back is knowing to switch to the Closed filter and hunt for it.
/// Android has offered that Undo since the swipe shipped; iOS closed silently
/// because its inbox `notify` was a text-only variant that could not carry an
/// action at all. #295 names the scenario exactly: a mis-swipe on a phone, by
/// somebody climbing down a ladder.
///
/// These assertions exist to stop the two clients drifting again. The strings are
/// verbatim from `InboxTab.kt`.
final class InboxStatusSwipeTests: XCTestCase {
    func testClosingIsDetectedFromTheTargetStatus() {
        XCTAssertTrue(InboxStatusSwipe.isClosing(to: ConversationStatus.closed))
        XCTAssertFalse(InboxStatusSwipe.isClosing(to: ConversationStatus.open))
    }

    func testCopyMatchesTheAndroidTwinVerbatim() {
        XCTAssertEqual(
            InboxStatusSwipe.notice(to: ConversationStatus.closed),
            "Conversation closed"
        )
        XCTAssertEqual(
            InboxStatusSwipe.notice(to: ConversationStatus.open),
            "Conversation reopened"
        )
    }

    func testUndoIsOfferedOnlyWhenClosing() {
        // The asymmetry is deliberate and matches Android: closing removes the
        // row from view, reopening puts it in front of you where the swipe that
        // changed it is still right there.
        XCTAssertEqual(
            InboxStatusSwipe.undoTarget(
                to: ConversationStatus.closed,
                from: ConversationStatus.open
            ),
            ConversationStatus.open
        )
        XCTAssertNil(
            InboxStatusSwipe.undoTarget(
                to: ConversationStatus.open,
                from: ConversationStatus.closed
            )
        )
    }

    func testUndoRestoresTheActualPriorStatus() {
        // #295: full prior state, not just the primary field. A conversation
        // swiped away while it was new or waiting must not come back as open —
        // that silently loses the fact that nobody had replied yet.
        for previous in [
            ConversationStatus.new,
            ConversationStatus.open,
            ConversationStatus.waiting,
        ] {
            XCTAssertEqual(
                InboxStatusSwipe.undoTarget(to: ConversationStatus.closed, from: previous),
                previous
            )
        }
    }

    func testUndoTargetIsNeverTheStatusJustSet() {
        // An Undo that re-applies what just happened is worse than no Undo: it
        // looks like it worked and changes nothing.
        XCTAssertNil(
            InboxStatusSwipe.undoTarget(
                to: ConversationStatus.closed,
                from: ConversationStatus.closed
            )
        )
    }
}
