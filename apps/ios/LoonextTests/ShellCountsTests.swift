import XCTest
@testable import Loonext

final class ShellCountsTests: XCTestCase {
    func testRefreshKeepsCountsWhoseReadsFailed() {
        var counts = ShellCounts(forYou: 3, unreadConversations: 7, openTasks: 2)

        counts.apply(forYou: nil, unread: nil, openTasks: 0)

        XCTAssertEqual(counts, ShellCounts(forYou: 3, unreadConversations: 7, openTasks: 0))
    }
}
