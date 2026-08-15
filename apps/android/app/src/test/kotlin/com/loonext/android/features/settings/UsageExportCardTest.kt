package com.loonext.android.features.settings

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.net.ApiClient
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.TimeZone
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * #595 — the bookkeeper's usage export, on the wire and in the tree.
 *
 * The issue is "the export works end to end on the server and no app can start
 * one", so the thing being proven is not that a card renders. It is:
 *
 *   1. pressing the control puts a REQUEST on the wire, carrying the period the
 *      card defaulted to, resolved to the instants the API asked for;
 *   2. a finished export is COLLECTABLE from this phone — the list renders it
 *      and the download actually leaves the activity carrying the signed URL;
 *   3. somebody without `billing.manage` never sees any of it.
 *
 * THE INSTANTS ARE THE PART THAT LOOKS LIKE A DETAIL AND IS NOT. A date control
 * gives a day; the route takes an instant. `to` at the START of its day makes
 * "the 1st to the 30th" stop at midnight ON the 30th, so the last day of every
 * period a bookkeeper asks for is silently missing — a file that reconciles to
 * nothing, from a screen that reported success. Web resolves `to` to
 * `23:59:59.999` and this asserts the same thing arrives here, by reading the
 * instant BACK into the reader's zone rather than by rebuilding the string the
 * production code built.
 *
 * THE NEGATIVE IS ASSERTED ON THE WIRE TOO, not only in the tree. "Absent, not
 * disabled" has more failure modes than a source scan can list — `enabled =
 * false`, zero alpha, a covering box, a guard inside the click handler — and
 * they share one observable: nothing happens, and nothing is asked for. A card
 * that renders invisibly still runs its `LaunchedEffect`, so an incapable role
 * that produces a `GET /v1/exports` has failed even if no node is findable.
 *
 * The clock is pinned ([FIXED_ZONE]) because the assertions are about which
 * instant a day becomes, and that is a question about a zone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UsageExportCardTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    /**
     * A zone with a real offset, deliberately. Under UTC the start-of-day rule
     * and the naive "just append T00:00:00Z" bug produce identical strings, so
     * the test would pass against the mistake it exists to catch.
     */
    private val fixedZone = ZoneId.of("America/Los_Angeles")

    private lateinit var server: MockWebServer
    private lateinit var graph: AppGraph
    private var originalZone: TimeZone? = null

    /** Every request the card has actually made, in order. */
    private val calls = CopyOnWriteArrayList<String>()

    /** The bodies POSTed to the usage-export route, in order. */
    private val bodies = CopyOnWriteArrayList<String>()

    /** What GET /v1/exports answers with in the test currently running. */
    private var exportList = """{"data":[],"next_cursor":null}"""

    private val signedUrl =
        "https://storage.example.test/exports/usage-595.csv?token=signed"

    private fun router() = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.url.encodedPath
            calls += "${request.method} $path"
            if (path == "/v1/exports/usage") bodies += request.body?.utf8().orEmpty()
            return when (path) {
                "/v1/exports" -> MockResponse(body = exportList)
                "/v1/exports/usage" -> MockResponse(
                    code = 202,
                    body = """{"export_id":"exp-1","already_building":false}""",
                )

                else -> MockResponse(code = 404, body = """{"error":"not in this test"}""")
            }
        }
    }

    @Before
    fun setUp() {
        originalZone = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone(fixedZone))
        server = MockWebServer()
        server.dispatcher = router()
        server.start()
        graph = AppGraph(ApplicationProvider.getApplicationContext())
    }

    @After
    fun tearDown() {
        server.close()
        originalZone?.let { TimeZone.setDefault(it) }
    }

    private class FakeSessions : SessionSource {
        private val flow = MutableStateFlow<Session?>(
            Session(
                accessToken = "token-1",
                refreshToken = "refresh-1",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "user-1",
                email = "books@example.com",
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

    private fun repository() = SettingsRepository(
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

    private fun me(role: String) = Me(
        user_id = "user-1",
        display_name = "Dana",
        memberships = listOf(
            Membership(
                company_id = "c1",
                name = "Northside Plumbing",
                role = role,
                subscription_status = SubscriptionStatus.ACTIVE,
            ),
        ),
    )

    /**
     * The card in the container the section renders it in — a scrolling column,
     * because it sits under the meters, delivery and the cap on a phone, and a
     * guard that only holds on a tall screen is not testing the screen anybody
     * has.
     */
    private fun render(role: String) {
        val scope = SettingsScope(
            graph = graph,
            repo = repository(),
            companyId = "c1",
            me = me(role),
            role = role,
            showMessage = { messages += it },
        )
        compose.setContent {
            MaterialTheme {
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                ) { UsageExportCard(scope) }
            }
        }
    }

    private val messages = CopyOnWriteArrayList<String>()

    /** Wall-clock wait: the network is real here, and off the compose clock. */
    private fun awaitUntil(what: String, timeoutMs: Long = 5_000, check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            compose.waitForIdle()
            if (check()) return
            Thread.sleep(10)
        }
        throw AssertionError("timed out waiting for $what. calls=$calls")
    }

    /**
     * Wait for a row to be ON SCREEN, not for the request that will produce it.
     *
     * `awaitUntil { calls.contains("GET /v1/exports") }` returns the moment the
     * call is RECORDED, which is before the response has been applied to state
     * and recomposed. `waitForIdle()` closes most of that window and not all of
     * it: one full-suite run failed here with "could not find any node that
     * satisfies Text contains 'Ready.'" and the same test passed alone twice
     * afterwards. A test that fails one run in three is a test that will red the
     * trunk on somebody else's change.
     *
     * So the wait is on the thing being asserted.
     */
    private fun awaitText(text: String, timeoutMs: Long = 5_000) {
        awaitUntil("the row reading \"$text\"", timeoutMs) {
            compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
    }

    // -- 1. the request ------------------------------------------------------

    @Test
    fun `starting an export sends the default period as the instants the API wants`() {
        render(MemberRole.BOOKKEEPER)

        // Collapsed: the blurb and the action, nothing else. Zen of Clarity —
        // and the reason the form is behind a press rather than above the
        // meters.
        compose.onNodeWithText(EXPORT_USAGE_ACTION).performScrollTo().performClick()

        // Opened on a FILLED period. Smart Defaults: `from` is required by the
        // route, so an empty pair would be a form that cannot be submitted
        // until somebody works out what to type.
        val expected = lastCompleteMonth(LocalDate.now(fixedZone).year, LocalDate.now(fixedZone).monthValue)
        compose.onNodeWithText(expected.from).assertExists()
        compose.onNodeWithText(expected.to).assertExists()

        // The caveat is in front of the decision, not in the finished file.
        compose.onNodeWithText(EXPORT_USAGE_NOTE).assertExists()

        compose.onNodeWithText("Start it").performScrollTo().performClick()
        awaitUntil("the usage export request") { bodies.isNotEmpty() }

        val body = bodies.single()
        val from = Instant.parse(body.jsonString("from"))
        val to = Instant.parse(body.jsonString("to"))

        // Read the instants BACK into the reader's zone. Independent of how the
        // production code built them, and this is where the day/instant rule
        // either holds or quietly loses the last day of every period.
        val local = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS")
        assertEquals(
            "`from` is the start of the first day, in the reader's zone",
            "${expected.from}T00:00:00.000",
            local.format(from.atZone(fixedZone)),
        )
        assertEquals(
            "`to` is the END of the last day — a period typed 1st to 30th includes the 30th",
            "${expected.to}T23:59:59.999",
            local.format(to.atZone(fixedZone)),
        )

        // The period is the last COMPLETE month: one that has finished, not one
        // still accruing.
        val asked = YearMonth.from(LocalDate.parse(expected.from))
        assertEquals(
            "the default period is the month before this one",
            YearMonth.from(LocalDate.now(fixedZone)).minusMonths(1),
            asked,
        )
        assertEquals(
            "the period covers the whole month",
            asked.lengthOfMonth(),
            LocalDate.parse(expected.to).dayOfMonth,
        )

        // Waited for, not read. `awaitUntil { bodies.isNotEmpty() }` above
        // returns the moment the REQUEST is recorded — the snackbar is emitted
        // after the response comes back and is applied, which is a separate
        // step this assertion used to race. It passed alone and failed under
        // load, which is the same failure this file already documents for
        // `awaitText` two methods up and did not apply here. #224 added enough
        // suites to the run to expose it.
        awaitUntil("the export's confirmation") { messages.isNotEmpty() }
        assertTrue(
            "the reader is told where the file will appear",
            messages.single().contains("Data export"),
        )
    }

    // -- 2. the collect ------------------------------------------------------

    @Test
    fun `a finished export is listed and its download leaves the phone`() {
        exportList = """
            {"data":[{"id":"exp-1","status":"ready","requested_at":"2026-08-01T12:00:00Z",
             "completed_at":"2026-08-01T12:01:00Z","expires_at":"2026-09-01T12:00:00Z",
             "files":[{"name":"usage-595.csv","url":"$signedUrl"}]}],"next_cursor":null}
        """.trimIndent()

        render(MemberRole.BOOKKEEPER)
        awaitUntil("the export list") { calls.contains("GET /v1/exports") }

        // The row, and the only affordance that matters on it.
        awaitText("Ready.")
        compose.onNodeWithText("Ready.").performScrollTo().assertExists()
        compose.onNodeWithText("Download").performScrollTo().performClick()

        // Pressed, and the file actually goes somewhere. An intent that fires
        // with the wrong URL, or does not fire, is the same defect as a row
        // that never rendered.
        val started = shadowOf(compose.activity).nextStartedActivity
        assertNotNull("pressing Download started nothing", started)
        assertEquals(Intent.ACTION_VIEW, started.action)
        assertEquals(signedUrl, started.data.toString())
    }

    @Test
    fun `an expired export offers no download rather than a link that would fail`() {
        // `ready` with no files is what the server sends once the objects are
        // gone. Offering a button here is a download that 404s and a person who
        // thinks the product is broken.
        exportList = """
            {"data":[{"id":"exp-1","status":"ready","requested_at":"2026-08-01T12:00:00Z",
             "files":[]}],"next_cursor":null}
        """.trimIndent()

        render(MemberRole.BOOKKEEPER)
        awaitUntil("the export list") { calls.contains("GET /v1/exports") }
        awaitText("Ready, but the file has expired.")

        compose.onNodeWithText("Ready, but the file has expired.").performScrollTo()
            .assertExists()
        assertEquals(
            "an expired export offered a download",
            0,
            compose.onAllNodesWithText("Download").fetchSemanticsNodes().size,
        )
    }

    // -- 3. the negative -----------------------------------------------------

    @Test
    fun `a member without billing manage is never offered the export`() {
        assertTrue(
            "this test's premise: a member does not hold the capability",
            !MemberRole.has(MemberRole.MEMBER, Capability.BILLING_MANAGE),
        )
        assertNeverOffered(MemberRole.MEMBER)
    }

    @Test
    fun `a read-only observer is never offered the export`() {
        assertTrue(
            "this test's premise: read_only does not hold the capability",
            !MemberRole.has(MemberRole.READ_ONLY, Capability.BILLING_MANAGE),
        )
        assertNeverOffered(MemberRole.READ_ONLY)
    }

    /**
     * Absent — no node, and no request.
     *
     * The wire half is what makes this more than a text search. A card hidden
     * with an alpha, a zero height, or a guard inside the click handler is
     * still COMPOSED, so its list read still leaves the phone; that is a role
     * pulling a list it may not have, and it fails here.
     *
     * The window is generous and its length is not a guess: the collect test
     * above waits for exactly this request over the same loopback server and
     * gets it in milliseconds.
     */
    private fun assertNeverOffered(role: String) {
        render(role)
        compose.waitForIdle()
        Thread.sleep(1_000)
        compose.waitForIdle()

        assertEquals(
            "the export action was offered to $role",
            0,
            compose.onAllNodesWithText(EXPORT_USAGE_ACTION).fetchSemanticsNodes().size,
        )
        assertEquals(
            "the card was composed for $role — it asked the server for the list",
            emptyList<String>(),
            calls.toList(),
        )
    }

    // -- the words -----------------------------------------------------------

    @Test
    fun `the words are the shared words, character for character`() {
        // Copy is not decoration here: [EXPORT_USAGE_NOTE] is the sentence that
        // stops a bookkeeper expecting an invoice. Three clients say it, and a
        // hand-port is a retype — so this reads the ONE source and requires the
        // Kotlin constants to appear in it verbatim.
        // #228: the WORDS live in the web catalogue now. `sharedSource()`
        // stays — the capability assertion below still reads the module, which
        // is where a capability belongs.
        //
        // Sliced to the English half: the French holds the same keys, and a
        // `contains` over the whole file would ask whether a sentence appears
        // in EITHER language.
        val source = catalogueEnglish()
        for ((name, text) in listOf(
            "EXPORT_USAGE_ACTION" to EXPORT_USAGE_ACTION,
            "EXPORT_USAGE_BLURB" to EXPORT_USAGE_BLURB,
            "EXPORT_USAGE_NOTE" to EXPORT_USAGE_NOTE,
        )) {
            assertTrue(
                "$name has drifted from the catalogue. " +
                    "This app says:\n  $text",
                source.contains("\"$text\""),
            )
        }
    }

    @Test
    fun `the capability is the one the shared contract and the route both name`() {
        // Deliberately NOT `contacts.bulk`, which guards the exports carrying
        // customer data. Gating it that way would lock out the bookkeeper — the
        // person this exists for.
        assertTrue(
            "the shared contract no longer names billing.manage",
            sharedSource().contains(
                "USAGE_EXPORT_CAPABILITY = \"${Capability.BILLING_MANAGE}\"",
            ),
        )
    }

    /**
     * `packages/shared/src/usage-export.ts`, with TypeScript's line-broken
     * string concatenation joined back up, so a multi-line literal compares as
     * the one sentence it is.
     *
     * Walked up to from the working directory rather than reached by counting
     * `../`: Gradle runs unit tests from `apps/android/app`, but that is a
     * detail of the runner rather than a promise.
     */
    /** The web catalogue's English half, where these three sentences went. */
    private fun catalogueEnglish(): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "apps/web/src/i18n/sections/settingsMore.ts")
            if (candidate.exists()) {
                return candidate.readText()
                    .substringAfter("export const settingsMoreEn")
                    .substringBefore("export const settingsMoreFr")
            }
            dir = dir.parentFile
        }
        throw AssertionError(
            "apps/web/src/i18n/sections/settingsMore.ts not found walking up from " +
                File("").absolutePath,
        )
    }

    private fun sharedSource(): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/src/usage-export.ts")
            if (candidate.exists()) {
                return candidate.readText().replace(Regex("\"\\s*\\+\\s*\\r?\\n\\s*\""), "")
            }
            dir = dir.parentFile
        }
        throw AssertionError(
            "packages/shared/src/usage-export.ts not found walking up from " +
                File("").absolutePath,
        )
    }

    // -- the day/instant rule, without a clock -------------------------------

    @Test
    fun `a day becomes the instant that day starts, and the one it ends`() {
        // Literals, an explicit zone, and no `now()` anywhere: this is the rule
        // itself rather than the rule as it happens to fall today.
        val zone = ZoneId.of("America/Los_Angeles")
        assertEquals(
            "2026-07-01T07:00:00Z",
            usageExportFromInstant("2026-07-01", zone),
        )
        assertEquals(
            "2026-07-31T23:59:59.999-07:00, which is the last millisecond of July",
            "2026-08-01T06:59:59.999Z",
            usageExportToInstant("2026-07-31", zone),
        )
        // A zone the other side of UTC, where the day lands on the PREVIOUS UTC
        // date — the case an implementation that formats the local wall clock
        // and appends "Z" gets wrong by a whole day.
        val sydney = ZoneId.of("Australia/Sydney")
        assertEquals("2026-06-30T14:00:00Z", usageExportFromInstant("2026-07-01", sydney))
    }

    @Test
    fun `the status line says what the server is doing, and the failure says why`() {
        assertEquals("Queued.", statusLine(export("pending")))
        assertEquals("Being put together…", statusLine(export("running")))
        // The server's own sentence, verbatim: it knows what went wrong and
        // this app does not.
        assertEquals(
            "Storage is full.",
            statusLine(export("failed", error = "Storage is full.")),
        )
        assertNull(export("pending").error)
    }

    private fun export(status: String, error: String? = null) =
        DataExport(id = "exp-1", status = status, error = error)

    // -- the poll, and the fact that it ends ---------------------------------

    // A timeout, because the failure mode being guarded against is a loop that
    // does not end: without one this reports as a hung build rather than a
    // failed assertion, and a guard nobody can read the result of is not one.
    @Test(timeout = 10_000)
    fun `the poll stops the moment nothing is being built`() = runBlocking {
        var reads = 0
        pollExports(
            pollMillis = 1,
            fetch = {
                reads++
                listOf(export("ready"))
            },
            onRows = {},
            onFailed = { throw AssertionError("unexpected failure", it) },
        )
        // Returned at all, and asked exactly once. A loop that kept going would
        // never reach this line — the test would hang rather than fail, which
        // is itself the honest symptom of a screen that never stops asking.
        assertEquals("a settled list was re-read", 1, reads)
    }

    @Test(timeout = 10_000)
    fun `the poll keeps asking while something is still being built`() = runBlocking {
        var reads = 0
        val seen = mutableListOf<List<DataExport>>()
        pollExports(
            pollMillis = 1,
            fetch = {
                reads++
                // Three reads: queued, running, then done — and then it must stop.
                when (reads) {
                    1 -> listOf(export("pending"))
                    2 -> listOf(export("running"))
                    else -> listOf(export("ready"))
                }
            },
            onRows = { seen += it },
            onFailed = { throw AssertionError("unexpected failure", it) },
        )
        assertEquals("the poll did not follow the export to completion", 3, reads)
        assertEquals("every read reached the screen", 3, seen.size)
    }

    @Test(timeout = 10_000)
    fun `a failed read ends the poll instead of retrying forever`() = runBlocking {
        var reads = 0
        var failure: Throwable? = null
        pollExports(
            pollMillis = 1,
            fetch = {
                reads++
                throw IllegalStateException("nope")
            },
            onRows = { throw AssertionError("rows from a failed read") },
            onFailed = { failure = it },
        )
        // A server that just refused is not more likely to agree in fifteen
        // seconds, and a screen left open overnight would turn one failure into
        // thousands.
        assertEquals("a failed read was retried", 1, reads)
        assertNotNull("the failure never reached the screen", failure)
    }

    @Test
    fun `only pending and running count as still being built`() {
        assertTrue(anyInFlight(listOf(export("pending"))))
        assertTrue(anyInFlight(listOf(export("running"))))
        assertTrue(
            "one unfinished row among finished ones still counts",
            anyInFlight(listOf(export("ready"), export("running"))),
        )
        assertTrue("a settled list is not in flight", !anyInFlight(listOf(export("ready"))))
        assertTrue("a failed export is finished", !anyInFlight(listOf(export("failed"))))
        assertTrue("an empty list is not in flight", !anyInFlight(emptyList()))
    }

    /** The one field, out of a JSON body, without a decoder that could be lenient. */
    private fun String.jsonString(key: String): String =
        Regex("\"$key\"\\s*:\\s*\"([^\"]+)\"").find(this)?.groupValues?.get(1)
            ?: throw AssertionError("no string `$key` in $this")
}
