package com.loonext.android.features.compose

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * #507 Phase 1 — the wrap-up a crew member speaks after hanging up.
 *
 * Three things are checked, and they are the three that can quietly go wrong:
 * the gates that decide whether a recording is worth spending on, the wire
 * shape the route expects, and the copy — which is the one that would be a
 * PRODUCT failure rather than a bug. D117 draws the line at whose voice this
 * is, and a sentence implying we listen to calls would be false.
 */
class WrapUpDictationTest {

    // ----------------------------------------------------------------------
    // The gates. Client twins of shouldTranscribeWrapUp in
    // apps/api/src/ai/call-wrapup.ts — the server's copy is the one that
    // counts, these exist so a mis-tap never costs a round trip.
    // ----------------------------------------------------------------------

    @Test
    fun `elapsed seconds floor, because a part of a second is not speech`() {
        assertEquals(0, WrapUpDictation.elapsedSeconds(0))
        assertEquals(0, WrapUpDictation.elapsedSeconds(-5))
        assertEquals(0, WrapUpDictation.elapsedSeconds(999))
        assertEquals(1, WrapUpDictation.elapsedSeconds(1_000))
        assertEquals(7, WrapUpDictation.elapsedSeconds(7_800))
    }

    @Test
    fun `elapsed seconds clamp to the cap the recorder itself enforces`() {
        // A finger that stayed down past two minutes did not produce more than
        // two minutes of audio — MediaRecorder's own max-duration stopped it.
        // Reporting the hold instead of the file would hand the server a 121
        // and earn a `too_long` refusal for a recording that is exactly legal.
        assertEquals(
            WrapUpDictation.MAX_SECONDS,
            WrapUpDictation.elapsedSeconds(125_000),
        )
        assertEquals(
            WrapUpDictation.MAX_SECONDS,
            WrapUpDictation.elapsedSeconds(WrapUpDictation.MAX_SECONDS * 1000L),
        )
    }

    @Test
    fun `a brush of the button is never worth sending`() {
        assertFalse(WrapUpDictation.worthSending(seconds = 0, bytes = 4_000))
        // Both gates, because `seconds` is a claim about the audio and `bytes`
        // is a fact about the request — the server checks both for the same
        // reason.
        assertFalse(WrapUpDictation.worthSending(seconds = 12, bytes = 0))
    }

    @Test
    fun `a runaway is refused here rather than uploaded and refused there`() {
        assertFalse(
            WrapUpDictation.worthSending(
                seconds = WrapUpDictation.MAX_SECONDS + 1,
                bytes = 4_000,
            ),
        )
        assertFalse(
            WrapUpDictation.worthSending(
                seconds = 30,
                bytes = WrapUpDictation.MAX_BYTES + 1,
            ),
        )
        assertTrue(
            WrapUpDictation.worthSending(
                seconds = WrapUpDictation.MAX_SECONDS,
                bytes = WrapUpDictation.MAX_BYTES,
            ),
        )
        assertTrue(WrapUpDictation.worthSending(seconds = 18, bytes = 74_000))
    }

    @Test
    fun `the held-button counter reads as a clock`() {
        assertEquals("0:00", WrapUpDictation.elapsedLabel(0))
        assertEquals("0:07", WrapUpDictation.elapsedLabel(7))
        assertEquals("1:53", WrapUpDictation.elapsedLabel(113))
        assertEquals("2:00", WrapUpDictation.elapsedLabel(120))
    }

    // ----------------------------------------------------------------------
    // The copy.
    // ----------------------------------------------------------------------

    /** Every reason the route or the shared AI gate can hand back. */
    private val everyReason = listOf(
        "too_long",
        "disabled",
        "over_cap",
        "model_error",
        "unavailable",
        "unusable_output",
        // A reason string this client has never heard of — a server that grows
        // one must still produce a sentence, not an empty snackbar.
        "something_new",
        null,
    )

    @Test
    fun `each reason earns its own sentence`() {
        assertTrue(everyReason.all { wrapUpDictationMessage(it).isNotBlank() })
        // "disabled" and "over_cap" are the two a member can actually act on,
        // and one blanket sentence would hide both behind what reads as a
        // glitch.
        assertFalse(
            wrapUpDictationMessage("disabled") == wrapUpDictationMessage("over_cap"),
        )
        assertFalse(
            wrapUpDictationMessage("too_long") == wrapUpDictationMessage("model_error"),
        )
        assertTrue(wrapUpDictationMessage("disabled").contains("Settings"))
        assertTrue(wrapUpDictationMessage("over_cap").contains("next month"))
    }

