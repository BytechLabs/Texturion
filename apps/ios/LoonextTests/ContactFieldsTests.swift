import XCTest
@testable import Loonext

/// #291 — the same cases as `contact-fields.test.ts` and `ContactFieldsTest.kt`.
///
/// This is a HAND-PORT of shared TypeScript, which is where the silent failures
/// live: NSRegularExpression and JavaScript disagree about anchors in a
/// multi-line string, and a port that compiles can still quietly accept what
/// the server refuses. Every case asserts a POSITIVE result as well as a
/// negative, because a function that returns nil for everything passes every
/// "is it rejected?" test ever written.
final class ContactFieldsTests: XCTestCase {

    func testCFK1TurnsALabelIntoSomethingACSVHeaderCanSurvive() {
        // The same string becomes a JSON key AND a column head for import
        // mapping (#248) and export (#227). A key with a comma in it makes a
        // file that reads back wrong, two features from now.
        XCTAssertEqual(ContactFields.key("Boiler model"), "boiler_model")
        XCTAssertEqual(ContactFields.key("Serial #"), "serial")
        XCTAssertEqual(
            ContactFields.key("Warranty expiry, if any"),
            "warranty_expiry_if_any"
        )
        // A label that STARTS with punctuation. The leading trim is the only
        // thing standing between "#Serial" and a nil — without it the key is
        // "_serial", which fails the must-start-with-a-letter check and the
        // field cannot be created at all.
        XCTAssertEqual(ContactFields.key("#Serial"), "serial")
    }

    func testCFK2RefusesRatherThanInventingAName() {
        XCTAssertNil(ContactFields.key("???"))
        XCTAssertNil(ContactFields.key("   "))
        // Leading digits are legal JSON and an awkward column head, and the
        // database refuses them anyway.
        XCTAssertNil(ContactFields.key("2nd meter"))
    }

    func testCFK3NeverEndsInTheSeparatorItIntroduced() {
        XCTAssertFalse(ContactFields.key("Serial #")?.hasSuffix("_") ?? true)
        XCTAssertFalse(ContactFields.key("Model (v2)")?.hasSuffix("_") ?? true)
        // The case the final strip exists for: a label long enough that the
        // 40-character cut lands on a separator the sanitiser introduced.
        let long = String(repeating: "x", count: 39) + " tail"
        XCTAssertEqual(ContactFields.key(long), String(repeating: "x", count: 39))
    }

    func testCFV1EmptyIsAlwaysAllowedBecauseItIsAnAnswer() {
        // "We asked and there is no gate code" is a fact worth recording, and
        // it is not the same as never having asked.
        for kind in ContactFields.kinds {
            XCTAssertNil(
                ContactFields.valueError(
                    kind: kind, options: ["Combi"], label: "F", value: ""
                ),
                kind
            )
        }
    }

    func testCFV2ADateFieldTakesADateNotAPhrase() {
        XCTAssertNil(
            ContactFields.valueError(
                kind: "date", options: nil, label: "Warranty", value: "2027-03-01"
            )
        )
        XCTAssertEqual(
            ContactFields.valueError(
                kind: "date", options: nil, label: "Warranty", value: "next Tuesday"
            ),
            "Warranty should be a date"
        )
    }

    func testCFV3ASelectTakesOneOfItsOwnChoices() {
        let options = ["Combi", "System"]
        XCTAssertNil(
            ContactFields.valueError(
                kind: "select", options: options, label: "Type", value: "Combi"
            )
        )
        XCTAssertTrue(
            ContactFields.valueError(
                kind: "select", options: options, label: "Type", value: "Combie"
            )?.contains("choices") ?? false
        )
    }

    func testCFV4TheReasonNamesTheFieldSoSomebodyCanFindIt() {
        // A form with ten custom fields and one error saying "invalid" is a
        // form somebody edits at random until it saves.
        XCTAssertEqual(
            ContactFields.valueError(
                kind: "number", options: nil, label: "Capacity", value: "abc"
            ),
            "Capacity should be a number"
        )
        XCTAssertEqual(
            ContactFields.valueError(
                kind: "checkbox", options: nil, label: "Dog", value: "maybe"
            ),
            "Dog should be yes or no"
        )
        // And the good values pass, so the rule is a rule rather than a
        // rejection of everything.
        XCTAssertNil(
            ContactFields.valueError(
                kind: "number", options: nil, label: "Capacity", value: "24.5"
            )
        )
        XCTAssertNil(
            ContactFields.valueError(
                kind: "checkbox", options: nil, label: "Dog", value: "yes"
            )
        )
    }

    func testCFV5AValueHasACeiling() {
        let long = String(repeating: "x", count: ContactFields.valueMax + 1)
        XCTAssertTrue(
            ContactFields.valueError(
                kind: "text", options: nil, label: "Notes", value: long
            )?.contains("too long") ?? false
        )
        XCTAssertNil(
            ContactFields.valueError(
                kind: "text",
                options: nil,
                label: "Notes",
                value: String(repeating: "x", count: ContactFields.valueMax)
            )
        )
    }
}
