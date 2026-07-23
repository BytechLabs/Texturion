package com.loonext.android.telephony

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #208 calling-audit client hardening (C1 + C2), pinned as source lints in the
 * [ClientHangupLintTest] idiom: the wired seams live in device-only classes
 * ([TelnyxSdkClient] wraps the real Telnyx SDK, [TelecomCallRegistry] wraps
 * `CallsManager`), so neither constructs on the JVM. The DECISIONS are
 * unit-tested for real in [TelecomCallReducerTest] (retry/force-complete
 * policy) and [SoftphoneCoreTest] (ccid pass-through, null-ccid skip); these
 * lints pin the WIRING so a refactor cannot silently undo either fix.
 */
class Audit208LintTest {

    @Test
    fun `C1 - the INVITE by-leg fallback key is the call_control_id, never the Telnyx session id`() {
        // GET /v1/calls/live/by-leg/:legId matches call_member_legs.call_control_id
        // server-side. A Telnyx SESSION uuid is never a ccid, so building the
        // fallback key from getTelnyxSessionId made the header-absent by-leg
        // resolve dead code that 404'd unconditionally.
        val src = readMainSource("telephony/TelnyxSdkClient.kt")
        val assignment = Regex("""val legId =[^\n]*""").find(src)?.value
        assertNotNull("TelnyxSdkClient must build the by-leg fallback key", assignment)
        assertTrue(
            "the by-leg key must be getTelnyxCallControlId (what GET /by-leg matches)",
            assignment!!.contains("getTelnyxCallControlId"),
        )
        assertFalse(
            "a Telnyx session uuid is never a ccid - keying the resolve on it is a guaranteed 404",
            assignment.contains("getTelnyxSessionId"),
        )
    }

    @Test
    fun `C2 - every OS disconnect delivery escalates through disconnectOnScope`() {
        // A disconnect delivered via the generic scopeOp is report-only on
        // failure: terminated is already latched, so the entry (and the OS
        // call) wedges for the process lifetime. Every delivery site must use
        // the escalating path (retry once, then force-complete locally).
        val src = readMainSource("telephony/TelecomCallRegistry.kt")
        assertFalse(
            "no disconnect may be delivered through the report-only scopeOp",
            Regex("""scopeOp\([^)\n]*\)\s*\{\s*disconnect\(""").containsMatchIn(src),
        )
        assertTrue(
            "the escalating delivery path must exist",
            src.contains("private fun disconnectOnScope("),
        )
        assertTrue(
            "the retry/force-complete decision must come from the pure reducer policy",
            src.contains("TelecomCallReducer.onDisconnectDeliveryFailed("),
        )
    }

    @Test
    fun `C2 - the force-complete is LOCAL bookkeeping only - no SIP or SDK leg teardown`() {
        // The force-complete finishes OUR side of a wedged entry (timers,
        // registry map, notification, last-call FGS guard via cleanup). It must
        // NEVER reach for the media leg: no bridge.endLeg, no handle.end() -
        // the client-never-hangs-up invariant (ClientHangupLintTest) stands.
        val src = readMainSource("telephony/TelecomCallRegistry.kt")
        val start = src.indexOf("private fun forceCompleteEntry(")
        assertTrue("forceCompleteEntry must exist", start >= 0)
        val next = src.indexOf("\n    private fun ", start + 1)
        val body = src.substring(start, if (next > start) next else src.length)
        assertFalse("force-complete must never end the Telnyx leg", body.contains("endLeg"))
        assertFalse("force-complete must never touch an SDK handle", body.contains(".end()"))
        assertTrue(
            "force-complete runs the shared cleanup bookkeeping (timers, map, notification, FGS last-call guard)",
            body.contains("cleanup(entry)"),
        )
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
