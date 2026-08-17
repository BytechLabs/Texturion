package com.loonext.android.core.model

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #315/#287 — the role table is hand-ported, and a hand-port is a copy that
 * drifts.
 *
 * `conversations.note` is the axis this file was written for. It was absent
 * from this port for as long as no Android screen asked about it, which was
 * harmless right up until one did: [MemberRole.has] fails CLOSED, so a missing
 * constant does not throw or warn — it quietly answers "no" for every role, and
 * the control it gates simply never appears. Nobody would have seen a crash;
 * they would have seen a button that owners do not get.
 *
 * The rows below are the ones in packages/shared/src/capabilities.ts. What
 * makes them worth asserting is the NEGATIVE half: a port that added the
 * constant to every role would pass a "does an owner have it" test and hand a
 * read-only observer the ability to write.
 */
class CapabilityPortTest {
    @Test
    fun `the three roles that can write on a thread hold the note axis`() {
        for (role in listOf(MemberRole.MEMBER, MemberRole.ADMIN, MemberRole.OWNER)) {
            assertTrue(
                "$role should hold conversations.note",
                MemberRole.has(role, Capability.CONVERSATIONS_NOTE),
            )
        }
    }

    @Test
    fun `read-only and the bookkeeper do not`() {
        // A read-only member reads every thread and writes on none — the note
        // axis is exactly the line between those two. The bookkeeper never had
        // conversation access at all.
        for (role in listOf(MemberRole.READ_ONLY, MemberRole.BOOKKEEPER)) {
            assertFalse(
                "$role should not hold conversations.note",
                MemberRole.has(role, Capability.CONVERSATIONS_NOTE),
            )
        }
    }

    @Test
    fun `an unknown role holds nothing`() {
        // Fail-closed, so a build that has not heard of a newer preset refuses
        // rather than guesses.
        assertFalse(MemberRole.has("auditor", Capability.CONVERSATIONS_NOTE))
        assertFalse(MemberRole.has(null, Capability.CONVERSATIONS_NOTE))
    }

    @Test
    fun `every constant on the object is in the owner's set`() {
        // ALL is documented as "the owner's set, and the list a test can
        // iterate". A constant added to the object and forgotten in ALL is the
        // same silent no as the one above.
        val declared = setOf(
            Capability.WORKSPACE_ACCESS,
            Capability.CONVERSATIONS_READ,
            Capability.CONVERSATIONS_SEND,
            Capability.CONVERSATIONS_NOTE,
            Capability.BILLING_MANAGE,
            Capability.SETTINGS_MANAGE,
            Capability.TEAM_MANAGE,
            Capability.NUMBERS_MANAGE,
            Capability.HISTORY_READ,
        )
        assertTrue(
            "Capability.ALL is missing ${declared - Capability.ALL}",
            Capability.ALL.containsAll(declared),
        )
        assertTrue(
            "Capability.ALL carries ${Capability.ALL - declared}, which this test has not heard of",
            declared.containsAll(Capability.ALL),
        )
    }
}
