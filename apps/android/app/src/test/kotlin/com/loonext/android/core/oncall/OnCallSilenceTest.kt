package com.loonext.android.core.oncall

import java.io.File
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #538 (audit) — going quiet while you are the one on call.
 *
 * The same set the shared TypeScript asserts, plus a read of it, because this is a
 * hand-port and nothing about Kotlin says the original moved. The wording matters as
 * much as the logic: this sentence is the only thing standing between somebody's
 * quiet evening and a customer who texted and got nothing back.
 */
class OnCallSilenceTest {

    private val me = "u-me"
    private val somebody = "u-else"

    private fun at(iso: String): Long = Instant.parse(iso).toEpochMilli()

    /** Inside the shifts below. */
    private val now = at("2026-08-11T18:00:00Z")

    private fun shift(user: String, from: String, until: String) =
        OnCallSilence.Shift(user, from, until)

    @Test
    fun `is true inside my own shift`() {
        assertTrue(
            OnCallSilence.isOnCallNow(
                listOf(shift(me, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")),
                me,
                now,
            ),
        )
    }

    @Test
    fun `is false for somebody else's shift`() {
        // The warning is about the person holding the phone, not about the workspace
        // having a rota at all.
        assertFalse(
            OnCallSilence.isOnCallNow(
                listOf(shift(somebody, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")),
                me,
                now,
            ),
        )
    }

    @Test
    fun `is false before it starts and after it ends`() {
        assertFalse(
            OnCallSilence.isOnCallNow(
                listOf(shift(me, "2026-08-11T19:00:00Z", "2026-08-12T00:00:00Z")),
                me,
                now,
            ),
        )
        assertFalse(
            OnCallSilence.isOnCallNow(
                listOf(shift(me, "2026-08-11T06:00:00Z", "2026-08-11T12:00:00Z")),
                me,
                now,
            ),
        )
    }

    @Test
    fun `treats the end as exclusive, so back-to-back shifts do not overlap`() {
        // Two people handing over at six o'clock must not both count as on call for
        // that instant, or the handover minute warns the wrong person.
        val handover = at("2026-08-11T18:00:00Z")
        assertFalse(
            OnCallSilence.isOnCallNow(
                listOf(shift(me, "2026-08-11T12:00:00Z", "2026-08-11T18:00:00Z")),
                me,
                handover,
            ),
        )
        assertTrue(
            OnCallSilence.isOnCallNow(
                listOf(shift(me, "2026-08-11T18:00:00Z", "2026-08-12T00:00:00Z")),
                me,
                handover,
            ),
        )
    }

    @Test
    fun `ignores a shift with an unreadable stamp rather than assuming it covers now`() {
        // A warning that fires wrongly is one people learn to dismiss, which costs
        // more than the one it was meant to prevent.
        assertFalse(
            OnCallSilence.isOnCallNow(listOf(shift(me, "not a date", "also not")), me, now),
        )
    }

    @Test
    fun `is false with no shifts at all`() {
        assertFalse(OnCallSilence.isOnCallNow(emptyList(), me, now))
    }

    @Test
    fun `warns when somebody on call switches a channel off`() {
        val warning = OnCallSilence.warning(true, turningOff = true, channel = "push")!!
        assertTrue(warning, warning.contains("on call right now"))
        // Says what is actually lost — the pages reach nothing — and that nobody
        // else finds out, which is the part that makes it a customer problem.
        assertTrue(warning, warning.contains("go nowhere"))
        assertTrue(warning, warning.contains("no one else is told"))
        // And offers the way out rather than only the objection.
        assertTrue(warning, warning.contains("Hand the shift over"))
    }

    @Test
    fun `names the channel being switched off`() {
        assertTrue(OnCallSilence.warning(true, true, "push")!!.contains("Push alerts"))
        assertTrue(OnCallSilence.warning(true, true, "email")!!.contains("Emails"))
    }

    @Test
    fun `says nothing when I am not on call, or switching something ON`() {
        // Turning notifications back on is the good outcome. A dialog there would be
        // punishing the fix.
        assertEquals(null, OnCallSilence.warning(false, true, "push"))
        assertEquals(null, OnCallSilence.warning(true, false, "push"))
    }

    // ---------------------------------------------------- against the original

    /** The shared source, with carriage returns stripped — this tree is CRLF. */
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
     * The whole sentence matches the shared module, reconstructed.
     *
     * The first version of this checked for phrases and failed on a line break: the
     * TypeScript splits the sentence across concatenated template literals at
     * different points than the Kotlin does, so comparing fragments compares the
     * formatting rather than the words.
     *
     * So both sides are reduced to their letters — concatenation syntax stripped, the
     * channel name blanked, whitespace collapsed — and compared whole. A reworded
     * warning on any client fails; a rewrapped one does not.
     */
    /**
     * #228 — the sentence lives in the web catalogue now, as ONE string.
     *
     * That simplifies what this had to do. The shared module wrote it as a
     * line-broken template literal, so the old version stripped backticks,
     * plus signs and the interpolation before comparing — normalising away
     * TypeScript's formatting to reach the words. A catalogue entry is a
     * single JSON string, so only the {what} slot has to be blanked on both
     * sides.
     *
     * Sliced to the English half: the French holds the same key.
     */
    @Test
    fun `the warning matches the catalogue`() {
        val catalogue = repoFile("apps/web/src/i18n/sections/domain.ts")
            .substringAfter("export const domainEn")
            .substringBefore("export const domainFr")

        fun bare(text: String): String = text
            .replace("{what}", "")
            .replace("Push alerts", "")
            .replace("Emails", "")
            .replace(Regex("\\s+"), " ")
            .trim()

        val rendered = bare(OnCallSilence.warning(true, true, "push")!!)
        assertTrue(
            "the warning has drifted from the catalogue: $rendered",
            catalogue.split("\n").any { bare(it).contains(rendered) },
        )
    }

    /** And the two button labels, which are the decision a thumb reads. */
    @Test
    fun `the button labels match the shared module`() {
        // #228: the labels moved to the catalogue with the warning above.
        val shared = repoFile("apps/web/src/i18n/sections/domain.ts")
            .substringAfter("export const domainEn")
            .substringBefore("export const domainFr")
        assertTrue(
            "the confirm label has drifted: ${OnCallSilence.CONFIRM}",
            shared.contains("\"${OnCallSilence.CONFIRM}\""),
        )
        assertTrue(
            "the cancel label has drifted: ${OnCallSilence.CANCEL}",
            shared.contains("\"${OnCallSilence.CANCEL}\""),
        )
    }
}
