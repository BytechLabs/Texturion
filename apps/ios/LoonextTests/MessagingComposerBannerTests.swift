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

    func testNoGatesMeansNoBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: false,
                usage: usage(used: 10, cap: 100)
            )
        )
    }

    func testOptedOutWinsOverEverything() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: true,
                subscriptionStatus: SubscriptionStatus.canceled,
                destinationCountry: "US",
                usApproved: false,
                usage: usage(used: 200, cap: 100)
            ),
            .optedOut
        )
    }

    func testInactiveSubscriptionBeatsRegistrationAndCap() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                subscriptionStatus: SubscriptionStatus.pastDue,
                destinationCountry: "US",
                usApproved: false,
                usage: usage(used: 200, cap: 100)
            ),
            .subscription(SubscriptionStatus.pastDue)
        )
    }

    func testUsDestinationWithoutApprovalShowsRegistrationPending() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "US",
                usApproved: false,
                usage: nil
            ),
            .registrationPending
        )
    }

    func testCaDestinationNeverSeesTheRegistrationBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: false,
                usage: nil
            )
        )
    }

    func testCapReachedShowsTheUsageBanner() {
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usage: usage(used: 100, cap: 100)
            ),
            .usageCap
        )
    }

    func testNoCapMeansNoUsageBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usage: usage(used: 1_000_000, cap: nil)
            )
        )
    }

    func testLoadingUsageNilNeverShowsTheCapBanner() {
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usage: nil
            )
        )
    }
}
