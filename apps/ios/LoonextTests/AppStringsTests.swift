import XCTest

@testable import Loonext

/// #228 — the completeness guarantee Swift cannot express in its type system.
///
/// Web types the French as the English's exact shape, so a forgotten key fails
/// `tsc` in the file that forgot it. There is no equivalent here, so it is
/// asserted instead — and asserted in BOTH directions, because the two failures
/// are different and both are real:
///
///   IN EN, NOT IN FR   a French reader is shown an English sentence.
///   IN FR, NOT IN EN   a translation of a string that no longer exists, which
///                      is how a catalogue rots into something nobody trusts.
///
/// The Android twin (`AppStringsTest.kt`) asserts the same four things. Kept in
/// step by hand, like every other rule these two clients share.
final class AppStringsTests: XCTestCase {
    func testEverySectionHasTheSameKeysInBothLanguages() {
        for section in AppStrings.sections {
            let enOnly = Set(section.en.keys).subtracting(section.frCA.keys)
            let frOnly = Set(section.frCA.keys).subtracting(section.en.keys)
            XCTAssertEqual(
                enOnly, [], "\(section.name): keys in English with no French"
            )
            XCTAssertEqual(
                frOnly, [], "\(section.name): keys in French with no English"
            )
        }
    }

    func testNoTwoSectionsClaimTheSameKey() {
        // The merge is a fold of dictionaries, so a duplicate key would be
        // silently won by whichever section is registered last — and the
        // loser's screen would start saying somebody else's sentence.
        var seen: [String: String] = [:]
        for section in AppStrings.sections {
            for key in section.en.keys {
                XCTAssertNil(
                    seen[key],
                    "\(key) is claimed by \(seen[key] ?? "?") and \(section.name)"
                )
                seen[key] = section.name
            }
        }
    }

    func testEverySectionIsRegistered() {
        // A guard against the one mistake this arrangement invites: writing a
        // section file and forgetting the line in `sections`. It would compile,
        // its own tests would pass, and every screen reading it would render
        // bare keys.
        let names = AppStrings.sections.map(\.name)
        XCTAssertTrue(names.contains("CommonStrings"))
        XCTAssertTrue(names.contains("PaymentsStrings"))
        XCTAssertFalse(AppStrings.en.isEmpty)
    }

    func testAnUnknownLocaleReadsEnglishRatherThanFailing() {
        XCTAssertEqual(AppStrings.translate("de", "common.cancel"), "Cancel")
        XCTAssertEqual(AppStrings.translate(nil, "common.cancel"), "Cancel")
        XCTAssertEqual(
            AppStrings.translate(MessageLocale.frCA, "common.cancel"), "Annuler"
        )
    }

    func testAMissingKeyFallsBackToEnglishAndThenToItself() {
        // The key rather than a blank, deliberately: an English sentence is a
        // lost translation, a blank is a lost product.
        XCTAssertEqual(
            AppStrings.translate("fr-CA", "nope.missing"), "nope.missing"
        )
    }

    func testInterpolationSubstitutesWhatItIsGivenAndLeavesWhatItIsNot() {
        XCTAssertEqual(
            AppStrings.translate("en", "payments.askFor", ["amount": "$250"]),
            "Ask for $250"
        )
        // An unknown token stays visible rather than becoming an empty gap: a
        // sentence with a hole in it is a bug report, and "{amount}" on screen
        // is the same bug reported by the screen.
        XCTAssertEqual(
            AppStrings.translate("en", "payments.askFor", ["other": "x"]),
            "Ask for {amount}"
        )
    }

    func testTheTwoLanguagesAgreeAboutWhichKeysInterpolate() {
        // A French sentence that drops {amount} shows a bill with no figure on
        // it. Cheap to check, and invisible to every other test here.
        for section in AppStrings.sections {
            for (key, english) in section.en {
                guard let french = section.frCA[key] else { continue }
                XCTAssertEqual(
                    tokens(in: english),
                    tokens(in: french),
                    "\(key): the two languages interpolate different tokens"
                )
            }
        }
    }

    /// `{name}` occurrences, as a sorted list.
    ///
    /// Written by hand rather than with a regular expression on purpose. This
    /// repo has lost two guards to a `\b` that was a control character rather
    /// than a word boundary — one of them a check on a legal claim, passing on
    /// the empty set for months — and a scan over characters cannot go wrong
    /// that way.
    private func tokens(in text: String) -> [String] {
        var found: [String] = []
        var current: String?
        for character in text {
            if character == "{" {
                current = ""
            } else if character == "}" {
                if let token = current, !token.isEmpty { found.append(token) }
                current = nil
            } else if current != nil {
                current?.append(character)
            }
        }
        return found.sorted()
    }
}