    @Test
    fun `no failure sentence claims we heard the call`() {
        // D117 is the whole design: this is the member's own voice, about a
        // call that has ENDED. A string suggesting we listened to the call
        // would be false, and false in the direction that matters legally.
        val forbidden = listOf("listen", "the call", "recorded the", "your customer")
        for (reason in everyReason) {
            val sentence = wrapUpDictationMessage(reason).lowercase()
            for (word in forbidden) {
                assertFalse(
                    "\"$sentence\" must not say \"$word\" (reason=$reason)",
                    sentence.contains(word),
                )
            }
        }
    }

    @Test
    fun `every failure leaves the member somewhere they can still act`() {
        // Dictation is a shortcut, never a precondition. A sentence that only
        // says what broke leaves somebody staring at a composer wondering
        // whether the note is still possible — it always is.
        for (reason in everyReason) {
            val sentence = wrapUpDictationMessage(reason)
            assertTrue(
                "\"$sentence\" names no way forward (reason=$reason)",
                sentence.contains("type", ignoreCase = true) ||
                    sentence.contains("Settings"),
            )
        }
    }

    // ----------------------------------------------------------------------
    // The wire.
    // ----------------------------------------------------------------------

    private class FakeSessions : SessionSource {
        val flow = MutableStateFlow<Session?>(
            Session(
                accessToken = "token-1",
                refreshToken = "refresh-1",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "user-1",
                email = "a@b.c",
            ),
        )
        override val session = flow
        override suspend fun current(): Session? = flow.value
        override suspend fun save(session: Session) {
            flow.value = session
        }

        override suspend fun clear() {
            flow.value = null
        }
    }

    private lateinit var server: MockWebServer
    private lateinit var transcriber: WrapUpTranscriber

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        val baseUrl = server.url("/").toString().trimEnd('/')
        val api = ApiClient(
            http = OkHttpClient(),
            baseUrl = baseUrl,
            sessionStore = FakeSessions(),
            supabaseAuth = SupabaseAuth(
                client = OkHttpClient(),
                supabaseUrl = server.url("/gotrue").toString(),
                publishableKey = "pk",
            ),
        )
        transcriber = WrapUpTranscriber(api, baseUrl)
    }

    @After
    fun tearDown() {
        server.close()
    }

    @Test
    fun `posts the audio and the claimed length as multipart`() = runTest {
        server.enqueue(
            MockResponse(body = """{"text":"quoted him 2400 for the tank"}"""),
        )
        val written = transcriber.transcribe(
            companyId = "c1",
            conversationId = "cv1",
            audio = ByteArray(64) { it.toByte() },
            seconds = 18,
        )
        assertEquals("quoted him 2400 for the tank", written.text)
        assertNull(written.reason)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals(
            "/v1/conversations/cv1/wrap-up-transcript",
            recorded.url.encodedPath,
        )
        assertEquals("c1", recorded.headers["X-Company-Id"])
        assertTrue(recorded.headers["Content-Type"]?.startsWith("multipart/form-data") == true)
        val body = recorded.body?.utf8().orEmpty()
        // The two field names the route reads: anything else is a 422 that
        // would only ever show up on a real device.
        assertTrue(body.contains("name=\"seconds\""))
        assertTrue(body.contains("18"))
        assertTrue(body.contains("name=\"audio\""))
    }

    @Test
    fun `a refusal comes back as data, because it is an answer and not a fault`() = runTest {
        // The route returns 200 with {text:null, reason} for every gate it
        // owns. Treating that as an error would lose the reason, which is the
        // only thing that lets the composer say which of them it was.
        server.enqueue(MockResponse(body = """{"text":null,"reason":"over_cap"}"""))
        val written = transcriber.transcribe("c1", "cv1", ByteArray(16), 9)
        assertNull(written.text)
        assertEquals("over_cap", written.reason)
    }

    @Test
    fun `a refused request keeps the server's own sentence`() = runTest {
        // #106: the note level on the number is what this route requires, and
        // "you don't have access to this number" is truer than any reason
        // string this client could invent for it.
        server.enqueue(
            MockResponse(
                code = 403,
                body = """{"error":{"code":"forbidden","message":"No note access here."}}""",
            ),
        )
        val thrown = runCatching { transcriber.transcribe("c1", "cv1", ByteArray(16), 9) }
            .exceptionOrNull()
        assertTrue(thrown is ApiException)
        assertEquals("No note access here.", (thrown as ApiException).message)
    }
}
