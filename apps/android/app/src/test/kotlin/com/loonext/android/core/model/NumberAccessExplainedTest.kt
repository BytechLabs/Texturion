package com.loonext.android.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #348 — the Kotlin half of `packages/shared/src/number-access-explained.ts`.
 *
 * The pair that matters most is `unruled` vs `no-match`. Both leave the member
 * un-named by any rule and read alike at a glance; one means nobody restricted
 * the number and the other means somebody did and left this person out.
 * Confusing them is how an owner concludes the rules are broken.
 */
class NumberAccessExplainedTest {
    @Test
    fun `says what they can do as a capability`() {
        assertEquals("Can text", numberAccessLevelLabel("text"))
        assertEquals("Read and notes only", numberAccessLevelLabel("note"))
        assertEquals("Hidden", numberAccessLevelLabel("none"))
    }

    @Test
    fun `names the rule an owner would go and edit`() {
        assertEquals("A rule naming them", numberAccessReason("user", null))
        assertEquals("A rule for members", numberAccessReason("role", "member"))
        assertEquals("A rule for everyone", numberAccessReason("all", null))
    }

    @Test
    fun `tells the two default-looking cases apart`() {
        assertNotEquals(
            numberAccessReason("unruled", null),
            numberAccessReason("no-match", null),
        )
        assertEquals("Nobody has restricted this number", numberAccessReason("unruled", null))
        assertEquals(
            "This number has rules, and none of them include them",
            numberAccessReason("no-match", null),
        )
    }

    @Test
    fun `explains blanket access rather than leaving it mysterious`() {
        assertEquals("Owners reach every number", numberAccessReason("role-override", "owner"))
        assertEquals("Admins reach every number", numberAccessReason("role-override", "admin"))
    }

    @Test
    fun `survives a role rule with no principal`() {
        assertEquals("A rule for their role", numberAccessReason("role", null))
    }

    @Test
    fun `puts what they cannot do first`() {
        val rows = listOf(
            NumberAccessExplanation("3", "+15550003", "text", "unruled"),
            NumberAccessExplanation("1", "+15550001", "none", "no-match"),
            NumberAccessExplanation("2", "+15550002", "note", "role", "member"),
        ).sortedForOwner()
        assertEquals(listOf("+15550001", "+15550002", "+15550003"), rows.map { it.number_e164 })
    }

    @Test
    fun `knows which levels are a restriction`() {
        assertFalse(numberAccessIsRestricted("text"))
        assertTrue(numberAccessIsRestricted("note"))
        assertTrue(numberAccessIsRestricted("none"))
    }
}
