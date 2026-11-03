package com.loonext.android.core.diag

import com.posthog.PostHogEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * D146: what a crash report carries to PostHog. The message is the part a
 * person wrote into; the frames are class and line names.
 */
class TelemetryTest {

    private fun exception(value: String): PostHogEvent = PostHogEvent(
        event = "\$exception",
        distinctId = "device",
        properties = mutableMapOf(
            "\$exception_list" to listOf(
                mapOf(
                    "type" to "IllegalStateException",
                    "value" to value,
                    "stacktrace" to mapOf("frames" to listOf(mapOf("function" to "send", "lineno" to 42))),
                ),
            ),
        ),
    )

    @Test
    fun `a thrown message leaves with its phone number and email address redacted`() {
        val out = Telemetry.scrubbed(exception("+16135551234 a@b.co"))

        @Suppress("UNCHECKED_CAST")
        val entry = (out.properties!!["\$exception_list"] as List<Map<String, Any>>).single()
        assertEquals("[phone redacted] [email redacted]", entry["value"])
        assertEquals("IllegalStateException", entry["type"])
        assertFalse(out.properties.toString().contains("6135551234"))
        assertFalse(out.properties.toString().contains("a@b.co"))
    }

    @Test
    fun `frames pass untouched, because they carry no data`() {
        val out = Telemetry.scrubbed(exception("boom"))

        @Suppress("UNCHECKED_CAST")
        val entry = (out.properties!!["\$exception_list"] as List<Map<String, Any>>).single()
        assertEquals(mapOf("frames" to listOf(mapOf("function" to "send", "lineno" to 42))), entry["stacktrace"])
    }

    @Test
    fun `any other event is returned as it came`() {
        val event = PostHogEvent(event = "\$screen", distinctId = "device", properties = mutableMapOf("x" to "+16135551234"))
        assertSame(event, Telemetry.scrubbed(event))
    }

    @Test
    fun `nothing is captured before setup`() {
        // No project key in a unit-test build, so setup never ran: a non-fatal
        // must be a silent no-op rather than a crash inside the crash path.
        assertFalse(Telemetry.isStarted)
        Telemetry.captureNonFatal("test", IllegalStateException("x"))
        assertFalse(Telemetry.isStarted)
    }

    @Test
    fun `a URL in a message loses its query string and a public link its token`() {
        assertEquals(
            "GET https://api.loonext.com/v1/contacts failed",
            Telemetry.scrubText("GET https://api.loonext.com/v1/contacts?address=eq.140+Maple+Ave failed"),
        )
        assertEquals(
            "404 at https://api.loonext.com/photos/[token]",
            Telemetry.scrubText("404 at https://api.loonext.com/photos/abcDEF123456abcDEF123456abcDEF123456abcDEF1?x=1"),
        )
        assertEquals("/pay/[token]", Telemetry.scrubText("/pay/Zm9vYmFyYmF6"))
    }
}
