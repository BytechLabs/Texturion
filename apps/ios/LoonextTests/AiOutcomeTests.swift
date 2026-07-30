import XCTest

@testable import Loonext

/// #431 — parity with `apps/web/src/lib/ai/outcome.test.ts` and
/// `AiOutcomeTest.kt`, case for case.
///
/// The dominant risk is not a wrong label. It is reporting an outcome where none
/// happened: Lou is involved in a small fraction of the messages a crew sends, so
/// a rule that says "discarded" whenever a suggestion was not used would bury the
/// real signal under every ordinary typed message and make the ledger read as a
/// catastrophic rejection rate. Every assertNil below is that guard.
final class AiOutcomeTests: XCTestCase {
    func testNoDraftShownReportsNothing() {
        // The important one. Most messages are typed with Lou uninvolved.
        XCTAssertNil(AiOutcome.forDraft(shown: false, picked: nil, sent: "on my way"))
    }

    func testDraftSentUntouchedIsUsed() {
        XCTAssertEqual(
            AiOutcome.forDraft(shown: true, picked: "On my way", sent: "On my way"),
            AiOutcome.used
        )
    }

    func testWhitespaceTheComposerAddsIsNotAnEdit() {
        XCTAssertEqual(
            AiOutcome.forDraft(shown: true, picked: "On my way", sent: "On my way\n"),
            AiOutcome.used
        )
    }

    func testDraftChangedBeforeSendingIsEdited() {
        XCTAssertEqual(
            AiOutcome.forDraft(shown: true, picked: "On my way", sent: "On my way, 20 min"),
            AiOutcome.edited
        )
    }

    func testDraftsShownAndIgnoredAreDiscarded() {
        XCTAssertEqual(
            AiOutcome.forDraft(shown: true, picked: nil, sent: "different words"),
            AiOutcome.discarded
        )
    }

    func testEnrichmentThatFilledNothingReportsNothing() {
        // Enrichment runs on every make-a-task and often finds no address at all.
        // That is not a rejected suggestion.
        XCTAssertNil(
            AiOutcome.forEnrichment(
                suggestedAddress: false,
                suggestedDue: false,
                addressEdited: false,
                addressCleared: false,
                dueEdited: false,
                dueCleared: false
            )
        )
    }

    func testUntouchedSuggestionsAreUsed() {
        XCTAssertEqual(
            AiOutcome.forEnrichment(
                suggestedAddress: true,
                suggestedDue: true,
                addressEdited: false,
                addressCleared: false,
                dueEdited: false,
                dueCleared: false
            ),
            AiOutcome.used
        )
    }

    func testCorrectedAddressIsEditedNotUsed() {
        // A suggestion that needed fixing is not a suggestion that was right.
        XCTAssertEqual(
            AiOutcome.forEnrichment(
                suggestedAddress: true,
                suggestedDue: false,
                addressEdited: true,
                addressCleared: false,
                dueEdited: false,
                dueCleared: false
            ),
            AiOutcome.edited
        )
    }

    func testOnePartKeptAndTheOtherThrownAwayIsEdited() {
        XCTAssertEqual(
            AiOutcome.forEnrichment(
                suggestedAddress: true,
                suggestedDue: true,
                addressEdited: false,
                addressCleared: false,
                dueEdited: false,
                dueCleared: true
            ),
            AiOutcome.edited
        )
    }

    func testEverySuggestedPartThrownAwayIsCleared() {
        XCTAssertEqual(
            AiOutcome.forEnrichment(
                suggestedAddress: true,
                suggestedDue: true,
                addressEdited: false,
                addressCleared: true,
                dueEdited: false,
                dueCleared: true
            ),
            AiOutcome.discarded
        )
    }

    func testClearingAFieldThatWasNeverSuggestedIsIgnored() {
        // Somebody clearing a due date they typed themselves says nothing about Lou.
        XCTAssertEqual(
            AiOutcome.forEnrichment(
                suggestedAddress: true,
                suggestedDue: false,
                addressEdited: false,
                addressCleared: false,
                dueEdited: false,
                dueCleared: true
            ),
            AiOutcome.used
        )
    }

    func testFeatureKeysAreTheLedgerKeys() {
        // Transcript outcomes are recorded SERVER-side (see AiOutcome's closing
        // comment), but the key is declared so a client that ever needs it cannot
        // invent a friendlier spelling and open a second ledger row.
        XCTAssertEqual(AiOutcome.featureSuggestReply, "suggest_reply")
        XCTAssertEqual(AiOutcome.featureEnrich, "enrich")
        XCTAssertEqual(AiOutcome.featureVoicemailTranscript, "voicemail_transcript")
    }
}
