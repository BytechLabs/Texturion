package com.loonext.android.features.settings

import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class SettingsLogicTest {
    // -- fixtures -------------------------------------------------------------

    private fun member(
        id: String,
        role: String = MemberRole.MEMBER,
        deactivatedAt: String? = null,
        userId: String = "user-$id",
    ) = Member(
        id = id,
        user_id = userId,
        role = role,
        deactivated_at = deactivatedAt,
        created_at = "2026-07-01T00:00:00Z",
        display_name = "Member $id",
    )

    private fun invite(
        id: String,
        expiresAt: String,
        acceptedAt: String? = null,
        revokedAt: String? = null,
    ) = Invite(
        id = id,
        company_id = "co",
        email = "$id@example.com",
        role = MemberRole.MEMBER,
        invited_by = "user-1",
        expires_at = expiresAt,
        accepted_at = acceptedAt,
        revoked_at = revokedAt,
        created_at = "2026-07-01T00:00:00Z",
    )

    private val now: Instant = Instant.parse("2026-07-15T12:00:00Z")

    // -- seat math (mirror of routes/team.ts + lib/settings/seat-line.ts) -----

    @Test
    fun `seatLimit reads null plan as Starter`() {
        assertEquals(3, seatLimit(null))
        assertEquals(3, seatLimit("starter"))
        assertEquals(15, seatLimit("pro"))
    }

    @Test
    fun `pending invites exclude accepted, revoked, and expired rows`() {
        val invites = listOf(
            invite("live", expiresAt = "2026-07-16T00:00:00Z"),
            invite("expired", expiresAt = "2026-07-14T00:00:00Z"),
            invite("accepted", expiresAt = "2026-07-16T00:00:00Z", acceptedAt = "2026-07-10T00:00:00Z"),
            invite("revoked", expiresAt = "2026-07-16T00:00:00Z", revokedAt = "2026-07-10T00:00:00Z"),
            invite("garbage", expiresAt = "not-a-date"),
        )
        assertEquals(1, pendingInviteCount(invites, now))
    }

    @Test
    fun `seat usage counts active members plus pending invites`() {
        val members = listOf(
            member("1", role = MemberRole.OWNER),
            member("2"),
            member("3", deactivatedAt = "2026-07-10T00:00:00Z"),
        )
        val usage = seatUsage(
            activeMembers = countActiveMembers(members),
            pendingInvites = 1,
            plan = "starter",
        )
        assertEquals(3, usage.used)
        assertEquals(3, usage.limit)
        assertTrue(usage.full)
        assertEquals("3 of 3 seats. Upgrade for more", usage.line)
    }

    @Test
    fun `full Pro plan gets no upgrade nudge — Pro is the top self-serve plan`() {
        val usage = seatUsage(activeMembers = 15, pendingInvites = 0, plan = "pro")
        assertTrue(usage.full)
        assertEquals("15 of 15 seats", usage.line)
    }

    @Test
    fun `under capacity reads plainly`() {
        assertEquals("2 of 3 seats", seatUsage(2, 0, null).line)
        assertFalse(seatUsage(2, 0, null).full)
    }

    // -- role-gate matrix ------------------------------------------------------

    @Test
    fun `admin-level gates admit owner and admin, refuse member and unknown`() {
        val adminGates = listOf<(String?) -> Boolean>(
            SettingsRoleGate::canEditWorkspace,
            SettingsRoleGate::canManageTeam,
            SettingsRoleGate::canManageNumbers,
            SettingsRoleGate::canManageNumberAccess,
            SettingsRoleGate::canManageBilling,
        )
        adminGates.forEach { gate ->
            assertTrue(gate(MemberRole.OWNER))
            assertTrue(gate(MemberRole.ADMIN))
            assertFalse(gate(MemberRole.MEMBER))
            assertFalse(gate(null))
            assertFalse(gate("something_new"))
        }
    }

    @Test
    fun `owner-only gates refuse admins`() {
        val ownerGates = listOf<(String?) -> Boolean>(
            SettingsRoleGate::canChangeOverageCap,
            SettingsRoleGate::canReleaseNumber,
            SettingsRoleGate::canCancelPort,
            SettingsRoleGate::canCancelTextEnablement,
            SettingsRoleGate::canEnableUsTexting,
        )
        ownerGates.forEach { gate ->
            assertTrue(gate(MemberRole.OWNER))
            assertFalse(gate(MemberRole.ADMIN))
            assertFalse(gate(MemberRole.MEMBER))
            assertFalse(gate(null))
        }
    }

    @Test
    fun `role change never touches the owner row or deactivated rows`() {
        val owner = member("o", role = MemberRole.OWNER)
        val active = member("a")
        val gone = member("g", deactivatedAt = "2026-07-10T00:00:00Z")

        assertFalse(SettingsRoleGate.canChangeRoleOf(MemberRole.ADMIN, owner))
        assertFalse(SettingsRoleGate.canChangeRoleOf(MemberRole.ADMIN, gone))
        assertTrue(SettingsRoleGate.canChangeRoleOf(MemberRole.ADMIN, active))
        assertFalse(SettingsRoleGate.canChangeRoleOf(MemberRole.MEMBER, active))
    }

    @Test
    fun `deactivation also refuses self`() {
        val target = member("t", userId = "user-me")
        assertFalse(SettingsRoleGate.canDeactivate(MemberRole.OWNER, target, "user-me"))
        assertTrue(SettingsRoleGate.canDeactivate(MemberRole.OWNER, target, "user-other"))
        assertFalse(
            SettingsRoleGate.canDeactivate(
                MemberRole.ADMIN,
                member("o", role = MemberRole.OWNER),
                "user-other",
            ),
        )
    }

    // -- CNAM (carrier rule: 1-15 letters, digits, spaces) ----------------------

    @Test
    fun `CNAM accepts the carrier alphabet only`() {
        assertTrue(isValidCnam("Loonext"))
        assertTrue(isValidCnam("Apex Plumbing 2"))
        assertTrue(isValidCnam("A"))
        assertTrue(isValidCnam("123456789012345")) // exactly 15
        assertFalse(isValidCnam("")) // empty
        assertFalse(isValidCnam("1234567890123456")) // 16
        assertFalse(isValidCnam("Apex-Plumbing")) // hyphen
        assertFalse(isValidCnam("Café")) // accents
        assertFalse(isValidCnam("Apex & Sons")) // ampersand
    }

    // -- overage cap (mirror of web lib/settings/cap-control.ts) ---------------

    @Test
    fun `null and out-of-range multipliers normalize to the 10x ceiling`() {
        assertEquals(10.0, normalizeCapMultiplier(null), 0.0)
        assertEquals(10.0, normalizeCapMultiplier(0.0), 0.0)
        assertEquals(10.0, normalizeCapMultiplier(-3.0), 0.0)
        assertEquals(10.0, normalizeCapMultiplier(25.0), 0.0)
        assertEquals(3.0, normalizeCapMultiplier(3.0), 0.0)
    }

    @Test
    fun `capLabel names the ceiling and trims trailing zeros`() {
        assertEquals("Maximum (10×)", capLabel(null))
        assertEquals("Maximum (10×)", capLabel(10.0))
        assertEquals("2×", capLabel(2.0))
        assertEquals("2.5×", capLabel(2.5))
    }

    @Test
    fun `capSegments rounds like the API`() {
        assertEquals(1250L, capSegments(500, 2.5))
        assertEquals(5000L, capSegments(500, null)) // null = ceiling
    }

    @Test
    fun `selecting the current cap needs no confirmation`() {
        val change = describeCapChange(3.0, 3.0, 500)
        assertFalse(change.requiresConfirmation)
        assertEquals("", change.summary)
    }

    @Test
    fun `raising the cap names both pause points`() {
        val change = describeCapChange(2.0, 3.0, 500)
        assertTrue(change.requiresConfirmation)
        assertEquals("Set the cap to 3×?", change.title)
        assertEquals(
            "Sending pauses at 1,500 messages this period instead of 1,000.",
            change.summary,
        )
    }

    @Test
    fun `raising to the ceiling states the billing consequence`() {
        val change = describeCapChange(2.0, 10.0, 2500)
        assertEquals("Set the cap to Maximum (10×)?", change.title)
        assertEquals(
            "Sending pauses at 25,000 messages this period instead of 5,000. That's " +
                "the highest the cap goes. Every message over your 2,500 included is " +
                "billed at the overage rate until sending pauses.",
            change.summary,
        )
    }

    @Test
    fun `lowering warns sends may pause right away`() {
        val change = describeCapChange(5.0, 2.0, 500)
        assertTrue(change.requiresConfirmation)
        assertEquals(
            "Sending pauses at 1,000 messages this period. If you're already past " +
                "that, sends pause right away.",
            change.summary,
        )
    }

    @Test
    fun `legacy null cap compares equal to the Maximum preset`() {
        assertFalse(describeCapChange(null, 10.0, 500).requiresConfirmation)
    }

    // -- merge fields (drop-empty wire semantics) -------------------------------

    @Test
    fun `merge fields substitute and drop empties cleanly`() {
        assertEquals(
            "Hi Dana, Apex here.",
            applyMergeFields("Hi {first_name}, {business_name} here.", "Dana Smith", "Apex"),
        )
        // A missed call carries no contact: {first_name} drops and tidies.
        assertEquals(
            "Hi, Apex here.",
            applyMergeFields("Hi {first_name}, {business_name} here.", null, "Apex"),
        )
        assertEquals("No tokens.", applyMergeFields("No tokens.", "Dana", "Apex"))
        assertEquals("Hi.", applyMergeFields("Hi {unknown_token}.", "Dana", "Apex"))
    }

    // -- business hours ----------------------------------------------------------

    @Test
    fun `HHMM windows validate, overnight allowed, equal ends refused`() {
        assertTrue(isValidDayWindow("09:00", "17:00"))
        assertTrue(isValidDayWindow("18:00", "02:00")) // overnight supported
        assertFalse(isValidDayWindow("09:00", "09:00")) // reads as closed
        assertFalse(isValidDayWindow("9:00", "17:00"))
        assertFalse(isValidDayWindow("09:60", "17:00"))
        assertFalse(isValidDayWindow("24:00", "17:00"))
    }

    @Test
    fun `formatHhmm renders 12-hour labels`() {
        assertEquals("9:00 AM", formatHhmm("09:00"))
        assertEquals("12:30 AM", formatHhmm("00:30"))
        assertEquals("12:00 PM", formatHhmm("12:00"))
        assertEquals("5:45 PM", formatHhmm("17:45"))
    }

    // -- number picker digit filter ----------------------------------------------

    @Test
    fun `digit filter is a contains match over the national number`() {
        assertTrue(matchesDigitFilter("+14165550182", "555"))
        assertTrue(matchesDigitFilter("+14165550182", ""))
        assertTrue(matchesDigitFilter("+14165550182", "416"))
        assertFalse(matchesDigitFilter("+14165550182", "999"))
    }

    // -- number status honesty -----------------------------------------------------

    private fun number(
        status: String,
        failureReason: String? = null,
        attempts: Int? = 0,
        areaCode: String? = null,
    ) = PhoneNumberSummary(
        id = "n1",
        status = status,
        country = "US",
        number_e164 = null,
        requested_area_code = areaCode,
        created_at = "2026-07-01T00:00:00Z",
        failure_reason = failureReason,
        provision_attempts = attempts,
    )

    @Test
    fun `a transient failure still retrying is not an action-needed state`() {
        val transient = number(NumberStatus.PROVISION_FAILED, "api_error", attempts = 1)
        assertFalse(needsNumberChoice(transient))
        assertEquals(
            "We're still setting up your number. This is taking a little longer than usual.",
            failedNumberCopy(transient),
        )
    }

    @Test
    fun `exhausted inventory names the area code`() {
        val dry = number(
            NumberStatus.PROVISION_FAILED,
            "no_inventory",
            attempts = 1,
            areaCode = "416",
        )
        assertTrue(needsNumberChoice(dry))
        assertEquals(
            "Area code 416 is out of new numbers right now. Choose another number to " +
                "finish setup.",
            failedNumberCopy(dry),
        )
    }

    @Test
    fun `a stalled order promises no double charge`() {
        val stalled = number(NumberStatus.PROVISION_FAILED, "timeout", attempts = 5)
        assertTrue(needsNumberChoice(stalled))
        assertEquals(
            "Setup is taking longer than expected. Choose a number to finish — you " +
                "won't be charged again.",
            failedNumberCopy(stalled),
        )
    }

    // -- port stepper -----------------------------------------------------------

    @Test
    fun `port statuses map onto the calm four-step tracker`() {
        assertEquals(0, portStepIndex(PortStatus.DRAFT))
        assertEquals(1, portStepIndex(PortStatus.SUBMITTED))
        assertEquals(1, portStepIndex(PortStatus.EXCEPTION))
        assertEquals(2, portStepIndex(PortStatus.IN_PROCESS))
        assertEquals(2, portStepIndex(PortStatus.FOC_DATE_CONFIRMED))
        assertEquals(2, portStepIndex(PortStatus.ACTIVATION_IN_PROGRESS))
        assertEquals(3, portStepIndex(PortStatus.PORTED))
        assertEquals(-1, portStepIndex(PortStatus.CANCELLED))
        assertEquals(-1, portStepIndex("brand_new_status"))
    }

    // -- formatting ---------------------------------------------------------------

    @Test
    fun `money and bytes format plainly`() {
        assertEquals("$5", formatMonthlyCents(500))
        assertEquals("$7.50", formatMonthlyCents(750))
        assertEquals("$12.34", formatCents(1234))
        assertEquals("0 B", formatBytes(0))
        assertEquals("412 KB", formatBytes(412 * 1024))
        assertEquals("1.2 GB", formatBytes((1.2 * 1024 * 1024 * 1024).toLong()))
    }

    @Test
    fun `nanp input normalizes to E164 or refuses`() {
        assertEquals("+14165550182", normalizeNanpInput("(416) 555-0182"))
        assertEquals("+14165550182", normalizeNanpInput("14165550182"))
        assertEquals("+14165550182", normalizeNanpInput("+1 416 555 0182"))
        assertEquals(null, normalizeNanpInput("555-0182"))
        assertEquals(null, normalizeNanpInput(""))
    }

    @Test
    fun `invite link matches the web origin`() {
        assertEquals("https://app.loonext.com/invite/abc", inviteLink("abc"))
    }
}
