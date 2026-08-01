import XCTest
@testable import Loonext

/// #186 item 5 — the dialer's live digit→contact correlation. The Android
/// `lookupContact` twin: the typed digits must actually appear in the hit's
/// number (a name-only server match must never mislabel the dial), and a blank
/// name falls back to the formatted number.
final class DialerCorrelationTests: XCTestCase {
    private func contact(id: String, phone: String, name: String?) throws -> Contact {
        let nameField = name.map { "\"name\":\"\($0)\"," } ?? ""
        return try JSONDecoder().decode(
            Contact.self,
            from: Data(
                """
                {"id":"\(id)","phone_e164":"\(phone)",\(nameField)
                 "created_at":"2026-01-01T00:00:00Z",
                 "updated_at":"2026-01-01T00:00:00Z"}
                """.utf8
            )
        )
    }

    func testMatchByDigitSubstringReturnsName() throws {
        let contacts = [
            try contact(id: "a", phone: "+14165550188", name: "Marta Reyes"),
            try contact(id: "b", phone: "+14165550134", name: "Dana Whitcomb"),
        ]
        XCTAssertEqual(dialerContactName(matching: "5550134", in: contacts), "Dana Whitcomb")
    }

    func testTypedFormattingCharactersAreIgnored() throws {
        let contacts = [try contact(id: "b", phone: "+14165550134", name: "Dana Whitcomb")]
        XCTAssertEqual(dialerContactName(matching: "(416) 555-0134", in: contacts), "Dana Whitcomb")
    }

    func testNoDigitMatchReturnsNil() throws {
        // A contact exists but the typed digits are absent from its number — the
        // correlation must stay dark (never light on an unrelated name match).
        let contacts = [try contact(id: "b", phone: "+14165550134", name: "Dana Whitcomb")]
        XCTAssertNil(dialerContactName(matching: "9998887", in: contacts))
    }

    func testBlankNameFallsBackToFormattedNumber() throws {
        let contacts = [try contact(id: "b", phone: "+14165550134", name: "")]
        XCTAssertEqual(
            dialerContactName(matching: "5550134", in: contacts),
            formatPhone("+14165550134")
        )
    }

    func testMissingNameFallsBackToFormattedNumber() throws {
        let contacts = [try contact(id: "b", phone: "+14165550134", name: nil)]
        XCTAssertEqual(
            dialerContactName(matching: "5550134", in: contacts),
            formatPhone("+14165550134")
        )
    }

    func testEmptyTypedReturnsNil() throws {
        let contacts = [try contact(id: "b", phone: "+14165550134", name: "Dana Whitcomb")]
        XCTAssertNil(dialerContactName(matching: "", in: contacts))
    }

    // MARK: - #459, the keypad as a name search
    //
    // The vitest twin of these cases lives in packages/shared/src/dialer.test.ts
    // and the JVM twin in DialerCorrelationTest.kt. All three must agree, or the
    // three clients disagree about who is at the top of the list.

    private func app(_ name: String?, _ number: String, id: String? = "c1") -> DialerCandidate {
        DialerCandidate(name: name, number: number, source: .app, contactId: id)
    }

    private func device(_ name: String?, _ number: String) -> DialerCandidate {
        DialerCandidate(name: name, number: number, source: .device)
    }

    func testT9SpellsNamesTheWayTheKeypadIsPrinted() {
        XCTAssertEqual(t9Words("Bob"), ["262"])
        XCTAssertEqual(t9Words("Dana Whitcomb"), ["3262", "94482662"])
    }

    func testT9SplitsOnAnythingThatIsNotALetterOrDigit() {
        // "O'Brien" and "Smith-Jones" are names people have, and the second
        // part of each has to be reachable.
        XCTAssertEqual(t9Words("O'Brien"), ["6", "27436"])
        XCTAssertEqual(t9Words("Smith-Jones"), ["76484", "56637"])
        XCTAssertEqual(t9Words("A1 Plumbing"), ["21", "75862464"])
    }

    func testFindsAFirstNameFromItsKeypadLetters() {
        // B-O-B is 2-6-2. This is the whole feature in one assertion.
        let ranked = rankDialerCandidates(
            typed: "262", candidates: [app("Bob Vance", "+14165550123")]
        )
        XCTAssertEqual(ranked.first?.name, "Bob Vance")
    }

    func testRanksAFirstWordAboveALaterWord() {
        let first = scoreDialerCandidate(
            typed: "3262", candidate: app("Dana Whitcomb", "+14165550123")
        )
        let later = scoreDialerCandidate(
            typed: "94482662", candidate: app("Dana Whitcomb", "+14165550123")
        )
        XCTAssertGreaterThan(first, later)
        XCTAssertGreaterThan(later, 0)
    }

    func testDoesNotMatchInTheMiddleOfAWord() {
        // "Alaska" contains L-A-S mid-word. A list that returns names nobody
        // typed is one people stop reading.
        XCTAssertEqual(
            scoreDialerCandidate(typed: "527", candidate: app("Alaska Roofing", "+14165550123")),
            0
        )
    }

    func testNeedsTwoDigitsBeforeANameMatches() {
        XCTAssertEqual(
            scoreDialerCandidate(typed: "2", candidate: app("Bob Vance", "+14165550123")), 0
        )
        XCTAssertGreaterThan(
            scoreDialerCandidate(typed: "26", candidate: app("Bob Vance", "+14165550123")), 0
        )
    }

    func testAnExactNumberBeatsANameThatAlsoMatches() {
        let exact = scoreDialerCandidate(
            typed: "4165550123", candidate: app("Zoe", "+14165550123")
        )
        let nameOnly = scoreDialerCandidate(
            typed: "963", candidate: app("Zoe", "+14165559999")
        )
        XCTAssertGreaterThan(exact, nameOnly)
    }

    func testOurBookWinsTheTieNoMatterTheOrderTheyArriveIn() {
        // The regression this exists to stop: collapsing duplicates before
        // sorting keeps whichever row came first, which hands the tie to the
        // device contact whenever it is listed first.
        let ranked = rankDialerCandidates(
            typed: "5550123",
            candidates: [
                device("Dana (roofer)", "+1 416-555-0123"),
                app("Dana Whitcomb", "+14165550123"),
            ]
        )
        XCTAssertEqual(ranked.count, 1)
        XCTAssertEqual(ranked.first?.name, "Dana Whitcomb")
        XCTAssertEqual(ranked.first?.source, .app)
    }

    func testCapsTheListAtFourRows() {
        let many = (0..<20).map { app("Bobby \($0)", "+1416555" + String(1000 + $0), id: "c\($0)") }
        XCTAssertEqual(rankDialerCandidates(typed: "262", candidates: many).count, maxDialerMatches)
    }

    func testDropsACandidateWithNoDialableDigits() {
        XCTAssertTrue(
            rankDialerCandidates(typed: "262", candidates: [app("Bob Vance", "")]).isEmpty
        )
    }

    func testCarriesOurContactIdAndNeverInventsOneForADeviceRow() {
        let ranked = rankDialerCandidates(
            typed: "262",
            candidates: [
                app("Bob Vance", "+14165550123", id: "contact-1"),
                device("Bobbi Sky", "+14165550188"),
            ]
        )
        XCTAssertEqual(ranked.first?.contactId, "contact-1")
        XCTAssertNil(ranked.last?.contactId)
    }
}
