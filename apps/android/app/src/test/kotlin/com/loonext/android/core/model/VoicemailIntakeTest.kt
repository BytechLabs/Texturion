package com.loonext.android.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #367 — the Kotlin half of `packages/shared/src/voicemail-intake.ts`.
 *
 * Hand-ported logic gets hand-ported bugs, so these are the same cases the
 * TypeScript suite pins. The one with consequences is that an absent field
 * disappears rather than drawing an empty labelled row: a blank "Address" reads
 * as "we looked and the caller gave none", which is a claim we cannot make.
 */
class VoicemailIntakeTest {
    private val empty = VoicemailIntake()

    @Test
    fun `draws nothing for nothing`() {
        assertTrue((null as VoicemailIntake?).lines().isEmpty())
        assertTrue(empty.lines().isEmpty())
    }

    @Test
    fun `keeps the field order regardless of the object's`() {
        val lines = VoicemailIntake(
            problem = "water heater leaking",
            address = "12 Mill Road",
            callback = "555-0142",
            name = "Dave",
        ).lines()
        assertEquals(listOf("problem", "address", "callback", "name"), lines.map { it.key })
        assertEquals(listOf("Problem", "Address", "Call back", "Name"), lines.map { it.label })
    }

    @Test
    fun `drops the fields the caller did not give`() {
        val lines = VoicemailIntake(problem = "no hot water").lines()
        assertEquals(1, lines.size)
        assertEquals("Problem", lines[0].label)
        assertEquals("no hot water", lines[0].value)
    }

    @Test
    fun `treats a whitespace-only value as absent`() {
        assertTrue(VoicemailIntake(address = "   ").lines().isEmpty())
    }

    @Test
    fun `trims what it draws`() {
        assertEquals("Dave", VoicemailIntake(name = "  Dave  ").lines()[0].value)
    }

    @Test
    fun `names the signal rather than the machine`() {
        // PORTAL-UX §3.1, and identical wording on all three clients.
        assertEquals("From the voicemail", VOICEMAIL_INTAKE_SOURCE_LABEL)
    }
}
