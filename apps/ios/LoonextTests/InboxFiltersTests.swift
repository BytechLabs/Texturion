import XCTest
@testable import Loonext

/// #548 — which dimensions the inbox is arranged by, and that this phone agrees
/// with the laptop and with Android about it.
///
/// Two halves. The behaviour tests assert the rule; the parity tests read
/// `packages/shared/src/inbox-filters.ts`, because this is a hand-port and nothing
/// about Swift says the original stayed put.
///
/// The bug this file exists for: the predicate lived here as `hasFilterChips` and
/// excluded the status segment. On Android that made a Reset button do nothing. On
/// iOS there was no reset at all, so it showed up as an empty state blaming filters
/// nobody could see — and as no way to get back to an unfiltered list.
final class InboxFiltersTests: XCTestCase {

    private func home(
        segment: String? = nil,
        assignedToMe: Bool = false,
        assigneeUserId: String? = nil,
        tagId: String? = nil,
        unreadOnly: Bool = false,
        spamOnly: Bool = false,
        snoozedOnly: Bool = false,
        awaitingOnly: Bool = false
    ) -> InboxFilterState {
        InboxFilterState(
            segment: segment,
            assignedToMe: assignedToMe,
            assigneeUserId: assigneeUserId,
            tagId: tagId,
            unreadOnly: unreadOnly,
            spamOnly: spamOnly,
            snoozedOnly: snoozedOnly,
            awaitingOnly: awaitingOnly
        )
    }

    func testNothingIsFilteredOnTheHomeView() {
        XCTAssertFalse(isInboxFiltered(home()))
        XCTAssertEqual(activeInboxFilters(home()), [])
    }

    func testTheStatusSegmentCountsWhichIsTheWholeBug() {
        XCTAssertTrue(isInboxFiltered(home(segment: "closed")))
        XCTAssertEqual(activeInboxFilters(home(segment: "closed")), [.segment])
    }

    func testAssignedToMeCountsUnderAssigneeRatherThanSegment() {
        let mine = home(assignedToMe: true)
        XCTAssertTrue(isInboxFiltered(mine))
        XCTAssertEqual(activeInboxFilters(mine), [.assignee])
    }

    func testAssignedToMeAndNamedAssigneeCountOnceUnderAssignee() {
        XCTAssertEqual(
            activeInboxFilters(home(assignedToMe: true, assigneeUserId: "u-2")),
            [.assignee]
        )
    }

    func testEachChipCountsOnItsOwn() {
        XCTAssertEqual(activeInboxFilters(home(assigneeUserId: "u-2")), [.assignee])
        XCTAssertEqual(activeInboxFilters(home(tagId: "t-1")), [.tag])
        XCTAssertEqual(activeInboxFilters(home(unreadOnly: true)), [.unread])
        XCTAssertEqual(activeInboxFilters(home(spamOnly: true)), [.spam])
        XCTAssertEqual(activeInboxFilters(home(snoozedOnly: true)), [.snoozed])
        XCTAssertEqual(activeInboxFilters(home(awaitingOnly: true)), [.awaiting])
    }

    func testUnassignedAndLineCountAlongsideOtherFilters() {
        var filtered = home(unreadOnly: true)
        filtered.unassignedOnly = true
        filtered.lineId = "line-1"
        XCTAssertEqual(activeInboxFilters(filtered), [.assignee, .line, .unread])
        filtered.assignedToMe = true
        XCTAssertEqual(activeInboxFilters(filtered), [.assignee, .line, .unread])
    }

    func testEverythingAtOnceInTheDeclaredOrder() {
        XCTAssertEqual(
            activeInboxFilters(
                home(
                    segment: "all",
                    assigneeUserId: "u-2",
                    tagId: "t-1",
                    unreadOnly: true,
                    spamOnly: true,
                    snoozedOnly: true,
                    awaitingOnly: true
                )
            ),
            [.segment, .assignee, .tag, .unread, .spam, .snoozed, .awaiting]
        )
    }

    func testTheSegmentAloneIsNotASecondaryFilter() {
        XCTAssertFalse(hasSecondaryInboxFilters(home(segment: "closed")))
        XCTAssertTrue(hasSecondaryInboxFilters(home(assignedToMe: true)))
        XCTAssertTrue(hasSecondaryInboxFilters(home(segment: "closed", tagId: "t-1")))
    }

    func testSecondaryFiltersAlwaysImplySomethingIsFiltered() {
        // The property that makes one list better than two predicates.
        for state in [
            home(),
            home(segment: "closed"),
            home(unreadOnly: true),
            home(assignedToMe: true, assigneeUserId: "u-2"),
            home(segment: "all", tagId: "t-1", spamOnly: true),
        ] {
            if hasSecondaryInboxFilters(state) {
                XCTAssertTrue(isInboxFiltered(state))
            }
        }
    }

    // MARK: - Against the original

    private func repoPath(_ relative: String) throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        XCTFail("\(relative) is not reachable from \(#filePath)")
        throw CocoaError(.fileNoSuchFile)
    }

    private func sharedSource() throws -> String {
        try String(
            contentsOf: try repoPath("packages/shared/src/inbox-filters.ts"),
            encoding: .utf8
        )
    }

    /// The same dimensions, in the same order, as the shared module.
    ///
    /// Order is asserted rather than membership alone: `activeInboxFilters` returns
    /// a list, so a client rendering "arranged by" chips from it would show them in
    /// a different order from the laptop if the two drifted.
    func testTheDimensionsMatchTheSharedModuleInOrder() throws {
        let shared = try sharedSource()
        guard let start = shared.range(of: "INBOX_FILTER_DIMENSIONS = ["),
              let end = shared[start.upperBound...].firstIndex(of: "]")
        else {
            return XCTFail("INBOX_FILTER_DIMENSIONS is no longer an array literal")
        }
        let names = shared[start.upperBound ..< end]
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"\n\r\t")) }
            .filter { !$0.isEmpty }
        XCTAssertEqual(names, InboxFilterDimension.allCases.map(\.rawValue))
    }

    func testTheSharedModuleCountsAssignedToMeUnderAssignee() throws {
        XCTAssertTrue(
            try sharedSource()
                .contains("state.assignedToMe || state.assigneeUserId !== null || state.unassignedOnly"),
            "shared inbox-filters.ts no longer counts assignedToMe under assignee"
        )
    }
}
