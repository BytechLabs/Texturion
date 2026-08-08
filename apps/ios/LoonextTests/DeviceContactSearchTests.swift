import XCTest
@testable import Loonext

/// #459 — searching the phone's own address book.
///
/// The vitest twin lives in packages/shared/src/device-contacts.test.ts and the
/// JVM twin in DeviceContactSearchTest.kt. All three must agree, or the same
/// query finds different people on different phones.
final class DeviceContactSearchTests: XCTestCase {

    private func row(_ name: String, _ number: String = "+14165550123") -> DeviceContactListRow {
        DeviceContactListRow(id: name, name: name, number: number)
    }

    func testShowsEverythingForAnEmptyQuery() {
        XCTAssertTrue(deviceContactMatches(row("Dana Smith"), query: ""))
        XCTAssertTrue(deviceContactMatches(row("Dana Smith"), query: "   "))
    }

    func testMatchesAFirstNameCaseInsensitively() {
        XCTAssertTrue(deviceContactMatches(row("Dana Smith"), query: "dan"))
        XCTAssertTrue(deviceContactMatches(row("Dana Smith"), query: "DAN"))
    }

    func testMatchesASurnameBecauseThatIsHowPeopleAreFound() {
        XCTAssertTrue(deviceContactMatches(row("Dana Smith"), query: "smi"))
        XCTAssertTrue(deviceContactMatches(row("Alaska Roofing"), query: "roof"))
    }

    func testDoesNotMatchMidWord() {
        // "Kasm" contains "sm". A list that returns names nobody typed is one
        // people stop reading.
        XCTAssertFalse(deviceContactMatches(row("Kasm Roofing"), query: "sm"))
    }

    func testTreatsPunctuationAsAWordBreak() {
        XCTAssertTrue(deviceContactMatches(row("Smith-Jones"), query: "jones"))
        XCTAssertTrue(deviceContactMatches(row("O'Brien"), query: "brien"))
    }

    func testAWholeNameQueryDoesNotTrapOnTheRange() {
        // The crash this exists to stop: when the name is EXACTLY as long as
        // the query, `1...0` is not an empty range in Swift, it is a runtime
        // trap. Searching "dana" for a contact named "Dana" would take the
        // Contacts tab down.
        XCTAssertTrue(deviceContactMatches(row("Dana"), query: "dana"))
        XCTAssertFalse(deviceContactMatches(row("Dana"), query: "zzzz"))
    }

    func testReadsADigitsOnlyQueryAsANumberSearchNeverANameOne() {
        // A number with no "1" anywhere in it, so the only way "1" could match
        // is through the name.
        XCTAssertFalse(deviceContactMatches(row("A1 Plumbing", "+14045550999"), query: "1"))
        XCTAssertTrue(deviceContactMatches(row("A1 Plumbing", "+14045550999"), query: "5550"))
    }

    func testMatchesANumberHoweverItWasWrittenDown() {
        XCTAssertTrue(deviceContactMatches(row("Dana", "+14165550123"), query: "5550123"))
        XCTAssertTrue(deviceContactMatches(row("Dana", "(416) 555-0123"), query: "4165550123"))
    }

    func testReturnsEveryMatchHoweverManyThereAre() {
        // #547: there was a cap at fifty here, so "Show all from this phone"
        // showed fifty and then apologised for it. Somebody with a
        // four-hundred-entry address book could not reach most of it.
        let many = (0..<400).map {
            DeviceContactListRow(
                id: "id-\($0)", name: "Person \($0)", number: "+1416555\(1000 + $0)"
            )
        }
        XCTAssertEqual(filterDeviceContacts(many, query: "").count, 400)
    }

    func testStillFiltersRatherThanReturningEverythingRegardless() {
        // The positive twin: a function that ignored the query would also pass
        // the test above.
        let rows = [row("Dana Smith"), row("Alaska Roofing")]
        XCTAssertEqual(filterDeviceContacts(rows, query: "dana").map(\.name), ["Dana Smith"])
    }

    func testReturnsNothingWhenNothingMatches() {
        XCTAssertTrue(filterDeviceContacts([row("Dana Smith")], query: "zzz").isEmpty)
    }
}
