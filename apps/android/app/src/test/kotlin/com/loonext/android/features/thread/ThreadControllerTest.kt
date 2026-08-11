package com.loonext.android.features.thread

import android.content.Context
import android.content.ContextWrapper
import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.data.MeRepository
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ConversationDetailContact
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import com.loonext.android.core.model.OPT_OUT_SOURCE_STOP
import com.loonext.android.core.model.Page
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.realtime.RealtimeEvent
import com.loonext.android.features.compose.NoteFileUploader
import com.loonext.android.ui.common.LoadState
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

/**
 * #215 Part A: the resync-on-foreground safety net is wired to
 * [ThreadController.refreshAfterReconnect] on ON_RESUME. That method must
 * (a) recover a page-1 message that exists server-side but for which NO realtime
 * event ever fired (the dropped-frame it heals), and (b) MERGE rather than
 * replace — since foregrounding is frequent, a user who scrolled back must keep
 * their loaded pages across every pause/resume and socket re-JOIN.
 *
 * #247 also lives here, for the two things ThreadSummaryCardTest cannot see.
 * Both are about the same fact — the customer's carrier standing — surviving a
 * press of "try again", and both are properties of a coroutine and a piece of
 * mutable state rather than of a pure rule:
 *
 *   in flight   the warning survives only because this controller does NOT
 *               clear [ThreadController.summary] before sending the next
 *               request. A "tidy-up" that blanked the field first would put the
 *               customer's STOP back in the hole it was just dug out of with
 *               every pure test still green.
 *   and after   the warning survives a press that FAILS only because this
 *               controller reads the standing off the answer on screen and
 *               hands it to the repository, which is the one thing that can put
 *               an `opt_outs` read on a refusal no server sent.
 */
class ThreadControllerTest {

    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope

    /** Response encoder — the exact client Json config, so bodies round-trip. */
    private val respJson = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    /** The conversation's page 1 as the server currently sees it (swappable). */
    @Volatile
    private var serverDetail: ConversationDetail =
        detailWith(listOf(msg("m2", T2)), nextCursor = OLDER_CURSOR)

    /** The one older page reachable behind [OLDER_CURSOR]. */
    private val olderPage = Page(data = listOf(msg("m1", T1)), next_cursor = null)

    /** What POST /summary answers with. Raw JSON, so a test writes a wire shape. */
    @Volatile
    private var summaryBody = """{"lines":[]}"""

    /**
     * The status POST /summary answers with. 200 unless a test is about the
     * press that does NOT get through — the case where the repository writes the
     * refusal itself and there is no body for the carrier fields to ride on.
     */
    @Volatile
    private var summaryStatus = 200

    /** Set to hold the next POST /summary open; null lets it answer at once. */
    private val summaryGate = AtomicReference<CountDownLatch?>(null)

