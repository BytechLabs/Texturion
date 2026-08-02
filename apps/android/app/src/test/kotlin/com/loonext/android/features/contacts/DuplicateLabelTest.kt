package com.loonext.android.features.contacts

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #246 — how a duplicate pair is named to somebody deciding whether to merge.
 *
 * The label is the whole basis of that decision: get it wrong and a crew
 * merges two customers who are not the same person, which is the one mistake
 * here that costs more than doing nothing.
 */
class DuplicateLabelTest {
    @Test
    fun `names the person and the number together`() {
        assertEquals(
            "Mike ((415) 555-0501)",
            describeContact("Mike", "+14155550501"),
        )
    }

    @Test
    fun `falls back to the number when a record has no name`() {
        // A phantom contact from a typo usually has nothing else to show, and
        // an empty parenthesis would read as a bug.
        assertEquals("(415) 555-0501", describeContact(null, "+14155550501"))
        assertEquals("(415) 555-0501", describeContact("   ", "+14155550501"))
    }

    @Test
    fun `shows a number it cannot format rather than hiding it`() {
        // An unparseable number is still the only thing distinguishing the two
        // records. Dropping it would leave the pair unidentifiable.
        assertEquals("+442071838750", describeContact(null, "+442071838750"))
    }
}
