import XCTest
@testable import Loonext

/// Pure settings logic (#163) — the Android twin's SettingsLogicTest vectors,
/// ported 1:1 so the two clients promise the same numbers, gates, and copy.
final class SettingsLogicTests: XCTestCase {
    // MARK: - Fixtures

    private func member(
        _ id: String,
        role: String = MemberRole.member,
        deactivatedAt: String? = nil,
        userId: String? = nil
    ) -> Member {
        Member(
            id: id,
            user_id: userId ?? "user-\(id)",
            role: role,
            deactivated_at: deactivatedAt,
            created_at: "2026-07-01T00:00:00Z",
            display_name: "Member \(id)"
        )
    }

    private func invite(
        _ id: String,
        expiresAt: String,
        acceptedAt: String? = nil,
        revokedAt: String? = nil
    ) -> Invite {
        Invite(
            id: id,
            company_id: "co",
            email: "\(id)@example.com",
            role: MemberRole.member,
            invited_by: "user-1",
            expires_at: expiresAt,
            accepted_at: acceptedAt,
            revoked_at: revokedAt,
            created_at: "2026-07-01T00:00:00Z",
            email_sent: nil,
            company_name: nil,
            // #521: the seat math these fixtures feed does not read the note.
            // An invite without one is the ordinary invite.
            note: nil
        )
    }

    private func date(_ iso: String) throws -> Date {
        try XCTUnwrap(ISO8601DateFormatter().date(from: iso))
    }

    // MARK: - Seat math (mirror of routes/team.ts + lib/settings/seat-line.ts)

    func testSeatLimitReadsNullPlanAsStarter() {
        XCTAssertEqual(seatLimit(nil), 3)
        XCTAssertEqual(seatLimit("starter"), 3)
        XCTAssertEqual(seatLimit("pro"), 15)
    }

    func testPendingInvitesExcludeAcceptedRevokedAndExpiredRows() throws {
        let now = try date("2026-07-15T12:00:00Z")
        let invites = [
            invite("live", expiresAt: "2026-07-16T00:00:00Z"),
            invite("expired", expiresAt: "2026-07-14T00:00:00Z"),
            invite("accepted", expiresAt: "2026-07-16T00:00:00Z", acceptedAt: "2026-07-10T00:00:00Z"),
            invite("revoked", expiresAt: "2026-07-16T00:00:00Z", revokedAt: "2026-07-10T00:00:00Z"),
            invite("garbage", expiresAt: "not-a-date"),
        ]
        XCTAssertEqual(pendingInviteCount(invites, now: now), 1)
    }

    func testSeatUsageCountsActiveMembersPlusPendingInvites() {
        let members = [
            member("1", role: MemberRole.owner),
            member("2"),
            member("3", deactivatedAt: "2026-07-10T00:00:00Z"),
        ]
        let usage = seatUsage(
            activeMembers: countActiveMembers(members),
            pendingInvites: 1,
            plan: "starter"
        )
        XCTAssertEqual(usage.used, 3)
        XCTAssertEqual(usage.limit, 3)
        XCTAssertTrue(usage.full)
        XCTAssertEqual(usage.line, "3 of 3 seats. Upgrade for more")
    }

    func testFullProPlanGetsNoUpgradeNudge() {
        // Pro is the top self-serve plan.
        let usage = seatUsage(activeMembers: 15, pendingInvites: 0, plan: "pro")
        XCTAssertTrue(usage.full)
        XCTAssertEqual(usage.line, "15 of 15 seats")
    }

    func testUnderCapacityReadsPlainly() {
        XCTAssertEqual(seatUsage(activeMembers: 2, pendingInvites: 0, plan: nil).line, "2 of 3 seats")
        XCTAssertFalse(seatUsage(activeMembers: 2, pendingInvites: 0, plan: nil).full)
    }

    // MARK: - The invite note's cap (#521)

