package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * calls-v3 §10.1.2 + §15.4, pinned as a source lint: the client NEVER hangs
 * up a leg for staleness — the ONLY teardown is explicit user action. The
 * server cancels every stale leg on every ringing-exit, and dismissal is
 * SILENCE-only ([CallStateMachine.presentationSilenced]). This is the
 * regression that keeps a future refactor from re-introducing a StaleRing-style
 * client-side kill (the exact behavior this redesign deleted, §12.3).
 */
class ClientHangupLintTest {
    @Test
    fun `the SDK-leg teardown handle-end appears only inside fun hangup`() {
        val src = readMainSource("telephony/SoftphoneCore.kt")

        // handle.end() is the SDK leg-teardown verb. It must occur exactly once
        // in the whole core, and that once must be the explicit user hangup.
        val occurrences = Regex("""\.end\(\)""").findAll(src).map { it.range.first }.toList()
        assertEquals(
            "exactly one SDK-leg teardown in SoftphoneCore — any more is a client-initiated kill",
            1,
            occurrences.size,
        )

        val hangupStart = src.indexOf("fun hangup(")
        assertTrue("fun hangup() must exist", hangupStart >= 0)
        // The next top-level method after hangup bounds its body.
        val nextMethod = src.indexOf("\n    fun ", hangupStart + 1)
        assertTrue("a method follows hangup()", nextMethod > hangupStart)
        assertTrue(
            "the only handle.end() is on the user-action (hangup) path",
            occurrences.single() in hangupStart until nextMethod,
        )
    }

    @Test
    fun `the deleted StaleRing probe is not referenced by the softphone`() {
        for (file in listOf("telephony/SoftphoneCore.kt", "telephony/SoftphoneManager.kt")) {
            val src = readMainSource(file)
            assertTrue(
                "$file must not reference the deleted StaleRing probe",
                !src.contains("StaleRing"),
            )
        }
    }

    private fun readMainSource(relative: String): String {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val f = File("$base/$relative")
            if (f.exists()) return f.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
