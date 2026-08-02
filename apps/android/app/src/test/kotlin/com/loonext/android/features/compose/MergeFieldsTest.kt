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

    // ---- #274: the tokens that make a template do real work -----------------

    @Test
    fun `expresses the two messages a crew actually repeats`() {
        val values = MergeFields.MergeValues(
            contactAddress = "18 Rosewood Ave",
            jobDay = "Tuesday",
            jobTime = "2:00 PM",
        )
        assertEquals(
            "On my way to 18 Rosewood Ave",
            MergeFields.applyMergeFields("On my way to {address}", values),
        )
        assertEquals(
            "Confirming Tuesday at 2:00 PM",
            MergeFields.applyMergeFields("Confirming {job_day} at {job_time}", values),
        )
    }

    @Test
    fun `signs with the person, not the company`() {
        // A FIRST name, like {first_name}: "Sam" is how a tech signs a text.
        assertEquals(
            "- Sam",
            MergeFields.applyMergeFields(
                "- {my_name}",
                MergeFields.MergeValues(senderName = "Sam Okafor"),
            ),
        )
    }

    @Test
    fun `keeps a multi-line address on one line`() {
        assertEquals(
            "On my way to 18 Rosewood Ave, Unit 4",
            MergeFields.applyMergeFields(
                "On my way to {address}",
                MergeFields.MergeValues(contactAddress = "18 Rosewood Ave\nUnit 4"),
            ),
        )
    }

    @Test
    fun `degrades exactly as the original two did`() {
        // The contract that must not change: a missing value drops the token
        // and the punctuation closes up behind it.
        assertEquals(
            "On my way to",
            MergeFields.applyMergeFields("On my way to {address}", MergeFields.MergeValues()),
        )
        assertEquals(
            "Hi, we're at.",
            MergeFields.applyMergeFields(
                "Hi {first_name}, we're at {address}.",
                MergeFields.MergeValues(),
            ),
        )
    }

    @Test
    fun `formats the reply-to number the way the server does`() {
        assertEquals("(415) 555-0142", MergeFields.formatNanpNumber("+14155550142"))
        // Anything unparseable comes back untouched: it is still dialable.
        assertEquals("+442071838750", MergeFields.formatNanpNumber("+442071838750"))
    }

    @Test
    fun `the editor offers the same seven variables the other clients do`() {
        // A token offered on the phone and not the laptop means a template
        // somebody writes here and then cannot maintain there.
        assertEquals(
            listOf(
                "first_name", "address", "job_day", "job_time",
                "my_name", "business_name", "our_number",
            ),
            MergeFields.VARIABLES.map { it.first },
        )
        // And every one of them actually resolves.
        for ((token, _, _) in MergeFields.VARIABLES) {
            assertTrue("$token is offered but not supported", token in MergeFields.TOKENS)
        }
    }

    @Test
    fun `the template preview shows every token working`() {
        // An unresolved token renders as nothing, which is exactly what a
        // BROKEN token looks like — so the preview must resolve all of them.
        val preview = MergeFields.previewTemplate(
            "{first_name} {address} {job_day} {job_time} {my_name} {business_name} {our_number}",
            businessName = "Ace Plumbing",
            ourNumberE164 = "+14155550142",
        )
        assertTrue(preview, preview.contains("Dana"))
        assertTrue(preview, preview.contains("18 Rosewood Ave"))
        assertTrue(preview, preview.contains("Tuesday"))
        assertTrue(preview, preview.contains("2:00 PM"))
        assertTrue(preview, preview.contains("Sam"))
        assertTrue(preview, preview.contains("Ace Plumbing"))
        assertTrue(preview, preview.contains("(415) 555-0142"))
    }

}
