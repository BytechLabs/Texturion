import XCTest

@testable import Loonext

/// #476 — the first-run checklist, hand-ported from web.
///
/// Every case asserts a POSITIVE as well as a refusal, deliberately. A port
/// that never marks anything done passes a suite made only of refusals, and
/// that is the shape an inverted condition actually takes.
///
/// The mirror of this file is
/// `apps/android/app/src/test/kotlin/com/loonext/android/features/inbox/GettingStartedLogicTest.kt`.
/// Adding a case here means adding it there.
final class GettingStartedLogicTests: XCTestCase {

    private func number(_ status: String) -> PhoneNumberSummary {
        PhoneNumberSummary(
            id: "num-1",
            status: status,
            country: "CA",
            number_e164: "+14155560100",
            requested_area_code: nil,
            created_at: "2026-08-01T00:00:00Z",
            source: nil,
            voice_enabled: nil,
            suspended_at: nil,
            released_at: nil,
            failure_reason: nil,
            provision_attempts: nil,
            retrying: nil
        )
    }

    private func member(deactivated: String?) -> Member {
        Member(
            id: "m-\(deactivated ?? "active")",
            user_id: "u-\(deactivated ?? "active")",
            role: MemberRole.member,
            deactivated_at: deactivated,
            created_at: "2026-08-01T00:00:00Z",
            display_name: "Sam"
        )
    }

    /// `@Default` supplies a decoding fallback, NOT a memberwise default, so
    /// every field is spelled out here.
    private func firsts(
        replied: Bool = false,
        noted: Bool = false,
        markedDone: Bool = false,
        // #286: nothing in this file is about the joining flow, and the
        // checklist reads none of it — but the memberwise init demands every
        // field, so it is spelled out here for the same reason the other three
        // are.
        oriented: Bool = true
    ) -> MemberFirsts {
        MemberFirsts(
            replied: replied,
            noted: noted,
            marked_done: markedDone,
            oriented: oriented
        )
    }

    // MARK: - the paid gate

    func testTreatsPastDueAndUnpaidAsPaidLikeWebDoes() {
        // The narrow reading (only "active") would hide the card from a
        // workspace in exactly the state where somebody is most likely to be
        // confused about their account.
        XCTAssertTrue(hasPaidStatus("active"))
        XCTAssertTrue(hasPaidStatus("past_due"))
        XCTAssertTrue(hasPaidStatus("unpaid"))
    }

    func testDoesNotTreatAnUnstartedOrCancelledWorkspaceAsPaid() {
        XCTAssertFalse(hasPaidStatus("incomplete"))
        XCTAssertFalse(hasPaidStatus("incomplete_expired"))
        XCTAssertFalse(hasPaidStatus("canceled"))
        XCTAssertFalse(hasPaidStatus(nil))
    }

    // MARK: - who sees which card

    func testOwnerAndAdminGetTheSetupList() {
        XCTAssertEqual(startedAudience(MemberRole.owner), .setup)
        XCTAssertEqual(startedAudience(MemberRole.admin), .setup)
    }

    func testAMemberGetsTheDoingTheJobList() {
        XCTAssertEqual(startedAudience(MemberRole.member), .doingTheJob)
    }

    func testAReadOnlyObserverGetsNoCardAtAll() {
        // Web hands read_only the member list, whose three items are all
        // things that role provably cannot do: it holds workspace.access and
        // conversations.read and nothing else. A checklist of instructions
        // somebody cannot follow is worse than no checklist.
        XCTAssertFalse(MemberRole.has("read_only", Capability.conversationsSend))
        XCTAssertEqual(startedAudience("read_only"), .none)
        // Fail closed on anything the client does not recognise.
        XCTAssertEqual(startedAudience(nil), .none)
        XCTAssertEqual(startedAudience("something_new"), .none)
    }

    // MARK: - the owner list

    func testCreditsTheSetupAlreadyDoneSoTheBarNeverStartsAtZero() {
        let steps = ownerSteps(
            numbers: [],
            hasConversation: false,
            usedSegments: 0,
            activeMemberCount: 1
        )
        XCTAssertEqual(steps.first?.key, "signup")
        XCTAssertEqual(steps.first?.done, true)
        XCTAssertNil(steps.first?.hint)
    }

    func testMarksTheNumberDoneOnlyWhenOneIsActuallyActive() {
        let provisioning = ownerSteps(
            numbers: [number("provisioning")],
            hasConversation: false,
            usedSegments: 0,
            activeMemberCount: 1
        )
        let pending = provisioning.first { $0.key == "number" }
        XCTAssertEqual(pending?.done, false)
        XCTAssertEqual(pending?.hint, "It's on its way, usually under a minute.")

        let live = ownerSteps(
            numbers: [number("active")],
            hasConversation: false,
            usedSegments: 0,
            activeMemberCount: 1
        )
        XCTAssertEqual(live.first { $0.key == "number" }?.done, true)
        XCTAssertNil(live.first { $0.key == "number" }?.hint)
    }

