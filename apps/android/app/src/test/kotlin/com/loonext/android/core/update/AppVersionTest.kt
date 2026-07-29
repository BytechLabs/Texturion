package com.loonext.android.core.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #339 — the same table of cases `packages/shared/src/app-version.test.ts`
 * asserts, against the Kotlin hand-port.
 *
 * The reason this file exists rather than trusting the port: shared logic that
 * is hand-copied drifts silently, and a drift HERE means an Android build that
 * exempts itself from a floor, or one that blocks itself against a floor
 * nobody set. Neither would show up as a crash.
 */
class AppVersionTest {
    @Test
    fun `pads to four segments so 2 and 2_0_0_0 are one build`() {
        assertEquals(listOf(2, 0, 0, 0), versionKey("2")!!.toList())
        assertEquals(listOf(2, 0, 0, 0), versionKey("2.0.0.0")!!.toList())
    }

    @Test
    fun `refuses anything that is not a version`() {
        // Never a number, never a zero: a garbage version that compared as
        // newer would exempt that build from every floor.
        for (bad in listOf("1.4.0-beta", "v1", "", "latest", "1..2", "1.2.3.4.5", "99999")) {
            assertNull(bad, versionKey(bad))
        }
        assertNull(versionKey(null))
    }

    @Test
    fun `orders by segment, not by string`() {
        // "1.10.0" < "1.9.0" as strings, which would tell somebody on the
        // newest build that they are behind.
        assertTrue(isOlderThan("1.9.0", "1.10.0"))
        assertFalse(isOlderThan("1.10.0", "1.9.0"))
    }

    @Test
    fun `equal versions are not older, however they are written`() {
        assertFalse(isOlderThan("2.0.0", "2"))
        assertFalse(isOlderThan("2", "2.0.0"))
    }

    @Test
    fun `an unreadable version on either side is never older`() {
        assertFalse(isOlderThan("garbage", "1.0.0"))
        assertFalse(isOlderThan("1.0.0", "garbage"))
        assertFalse(isOlderThan(null, "1.0.0"))
        assertFalse(isOlderThan("1.0.0", null))
    }

    private fun policy(recommended: String? = null, minimum: String? = null) =
        AppReleasePolicy(recommended_version = recommended, minimum_version = minimum)

    @Test
    fun `says nothing when there is no policy`() {
        assertEquals(UpdateRequirement.NONE, updateRequirement("1.0.0", null))
        assertEquals(UpdateRequirement.NONE, updateRequirement("1.0.0", policy()))
    }

    @Test
    fun `prompts below the recommended version and stays quiet at or above it`() {
        assertEquals(UpdateRequirement.SOFT, updateRequirement("1.0.0", policy(recommended = "1.1.0")))
        assertEquals(UpdateRequirement.NONE, updateRequirement("1.1.0", policy(recommended = "1.1.0")))
        assertEquals(UpdateRequirement.NONE, updateRequirement("1.2.0", policy(recommended = "1.1.0")))
    }

    @Test
    fun `blocks below the floor, and the floor outranks the prompt`() {
        assertEquals(
            UpdateRequirement.BLOCK,
            updateRequirement("1.0.0", policy(recommended = "1.2.0", minimum = "1.1.0")),
        )
        assertEquals(
            UpdateRequirement.SOFT,
            updateRequirement("1.1.0", policy(recommended = "1.2.0", minimum = "1.1.0")),
        )
    }

    @Test
    fun `never blocks a build that does not know its own version`() {
        // A misconfigured build is our mistake; blocking it makes it theirs.
        assertEquals(UpdateRequirement.NONE, updateRequirement(null, policy(minimum = "9.0.0")))
        assertEquals(UpdateRequirement.NONE, updateRequirement("", policy(minimum = "9.0.0")))
        assertEquals(UpdateRequirement.NONE, updateRequirement("nightly", policy(minimum = "9.0.0")))
    }

    @Test
    fun `never blocks against an unreadable floor`() {
        assertEquals(
            UpdateRequirement.NONE,
            updateRequirement("1.0.0", policy(minimum = "not-a-version")),
        )
    }
}