    func testTheCapIsMeasuredTheWayTheServerMeasuresIt() {
        // `String.count` is grapheme clusters and would answer 1 here. The
        // route's zod `.max(500)` counts UTF-16 code units and the column's
        // `char_length` counts code points, so a cap built on clusters passes a
        // note the route then refuses with a 422, which is the one outcome the
        // cap exists to prevent.
        let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}"
        XCTAssertEqual(family.count, 1)
        XCTAssertEqual(inviteNoteLength(family), 8)
        XCTAssertEqual(inviteNoteLength("abc"), 3)
    }

    func testAnOverLongPasteIsCutRatherThanDropped() {
        // A setter that refuses a value leaves the field empty and says
        // nothing. Truncating puts the first 500 in and lets the count say so.
        let pasted = String(repeating: "a", count: 600)
        XCTAssertEqual(truncatedInviteNote(pasted).count, inviteNoteMax)
        XCTAssertEqual(inviteNoteLength(truncatedInviteNote(pasted)), inviteNoteMax)
    }

    func testANoteThatFitsIsReturnedUntouched() {
        // Including the exact-length one, which must not lose its last
        // character to an off-by-one.
        XCTAssertEqual(truncatedInviteNote("Ask Dave for the keys."), "Ask Dave for the keys.")
        let exact = String(repeating: "a", count: inviteNoteMax)
        XCTAssertEqual(truncatedInviteNote(exact), exact)
        XCTAssertEqual(truncatedInviteNote(""), "")
    }

    func testTheCutLandsBetweenCharactersAndNotInsideOne() {
        // Cutting on UTF-16 units directly would split the last emoji and leave
        // a lone surrogate. Whole characters are kept or dropped.
        let emoji = String(repeating: "\u{1F600}", count: 300)
        let cut = truncatedInviteNote(emoji)
        XCTAssertEqual(inviteNoteLength(cut), inviteNoteMax)
        XCTAssertEqual(cut.count, 250)
        XCTAssertEqual(cut, String(repeating: "\u{1F600}", count: 250))
    }

    func testAClusterThatWouldStraddleTheCapIsLeftOutWhole() {
        // 499 units of room and a 2-unit character next: keeping half of it
        // would be a broken glyph, so the cut stops in front of it. Everything
        // after stops with it, because this is a prefix and not a sieve:
        // dropping one character out of the middle of somebody's sentence and
        // keeping the rest would change what they wrote.
        let note = String(repeating: "a", count: inviteNoteMax - 1) + "\u{1F600}b"
        let cut = truncatedInviteNote(note)
        XCTAssertEqual(cut, String(repeating: "a", count: inviteNoteMax - 1))
        XCTAssertEqual(inviteNoteLength(cut), inviteNoteMax - 1)
    }

    // MARK: - Why a workspace is leaving (#277)

    func testTheSixReasonCodesAreTheOnesEveryClientOffers() {
        // The codes are what the report groups by, so a client that spelled one
        // differently would split the same answer into two buckets and neither
        // number would mean anything. The order is the order they are offered.
        XCTAssertEqual(
            cancellationReasons.map(\.code),
            ["too_expensive", "seasonal", "missing_feature", "switched", "not_using", "other"]
        )
        XCTAssertEqual(
            cancellationReasons.map(\.label),
            [
                "Too expensive",
                "Quiet season, I'll be back",
                "Missing something I need",
                "Going with something else",
                "Not using it",
                "Something else",
            ]
        )
    }

    func testEveryOfferedCodeFitsTheColumnItIsStoredIn() {
        // `reason text check (char_length(reason) <= 40)`, and the route's zod
        // says the same. A code that outgrew it would 422 the whole record.
        for reason in cancellationReasons {
            XCTAssertFalse(reason.code.isEmpty, reason.label)
            XCTAssertLessThanOrEqual(reason.code.utf16.count, 40, reason.code)
            XCTAssertFalse(reason.label.isEmpty, reason.code)
        }
    }

    func testSkippingTheQuestionStillPostsARecord() {
        // `{}` is the whole point rather than an edge case: it records that
        // somebody was asked and went straight through, which is the only thing
        // that makes "how many answered" a fraction of anything.
        XCTAssertEqual(cancellationReasonBody(reason: nil, detail: ""), .object([:]))
        XCTAssertEqual(cancellationReasonBody(reason: nil, detail: "   \n  "), .object([:]))
    }

    func testTheBodyCarriesOnlyWhatWasActuallySaid() {
        XCTAssertEqual(
            cancellationReasonBody(reason: "seasonal", detail: ""),
            .object(["reason": .string("seasonal")])
        )
        XCTAssertEqual(
            cancellationReasonBody(reason: nil, detail: "  too many texts  "),
            .object(["detail": .string("too many texts")])
        )
        XCTAssertEqual(
            cancellationReasonBody(reason: "other", detail: "moving to a landline"),
            .object([
                "reason": .string("other"),
                "detail": .string("moving to a landline"),
            ])
        )
    }

    func testAnOverLongDetailIsCutRatherThanRejected() {
        // The POST is never waited on, so a 422 would throw the words away with
        // nobody told. Truncating keeps the first 2000 of them.
        let pasted = String(repeating: "a", count: cancellationDetailMax + 100)
        XCTAssertEqual(truncatedCancellationDetail(pasted).utf16.count, cancellationDetailMax)
        let exact = String(repeating: "a", count: cancellationDetailMax)
        XCTAssertEqual(truncatedCancellationDetail(exact), exact)
        XCTAssertEqual(truncatedCancellationDetail("plumbing is quiet in January"),
                       "plumbing is quiet in January")
    }

    func testTheDetailCutLandsBetweenCharactersAndNotInsideOne() {
        // Same measure as the invite note's cap: the server counts UTF-16 units
        // and one emoji is two of them, so cutting on Swift Characters would
        // send 2000 clusters into a field that takes 2000 units.
        let emoji = String(repeating: "\u{1F600}", count: cancellationDetailMax)
        let cut = truncatedCancellationDetail(emoji)
        XCTAssertEqual(cut.utf16.count, cancellationDetailMax)
        XCTAssertEqual(cut.count, cancellationDetailMax / 2)
        XCTAssertEqual(cut, String(repeating: "\u{1F600}", count: cancellationDetailMax / 2))
    }

    /// POST /v1/billing/portal mints the full portal for an owner and a
    /// `payment_method_update` session for everybody else, and that Stripe flow
    /// has no cancellation surface on it. Offering the button to an admin or a
    /// bookkeeper walks them to a page where the thing they were promised does
    /// not exist, and files a reason against a cancellation that can never be
    /// confirmed.
    func testOnlyTheOwnerIsOfferedTheCancellation() {
        XCTAssertTrue(SettingsRoleGate.canCancelSubscription(MemberRole.owner))
        XCTAssertFalse(SettingsRoleGate.canCancelSubscription(MemberRole.admin))
        XCTAssertFalse(SettingsRoleGate.canCancelSubscription(MemberRole.bookkeeper))
        XCTAssertFalse(SettingsRoleGate.canCancelSubscription(MemberRole.member))
        XCTAssertFalse(SettingsRoleGate.canCancelSubscription(MemberRole.readOnly))
        XCTAssertFalse(SettingsRoleGate.canCancelSubscription(nil))
        // The bookkeeper still holds billing generally. The two questions are
        // different, and collapsing them into one would hide the whole card
        // from the role that exists to read it.
        XCTAssertTrue(SettingsRoleGate.canManageBilling(MemberRole.bookkeeper))
    }

    // MARK: - The cancel card, as it is first seen (#277)
    //
    // Every rule below is a WIRING property of a SwiftUI view, which no amount
    // of arithmetic can raise. They are pinned by reading the source, in the
    // idiom `ColorLiteralLintTests` already uses here and `CancellationFlowTest`
    // uses on the Android side. Each one fails if the specific dark pattern it
    // names is introduced, which is the only thing that earns a lint of this
    // kind its place.

    /// THE guarantee: from arriving at the billing screen, one action reaches
    /// Stripe.
    ///
    /// The card was built collapsed once, copying the neighbouring delete
    /// control, and that made leaving cost two actions against a "Manage
    /// payment & invoices" button beside it that costs one. Deliberate friction
    /// belongs on deleting an account, which cannot be undone; on a
    /// subscription it is a regulatory problem in several of the markets this
    /// sells into. A collapse arrives as a new piece of view state, so pinning
    /// the whole set of it is what makes this fail when one is added back.
    func testTheLeaveControlIsOnTheCardBeforeAnythingIsTapped() throws {
        let card = try cancelCardSource()
        XCTAssertTrue(
            card.contains("\"Continue to cancel\""),
            "the cancel card must carry the control that leaves"
        )
        XCTAssertEqual(
            Set(declaredState(card)),
            Set(["chosen", "detail", "opening", "error", "exporting", "exportError", "exported"]),
            "the cancel card grew or lost view state. If this is a new flag that "
                + "hides the card behind a trigger (expanded, showing, cancelling), it "
                + "is the two-step funnel this card exists to not be: render open."
        )
    }

    /// The order the contract asks for: what happens, then the quiet question,
    /// then the export that serves the person leaving, then the way out. The
    /// export comes before the button because it is the half that is theirs.
    func testTheQuestionTheExportAndTheWayOutAreAllOnTheOneCard() throws {
        let card = try cancelCardSource()
        let rendered = try section(of: card, from: "private var leaving: some View {")
        guard let question = rendered.range(of: "reasonQuestion"),
              let export = rendered.range(of: "exportOffer"),
              let leave = rendered.range(of: "\"Continue to cancel\"") else {
            return XCTFail("the cancel card no longer renders all three parts together")
        }
        XCTAssertTrue(
            question.lowerBound < export.lowerBound && export.lowerBound < leave.lowerBound,
            "the question, then the export, then the button that leaves"
        )
        XCTAssertTrue(
            card.contains("\"Take your contacts with you\""),
            "somebody leaving still needs their customer list"
        )
    }

    /// The trap this pins is a greyed-out "Continue to cancel" waiting for an
    /// answer. Only the request already in flight may ever disable a control
    /// here.
    func testNothingOnTheCardMayDisableTheWayOut() throws {
        let card = try cancelCardSource()
        for expression in disabledExpressions(card) {
            XCTAssertFalse(
                expression.contains("chosen") || expression.contains("detail"),
                "a control on the cancel card is gated on the answer "
                    + "(.disabled(\(expression))): the way through must never depend on "
                    + "answering the question"
            )
        }
        XCTAssertTrue(
            card.contains(".disabled(opening)"),
            "the button that leaves is disabled by the in-flight request and nothing else"
        )
    }

    /// Nothing between "Continue to cancel" and Stripe — read over the CARD AND
    /// EVERYTHING IT RENDERS.
    ///
    /// WHY THIS WAS REWRITTEN. The previous version asked `CancelCard`'s own
    /// source for `.sheet(isPresented:` and forbade it outright. By the time
    /// the #277 answer shipped, that assertion was decorative: the one sheet
    /// under this card lives in `CancellationAnswerNote`, a separate struct
    /// rendered inside the card's subtree, so the substring was simply not in
    /// the text being searched. The path to Stripe was genuinely unaffected —
    /// but the guard had stopped enforcing what it was written to enforce while
    /// still reading as though it did, which is worse than not having it.
    ///
    /// AND WHY THE RULE CHANGED WITH IT. A blanket ban is now the wrong rule,
    /// because the subtree legitimately contains two modals: the plan switcher
    /// behind "Switch to Starter", and the share sheet after an export. Neither
    /// is on the way out. What may never happen is the press that LEAVES
    /// opening one, so that is what is asserted — plus no confirmation step
    /// anywhere beneath the card, which is the hole the old version had.
    func testNothingStandsBetweenTheCardAndStripe() throws {
        let subtree = try cancelCardSubtree()
        let names = subtree.map(\.name)
        XCTAssertTrue(
            names.contains("CancellationAnswerNote"),
            "the walk no longer reaches the answer note — renamed, or no longer "
                + "rendered from the card? — so this guard is reading CancelCard "
                + "alone again, which is exactly how it went blind the first time. "
                + "Re-point it before trusting it. Reached: \(names)"
        )

        // A confirmation is banned on the way OUT, not everywhere beneath the
        // card. `PauseOfferNote` asks before it pauses, and it is right to: that
        // press starts a recurring charge, which is the one place in this
        // subtree where a deliberate pause belongs. Banning the type outright
        // said "no friction anywhere" when the rule is "no friction on the
        // exit", and it turned a correct money confirmation into a failure.
        //
        // The exit is inside `leaving`, so that is where the ban applies. The
        // `handOff()` check at the foot of this test is the other half: a modal
        // is fine when a press of its own opens it, and never when the press
        // that leaves does.
        let cardSource = try cancelCardSource()
        let leaving = try section(of: cardSource, from: "private var leaving: some View {")
        XCTAssertFalse(
            leaving.contains("ConfirmSheet"),
            "an 'are you sure' step in `leaving` sits on the way out, which is the "
                + "friction the rule forbids. A confirmation elsewhere under this "
                + "card is fine when its own control opens it"
        )

        for view in subtree {
            XCTAssertFalse(
                view.source.contains(".fullScreenCover("),
                "\(view.name): a full-screen cover under the cancel card is a second "
                    + "screen by any other name"
            )
            XCTAssertFalse(
                view.source.contains("Never mind"),
                "\(view.name): a second button beside the confirm invites the "
                    + "asymmetry this card avoids: with nothing expanded there is "
                    + "nothing to back out of"
            )
        }

        // A modal under this card is fine when a press of its own opens it.
        // What may never open one is the press that leaves.
        let flags = presentationBindings(subtree.map(\.source).joined(separator: "\n"))
        XCTAssertFalse(
            flags.isEmpty,
            "no modal binding found anywhere under the cancel card. This subtree has "
                + "presented at least the contacts share sheet since #277, so an empty "
                + "result means the scanner stopped matching, not that the card got "
                + "simpler — the loop below would check nothing"
        )
        let card = try cancelCardSource()
        let handOff = try section(of: card, from: "private func handOff() {")
        for flag in flags.sorted() {
            XCTAssertFalse(
                handOff.contains("\(flag) ="),
                "handOff() sets `\(flag)`, which presents a modal: that is a second "
                    + "screen between 'Continue to cancel' and Stripe"
            )
        }
    }

    func testNoReasonIsPreSelected() throws {
        let card = try cancelCardSource()
        // The trailing newline is the assertion: `chosen: String?` on its own
        // is nil, and `chosen: String? = "too_expensive"` reads as the same
        // declaration until you notice the rest of the line.
        XCTAssertTrue(
            card.contains("@State private var chosen: String?\n"),
            "declared with no value: a default answer is a reason nobody gave, and every "
                + "count built on it is wrong in the direction we chose"
        )
        XCTAssertTrue(
            card.contains("ForEach(cancellationReasons)"),
            "the rows come from the shared list; a second copy here would drift from the "
                + "codes the API stores"
        )
    }

    /// The load-bearing one. If the reason POST ever moves onto the path to the
    /// portal, a dead endpoint of ours becomes a person who cannot cancel.
    func testTheReasonRidesBesideTheHandoffAndNeverInFrontOfIt() throws {
        let card = try cancelCardSource()
        XCTAssertEqual(
            card.components(separatedBy: "recordCancellationReason").count - 1, 1,
            "exactly one call site on the card"
        )
        let handOff = try section(of: card, from: "private func handOff() {")
        XCTAssertTrue(
            handOff.contains("guard canCancel else { return }"),
            "no reason is posted for somebody who cannot cancel: that row could never be "
                + "confirmed, and it would sit in the report as somebody who said why and stayed"
        )
        guard let record = handOff.range(of: "recordCancellationReason"),
              let portal = handOff.range(of: "billingPortal") else {
            return XCTFail("the handoff no longer records a reason or no longer opens the portal")
        }
        XCTAssertTrue(
            record.lowerBound < portal.lowerBound,
            "the record is started first; the browser takes this screen away"
        )
        XCTAssertTrue(
            String(handOff[..<record.lowerBound]).suffix(40).contains("try? await"),
            "the record's failure is discarded where it is made. A plain `try await` here "
                + "hands a rejection back to the code on its way to the portal"
        )
        XCTAssertTrue(
            String(handOff[record.lowerBound ..< portal.lowerBound]).contains("Task {"),
            "and the portal runs on a task of its own. Sharing one with the record puts "
                + "our bookkeeping in front of somebody's cancellation, which is the exact "
                + "failure this screen exists to avoid"
        )
    }

    /// "Cancel anytime." is false for two of the three roles that can open this
    /// screen. Each reader is told what is true for them, and the branch has to
    /// stay pointing the right way round.
    func testTheConsequenceCopyIsTrueForWhoeverIsReadingIt() throws {
        let card = try cancelCardSource()
        let copy = try section(of: card, from: "private var consequence: String {")
        guard let owner = copy.range(of: "\"Cancel anytime."),
              let other = copy.range(of: "\"Only the owner can cancel this plan.") else {
            return XCTFail("the cancel card no longer says something different to a non-owner")
        }
        // The gate itself, not just a mention of it. `!canCancel ? …` reads
        // identically at a glance and promises an admin the one thing they
        // cannot do.
        XCTAssertTrue(
            copy.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("canCancel"),
            "the branch has to stay pointing this way round: canCancel ? owner : everybody else"
        )
        XCTAssertTrue(
            owner.lowerBound < other.lowerBound,
            "the owner reads 'Cancel anytime', everybody else reads who can"
        )
        XCTAssertTrue(
            card.contains("The payment portal above is for cards and invoices and has no ")
                && card.contains(
                    "cancellation on it, so this is not something to go looking for there."
                ),
            "and is told the portal they can reach has no cancel button on it, in the "
                + "same words the other clients use"
        )
    }

    // MARK: - Answering that reason (#277 follow-up)
    //
    // Hand-ported from `packages/shared/src/cancellation-offers.test.ts`, which
    // names itself the fixture the three clients build against. The properties
    // matter more than the string comparisons:
    //
    //   1. SILENCE IS A RESULT. Four of the seven reason/plan combinations
    //      return nil, each for a stated reason. An edit that fills one of them
    //      in with something invented fails here.
    //   2. A PAUSE IS NAMED ONLY TO A WORKSPACE THAT IS IN ONE. The paid pause
    //      exists now, so the old flat ban on the word is gone — but whether one
    //      is on OFFER is a Stripe read this module cannot see (a prepaid year,
    //      a referral month, a pending plan change, an unhealthy card or an
    //      unprovisioned price all refuse it), so copy about pausing shown to
    //      somebody who is not already paused sends them looking for a button
    //      the API will not give them.
    //   3. THE FIGURES ARE READ, NOT TYPED. Every price and count has to come
    //      from the price book and the plan limits.
    //   4. THE OFFER IS NEVER A STEP. Nothing returns a route, and the
    //      reason-with-no-control returns a nil action, so no client can be
    //      handed a button it has to invent.

    /// A US Pro workspace — the case with the most to say.
    ///
    /// `paused` defaults to nil, which is how every client called this before
    /// #277 and is the answer for a workspace that is not paused. The tests about
    /// the paused answers say so explicitly, so the two are never mixed up here.
    private func proOffer(
        reason: String?,
        plan: String? = "pro",
        phase: CancellationOfferPhase = .before,
        billingCurrency: String? = "usd",
        country: String? = "US",
        registrationFeePaidAt: String? = nil,
        paused: Bool? = nil
    ) -> CancellationOffer? {
        cancellationOffer(
            reason: reason,
            plan: plan,
            phase: phase,
            billingCurrency: billingCurrency,
            country: country,
            registrationFeePaidAt: registrationFeePaidAt,
            paused: paused
        )
    }

    /// One offer and the inputs that produced it — for the properties that have
    /// to name the STATE a control was returned for.
    private struct SweptOffer {
        let reason: String
        let plan: String?
        let phase: CancellationOfferPhase
        let paused: Bool?
        let offer: CancellationOffer
    }

    /// Every offer this module can produce, over every input that shapes one.
    ///
    /// `pauseStates` narrows the sweep to the workspaces a property is about; the
    /// default is all three, which is what a property that must hold everywhere
    /// wants. `nil` sits beside `false` deliberately — an omitted flag is how all
    /// three clients called this before #277, and it is the case a regression
    /// lands on.
    private func everyOffer(pauseStates: [Bool?] = [nil, false, true]) -> [SweptOffer] {
        let plans: [String?] = ["starter", "pro", nil]
        let phases: [CancellationOfferPhase] = [.before, .grace]
        let currencies: [String?] = ["usd", "cad", nil]
        let countries: [String?] = ["US", "CA"]
        let fees: [String?] = [nil, "2026-01-05T00:00:00Z"]
        var out: [SweptOffer] = []
        for reason in cancellationReasons.map(\.code) {
            for plan in plans {
                for phase in phases {
                    for paused in pauseStates {
                        for currency in currencies {
                            for country in countries {
                                for fee in fees {
                                    guard let offer = cancellationOffer(
                                        reason: reason,
                                        plan: plan,
                                        phase: phase,
                                        billingCurrency: currency,
                                        country: country,
                                        registrationFeePaidAt: fee,
                                        paused: paused
                                    ) else { continue }
                                    out.append(SweptOffer(
                                        reason: reason,
                                        plan: plan,
                                        phase: phase,
                                        paused: paused,
                                        offer: offer
                                    ))
                                }
                            }
                        }
                    }
                }
            }
        }
        return out
    }

    /// Every renderable string this module can produce, across every input.
    private func everyRenderableOfferString(
        pauseStates: [Bool?] = [nil, false, true]
    ) -> [String] {
        everyOffer(pauseStates: pauseStates).map { swept in
            [swept.offer.heading, swept.offer.body, swept.offer.actionLabel ?? ""]
                .joined(separator: " ")
        }
    }

    func testSaysNothingToAStarterWorkspaceThatFindsItTooExpensive() {
        // THE CASE THE WHOLE MODULE IS JUDGED ON. There is no cheaper plan, so
        // there is no honest offer, and inventing one is the dishonesty #277
        // forbids.
        XCTAssertNil(proOffer(reason: "too_expensive", plan: "starter"))
        XCTAssertNil(proOffer(reason: "too_expensive", plan: "starter", phase: .grace))
    }

    func testTreatsAWorkspaceWithNoPlanAsStarterAndSaysNothing() {
        XCTAssertNil(proOffer(reason: "too_expensive", plan: nil))
    }

    func testSaysNothingToSwitchedNotUsingOrOther() {
        for reason in ["switched", "not_using", "other"] {
            for plan in ["starter", "pro"] {
                for phase in [CancellationOfferPhase.before, .grace] {
                    XCTAssertNil(
                        proOffer(reason: reason, plan: plan, phase: phase),
                        "\(reason)/\(plan)"
                    )
                }
            }
        }
    }

    func testSaysNothingWhenNoReasonWasGiven() {
        // The card records a row with no reason on purpose: nothing is required.
        XCTAssertNil(proOffer(reason: nil))
        XCTAssertNil(proOffer(reason: ""))
    }

    func testSaysNothingForACodeThisBuildHasNeverHeardOf() {
        // A newer client sending a seventh reason must render nothing rather
        // than fall through to a guessed answer.
        XCTAssertNil(proOffer(reason: "moving_to_carrier_pigeon"))
        XCTAssertNil(proOffer(reason: "TOO_EXPENSIVE"))
    }

    func testNamesStartersRealPriceInTheCurrencyTheWorkspaceIsCharged() {
        let usd = proOffer(reason: "too_expensive", billingCurrency: "usd")
        XCTAssertTrue(usd?.body.contains("$29") ?? false)
        XCTAssertTrue(usd?.body.contains("$79") ?? false)

        let cad = proOffer(reason: "too_expensive", billingCurrency: "cad")
        XCTAssertTrue(cad?.body.contains("$39") ?? false)
        XCTAssertTrue(cad?.body.contains("$109") ?? false)
    }

    func testReadsTheFiguresFromThePriceBookRatherThanALiteral() throws {
        // The guard that survives a repricing: if the price book moves and the
        // copy does not, this fails.
        for currency in [BillingCurrency.usd, .cad] {
            guard let body = proOffer(
                reason: "too_expensive",
                billingCurrency: currency.rawValue
            )?.body else { return XCTFail("no offer for \(currency.rawValue)") }
            XCTAssertTrue(body.contains("$\(planPriceCents("starter", currency) / 100)"))
            XCTAssertTrue(body.contains("$\(planPriceCents("pro", currency) / 100)"))
        }

        // ...and the same for the counts, asserted on the SOURCE rather than on
        // the output. A body that typed "3 people" renders identically to one
        // that interpolates `starterSeats`, so every assertion above passes on
        // a hardcoded figure — it would only fail on the day somebody changed
        // the constant, which is the day the copy is already wrong in front of
        // a customer. What is pinned here is that the copy READS them.
        let logic = try settingsLogicSource()
        let offers = String(
            logic[
                (logic.range(of: "// MARK: - Answering that reason")?.lowerBound
                    ?? logic.startIndex)...
            ]
        )
        for interpolation in [
            "\\(starterSeats) people",
            "\\(starterNumbers) business ",
            "\\(starterSeats) seats",
            "\\(cancellationGraceDays) days from the ",
        ] {
            XCTAssertTrue(
                offers.contains(interpolation),
                "the offer copy states a figure as a literal instead of reading "
                    + "\(interpolation) — a second home for a number the API enforces"
            )
        }
    }

    func testFallsBackToTheCountryOnlyWhenTheCurrencyWasWithheld() {
        // NOT "every workspace predating #328", which is what this comment used
        // to say and is false: `20260802090000_billing_currency.sql` adds the
        // column `not null default 'usd'`, so every row that existed took USD
        // at migration time and `api_create_company` has written 'cad' for
        // every CA signup since. There is no null row.
        //
        // Nil reaches this function for ONE reason: the field was redacted.
        // `billing_currency` is in BILLING_ONLY_COMPANY_FIELDS, so the key is
        // absent for a caller without `billing.manage` — a tech or a member
        // looking at the plan card. The country is the right answer for them,
        // because it is what the column was defaulted from at signup.
        XCTAssertTrue(
            proOffer(reason: "too_expensive", billingCurrency: nil, country: "CA")?
                .body.contains("$39") ?? false
        )
        XCTAssertTrue(
            proOffer(reason: "too_expensive", billingCurrency: nil, country: "US")?
                .body.contains("$29") ?? false
        )
        // An unrecognised stored currency is not trusted over the country either.
        XCTAssertTrue(
            proOffer(reason: "too_expensive", billingCurrency: "gbp", country: "CA")?
                .body.contains("$39") ?? false
        )
    }

    func testNamesTheLimitsTheApiWillActuallyEnforce() {
        // Both are refusal conditions on POST /v1/billing/change-plan, and that
        // route is the ONLY one that applies them — which is why the phase is
        // written out here rather than defaulted. It is load-bearing now: the
        // grace phase goes through checkout, which counts neither members nor
        // numbers, so these same figures are forbidden there.
        guard let body = proOffer(reason: "too_expensive", phase: .before)?.body else {
            return XCTFail("no offer")
        }
        XCTAssertTrue(body.contains("\(starterSeats) people"))
        // ...and it has to agree with itself about how many that is. A bare
        // `contains` matches "1 business numbers" happily, which is the sort of
        // thing that ships because every assertion around it is green.
        let plural = starterNumbers == 1 ? "" : "s"
        XCTAssertTrue(body.contains("\(starterNumbers) business number\(plural)."))
    }

    func testTheGraceAnswerNamesNoSeatOrNumberLimitNothingWillApply() {
        // THE DEFECT THIS PAIR EXISTS FOR. The grace action opens Stripe
        // checkout, whose only gates are "one live subscription" and the US
        // registration draft — it counts neither members nor numbers — and
        // `checkout.session.completed` then un-suspends every suspended number
        // with no plan filter. A Pro workspace with two numbers and eight
        // members can press a button captioned "covers 3 people and 1 business
        // number" and land on Starter holding two and eight, so that caption
        // may not be printed here. The price still is: checkout charges it.
        guard let grace = proOffer(reason: "too_expensive", phase: .grace) else {
            return XCTFail("no offer")
        }
        let copy = "\(grace.heading) \(grace.body) \(grace.actionLabel ?? "")"
        XCTAssertFalse(copy.contains("\(starterSeats) people"), copy)
        XCTAssertFalse(copy.contains("business number"), copy)
        XCTAssertNil(
            copy.range(
                of: "\\bseats?\\b|\\bcovers\\b",
                options: [.regularExpression, .caseInsensitive]
            ),
            copy
        )
        XCTAssertTrue(
            grace.body.contains(formatMonthlyCents(planPriceCents("starter", .usd))),
            "the price stays: it is the one figure checkout does apply"
        )
    }

    func testTheBeforeAnswerDoesNotPromiseTheSecondNumberSurvivesTheDowngrade() {
        // "your number and your message history stay exactly as they are" was
        // true for a workspace that fits Starter and false for exactly the one
        // being spoken to: change-plan answers 409 "Release your extra phone
        // number before downgrading to Starter". The history does survive and
        // is still promised.
        guard let body = proOffer(reason: "too_expensive", phase: .before)?.body else {
            return XCTFail("no offer")
        }
        XCTAssertFalse(body.contains("stay exactly as they are"), body)
        XCTAssertTrue(body.contains("message history comes with you"), body)
        XCTAssertTrue(body.contains("a second number does not"), body)
        XCTAssertTrue(body.contains("refused until you release it"), body)
        XCTAssertTrue(body.contains("back inside \(starterSeats) seats"), body)
    }

    func testQuotesNoAllowanceFigureBecauseThoseLiveInTheFairUsePolicy() {
        // #85/#121: the plan card on this same screen states allowances as a
        // fair-use line and puts the concrete numbers only in the policy. USD,
        // matching the shared fixture — "$109" is three digits, and asserting
        // this against a CAD body would be asserting against a price.
        guard let body = proOffer(reason: "too_expensive", billingCurrency: "usd")?.body
        else { return XCTFail("no offer") }
        XCTAssertTrue(body.contains("fair-use policy"))
        XCTAssertNil(body.range(of: "\\d{3,}", options: .regularExpression))
    }

    func testPointsAtThePlanSwitcherBeforeAndAtComingBackAfter() {
        let before = proOffer(reason: "too_expensive", phase: .before)
        XCTAssertEqual(before?.action, .changePlan)
        XCTAssertEqual(before?.actionLabel, "Switch to Starter")

        let grace = proOffer(reason: "too_expensive", phase: .grace)
        XCTAssertEqual(grace?.action, .resubscribeStarter)
        XCTAssertEqual(grace?.actionLabel, "Come back on Starter")
    }

    func testSaysWhenTheSwitchLandsBecauseItIsNotToday() {
        // A downgrade applies at period end via a subscription schedule.
        XCTAssertTrue(
            proOffer(reason: "too_expensive", phase: .before)?
                .body.contains("end of your current billing period") ?? false
        )
    }

    // MARK: - too expensive, on Pro, while paused (#277)

    /// OFFER-P1 — THE DEFECT. While paused the pause offer itself is over
    /// (`GET /v1/billing/pause` answers `already_paused`), so the cancel card
    /// falls through to this module — and it drew "Switch to Starter" an inch
    /// under the answer, on a workspace whose `POST /v1/billing/change-plan`
    /// returns 409 "Your plan is paused. Resume it first, then switch plans".
    /// The plan card's own switcher was gated on the same fact; this one was
    /// not, which made it the only pressable route to that refusal on the screen.
    func testOfferP1APausedWorkspaceIsOfferedNoControlItCannotUse() {
        let paused = proOffer(reason: "too_expensive", paused: true)
        XCTAssertNotNil(paused)
        XCTAssertNil(paused?.action)
        XCTAssertNil(paused?.actionLabel)
    }

    func testThePausedAnswerKeepsTheCheaperPlanBecauseThatIsStillTheAnswer() {
        // Dropping to nil here was the other option and it is worse: somebody
        // cancelling over $79 would be told nothing about the $29 plan they can
        // have. What the API refuses is the click, not the fact.
        for currency in [BillingCurrency.usd, .cad] {
            guard let body = proOffer(
                reason: "too_expensive",
                billingCurrency: currency.rawValue,
                paused: true
            )?.body else { return XCTFail("no offer for \(currency.rawValue)") }
            XCTAssertTrue(body.contains(formatMonthlyCents(planPriceCents("starter", currency))))
            XCTAssertTrue(body.contains(formatMonthlyCents(planPriceCents("pro", currency))))
        }
    }

    func testThePausedAnswerNamesTheTwoStepsInTheOrderTheApiInsistsOn() {
        // The same order the 409 names, deliberately: somebody who goes and does
        // it reads one sentence twice rather than two that disagree. There is no
        // `resume` control to press — Resume is already on the paused card at the
        // top of this screen, and a second one here would be this module growing
        // a control, which the header forbids.
        guard let body = proOffer(reason: "too_expensive", paused: true)?.body else {
            return XCTFail("no offer")
        }
        XCTAssertTrue(body.contains("Your plan is paused"), body)
        XCTAssertTrue(body.contains("resume first, then switch plans"), body)
    }

    func testThePausedAnswerStillNamesTheLimitsChangePlanWillRefuseOver() {
        // The route this copy points at is still change-plan — after a resume —
        // and it still 409s over both. "A figure may only be printed on the path
        // that enforces it" cuts the other way here: the path is unchanged, so
        // the figures stay.
        guard let body = proOffer(reason: "too_expensive", paused: true)?.body else {
            return XCTFail("no offer")
        }
        XCTAssertTrue(body.contains("\(starterSeats) people"), body)
        let plural = starterNumbers == 1 ? "" : "s"
        XCTAssertTrue(body.contains("\(starterNumbers) business number\(plural)."), body)
        XCTAssertTrue(body.contains("back inside \(starterSeats) seats"), body)
    }

    func testThePausedAnswerIsHeadedExactlyAsTheUnpausedOneIs() {
        // One string, not two: the heading is a fact about the two plans and the
        // pause does not touch it. Three clients hand-port these, and a second
        // heading is a second thing to drift.
        XCTAssertEqual(
            proOffer(reason: "too_expensive")?.heading,
            proOffer(reason: "too_expensive", paused: true)?.heading
        )
    }

    func testAPausedStarterWorkspaceIsStillToldNothing() {
        // There is still nothing below Starter, and a pause does not invent one.
        XCTAssertNil(proOffer(reason: "too_expensive", plan: "starter", paused: true))
        XCTAssertNil(proOffer(reason: "too_expensive", plan: nil, paused: true))
    }

    func testSeasonalStatesTheHoldReadFromTheConstantTheJobUses() {
        XCTAssertEqual(cancellationGraceDays, 30)
        XCTAssertTrue(
            proOffer(reason: "seasonal")?
                .body.contains("\(cancellationGraceDays) days") ?? false
        )
    }

    func testSeasonalSaysTheNumberKeepsReceivingAndThatReplyingDoesNot() {
        // Both halves are checkable: numbers are suspended-but-receiving on
        // cancellation, and runPreSendGates answers 402 without an active
        // subscription. Stating only the first would let somebody plan a quiet
        // season around a product that answers their customers.
        guard let body = proOffer(reason: "seasonal")?.body else {
            return XCTFail("no offer")
        }
        XCTAssertTrue(body.contains("receiving texts"))
        XCTAssertTrue(body.contains("cannot reply"))
    }

    func testTheRegistrationFeePromiseAppearsOnlyOnceItIsPaid() {
        XCTAssertTrue(
            proOffer(reason: "seasonal", registrationFeePaidAt: "2026-01-05T00:00:00Z")?
                .body.contains("once per workspace, ever") ?? false
        )
        // Not yet paid: silence. They WILL be charged it on return, so a
        // softened version of this sentence would be false.
        for unpaid in [nil, "", "   "] as [String?] {
            XCTAssertFalse(
                proOffer(reason: "seasonal", registrationFeePaidAt: unpaid)?
                    .body.contains("registration fee") ?? true
            )
        }
    }

    func testTheSeasonalAnswerAnchorsTheHoldToTheCancellationInBothPhases() {
        // runGraceJob measures now - canceled_at, and startCancellationLifecycle
        // stamps that column from Stripe's `canceled_at` — which for a
        // cancel_at_period_end cancellation is the time of the REQUEST, not the
        // end of the period. Anything anchored to the period end describes a
        // date about a month later than the one the number actually dies on,
        // and wrong in the customer's favour is the expensive direction.
        for phase in [CancellationOfferPhase.before, .grace] {
            guard let result = proOffer(reason: "seasonal", phase: phase) else {
                return XCTFail("no offer")
            }
            let copy = "\(result.heading) \(result.body)"
            XCTAssertNotNil(
                copy.range(
                    of: "\(cancellationGraceDays) days .{0,20}from the day you cancel",
                    options: .regularExpression
                ),
                copy
            )
            // ...and says so against the wrong anchor BY NAME, because the
            // wrong anchor is the one the reader already has in their head.
            XCTAssertTrue(copy.contains("not from the end of your"), copy)
        }
    }

    func testTheSeasonalHeadingNeverPromisesCoverForTheWholeAbsence() {
        // "Your number is held while you are gone" over a body that said 30
        // days, to somebody who had just chosen "Quiet season, I'll be back".
        // The heading is the louder line and a trades quiet season is months.
        //
        // THE UNPAUSED HEADING ONLY, and deliberately: this ban exists because
        // the hold is 30 days, while a pause has no clock at all — "held for as
        // long as you stay paused" is simply true there. A guard kept past the
        // fact that justified it stops being a guard and becomes a ceiling.
        for phase in [CancellationOfferPhase.before, .grace] {
            guard let heading = proOffer(reason: "seasonal", phase: phase)?.heading else {
                return XCTFail("no offer")
            }
            XCTAssertNil(
                heading.lowercased().range(
                    of: "while you are (gone|away|out)|until you (are back|return)"
                        + "|(whole|entire|all) (season|winter|year)|as long as",
                    options: .regularExpression
                ),
                heading
            )
        }
    }

    func testTheSeasonalAnswerSaysALongerSeasonOutrunsTheHold() {
        // The one fact a seasonal business needs and cannot get anywhere else:
        // 30 days does not cover a winter, and #413 is what happens at the end
        // of it. Leaving it implied is how the old heading got away with
        // promising the opposite.
        //
        // UNPAUSED ONLY, and the paused case below is why: for somebody already
        // paused this sentence is false — nothing of theirs is running out — and
        // it would sit on screen with a card that says exactly that.
        guard let body = proOffer(reason: "seasonal", phase: .before)?.body else {
            return XCTFail("no offer")
        }
        XCTAssertTrue(body.contains("longer than that outruns the hold"), body)
        XCTAssertTrue(body.contains("goes back to the phone company"), body)
    }

    func testNoOfferEverCountsTheHoldFromABillingPeriod() {
        // THE PROPERTY behind the seasonal pair above, applied to every string
        // this module can emit. `canceled_at` is stamped from Stripe's field,
        // which on a cancel-at-period-end cancellation is the time of the
        // request — so "30 days after your billing period ends" is roughly
        // double the real answer, in the customer's favour, about the number on
        // the side of their van.
        //
        // Deliberately NOT a ban on "billing period": the downgrade genuinely
        // lands at period end via a subscription schedule, and both seasonal
        // answers name the wrong anchor in order to deny it. What is banned is
        // tying the DAYS to the period.
        for copy in everyRenderableOfferString() {
            XCTAssertNil(
                copy.range(
                    of: "\\b\\d+ days (after|from|following) (your|the)"
                        + "( last| current| next)?( billing)? period",
                    options: [.regularExpression, .caseInsensitive]
                ),
                copy
            )
            XCTAssertNil(
                copy.range(
                    of: "(period ends?|end of (your|the)[a-z ]*period)[^.]{0,40}"
                        + "\\b(then|and)\\b[^.]{0,30}\\b\\d+ days",
                    options: [.regularExpression, .caseInsensitive]
                ),
                copy
            )
        }
    }

    func testSeasonalOffersNoControlBecauseThereIsNothingToPress() {
        for phase in [CancellationOfferPhase.before, .grace] {
            let result = proOffer(reason: "seasonal", phase: phase)
            XCTAssertNotNil(result)
            XCTAssertNil(result?.action)
            XCTAssertNil(result?.actionLabel)
        }
    }

    // MARK: - seasonal, while paused (#277)

    /// OFFER-P2 — THE DEFECT, and it was a contradiction rather than a subtlety.
    /// The paused card twelve lines up says nothing expires while you are
    /// paused, and this answer ended "...a quiet season longer than that outruns
    /// the hold and the number goes back to the phone company". Both sentences
    /// were on one screen. The 30-day hold is not what is holding their number —
    /// the pause is, and it has no clock. If this ever falls back to the unpaused
    /// copy, the first assertion is the one that fires.
    func testOfferP2APausedWorkspaceIsNotToldItsHoldIsRunningOut() {
        guard let paused = proOffer(reason: "seasonal", paused: true) else {
            return XCTFail("no offer")
        }
        XCTAssertTrue(paused.body.contains("nothing expires while your plan is paused"))
        XCTAssertFalse(paused.body.contains("outruns the hold"), paused.body)
        XCTAssertNotEqual(proOffer(reason: "seasonal")?.heading, paused.heading)
    }

    func testThePausedSeasonalAnswerAttachesEveryDeadlineToCancelling() {
        // The property behind the assertion above, sentence by sentence: the only
        // countdown in this product starts at `canceled_at`, so a paused reader
        // may only meet a number of days inside a sentence about cancelling.
        // "Your pause ends in 30 days" would pass a `contains` check on the whole
        // body and fail here.
        guard let body = proOffer(reason: "seasonal", paused: true)?.body else {
            return XCTFail("no offer")
        }
        for sentence in body.components(separatedBy: ". ") {
            if sentence.contains("\(cancellationGraceDays) days") {
                XCTAssertTrue(sentence.lowercased().contains("cancel"), sentence)
            }
        }
        // ...and it does name the hold, so the loop above checked something.
        XCTAssertTrue(body.contains("\(cancellationGraceDays) days"))
    }

    func testThePausedSeasonalAnswerAnchorsThatClockToTheCancellation() {
        // Same fact, same reason: runGraceJob measures now - canceled_at, so a
        // period-end anchor is about a month of somebody else's arithmetic.
        guard let paused = proOffer(reason: "seasonal", paused: true) else {
            return XCTFail("no offer")
        }
        let copy = "\(paused.heading) \(paused.body)"
        XCTAssertNotNil(
            copy.range(
                of: "\(cancellationGraceDays) days .{0,20}from the day you cancel",
                options: .regularExpression
            ),
            copy
        )
        XCTAssertTrue(copy.contains("not from the end of your"), copy)
        XCTAssertTrue(paused.body.contains("goes back to the phone company"), copy)
    }

    func testThePausedSeasonalAnswerOffersNoControlEither() {
        // Resume lives on the paused card on this same screen. A second one here
        // would make the answer a step, which is the thing the whole card refuses.
        XCTAssertNil(proOffer(reason: "seasonal", paused: true)?.action)
        XCTAssertNil(proOffer(reason: "seasonal", paused: true)?.actionLabel)
    }

    func testThePausedSeasonalAnswerPromisesTheFeeOnTheSameGate() {
        // "What does coming back cost" survives the pause unchanged, and so does
        // the answer: at most once per workspace, ever.
        XCTAssertTrue(
            proOffer(
                reason: "seasonal",
                registrationFeePaidAt: "2026-01-05T00:00:00Z",
                paused: true
            )?.body.contains("once per workspace, ever") ?? false
        )
        for unpaid in [nil, "", "   "] as [String?] {
            XCTAssertFalse(
                proOffer(reason: "seasonal", registrationFeePaidAt: unpaid, paused: true)?
                    .body.contains("registration fee") ?? true
            )
        }
    }

    func testMissingFeatureQuotesTheSupportConstantsRatherThanRestatingThem() {
        guard let body = proOffer(reason: "missing_feature")?.body else {
            return XCTFail("no offer")
        }
        XCTAssertTrue(body.contains(supportResponseTime))
        XCTAssertTrue(body.contains(supportFixPromise))
    }

    func testMissingFeaturePointsAtTheInProductHelpSurface() {
        let result = proOffer(reason: "missing_feature")
        XCTAssertEqual(result?.action, .openHelp)
        XCTAssertEqual(result?.actionLabel, "Get help")
    }

    func testMissingFeatureSaysTheSameThingInBothPhasesAndWhilePaused() {
        // The promise does not change because they have already gone, and it does
        // not change because their plan is paused: it is a promise about US
        // answering, not about the state of their subscription.
        XCTAssertEqual(
            proOffer(reason: "missing_feature", phase: .before),
            proOffer(reason: "missing_feature", phase: .grace)
        )
        XCTAssertEqual(
            proOffer(reason: "missing_feature"),
            proOffer(reason: "missing_feature", paused: true)
        )
    }

    func testNoOfferNamesAPauseToAWorkspaceThatIsNotInOne() {
        // THE PROPERTY, not a spot check: every renderable string over every
        // input that does not say `paused: true` — including the omitted flag,
        // which is how this was called before #277 and where a regression lands.
        //
        // The pause exists now, so the old absolute ban is gone; what replaced it
        // is narrower and still load-bearing. Whether a pause is on OFFER is a
        // Stripe read `GET /v1/billing/pause` owns, and it refuses a workspace
        // with a prepaid year, an unconsumed referral month, a pending plan
        // change, an unhealthy card or an unprovisioned price. This module sees
        // none of that, so a sentence here mentioning a pause to somebody who is
        // not in one sends them looking for a button the API will not give them.
        let forbidden = "\\bpause[sd]?\\b|\\bpausing\\b|\\bfreeze\\b|\\bfrozen\\b"
            + "|\\bon hold\\b|\\bsuspend your\\b"
        for copy in everyRenderableOfferString(pauseStates: [nil, false]) {
            XCTAssertNil(
                copy.lowercased().range(of: forbidden, options: .regularExpression),
                copy
            )
        }
        // ...and it is not satisfied by silence: the paused answers DO say it.
        XCTAssertTrue(
            everyRenderableOfferString(pauseStates: [true])
                .contains { $0.lowercased().contains("paused") },
            "no paused answer names the pause, so the ban above is proving nothing"
        )
    }

    func testNoOfferReturnsAControlTheProductRefusesInTheStateItWasReturnedFor() {
        // `changePlan` names the plan switcher, and POST /v1/billing/change-plan
        // 409s while `companies.paused_at` is set. Every other action is
        // reachable in the state it is offered in: `resubscribeStarter` is
        // grace-only checkout, `openHelp` is a screen. So the whole of this
        // property is "nothing hands a paused workspace the plan switcher", swept
        // over every reason, plan and phase rather than spot-checked on the one
        // that had it.
        for swept in everyOffer(pauseStates: [true]) where swept.phase == .before {
            XCTAssertNotEqual(
                swept.offer.action, .changePlan,
                "\(swept.reason)/\(swept.plan ?? "nil") was handed the plan switcher "
                    + "while paused, and that POST answers 409"
            )
        }
    }

    func testAPausedFlagIsIgnoredInTheGracePhaseWhereThePauseIsOver() {
        // `paused_at` OUTLIVES the subscription it belonged to — nothing clears
        // it on cancellation, deliberately (the daily reconcile skips cancelled
        // tenants; claim_checkout_activation clears it only if they come back,
        // see 20260805080000_resubscribe_clears_pause.sql). `isPaused` in
        // scripts/ops/pricing-report.mjs draws this same line, after the stale
        // fact named a churned workspace as a paying paused one in a founder
        // report.
        //
        // Here a stale `true` would answer "nothing expires" to the one reader
        // for whom the 30-day clock is genuinely running, two lines above the
        // date it runs out on.
        for reason in cancellationReasons.map(\.code) {
            for plan in ["starter", "pro", nil] as [String?] {
                XCTAssertEqual(
                    proOffer(reason: reason, plan: plan, phase: .grace),
                    proOffer(reason: reason, plan: plan, phase: .grace, paused: true),
                    "\(reason)/\(plan ?? "nil")"
                )
            }
        }
    }

    func testAnUnpausedWorkspaceIsAnsweredExactlyWhatItWasBeforeThePauseExisted() {
        // The flag is optional so that three clients and their hand-ported tests
        // read word-for-word what they read before #277. Omitted, false and nil
        // are one behaviour, and this is what pins it: an edit that makes the
        // paused branch the default fails on the first reason it touches.
        for reason in cancellationReasons.map(\.code) {
            for plan in ["starter", "pro", nil] as [String?] {
                for phase in [CancellationOfferPhase.before, .grace] {
                    let base = proOffer(reason: reason, plan: plan, phase: phase)
                    XCTAssertEqual(
                        base,
                        proOffer(reason: reason, plan: plan, phase: phase, paused: false),
                        "\(reason)/\(plan ?? "nil")"
                    )
                }
            }
        }
    }

    func testNoOfferEverClaimsTheNumberIsKeptForever() {
        let forbidden = "\\bforever\\b|\\bpermanently\\b|\\bkeep it indefinitely\\b"
        for copy in everyRenderableOfferString() {
            XCTAssertNil(
                copy.lowercased().range(of: forbidden, options: .regularExpression),
                copy
            )
        }
    }

    func testNoOfferEverHandsAClientARouteAUrlOrAMailto() {
        for copy in everyRenderableOfferString() {
            XCTAssertNil(
                copy.range(
                    of: "https?://|mailto:|/settings/",
                    options: .regularExpression
                ),
                copy
            )
        }
    }

    func testEveryOfferHasANonEmptyHeadingAndBody() {
        let copies = everyRenderableOfferString()
        XCTAssertFalse(copies.isEmpty)
        for copy in copies {
            XCTAssertFalse(copy.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        for reason in ["too_expensive", "seasonal", "missing_feature"] {
            let result = proOffer(reason: reason)
            XCTAssertEqual(result?.reason, reason)
            XCTAssertFalse(
                result?.heading.trimmingCharacters(in: .whitespaces).isEmpty ?? true
            )
            XCTAssertFalse(
                result?.body.trimmingCharacters(in: .whitespaces).isEmpty ?? true
            )
        }
    }

    func testTheDeadlineCountsThirtyDaysFromCanceledAtMatchingTheReleaseJob() {
        // runGraceJob measures now - canceled_at and releases at 30. Anything
        // measured from the period end would print a different date from the
        // one the number actually dies on.
        XCTAssertEqual(
            numberReleaseAt("2026-03-01T00:00:00.000Z"),
            parseWireTimestamp("2026-03-31T00:00:00.000Z")
        )
    }

    func testThereIsNoDeadlineForAWorkspaceThatNeverCancelled() {
        XCTAssertNil(numberReleaseAt(nil))
        XCTAssertNil(numberReleaseAt(""))
        XCTAssertNil(numberReleaseAt("   "))
        XCTAssertNil(numberReleaseAt("not a date"))
    }

    func testTheGraceWindowClosesAtTheReleaseNotAfterIt() {
        let canceledAt = "2026-03-01T00:00:00.000Z"
        XCTAssertTrue(
            isWithinCancellationGrace(
                canceledAt,
                now: parseWireTimestamp("2026-03-30T23:59:59Z")!
            )
        )
        // Exactly at the release the number is gone, so "resubscribe and keep
        // your number" stops being true here.
        XCTAssertFalse(
            isWithinCancellationGrace(
                canceledAt,
                now: parseWireTimestamp("2026-03-31T00:00:00Z")!
            )
        )
        XCTAssertFalse(
            isWithinCancellationGrace(
                canceledAt,
                now: parseWireTimestamp("2026-04-05T00:00:00Z")!
            )
        )
        XCTAssertFalse(isWithinCancellationGrace(nil))
    }

    func testADismissalBelongsToTheCancellationItWasMadeOn() {
        let canceledAt = "2026-03-01T00:00:00Z"
        // Waved away during THIS cancellation.
        XCTAssertTrue(
            winbackIsDismissed(canceledAt: canceledAt, dismissedAt: "2026-03-02T00:00:00Z")
        )
        XCTAssertTrue(
            winbackIsDismissed(canceledAt: canceledAt, dismissedAt: canceledAt)
        )
        // A stamp left over from a PREVIOUS cancellation suppresses nothing:
        // somebody who waves this away, comes back, and leaves again next
        // winter gets the answer again. Nothing has to clear it.
        XCTAssertFalse(
            winbackIsDismissed(canceledAt: canceledAt, dismissedAt: "2026-02-01T00:00:00Z")
        )
        // Absent or unreadable is NOT a dismissal. The field is withheld
        // entirely from a caller without billing.manage, and failing that way
        // round shows a note to somebody who has not declined it rather than
        // hiding one from somebody who has.
        XCTAssertFalse(winbackIsDismissed(canceledAt: canceledAt, dismissedAt: nil))
        XCTAssertFalse(winbackIsDismissed(canceledAt: canceledAt, dismissedAt: "nonsense"))
        XCTAssertFalse(
            winbackIsDismissed(canceledAt: nil, dismissedAt: "2026-03-02T00:00:00Z")
        )
    }

    // MARK: - One price per plan, per workspace (#328)

    func testThePlanCardIsPricedInTheCurrencyTheWorkspaceIsCharged() {
        for currency in [BillingCurrency.usd, .cad] {
            for plan in ["starter", "pro"] {
                XCTAssertEqual(
                    planFacts(plan, currency)?.price,
                    "\(formatMonthlyCents(planPriceCents(plan, currency)))/mo",
                    "\(plan)/\(currency.rawValue)"
                )
            }
        }
        // A workspace that has never checked out has no plan card at all.
        XCTAssertNil(planFacts(nil, .cad))
        XCTAssertNil(planFacts("enterprise", .usd))
    }

    /// THE DEFECT, in one assertion: the plan card and the cancel answer sit an
    /// inch apart on the billing screen, and a Canadian owner read "Pro ·
    /// $79/mo" on one and "Starter is $39 a month instead of $109" on the
    /// other. Both are about the same plan and the same card, so at most one of
    /// them could be true.
    func testThePlanCardAndTheCancelAnswerNameTheSamePriceForTheSamePlan() {
        for currency in [BillingCurrency.usd, .cad] {
            guard let card = planFacts("pro", currency)?.price,
                  let answer = proOffer(
                      reason: "too_expensive",
                      billingCurrency: currency.rawValue
                  )?.body
            else { return XCTFail("no plan card or no offer for \(currency.rawValue)") }
            let pro = formatMonthlyCents(planPriceCents("pro", currency))
            XCTAssertEqual(card, "\(pro)/mo")
            XCTAssertTrue(answer.contains("instead of \(pro)"), answer)
        }
    }

    /// The currency has to be ASKED FOR. A defaulted parameter is how the
    /// hardcoded price got to live through a change that touched this same
    /// function to wire the number limits: nothing at the call site had to
    /// mention money, so nothing did.
    func testThePlanCardReadsThePriceBookAndTheCallerHasToNameTheCurrency() throws {
        let facts = try topLevelDeclaration(
            try settingsLogicSource(),
            "func planFacts("
        )
        XCTAssertTrue(
            facts.contains("planPriceCents("),
            "the plan card must read the price book, not type a dollar sign"
        )
        XCTAssertNil(
            facts.range(of: "\"\\$\\d", options: .regularExpression),
            "a literal price reappeared on the plan card: \(facts)"
        )
        XCTAssertFalse(
            facts.contains("BillingCurrency ="),
            "the currency parameter grew a default, which is how the next call "
                + "site quietly goes back to printing one workspace's money at "
                + "another workspace"
        )
    }

    // MARK: - The two surfaces the answer is rendered on (#277 follow-up)

    /// THE RULE THAT OUTRANKS THE FEATURE: picking a reason may not move the
    /// exit. The cancel card is the last thing on the billing screen, so
    /// "Continue to cancel" sits near the foot of the viewport for anybody who
    /// has scrolled to it; content inserted above that button pushes it off the
    /// bottom of the screen and charges another scroll for having answered an
    /// OPTIONAL question.
    func testTheAnswerRendersAfterTheControlThatLeaves() throws {
        let card = try cancelCardSource()
        let rendered = try section(of: card, from: "private var leaving: some View {")
        guard let leave = rendered.range(of: "\"Continue to cancel\""),
              let answer = rendered.range(of: "CancellationAnswerNote(") else {
            return XCTFail("the cancel card no longer renders the exit and the answer")
        }
        XCTAssertTrue(
            leave.lowerBound < answer.lowerBound,
            "the answer goes BELOW the button that leaves: answering must never cost "
                + "more scrolling than skipping"
        )
    }

    /// The answer is computed from the local selection, so a dead or slow
    /// endpoint of ours can never put a spinner on a cancel screen.
    func testTheAnswerIsComputedLocallyAndNotFetched() throws {
        let card = try cancelCardSource()
        XCTAssertTrue(card.contains("cancellationOffer("))
        XCTAssertFalse(
            card.contains("cancellationReason("),
            "the cancel card must not read the reason back from the server: the answer "
                + "belongs to the tap that produced it"
        )
    }

    /// Nothing the answer adds may gate the exit, and it may not become a
    /// second screen on the way to Stripe. Its one sheet is the plan switcher
    /// the plan card already opens, reached by an explicit press.
    func testTheAnswerGatesNothingAndAddsNoStepToLeaving() throws {
        let note = try billingStructSource("private struct CancellationAnswerNote: View {")
        XCTAssertEqual(
            Set(declaredState(note)), Set(["changingPlan"]),
            "the answer grew view state. Anything beyond the plan sheet's presentation "
                + "flag is a flow this note is not allowed to have"
        )
        XCTAssertTrue(disabledExpressions(note).isEmpty, "the answer disables nothing")
        XCTAssertFalse(note.contains("Continue to cancel"))
        XCTAssertFalse(note.contains("ConfirmSheet"))
        XCTAssertEqual(
            note.components(separatedBy: ".sheet(").count - 1, 1,
            "exactly one sheet, and it is the plan switcher"
        )
        XCTAssertTrue(note.contains("ChangePlanSheet("))
    }

    /// Both notes render the offer's OWN words. A literal heading or body here
    /// would be a retention line this client invented, which is the thing the
    /// shared module exists to prevent.
    func testNeitherNoteWritesCopyOfItsOwn() throws {
        let text = try billingStructSource("private struct CancellationAnswerText: View {")
        XCTAssertTrue(text.contains("Text(offer.heading)"))
        XCTAssertTrue(text.contains("Text(offer.body)"))
        for source in [
            try billingStructSource("private struct CancellationAnswerNote: View {"),
            try billingStructSource("private struct WinbackNote: View {"),
        ] {
            XCTAssertTrue(
                source.contains("actionLabel"),
                "the words on the control come from the offer, so all three clients say "
                    + "the same thing"
            )
        }
    }

    /// #481's card forbids persuasion in as many words — "a screen that argues
    /// with them about leaving... is the last thing they will remember about
    /// us". The win-back goes in the Subscription card beside Resubscribe.
    func testTheWinBackIsNowhereNearTheOffRampCard() throws {
        let offRamp = try billingStructSource("private struct OffRampCard: View {")
        for forbidden in ["cancellationOffer(", "WinbackNote", "Resubscribe", "No thanks"] {
            XCTAssertFalse(
                offRamp.contains(forbidden),
                "\(forbidden) appeared inside OffRampCard, whose docblock forbids "
                    + "persuasion: a business is winding down there"
            )
        }
    }

    /// The three gates, and the property that a healthy workspace never asks.
    func testTheWinBackAsksNothingUntilItIsWorthAsking() throws {
        let note = try billingStructSource("private struct WinbackNote: View {")
        let gate = try section(of: note, from: "private var open: Bool {")
        XCTAssertTrue(gate.contains("dismissed"), "a press this session")
        XCTAssertTrue(gate.contains("winbackIsDismissed("), "or a stored stamp")
        XCTAssertTrue(
            gate.contains("isWithinCancellationGrace("),
            "past the release the number is reassignable to another business, so "
                + "'come back and keep your number' stops being true"
        )
        XCTAssertTrue(
            note.contains("guard open else { return }"),
            "the reason is read only once the gates have passed: a paying workspace "
                + "must never run a query for a card it can never see"
        )
    }

    /// "No thanks" must not wait on a round trip, and a failed dismissal must
    /// not put an error box on a wind-down screen.
    func testTheDismissalHidesTheNoteBeforeItTellsTheServer() throws {
        let note = try billingStructSource("private struct WinbackNote: View {")
        let waveAway = try section(of: note, from: "private func waveAway() {")
        guard let hide = waveAway.range(of: "dismissed = true"),
              let send = waveAway.range(of: "dismissWinback(") else {
            return XCTFail("the dismissal no longer hides the note or no longer records it")
        }
        XCTAssertTrue(
            hide.lowerBound < send.lowerBound,
            "hidden first, sent second: a 'no thanks' that argues with a spinner is not a no"
        )
    }

    /// One deadline on this screen, from one function. Two independently
    /// derived ones is one drift away from telling an owner two different days
    /// they lose their business number.
    func testEveryDeadlineOnTheBillingScreenComesFromOneFunction() throws {
        // Comment lines are prose, not code — the same allowance
        // `check-native-a11y.mjs` makes, and for the same reason: without it,
        // explaining why a sentence was removed fails the guard that asked for
        // its removal.
        let source = codeOnly(try billingSource())
        XCTAssertNil(
            source.range(of: "30 \\* 24 \\* 60 \\* 60", options: .regularExpression),
            "the release date is computed by hand somewhere on this screen again"
        )
        XCTAssertEqual(
            source.components(separatedBy: "func numberReleaseDay(").count - 1, 1,
            "one release-date formatter"
        )
        XCTAssertFalse(
            source.contains("30 days after your last period"),
            "the canceled-state card named a date the number does not die on: the hold "
                + "runs from canceled_at, which can be most of a month earlier"
        )
    }

    /// Every sentence on this screen counts the hold from the CANCELLATION.
    ///
    /// The screen said both things at once. `StatusNotices` had been corrected
    /// to "held for 30 days from the day you cancelled — not from that date",
    /// while the cancel card two thirds of the way down still read "Texting
    /// stops at the end of your billing period, and we hold your number for 30
    /// days", which invites the reader to add the two together. Somebody
    /// cancelling on day 2 of a monthly period counted about 59 days and had
    /// about 30, and what they lose at the end of the miscount is the number on
    /// the van.
    ///
    /// Read as the READER sees it, not as it is wrapped: the copy here is
    /// line-broken Swift concatenation, so a guard matching raw source would
    /// pass on any sentence that happened to break in the middle.
    func testEverySentenceOnTheBillingScreenCountsTheHoldFromTheCancellation() throws {
        let rendered = renderedCopy(codeOnly(try billingSource()))

        // Nowhere ties the days to the period — the same property the shared
        // module asserts over its own strings.
        XCTAssertNil(
            rendered.range(
                of: "\\b\\d+ days (after|from|following) (your|the)"
                    + "( last| current| next)?( billing)? period",
                options: [.regularExpression, .caseInsensitive]
            ),
            "the billing screen counts the hold from a billing period again"
        )
        XCTAssertNil(
            rendered.range(
                of: "(period ends?|end of (your|the)[a-z ]*period)[^.]{0,40}"
                    + "\\b(then|and)\\b[^.]{0,30}\\b\\d+ days",
                options: [.regularExpression, .caseInsensitive]
            ),
            "a sentence on the billing screen puts the period end and the hold in "
                + "one breath, which is the arithmetic that overstates the deadline"
        )

        // ...and the positive half, which is what stops this passing on a
        // screen that simply stopped mentioning the hold: every place that
        // names the duration names its anchor in the same breath.
        var searched = rendered[...]
        var mentions = 0
        while let hit = searched.range(of: "\(cancellationGraceDays) days") {
            let after = String(searched[hit.upperBound...].prefix(30))
            XCTAssertTrue(
                after.contains("from the day"),
                "a sentence names the \(cancellationGraceDays)-day hold without its "
                    + "anchor: …\(searched[hit.lowerBound...].prefix(80))"
            )
            mentions += 1
            searched = searched[hit.upperBound...]
        }
        XCTAssertTrue(
            mentions > 0,
            "the billing screen no longer names the hold at all, so the loop above "
                + "checked nothing"
        )
    }

    /// The release date carries its year.
    ///
    /// The day-27 grace email prints "August 4, 2026" through `releaseDateLabel`
    /// in grace.ts and points the reader at this screen, which printed "4
    /// August" — one deadline, two formats, one of them undated. The branch
    /// that suffers is the expired one ("the hold ended on 3 September"), read
    /// by definition after the deadline and possibly a year later by somebody
    /// signing back in to find out what happened to their number.
    func testTheReleaseDateIsPrintedWithItsYearInTheSameShapeTheMailUses() throws {
        let formatter = try topLevelDeclaration(
            try billingSource(),
            "private func numberReleaseDay("
        )
        XCTAssertTrue(
            formatter.contains("\"MMMM d, yyyy\""),
            "the release-date formatter no longer matches releaseDateLabel in "
                + "grace.ts, which is the mail that sends people to this screen"
        )
        XCTAssertTrue(
            formatter.contains("TimeZone(identifier: \"UTC\")"),
            "and stays on the clock runGraceJob runs on: a guessed zone prints a "
                + "date a day either side of the one the job acts on"
        )
    }

    /// The screen may not say the number is already gone.
    ///
    /// The expired-hold copy flips on the DEVICE clock at `canceled_at + 30d`,
    /// while the release runs on a once-daily cron (`0 14 * * *`) that can also
    /// fail and retry — and `runGraceJob` only ever looks at companies whose
    /// `subscription_status` is still `canceled`. For up to a day the number is
    /// suspended-not-released and somebody coming back would keep it, so a past
    /// tense here tells them they have lost something they still have, at the
    /// same moment the win-back disappears.
    func testTheScreenSaysTheHoldEndedRatherThanThatTheNumberIsGone() throws {
        let rendered = renderedCopy(codeOnly(try billingSource()))
        XCTAssertNil(
            rendered.range(
                of: "(has|have) (already )?(gone back|been released|been reassigned)"
                    + "|\\bnumber (is|has) (now )?gone\\b|resubscribing now\\b",
                options: [.regularExpression, .caseInsensitive]
            ),
            "the billing screen claims a release the cron may not have run yet"
        )
        // The positive half: it still says what IS certain at that boundary,
        // which is that the hold is over and we can no longer promise it.
        XCTAssertTrue(
            rendered.contains("hold on your number ended on"),
            "the expired branch no longer says the hold ended"
        )
        XCTAssertTrue(
            rendered.contains("can't promise it any more"),
            "...nor that the number is no longer promised, which is the whole "
                + "honest content of that sentence"
        )
    }

    // MARK: - Reading the card's source

    /// Walk up to the repo's own copy of the sources. The test bundle lives in
    /// DerivedData, so a working directory is not something to guess at.
    private func iosSourceRoot() throws -> URL {
        var dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
        dir.appendPathComponent("Loonext")
        guard FileManager.default.fileExists(atPath: dir.path) else {
            throw XCTSkip("iOS sources not present at \(dir.path)")
        }
        return dir
    }

    /// The billing screen's whole source, line endings normalised — every
    /// brace-matching pattern below is written with LF, and a checkout on a
    /// Windows machine can hand back CRLF.
    private func billingSource() throws -> String {
        let path = try iosSourceRoot()
            .appendingPathComponent("Features")
            .appendingPathComponent("Settings")
            .appendingPathComponent("BillingSection.swift")
        return try String(contentsOf: path, encoding: .utf8)
            .replacingOccurrences(of: "\r\n", with: "\n")
    }

    /// The pure-logic file's source, for the one property that cannot be seen
    /// from the outside: whether a figure was read or typed.
    private func settingsLogicSource() throws -> String {
        let path = try iosSourceRoot()
            .appendingPathComponent("Features")
            .appendingPathComponent("Settings")
            .appendingPathComponent("SettingsLogic.swift")
        return try String(contentsOf: path, encoding: .utf8)
            .replacingOccurrences(of: "\r\n", with: "\n")
    }

    /// One view on that screen, from its declaration to the brace that closes
    /// it at column 0.
    private func billingStructSource(_ declaration: String) throws -> String {
        let text = try billingSource()
        guard let start = text.range(of: declaration) else {
            throw CardSourceMissing.declaration
        }
        let rest = text[start.lowerBound...]
        guard let end = rest.range(of: "\n}\n") else {
            throw CardSourceMissing.closingBrace
        }
        return String(rest[..<end.upperBound])
    }

    /// `CancelCard`'s source.
    private func cancelCardSource() throws -> String {
        try billingStructSource("private struct CancelCard: View {")
    }

    /// The card, plus every view declared on this screen that it renders.
    ///
    /// ONE LEVEL DEEP on purpose, and the depth is the judgement call. The
    /// answer note reaches `ChangePlanSheet` by an explicit press of "Switch to
    /// Starter"; that sheet carries a confirmation, and it is a confirmation of
    /// a PLAN CHANGE, which is a different journey and the right place for one.
    /// Walking into it would make this guard fail on a step that belongs where
    /// it is. What the walk must cover is everything that draws INSIDE the
    /// card, because that is where a second screen could hide from a guard
    /// reading `CancelCard` alone — and did.
    private func cancelCardSubtree() throws -> [SubtreeView] {
        let screen = try billingSource()
        let card = try cancelCardSource()
        var out = [SubtreeView(name: "CancelCard", source: card)]
        for chunk in screen.components(separatedBy: "\nprivate struct ").dropFirst() {
            let name = String(chunk.prefix { $0.isLetter || $0.isNumber || $0 == "_" })
            guard name != "CancelCard", card.contains("\(name)(") else { continue }
            guard let headerEnd = chunk.firstIndex(of: "\n") else { continue }
            out.append(SubtreeView(
                name: name,
                source: try billingStructSource(
                    "private struct " + String(chunk[..<headerEnd])
                )
            ))
        }
        return out
    }

    /// A struct rather than a labelled tuple: Swift key paths do not address
    /// tuple elements, so `subtree.map(\.name)` would not compile.
    private struct SubtreeView {
        let name: String
        let source: String
    }

    /// Every `$flag` a modal in this source is presented from.
    ///
    /// Both spellings, because `.sheet(item:)` and `.sheet(isPresented:)` put
    /// the same screen in front of the same person — the distinction the old
    /// guard drew between them protected nothing.
    private func presentationBindings(_ source: String) -> Set<String> {
        var found: Set<String> = []
        for label in ["isPresented: $", "item: $"] {
            var rest = source[...]
            while let hit = rest.range(of: label) {
                let name = rest[hit.upperBound...].prefix {
                    $0.isLetter || $0.isNumber || $0 == "_"
                }
                if !name.isEmpty { found.insert(String(name)) }
                rest = rest[hit.upperBound...]
            }
        }
        return found
    }

    /// A top-level declaration, from its first line to the brace that closes it
    /// at column 0. `section(of:from:)` above finds MEMBERS, which close one
    /// indent in.
    private func topLevelDeclaration(_ source: String, _ declaration: String) throws -> String {
        guard let start = source.range(of: declaration) else {
            throw CardSourceMissing.member(declaration)
        }
        let rest = source[start.lowerBound...]
        guard let end = rest.range(of: "\n}\n") else {
            throw CardSourceMissing.closingBrace
        }
        return String(rest[..<end.upperBound])
    }

    /// The screen's copy as the READER sees it.
    ///
    /// Swift wraps a long sentence across several literals joined by `+`, so a
    /// guard matching raw source passes on any sentence that happens to break
    /// in the middle of the phrase it bans. Joining the literals first is what
    /// makes a copy assertion mean the copy rather than the wrapping. The one
    /// interpolation resolved is the hold's duration, because every sentence
    /// this file writes about the hold reads it from the constant rather than
    /// typing it, and a pattern looking for digits would find none.
    private func renderedCopy(_ source: String) -> String {
        source
            .replacingOccurrences(
                of: "\"\\s*\\+\\s*\"",
                with: "",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: "\\(cancellationGraceDays)",
                with: "\(cancellationGraceDays)"
            )
    }

    private enum CardSourceMissing: Error {
        case declaration
        case closingBrace
        case member(String)
    }

    /// One member of the card, from its declaration to the brace that closes it
    /// at the card's indentation.
    private func section(of card: String, from declaration: String) throws -> String {
        guard let start = card.range(of: declaration) else {
            throw CardSourceMissing.member(declaration)
        }
        let rest = card[start.upperBound...]
        guard let end = rest.range(of: "\n    }\n") else {
            throw CardSourceMissing.member(declaration)
        }
        return String(rest[..<end.lowerBound])
    }

    /// The source with whole-line comments removed.
    private func codeOnly(_ source: String) -> String {
        source.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
            .joined(separator: "\n")
    }

    /// Every `@State` the card holds, by name.
    private func declaredState(_ source: String) -> [String] {
        source.split(separator: "\n").compactMap { line -> String? in
            guard let marker = line.range(of: "@State private var ") else { return nil }
            let name = line[marker.upperBound...].prefix {
                $0.isLetter || $0.isNumber || $0 == "_"
            }
            return name.isEmpty ? nil : String(name)
        }
    }

    /// What each `.disabled(…)` on the card is asking about.
    private func disabledExpressions(_ source: String) -> [String] {
        source.split(separator: "\n").compactMap { line -> String? in
            guard let marker = line.range(of: ".disabled(") else { return nil }
            let rest = line[marker.upperBound...]
            guard let close = rest.lastIndex(of: ")") else { return nil }
            return String(rest[..<close])
        }
    }

    // MARK: - Role-gate matrix

    func testAdminLevelGatesAdmitOwnerAndAdminRefuseMemberAndUnknown() {
        let adminGates: [(String?) -> Bool] = [
            SettingsRoleGate.canEditWorkspace,
            SettingsRoleGate.canManageTeam,
            SettingsRoleGate.canManageNumbers,
            SettingsRoleGate.canManageNumberAccess,
            SettingsRoleGate.canManageBilling,
        ]
        for gate in adminGates {
            XCTAssertTrue(gate(MemberRole.owner))
            XCTAssertTrue(gate(MemberRole.admin))
            XCTAssertFalse(gate(MemberRole.member))
            XCTAssertFalse(gate(nil))
            XCTAssertFalse(gate("something_new"))
        }
    }

    func testOwnerOnlyGatesRefuseAdmins() {
        let ownerGates: [(String?) -> Bool] = [
            SettingsRoleGate.canChangeOverageCap,
            SettingsRoleGate.canReleaseNumber,
            SettingsRoleGate.canCancelPort,
            SettingsRoleGate.canCancelTextEnablement,
            SettingsRoleGate.canEnableUsTexting,
            SettingsRoleGate.canCancelSubscription,
        ]
        for gate in ownerGates {
            XCTAssertTrue(gate(MemberRole.owner))
            XCTAssertFalse(gate(MemberRole.admin))
            XCTAssertFalse(gate(MemberRole.member))
            XCTAssertFalse(gate(nil))
        }
    }

    func testRoleChangeNeverTouchesTheOwnerRowOrDeactivatedRows() {
        let owner = member("o", role: MemberRole.owner)
        let active = member("a")
        let gone = member("g", deactivatedAt: "2026-07-10T00:00:00Z")

        XCTAssertFalse(SettingsRoleGate.canChangeRoleOf(actorRole: MemberRole.admin, target: owner))
        XCTAssertFalse(SettingsRoleGate.canChangeRoleOf(actorRole: MemberRole.admin, target: gone))
        XCTAssertTrue(SettingsRoleGate.canChangeRoleOf(actorRole: MemberRole.admin, target: active))
        XCTAssertFalse(SettingsRoleGate.canChangeRoleOf(actorRole: MemberRole.member, target: active))
    }

    func testDeactivationAlsoRefusesSelf() {
        let target = member("t", userId: "user-me")
        XCTAssertFalse(
            SettingsRoleGate.canDeactivate(actorRole: MemberRole.owner, target: target, selfUserId: "user-me")
        )
        XCTAssertTrue(
            SettingsRoleGate.canDeactivate(actorRole: MemberRole.owner, target: target, selfUserId: "user-other")
        )
        XCTAssertFalse(
            SettingsRoleGate.canDeactivate(
                actorRole: MemberRole.admin,
                target: member("o", role: MemberRole.owner),
                selfUserId: "user-other"
            )
        )
    }

    // MARK: - CNAM (carrier rule: 1-15 letters, digits, spaces)

    func testCnamAcceptsTheCarrierAlphabetOnly() {
        XCTAssertTrue(isValidCnam("Loonext"))
        XCTAssertTrue(isValidCnam("Apex Plumbing 2"))
        XCTAssertTrue(isValidCnam("A"))
        XCTAssertTrue(isValidCnam("123456789012345")) // exactly 15
        XCTAssertFalse(isValidCnam("")) // empty
        XCTAssertFalse(isValidCnam("1234567890123456")) // 16
        XCTAssertFalse(isValidCnam("Apex-Plumbing")) // hyphen
        XCTAssertFalse(isValidCnam("Café")) // accents
        XCTAssertFalse(isValidCnam("Apex & Sons")) // ampersand
    }

    // MARK: - Overage cap (mirror of web lib/settings/cap-control.ts)

    func testNullAndOutOfRangeMultipliersNormalizeToTheCeiling() {
        XCTAssertEqual(normalizeCapMultiplier(nil), 10.0)
        XCTAssertEqual(normalizeCapMultiplier(0.0), 10.0)
        XCTAssertEqual(normalizeCapMultiplier(-3.0), 10.0)
        XCTAssertEqual(normalizeCapMultiplier(25.0), 10.0)
        XCTAssertEqual(normalizeCapMultiplier(3.0), 3.0)
    }

    func testCapLabelNamesTheCeilingAndTrimsTrailingZeros() {
        XCTAssertEqual(capLabel(nil), "Maximum (10×)")
        XCTAssertEqual(capLabel(10.0), "Maximum (10×)")
        XCTAssertEqual(capLabel(2.0), "2×")
        XCTAssertEqual(capLabel(2.5), "2.5×")
    }

    func testCapSegmentsRoundsLikeTheApi() {
        XCTAssertEqual(capSegments(includedSegments: 500, multiplier: 2.5), 1250)
        XCTAssertEqual(capSegments(includedSegments: 500, multiplier: nil), 5000) // nil = ceiling
    }

    func testSelectingTheCurrentCapNeedsNoConfirmation() {
        let change = describeCapChange(current: 3.0, next: 3.0, includedSegments: 500)
        XCTAssertFalse(change.requiresConfirmation)
        XCTAssertEqual(change.summary, "")
    }

    func testRaisingTheCapNamesBothPausePoints() {
        let change = describeCapChange(current: 2.0, next: 3.0, includedSegments: 500)
        XCTAssertTrue(change.requiresConfirmation)
        XCTAssertEqual(change.title, "Set the cap to 3×?")
        XCTAssertEqual(
            change.summary,
            "Sending pauses at 1,500 messages this period instead of 1,000."
        )
    }

    func testRaisingToTheCeilingStatesTheBillingConsequence() {
        let change = describeCapChange(current: 2.0, next: 10.0, includedSegments: 2500)
        XCTAssertEqual(change.title, "Set the cap to Maximum (10×)?")
        XCTAssertEqual(
            change.summary,
            "Sending pauses at 25,000 messages this period instead of 5,000. That's "
                + "the highest the cap goes. Every message over your 2,500 included is "
                + "billed at the overage rate until sending pauses."
        )
    }

    func testLoweringWarnsSendsMayPauseRightAway() {
        let change = describeCapChange(current: 5.0, next: 2.0, includedSegments: 500)
        XCTAssertTrue(change.requiresConfirmation)
        XCTAssertEqual(
            change.summary,
            "Sending pauses at 1,000 messages this period. If you're already past "
                + "that, sends pause right away."
        )
    }

    func testLegacyNullCapComparesEqualToTheMaximumPreset() {
        XCTAssertFalse(describeCapChange(current: nil, next: 10.0, includedSegments: 500).requiresConfirmation)
    }

    // MARK: - Merge fields (drop-empty wire semantics)

    func testMergeFieldsSubstituteAndDropEmptiesCleanly() {
        XCTAssertEqual(
            applyMergeFields("Hi {first_name}, {business_name} here.", contactName: "Dana Smith", businessName: "Apex"),
            "Hi Dana, Apex here."
        )
        // A missed call carries no contact: {first_name} drops and tidies.
        XCTAssertEqual(
            applyMergeFields("Hi {first_name}, {business_name} here.", contactName: nil, businessName: "Apex"),
            "Hi, Apex here."
        )
        XCTAssertEqual(
            applyMergeFields("No tokens.", contactName: "Dana", businessName: "Apex"),
            "No tokens."
        )
        XCTAssertEqual(
            applyMergeFields("Hi {unknown_token}.", contactName: "Dana", businessName: "Apex"),
            "Hi."
        )
    }

    // MARK: - Business hours

    func testHhmmWindowsValidateOvernightAllowedEqualEndsRefused() {
        XCTAssertTrue(isValidDayWindow(open: "09:00", close: "17:00"))
        XCTAssertTrue(isValidDayWindow(open: "18:00", close: "02:00")) // overnight supported
        XCTAssertFalse(isValidDayWindow(open: "09:00", close: "09:00")) // reads as closed
        XCTAssertFalse(isValidDayWindow(open: "9:00", close: "17:00"))
        XCTAssertFalse(isValidDayWindow(open: "09:60", close: "17:00"))
        XCTAssertFalse(isValidDayWindow(open: "24:00", close: "17:00"))
    }

    func testFormatHhmmRendersTwelveHourLabels() {
        XCTAssertEqual(formatHhmm("09:00"), "9:00 AM")
        XCTAssertEqual(formatHhmm("00:30"), "12:30 AM")
        XCTAssertEqual(formatHhmm("12:00"), "12:00 PM")
        XCTAssertEqual(formatHhmm("17:45"), "5:45 PM")
    }

    // MARK: - Number picker digit filter

    func testDigitFilterIsAContainsMatchOverTheNationalNumber() {
        XCTAssertTrue(matchesDigitFilter(e164: "+14165550182", filter: "555"))
        XCTAssertTrue(matchesDigitFilter(e164: "+14165550182", filter: ""))
        XCTAssertTrue(matchesDigitFilter(e164: "+14165550182", filter: "416"))
        XCTAssertFalse(matchesDigitFilter(e164: "+14165550182", filter: "999"))
    }

    // MARK: - Number status honesty

    private func number(
        status: String,
        failureReason: String? = nil,
        attempts: Int? = 0,
        areaCode: String? = nil
    ) -> PhoneNumberSummary {
        PhoneNumberSummary(
            id: "n1",
            status: status,
            country: "US",
            number_e164: nil,
            requested_area_code: areaCode,
            created_at: "2026-07-01T00:00:00Z",
            source: nil,
            voice_enabled: nil,
            suspended_at: nil,
            released_at: nil,
            failure_reason: failureReason,
            provision_attempts: attempts,
            retrying: nil
        )
    }

    func testATransientFailureStillRetryingIsNotAnActionNeededState() {
        let transient = number(status: NumberStatus.provisionFailed, failureReason: "api_error", attempts: 1)
        XCTAssertFalse(needsNumberChoice(transient))
        XCTAssertEqual(
            failedNumberCopy(transient),
            "We're still setting up your number. This is taking a little longer than usual."
        )
    }

    func testExhaustedInventoryNamesTheAreaCode() {
        let dry = number(
            status: NumberStatus.provisionFailed,
            failureReason: "no_inventory",
            attempts: 1,
            areaCode: "416"
        )
        XCTAssertTrue(needsNumberChoice(dry))
        XCTAssertEqual(
            failedNumberCopy(dry),
            "Area code 416 is out of new numbers right now. Choose another number to "
                + "finish setup."
        )
    }

    func testAStalledOrderPromisesNoDoubleCharge() {
        let stalled = number(status: NumberStatus.provisionFailed, failureReason: "timeout", attempts: 5)
        XCTAssertTrue(needsNumberChoice(stalled))
        XCTAssertEqual(
            failedNumberCopy(stalled),
            "Setup is taking longer than expected. Choose a number to finish — you "
                + "won't be charged again."
        )
    }

    // MARK: - Port stepper

    func testPortStatusesMapOntoTheCalmFourStepTracker() {
        XCTAssertEqual(portStepIndex(PortStatus.draft), 0)
        XCTAssertEqual(portStepIndex(PortStatus.submitted), 1)
        XCTAssertEqual(portStepIndex(PortStatus.exception), 1)
        XCTAssertEqual(portStepIndex(PortStatus.inProcess), 2)
        XCTAssertEqual(portStepIndex(PortStatus.focDateConfirmed), 2)
        XCTAssertEqual(portStepIndex(PortStatus.activationInProgress), 2)
        XCTAssertEqual(portStepIndex(PortStatus.ported), 3)
        XCTAssertEqual(portStepIndex(PortStatus.cancelled), -1)
        XCTAssertEqual(portStepIndex("brand_new_status"), -1)
    }

    // MARK: - Formatting

    func testMoneyAndBytesFormatPlainly() {
        XCTAssertEqual(formatMonthlyCents(500), "$5")
        XCTAssertEqual(formatMonthlyCents(750), "$7.50")
        XCTAssertEqual(formatCents(1234), "$12.34")
        XCTAssertEqual(formatBytes(0), "0 B")
        XCTAssertEqual(formatBytes(412 * 1024), "412 KB")
        XCTAssertEqual(formatBytes(Int(1.2 * 1024 * 1024 * 1024)), "1.2 GB")
    }

    func testNanpInputNormalizesToE164OrRefuses() {
        XCTAssertEqual(normalizeNanpInput("(416) 555-0182"), "+14165550182")
        XCTAssertEqual(normalizeNanpInput("14165550182"), "+14165550182")
        XCTAssertEqual(normalizeNanpInput("+1 416 555 0182"), "+14165550182")
        XCTAssertNil(normalizeNanpInput("555-0182"))
        XCTAssertNil(normalizeNanpInput(""))
    }

    func testInviteLinkMatchesTheWebOrigin() {
        XCTAssertEqual(inviteLink("abc"), "https://app.loonext.com/invite/abc")
    }

    // MARK: - #178 usage presentation (mirror of Android UsageStatusLogicTest)

    private func usage(
        status: String = UsageStatus.quiet,
        usedSegments: Int = 0,
        includedSegments: Int = 500,
        capSegments: Int? = 5000,
        usedMinutes: Int = 0,
        includedMinutes: Int = 2500,
        capMinutes: Int? = 25000
    ) -> Usage {
        Usage(
            status: status,
            included_segments: includedSegments,
            used_segments: usedSegments,
            cap_segments: capSegments,
            voice: UsageVoice(
                used_minutes: usedMinutes,
                included_minutes: includedMinutes,
                cap_minutes: capMinutes
            )
        )
    }

    func testPacingSubjectNamesTheHotterMeter() {
        XCTAssertEqual(pacingSubject(usage(usedSegments: 450, usedMinutes: 100)), "Messages")
        XCTAssertEqual(pacingSubject(usage(usedSegments: 50, usedMinutes: 2400)), "Calling minutes")
        XCTAssertEqual(
            pacingSubject(usage(usedSegments: 600, usedMinutes: 2600)),
            "Messages and calling minutes"
        )
        // One over, one merely warm: name the hot one alone.
        XCTAssertEqual(pacingSubject(usage(usedSegments: 600, usedMinutes: 2000)), "Messages")
        // Zero allowances never divide; the calm default noun wins.
        XCTAssertEqual(pacingSubject(usage(includedSegments: 0, includedMinutes: 0)), "Messages")
    }

    func testCapUseRatioTakesTheHotterCapMeter() {
        let hotVoice = usage(usedSegments: 500, usedMinutes: 23750)
        XCTAssertEqual(capUseRatio(hotVoice), 0.95, accuracy: 1e-9)
        XCTAssertEqual(capUsePercent(hotVoice), 95)
    }

    func testCapUsePercentClampsAtOneHundred() {
        XCTAssertEqual(capUsePercent(usage(usedSegments: 6000)), 100)
    }

    func testCapUseRatioReadsNullCapsAsZero() {
        XCTAssertEqual(
            capUseRatio(usage(usedSegments: 400, capSegments: nil, capMinutes: nil)),
            0.0,
            accuracy: 1e-9
        )
    }

    func testUsagePresentationMapsStatusAndDefaultsUnknownToQuiet() {
        XCTAssertEqual(usagePresentation(UsageStatus.quiet), .quiet)
        XCTAssertEqual(usagePresentation(UsageStatus.pacing), .pacing)
        XCTAssertEqual(usagePresentation(UsageStatus.capped), .capped)
        XCTAssertEqual(usagePresentation("brand_new_status"), .quiet)
    }

    func testPayloadsWithoutStatusDecodeAsTheCalmState() throws {
        let decoded = try JSONDecoder().decode(Usage.self, from: Data(#"{"used_segments":12}"#.utf8))
        XCTAssertEqual(decoded.status, UsageStatus.quiet)
        XCTAssertEqual(decoded.used_segments, 12)
    }

    // MARK: - #192 text-back (a blank message is legal, sends the default)

    func testBlankTextBackResolvesToTheDefaultNeverBlocksEnabling() {
        // A blank local edit falls back to the server's effective template.
        XCTAssertEqual(
            mctbSendTemplate(message: "   ", effectiveMessage: "Custom from server"),
            "Custom from server"
        )
        // Blank with no server hint falls back to the bundled default.
        XCTAssertEqual(mctbSendTemplate(message: "", effectiveMessage: nil), defaultMctbMessage)
        // A real edit wins and is trimmed.
        XCTAssertEqual(
            mctbSendTemplate(message: "  Text us back  ", effectiveMessage: "ignored"),
            "Text us back"
        )
    }

    // MARK: - #193 caller ID (defaults to the company name)

    func testCompanyNameSanitizesToTheCarrierAlphabet() {
        XCTAssertEqual(cnamFromCompanyName("Ace Plumbing & Co."), "Ace Plumbing Co")
        XCTAssertEqual(cnamFromCompanyName("  O'Brien   Heating  "), "O Brien Heating")
        // The 15-char cut lands on a word gap; no trailing space survives.
        XCTAssertEqual(cnamFromCompanyName("Best Home Reno Pros"), "Best Home Reno")
        XCTAssertEqual(cnamFromCompanyName("--- !!! ---"), "")
    }

    func testSubmittedCnamChangeReadsPendingForThreeDaysThenSettles() throws {
        let now = try XCTUnwrap(parseWireTimestamp("2026-07-15T12:00:00Z"))
        XCTAssertFalse(cnamChangePending(submittedAt: nil, now: now))
        XCTAssertTrue(cnamChangePending(submittedAt: "2026-07-15T11:00:00Z", now: now)) // an hour ago
        XCTAssertTrue(cnamChangePending(submittedAt: "2026-07-13T00:00:00+00:00", now: now)) // offset form
        XCTAssertFalse(cnamChangePending(submittedAt: "2026-07-01T00:00:00Z", now: now)) // long past
        XCTAssertFalse(cnamChangePending(submittedAt: "not-a-timestamp", now: now))
    }

    func testCallerIdAndTextBackModelDefaultsMirrorTheServer() throws {
        let company: CompanyView = try JSONDecoder().decode(CompanyView.self, from: Data(#"""
        {"id":"c1","name":"Acme","country":"US","us_texting_enabled":true,
         "requested_area_code":"415","timezone":"America/Toronto",
         "subscription_status":"active",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}
        """#.utf8))
        // #193: caller ID defaults to the company name when the server omits it.
        XCTAssertEqual(company.caller_id_source, "company_name")
        XCTAssertNil(company.caller_id_effective)
        XCTAssertNil(company.cnam_submitted_at)
        // #192: the effective template is absent and not custom until set.
        XCTAssertNil(company.mctb_effective_message)
        XCTAssertFalse(company.mctb_message_is_custom)
        // #393: signing is OFF unless the server says otherwise — D4's reversal
        // is the default. This is the assertion that catches a plain `Bool`
        // where @Default<DefaultFalse> is required (a Worker omitting the field
        // would fail to decode the WHOLE response), and a camelCase property
        // name, which would silently never decode.
        XCTAssertFalse(company.first_message_identification)
        XCTAssertNil(company.first_message_identification_suffix)
        // #225: the night-texting confirmation defaults ON when the server omits
        // it, and the direction is the whole point — a missing compliance flag
        // must fail toward asking, never toward sending silently. Same decoder
        // trap as the line above, in the opposite direction: a plain `Bool` here
        // would fail the WHOLE response, and @Default<DefaultFalse> would quietly
        // drop the prompt for every company on an older Worker.
        XCTAssertTrue(company.quiet_hours_confirm_enabled)
    }

    /// #393: the per-customer half of the signing decision, which decides
    /// whether the composer's part count includes the signature.
    func testTheSignatureAppliesOncePerCustomer() {
        let suffix = " - Acme. Reply STOP to opt out"
        // Signing off: never, whatever the customer's history.
        XCTAssertNil(Signature.pending(companySuffix: nil, alreadySignedAt: nil))
        XCTAssertNil(Signature.pending(companySuffix: "  ", alreadySignedAt: nil))
        // On, and this customer has never been signed to — including a raw
        // number, which has no contact row and so passes nil.
        XCTAssertEqual(
            Signature.pending(companySuffix: suffix, alreadySignedAt: nil),
            suffix
        )
        // On, but they have already been told who we are.
        XCTAssertNil(
            Signature.pending(
                companySuffix: suffix,
                alreadySignedAt: "2026-07-20T10:00:00Z"
            )
        )
    }

    /// #393: the append rule, ported. A body that already ends with the
    /// signature must not grow a second copy.
    func testTheSignatureIsAppendedOnceAndOnlyOnce() {
        let suffix = " - Acme. Reply STOP to opt out"
        XCTAssertEqual(Signature.append("On my way", suffix: suffix), "On my way" + suffix)
        XCTAssertEqual(Signature.append("On my way", suffix: nil), "On my way")
        XCTAssertEqual(Signature.append("On my way", suffix: "   "), "On my way")
        let once = Signature.append("On my way", suffix: suffix)
        XCTAssertEqual(Signature.append(once, suffix: suffix), once)
        // Trailing whitespace must not defeat the guard.
        XCTAssertEqual(Signature.append(once + "  ", suffix: suffix), once + "  ")
    }

    // MARK: - #392: THE SHARED SEAT FIXTURE
    // Hand-ported case for case from packages/shared/src/seats.test.ts.
    // Adding a case there means adding it here. The seat ceiling is the
    // Starter-to-Pro upgrade trigger and has already moved twice; a drifted
    // copy does not degrade a feature, it misprices the product on iOS.

    func testSeatCasesMatchTheSharedFixture() {
        let cases: [(members: Int, invites: Int, plan: String?, served: Int?, used: Int, limit: Int, full: Bool, canUpgrade: Bool, line: String)] = [
            (members: 1, invites: 0, plan: "starter", served: nil, used: 1, limit: 3, full: false, canUpgrade: false, line: "1 of 3 seats"),
            (members: 2, invites: 0, plan: "pro", served: nil, used: 2, limit: 15, full: false, canUpgrade: false, line: "2 of 15 seats"),
            (members: 2, invites: 1, plan: "starter", served: nil, used: 3, limit: 3, full: true, canUpgrade: true, line: "3 of 3 seats. Upgrade for more"),
            (members: 3, invites: 0, plan: "starter", served: nil, used: 3, limit: 3, full: true, canUpgrade: true, line: "3 of 3 seats. Upgrade for more"),
            (members: 15, invites: 0, plan: "pro", served: nil, used: 15, limit: 15, full: true, canUpgrade: false, line: "15 of 15 seats"),
            (members: 3, invites: 0, plan: nil, served: nil, used: 3, limit: 3, full: true, canUpgrade: true, line: "3 of 3 seats. Upgrade for more"),
            (members: 5, invites: 0, plan: "starter", served: nil, used: 5, limit: 3, full: true, canUpgrade: true, line: "5 of 3 seats. Upgrade for more"),
            (members: 16, invites: 0, plan: "pro", served: 20, used: 16, limit: 20, full: false, canUpgrade: false, line: "16 of 20 seats"),
            (members: 1, invites: 0, plan: "starter", served: 0, used: 1, limit: 3, full: false, canUpgrade: false, line: "1 of 3 seats"),
        ]
        for c in cases {
            let usage = seatUsage(
                activeMembers: c.members,
                pendingInvites: c.invites,
                plan: c.plan,
                servedLimit: c.served
            )
            let label = "\(c.members)+\(c.invites) on \(c.plan ?? "nil") served \(c.served.map(String.init) ?? "nil")"
            XCTAssertEqual(usage.used, c.used, label)
            XCTAssertEqual(usage.limit, c.limit, label)
            XCTAssertEqual(usage.full, c.full, label)
            XCTAssertEqual(usage.canUpgrade, c.canUpgrade, label)
            XCTAssertEqual(usage.line, c.line, label)
        }
    }
}
