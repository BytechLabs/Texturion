import XCTest
@testable import Loonext

/// Vectors ported from packages/shared/src/nanp.test.ts via the Android
/// NanpTest (the Swift port keeps only the key set — region/timezone
/// assertions stay TypeScript-side), plus the normalize/format helpers.
final class ContactsNanpTests: XCTestCase {
    // MARK: the area-code table

    func testTableCarriesEveryInServiceUsCaCodeFromTheNanpaReport() {
        XCTAssertEqual(Nanp.areaCodes.count, 446)
    }

    func testEveryCodeIsAValidNxxAreaCode() {
        for code in Nanp.areaCodes {
            XCTAssertEqual(code.count, 3, "bad code \(code)")
            XCTAssertTrue(
                code.allSatisfy { $0.isASCII && $0.isNumber },
                "bad code \(code)"
            )
            XCTAssertTrue(
                ("2" ... "9").contains(String(code.prefix(1))),
                "bad code \(code)"
            )
        }
    }

    func testExcludesCaribbeanNanpAndNanpWideSharedServiceCodes() {
        for code in [
            "242", "264", "809", "829", "876", "658", // Caribbean
            "800", "833", "888", "900", "500", "700", // service codes
        ] {
            XCTAssertFalse(Nanp.areaCodes.contains(code), "\(code) must be absent")
        }
    }

    // MARK: lookupAreaCode

    func testResolvesCanadianAndUsCodes() {
        XCTAssertEqual(Nanp.lookupAreaCode("+14165550123"), "416")
        XCTAssertEqual(Nanp.lookupAreaCode("+16045550123"), "604")
        XCTAssertEqual(Nanp.lookupAreaCode("+19025550123"), "902")
        XCTAssertEqual(Nanp.lookupAreaCode("+12125550123"), "212")
        XCTAssertEqual(Nanp.lookupAreaCode("+13055550123"), "305")
        XCTAssertEqual(Nanp.lookupAreaCode("+19075550123"), "907")
        XCTAssertEqual(Nanp.lookupAreaCode("+18085550123"), "808")
    }

    func testResolvesUsCaNonGeographicCodesToo() {
        XCTAssertEqual(Nanp.lookupAreaCode("+17105550123"), "710") // US federal
        XCTAssertEqual(Nanp.lookupAreaCode("+16005550123"), "600") // CA non-geo
    }

    func testNilForJamaicaCaribbeanNanpIsNotUsCa() {
        XCTAssertNil(Nanp.lookupAreaCode("+18765550123"))
    }

    func testNilForUnassigned555() {
        XCTAssertNil(Nanp.lookupAreaCode("+15555550123"))
    }

    func testNilForMalformedInputStrictPlus1NxxNxxXxxxOnly() {
        for bad in [
            "",
            "4165550123", // no +1
            "14165550123", // no +
            "+4165550123", // wrong country code
            "+441655501234", // UK
            "+1416555012", // 9 national digits
            "+141655501234", // 11 national digits
            "+1 416 555 0123", // spaces
            "+1-416-555-0123", // dashes
            "+11165550123", // area code starts with 1
            "+10165550123", // area code starts with 0
            "+14161550123x", // trailing junk
            "+14160550123", // exchange starts with 0
            "+14161550123 ", // trailing space
            "+1416555O123", // letter O
        ] {
            XCTAssertNil(Nanp.lookupAreaCode(bad), "expected nil for '\(bad)'")
        }
    }

    // MARK: isUsCaDestination (the SMS-pumping destination check)

    func testAcceptsUsAndCaGeographicAndNonGeographicDestinations() {
        XCTAssertTrue(Nanp.isUsCaDestination("+12125550123"))
        XCTAssertTrue(Nanp.isUsCaDestination("+16045550123"))
        XCTAssertTrue(Nanp.isUsCaDestination("+17105550123"))
    }

    func testRejectsCaribbeanTollFreeUnassignedAndMalformed() {
        XCTAssertFalse(Nanp.isUsCaDestination("+18765550123")) // Jamaica
        XCTAssertFalse(Nanp.isUsCaDestination("+12425550123")) // Bahamas
        XCTAssertFalse(Nanp.isUsCaDestination("+18095550123")) // Dominican Republic
        XCTAssertFalse(Nanp.isUsCaDestination("+18005550123")) // toll-free
        XCTAssertFalse(Nanp.isUsCaDestination("+15555550123")) // unassigned
        XCTAssertFalse(Nanp.isUsCaDestination("+447911123456")) // not +1 at all
        XCTAssertFalse(Nanp.isUsCaDestination("2125550123")) // not E.164
    }

    // MARK: normalize (free-form input → E.164)

    func testNormalizesTheHumanFormatsPeopleActuallyType() {
        XCTAssertEqual(Nanp.normalize("(416) 555-0123"), "+14165550123")
        XCTAssertEqual(Nanp.normalize("416-555-0123"), "+14165550123")
        XCTAssertEqual(Nanp.normalize("1 416 555 0123"), "+14165550123")
        XCTAssertEqual(Nanp.normalize("+1 (416) 555-0123"), "+14165550123")
        XCTAssertEqual(Nanp.normalize("4165550123"), "+14165550123")
    }

    func testRejectsWhatTheDestinationCheckRejects() {
        XCTAssertNil(Nanp.normalize("876-555-0123")) // Jamaica
        XCTAssertNil(Nanp.normalize("800 555 0123")) // toll-free
        XCTAssertNil(Nanp.normalize("555-0123")) // 7 digits
        XCTAssertNil(Nanp.normalize("")) // nothing
        XCTAssertNil(Nanp.normalize("2 416 555 0123")) // 11 digits, not a 1 prefix
    }

    // MARK: formatAsYouType

    func testFormatsProgressivelyAsTheUserTypes() {
        XCTAssertEqual(Nanp.formatAsYouType(""), "")
        XCTAssertEqual(Nanp.formatAsYouType("4"), "(4")
        XCTAssertEqual(Nanp.formatAsYouType("416"), "(416")
        XCTAssertEqual(Nanp.formatAsYouType("4165"), "(416) 5")
        XCTAssertEqual(Nanp.formatAsYouType("416555"), "(416) 555")
        XCTAssertEqual(Nanp.formatAsYouType("4165550123"), "(416) 555-0123")
    }

    func testDropsALeadingCountryCodeAndNonDigitsCappingAtTenDigits() {
        XCTAssertEqual(Nanp.formatAsYouType("14165550123"), "(416) 555-0123")
        XCTAssertEqual(Nanp.formatAsYouType("+1 (416) 555-0123"), "(416) 555-0123")
        XCTAssertEqual(Nanp.formatAsYouType("41655501239999"), "(416) 555-0123")
        XCTAssertEqual(Nanp.formatAsYouType("abc"), "")
    }
}
