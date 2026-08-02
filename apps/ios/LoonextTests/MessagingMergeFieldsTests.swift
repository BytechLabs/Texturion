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

    // MARK: - #274: the tokens that make a template do real work

    func testExpressesTheTwoMessagesACrewActuallyRepeats() {
        let values = MergeFields.Values(
            contactAddress: "18 Rosewood Ave",
            jobDay: "Tuesday",
            jobTime: "2:00 PM"
        )
        XCTAssertEqual(
            MergeFields.applyMergeFields("On my way to {address}", values: values),
            "On my way to 18 Rosewood Ave"
        )
        XCTAssertEqual(
            MergeFields.applyMergeFields("Confirming {job_day} at {job_time}", values: values),
            "Confirming Tuesday at 2:00 PM"
        )
    }

    func testSignsWithThePersonNotTheCompany() {
        // A FIRST name, like {first_name}: "Sam" is how a tech signs a text.
        XCTAssertEqual(
            MergeFields.applyMergeFields(
                "- {my_name}",
                values: MergeFields.Values(senderName: "Sam Okafor")
            ),
            "- Sam"
        )
    }

    func testKeepsAMultiLineAddressOnOneLine() {
        XCTAssertEqual(
            MergeFields.applyMergeFields(
                "On my way to {address}",
                values: MergeFields.Values(contactAddress: "18 Rosewood Ave\nUnit 4")
            ),
            "On my way to 18 Rosewood Ave, Unit 4"
        )
    }

    func testDegradesExactlyAsTheOriginalTwoDid() {
        // The contract that must not change: a missing value drops the token
        // and the punctuation closes up behind it.
        XCTAssertEqual(
            MergeFields.applyMergeFields("On my way to {address}", values: MergeFields.Values()),
            "On my way to"
        )
        XCTAssertEqual(
            MergeFields.applyMergeFields(
                "Hi {first_name}, we're at {address}.",
                values: MergeFields.Values()
            ),
            "Hi, we're at."
        )
    }

    func testFormatsTheReplyToNumberTheWayTheServerDoes() {
        XCTAssertEqual(MergeFields.formatNanpNumber("+14155550142"), "(415) 555-0142")
        // Anything unparseable comes back untouched: it is still dialable.
        XCTAssertEqual(MergeFields.formatNanpNumber("+442071838750"), "+442071838750")
    }

    func testTheEditorOffersTheSameSevenVariablesTheOtherClientsDo() {
        // A token offered on the phone and not the laptop means a template
        // somebody writes here and then cannot maintain there.
        XCTAssertEqual(
            MergeFields.variables.map(\.token),
            [
                "first_name", "address", "job_day", "job_time",
                "my_name", "business_name", "our_number",
            ]
        )
        for variable in MergeFields.variables {
            XCTAssertTrue(
                MergeFields.tokens.contains(variable.token),
                "\(variable.token) is offered but not supported"
            )
        }
    }

    func testTheTemplatePreviewShowsEveryTokenWorking() {
        // An unresolved token renders as nothing, which is exactly what a
        // BROKEN token looks like — so the preview must resolve all of them.
        let preview = MergeFields.previewTemplate(
            "{first_name} {address} {job_day} {job_time} {my_name} {business_name} {our_number}",
            businessName: "Ace Plumbing",
            ourNumberE164: "+14155550142"
        )
        for expected in [
            "Dana", "18 Rosewood Ave", "Tuesday", "2:00 PM",
            "Sam", "Ace Plumbing", "(415) 555-0142",
        ] {
            XCTAssertTrue(preview.contains(expected), "preview is missing \(expected)")
        }
    }

}
