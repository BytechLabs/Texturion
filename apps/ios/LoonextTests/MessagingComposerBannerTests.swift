import XCTest
@testable import Loonext

/// Banner precedence: opted_out > subscription > registration > cap > none
/// (the Android ComposerBannerTest twin).
final class MessagingComposerBannerTests: XCTestCase {
    private func usage(used: Int, cap: Int?) -> Usage {
        Usage(
            period_start: nil,
            period_end: nil,
            included_segments: 0,
            used_segments: used,
            inbound_segments: 0,
            overage_segments: 0,
            cap_segments: cap,
            projected_overage_cents: 0,
            overage_projection: UsageOverageProjection(),
            history: [],
            storage: UsageStorage(),
            voice: UsageVoice()
        )
    }

    func testWorkspaceWithoutUsTextingIsToldWhatIsOff() {
        // No registration exists to approve, so the pending copy would promise
        // an outcome that cannot arrive however long the reader waits.
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: true,
                usage: usage(used: 10, cap: 100)
            ),
            .usTextingOff
        )
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: false,
                usage: usage(used: 10, cap: 100)
            ),
            .registrationPending
        )
    }

    func testNoGatesMeansNoBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: false,
                usTextingOff: false,
                usage: usage(used: 10, cap: 100)
            )
        )
    }

    func testOptedOutWinsOverEverything() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: true,
                contactOptOutSource: optOutSourceStop,
                subscriptionStatus: SubscriptionStatus.canceled,
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: false,
                usage: usage(used: 200, cap: 100)
            ),
            .optedOut(carrierBlocked: true)
        )
    }

    func testTellsTheTwoOptOutsApart() {
        // A STOP is the customer's to undo. A hand-recorded opt-out is the
        // crew's, and telling them to wait for a START they will never get is
        // a dead end.
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: true,
                contactOptOutSource: "manual",
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usTextingOff: false,
                usage: usage(used: 10, cap: 100)
            ),
            .optedOut(carrierBlocked: false)
        )
    }

    func testInactiveSubscriptionBeatsRegistrationAndCap() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.pastDue,
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: false,
                usage: usage(used: 200, cap: 100)
            ),
            .subscription(SubscriptionStatus.pastDue)
        )
    }

    func testUsDestinationWithoutApprovalShowsRegistrationPending() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: false,
                usage: nil
            ),
            .registrationPending
        )
    }

    func testCaDestinationNeverSeesTheRegistrationBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: false,
                usTextingOff: false,
                usage: nil
            )
        )
    }

    func testCapReachedShowsTheUsageBanner() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usTextingOff: false,
                usage: usage(used: 100, cap: 100)
            ),
            .usageCap
        )
    }

    func testNoCapMeansNoUsageBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usTextingOff: false,
                usage: usage(used: 1_000_000, cap: nil)
            )
        )
    }

    func testLoadingUsageNilNeverShowsTheCapBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usTextingOff: false,
                usage: nil
            )
        )
    }
}
