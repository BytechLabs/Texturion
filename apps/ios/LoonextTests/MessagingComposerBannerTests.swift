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

    func testOnlyATextingGateOffersTheCall() {
        // Carrier registration gates texting alone, so the call connects today.
        // A STOP revokes consent for the business to reach out at all, so the
        // phone must never be offered as a way around it.
        XCTAssertTrue(offersCallInstead(.registrationPending))
        XCTAssertTrue(offersCallInstead(.usTextingOff))
        XCTAssertFalse(offersCallInstead(.optedOut(carrierBlocked: true)))
        XCTAssertFalse(offersCallInstead(.optedOut(carrierBlocked: false)))
        XCTAssertFalse(offersCallInstead(.usageCap))
        XCTAssertFalse(offersCallInstead(.subscription("past_due")))
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
    func testSuspendedRegistrationIsNotToldToWaitForApproval() {
        // #423. The pending copy says carriers are "still reviewing" and texts
        // "will send once it's approved". For a suspended workspace both are
        // false: they WERE approved, nothing is under review, and waiting
        // achieves nothing. The same defect usTextingOff was split out to fix.
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: false,
                usage: usage(used: 10, cap: 100),
                optOutHint: false,
                usSuspended: true
            ),
            .registrationSuspended
        )

        let copy = bannerCopy(.registrationSuspended)
        XCTAssertEqual(copy.title, "US texting is paused")
        // It must not send the reader hunting for a form to fill in.
        XCTAssertFalse(copy.body.contains("resubmit"))
        XCTAssertFalse(copy.body.contains("reviewing"))
        // And it says who is acting on it, because they cannot fix it.
        XCTAssertTrue(copy.body.contains("we're on it"))
    }

    func testSuspensionStillOffersTheCall() {
        // #423: registration gates TEXTING only, so the call connects — and
        // during a suspension it is the only thing the reader can do now.
        XCTAssertTrue(offersCallInstead(.registrationSuspended))
    }

    func testUsTextingOffWinsOverASuspension() {
        // Most-specific-to-this-reader: somebody who never turned the add-on
        // on has no live registration to discuss, so telling them about a
        // carrier suspension would describe a state they are not in.
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: true,
                usage: usage(used: 10, cap: 100),
                optOutHint: false,
                usSuspended: true
            ),
            .usTextingOff
        )
    }

    func testANoteOnlyMemberIsToldWhyNotLeftGuessing() {
        // #363: the one send-blocking condition that had no banner. Without it
        // the composer just quietly had no text mode, which reads as the
        // product being broken rather than as a permission.
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usTextingOff: false,
                usage: usage(used: 10, cap: 100),
                viewerLevel: "note"
            ),
            .numberAccess
        )
    }

    func testNumberAccessWinsOverEveryOtherBanner() {
        // A note-only member told "your subscription is past due" learns
        // something true, irrelevant and unfixable by them: they could not text
        // on this number either way, and they cannot pay the bill.
        XCTAssertEqual(
            selectComposerBanner(
                contactOptedOut: true,
                contactOptOutSource: "stop_keyword",
                subscriptionStatus: "past_due",
                destinationCountry: "US",
                usApproved: false,
                usTextingOff: true,
                usage: usage(used: 2000, cap: 100),
                optOutHint: true,
                usSuspended: true,
                viewerLevel: "note"
            ),
            .numberAccess
        )
    }

    func testSaysNothingAtAllForAMemberWhoCanText() {
        // The regression that would matter most: a banner shown to everybody
        // would replace the composer for the whole crew.
        XCTAssertNil(
            selectComposerBanner(
                contactOptedOut: false,
                contactOptOutSource: nil,
                subscriptionStatus: SubscriptionStatus.active,
                destinationCountry: "CA",
                usApproved: true,
                usTextingOff: false,
                usage: usage(used: 10, cap: 100),
                viewerLevel: "text"
            )
        )
    }

    func testTheNumberAccessBannerNeverOffersACall() {
        // Whether a note-only member may CALL is a separate access question,
        // and pointing at a second thing they may also lack would be a second
        // dead end.
        XCTAssertFalse(offersCallInstead(.numberAccess))
    }

    func testNoteOnlyBannerNamesTheCallsConsequenceToo() {
        // #348: dial targets and the call push audience are filtered by 'text'
        // level, so a note-only member also never rings and never gets call
        // notifications — and until this line, nothing anywhere said so. The
        // composer banner is the one place they meet the restriction.
        let copy = bannerCopy(.numberAccess)
        XCTAssertTrue(
            copy.body.lowercased().contains("ring"),
            "the note-only banner must mention calls: \(copy.body)"
        )
    }

}
