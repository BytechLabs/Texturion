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
}
