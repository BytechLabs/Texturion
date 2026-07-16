package com.loonext.android.features.compose

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Port of every vector in packages/shared/src/merge-fields.test.ts. */
class MergeFieldsTest {

    // --- substitution ---

    @Test
    fun `substitutes first_name with the first token of the contact name`() {
        assertEquals(
            "Hi Dana, on my way!",
            MergeFields.applyMergeFields(
                "Hi {first_name}, on my way!",
                contactName = "Dana Whitfield",
            ),
        )
    }

    @Test
    fun `substitutes business_name`() {
        assertEquals(
            "Thanks from Ace Plumbing",
            MergeFields.applyMergeFields(
                "Thanks from {business_name}",
                businessName = "Ace Plumbing",
            ),
        )
    }

    @Test
    fun `handles a single-word name`() {
        assertEquals(
            "Hi Sam",
            MergeFields.applyMergeFields("Hi {first_name}", contactName = "Sam"),
        )
    }

    @Test
    fun `collapses surrounding whitespace in the name`() {
        assertEquals(
            "Hi Jo!",
            MergeFields.applyMergeFields("Hi {first_name}!", contactName = "   Jo   Ann  "),
        )
    }

    @Test
    fun `leaves text without tokens byte-for-byte unchanged`() {
        val text = "No tokens here — just a plain message."
        assertEquals(text, MergeFields.applyMergeFields(text, contactName = "Dana"))
    }

    @Test
    fun `is case-insensitive on the token name`() {
        assertEquals(
            "Hi Dana",
            MergeFields.applyMergeFields("Hi {First_Name}", contactName = "Dana Lee"),
        )
    }

    // --- graceful degradation ---

    @Test
    fun `drops first_name cleanly when the name is missing`() {
        val out = MergeFields.applyMergeFields(
            "Hi {first_name}, thanks for calling.",
            contactName = null,
        )
        assertEquals("Hi, thanks for calling.", out)
        assertFalse(out.contains("{first_name}"))
    }

    @Test
    fun `drops first_name when the name is whitespace`() {
        assertEquals(
            "Hi, thanks.",
            MergeFields.applyMergeFields("Hi {first_name}, thanks.", contactName = "   "),
        )
    }

    @Test
    fun `drops a trailing token cleanly with no dangling space`() {
        assertEquals(
            "Call",
            MergeFields.applyMergeFields("Call {business_name}", businessName = null),
        )
    }

    @Test
    fun `drops unknown tokens without rendering the literal braces`() {
        assertEquals(
            "Hi Dana, your is ready",
            MergeFields.applyMergeFields(
                "Hi {first_name}, your {gizmo} is ready",
                contactName = "Dana",
            ),
        )
    }

    @Test
    fun `degrades multiple missing tokens at once`() {
        assertEquals(
            "—",
            MergeFields.applyMergeFields("{first_name} — {business_name}"),
        )
    }

    @Test
    fun `never emits a literal supported token even when all values absent`() {
        val out = MergeFields.applyMergeFields("{first_name} {business_name}")
        for (token in MergeFields.TOKENS) {
            assertFalse(out.contains("{$token}"))
        }
    }

    // --- hasMergeFields ---

    @Test
    fun `detects supported tokens`() {
        assertTrue(MergeFields.hasMergeFields("Hi {first_name}"))
        assertTrue(MergeFields.hasMergeFields("Business: {business_name}"))
    }

    @Test
    fun `ignores unknown tokens and brace-free text`() {
        assertFalse(MergeFields.hasMergeFields("Hi {gizmo}"))
        assertFalse(MergeFields.hasMergeFields("plain text"))
        assertFalse(MergeFields.hasMergeFields("a { b } c"))
    }
}
