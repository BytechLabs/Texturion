import XCTest

@testable import Loonext

/// #280 — the Swift half of a contract four things share.
///
/// `packages/shared/src/saved-views.ts` decides what a view may hold. This is a
/// HAND PORT of that decision, and the failure mode is not a crash: it is a view
/// that saves on the phone and opens something else on the web.
///
/// Every case asserts a POSITIVE as well as a refusal, deliberately. A port that
/// rejects everything passes a suite made only of refusals, and that is the
/// shape a broken shape-check or an inverted condition actually takes.
final class SavedViewsPortTests: XCTestCase {

    private let id = "11111111-2222-4333-8444-555555555555"
    private let tag = "22222222-3333-4444-8555-666666666666"
    private let me = "aaaaaaaa-1111-4222-8333-444444444444"

    func testKeepsEveryFilterTheEndpointUnderstands() {
        // The positive case for each key. Without these, a shape-check that
        // matched nothing would pass everything below.
        let clean = sanitizeConversationFilters([
            "status": .string("open"),
            "assigned_user_id": .string(id),
            "tag_id": .string(tag),
            "unread": .bool(true),
            "is_spam": .bool(true),
            "snoozed": .string("only"),
            "pinned": .string("exclude"),
        ])
        XCTAssertEqual(clean.count, 7)
        XCTAssertEqual(clean["status"], .string("open"))
        XCTAssertEqual(clean["assigned_user_id"], .string(id))
    }

    func testDropsAnUnknownKeyInsteadOfFailingTheRead() {
        // A view written before a filter was renamed must still open. A refusal
        // here is a dead screen the person cannot repair.
        let clean = sanitizeConversationFilters([
            "status": .string("open"),
            "colour": .string("red"),
        ])
        XCTAssertEqual(clean.count, 1)
        XCTAssertNotNil(clean["status"])
    }

    func testDropsAKnownKeyHoldingAValueTheEndpointWouldReject() {
        XCTAssertTrue(sanitizeConversationFilters(["status": .string("archived")]).isEmpty)
        XCTAssertTrue(sanitizeConversationFilters(["assigned_user_id": .string("me")]).isEmpty)
        // A quoted "true" is not a boolean. JSON is where three languages
        // disagree most, so each port has to make this distinction itself.
        XCTAssertTrue(sanitizeConversationFilters(["unread": .string("true")]).isEmpty)
    }

    func testRefusesCursorsAndSearchText() {
        // A cursor is a position in one result set; a search is a question asked
        // once. Saving either would make a shared view mean something else.
        XCTAssertTrue(
            sanitizeConversationFilters([
                "cursor": .string("abc"),
                "q": .string("boiler"),
            ]).isEmpty
        )
    }

    func testNeverStoresBothAssigneeFilters() {
        let clean = sanitizeConversationFilters([
            "assigned_to_me": .bool(true),
            "assigned_user_id": .string(id),
        ])
        XCTAssertEqual(clean.count, 1)
        XCTAssertEqual(clean["assigned_to_me"], .bool(true))
    }

    func testDropsAFalseAssignedToMeRatherThanStoringANoOp() {
        let clean = sanitizeConversationFilters([
            "assigned_to_me": .bool(false),
            "assigned_user_id": .string(id),
        ])
        XCTAssertEqual(clean.count, 1)
        XCTAssertEqual(clean["assigned_user_id"], .string(id))
    }

    func testResolvesMineToWhoeverIsAsking() {
        XCTAssertEqual(resolveAssignee(["assigned_to_me": .bool(true)], viewerUserId: me), me)
        XCTAssertEqual(resolveAssignee(["assigned_user_id": .string(id)], viewerUserId: me), id)
        XCTAssertNil(resolveAssignee(["status": .string("open")], viewerUserId: me))
    }

    func testUUIDShapeCheck() {
        // Written as a character walk rather than a regex, so this is where the
        // walk gets proven. An empty string is the case that would crash a
        // careless index-arithmetic version.
        XCTAssertTrue(isSavedViewUUID(id))
        XCTAssertFalse(isSavedViewUUID(""))
        XCTAssertFalse(isSavedViewUUID("not-a-uuid"))
        XCTAssertFalse(isSavedViewUUID("11111111-2222-4333-8444-55555555555"))
        XCTAssertFalse(isSavedViewUUID("g1111111-2222-4333-8444-555555555555"))
    }

    func testRoundTripsTheInboxControlsThroughAStoredView() {
        let selection = ViewSelection(
            tab: .open,
            assigneeUserId: id,
            tagId: tag,
            unreadOnly: true,
            spamOnly: false,
            snoozedOnly: true,
            awaitingOnly: true
        )
        XCTAssertEqual(viewToSelection(selectionToView(selection)), selection)
    }

    func testMineIsATabNotAnAssigneeChip() {
        // The tab and the assignee are entangled the same way on web and
        // Android. A view holding assigned_to_me must select the tab, or it
        // would set a chip the person cannot see while the list stays filtered.
        let selection = viewToSelection(["assigned_to_me": .bool(true)])
        XCTAssertEqual(selection.tab, .mine)
        XCTAssertNil(selection.assigneeUserId)
    }

    func testMatchesTheArrangementCurrentlyOnScreen() {
        let filters: [String: JSONValue] = ["status": .string("open"), "unread": .bool(true)]
        let selection = viewToSelection(filters)
        XCTAssertTrue(viewMatchesSelection(filters, selection))
        XCTAssertFalse(viewMatchesSelection(["status": .string("open")], selection))
    }

    func testCountsStopAtTheCeiling() {
        XCTAssertEqual(formatViewCount(0), "0")
        XCTAssertEqual(formatViewCount(SavedViewLimits.countCeiling), "99")
        XCTAssertEqual(formatViewCount(SavedViewLimits.countCeiling + 1), "99+")
        XCTAssertEqual(formatViewCount(50_000), "99+")
    }

    func testSuggestsANameFromWhatIsFilteredAndNothingForTheWholeInbox() {
        let filtered = ViewSelection(
            tab: .open,
            assigneeUserId: nil,
            tagId: nil,
            unreadOnly: true,
            spamOnly: false,
            snoozedOnly: false,
            awaitingOnly: false
        )
        XCTAssertEqual(suggestViewName(filtered), "Open · Unread")
        // Law 6: no em or en dash in rendered copy.
        XCTAssertFalse(suggestViewName(filtered).contains("—"))
        XCTAssertFalse(suggestViewName(filtered).contains("–"))

        var unfiltered = filtered
        unfiltered.tab = .all
        unfiltered.unreadOnly = false
        XCTAssertEqual(suggestViewName(unfiltered), "")
    }
}
