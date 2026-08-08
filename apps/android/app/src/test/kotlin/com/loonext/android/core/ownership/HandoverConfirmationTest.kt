package com.loonext.android.core.ownership

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #537 — the handover confirmation, and that this phone says what the laptop says.
 */
class HandoverConfirmationTest {

    // -------------------------------------------------------- which prompt to show

    @Test
    fun `somebody with an authenticator is sent to their app`() {
        assertEquals(
            HandoverConfirmation.Kind.AUTHENTICATOR,
            HandoverConfirmation.kindOf("mfa_challenge_required"),
        )
    }

    @Test
    fun `somebody without one is sent to their inbox`() {
        assertEquals(
            HandoverConfirmation.Kind.EMAIL,
            HandoverConfirmation.kindOf("confirmation_code_required"),
        )
    }

    @Test
    fun `no code is asked for when the refusal was about something else`() {
        // THE CASE THAT MATTERS. A handover is also refused because a transfer is
        // already in flight, or because the caller is not the owner. Prompting for a
        // code there would hide the real reason behind a code that cannot help.
        for (code in listOf("conflict", "forbidden", "validation_failed", "not_found")) {
            assertNull(code, HandoverConfirmation.kindOf(code))
        }
        assertNull(HandoverConfirmation.kindOf(null))
    }

    // ----------------------------------------------------------------- the six digits

    @Test
    fun `six digits are a code`() {
        assertTrue(HandoverConfirmation.isCode("123456"))
        // A code beginning zero is one in ten, and must not be treated as five digits.
        assertTrue(HandoverConfirmation.isCode("000000"))
    }

    @Test
    fun `a pasted code keeps its whitespace and still counts`() {
        assertTrue(HandoverConfirmation.isCode("  123456 "))
    }

    @Test
    fun `anything else is not`() {
        for (bad in listOf("", "12345", "1234567", "12345a", "abcdef", "12 34 56")) {
            assertTrue(bad, !HandoverConfirmation.isCode(bad))
        }
    }

    // ---------------------------------------------------------- against the original

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
     * Concatenation syntax and line wrapping removed, so what is left is the words.
     *
     * The TypeScript keeps each sentence on one long line; the Kotlin splits the
     * longer one across a `+`. Comparing fragments would compare the formatting.
     */
    private fun bare(text: String): String = text
        .replace("\"", "")
        .replace("+", "")
        .replace(Regex("\\s+"), " ")
        .trim()

    @Test
    fun `both sentences match the shared module, whole`() {
        val shared = bare(repoFile("packages/shared/src/handover-confirmation.ts"))
        for (kind in HandoverConfirmation.Kind.entries) {
            val sentence = bare(HandoverConfirmation.where(kind))
            assertTrue(
                "this sentence has drifted from the shared module: $sentence",
                shared.contains(sentence),
            )
        }
    }

    @Test
    fun `the two sentences are not the same sentence`() {
        // "Enter your code" is useless to somebody who does not know which code, and
        // the two codes live in completely different places.
        assertTrue(
            HandoverConfirmation.where(HandoverConfirmation.Kind.AUTHENTICATOR) !=
                HandoverConfirmation.where(HandoverConfirmation.Kind.EMAIL),
        )
    }

    @Test
    fun `the email sentence says how long the code lasts`() {
        // Ten minutes and one use turn "it didn't work" into "ask for another", which
        // is the next thing somebody needs to do.
        val email = HandoverConfirmation.where(HandoverConfirmation.Kind.EMAIL)
        assertTrue(email.contains("once"))
        assertTrue(email.contains("ten minutes"))
    }

    @Test
    fun `no client promises to resend an authenticator code`() {
        // There is nothing to resend — the app generates them.
        assertTrue(HandoverConfirmation.RESEND.lowercase().contains("again"))
        assertTrue(
            !HandoverConfirmation.where(HandoverConfirmation.Kind.AUTHENTICATOR)
                .contains("again"),
        )
    }

    @Test
    fun `a refused code invents no distinction the server refused to make`() {
        // The server answers the same way for wrong, expired, spent and out-of-
        // attempts, because saying which would tell an attacker whether they had the
        // right digits. A client must not undo that.
        for (leak in listOf("expired", "already", "attempts", "wrong")) {
            assertTrue(leak, !HandoverConfirmation.REJECTED.lowercase().contains(leak))
        }
    }

    @Test
    fun `the labels match the shared module`() {
        val shared = repoFile("packages/shared/src/handover-confirmation.ts")
        for (label in listOf(
            HandoverConfirmation.TITLE,
            HandoverConfirmation.FIELD,
            HandoverConfirmation.SUBMIT,
            HandoverConfirmation.RESEND,
            HandoverConfirmation.REJECTED,
        )) {
            assertTrue("this label has drifted: $label", shared.contains("\"$label\""))
        }
    }
}
