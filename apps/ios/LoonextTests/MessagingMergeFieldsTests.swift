import XCTest
@testable import Loonext

/// Port of every vector in packages/shared/src/merge-fields.test.ts (via the
/// Android MergeFieldsTest twin).
final class MessagingMergeFieldsTests: XCTestCase {
    // MARK: substitution

    func testSubstitutesFirstNameWithTheFirstTokenOfTheContactName() {
        XCTAssertEqual(
            MergeFields.applyMergeFields(
                "Hi {first_name}, on my way!",
                contactName: "Dana Whitfield"
            ),
            "Hi Dana, on my way!"
        )
    }

    func testSubstitutesBusinessName() {
        XCTAssertEqual(
            MergeFields.applyMergeFields(
                "Thanks from {business_name}",
                businessName: "Ace Plumbing"
            ),
            "Thanks from Ace Plumbing"
        )
    }

    func testHandlesASingleWordName() {
        XCTAssertEqual(
            MergeFields.applyMergeFields("Hi {first_name}", contactName: "Sam"),
            "Hi Sam"
        )
    }

    func testCollapsesSurroundingWhitespaceInTheName() {
        XCTAssertEqual(
            MergeFields.applyMergeFields("Hi {first_name}!", contactName: "   Jo   Ann  "),
            "Hi Jo!"
        )
    }

    func testLeavesTextWithoutTokensByteForByteUnchanged() {
        let text = "No tokens here — just a plain message."
        XCTAssertEqual(MergeFields.applyMergeFields(text, contactName: "Dana"), text)
    }

    func testIsCaseInsensitiveOnTheTokenName() {
        XCTAssertEqual(
            MergeFields.applyMergeFields("Hi {First_Name}", contactName: "Dana Lee"),
            "Hi Dana"
        )
    }

    // MARK: graceful degradation

    func testDropsFirstNameCleanlyWhenTheNameIsMissing() {
        let out = MergeFields.applyMergeFields(
            "Hi {first_name}, thanks for calling.",
            contactName: nil
        )
        XCTAssertEqual(out, "Hi, thanks for calling.")
        XCTAssertFalse(out.contains("{first_name}"))
    }

    func testDropsFirstNameWhenTheNameIsWhitespace() {
        XCTAssertEqual(
            MergeFields.applyMergeFields("Hi {first_name}, thanks.", contactName: "   "),
            "Hi, thanks."
        )
    }

    func testDropsATrailingTokenCleanlyWithNoDanglingSpace() {
        XCTAssertEqual(
            MergeFields.applyMergeFields("Call {business_name}", businessName: nil),
            "Call"
        )
    }

    func testDropsUnknownTokensWithoutRenderingTheLiteralBraces() {
        XCTAssertEqual(
            MergeFields.applyMergeFields(
                "Hi {first_name}, your {gizmo} is ready",
                contactName: "Dana"
            ),
            "Hi Dana, your is ready"
        )
    }

    func testDegradesMultipleMissingTokensAtOnce() {
        XCTAssertEqual(
            MergeFields.applyMergeFields("{first_name} — {business_name}"),
            "—"
        )
    }

    func testNeverEmitsALiteralSupportedTokenEvenWhenAllValuesAbsent() {
        let out = MergeFields.applyMergeFields("{first_name} {business_name}")
        for token in MergeFields.tokens {
            XCTAssertFalse(out.contains("{\(token)}"))
        }
    }

    // MARK: hasMergeFields

    func testDetectsSupportedTokens() {
        XCTAssertTrue(MergeFields.hasMergeFields("Hi {first_name}"))
        XCTAssertTrue(MergeFields.hasMergeFields("Business: {business_name}"))
    }

    func testIgnoresUnknownTokensAndBraceFreeText() {
        XCTAssertFalse(MergeFields.hasMergeFields("Hi {gizmo}"))
        XCTAssertFalse(MergeFields.hasMergeFields("plain text"))
        XCTAssertFalse(MergeFields.hasMergeFields("a { b } c"))
    }
}
