import XCTest
@testable import Loonext

/// #332 — the sentences a workspace reads while it is changing hands.
///
/// Ported 1:1 from the Android twin's OwnershipCopyTest. These are copy, not
/// layout, and they are hand-ported to three clients. The failure mode is not
/// a crash: it is one client telling a workspace something subtly different
/// about who is taking it over and by when, which is exactly the confusion an
/// ownership handover cannot afford.
final class OwnershipCopyTests: XCTestCase {
    private let ripens = "2026-08-05T12:00:00Z"
    private let expires = "2026-08-05T12:00:00Z"

    func testAnOfferNamesTheRecipientAClaimNamesThePersonAsking() {
        XCTAssertEqual(
            handoverHeadline(HandoverKind.offer, who: "Riley Partner"),
            "Ownership has been offered to Riley Partner."
        )
        XCTAssertEqual(
            handoverHeadline(HandoverKind.claim, who: "Riley Partner"),
            "Riley Partner has asked to take over this workspace."
        )
    }

    func testAnOfferSaysNothingHasChangedYet() {
        let text = handoverDetail(
            HandoverKind.offer, ready: false, ripensAt: ripens, expiresAt: expires
        )
        XCTAssertTrue(text.hasPrefix("Nothing changes until they accept."), text)
    }

    func testAClaimInItsWaitingPeriodTellsTheOwnerTheyCanStillStopIt() {
        let text = handoverDetail(
            HandoverKind.claim, ready: false, ripensAt: ripens, expiresAt: expires
        )
        // The whole safety property of the claim path is that the owner knows
        // they have a deadline AND a veto. Both have to be in this sentence.
        XCTAssertTrue(text.contains("unless the owner stops it"), text)
        XCTAssertTrue(text.contains("immediately"), text)
        // And it must never read as though it already happened.
        XCTAssertFalse(text.contains("has taken over"), text)
    }

    func testARipeClaimStopsPromisingADeadlineThatHasPassed() {
        XCTAssertEqual(
            handoverDetail(
                HandoverKind.claim, ready: true, ripensAt: ripens, expiresAt: expires
            ),
            "The waiting period is over. They can complete this at any time."
        )
    }

    func testTheSameButtonReadsAsAVetoToAnOwnerAndADeclineToARecipient() {
        // One call, one outcome, two different things a person is doing.
        XCTAssertEqual(handoverCancelLabel(isOwner: true, isMine: false), "Stop this")
        XCTAssertEqual(handoverCancelLabel(isOwner: false, isMine: true), "Decline")
        // An owner turning down an offer aimed at THEM is declining, not
        // vetoing — they are the recipient in that case.
        XCTAssertEqual(handoverCancelLabel(isOwner: true, isMine: true), "Decline")
    }

    func testAbsentServerFlagsDecodeToTheSAFEAnswer() throws {
        // An older server, or a field we have not sent yet: every permission
        // must default to "no". A flag that decoded to true by accident would
        // put a button that takes a business in front of somebody.
        let json = """
        {"owner_member_id":"m-1","backup_member_id":null,"pending":null}
        """
        let decoded = try JSONDecoder().decode(Ownership.self, from: Data(json.utf8))
        XCTAssertFalse(decoded.isOwner)
        XCTAssertFalse(decoded.isBackup)
        XCTAssertFalse(decoded.canOffer)
        XCTAssertFalse(decoded.canClaim)
        XCTAssertFalse(decoded.canCancel)
    }

    func testAPendingHandoverWithNoFlagsIsNeitherMineNorReady() throws {
        let json = """
        {"kind":"claim","to_member_id":"m-2","ripens_at":"\(ripens)",
         "expires_at":"\(expires)","created_at":"\(ripens)"}
        """
        let decoded = try JSONDecoder().decode(PendingHandover.self, from: Data(json.utf8))
        // "Not ready" is the safe default: it hides the button that completes
        // a takeover rather than showing one that would fail.
        XCTAssertFalse(decoded.isMine)
        XCTAssertFalse(decoded.isReady)
    }

