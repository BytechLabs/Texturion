package com.loonext.android.core.format

import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #313 — the same cases as `satisfaction.test.ts` and `SatisfactionFormatTests`.
 *
 * The locale case is the one that could not be caught any other way. A source
 * grep proves `Locale.US` is written; only running under a comma-decimal locale
 * proves it is the one that decides the output.
 */
class SatisfactionFormatTest {

    private val original = Locale.getDefault()

    @After
    fun restore() {
        Locale.setDefault(original)
    }

    @Test
    fun `renders an em dash rather than a zero nobody could score`() {
        assertEquals("—", SatisfactionFormat.format(null))
        assertEquals("—", SatisfactionFormat.format(Double.NaN))
        assertEquals("—", SatisfactionFormat.format(Double.POSITIVE_INFINITY))
    }

    @Test
    fun `one decimal, because a second is noise on a 1-5 scale`() {
        assertEquals("4.3", SatisfactionFormat.format(4.25))
        assertEquals("5.0", SatisfactionFormat.format(5.0))
    }

    @Test
    fun `a comma-decimal device still agrees with the laptop`() {
        // THE BUG THIS EXISTS FOR. Kotlin's default-locale formatting renders
        // 4.6 as "4,6" in Germany, France, Spain and most of Europe. The number
        // would disagree with the same number on the web app, on a customer's
        // phone only — invisible to anyone developing in en-US.
        Locale.setDefault(Locale.GERMANY)
        assertEquals("4.6", SatisfactionFormat.format(4.6))
    }

    @Test
    fun `a move smaller than the threshold is not a direction`() {
        assertNull(SatisfactionFormat.arcDirection(0.1))
        assertNull(SatisfactionFormat.arcDirection(-0.1))
        assertNull(SatisfactionFormat.arcDirection(0.0))
        assertNull(SatisfactionFormat.arcDirection(null))
    }

    @Test
    fun `names both directions, including the unflattering one`() {
        assertEquals("better", SatisfactionFormat.arcDirection(0.2))
        assertEquals("worse", SatisfactionFormat.arcDirection(-0.4))
    }

    @Test
    fun `counts poor ratings as work, and gets the singular right`() {
        assertEquals("1 job needed a call back", SatisfactionFormat.poorRatingLine(1))
        assertEquals("3 jobs needed a call back", SatisfactionFormat.poorRatingLine(3))
    }
}
