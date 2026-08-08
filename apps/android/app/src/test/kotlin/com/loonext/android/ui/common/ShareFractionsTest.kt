package com.loonext.android.ui.common

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #540 — the share bar's arithmetic, tested as arithmetic.
 *
 * This exists because the first version of this check was a RENDER test: compose a
 * bar whose parts exceed its whole, assert the bar appears. It passed with the
 * clamp deleted, because an over-long segment overflows quietly rather than
 * failing — so the test was checking nothing at all. The same set as the web
 * twin's, on the numbers themselves.
 */
class ShareFractionsTest {

    private fun pct(values: List<Float>, total: Float): List<Int> =
        shareFractions(values, total).map { Math.round(it * 100f) }

    @Test
    fun `splits the whole by value`() {
        assertEquals(listOf(30), pct(listOf(3f), 10f))
        assertEquals(listOf(50, 30), pct(listOf(5f, 3f), 10f))
    }

    @Test
    fun `leaves the unaccounted remainder rather than inflating a part`() {
        // 5 won and 3 still out of 10 quoted means 2 went quiet. That gap is the
        // honest picture, and stretching the parts to fill the bar would hide the
        // one number an owner should chase.
        assertEquals(80, pct(listOf(5f, 3f), 10f).sum())
    }

    @Test
    fun `does not let parts run off the end when they exceed the whole`() {
        // THE ONE THE RENDER TEST COULD NOT SEE. The parts and the total are
        // separate figures from the server, and a lagging window can disagree with
        // itself by one.
        val p = pct(listOf(8f, 8f), 10f)
        assertEquals(100, p.sum())
        // The FIRST part keeps its true share; the overflow comes off the one that
        // could not fit, rather than both being scaled into a shape neither figure
        // supports.
        assertEquals(listOf(80, 20), p)
    }

    @Test
    fun `a third part gets nothing once the bar is full`() {
        assertEquals(listOf(80, 20, 0), pct(listOf(8f, 8f, 4f), 10f))
    }

    @Test
    fun `no whole means no shares`() {
        assertEquals(listOf(0, 0), pct(listOf(4f, 2f), 0f))
    }

    @Test
    fun `a negative part draws nothing rather than reversing the bar`() {
        assertEquals(listOf(0, 40), pct(listOf(-5f, 4f), 10f))
    }
}
