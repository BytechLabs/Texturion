package com.loonext.android.features.thread

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.model.CarrierStanding
import com.loonext.android.core.model.OPT_OUT_SOURCE_STOP
import com.loonext.android.core.model.SummaryOptOut
import com.loonext.android.core.model.THREAD_SUMMARY_NOT_ALLOWED
import com.loonext.android.core.model.THREAD_SUMMARY_REASONS
import com.loonext.android.core.model.ThreadSummary
import com.loonext.android.core.model.standing
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * #247 — what the catch-up says when the SERVER refused, rather than when Lou
 * did.
 *
 * THE DEFECT. `MessagingRepository.threadSummary` mapped every non-cancellation
 * exception to `model_error`, whose sentence is "Couldn't reach Lou just now.
 * Try again." A `read_only` member — an owner's partner, an accountant, a
 * consultant — cannot spend the workspace's catch-ups, and the route says so
 * with a 403. They were told our assistant was down, and invited to keep
 * pressing a control that would refuse them identically every time.
 *
 * WHAT THIS FILE PINS, in three parts that fail for three different reasons:
 *
 *   the mapping   that `forbidden` and only `forbidden` becomes the role
 *                 refusal. Six SPEC §7 codes share the 403 status, and a
 *                 mapping written against the STATUS would tell somebody being
 *                 asked for a second factor that their role is too small.
 *   the wire      that a real 403 envelope over a real socket comes out of the
 *                 repository as that reason, rather than as a throw or as the
 *                 old shrug.
 *   the silence   that nothing here starts rejecting. A catch-up that failed
 *                 must leave the thread exactly as it was.
 *   the standing  that a refusal this client WROTE still states what the server
 *                 last said about the contact. This is the second defect, and
 *                 it is the one that settles: a workspace whose customer texted
 *                 STOP was told so, pressed "try again", the request failed —
 *                 and the warning went, on the answer that replaced it, for
 *                 good. Web held it across exactly this press; two clients did
 *                 not, which is one user action behaving three ways.
 *
 * WHAT IT DOES NOT PIN, said plainly: nothing about what the card draws (see
 * ThreadSummaryCardTest), and nothing about iOS or the web — each client
 * hand-ports this separately and needs its own file.
 */
