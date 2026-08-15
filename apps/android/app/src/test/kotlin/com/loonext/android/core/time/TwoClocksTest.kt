package com.loonext.android.core.time

import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #539 — a time has to say whose clock it is on.
 *
 * Two halves: the rules, and a read of the shared TypeScript, because this is a
 * hand-port and nothing about Kotlin says the original moved. Both zones are
 * always stated — a helper whose answer depends on the machine it runs on is one
 * that passes on a laptop and fails in CI.
 */
class TwoClocksTest {

    private val fmt = DateTimeFormatter.ofPattern("EEE, h:mm a", Locale.US)

    /** What the product passes in: an instant rendered in a zone. */
    private fun wall(iso: String, zone: String): String =
        Instant.parse(iso).atZone(ZoneId.of(zone)).format(fmt)

    private val toronto = "America/Toronto"
    private val vancouver = "America/Vancouver"

    /** 8am in Vancouver, 11am in Toronto. */
    private val at = "2026-08-11T15:00:00Z"

    @Test
    fun `names both clocks when the reader is not where the customer is`() {
        // THE BUG. The queued row said "8:00 AM" — the customer's clock, correctly
        // — and a Toronto dispatcher read it as their own eight o'clock.
        val line = TwoClocks.bothClocks(wall(at, vancouver), wall(at, toronto))
        assertTrue(line, line.contains("8:00"))
        assertTrue(line, line.contains("11:00"))
        assertTrue(line, line.contains("their time"))
        assertTrue(line, line.contains("yours"))
    }

    @Test
    fun `says one plain time when the customer is in town`() {
        // The ordinary day for most crews. A label that is noise on the ordinary
        // day is one people stop reading before the day it matters.
        val here = wall(at, toronto)
        assertEquals(here, TwoClocks.bothClocks(here, here))
        assertEquals(here, TwoClocks.bothClocks(here))
        assertEquals(here, TwoClocks.bothClocks(here, null))
    }

    @Test
    fun `stays quiet for two zone ids that are one clock`() {
        // Toronto and New York are the same clock face; labelling that would put
        // the line on every row for nothing anybody can see.
        val there = wall(at, "America/New_York")
        val here = wall(at, toronto)
        assertTrue(TwoClocks.sameClock(there, here))
        assertEquals(there, TwoClocks.bothClocks(there, here))
    }

    @Test
    fun `is right on both sides of a DST boundary with no offset arithmetic`() {
        // Arizona keeps one offset all year while Toronto moves, so the gap is
        // three hours in January and two in July. Any stored offset would be wrong
        // for half the year.
        for (iso in listOf("2026-01-15T17:00:00Z", "2026-07-15T17:00:00Z")) {
            val line = TwoClocks.bothClocks(
                wall(iso, "America/Phoenix"),
                wall(iso, toronto),
            )
            assertTrue(line, line.contains("their time"))
        }
        // And the gap really did change, which is what makes this worth asserting.
        assertEquals(
            wall("2026-01-15T17:00:00Z", "America/Phoenix").substringAfter(", "),
            wall("2026-07-15T17:00:00Z", "America/Phoenix").substringAfter(", "),
        )
        assertFalse(
            wall("2026-01-15T17:00:00Z", toronto).substringAfter(", ") ==
                wall("2026-07-15T17:00:00Z", toronto).substringAfter(", "),
        )
    }

    @Test
    fun `carries the minutes of a half-hour zone`() {
        // Newfoundland is UTC-3:30, where an hours-apart number is wrong every day
        // rather than twice a year.
        val line = TwoClocks.bothClocks(wall(at, "America/St_Johns"), wall(at, toronto))
        assertTrue(line, line.contains(":30"))
    }

    @Test
    fun `speaks the difference rather than punctuating it`() {
        val spoken = TwoClocks.bothClocksSpoken(wall(at, vancouver), wall(at, toronto))
        assertTrue(spoken, spoken.contains("which is"))
        assertFalse(spoken, spoken.contains("·"))
        // And says nothing extra when there is nothing to say, like its twin.
        val here = wall(at, toronto)
        assertEquals(here, TwoClocks.bothClocksSpoken(here, here))
    }

    @Test
    fun `ignores padding a formatter added on one side only`() {
        assertTrue(TwoClocks.sameClock(" Tue, 8:00 AM ", "Tue, 8:00 AM"))
    }

    @Test
    fun `defaults a typed time to the reader's own clock`() {
        // A native picker reads and writes the DEVICE's zone. Starting on theirs
        // would mean the value shown is not the value held.
        assertEquals(TwoClocks.Choice.YOURS, TwoClocks.DEFAULT_CHOICE)
        assertEquals("Your time", TwoClocks.Choice.YOURS.label)
        assertEquals("Their time", TwoClocks.Choice.THEIRS.label)
    }

    // ---------------------------------------------------- against the original

    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }

    /**
     * The WORDS match the shared module.
     *
     * These are read off a customer's screen on three clients, and a phone saying
     * "their time" where the laptop says "customer's time" reads as two products.
     */
    @Test
    fun `the wording matches the shared module`() {
        val shared = repoFile("packages/shared/src/two-clocks.ts")
        assertTrue(
            "CLOCK_THERE has drifted from the shared module",
            shared.contains("export const CLOCK_THERE = \"${TwoClocks.THERE}\""),
        )
        assertTrue(
            "CLOCK_HERE has drifted from the shared module",
            shared.contains("export const CLOCK_HERE = \"${TwoClocks.HERE}\""),
        )
        for (choice in TwoClocks.Choice.entries) {
            assertTrue(
                "the ${choice.name} label has drifted: ${choice.label}",
                shared.contains("\"${choice.label}\""),
            )
        }
        assertTrue(
            "the default clock choice has drifted from the shared module",
            shared.contains("CLOCK_CHOICE_DEFAULT: ClockChoice = \"yours\""),
        )
    }

    /**
     * The area-code explanation matches the shared module, word for word.
     *
     * This is the sentence that answers the founder's "why are we deriving time from
     * customers area codes even?", and a phone that words it differently from the
     * laptop reads as two products disagreeing about their own rules. Asserted
     * against the shared text rather than against another copy of itself — that is
     * the mistake that let two Customise labels drift on #540.
     */
    @Test
    fun `the area-code explanation matches the shared module`() {
        // #228: the SENTENCE lives in the web catalogue now; the shared module
        // names a key. The separator test below still reads the module, which
        // is where a punctuation rule belongs.
        //
        // Sliced to the English half: the French holds the same key, and a
        // `contains` over the whole file would ask whether the sentence
        // appears in EITHER language.
        val shared = repoFile("apps/web/src/i18n/sections/domain.ts")
            .substringAfter("export const domainEn")
            .substringBefore("export const domainFr")
        assertTrue(
            "AREA_CODE_NOTE has drifted: ${TwoClocks.AREA_CODE_NOTE}",
            shared.contains(TwoClocks.AREA_CODE_NOTE),
        )
    }

    /** And the separator, which is the one character a narrow row can lose. */
    @Test
    fun `the separator matches the shared module`() {
        val shared = repoFile("packages/shared/src/two-clocks.ts")
        assertTrue(
            "the visible separator has drifted from the shared module",
            shared.contains("\${t} \${CLOCK_THERE} · \${here.trim()} \${CLOCK_HERE}"),
        )
        assertTrue(
            "the spoken form has drifted from the shared module",
            shared.contains("which is \${here.trim()}"),
        )
    }
}
