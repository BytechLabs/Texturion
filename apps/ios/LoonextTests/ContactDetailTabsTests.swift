import XCTest
@testable import Loonext

/// #740: the contact screen is a header and a segmented control. A tab shows one list;
/// empty detail fields sit behind "Add details"; every section stays one or two taps
/// away. Ported from the Android `ContactDetailTabsTest` and the web `contact-tabs.ts`.
final class ContactDetailTabsTests: XCTestCase {
    private func empty(
        business: String? = nil,
        address: String? = nil,
        hasAddresses: Bool = false,
        email: String? = nil,
        notes: String? = nil
    ) -> [ContactDetailField] {
        emptyContactDetailFields(
            business: business,
            address: address,
            hasAddresses: hasAddresses,
            email: email,
            notes: notes
        )
    }

    func testATabPutsExactlyOneListOnScreen() {
        for pane in ContactActivityPane.allCases {
            XCTAssertEqual(contactBlockOnScreen(tab: .details, pane: pane), .details)
            XCTAssertEqual(contactBlockOnScreen(tab: .files, pane: pane), .files)
        }
        XCTAssertEqual(contactBlockOnScreen(tab: .activity, pane: .calls), .calls)
    }

    func testEverySectionIsReachableFromSomeTab() {
        var reachable = Set<ContactBlock>()
        for tab in ContactTab.allCases {
            for pane in ContactActivityPane.allCases {
                reachable.insert(contactBlockOnScreen(tab: tab, pane: pane))
            }
        }
        XCTAssertEqual(reachable, Set(ContactBlock.allCases))
    }

    func testEmptyDetailFieldsAreHiddenUntilAddDetails() {
        let none = empty()
        XCTAssertEqual(none, ContactDetailField.allCases)
        XCTAssertEqual(
            hiddenContactDetailFields(initiallyEmpty: none, emptyNow: none, adding: false),
            Set(ContactDetailField.allCases)
        )
        XCTAssertTrue(
            hiddenContactDetailFields(initiallyEmpty: none, emptyNow: none, adding: true).isEmpty
        )
    }

    func testFilledFieldsAreNeverHidden() {
        let filled = empty(
            business: "Maple Property Group",
            address: "12 Elm St",
            email: "dana@example.com",
            notes: "Gate code 4411"
        )
        XCTAssertTrue(filled.isEmpty)
        XCTAssertEqual(
            empty(business: "x", address: "x", email: "  ", notes: "x"),
            [.email]
        )
        // Extra addresses count as a filled address field.
        XCTAssertFalse(empty(hasAddresses: true).contains(.address))
    }

    func testAFieldClearedWhileTypingStaysOnScreen() {
        let initiallyEmpty = empty(notes: "x")
        let emptyNow = empty()
        XCTAssertFalse(
            hiddenContactDetailFields(initiallyEmpty: initiallyEmpty, emptyNow: emptyNow, adding: false)
                .contains(.notes)
        )
    }

    func testAFieldSomebodyElseFillsInAppears() {
        let initiallyEmpty = empty()
        let emptyNow = empty(email: "dana@example.com")
        XCTAssertFalse(
            hiddenContactDetailFields(initiallyEmpty: initiallyEmpty, emptyNow: emptyNow, adding: false)
                .contains(.email)
        )
    }

    func testLongListsAreCappedUntilShowAll() {
        let rows = Array(1...12)
        XCTAssertEqual(cappedContactRows(rows, showAll: false).count, contactListCap)
        XCTAssertEqual(cappedContactRows(rows, showAll: true).count, 12)
        XCTAssertEqual(cappedContactRows([1, 2, 3], showAll: false).count, 3)
    }
}