    // MARK: - #515: the same handover, read by the person it is happening to
    //
    // Vectors shared with packages/shared/src/handover.test.ts and the Android
    // twin. Built by DECODING rather than by the memberwise init, so each one
    // also proves the wire shape the server actually sends.

    private func ownership(canClaim: Bool = false, pending: String = "null") throws -> Ownership {
        let json = """
        {"owner_member_id":"m-1","backup_member_id":"m-2",
         "can_claim":\(canClaim),"pending":\(pending)}
        """
        return try JSONDecoder().decode(Ownership.self, from: Data(json.utf8))
    }

    private func pendingJSON(kind: String, mine: Bool, ready: Bool) -> String {
        """
        {"kind":"\(kind)","to_member_id":"m-2","ripens_at":"\(ripens)",
         "expires_at":"\(expires)","created_at":"\(ripens)",
         "mine":\(mine),"ready":\(ready)}
        """
    }

    func testTheNamedBackupIsGivenSomewhereToStart() throws {
        // The bug #515 reported, at its root: this person could reach the API
        // and not the button, on a phone with no URL bar to type around it.
        XCTAssertEqual(
            viewerHandoverPrompt(try ownership(canClaim: true)),
            HandoverPrompt.backupStanding
        )
    }

    func testAnOfferAddressedToTheReaderIsTheirsToAccept() throws {
        XCTAssertEqual(
            viewerHandoverPrompt(
                try ownership(
                    pending: pendingJSON(kind: HandoverKind.offer, mine: true, ready: true)
                )
            ),
            HandoverPrompt.acceptOffer
        )
    }

    func testAClaimWaitsUntilItsVetoWindowCloses() throws {
        XCTAssertEqual(
            viewerHandoverPrompt(
                try ownership(
                    pending: pendingJSON(kind: HandoverKind.claim, mine: true, ready: false)
                )
            ),
            HandoverPrompt.claimWaiting
        )
        XCTAssertEqual(
            viewerHandoverPrompt(
                try ownership(
                    pending: pendingJSON(kind: HandoverKind.claim, mine: true, ready: true)
                )
            ),
            HandoverPrompt.completeClaim
        )
    }

    func testSomebodyElsesHandoverIsNotThisReadersPrompt() throws {
        XCTAssertNil(viewerHandoverPrompt(try ownership()))
        XCTAssertNil(
            viewerHandoverPrompt(
                try ownership(
                    pending: pendingJSON(kind: HandoverKind.claim, mine: false, ready: true)
                )
            )
        )
    }

    func testThePromptSpeaksToTheReaderAndNeverAsksThemToDeclineTheirOwnRequest() {
        for kind in [
            HandoverPrompt.acceptOffer,
            HandoverPrompt.completeClaim,
            HandoverPrompt.claimWaiting,
            HandoverPrompt.backupStanding,
        ] {
            let line = handoverPromptHeadline(kind)
            XCTAssertTrue(line.hasPrefix("You"), line)
            XCTAssertTrue(line.hasSuffix("."), line)
        }
        XCTAssertEqual(handoverPromptCancelLabel(HandoverPrompt.acceptOffer), "Decline")
        XCTAssertEqual(
            handoverPromptCancelLabel(HandoverPrompt.completeClaim),
            "Withdraw my request"
        )
        // A standing nomination has nothing to call off.
        XCTAssertNil(handoverPromptCancelLabel(HandoverPrompt.backupStanding))
    }

    func testTheStandingNominationExplainsWhatItIsForNotWhatToDoNow() {
        let text = handoverPromptDetail(
            HandoverPrompt.backupStanding, ripensAt: ripens, expiresAt: expires
        )
        XCTAssertTrue(text.contains("Nothing changes until you ask."), text)
        let waiting = handoverPromptDetail(
            HandoverPrompt.claimWaiting, ripensAt: ripens, expiresAt: expires
        )
        // Same safety property as the crew-facing line: a deadline and a veto.
        XCTAssertTrue(waiting.contains("can stop this until"), waiting)
    }
}
