package com.loonext.android.features.contacts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #410 — the Kotlin half of a line three clients render.
 *
 * The table below is `CONTACT_RELATIONSHIP_CASES` from
 * `packages/shared/src/contact-relationship.ts`, copied case for case. Adding
 * a case there means adding it here; the mirror is
 * `apps/ios/LoonextTests/ContactRelationshipTests.swift`.
 *
 * A drifted copy does not degrade a feature — it tells one platform's crew a
 * different thing about the same customer.
 */
class ContactRelationshipTest {

    /** [count, firstConversationAt, expected] — the shared fixture. */
    private val cases: List<Triple<Int?, String?, String?>> = listOf(
        Triple(0, null, null),
        Triple(null, null, null),
        Triple(0, "2026-03-04T10:00:00Z", null),
        Triple(1, "2026-03-04T10:00:00Z", "Customer since March 2026 · 1 conversation"),
        Triple(7, "2026-03-04T10:00:00Z", "Customer since March 2026 · 7 conversations"),
        Triple(23, "2023-11-30T23:59:59Z", "Customer since November 2023 · 23 conversations"),
        Triple(4, null, "4 conversations"),
        Triple(4, "not a timestamp", "4 conversations"),
        Triple(2, "2026-01-01T00:00:00Z", "Customer since January 2026 · 2 conversations"),
        Triple(2, "2026-12-31T23:59:59Z", "Customer since December 2026 · 2 conversations"),
    )

    @Test
    fun `matches the shared table case for case`() {
        for ((count, first, expected) in cases) {
            assertEquals(
                "count=$count first=$first",
                expected,
                contactRelationshipLine(count, first),
            )
        }
    }

    @Test
    fun `reads the month off the string, not through a date type`() {
        // A date-based port shifts a midnight UTC timestamp into the previous
        // month west of Greenwich, so the same customer would read "December"
        // on one client and "January" on another.
        assertEquals("January 2026", monthYear("2026-01-01T00:00:00Z"))
        assertEquals("January 2026", monthYear("2026-01-01T00:00:00-08:00"))
        assertEquals("December 2026", monthYear("2026-12-31T23:59:59+13:00"))
    }

    @Test
    fun `degrades to null on anything it cannot read`() {
        for (bad in listOf(null, "", "yesterday", "2026", "26-03-04")) {
            assertNull(bad, monthYear(bad))
        }
    }

    @Test
    fun `gets the singular right`() {
        // "1 conversations" is the kind of detail that makes a product feel
        // unfinished on the exact screen it is trying to build confidence.
        assertEquals("1 conversation", contactRelationshipLine(1, null))
        assertEquals("2 conversations", contactRelationshipLine(2, null))
    }
}
