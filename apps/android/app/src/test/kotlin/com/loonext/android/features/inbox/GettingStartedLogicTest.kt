package com.loonext.android.features.inbox

import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberFirsts
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.PhoneNumberSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #476 — the first-run checklist, hand-ported from web.
 *
 * Every case asserts a POSITIVE as well as a refusal, deliberately. A port
 * that never marks anything done passes a suite made only of refusals, and
 * that is the shape an inverted condition actually takes.
 *
 * The mirror of this file is `apps/ios/LoonextTests/GettingStartedLogicTests.swift`.
 * Adding a case here means adding it there.
 */
class GettingStartedLogicTest {

    private fun number(status: String) = PhoneNumberSummary(
        id = "num-1",
        status = status,
        country = "CA",
        number_e164 = "+14155560100",
        created_at = "2026-08-01T00:00:00Z",
    )

    private fun member(deactivated: String?) = Member(
        id = "m-${deactivated ?: "active"}",
        user_id = "u-${deactivated ?: "active"}",
        role = MemberRole.MEMBER,
        deactivated_at = deactivated,
        created_at = "2026-08-01T00:00:00Z",
    )

    // --- the paid gate ----------------------------------------------------

    @Test
    fun `treats past_due and unpaid as paid, like web does`() {
        // The narrow reading (only "active") would hide the card from a
        // workspace in exactly the state where somebody is most likely to be
        // confused about their account.
        assertTrue(hasPaidStatus("active"))
        assertTrue(hasPaidStatus("past_due"))
        assertTrue(hasPaidStatus("unpaid"))
    }

    @Test
    fun `does not treat an unstarted or cancelled workspace as paid`() {
        assertFalse(hasPaidStatus("incomplete"))
        assertFalse(hasPaidStatus("incomplete_expired"))
        assertFalse(hasPaidStatus("canceled"))
        assertFalse(hasPaidStatus(null))
    }

    // --- who sees which card ---------------------------------------------

    @Test
    fun `owner and admin get the setup list`() {
        assertEquals(StartedAudience.SETUP, startedAudience(MemberRole.OWNER))
        assertEquals(StartedAudience.SETUP, startedAudience(MemberRole.ADMIN))
    }

    @Test
    fun `a member gets the doing-the-job list`() {
        assertEquals(StartedAudience.DOING_THE_JOB, startedAudience(MemberRole.MEMBER))
    }

    @Test
    fun `a read-only observer gets no card at all`() {
        // Web hands read_only the member list, whose three items are all
        // things that role provably cannot do: it holds workspace.access and
        // conversations.read and nothing else. A checklist of instructions
        // somebody cannot follow is worse than no checklist.
        assertFalse(MemberRole.has("read_only", Capability.CONVERSATIONS_SEND))
        assertEquals(StartedAudience.NONE, startedAudience("read_only"))
        // Fail closed on anything the client does not recognise.
        assertEquals(StartedAudience.NONE, startedAudience(null))
        assertEquals(StartedAudience.NONE, startedAudience("something_new"))
    }

    // --- the owner list ---------------------------------------------------

    @Test
    fun `credits the setup already done, so the bar never starts at zero`() {
        val steps = ownerSteps(emptyList(), false, 0, 1)
        assertEquals("signup", steps.first().key)
        assertTrue(steps.first().done)
        assertNull(steps.first().hint)
    }

    @Test
    fun `marks the number done only when one is actually active`() {
        val provisioning = ownerSteps(listOf(number("provisioning")), false, 0, 1)
        val numberStep = provisioning.first { it.key == "number" }
        assertFalse(numberStep.done)
        assertEquals("It's on its way, usually under a minute.", numberStep.hint)

        val live = ownerSteps(listOf(number("active")), false, 0, 1)
        assertTrue(live.first { it.key == "number" }.done)
        assertNull(live.first { it.key == "number" }.hint)
    }

    @Test
    fun `stops promising a minute once the purchase has actually stalled`() {
        val stalled = ownerSteps(listOf(number("provision_failed")), false, 0, 1)
        assertEquals(
            "Taking a little longer than usual. You don't need to do anything.",
            stalled.first { it.key == "number" }.hint,
        )
    }

    @Test
    fun `derives inbound, reply and teammate from real counts`() {
        val nothing = ownerSteps(emptyList(), false, 0, 1)
        assertFalse(nothing.first { it.key == "inbound" }.done)
        assertFalse(nothing.first { it.key == "reply" }.done)
        assertFalse(nothing.first { it.key == "teammate" }.done)

        val everything = ownerSteps(listOf(number("active")), true, 3, 2)
        assertTrue(everything.first { it.key == "inbound" }.done)
        assertTrue(everything.first { it.key == "reply" }.done)
        assertTrue(everything.first { it.key == "teammate" }.done)
        assertTrue(stepsComplete(everything))
    }

    @Test
    fun `one member is not a teammate`() {
        // The owner alone is one active member; the step is about a SECOND.
        assertEquals(1, countActiveMembers(listOf(member(null))))
        assertEquals(1, countActiveMembers(listOf(member(null), member("2026-01-01T00:00:00Z"))))
        assertEquals(2, countActiveMembers(listOf(member(null), member(null))))
        assertFalse(ownerSteps(emptyList(), true, 1, 1).first { it.key == "teammate" }.done)
        assertTrue(ownerSteps(emptyList(), true, 1, 2).first { it.key == "teammate" }.done)
    }

    // --- the member list --------------------------------------------------

    @Test
    fun `the member list empties itself as they do the things`() {
        val fresh = memberSteps(MemberFirsts())
        assertEquals(listOf("reply", "note", "done"), fresh.map { it.key })
        assertTrue(fresh.none { it.done })
        assertFalse(stepsComplete(fresh))
        // Every undone row explains itself; a bare label teaches nothing.
        assertTrue(fresh.all { it.hint != null })

        val allDone = memberSteps(MemberFirsts(replied = true, noted = true, marked_done = true))
        assertTrue(stepsComplete(allDone))
        assertTrue(allDone.all { it.hint == null })
    }

    @Test
    fun `the note row warns that a note is not a text`() {
        // The one worth learning deliberately rather than by accident: getting
        // it wrong means a customer received something meant for a colleague.
        val note = memberSteps(MemberFirsts()).first { it.key == "note" }
        assertTrue(note.hint!!.contains("the customer never sees them"))
    }

    @Test
    fun `a partly finished list is not complete`() {
        assertFalse(stepsComplete(memberSteps(MemberFirsts(replied = true))))
        assertFalse(stepsComplete(memberSteps(MemberFirsts(replied = true, noted = true))))
    }
}
