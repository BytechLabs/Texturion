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

    func testNothingStandsBetweenTheCardAndStripe() throws {
        let card = try cancelCardSource()
        XCTAssertFalse(
            card.contains("ConfirmSheet"),
            "an 'are you sure' step here is the friction the rule forbids"
        )
        XCTAssertFalse(
            card.contains(".sheet(isPresented:"),
            "a sheet presented from this card is the second screen under another name "
                + "(the share sheet is .sheet(item:), and only opens after an export)"
        )
        XCTAssertFalse(
            card.contains("Never mind"),
            "a second button beside the confirm invites the asymmetry this card avoids: "
                + "with nothing expanded there is nothing to back out of"
        )
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

    /// `CancelCard`'s source, from its declaration to the brace that closes it
    /// at column 0.
    private func cancelCardSource() throws -> String {
        let path = try iosSourceRoot()
            .appendingPathComponent("Features")
            .appendingPathComponent("Settings")
            .appendingPathComponent("BillingSection.swift")
        // Normalised, because every brace-matching pattern below is written
        // with LF and a checkout on a Windows machine can hand back CRLF.
        let text = try String(contentsOf: path, encoding: .utf8)
            .replacingOccurrences(of: "\r\n", with: "\n")
        guard let start = text.range(of: "private struct CancelCard: View {") else {
            throw CardSourceMissing.declaration
        }
        let rest = text[start.lowerBound...]
        guard let end = rest.range(of: "\n}\n") else {
            throw CardSourceMissing.closingBrace
        }
        return String(rest[..<end.upperBound])
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
