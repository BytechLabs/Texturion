import XCTest
@testable import Loonext

/// #239 — the arc copy, word for word with web (`response-time-card.test.ts`) and
/// Android (`ResponseTimeCopyTest.kt`).
///
/// Every case here is one where the easy sentence would be a flattering one. The
/// issue is explicit that the first disagreement with the crew's gut ends the
/// metric's usefulness, and a panel that only congratulates is the fastest way
/// there.
final class ResponseTimeCopyTests: XCTestCase {

    private func report(
        median: Double? = 240,
        improved: Double? = nil,
        baseline: Double? = nil,
        unavailable: String? = nil
    ) -> ResponseTimeReport {
        var r = ResponseTimeReport()
        r.leads = 10
        r.answered = 8
        r.unanswered = 2
        r.median_seconds = median
        r.improved_by_seconds = improved
        r.baseline_unavailable = unavailable
        if let baseline {
            var b = ResponseTimeBaseline()
            b.leads = 5
            b.answered = 5
            b.median_seconds = baseline
            r.baseline = b
        }
        return r
    }

    func testLeadsWithTheImprovementInTheWordsAContractorRepeats() {
        XCTAssertEqual(
            responseArcSentence(report(median: 240, improved: 10560, baseline: 10800)),
            "Down from 3 hr when you started"
        )
    }

    func testSaysSoWhenTheWorkspaceGotSlower() {
        // A metric that only reports improvement is one nobody believes. This is
        // the sentence that keeps the other one credible.
        XCTAssertEqual(
            responseArcSentence(report(median: 10800, improved: -10560, baseline: 240)),
            "Up from 4 min when you started"
        )
    }

    func testDrawsNoArcWithoutABaselineWhateverTheDeltaClaims() {
        XCTAssertNil(responseArcSentence(report(improved: 9999, baseline: nil)))
    }

    func testDrawsNoArcForASubMinuteChange() {
        XCTAssertNil(responseArcSentence(report(improved: 30, baseline: 270)))
    }

    func testExplainsAYoungWorkspaceInsteadOfComparingItToItself() {
        XCTAssertEqual(
            responseNoArcReason(report(unavailable: "too_new")),
            "Your starting point lands once you have been here a fortnight"
        )
    }

    func testExplainsAnEmptyFirstFortnightRatherThanClaimingProgressFromZero() {
        XCTAssertEqual(
            responseNoArcReason(report(unavailable: "no_answered_leads")),
            "No answered leads in your first two weeks, so there is nothing to compare"
        )
    }

    func testSaysFlatIsFlat() {
        XCTAssertEqual(
            responseNoArcReason(report()),
            "About the same as when you started"
        )
    }

    func testNamesOneUnansweredLeadInTheSingularBecauseItOftenIsOne() {
        XCTAssertEqual(responseUnansweredLine(1), "1 lead nobody answered")
        XCTAssertEqual(responseUnansweredLine(2), "2 leads nobody answered")
    }
}
