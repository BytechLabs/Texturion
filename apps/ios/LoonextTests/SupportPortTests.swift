import XCTest
@testable import Loonext

/// #253/#382 — the support pre-fill, hand-ported.
///
/// Same vectors as packages/shared/src/support.test.ts and the Android
/// SupportPortTest. This file is a MIRROR of a TypeScript module Swift cannot
/// import, and a mirror that drifts is worse than no mirror: the same carrier
/// suspension would then arrive in the support inbox under two different names,
/// and the pattern that matters most — five reports of one failure in a
/// morning — becomes invisible.
final class SupportPortTests: XCTestCase {
    private let companyId = "7c9e6679-7425-40de-944b-e07fc1f90ae7"

    private func makeBody(
        situation: String? = nil,
        errors: [String] = []
    ) -> String {
        supportBody(
            companyId: companyId,
            companyName: "Ace Plumbing",
            plan: "starter",
            appVersion: "1.4.0",
            situation: situation,
            recentErrors: errors
        )
    }

    func testCarriesTheWorkspacePlanAndPlatform() {
        let text = makeBody()
        XCTAssertTrue(text.contains("Ace Plumbing"))
        XCTAssertTrue(text.contains(companyId))
        XCTAssertTrue(text.contains("Plan: starter"))
        XCTAssertTrue(text.contains("App: ios 1.4.0"))
    }

    func testPutsTheCustomersOwnWordsAboveOurDiagnostics() {
        let text = makeBody()
        XCTAssertTrue(text.hasPrefix("\n\n"))
        let dashes = text.range(of: "---")
        let workspace = text.range(of: "Workspace:")
        XCTAssertNotNil(dashes)
        XCTAssertNotNil(workspace)
        XCTAssertTrue(dashes!.lowerBound < workspace!.lowerBound)
    }

    func testNamesTheSituationThePersonWasLookingAt() {
        let text = makeBody(situation: supportSituation("registration_pending"))
        XCTAssertTrue(text.contains("Screen: US registration is pending approval"))
    }

    func testGivesTheSameFailureTheSameSubjectAsTheOtherClients() {
        XCTAssertEqual(
            supportSubjectFor("registration_suspended"),
            "Problem: the carrier suspended our US registration"
        )
        XCTAssertEqual(
            supportSubjectFor("usage_cap"),
            "Problem: sending is paused at the spending cap"
        )
    }

    func testSaysNothingRatherThanGuessingForAnUnknownBanner() {
        XCTAssertNil(supportSituation("something_new"))
        XCTAssertEqual(supportSubjectFor("something_new"), "Help with my Loonext workspace")
    }

    func testCarriesRecentErrorsWithoutTheCustomerAssemblingThem() {
        let text = makeBody(errors: ["12:04 api request_failed internal_error 500"])
        XCTAssertTrue(text.contains("Recent errors on this device (newest first):"))
        XCTAssertTrue(text.contains("internal_error"))
    }

    func testCapsTheErrorListBecauseATruncatedBodyCarriesNoDiagnostics() {
        let text = makeBody(errors: (0..<20).map { "error \($0)" })
        XCTAssertTrue(text.contains("error 0"))
        XCTAssertTrue(text.contains("error 5"))
        XCTAssertFalse(text.contains("error 6"))
    }

    func testOmitsTheErrorBlockWhenThereIsNothingToReport() {
        // A heading over an empty list reads as "we looked and found nothing",
        // which is a different claim from "we did not look".
        XCTAssertFalse(makeBody(errors: []).contains("Recent errors"))
        XCTAssertFalse(makeBody(errors: ["  "]).contains("Recent errors"))
    }

    func testTheFeedbackChannelArrivesUnderItsOwnSubject() {
        let url = feedbackMailto(
            companyId: companyId,
            companyName: "Ace Plumbing",
            plan: "starter",
            appVersion: "1.4.0"
        )
        XCTAssertNotNil(url)
        XCTAssertTrue(url!.absoluteString.contains("Idea"))
    }

    func testTheStatedResponseTimeSurvivesABadWeek() {
        // "A support channel a solo founder cannot service is worse than none."
        XCTAssertTrue(supportResponseTime.contains("two business days"))
        XCTAssertFalse(supportResponseTime.contains("hour"))
    }

    func testTheFixPromiseSaysTheSameThingAsTheOtherClients() {
        // #321: the loop, and it must promise a reply on the FIX rather than on
        // receipt — a report that vanishes after an acknowledgement teaches the
        // same lesson as one that vanishes immediately.
        XCTAssertTrue(supportFixPromise.contains("fixed"))
        XCTAssertTrue(supportFixPromise.contains("not just when"))
    }

    func testTheAnswersCoverTheConfusionsTheIssueNames() {
        let all = supportTopics
            .map { "\($0.question) \($0.answer)" }
            .joined(separator: " ")
            .lowercased()
        for subject in ["registration", "spending cap", "stop", "port"] {
            XCTAssertTrue(all.contains(subject), "no answer mentions \(subject)")
        }
    }

    func testEveryBannerKindHasASituationSentence() {
        // The one that would silently regress: a new banner case added without
        // a sentence produces a report saying nothing the customer did not
        // already have to type.
        let kinds = [
            "opted_out", "subscription", "registration_pending",
            "registration_suspended", "us_texting_off", "usage_cap",
            "opt_out_hint", "number_access", "read_only",
        ]
        for kind in kinds {
            XCTAssertNotNil(supportSituation(kind), "no sentence for \(kind)")
        }
    }
}
