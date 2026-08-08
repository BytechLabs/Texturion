package com.loonext.android.core.security

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #330 — the handover copy, and that this phone says what the shared module says.
 */
class HandOverPhoneTest {

    @Test
    fun `it names what leaves the phone rather than saying 'your data'`() {
        // The person handing it over is deciding whether it is safe to. "Some data
        // will be removed" does not answer that; the list does.
        val body = HandOverPhone.body(0)
        assertTrue(body.contains("conversations"))
        assertTrue(body.contains("customers"))
        assertTrue(body.contains("signed out"))
    }

    @Test
    fun `it says the next person signs in as themselves`() {
        assertTrue(HandOverPhone.body(0).contains("signs in as themselves"))
    }

    @Test
    fun `unsent messages are counted, not gestured at`() {
        assertTrue(HandOverPhone.body(1).contains("One message"))
        assertTrue(HandOverPhone.body(1).contains("discarded"))
        assertTrue(HandOverPhone.body(3).contains("3 messages"))
    }

    @Test
    fun `it says what to do instead, not just what is lost`() {
        assertTrue(HandOverPhone.body(2).contains("signal"))
    }

    @Test
    fun `a clean handover carries no warning`() {
        // A warning that fires every time is a warning nobody reads on the day it
        // matters.
        val body = HandOverPhone.body(0)
        assertTrue(!body.contains("discarded"))
        assertTrue(!body.contains("signal"))
    }

    @Test
    fun `the warning is one sentence longer, not a different screen`() {
        assertTrue(HandOverPhone.body(1).startsWith(HandOverPhone.body(0)))
    }

    @Test
    fun `costs is true only when something would be lost`() {
        assertEquals(false, HandOverPhone.costs(0))
        assertEquals(true, HandOverPhone.costs(1))
        // A negative count is a bug upstream, not a reason to warn about nothing.
        assertEquals(false, HandOverPhone.costs(-1))
        assertEquals(HandOverPhone.body(0), HandOverPhone.body(-1))
    }

    // ---------------------------------------------------------- against the original

    /** The shared source, with carriage returns stripped — this tree is CRLF. */
    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText().filterNot { it == '\r' }
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }

    /**
     * Concatenation syntax and line wrapping removed, so what is left is the words.
     *
     * The TypeScript and the Kotlin break the same sentences at different points, so
     * comparing fragments would compare the formatting rather than the wording.
     */
    private fun bare(text: String): String = text
        .replace("\"", "")
        .replace("+", "")
        .replace(Regex("\\s+"), " ")
        .trim()

    @Test
    fun `the sentence a clean handover shows matches the shared module, whole`() {
        val shared = bare(repoFile("packages/shared/src/hand-over-phone.ts"))
        assertTrue(
            "the handover copy has drifted from the shared module",
            shared.contains(bare(HandOverPhone.body(0))),
        )
    }

    @Test
    fun `the labels match the shared module`() {
        val shared = repoFile("packages/shared/src/hand-over-phone.ts")
        for (label in listOf(
            HandOverPhone.ACTION,
            HandOverPhone.TITLE,
            HandOverPhone.CONFIRM,
            HandOverPhone.CANCEL,
        )) {
            assertTrue("this label has drifted: $label", shared.contains("\"$label\""))
        }
    }
}