    func testStopsPromisingAMinuteOnceThePurchaseHasActuallyStalled() {
        let stalled = ownerSteps(
            numbers: [number("provision_failed")],
            hasConversation: false,
            usedSegments: 0,
            activeMemberCount: 1
        )
        XCTAssertEqual(
            stalled.first { $0.key == "number" }?.hint,
            "Taking a little longer than usual. You don't need to do anything."
        )
    }

    func testDerivesInboundReplyAndTeammateFromRealCounts() {
        let nothing = ownerSteps(
            numbers: [],
            hasConversation: false,
            usedSegments: 0,
            activeMemberCount: 1
        )
        XCTAssertEqual(nothing.first { $0.key == "inbound" }?.done, false)
        XCTAssertEqual(nothing.first { $0.key == "reply" }?.done, false)
        XCTAssertEqual(nothing.first { $0.key == "teammate" }?.done, false)

        let everything = ownerSteps(
            numbers: [number("active")],
            hasConversation: true,
            usedSegments: 3,
            activeMemberCount: 2
        )
        XCTAssertEqual(everything.first { $0.key == "inbound" }?.done, true)
        XCTAssertEqual(everything.first { $0.key == "reply" }?.done, true)
        XCTAssertEqual(everything.first { $0.key == "teammate" }?.done, true)
        XCTAssertTrue(stepsComplete(everything))
    }

    func testOneMemberIsNotATeammate() {
        // The owner alone is one active member; the step is about a SECOND.
        XCTAssertEqual(countActiveStartedMembers([member(deactivated: nil)]), 1)
        XCTAssertEqual(
            countActiveStartedMembers([
                member(deactivated: nil),
                member(deactivated: "2026-01-01T00:00:00Z"),
            ]),
            1
        )
        XCTAssertEqual(
            countActiveStartedMembers([member(deactivated: nil), member(deactivated: nil)]),
            2
        )
        let alone = ownerSteps(
            numbers: [],
            hasConversation: true,
            usedSegments: 1,
            activeMemberCount: 1
        )
        XCTAssertEqual(alone.first { $0.key == "teammate" }?.done, false)
        let crew = ownerSteps(
            numbers: [],
            hasConversation: true,
            usedSegments: 1,
            activeMemberCount: 2
        )
        XCTAssertEqual(crew.first { $0.key == "teammate" }?.done, true)
    }

    // MARK: - the member list

    func testTheMemberListEmptiesItselfAsTheyDoTheThings() {
        let fresh = memberSteps(firsts())
        XCTAssertEqual(fresh.map(\.key), ["reply", "note", "done"])
        XCTAssertTrue(fresh.allSatisfy { !$0.done })
        XCTAssertFalse(stepsComplete(fresh))
        // Every undone row explains itself; a bare label teaches nothing.
        XCTAssertTrue(fresh.allSatisfy { $0.hint != nil })

        let allDone = memberSteps(firsts(replied: true, noted: true, markedDone: true))
        XCTAssertTrue(stepsComplete(allDone))
        XCTAssertTrue(allDone.allSatisfy { $0.hint == nil })
    }

    func testTheNoteRowWarnsThatANoteIsNotAText() {
        // The one worth learning deliberately rather than by accident: getting
        // it wrong means a customer received something meant for a colleague.
        let note = memberSteps(firsts()).first { $0.key == "note" }
        XCTAssertTrue(note?.hint?.contains("the customer never sees them") == true)
    }

    func testAPartlyFinishedListIsNotComplete() {
        XCTAssertFalse(stepsComplete(memberSteps(firsts(replied: true))))
        XCTAssertFalse(stepsComplete(memberSteps(firsts(replied: true, noted: true))))
    }

    // MARK: - dismissal

    @MainActor
    func testDismissalIsPerCompanyAndPerCardKind() {
        let suiteName = "started-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = StartedDismissals(defaults: defaults)

        XCTAssertFalse(store.isDismissed("co-1", .setup))
        store.dismiss("co-1", .setup)
        XCTAssertTrue(store.isDismissed("co-1", .setup))
        // Dismissing one card must not hide the other, and must not reach
        // another workspace.
        XCTAssertFalse(store.isDismissed("co-1", .doingTheJob))
        XCTAssertFalse(store.isDismissed("co-2", .setup))
    }
}
