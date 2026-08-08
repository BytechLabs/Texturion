package com.loonext.android.core.net

import com.loonext.android.core.diag.RecentErrors
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #555 — a decode failure may name the FIELD and never the value.
 *
 * ## The defect this exists for, which was mine
 *
 * The first version of the #555 fix recorded `cause.message` verbatim:
 *
 *     RecentErrors.record("decode $path: ${cause.message}")
 *
 * kotlinx.serialization appends the offending input to a `JsonDecodingException`
 * message — `"<reason>\nJSON input: <minified response>"` — so that line could
 * carry a customer's text, their name or their address. `RecentErrors.scrub`
 * removes phone-shaped digit runs and emails and nothing else, and the ring it
 * feeds is attached to the support email from Settings > Help. SPEC.md puts
 * message bodies, names and addresses out of bounds, and this walked straight
 * through it.
 *
 * The field name is the entire diagnostic. The value never was: knowing that
 * `spam_signals` arrived as a null is what fixes the bug, and knowing what the
 * customer wrote adds nothing to it.
 */
class DecodeSummaryTest {

    @Serializable
    private data class Fixture(val id: String, val count: Int)

    private val json = Json { ignoreUnknownKeys = true }

    /** A body shaped like a real one: a message a customer actually sent. */
    private val nosyBody = """
        {"id":"m-1","count":"not-a-number",
         "body":"call me at the Oakridge house, ask for Dana"}
    """.trimIndent()

    private fun thrownFor(payload: String): Throwable =
        runCatching { json.decodeFromString<Fixture>(payload) }.exceptionOrNull()
            ?: error("the fixture decoded when it was supposed to fail")

    @Test
    fun `the raw exception message really does carry the response body`() {
        // Not assumed — this is the premise the rest of the file rests on, so if
        // kotlinx ever stops doing it, this test says so rather than quietly
        // guarding nothing.
        val raw = thrownFor(nosyBody).message ?: ""
        assertTrue(
            "kotlinx no longer appends the input; re-read this file's premise",
            raw.contains("Oakridge") || raw.contains("JSON input"),
        )
    }

    @Test
    fun `the summary keeps the diagnosis and drops the customer's words`() {
        val summary = decodeSummary(thrownFor(nosyBody))
        assertFalse("the customer's message body leaked", summary.contains("Oakridge"))
        assertFalse("their name leaked", summary.contains("Dana"))
        assertFalse("the raw input block leaked", summary.contains("JSON input"))
        // And it still says something useful about WHAT failed.
        assertTrue("the summary says nothing at all: $summary", summary.isNotBlank())
    }

    @Test
    fun `a missing field is named, because the name is the whole diagnosis`() {
        // The most common shape, and the one worth optimising for: knowing which
        // field the server stopped sending is the fix.
        val summary = decodeSummary(thrownFor("""{"id":"m-1"}"""))
        assertTrue("the missing field is not named: $summary", summary.contains("count"))
    }

    @Test
    fun `what reaches the ring survives its own scrubber intact`() {
        // The end-to-end property. `scrub` truncates at 160 characters, so a
        // summary that started with a long raw dump would arrive with the useful
        // half cut off even when it carried no customer content.
        val line = "decode GET /v1/conversations/abc " + decodeSummary(thrownFor(nosyBody))
        val scrubbed = RecentErrors.scrub(line)
        assertFalse(scrubbed.contains("Oakridge"))
        assertTrue("the route was truncated away: $scrubbed", scrubbed.contains("/v1/conversations"))
    }
}
