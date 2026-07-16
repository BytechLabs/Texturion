import XCTest
@testable import Loonext

/// Cursor-append and page-1-merge reducers (SPEC §7 keyset pagination) —
/// scenarios ported from the Android PagingTest.kt so the two clients keep
/// identical list semantics under scroll, realtime re-sort, and filters.
final class MessagingPagingTests: XCTestCase {
    private struct Row {
        let id: String
        let at: String
    }

    private func row(_ id: String, _ at: String) -> Row {
        Row(id: id, at: at)
    }

    // MARK: - appendPage

    func testAppendPageAddsOlderRowsAfterExisting() {
        let existing = [row("c", "3"), row("b", "2")]
        let page = [row("a", "1")]
        XCTAssertEqual(
            appendPage(existing, page) { $0.id }.map(\.id),
            ["c", "b", "a"]
        )
    }

    func testAppendPageDropsOverlapRowsAlreadyPresent() {
        let existing = [row("c", "3"), row("b", "2")]
        let page = [row("b", "2"), row("a", "1")]
        XCTAssertEqual(
            appendPage(existing, page) { $0.id }.map(\.id),
            ["c", "b", "a"]
        )
    }

    func testAppendPageWithAnEmptyPageReturnsExistingUnchanged() {
        let existing = [row("a", "1")]
        let appended = appendPage(existing, []) { $0.id }
        XCTAssertEqual(appended.map(\.id), ["a"])
        XCTAssertEqual(appended.map(\.at), ["1"])
    }

    // MARK: - mergeFirstPage

    func testMergeFirstPageReplacesStaleCopiesAndResortsDesc() {
        let existing = [row("b", "2"), row("a", "1")]
        // Row "a" got a new message and floats to the top.
        let fresh = [row("a", "5"), row("b", "2")]
        let merged = mergeFirstPage(existing, fresh, idOf: { $0.id }, sortKey: { $0.at })
        XCTAssertEqual(merged.map(\.id), ["a", "b"])
        XCTAssertEqual(merged.first?.at, "5")
    }

    func testMergeFirstPageKeepsDeeperPagesThatFellOutOfTheFreshWindow() {
        let existing = [row("c", "3"), row("b", "2"), row("a", "1")]
        let fresh = [row("d", "4"), row("c", "3")]
        let merged = mergeFirstPage(existing, fresh, idOf: { $0.id }, sortKey: { $0.at })
        XCTAssertEqual(merged.map(\.id), ["d", "c", "b", "a"])
    }

    func testMergeFirstPageTiebreaksEqualSortKeysByIdDesc() {
        let merged = mergeFirstPage(
            [row("a", "1")],
            [row("b", "1")],
            idOf: { $0.id },
            sortKey: { $0.at }
        )
        XCTAssertEqual(merged.map(\.id), ["b", "a"])
    }

    // MARK: - dropVanishedFromFirstWindow

    func testDropVanishedKeepsRowsOlderThanTheFreshWindow() {
        let merged = [row("d", "4"), row("c", "3"), row("a", "1")]
        let kept = dropVanishedFromFirstWindow(
            merged: merged,
            freshFirstPageIds: ["d", "c"],
            oldestFreshSortKey: "3",
            idOf: { $0.id },
            sortKey: { $0.at }
        )
        XCTAssertEqual(kept.map(\.id), ["d", "c", "a"])
    }

    func testDropVanishedRemovesARowInsideTheFreshWindowThatVanished() {
        // "b" (at=3.5) sorts inside the fresh window but is not in it — it no
        // longer matches the filter (e.g. closed elsewhere) and must go.
        let merged = [row("d", "4"), row("b", "3.5"), row("c", "3"), row("a", "1")]
        let kept = dropVanishedFromFirstWindow(
            merged: merged,
            freshFirstPageIds: ["d", "c"],
            oldestFreshSortKey: "3",
            idOf: { $0.id },
            sortKey: { $0.at }
        )
        XCTAssertEqual(kept.map(\.id), ["d", "c", "a"])
    }

    func testDropVanishedWithANilOldestKeyKeepsOnlyTheFreshPage() {
        let merged = [row("d", "4"), row("a", "1")]
        let kept = dropVanishedFromFirstWindow(
            merged: merged,
            freshFirstPageIds: ["d"],
            oldestFreshSortKey: nil,
            idOf: { $0.id },
            sortKey: { $0.at }
        )
        XCTAssertEqual(kept.map(\.id), ["d"])
    }
}
