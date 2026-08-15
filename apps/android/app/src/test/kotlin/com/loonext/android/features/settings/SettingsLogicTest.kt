package com.loonext.android.features.settings

import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
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

    // -- #193 caller ID default (mirror of apps/api telnyx/voice.ts) -----------

    @Test
    fun `company name sanitizes to the carrier alphabet like the server`() {
        assertEquals("Ace Plumbing Co", cnamFromCompanyName("Ace Plumbing & Co."))
        assertEquals("O Brien Heating", cnamFromCompanyName("  O'Brien   Heating  "))
        // The 15-char cut lands on a word gap; no trailing space survives.
        assertEquals("Best Home Reno", cnamFromCompanyName("Best Home Reno Pros"))
        assertEquals("", cnamFromCompanyName("--- !!! ---"))
    }

    @Test
    fun `a submitted CNAM change reads pending for three days, then settles`() {
        assertFalse(cnamChangePending(null, now))
        assertTrue(cnamChangePending("2026-07-15T11:00:00Z", now)) // an hour ago
        assertTrue(cnamChangePending("2026-07-13T00:00:00+00:00", now)) // offset form
        assertFalse(cnamChangePending("2026-07-01T00:00:00Z", now)) // long past
        assertFalse(cnamChangePending("not-a-timestamp", now))
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

    /*
     * #228 — the cap dialog, read in French.
     *
     * The English cases above are the RULE: which sentence each direction
     * gets, and that both pause points are named when the cap goes up. This
     * one checks the NUMBERS survive, because the number is the promise here
     * — a sentence that lost {next} would be asking somebody to approve a
     * spending change with the amount missing.
     */
    @Test
    fun `a French reader approves the same cap, with the same numbers`() {
        val raised = describeCapChange(2.0, 3.0, 500, MessageLocale.FR_CA)
        assertTrue(raised.title, raised.title.contains("3×"))
        // Asked through `groupDigits` rather than spelled out. It formats with
        // Locale.US, so today a French reader sees "1,500" where Quebec writes
        // "1 500" — a separate, cross-client question about the FORMATTER, not
        // this sentence. Deriving it here means fixing the separator does not
        // also break this test.
        assertTrue(raised.summary, raised.summary.contains(groupDigits(1500)))
        assertTrue(raised.summary, raised.summary.contains(groupDigits(1000)))
        assertTrue(raised.summary, !raised.summary.contains("{"))
        assertTrue(raised.title, !raised.title.contains("settings."))

        val ceiling = describeCapChange(2.0, 10.0, 2500, MessageLocale.FR_CA)
        // The ceiling case is the one that says money changes hands. The
        // overage rate has to still be in it.
        assertTrue(ceiling.summary, ceiling.summary.contains("dépassement"))
        assertTrue(ceiling.summary, !ceiling.summary.contains("{included}"))

        val lowered = describeCapChange(5.0, 2.0, 500, MessageLocale.FR_CA)
        // And lowering has to keep its warning: this one can stop sending the
        // moment it is saved.
        assertTrue(lowered.summary, lowered.summary.contains("tout de suite"))
        assertTrue(lowered.summary, !lowered.summary.contains("settings."))
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
        // #228: the em dash comes from the catalogue, which the web and iOS
        // have both read for a while. Android had written the same sentence
        // with a full stop — one of the two small drifts that turn up whenever
        // a sentence is typed out three times instead of resolved once.
        assertEquals(
            "Setup is taking longer than expected. Choose a number to finish — you " +
                "won't be charged again.",
            failedNumberCopy(stalled),
        )
    }

    /*
     * #228 — the same four states, read in French.
     *
     * The English cases above are the RULE: which sentence each failure
     * reason gets, and that the area code is named rather than described.
     * This asks whether the catalogue answers, because the resolver falls
     * back to the key it was given: an unported one reaches a screen as
     * `settings.numberSetupFailed` and nothing in the build goes red.
     */
    @Test
    fun `a French reader is told the same thing about a number that stalled`() {
        val dry = number(
            NumberStatus.PROVISION_FAILED,
            "no_inventory",
            attempts = 1,
            areaCode = "416",
        )
        val text = failedNumberCopy(dry, MessageLocale.FR_CA)
        assertTrue(text, text.contains("416"))
        assertTrue(text, text.contains("indicatif régional"))
        assertTrue(text, !text.contains("{code}"))
        assertTrue(text, !text.contains("settings."))

        // The promise this one carries is that choosing again is free. It has
        // to survive the translation or the sentence is worse than useless.
        val stalled = failedNumberCopy(
            number(NumberStatus.PROVISION_FAILED, "timeout", attempts = 5),
            MessageLocale.FR_CA,
        )
        assertTrue(stalled, stalled.contains("pas facturé"))

        // And the three-tier wait, which is the same honesty problem in time.
        // Anchored to the fixture's own timestamp rather than a literal
        // epoch: a hand-copied one is off by a year and the three tiers
        // collapse to one without saying so.
        val created = "2026-08-05T12:00:00Z"
        val start = java.time.Instant.parse(created).toEpochMilli()
        val waits = listOf(0L, 100_000L, 300_000L).map {
            provisioningWaitCopy(created, start + it, MessageLocale.FR_CA)
        }
        assertEquals(3, waits.toSet().size)
        for (wait in waits) {
            assertTrue(wait, wait.contains("numéro"))
            assertTrue(wait, !wait.contains("settings."))
        }
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

    // -- #521 the inviter's note ---------------------------------------------

    @Test
    fun `an untouched note field sends no note at all`() {
        // OPTIONAL means the owner who ignores it sends yesterday's invite.
        // `""` on the wire would claim they typed something, and every later
        // reader of the create call would have to know that it did not.
        assertEquals(null, inviteNoteOrNull(""))
        assertEquals(null, inviteNoteOrNull("   "))
        assertEquals(null, inviteNoteOrNull("\n"))
        // And the same answer for a note read back off an invite that never
        // had one, which is how the pending row asks the question.
        assertEquals(null, inviteNoteOrNull(null))
    }

    @Test
    fun `a note the owner did write survives with its own spacing`() {
        assertEquals(
            "You'll be running the Bathurst jobs.",
            inviteNoteOrNull("  You'll be running the Bathurst jobs.  "),
        )
        // Only the ends are touched: a two-sentence note is one note, and
        // reflowing what somebody wrote is not this function's business.
        assertEquals("Ask Dave.  Then quote.", inviteNoteOrNull("Ask Dave.  Then quote."))
    }

    @Test
    fun `the note ceiling is the column's, not a number we picked`() {
        // A client ceiling ABOVE the column's turns a typed sentence into a 422
        // after the tap; below it, the field refuses a note the server would
        // have taken. A constant checked against its own literal can see
        // neither, so the CHECK constraints are read instead: `invites.note`
        // for the invite that goes out, `company_members.joining_note` for the
        // words the member is greeted with. Same technique as
        // [com.loonext.android.core.model.ParityVectorsTest]: read the source
        // of truth out of the repo rather than copy it here, where the copy is
        // the thing that goes stale.
        val ceilings = noteCheckConstraints()
        assertEquals(
            "both note columns must be found in supabase/migrations",
            setOf("note", "joining_note"),
            ceilings.map { it.first }.toSet(),
        )
        for ((column, ceiling) in ceilings) {
            assertEquals("$column CHECK", ceiling, INVITE_NOTE_MAX)
        }
    }

    /**
     * Every character ceiling the migrations declare for a note an inviter
     * writes, as column to characters.
     *
     * Anchored on `is null or` because other tables carry an unrelated `note`
     * with a ceiling of its own, and matching one of those would pin this field
     * to a number that has nothing to do with it.
     */
    private fun noteCheckConstraints(): List<Pair<String, Int>> {
        val check = Regex(
            """(note|joining_note)\s+is\s+null\s+or\s+char_length\(\1\)\s*<=\s*(\d+)""",
        )
        return repoDir("supabase/migrations").walkTopDown()
            .filter { it.isFile && it.extension == "sql" }
            .flatMap { file -> check.findAll(file.readText()) }
            .map { it.groupValues[1] to it.groupValues[2].toInt() }
            .toList()
    }

    /**
     * A directory in the repository, found by walking up from wherever the test
     * runner started. Gradle's working directory differs between an IDE run and
     * a command line one, and a hardcoded relative path only works in whichever
     * of the two its author used.
     */
    private fun repoDir(relative: String): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.isDirectory) return candidate
            dir = dir.parentFile
        }
        fail("$relative not found walking up from ${File("").absolutePath}")
        error("unreachable")
    }

    // -- #414 / #453 emergency keyword ---------------------------------------

    @Test
    fun `owner copy inviting the emergency reply is recognised`() {
        // Regression guard: written as "\b$keyword\b" in source this regex
        // held literal BACKSPACE characters, matched nothing ever, and the
        // settings warning was invisible on Android while passing review.
        assertTrue(
            mentionsEmergencyKeyword(
                "For a no-heat emergency, reply URGENT and we'll call you.",
            ),
        )
        assertTrue(mentionsEmergencyKeyword("text 911 if it can't wait"))
        assertFalse(mentionsEmergencyKeyword("we respond urgently to every text"))
        assertFalse(mentionsEmergencyKeyword("We're closed and will reply Monday."))
    }

    @Test
    fun `a reply keyword we do not watch for is named`() {
        assertEquals("ASAP", unrecognizedReplyKeyword("For a burst pipe, reply ASAP and we'll ring you back."))
        assertEquals(null, unrecognizedReplyKeyword("reply URGENT and we'll call you"))
        assertEquals(null, unrecognizedReplyKeyword("Reply STOP to unsubscribe"))
        assertEquals(null, unrecognizedReplyKeyword("We're closed and will reply Monday morning."))
        assertEquals(null, unrecognizedReplyKeyword("We reply to every message within 24 hours."))
    }

    @Test
    fun `the away notice matches the shared decision table`() {
        val shipped =
            "Thanks for texting us. We're out of the office right now and will reply first thing. " +
                "For a no-heat or burst-pipe emergency, reply URGENT and we'll call you."

        assertEquals(null, awayEmergencyNotice(emergencyEnabled = true, awayMessage = shipped))

        assertEquals(
            AwayNoticeTone.Warn,
            awayEmergencyNotice(emergencyEnabled = false, awayMessage = shipped)?.tone,
        )

        val unknown = awayEmergencyNotice(
            emergencyEnabled = true,
            awayMessage = "For a burst pipe, reply ASAP and we'll ring you back.",
        )
        assertEquals(AwayNoticeTone.Warn, unknown?.tone)
        assertTrue(unknown!!.text.contains("ASAP"))

        assertEquals(
            AwayNoticeTone.Hint,
            awayEmergencyNotice(
                emergencyEnabled = true,
                awayMessage = "Thanks for texting. We're closed and will reply Monday.",
            )?.tone,
        )

        assertEquals(
            null,
            awayEmergencyNotice(
                emergencyEnabled = false,
                awayMessage = "Thanks for texting. We're closed and will reply Monday.",
            ),
        )
    }

    // -- #392: THE SHARED SEAT FIXTURE ------------------------------------
    // Hand-ported case for case from packages/shared/src/seats.test.ts.
    // Adding a case there means adding it here. The seat ceiling is the
    // Starter-to-Pro upgrade trigger and has already moved twice; a drifted
    // copy does not degrade a feature, it misprices the product on Android.

    private data class SeatCase(
        val members: Int,
        val invites: Int,
        val plan: String?,
        val served: Int?,
        val used: Int,
        val limit: Int,
        val full: Boolean,
        val canUpgrade: Boolean,
        val line: String,
    )

    @Test
    fun `seat cases match the shared fixture`() {
        val cases = listOf(
        SeatCase(1, 0, "starter", null, 1, 3, false, false, "1 of 3 seats"),
        SeatCase(2, 0, "pro", null, 2, 15, false, false, "2 of 15 seats"),
        SeatCase(2, 1, "starter", null, 3, 3, true, true, "3 of 3 seats. Upgrade for more"),
        SeatCase(3, 0, "starter", null, 3, 3, true, true, "3 of 3 seats. Upgrade for more"),
        SeatCase(15, 0, "pro", null, 15, 15, true, false, "15 of 15 seats"),
        SeatCase(3, 0, null, null, 3, 3, true, true, "3 of 3 seats. Upgrade for more"),
        SeatCase(5, 0, "starter", null, 5, 3, true, true, "5 of 3 seats. Upgrade for more"),
        SeatCase(16, 0, "pro", 20, 16, 20, false, false, "16 of 20 seats"),
        SeatCase(1, 0, "starter", 0, 1, 3, false, false, "1 of 3 seats"),
        )
        for (c in cases) {
            val usage = seatUsage(c.members, c.invites, c.plan, c.served)
            val label = "${c.members}+${c.invites} on ${c.plan} served ${c.served}"
            assertEquals(label, c.used, usage.used)
            assertEquals(label, c.limit, usage.limit)
            assertEquals(label, c.full, usage.full)
            assertEquals(label, c.canUpgrade, usage.canUpgrade)
            assertEquals(label, c.line, usage.line)
        }
    }
}
