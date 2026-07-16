package com.loonext.android.features.calls

import com.loonext.android.core.model.Call
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun call(
    outcome: String? = null,
    direction: String = "inbound",
    forwardSeconds: Int = 0,
    contactName: String? = null,
    callerName: String? = null,
    callerE164: String? = null,
    screening: String? = null,
) = Call(
    id = "c1",
    call_session_id = "sess-1",
    caller_e164 = callerE164,
    contact_name = contactName,
    caller_name = callerName,
    outcome = outcome,
    direction = direction,
    forward_seconds = forwardSeconds,
    screening_result = screening,
    started_at = "2026-07-15T12:00:00Z",
)

class CallsLogicTest {
    @Test
    fun `caller resolution order is contact then CNAM then number`() {
        assertEquals(
            "Dana Fix-It",
            callerDisplayName(
                call(contactName = "Dana Fix-It", callerName = "DANA F", callerE164 = "+14155550134"),
            ),
        )
        assertEquals(
            "DANA F",
            callerDisplayName(call(callerName = "DANA F", callerE164 = "+14155550134")),
        )
        assertEquals("(415) 555-0134", callerDisplayName(call(callerE164 = "+14155550134")))
        assertEquals("Unknown caller", callerDisplayName(call()))
    }

    @Test
    fun `outcome labels match the web's plain language`() {
        assertEquals("Missed", callOutcomeLabel(call(outcome = "missed")))
        assertEquals("No answer", callOutcomeLabel(call(outcome = "missed", direction = "outbound")))
        assertEquals("Voicemail", callOutcomeLabel(call(outcome = "voicemail")))
        assertEquals("Answered", callOutcomeLabel(call(outcome = "answered")))
        assertEquals(
            "Answered · 4m 32s",
            callOutcomeLabel(call(outcome = "answered", forwardSeconds = 272)),
        )
        assertEquals(
            "You called · 58s",
            callOutcomeLabel(
                call(outcome = "answered", direction = "outbound", forwardSeconds = 58),
            ),
        )
        assertEquals("You called", callOutcomeLabel(call(outcome = "answered", direction = "outbound")))
        assertEquals("In progress", callOutcomeLabel(call(outcome = null)))
        assertEquals("Calling…", callOutcomeLabel(call(outcome = null, direction = "outbound")))
        // Unknown future outcome values degrade to the in-flight copy, never crash.
        assertEquals("In progress", callOutcomeLabel(call(outcome = "some_new_state")))
    }

    @Test
    fun `only an inbound miss is actionable urgency`() {
        assertTrue(isActionableMiss(call(outcome = "missed")))
        assertFalse(isActionableMiss(call(outcome = "missed", direction = "outbound")))
        assertFalse(isActionableMiss(call(outcome = "answered")))
    }

    @Test
    fun `screening labels stay quiet unless the carrier flagged the call`() {
        assertNull(screeningLabel(null))
        assertNull(screeningLabel(""))
        assertNull(screeningLabel("no_flag"))
        assertNull(screeningLabel("CLEAN"))
        assertEquals("Spam likely", screeningLabel("SPAM"))
        assertEquals("Spam likely", screeningLabel("fraud_risk"))
        assertEquals("Spam likely", screeningLabel("robocall"))
        assertNull(screeningLabel("unknown_verdict"))
    }

    @Test
    fun `durations format like the web`() {
        assertEquals("58s", formatCallDuration(58))
        assertEquals("4m 32s", formatCallDuration(272))
        assertEquals("2m", formatCallDuration(120))
        assertEquals("0s", formatCallDuration(-5))
    }

    @Test
    fun `the live timer formats minutes and hours`() {
        assertEquals("0:00", formatTimer(0))
        assertEquals("0:42", formatTimer(42_000))
        assertEquals("12:04", formatTimer((12 * 60 + 4) * 1000L))
        assertEquals("1:02:33", formatTimer((3600 + 2 * 60 + 33) * 1000L))
    }

    @Test
    fun `dialable numbers are NANP - 10 digits, 11 with a 1, or already E164`() {
        assertEquals("+14155550134", dialableE164("4155550134"))
        assertEquals("+14155550134", dialableE164("(415) 555-0134"))
        assertEquals("+14155550134", dialableE164("14155550134"))
        assertEquals("+14155550134", dialableE164("+1 415 555 0134"))
        assertNull(dialableE164("415555"))
        assertNull(dialableE164(""))
        assertNull(dialableE164("24155550134"))
    }

    @Test
    fun `progressive dial formatting`() {
        assertEquals("", formatAsYouDial(""))
        assertEquals("(415", formatAsYouDial("415"))
        assertEquals("(415) 555", formatAsYouDial("415555"))
        assertEquals("(415) 555-0134", formatAsYouDial("4155550134"))
        assertEquals("(415) 555-0134", formatAsYouDial("14155550134"))
    }
}
