import XCTest
@testable import Loonext

/// #310 — the same table `packages/shared/src/registration-progress.test.ts`
/// asserts, against the Swift hand-port.
///
/// A drift means this app saying "under review" while the web app says
/// "submitted" — worse than either alone, because it teaches the customer to
/// distrust both at the moment they are already wondering if the wait is
/// broken. And iOS compiles only in CI, so this file is the only check there
/// is.
final class RegistrationProgressTests: XCTestCase {
    func testNeedsDetailsWhenNothingHasBeenSubmitted() {
        XCTAssertEqual(registrationStage(brand: nil, campaign: nil), .needsDetails)
    }

    func testFollowsTheCampaignBecauseTheCampaignUnlocksTexting() {
        XCTAssertEqual(registrationStage(brand: "approved", campaign: "pending"), .underReview)
        XCTAssertEqual(registrationStage(brand: "approved", campaign: "approved"), .approved)
        XCTAssertEqual(registrationStage(brand: "approved", campaign: nil), .submitting)
    }

    func testMakesARejectionTheHeadlineWhereverItHappens() {
        XCTAssertEqual(registrationStage(brand: "rejected", campaign: "pending"), .rejected)
        XCTAssertEqual(registrationStage(brand: "approved", campaign: "rejected"), .rejected)
    }

    func testIsNeverZeroPercentOnceAnythingHasBeenSent() {
        // A bar sitting at 0% for four days IS the spinner this replaces.
        let cases: [(String?, String?)] = [(nil, nil), ("submitted", nil), ("approved", "pending")]
        for (brand, campaign) in cases {
            XCTAssertGreaterThan(
                registrationProgress(brand: brand, campaign: campaign).percent, 0
            )
        }
    }

    func testOnlyAsksForActionWhenSomethingIsRequiredOfThem() {
        XCTAssertTrue(registrationProgress(brand: nil, campaign: nil).actionNeeded)
        XCTAssertTrue(registrationProgress(brand: "rejected", campaign: nil).actionNeeded)
        // Waiting is not a task; marking it as one puts a permanent red dot on
        // a screen the person can do nothing about.
        XCTAssertFalse(registrationProgress(brand: "submitted", campaign: nil).actionNeeded)
        XCTAssertFalse(registrationProgress(brand: "approved", campaign: "pending").actionNeeded)
    }

    func testQuotesARangeOnlyWhileThereIsAWaitToDescribe() {
        let waiting = registrationProgress(brand: "approved", campaign: "pending")
        XCTAssertTrue(waiting.expected!.contains("3–7"))
        // "sometimes longer", because it sometimes is — an estimate that
        // quietly expires teaches somebody not to believe the next one.
        XCTAssertTrue(waiting.expected!.contains("sometimes longer"))
        XCTAssertNil(registrationProgress(brand: "approved", campaign: "approved").expected)
        XCTAssertNil(registrationProgress(brand: "rejected", campaign: nil).expected)
    }

    func testSpeaksTheCustomerLanguageNotTheStateMachines() {
        let title = registrationProgress(brand: "approved", campaign: "pending")
            .title.lowercased()
        XCTAssertFalse(title.contains("campaign"))
        XCTAssertFalse(title.contains("brand"))
        XCTAssertFalse(title.contains("10dlc"))
    }

    func testIsWaitingOnlyWhileTheCarriersGenuinelyHaveIt() {
        XCTAssertTrue(isWaitingOnRegistration(brand: "submitted", campaign: nil))
        XCTAssertTrue(isWaitingOnRegistration(brand: "approved", campaign: "pending"))
        // Not waiting on anybody — being waited ON.
        XCTAssertFalse(isWaitingOnRegistration(brand: nil, campaign: nil))
        XCTAssertFalse(isWaitingOnRegistration(brand: "rejected", campaign: nil))
        XCTAssertFalse(isWaitingOnRegistration(brand: "approved", campaign: "approved"))
    }
}
