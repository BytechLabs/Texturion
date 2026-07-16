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
            company_name: nil
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
}
