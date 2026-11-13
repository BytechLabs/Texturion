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

    /** #718: every message read that named an anchor or a direction, as its raw query. */
    private val anchoredQueries = java.util.concurrent.CopyOnWriteArrayList<String>()

    /** #718: what the anchored window, the newer page and the page older than the window answer. */
    @Volatile
    private var aroundBody = ""

    @Volatile
    private var newerBody = ""

    @Volatile
    private var windowOlderBody = ""

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

    /** #696: what GET /v1/blocked-senders answers with, as the raw `data` array. */
    @Volatile
    private var blockedRows = "[]"

    /** #696: the body of the last POST /v1/blocked-senders, and the last DELETE path. */
    private val blockPosted = AtomicReference<String?>(null)
    private val unblockedPath = AtomicReference<String?>(null)

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

                    // #718: the window around a message, and its two cursors.
                    request.method == "GET" &&
                        path == "/v1/conversations/c1/messages" &&
                        url.queryParameter("around") != null -> {
                        anchoredQueries.add(url.query ?: "")
                        MockResponse(code = 200, body = aroundBody)
                    }

                    request.method == "GET" &&
                        path == "/v1/conversations/c1/messages" &&
                        url.queryParameter("direction") == "newer" -> {
                        anchoredQueries.add(url.query ?: "")
                        MockResponse(code = 200, body = newerBody)
                    }

                    request.method == "GET" &&
                        path == "/v1/conversations/c1/messages" &&
                        url.queryParameter("cursor") == WINDOW_OLDER_CURSOR ->
                        MockResponse(code = 200, body = windowOlderBody)

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

                    // #724: the created task, whose id Open has to carry.
                    request.method == "POST" && path == "/v1/tasks" ->
                        MockResponse(
                            code = 201,
                            body = """{"id":"t-new","company_id":"co1","message_id":"m2","title":"Call back",""" +
                                """"created_by_user_id":"u1","created_at":"$T1","updated_at":"$T1"}""",
                        )

                    request.method == "GET" && path == "/v1/blocked-senders" ->
                        MockResponse(code = 200, body = """{"data":$blockedRows}""")

                    request.method == "POST" && path == "/v1/blocked-senders" -> {
                        blockPosted.set(request.body?.utf8())
                        MockResponse(
                            code = 201,
                            body = """{"id":"b1","phone_e164":"+15555550100","created_at":"2026-07-15T10:00:00Z"}""",
                        )
                    }

                    request.method == "DELETE" && path.startsWith("/v1/blocked-senders/") -> {
                        unblockedPath.set(path)
                        MockResponse(code = 204)
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
     * #718: opening a thread at an old message asks the server for the window
     * around it, then pages both ways. The newest page must not be merged into
     * that window while it stops short of it, or the list would have a hole.
     */
    @Test
    fun `opening at an old message loads only its window and pages both ways`() {
        aroundBody = """{"data":[${wire("m6", T3)},${wire("m5", T2)},${wire("m4", T1)}],""" +
            """"next_cursor":"$WINDOW_OLDER_CURSOR","newer_cursor":"$WINDOW_NEWER_CURSOR","anchor_id":"m5"}"""
        newerBody = """{"data":[${wire("m9", T3)},${wire("m8", T3)},${wire("m7", T3)}],""" +
            """"next_cursor":"x","newer_cursor":null}"""
        windowOlderBody = """{"data":[${wire("m3", T1)}],"next_cursor":null}"""
        val controller = controller()
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }

        assertEquals(true, runBlockingEnsure(controller, "m5"))
        assertEquals(listOf("m6", "m5", "m4"), ids(controller))
        assertEquals(true, controller.awayFromNewest)
        assertEquals(1, anchoredQueries.size)
        assertEquals(true, anchoredQueries.single().contains("around=m5"))

        // The newest page landing while we sit in the window must not splice in.
        controller.refreshAfterReconnect()
        Thread.sleep(300)
        assertEquals(listOf("m6", "m5", "m4"), ids(controller))

        // Older continues from the window's own cursor.
        controller.loadOlderMessages()
        awaitUntil { ids(controller) == listOf("m6", "m5", "m4", "m3") }

        // Newer pages toward the newest and closes the window.
        controller.loadNewerMessages()
        awaitUntil { !controller.awayFromNewest }
        assertEquals(listOf("m9", "m8", "m7", "m6", "m5", "m4", "m3"), ids(controller))
        assertEquals(true, anchoredQueries.last().contains("direction=newer"))
        assertEquals(true, anchoredQueries.last().contains("cursor=$WINDOW_NEWER_CURSOR"))
    }

    @Test
    fun `an anchor that is gone leaves the thread at the newest with a note`() {
        aroundBody = """{"data":[${wire("m2", T2)}],"next_cursor":"$OLDER_CURSOR","newer_cursor":null,""" +
            """"anchor_id":null,"anchor_missing":true}"""
        val controller = controller()
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }

        assertEquals(false, runBlockingEnsure(controller, "gone"))
        assertEquals(listOf("m2"), ids(controller))
        assertEquals(false, controller.awayFromNewest)
        assertEquals("That message is no longer here.", controller.notice?.text)
    }

    private fun runBlockingEnsure(c: ThreadController, id: String): Boolean =
        kotlinx.coroutines.runBlocking { c.ensureMessageLoaded(id) }

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
    /**
     * #724: making a task from a message confirms with an Open that goes to the
     * task that was just created, not to the thread or to a list.
     */
    @Test
    fun `task created from a message offers Open on that task`() {
        val controller = controller()
        val opened = AtomicReference<String?>(null)
        controller.onOpenTask = { opened.set(it) }
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }

        controller.makeTask(msg("m2", T2), "Call back")
        awaitUntil { controller.notice?.text == "Task created." }

        val notice = controller.notice!!
        assertEquals("Open", notice.actionLabel)
        notice.action!!.invoke()
        assertEquals("t-new", opened.get())
    }

    /** With nowhere to go (no task screen wired), the confirmation stays plain. */
    @Test
    fun `task created with no task screen has no Open`() {
        val controller = controller()
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }

        controller.makeTask(msg("m2", T2), "Call back")
        awaitUntil { controller.notice?.text == "Task created." }

        assertEquals(null, controller.notice!!.actionLabel)
    }

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

    /**
     * #696 — block and unblock from the thread.
     *
     * The wire is what can be wrong here: the block carries the thread's own
     * E.164 number, and the unblock names the list row's id, not the number.
     */
    @Test
    fun `blocking posts the thread's number and unblocking deletes the row`() {
        val controller = controller()
        controller.start()
        awaitUntil { controller.load is LoadState.Ready }
        assertEquals(null, controller.blockedSender)

        controller.blockNumber()
        awaitUntil { controller.blockedSender != null }
        assertEquals("""{"phone_e164":"+15555550100"}""", blockPosted.get())

        controller.unblockNumber()
        awaitUntil { controller.blockedSender == null }
        assertEquals("/v1/blocked-senders/b1", unblockedPath.get())
    }

    @Test
    fun `a thread whose number is already blocked opens as blocked`() {
        blockedRows = """[{"id":"b9","phone_e164":"+15555550100","created_at":"2026-07-15T10:00:00Z"}]"""
        val controller = controller()
        controller.start()
        awaitUntil { controller.blockedSender?.id == "b9" }
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

    private fun awaitUntil(timeoutMs: Long = 30_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(10)
        }
        throw AssertionError("condition not met within ${timeoutMs}ms")
    }

    private companion object {
        private const val OLDER_CURSOR = "older-1"
        private const val WINDOW_OLDER_CURSOR = "window-older"
        private const val WINDOW_NEWER_CURSOR = "window-newer"

        private fun wire(id: String, at: String) =
            """{"id":"$id","conversation_id":"c1","direction":"inbound","body":"body $id",""" +
                """"status":"received","created_at":"$at"}"""
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
