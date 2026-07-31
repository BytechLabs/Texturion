package com.loonext.android.core.realtime

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #302 — the presence rule and the frames it is fed.
 *
 * THE FIXTURES ARE REAL FRAMES. They were captured off the working web client's
 * socket with two signed-in browsers on one conversation, so what is parsed here
 * is what the server actually sends — not a shape somebody assumed. That matters
 * more than usual: this socket layer cannot be run on the build machine, so the
 * only thing standing between a wrong assumption and a silent feature is this
 * file.
 *
 * The viewer rules mirror packages/shared/src/presence.test.ts case for case.
 */
class PresenceLogicTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun obj(text: String): JsonObject = json.parseToJsonElement(text) as JsonObject

    private val NOW = 1_785_479_341_479L
    private val CONV = "b0000000-0000-4000-8000-000000000005"
    private val ME = "me"

    /** A verbatim `presence_diff` join, as captured. */
    private fun joinFrame(
        user: String = "f7ffafbb-f7e2-48df-9361-95f7672d2871",
        name: String = "Dana Brightside",
        conv: String = CONV,
        at: Long = NOW,
        typing: Boolean = false,
    ) = obj(
        """
        {"joins":{"$user":{"metas":[{"phx_ref":"GMdMAE99-QdZ7-mB","at":$at,
          "conversation_id":"$conv","display_name":"$name","typing":$typing,
          "user_id":"$user"}]}},"leaves":{}}
        """.trimIndent(),
    )

    @Test
    fun `an empty presence_state is an empty room, not a parse failure`() {
        // The server's FIRST frame on a fresh topic is literally `{}`.
        assertEquals(emptyMap<String, List<PresenceEntry>>(), applyPresenceState(obj("{}")))
    }

    @Test
    fun `presence_state parses the captured meta shape`() {
        val map = applyPresenceState(
            obj(
                """
                {"f7ffafbb-f7e2-48df-9361-95f7672d2871":{"metas":[
                  {"phx_ref":"GMdMAE99-QdZ7-mB","at":$NOW,
                   "conversation_id":"$CONV","display_name":"Dana Brightside",
                   "typing":false,"user_id":"f7ffafbb-f7e2-48df-9361-95f7672d2871"}]}}
                """.trimIndent(),
            ),
        )
        val entries = presenceEntries(map)
        assertEquals(1, entries.size)
        assertEquals("Dana Brightside", entries[0].displayName)
        assertEquals(CONV, entries[0].conversationId)
        assertEquals(NOW, entries[0].at)
    }

    @Test
    fun `a diff adds and removes`() {
        var map = applyPresenceDiff(emptyMap(), joinFrame(user = "sam", name = "Sam"))
        assertEquals(1, presenceEntries(map).size)
        map = applyPresenceDiff(map, obj("""{"joins":{},"leaves":{"sam":{"metas":[]}}}"""))
        assertTrue(presenceEntries(map).isEmpty())
    }

    @Test
    fun `a rejoin in ONE diff does not blink the person out`() {
        // A token refresh arrives as a leave of the old ref and a join of the
        // new one, and both can land in the same frame. Applying leaves last
        // would delete the key the joins half just re-established.
        val map = applyPresenceDiff(
            emptyMap(),
            obj(
                """
                {"joins":{"sam":{"metas":[{"phx_ref":"new","at":$NOW,
                   "conversation_id":"$CONV","display_name":"Sam","typing":false,
                   "user_id":"sam"}]}},
                 "leaves":{"sam":{"metas":[{"phx_ref":"old","at":${NOW - 1000},
                   "conversation_id":"$CONV","display_name":"Sam","typing":false,
                   "user_id":"sam"}]}}}
                """.trimIndent(),
            ),
        )
        assertEquals(1, presenceEntries(map).size)
    }

    @Test
    fun `a malformed meta never takes the whole frame down`() {
        // The socket layer cannot afford to throw on a payload it did not
        // expect: one bad frame would kill presence for the session.
        val map = applyPresenceState(
            obj("""{"sam":{"metas":[{"phx_ref":"x"}]},"dale":{"nope":1}}"""),
        )
        assertTrue(presenceEntries(map).isEmpty())
        // …and the keys survive, so a later `leaves` can still find them.
        assertEquals(setOf("sam", "dale"), map.keys)
    }

    private fun entry(
        user: String = "sam",
        name: String = "Sam",
        conv: String = CONV,
        at: Long = NOW,
        typing: Boolean = false,
    ) = PresenceEntry(user, name, conv, at, typing)

    @Test
    fun `reports a teammate and never yourself`() {
        assertEquals(1, viewersOf(listOf(entry()), CONV, ME, NOW, true).size)
        assertTrue(viewersOf(listOf(entry(user = ME)), CONV, ME, NOW, true).isEmpty())
    }

    @Test
    fun `ignores another conversation, and anything past the TTL`() {
        assertTrue(viewersOf(listOf(entry(conv = "other")), CONV, ME, NOW, true).isEmpty())
        assertTrue(
            viewersOf(listOf(entry(at = NOW - PRESENCE_TTL_MS - 1)), CONV, ME, NOW, true).isEmpty(),
        )
    }

    @Test
    fun `refuses a clock from the future rather than trusting it forever`() {
        // Otherwise a phone set wrong pins a ghost to the thread until a reload.
        assertTrue(
            viewersOf(listOf(entry(at = NOW + PRESENCE_TTL_MS * 4)), CONV, ME, NOW, true).isEmpty(),
        )
    }

    @Test
    fun `an unhealthy connection reports NOTHING, not the last thing it heard`() {
        assertTrue(viewersOf(listOf(entry()), CONV, ME, NOW, false).isEmpty())
    }

    @Test
    fun `one person on two devices collapses, and typing on either counts`() {
        val viewers = viewersOf(
            listOf(entry(at = NOW - 1000, typing = false), entry(at = NOW - 3000, typing = true)),
            CONV, ME, NOW, true,
        )
        assertEquals(1, viewers.size)
        assertTrue(viewers[0].typing)
    }

    @Test
    fun `typing expires without dropping the person`() {
        val viewers = viewersOf(
            listOf(entry(at = NOW - TYPING_TTL_MS - 1000, typing = true)),
            CONV, ME, NOW, true,
        )
        assertEquals(1, viewers.size)
        assertTrue(!viewers[0].typing)
    }

    @Test
    fun `falls back to a name rather than rendering an empty one`() {
        assertEquals(
            "A teammate",
            viewersOf(listOf(entry(name = "   ")), CONV, ME, NOW, true)[0].displayName,
        )
    }

    @Test
    fun `the label matches the shared wording exactly`() {
        // Three clients, one sentence. A divergence here is a divergence the
        // crew sees when they switch devices.
        fun v(name: String, typing: Boolean = false) = Viewer(name.lowercase(), name, typing)
        assertNull(presenceLabel(emptyList()))
        assertEquals("Sam is also here", presenceLabel(listOf(v("Sam"))))
        assertEquals(
            "Sam and Dale are also here",
            presenceLabel(listOf(v("Sam"), v("Dale"))),
        )
        assertEquals(
            "3 teammates are also here",
            presenceLabel(listOf(v("Sam"), v("Dale"), v("Ann"))),
        )
        assertEquals(
            "Sam is replying…",
            presenceLabel(listOf(v("Sam", true), v("Dale"))),
        )
        assertEquals(
            "Sam and Dale are replying…",
            presenceLabel(listOf(v("Sam", true), v("Dale", true))),
        )
        assertEquals(
            "3 people are replying…",
            presenceLabel(listOf(v("Sam", true), v("Dale", true), v("Ann", true))),
        )
    }
}
