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
    fun `a stale factor is its OWN kind, not an alias for the wall`() {
        // #581/#7. The copy is identical and the mechanism is not, which is exactly
        // why this cannot be folded into AUTHENTICATOR.
        //
        // `mfa_challenge_required` is the workspace-wide wall and its six digits go
        // to our API. `mfa_reprove_required` says THIS act needs a factor proved in
        // the last five minutes, and its six digits go to SUPABASE in the client —
        // which refreshes the session and stamps a new proof time — after which the
        // action is retried with no code at all. Posting those digits at our API
        // instead would loop forever, because nothing there is checking a code.
        assertEquals(
            HandoverConfirmation.Kind.REPROVE,
            HandoverConfirmation.kindOf("mfa_reprove_required"),
        )
        assertEquals(
            HandoverConfirmation.Kind.AUTHENTICATOR,
            HandoverConfirmation.kindOf("mfa_challenge_required"),
        )
    }

    @Test
    fun `every code the shared module maps is mapped on this phone too`() {
        // Read out of the shared source rather than listed here, so a FOURTH code
        // added to the TypeScript and forgotten on Android fails HERE — loudly, in a
        // unit test — instead of falling through `kindOf` to null and putting a
        // generic error in front of an ownership transfer.
        val shared = repoFile("packages/shared/src/handover-confirmation.ts")
        val codes = Regex("""errorCode === "([a-z_]+)"""")
            .findAll(shared)
            .map { it.groupValues[1] }
            .toList()

        // Proves the guard is reading something. A regex that silently matches
        // nothing is a test that passes for the rest of its life without looking.
        assertTrue(
            "the shared mapping no longer reads `errorCode === \"...\"`, so this " +
                "guard has stopped reading anything: $codes",
            codes.contains("mfa_reprove_required"),
        )

        for (code in codes) {
            val kind = HandoverConfirmation.kindOf(code)
            assertTrue("$code maps to no kind on Android", kind != null)
            assertTrue(
                "$kind has no sentence telling the reader where to find the code",
                HandoverConfirmation.where(kind!!).isNotBlank(),
            )
        }
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

    // ------------------------------------------------------ where the digits are checked

    @Test
    fun `only the code we emailed is ours to check`() {
        // #581/#7, AND THE ONLY PART OF THIS THAT IS NOT COPY. Two of these kinds say
        // word for word the same sentence — see the copy test below — so the sentence
        // cannot be the thing anything branches on. This is the thing.
        //
        // Both authenticator demands refuse on a property of the SESSION rather than on
        // a secret the server is waiting to be told: one reads how long ago a factor was
        // proved, the other whether one was proved at all. Six digits in a request body
        // move neither, so posting them answers nothing and is refused identically
        // forever — a hard lockout out of an owner's own handover. Only the emailed code
        // is something our server can check, because it is the one it sent.
        assertEquals(
            HandoverConfirmation.Destination.API,
            HandoverConfirmation.destination(HandoverConfirmation.Kind.EMAIL),
        )
        assertEquals(
            HandoverConfirmation.Destination.SUPABASE,
            HandoverConfirmation.destination(HandoverConfirmation.Kind.REPROVE),
        )
        assertEquals(
            HandoverConfirmation.Destination.SUPABASE,
            HandoverConfirmation.destination(HandoverConfirmation.Kind.AUTHENTICATOR),
        )
    }

    @Test
    fun `the two kinds that say the same sentence are still not one kind`() {
        // The pairing that hid the bug. They now agree on a destination, which is a fact
        // about the server rather than a licence to collapse them: they are different
        // refusals, raised by different code, and one of them ALSO wants the retry to
        // happen inside five minutes. Anything that branched on the sentence instead of
        // the kind would be right today and wrong the next time either half moved.
        assertEquals(
            HandoverConfirmation.where(HandoverConfirmation.Kind.AUTHENTICATOR),
            HandoverConfirmation.where(HandoverConfirmation.Kind.REPROVE),
        )
        assertTrue(
            "two refusals raised by different code must not map to one kind",
            HandoverConfirmation.kindOf("mfa_challenge_required") !=
                HandoverConfirmation.kindOf("mfa_reprove_required"),
        )
        // And the kind that genuinely differs still differs, in both directions.
        assertTrue(
            "the emailed code is a different ask and a different destination",
            HandoverConfirmation.where(HandoverConfirmation.Kind.EMAIL) !=
                HandoverConfirmation.where(HandoverConfirmation.Kind.AUTHENTICATOR) &&
                HandoverConfirmation.destination(HandoverConfirmation.Kind.EMAIL) !=
                HandoverConfirmation.destination(HandoverConfirmation.Kind.AUTHENTICATOR),
        )
    }

    @Test
    fun `the question a caller asks is answered off the same map`() {
        // `goesToOurApi` is what the gate actually calls, so it has to agree with
        // `destination` rather than be a second opinion sitting beside it.
        for (kind in HandoverConfirmation.Kind.entries) {
            val fromTheMap =
                HandoverConfirmation.destination(kind) == HandoverConfirmation.Destination.API
            assertTrue(
                "goesToOurApi disagrees with destination about ${kind.name}",
                HandoverConfirmation.goesToOurApi(kind) == fromTheMap,
            )
        }
    }

    @Test
    fun `every destination the shared module states is the destination on this phone`() {
        // Read out of the shared source rather than restated here, for the same reason
        // as the code mapping above: a FOURTH kind, or a destination CHANGED in the
        // TypeScript, fails HERE instead of quietly leaving this phone posting digits
        // at an endpoint that is not reading them.
        val shared = repoFile("packages/shared/src/handover-confirmation.ts")
        val block = shared
            .substringAfter("const HANDOVER_CODE_DESTINATION")
            .substringAfter("{")
            .substringBefore("}")
        val stated = Regex("""(\w+):\s*"(api|supabase)"""")
            .findAll(block)
            .associate { it.groupValues[1] to it.groupValues[2] }

        // Proves the guard is reading something. A regex that silently matches nothing
        // passes for the rest of its life without ever looking at the shared module —
        // and this is the exact assertion whose absence let the lockout ship.
        assertEquals(
            "the shared destination map no longer parses, so this guard has stopped " +
                "reading anything: $stated",
            "supabase",
            stated["reprove"],
        )
        assertEquals(
            "the shared module names kinds this phone does not: $stated",
            HandoverConfirmation.Kind.entries.size,
            stated.size,
        )

        for ((name, destination) in stated) {
            val kind = HandoverConfirmation.Kind.valueOf(name.uppercase())
            assertEquals(
                "$name is checked in a different place on this phone",
                HandoverConfirmation.Destination.valueOf(destination.uppercase()),
                HandoverConfirmation.destination(kind),
            )
        }
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
    fun `a stale factor says word for word what the wall says`() {
        // The person is doing the identical thing — same app, same six digits — and
        // a second phrasing for the same physical act would read as a different
        // demand to somebody who meets both in one afternoon. Everything that
        // differs between these two happens on our side of the wire.
        assertEquals(
            HandoverConfirmation.where(HandoverConfirmation.Kind.AUTHENTICATOR),
            HandoverConfirmation.where(HandoverConfirmation.Kind.REPROVE),
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
        // There is nothing to resend — the app generates them. True of the stale
        // factor for the same reason: nobody is sending that person anything.
        assertTrue(HandoverConfirmation.RESEND.lowercase().contains("again"))
        for (kind in listOf(
            HandoverConfirmation.Kind.AUTHENTICATOR,
            HandoverConfirmation.Kind.REPROVE,
        )) {
            assertTrue(
                kind.name,
                !HandoverConfirmation.where(kind).contains("again"),
            )
        }
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
