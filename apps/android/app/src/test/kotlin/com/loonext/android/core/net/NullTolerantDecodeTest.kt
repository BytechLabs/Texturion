package com.loonext.android.core.net

import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Task
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #555 / #549 — an explicit `null` from the server must not blank a screen.
 *
 * ## The bug this exists for
 *
 * The founder tapped a call entry and got "Something went wrong, try again". The
 * tap opens the CONVERSATION, whose first read is `GET /v1/conversations/:id`,
 * and that response carries `spam_signals` — a nullable jsonb column with no
 * default, so PostgREST emits an explicit `null` for every thread the spam
 * classifier has not scored, which is most of them.
 *
 * `ConversationDetail.spam_signals` is `List<SpamSignal> = emptyList()`. kotlinx
 * .serialization tolerates a MISSING key (the default applies) and **throws on an
 * explicit null** unless the property is nullable or `coerceInputValues` is on.
 * It was off. So the decode threw `ApiDecodeException`, which does not extend
 * `ApiException`, so `Throwable.userMessage()` fell through to the generic string
 * and discarded the reason. One nullable column, one blank screen, no diagnosis.
 *
 * ## Why this is a config test and not a field test
 *
 * `spam_signals` is one instance of about two hundred. Every `List<X> =
 * emptyList()`, `Int = 0`, `Boolean = false` and `Double = 0.0` in the model layer
 * has the same exposure, and nothing in CI can see which server columns are
 * nullable. Naming the fields one at a time is a list that goes stale; asserting
 * the DECODER tolerates null is the property that covers all of them at once.
 *
 * The pinned fields below are chosen because each is a real nullable column
 * reached from a screen the founder uses, not to enumerate the class.
 */
class NullTolerantDecodeTest {

    /** The decoder the app actually uses. Kept in step by the test below. */
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }

    @Test
    fun `the app's own decoder is configured the way this test assumes`() {
        // Otherwise this file asserts a property of a decoder nobody uses. Read
        // out of the real source rather than trusted, because the whole defect
        // was a config flag nobody noticed was missing.
        val source = repoText(
            "apps/android/app/src/main/kotlin/com/loonext/android/core/net/ApiClient.kt",
        )
        val config = source.substringAfter("val json = Json {").substringBefore("}")
        assertTrue(
            "ApiClient's Json must set coerceInputValues, or an explicit null from " +
                "a nullable column blanks the screen again (#555)",
            config.contains("coerceInputValues = true"),
        )
    }

    @Test
    fun `a conversation with an unscored spam column still opens`() {
        // THE FOUNDER'S BUG (#549), as the wire actually delivers it.
        val payload = """
            {"id":"c-1","company_id":"co-1","contact_id":"ct-1",
             "phone_number_id":"pn-1","status":"open","is_spam":false,
             "last_message_at":"2026-08-08T00:00:00Z",
             "created_at":"2026-08-08T00:00:00Z","updated_at":"2026-08-08T00:00:00Z",
             "contact":{"id":"ct-1","phone_e164":"+14165550123"},
             "messages":{"data":[]},
             "spam_signals":null,"spam_suspected_at":null}
        """.trimIndent()
        val detail = json.decodeFromString<ConversationDetail>(payload)
        assertEquals(emptyList<Any>(), detail.spam_signals)
    }

    @Test
    fun `an explicit null lands on the declared default, not on a throw`() {
        // The general property on a non-nullable String with a default, one of the
        // four shapes the model layer is full of. If this throws, the class is back.
        val payload = """
            {"id":"t-1","company_id":"co-1","conversation_id":"c-1","message_id":"m-1",
             "title":"Fix the boiler","description":null,
             "created_by_user_id":"u-1","created_at":"2026-08-08T00:00:00Z",
             "updated_at":"2026-08-08T00:00:00Z"}
        """.trimIndent()
        val task = json.decodeFromString<Task>(payload)
        // `description` is `String = ""` — non-nullable with a default, which is
        // the exact shape that throws on an explicit null without coercion.
        // `attachment_count` is deliberately NOT asserted here: it is `Int? = null`
        // and was always null-tolerant, so it would prove nothing.
        assertEquals("", task.description)
    }

    @Test
    fun `a for-you payload with every section nulled still decodes`() {
        // The home screen. Its sections are lists with defaults, and a Worker that
        // omits one sends a missing key while a SQL function that returns SQL NULL
        // sends an explicit null — the two are not the same to this decoder, and
        // only one of them used to work.
        val payload = """
            {"waiting_on_you":null,"my_tasks":null,"unread":null,"triage":null}
        """.trimIndent()
        val forYou = json.decodeFromString<ForYou>(payload)
        assertTrue(forYou.waiting_on_you.isEmpty())
        assertTrue(forYou.my_tasks.isEmpty())
        assertTrue(forYou.unread.isEmpty())
    }

    @Test
    fun `a missing key still works, which is what already worked`() {
        // The positive control. Coercion must not have been bought by breaking the
        // case that was fine, and a decoder that accepted null by accepting
        // anything would also pass the tests above.
        val detail = json.decodeFromString<ConversationDetail>(
            """{"id":"c-1","company_id":"co-1","contact_id":"ct-1",
                "phone_number_id":"pn-1","status":"open","is_spam":false,
                "last_message_at":"2026-08-08T00:00:00Z",
                "created_at":"2026-08-08T00:00:00Z","updated_at":"2026-08-08T00:00:00Z",
                "contact":{"id":"ct-1","phone_e164":"+14165550123"},
                "messages":{"data":[]}}""",
        )
        assertEquals(emptyList<Any>(), detail.spam_signals)
    }

    private fun repoText(relative: String): String {
        var dir: java.io.File? = java.io.File("").absoluteFile
        while (dir != null) {
            val candidate = java.io.File(dir, relative)
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${java.io.File("").absolutePath}")
    }
}
