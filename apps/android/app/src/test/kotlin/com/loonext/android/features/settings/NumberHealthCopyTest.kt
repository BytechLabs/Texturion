package com.loonext.android.features.settings

import com.loonext.android.core.model.NumberHealth
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #235 — what a degraded number is told to its owner.
 *
 * Three things are pinned, and all three are about restraint. This copy tells
 * somebody their business phone line is not working properly; getting the tone
 * wrong costs more than saying nothing would.
 */
class NumberHealthCopyTest {
    private fun health(rate: Double? = 0.54) = NumberHealth(
        state = "degraded",
        delivery_rate = rate,
        degraded_since = "2026-07-01T00:00:00Z",
        detail = "delivery 54% against a baseline of 97%",
    )

    @Test
    fun `gives the number when there is one worth quoting`() {
        assertTrue(numberHealthCopy(health()).contains("54%"))
    }

    @Test
    fun `says less rather than inventing precision when there is no rate`() {
        val copy = numberHealthCopy(health(rate = null))
        assertTrue(copy, copy.contains("Fewer of your texts"))
        assertFalse(copy, copy.contains("%"))
    }

    @Test
    fun `never says spam or flagged`() {
        // We know delivery fell. We do NOT know which vendor labelled it, or
        // whether one did. Naming a cause we have not established would be a
        // guess dressed as a diagnosis — and the customer would repeat it to
        // their own customers.
        val copy = numberHealthCopy(health()).lowercase()
        assertFalse(copy, copy.contains("spam"))
        assertFalse(copy, copy.contains("flagged"))
        assertFalse(copy, copy.contains("blocked"))
    }

    @Test
    fun `does not ask the customer to do anything they cannot do`() {
        // Remediation is registry paperwork that takes days and needs their
        // real business identity. Implying a self-serve fix would be a lie
        // about the timeline, and they would sit waiting for a button.
        val copy = numberHealthCopy(health())
        assertTrue(copy, copy.contains("we're on it"))
        assertTrue(copy, copy.contains("don't need to do anything yet"))
    }
}