class ThreadSummaryWireTest {

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
    private lateinit var repo: MessagingRepository

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        repo = MessagingRepository(
            ApiClient(
                http = OkHttpClient(),
                baseUrl = server.url("/").toString().trimEnd('/'),
                sessionStore = FakeSessions(),
                supabaseAuth = SupabaseAuth(
                    client = OkHttpClient(),
                    supabaseUrl = server.url("/gotrue").toString(),
                    publishableKey = "pk",
                ),
            ),
        )
    }

    @After
    fun tearDown() {
        server.close()
    }

    // ---- the mapping ---------------------------------------------------------

    @Test
    fun `a role refusal is named as one`() {
        assertEquals(
            "a 403 forbidden on this route can only come from " +
                "requireCapability(\"conversations.note\") — the per-number gate " +
                "is asked for 'read' and answers not_found — so it is the " +
                "reader's role and nothing else",
            THREAD_SUMMARY_NOT_ALLOWED,
            threadSummaryReasonFor(ApiErrorCode.FORBIDDEN),
        )
    }

    @Test
    fun `no other error code is read as a role refusal`() {
        // ANCHORED TO THE SHIPPED CODE LIST by reflection over ApiErrorCode, not
        // to codes typed here: the point of the guard is that `forbidden` is one
        // of SIX codes carrying a 403 status, so a mapping that drifted onto the
        // status would start telling somebody being asked for a second factor
        // that their role is too small.
        val codes = ApiErrorCode::class.java.declaredFields
            .filter { it.type == String::class.java }
            .mapNotNull { field ->
                field.isAccessible = true
                field.get(null) as? String
            }
        assertTrue("no codes read out of ApiErrorCode", codes.size > 5)
        assertTrue("ApiErrorCode no longer declares forbidden", ApiErrorCode.FORBIDDEN in codes)
        for (code in codes - ApiErrorCode.FORBIDDEN) {
            assertNotEquals(
                "'$code' is being read as a refusal by ROLE. Only `forbidden` is " +
                    "one; mfa_required, mfa_challenge_required, sending_suspended, " +
                    "registration_pending and recipient_opted_out share its status " +
                    "and mean something else entirely",
                THREAD_SUMMARY_NOT_ALLOWED,
                threadSummaryReasonFor(code),
            )
        }
    }

    @Test
    fun `every reason this mapping can produce is one the card has words for`() {
        // The failure this catches is a mapping that invents a reason nothing
        // has copy for, which shows a person the generic fallback — the exact
        // shrug the reason vocabulary was written to abolish.
        val produced = (
            ApiErrorCode::class.java.declaredFields
                .filter { it.type == String::class.java }
                .mapNotNull { field ->
                    field.isAccessible = true
                    (field.get(null) as? String)?.let(::threadSummaryReasonFor)
                }
            ).toSet()
        assertTrue("nothing was produced to check", produced.isNotEmpty())
        for (reason in produced) {
            assertTrue(
                "the wire can answer '$reason' and the card has never heard of it",
                reason in THREAD_SUMMARY_REASONS,
            )
        }
    }

    // ---- the wire ------------------------------------------------------------

    @Test
    fun `a 403 from the route reaches the card as the role refusal`() = runTest {
        server.enqueue(
            MockResponse(
                code = 403,
                body = """{"error":{"code":"forbidden","message":"Insufficient role for this action."}}""",
            ),
        )
        val summary = repo.threadSummary("c1", "conv-1", standing = null)
        assertEquals(emptyList<Any>(), summary.lines)
        assertEquals(
            "a view-only member was told our assistant was unreachable, which is " +
                "false and invites a retry that costs them the same refusal",
            THREAD_SUMMARY_NOT_ALLOWED,
            summary.reason,
        )

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/conversations/conv-1/summary", recorded.url.encodedPath)
        assertEquals("c1", recorded.headers["X-Company-Id"])
    }

    @Test
    fun `a server fault still says the catch-up did not happen`() = runTest {
        // The other direction, and the reason the 403 needed its own branch
        // rather than a new blanket sentence: a 500 IS "couldn't reach Lou",
        // trying again IS worth doing, and nothing about the reader's role is
        // involved.
        server.enqueue(MockResponse(code = 500, body = "boom"))
        val summary = repo.threadSummary("c1", "conv-1", standing = null)
        assertEquals(emptyList<Any>(), summary.lines)
        assertEquals("model_error", summary.reason)
    }

    @Test
    fun `a refusal is never a throw`() = runTest {
        // The standing rule for this surface: a catch-up that could not be had
        // leaves the thread exactly as it was, because the thread was always the
        // record. Reached here by asking for a shape no client model can decode.
        server.enqueue(MockResponse(code = 200, body = """{"lines":"not a list"}"""))
        assertEquals("model_error", repo.threadSummary("c1", "conv-1", null).reason)
    }

    // ---- the standing, across a press that failed ---------------------------

    /**
     * THE DEFECT, in the order a person lives it: the card says the customer's
     * carrier is blocking them, they press "try again", the request does not get
     * through — and the block is no longer mentioned. Not for the length of the
     * request, which is the version the card's own state machine already fixed,
     * but from then on: the refusal this client writes REPLACES the answer that
     * carried the fact, and it used to be written with both carrier fields
     * empty.
     *
     * Both arms are driven over a real socket, because the fix has to be applied
     * to each of them and one of the two is easy to miss — a 403 and a dead
     * connection reach different `catch` blocks and produce different reasons.
     *
     * Asserted against `summaryCarrierNote`'s own output rather than a sentence
     * typed here: the property is that the refusal says exactly what the answer
     * it replaced said, and pinning the words in this file would make it a copy
     * test that passes while the fact goes missing.
     */
    @Test
    fun `a refusal this client writes still states the standing it was given`() = runTest {
        val stop = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z")
        val held = CarrierStanding(optOut = stop, optOutHintAt = null)
        val expected = summaryCarrierNote(stop, null)
        assertNotNull("nothing to lose — the note function said nothing", expected)

        // Three failures: the role refusal, the server fault, and the answer no
        // client model can decode. Every arm of the repository that invents a
        // ThreadSummary, exercised end to end.
        val failures = listOf(
            MockResponse(
                code = 403,
                body = """{"error":{"code":"forbidden","message":"Insufficient role for this action."}}""",
            ),
            MockResponse(code = 500, body = "boom"),
            MockResponse(code = 200, body = """{"lines":"not a list"}"""),
        )
        for (failure in failures) {
            server.enqueue(failure)
            val refusal = repo.threadSummary("c1", "conv-1", held)
            // Through the card, not through the field: the field is only worth
            // anything because this is what the reader ends up seeing.
            assertEquals(
                "a '${refusal.reason}' refusal dropped the customer's STOP. The " +
                    "warning was on the card, somebody pressed the control, the " +
                    "request failed — and the workspace stopped being told its " +
                    "texts are blocked, permanently, by the press that was " +
                    "supposed to change nothing",
                expected,
                catchUpCarrierNote(catchUpState(offered = true, reading = false, summary = refusal)),
            )
            // ...and it carried the standing ALONE. The easier wrong fix is to
            // hand the displaced answer back with a new reason on it, which
            // leaves Lou's last reading of the thread on screen underneath a
            // failure — a stale catch-up wearing a current one's clothes.
            assertEquals(emptyList<Any>(), refusal.lines)
            assertFalse("a manufactured refusal claimed to be a cache hit", refusal.cached)
            assertFalse("a manufactured refusal claimed a truncated window", refusal.truncated)
        }
    }

    @Test
    fun `a first ask that fails cannot invent a standing nobody was given`() = runTest {
        // The other direction, and the one that turns a held fact into an
        // invented one. A card that has never been given an `opt_outs` read has
        // nothing to say about this contact, and a warning drawn there would be
        // exactly the fabrication this whole feature is built around not doing.
        //
        // Both shapes of "nothing": never asked before (null), and asked before
        // and told the thread is clean. The second is the one a nullable-tidy
        // breaks — `standing?.optOut ?: something` reads as harmless.
        val clean = ThreadSummary(lines = emptyList()).standing
        for (standing in listOf(null, clean)) {
            server.enqueue(MockResponse(code = 500, body = "boom"))
            val refusal = repo.threadSummary("c1", "conv-1", standing)
            assertNull("a failed ask grew an opt-out out of nowhere", refusal.opt_out)
            assertNull("a failed ask grew an opt-out hint out of nowhere", refusal.opt_out_hint_at)
            assertNull(
                "a clean thread was told its texts are blocked because a request " +
                    "failed, which is a carrier fact this client made up",
                catchUpCarrierNote(catchUpState(offered = true, reading = false, summary = refusal)),
            )
        }
    }

    @Test
    fun `an answer that states the block is lifted takes the warning with it`() = runTest {
        // The held standing is the last thing the SERVER said, and it is held
        // only until the server says something else. A hold that outranked a
        // real answer would leave a lifted STOP on the card for as long as the
        // thread stayed open — a warning that is the opposite of the truth,
        // which is worse than no warning.
        val stop = SummaryOptOut(OPT_OUT_SOURCE_STOP, "2026-08-01T12:00:00Z")
        server.enqueue(MockResponse(code = 200, body = """{"lines":[],"reason":"model_error"}"""))
        val answered = repo.threadSummary("c1", "conv-1", CarrierStanding(stop, null))
        assertNull(
            "the customer opted back in and the card still says their carrier is " +
                "blocking the crew, because a held fact outranked the answer that " +
                "superseded it",
            catchUpCarrierNote(catchUpState(offered = true, reading = false, summary = answered)),
        )
    }

    /**
     * ...AND NO FUTURE ARM OF THE REPOSITORY FORGETS.
     *
     * A source scan, because the guards above can only cover the three failures
     * that exist today. The shape of this defect is a `catch` block that builds
     * its own `ThreadSummary(reason = …)`, which looks completely reasonable in
     * isolation and silently drops a carrier fact — that is how it was written
     * the first time, twice.
     *
     * It pins one thing: every ThreadSummary this file constructs is built by
     * `threadSummaryRefusal`, which cannot be called without deciding what the
     * standing is. Re-point it rather than deleting it if the construction moves.
     */
    @Test
    fun `no arm of this repository builds a refusal without a standing`() {
        val body = readMainSource("features/thread/MessagingData.kt").replace("\r\n", "\n")
        val builder = "fun threadSummaryRefusal("
        val at = body.indexOf(builder)
        assertTrue(
            "threadSummaryRefusal is gone from MessagingData.kt — with it goes " +
                "the only thing that makes a manufactured refusal state the " +
                "customer's standing",
            at >= 0,
        )
        val constructions = Regex("ThreadSummary\\(").findAll(body).map { it.range.first }.toList()
        assertEquals(
            "MessagingData.kt constructs ThreadSummary somewhere other than inside " +
                "threadSummaryRefusal. A refusal built by hand carries no `opt_out`, " +
                "so a workspace whose customer texted STOP stops being told the " +
                "moment that arm fires. Found ${constructions.size} constructions",
            listOf(true),
            constructions.map { it > at }.distinct(),
        )
    }

    /**
     * A file from this app's own `main` source set, from wherever Gradle
     * started. FAILS rather than skips when it is not there: a guard that
     * quietly passes because it could not find the file it checks reads as
     * protection and provides none.
     */
    private fun readMainSource(relative: String): String {
        listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        ).forEach { base ->
            val f = File(base, relative)
            if (f.exists()) return f.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
