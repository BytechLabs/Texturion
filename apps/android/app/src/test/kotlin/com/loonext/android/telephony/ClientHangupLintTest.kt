package com.loonext.android.telephony

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
    fun `the SDK-leg teardown handle-end appears only on explicit user-action paths`() {
        val src = readMainSource("telephony/SoftphoneCore.kt")

        // handle.end() is the SDK leg-teardown verb. It may appear ONLY on explicit
        // user-action teardown paths — never a staleness/reconcile kill (the deleted
        // StaleRing regression, §12.3). The allowed sites, keyed by their enclosing
        // function name:
        //  - hangup                    — the user hung up / declined a presented leg.
        //  - declineCancelledPlacement — #213: the member cancelled a placement during
        //    "Calling…"; the server-dialed op INVITE, arriving later, is declined (the
        //    SAME user action, deferred until the op leg materialized).
        val allowedFns = setOf("hangup", "declineCancelledPlacement")
        val funDecl = Regex("""fun\s+(\w+)\s*\(""")
        val occurrences = Regex("""\.end\(\)""").findAll(src).map { it.range.first }.toList()
        assertTrue("at least one SDK-leg teardown must exist (the user hangup)", occurrences.isNotEmpty())
        for (at in occurrences) {
            // The nearest preceding `fun name(` is the enclosing method (lambdas carry
            // no `fun name(`, so an .end() inside a lambda still resolves to its method).
            val enclosing = funDecl.findAll(src.substring(0, at)).lastOrNull()?.groupValues?.get(1)
            assertTrue(
                "handle.end() at offset $at is inside `fun $enclosing` — not an explicit " +
                    "user-action teardown ($allowedFns); a client-initiated staleness kill",
                enclosing in allowedFns,
            )
        }
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
