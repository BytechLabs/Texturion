import XCTest
@testable import Loonext

/// #298 — the suggestion has to catch real duplicates without crying wolf.
///
/// The same vectors as packages/shared/src/tag-similarity.test.ts and the
/// Android TagSimilarityTest, because this file is a hand-port and a port that
/// drifts is worse than no port: the prompt would then say different things on
/// a phone and a laptop about the same two names.
///
/// Both failures are costly and only one is obvious. Missing "Warranty" when
/// somebody types "warranty" lets the sprawl happen. Offering "was" when
/// somebody types "gas" trains them to dismiss the prompt, after which it
/// catches nothing at all — and that failure is invisible, because a dismissed
/// prompt looks exactly like a prompt that was never needed.
final class TagSimilarityTests: XCTestCase {
    private func tag(_ id: String, _ name: String) -> Tag {
        Tag(id: id, name: name, color: nil, created_at: nil, updated_at: nil)
    }

    private var tags: [Tag] {
        [
            tag("1", "Warranty"),
            tag("2", "Quote sent"),
            tag("3", "Emergency"),
            tag("4", "Gas"),
        ]
    }

    func testNormalizeTreatsCasePunctuationAndSpacingAsTheSameIdea() {
        XCTAssertEqual(normalizeTagName("Quote sent"), "quotesent")
        XCTAssertEqual(normalizeTagName("quote-sent"), "quotesent")
        XCTAssertEqual(normalizeTagName("  QUOTE  SENT  "), "quotesent")
    }

    func testNormalizeSurvivesAPunctuationOnlyName() {
        XCTAssertEqual(normalizeTagName("!!!"), "")
    }

    func testEditDistanceCountsTheEdits() {
        XCTAssertEqual(editDistance("warranty", "warrenty"), 1)
        XCTAssertEqual(editDistance("emergency", "emergancy"), 1)
        XCTAssertEqual(editDistance("abc", "abc"), 0)
    }

    func testEditDistanceBailsPastTheCap() {
        XCTAssertGreaterThan(editDistance("warranty", "completely different", cap: 3), 3)
    }

    func testEditDistanceIsSymmetric() {
        XCTAssertEqual(
            editDistance("schedule", "scheduled"),
            editDistance("scheduled", "schedule")
        )
    }

    func testCatchesCaseAndPunctuationVariantsExactly() {
        let warranty = suggestExistingTag("warranty", existing: tags)
        XCTAssertEqual(warranty?.tag.id, "1")
        XCTAssertEqual(warranty?.exact, true)

        let quote = suggestExistingTag("quote-sent", existing: tags)
        XCTAssertEqual(quote?.tag.id, "2")
        XCTAssertEqual(quote?.exact, true)
    }

    func testCatchesATypoAsANearMatch() {
        let warranty = suggestExistingTag("warrenty", existing: tags)
        XCTAssertEqual(warranty?.tag.id, "1")
        XCTAssertEqual(warranty?.exact, false)

        let emergency = suggestExistingTag("emergancy", existing: tags)
        XCTAssertEqual(emergency?.tag.id, "3")
        XCTAssertEqual(emergency?.exact, false)
    }

    func testDoesNotFuzzyMatchAShortName() {
        // "was" against "gas" is one edit and a completely different word. A
        // prompt people dismiss is a prompt that stops working.
        XCTAssertNil(suggestExistingTag("was", existing: tags))
        XCTAssertNil(suggestExistingTag("van", existing: tags))
    }

    func testLeavesAGenuinelyNewTagAlone() {
        XCTAssertNil(suggestExistingTag("Roof", existing: tags))
        XCTAssertNil(suggestExistingTag("Needs parts", existing: tags))
    }

    func testPrefersAnExactNormalisedMatchOverACloserLookingFuzzyOne() {
        let withBoth = [tag("a", "Warrantys"), tag("b", "warranty")]
        let hit = suggestExistingTag("Warranty", existing: withBoth)
        XCTAssertEqual(hit?.tag.id, "b")
        XCTAssertEqual(hit?.exact, true)
    }

    func testPicksTheClosestWhenSeveralAreNear() {
        let near = [tag("a", "scheduling"), tag("b", "scheduled")]
        XCTAssertEqual(suggestExistingTag("schedule", existing: near)?.tag.id, "b")
    }

    func testNeverThrowsOnEmptyOrPunctuationOnlyInput() {
        XCTAssertNil(suggestExistingTag("", existing: tags))
        XCTAssertNil(suggestExistingTag("!!!", existing: tags))
        XCTAssertNil(suggestExistingTag("Roof", existing: [tag("x", "!!!")]))
    }

    func testStaysWithinTheStatedThreshold() {
        // The constant is the contract three clients port; a change here is a
        // change to how noisy the prompt is on every one of them.
        XCTAssertEqual(tagSuggestDistance, 2)
        XCTAssertEqual(tagNameDistance("Warranty", "warrenty"), 1)
    }

    /// The merge sentence's number, which is the only thing an admin reads
    /// before an irreversible operation.
    func testUsesLabelReadsAsAVerdictNotALoadingState() {
        XCTAssertEqual(usesLabel(0), "never used")
        XCTAssertEqual(usesLabel(1), "1 thread")
        XCTAssertEqual(usesLabel(12), "12 threads")
    }
}