    /** #607: how many times the audit timeline has been read from the server. */
    private val eventFetches = AtomicInteger(0)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val url = request.url
                val path = url.encodedPath
                return when {
                    // GET /v1/conversations/c1 gates the thread and carries the
                    // embedded first page of messages the controller renders.
                    request.method == "GET" && path == "/v1/conversations/c1" ->
                        MockResponse(code = 200, body = respJson.encodeToString(serverDetail))

                    // The one older page, reached via the cursor.
                    request.method == "GET" &&
                        path == "/v1/conversations/c1/messages" &&
                        url.queryParameter("cursor") == OLDER_CURSOR ->
                        MockResponse(code = 200, body = respJson.encodeToString(olderPage))

                    // #247's catch-up. Held open by [summaryGate] when a test
                    // needs the in-flight window to be observable at all —
                    // without it the second ask starts and finishes between two
                    // statements and there is nothing to look at.
                    request.method == "POST" && path == "/v1/conversations/c1/summary" -> {
                        summaryGate.get()?.await(5, TimeUnit.SECONDS)
                        MockResponse(code = summaryStatus, body = summaryBody)
                    }

                    // #607: counted, because the audit timeline re-reading is
                    // the whole observable effect of a payment frame.
                    request.method == "GET" && path == "/v1/conversations/c1/events" -> {
                        eventFetches.incrementAndGet()
                        MockResponse(code = 200, body = """{"data":[]}""")
                    }

                    // Every other secondary read is refetched inside runCatching,
                    // so an empty page (or a decode miss) is tolerated by design.
                    else -> MockResponse(code = 200, body = """{"data":[]}""")
                }
            }
        }
        server.start()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    @Test
    fun `refreshAfterReconnect heals a missed message while keeping scrollback`() {
        val controller = controller()
        controller.start()

        // Initial load paints page 1 (m2) with an older page still to fetch.
        awaitUntil { controller.load is LoadState.Ready && ids(controller) == listOf("m2") }

        // The user scrolls back and loads the older page (m1).
        controller.loadOlderMessages()
        awaitUntil { ids(controller) == listOf("m2", "m1") }

        // A new inbound message lands server-side on page 1 — but NO realtime
        // event fires (the dropped-frame scenario), so the open thread is
        // unchanged for now.
        serverDetail = detailWith(listOf(msg("m3", T3), msg("m2", T2)), nextCursor = OLDER_CURSOR)
        assertEquals(listOf("m2", "m1"), ids(controller))

        // The ON_RESUME target runs. It must MERGE: m3 heals in AND the loaded
        // scrollback (m1) survives — replacing with page 1 would have dropped m1.
        controller.refreshAfterReconnect()
        awaitUntil { ids(controller).contains("m3") }
        assertEquals(listOf("m3", "m2", "m1"), ids(controller))
    }

    /**
     * #247 — the customer's STOP is still on the card while the re-ask is in
     * flight.
     *
     * THE DEFECT, in the order a person lives it: a refusal comes back carrying
     * the contact's standing, the card says texts are blocked, they press "try
     * again" — and the warning goes. It is absent for as long as the request
     * takes, which is precisely the stretch in which somebody stops reading the
     * card and starts acting. A warning that disappears when you touch something
     * is one a person concludes they imagined.
     *
     * Driven through the whole stack rather than through [catchUpState] alone,
     * because the pure rule can only hold the half of this that is a rule. The
     * other half is that [ThreadController.askForSummary] leaves `summary`
     * standing while it awaits — no `= null` first, which reads like an
     * innocuous tidy-up and is the entire defect.
     */
    @Test
    fun `a re-ask keeps the customer's STOP on screen while it is in flight`() {
        val controller = controller()
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }

        // A refusal that carries the contact's standing — the shape the route
        // sends most, since `opt_out` rides on every answer including the
        // refusals. `model_error` because it is a reason the card offers a
        // second press on; an unfixable one could never reach this window.
        summaryBody = """{"lines":[],"reason":"model_error","opt_out":""" +
            """{"source":"$OPT_OUT_SOURCE_STOP","at":"$T1"}}"""
        controller.askForSummary()
        awaitUntil { !controller.summarizing && controller.summary != null }
        val shown = noteOnScreen(controller)
        assertNotNull("the refusal never carried the STOP to begin with", shown)

        // The press. The gate holds the server mid-answer so the in-flight card
        // can be read at all.
        val gate = CountDownLatch(1)
        summaryGate.set(gate)
        controller.askForSummary()
        awaitUntil { controller.summarizing }
        assertEquals(
            "the customer's STOP came off the card the instant somebody pressed " +
                "'try again' and stayed off for the length of the request — the " +
                "one fact here that a hurried reader must not miss, missing at " +
                "the one moment they are acting on it",
            shown,
            noteOnScreen(controller),
        )

        gate.countDown()
        summaryGate.set(null)
        awaitUntil { !controller.summarizing }
        assertEquals("the answer that landed lost it again", shown, noteOnScreen(controller))
    }

    /**
     * #247 — and the press that never reaches the server.
     *
     * THE SAME DEFECT ONE STEP LATER, and the worse half of it. The test above
     * covers the window while a re-ask is in flight; this one covers what lands
     * at the end of it when the request failed. The route puts `opt_out` on
     * every answer it sends, so there was no answer here to put it on — the
     * repository writes the refusal itself, it used to write it with both
     * carrier fields empty, and that refusal REPLACES the one that carried the
     * fact. The warning came back for the length of the spinner and then went
     * for good, which is a card that has settled on saying nothing.
     *
     * Driven through the controller because that is where the standing is read:
     * `askForSummary` takes it off the answer on screen at the press and hands
     * it to the repository. A pure test of either half passes with the two ends
     * unconnected.
     */
    @Test
    fun `a re-ask the server never answers still says the texts are blocked`() {
        val controller = controller()
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }

        // A refusal the ROUTE sent, carrying the contact's standing. Its reason
        // is one of the eight only a server body can carry, which is what makes
        // it distinguishable from the one this client writes below.
        summaryBody = """{"lines":[],"reason":"unusable_output","opt_out":""" +
            """{"source":"$OPT_OUT_SOURCE_STOP","at":"$T1"}}"""
        controller.askForSummary()
        awaitUntil { !controller.summarizing && controller.summary != null }
        val shown = noteOnScreen(controller)
        assertNotNull("the refusal never carried the STOP to begin with", shown)

        // The press that does not get through. A 500 with no error envelope on
        // it, so there is nothing for the client to decode and nothing for the
        // carrier fields to ride in on.
        //
        // Waiting on `summarizing` rather than on the summary changing, because
        // it cannot be watched for a change: `askForSummary` sets the flag
        // before it suspends, and the refusal that lands is — by design — equal
        // to the answer it replaces wherever the reader can tell. Compose's
        // state does not even rewrite the reference.
        summaryStatus = 500
        summaryBody = "boom"
        controller.askForSummary()
        awaitUntil { !controller.summarizing }
        assertEquals(
            "the press did not actually fail, so this test proves nothing",
            threadSummaryReasonFor(ApiErrorCode.INTERNAL_ERROR),
            controller.summary?.reason,
        )
        assertEquals(
            "the request failed and the workspace stopped being told its texts " +
                "are blocked — not for the length of the press, but from then on, " +
                "because the refusal this client wrote replaced the answer that " +
                "carried the fact and carried none of it",
            shown,
            noteOnScreen(controller),
        )
    }

    /**
     * #607 — a payment frame re-reads the audit timeline on the open thread.
     *
     * The strip above the composer has its own read (ThreadPayments), and this is
     * the OTHER half of the same insert: `stripe-connect.ts` writes one
     * `conversation_events` row, and it is both the money and a line of history.
     * A wiring that refreshed only the strip would put "Paid" above a transcript
     * that still had nothing to say about it until the next fetch.
     *
     * Driven through [ThreadController.onRealtime] rather than through
     * [paymentMovedOnThread], which already has the rule under vectors: what can
     * be wrong HERE is that nothing calls it — a `when` with no arm for this
     * event compiles, runs, and silently does nothing at all.
     */
    @Test
    fun `a payment frame re-reads the thread's audit timeline`() {
        val controller = controller()
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }
        // The opening reads have to be finished before a baseline means anything.
        awaitUntil { eventFetches.get() > 0 }
        val before = eventFetches.get()

        controller.onRealtime(
            RealtimeEvent(
                PAYMENT_UPDATED,
                buildJsonObject {
                    put("conversation_id", "c1")
                    put("payment_request_id", "pr-1")
                    put("type", "payment_paid")
                },
            ),
        )

        awaitUntil { eventFetches.get() > before }
    }

    // --- Harness --------------------------------------------------------------

    /**
     * The carrier line the card would be drawing right now, from the two pieces
     * of controller state ThreadScreen feeds it.
     *
     * Mirrors the call site rather than reaching past it: `offered` is true
     * because this thread is being asked about, and the other two are read live
     * so the assertion is about the controller and not about a fixture.
     */
    private fun noteOnScreen(c: ThreadController): String? =
        catchUpCarrierNote(catchUpState(offered = true, reading = c.summarizing, summary = c.summary))

    private fun controller(): ThreadController {
        val api = ApiClient(
            http = OkHttpClient(),
            baseUrl = server.url("/").toString().trimEnd('/'),
            sessionStore = FakeSessions(liveSession()),
            supabaseAuth = SupabaseAuth(
                client = OkHttpClient(),
                supabaseUrl = server.url("/").toString().trimEnd('/'),
                publishableKey = "pk",
            ),
        )
        // A never-dereferenced Context: the controller only touches appContext
        // in saveNote, which this test never exercises. ContextWrapper(null) is
        // a concrete Context that constructs without the android.test stubs.
        val ctx: Context = ContextWrapper(null)
        return ThreadController(
            repo = MessagingRepository(api),
            meRepo = MeRepository(api),
            uploader = NoteFileUploader(api, "http://localhost"),
            appContext = ctx,
            cache = StoreCache(),
            companyId = "co1",
            conversationId = "c1",
            meUserId = "u1",
            scope = scope,
        )
    }

    private fun ids(c: ThreadController) = c.messages.map { it.id }

    private fun awaitUntil(timeoutMs: Long = 5_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(10)
        }
        throw AssertionError("condition not met within ${timeoutMs}ms")
    }

    private companion object {
        private const val OLDER_CURSOR = "older-1"
        private const val T1 = "2026-07-15T10:00:00Z"
        private const val T2 = "2026-07-15T10:05:00Z"
        private const val T3 = "2026-07-15T10:10:00Z"

        private fun msg(id: String, at: String) = Message(
            id = id,
            conversation_id = "c1",
            direction = MessageDirection.INBOUND,
            body = "body $id",
            status = MessageStatus.RECEIVED,
            created_at = at,
        )

        private fun detailWith(messages: List<Message>, nextCursor: String?) = ConversationDetail(
            id = "c1",
            company_id = "co1",
            contact_id = "ct1",
            phone_number_id = "pn1",
            status = "open",
            is_spam = false,
            last_message_at = messages.first().created_at,
            created_at = "2026-07-01T00:00:00Z",
            updated_at = "2026-07-01T00:00:00Z",
            contact = ConversationDetailContact(id = "ct1", phone_e164 = "+15555550100"),
            messages = Page(data = messages, next_cursor = nextCursor),
        )

        private fun liveSession() = Session(
            accessToken = "token-1",
            refreshToken = "refresh-1",
            expiresAt = System.currentTimeMillis() / 1000 + 3600,
            userId = "u1",
            email = "a@b.c",
        )
    }

    private class FakeSessions(initial: Session?) : SessionSource {
        private val flow = MutableStateFlow(initial)
        override val session = flow
        override suspend fun current(): Session? = flow.value
        override suspend fun save(session: Session) {
            flow.value = session
        }

        override suspend fun clear() {
            flow.value = null
        }
    }
}
