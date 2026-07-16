import XCTest
@testable import Loonext

/// Compose-side NANP vectors ported 1:1 from the Android
/// features.compose.NanpTest: entry normalization/formatting plus the
/// destination country/local-time metadata the new-conversation flow shows.
/// (The strict lookupAreaCode/normalize vectors live in ContactsNanpTests,
/// mirroring the Android features.contacts.NanpTest.)
final class MessagingNanpTests: XCTestCase {
    func testNationalDigitsStripsFormattingAndOneLeadingCountryCode() {
        XCTAssertEqual(Nanp.nationalDigits("+1 (415) 555-0134"), "4155550134")
        XCTAssertEqual(Nanp.nationalDigits("415.555.0134"), "4155550134")
        XCTAssertEqual(Nanp.nationalDigits("14155550134"), "4155550134")
        XCTAssertEqual(Nanp.nationalDigits("abc"), "")
    }

    func testFormatAsYouTypeIsProgressive() {
        XCTAssertEqual(Nanp.formatAsYouType(""), "")
        XCTAssertEqual(Nanp.formatAsYouType("4"), "(4")
        XCTAssertEqual(Nanp.formatAsYouType("415"), "(415")
        XCTAssertEqual(Nanp.formatAsYouType("41555"), "(415) 55")
        XCTAssertEqual(Nanp.formatAsYouType("4155550134"), "(415) 555-0134")
    }

    func testToE164NeedsACompleteTenDigitNationalNumber() {
        XCTAssertEqual(Nanp.toE164("(415) 555-0134"), "+14155550134")
        XCTAssertNil(Nanp.toE164("415555013"))
    }

    func testUsAndCaAreaCodesResolveWithCountries() {
        XCTAssertEqual(Nanp.destinationCountry("+14155550134"), "US")
        XCTAssertEqual(Nanp.destinationCountry("+16045550134"), "CA")
        XCTAssertTrue(Nanp.isUsCaDestination("+14155550134"))
    }

    func testNonNanpAndUnassignedCodesAreRejected() {
        XCTAssertFalse(Nanp.isUsCaDestination("+442071234567"))
        XCTAssertFalse(Nanp.isUsCaDestination("+18005550134")) // toll-free absent by design
        XCTAssertFalse(Nanp.isUsCaDestination("+11115550134")) // invalid NPA shape
    }

    func testDestinationLocalTimeUsesTheAreaCodesPrimaryZone() {
        let at = parseWireTimestamp("2026-07-15T00:00:00Z") ?? Date()
        // 415 = America/Los_Angeles = UTC-7 in July.
        XCTAssertEqual(Nanp.destinationLocalTime("+14155550134", at: at)?.hour, 17)
        // Non-geographic 521 has no zone -> no hint.
        XCTAssertNil(Nanp.destinationLocalTime("+15215550134", at: at))
    }

    /// Guards the split-table design (contacts owns the key set, compose owns
    /// the metadata): the two must cover exactly the same area codes, or
    /// destinationCountry would silently disagree with isUsCaDestination.
    func testMetadataKeySetMatchesTheContactsAreaCodeTable() {
        XCTAssertEqual(Set(Nanp.areaCodeMetadata.keys), Nanp.areaCodes)
    }
}
