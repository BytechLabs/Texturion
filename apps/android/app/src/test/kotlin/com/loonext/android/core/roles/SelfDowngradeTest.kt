package com.loonext.android.core.roles

import com.loonext.android.core.model.MemberRole
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #538 — the warning before somebody takes powers off themselves.
 *
 * Two halves. The behaviour tests assert the sentence; the parity test reads
 * `packages/shared/src/capabilities.ts` and fails if any role's capability set has
 * drifted from the source. That second half is the important one — this file
 * carries its own copy of the table, and a copy nobody checks is a copy that
 * eventually tells somebody they are keeping access they have just lost.
 */
class SelfDowngradeTest {

    @Test
    fun `names what an admin gives up by becoming a member`() {
        val lost = SelfDowngrade.capabilitiesLost(MemberRole.ADMIN, MemberRole.MEMBER)
        assertTrue(lost.contains("team.manage"))
        assertTrue(lost.contains("billing.manage"))
        assertFalse(lost.contains("conversations.read"))
    }

    @Test
    fun `takes nothing away on a promotion or a sideways move`() {
        assertFalse(SelfDowngrade.isDowngrade(MemberRole.MEMBER, MemberRole.ADMIN))
        assertEquals(null, SelfDowngrade.warning(MemberRole.MEMBER, MemberRole.ADMIN))
        assertEquals(null, SelfDowngrade.warning(MemberRole.ADMIN, MemberRole.ADMIN))
    }

    @Test
    fun `singles out losing the ability to change it back`() {
        // THE POINT OF THE ISSUE. "You will have less access" is accepted easily and
        // correctly; "you cannot put this back yourself" is the part somebody would
        // want to know before tapping.
        assertTrue(SelfDowngrade.losesRoleControl(MemberRole.ADMIN, MemberRole.MEMBER))
        val warning = SelfDowngrade.warning(MemberRole.ADMIN, MemberRole.MEMBER)!!
        assertTrue(warning, warning.contains("change it back"))
        assertTrue(warning, warning.contains("only an owner can"))
    }

    @Test
    fun `says what things ARE, not what they are called in the code`() {
        val warning = SelfDowngrade.warning(MemberRole.ADMIN, MemberRole.MEMBER)!!
        assertFalse(warning, warning.contains("team.manage"))
        assertFalse(warning, warning.contains("_"))
    }

    @Test
    fun `names three things at most and counts the rest`() {
        val warning = SelfDowngrade.warning(MemberRole.ADMIN, MemberRole.MEMBER)!!
        assertTrue(warning, Regex("and \\d+ more").containsMatchIn(warning))
    }

    @Test
    fun `handles the roles that are not on a line`() {
        // #315: read_only and bookkeeper are capability SETS, not rungs, so this
        // cannot be a rank comparison — a bookkeeper has billing a member does not.
        assertTrue(SelfDowngrade.isDowngrade(MemberRole.MEMBER, MemberRole.READ_ONLY))
        assertTrue(SelfDowngrade.isDowngrade(MemberRole.MEMBER, MemberRole.BOOKKEEPER))
        assertFalse(
            SelfDowngrade.losesRoleControl(MemberRole.MEMBER, MemberRole.READ_ONLY),
        )
        assertTrue(
            SelfDowngrade.losesRoleControl(MemberRole.ADMIN, MemberRole.BOOKKEEPER),
        )
    }

    @Test
    fun `an owner loses something by becoming anything else`() {
        for (to in listOf(MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.READ_ONLY)) {
            assertTrue(to, SelfDowngrade.isDowngrade(MemberRole.OWNER, to))
        }
    }

    // ---------------------------------------------------- against the original

    /**
     * The shared source, with carriage returns stripped.
     *
     * This tree is checked out with Windows line endings, and a multi-line regex
     * written against Unix ones matches nothing — which fails as "the declaration
     * has changed shape" rather than as "your needle has the wrong newline". Both
     * of the parity tests below failed that way first.
     */
    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) {
                return candidate.readText().filterNot { it == '\r' }
            }
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }

    /**
     * Every role's capability set matches the shared module, exactly.
     *
     * THE ONE THAT EARNS ITS KEEP. This file repeats the table because Android has
     * no capability model of its own, and a repeated table nobody checks is one that
     * eventually tells somebody they are keeping access they have just lost.
     *
     * Parsed out of the source rather than compared to another hand-written copy —
     * comparing two copies of mine is the mistake that let two dashboard labels
     * drift between laptop and phone on #540.
     */
    @Test
    fun `every role's capabilities match the shared module`() {
        val shared = repoFile("packages/shared/src/capabilities.ts")
        val block = Regex(
            """ROLE_CAPABILITIES[^=]*=\s*\{(.*?)\n\};""",
            RegexOption.DOT_MATCHES_ALL,
        ).find(shared)?.groupValues?.get(1)
            ?: throw AssertionError("ROLE_CAPABILITIES is no longer an object literal")

        for ((role, expected) in SelfDowngrade.CAPABILITIES) {
            val entry = Regex("""\n  $role: \[(.*?)\]""", RegexOption.DOT_MATCHES_ALL)
                .find(block)?.groupValues?.get(1)
                ?: throw AssertionError("no $role entry in ROLE_CAPABILITIES")
            val ids = Regex("\"([a-z.]+)\"").findAll(entry)
                .map { it.groupValues[1] }
                .toList()
            assertEquals("$role has drifted from the shared module", ids, expected)
        }
    }

    /**
     * And the owner-only capabilities are still exactly those two.
     *
     * The owner's set is derived rather than listed, so a new capability the owner
     * alone holds would silently fall out of `capabilitiesOf(owner)` — and an owner
     * never gets a refusal that would reveal the gap.
     */
    @Test
    fun `the owner-only capabilities match the shared module`() {
        val shared = repoFile("packages/shared/src/capabilities.ts")
        val all = Regex("""export const CAPABILITIES[^=]*=\s*\[(.*?)\]""", RegexOption.DOT_MATCHES_ALL)
            .find(shared)?.groupValues?.get(1)
            ?: throw AssertionError("CAPABILITIES is no longer an array literal")
        val ids = Regex("\"([a-z.]+)\"").findAll(all).map { it.groupValues[1] }.toList()
        val nonOwner = SelfDowngrade.CAPABILITIES.values.flatten().distinct()
        assertEquals(
            "the owner-only capabilities have drifted from the shared module",
            ids.filterNot { it in nonOwner }.sorted(),
            SelfDowngrade.OWNER_ONLY.sorted(),
        )
    }
}
