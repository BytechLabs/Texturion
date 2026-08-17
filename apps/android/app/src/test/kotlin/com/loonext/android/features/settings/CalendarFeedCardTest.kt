package com.loonext.android.features.settings

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
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.CalendarFeedStrings
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.net.ApiClient
import java.io.File
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.flow.MutableStateFlow
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #245 — the schedule feed on this phone.
 *
 * Three of this card's decisions are promises rather than layout, and each of
 * them fails INVISIBLY if it breaks, which is why they are asserted here rather
 * than left to a reading of the source:
 *
 *  1. THE URL IS SHOWN ONCE. The server keeps a hash, so a panel that survived
 *     dismissal, or a screen that re-rendered the link from state somebody
 *     scrolled back to, would be a live credential parked on a settings page.
 *     Asserted as absence from the tree after Done, not as "the variable is
 *     cleared" — those are different claims and only one is what a person sees.
 *  2. TURNING IT OFF TAKES A SECOND PRESS, and that press names the consequence.
 *     The failure mode of the first press acting immediately is silent from the
 *     member's side: their calendar just stops updating. So the first press must
 *     put NOTHING on the wire, and that is checked on the wire.
 *  3. A ROLE THAT CANNOT READ CONVERSATIONS IS NEVER OFFERED ONE. Every route in
 *     `routes/calendar.ts` asks for `conversations.read`, and the bookkeeper
 *     (#315) is the role that reaches Profile without it. "Absent, not disabled"
 *     has more failure modes than a source scan can list — zero alpha, a
 *     covering box, a guard inside the click handler — and they share one
 *     observable: a card that is still COMPOSED asks the server for its status.
 *     So the negative is asserted on the wire too.
 *
 * The words are pinned separately, against the web catalogue this client copied
 * them from, in both languages.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CalendarFeedCardTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var server: MockWebServer
    private lateinit var graph: AppGraph

    /** Every request the card has actually made, in order. */
    private val calls = CopyOnWriteArrayList<String>()

    private val messages = CopyOnWriteArrayList<String>()

    /** What GET /v1/calendar/feed answers with right now. */
    private var status = """{"active":false}"""

    private val mintedUrl =
        "https://app.example.test/calendar/feed-token-245/schedule.ics"

    private fun router() = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            val call = "${request.method} ${request.url.encodedPath}"
            calls += call
            return when (call) {
                "GET /v1/calendar/feed" -> MockResponse(body = status)
                "POST /v1/calendar/feed" -> {
                    // Minting REPLACES whatever was there, and resets the read
                    // clock — the status the card re-reads has to say so.
                    status = """{"active":true,"created_at":"${Instant.now()}","last_read_at":null}"""
                    MockResponse(code = 201, body = """{"url":"$mintedUrl"}""")
                }

                "DELETE /v1/calendar/feed" -> {
                    status = """{"active":false}"""
                    MockResponse(body = """{"revoked":true}""")
                }

                else -> MockResponse(code = 404, body = """{"error":"not in this test"}""")
            }
        }
    }

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = router()
        server.start()
        graph = AppGraph(ApplicationProvider.getApplicationContext())
    }

    @After
    fun tearDown() {
        server.close()
    }

    private class FakeSessions : SessionSource {
        private val flow = MutableStateFlow<Session?>(
            Session(
                accessToken = "token-1",
                refreshToken = "refresh-1",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "user-1",
                email = "tech@example.com",
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
     * The card in the container Profile renders it in — a scrolling column,
     * because it sits between the theme picker and the account block on a phone.
     */
    private fun render(role: String = MemberRole.MEMBER) {
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
                ) { CalendarFeedCard(scope) }
            }
        }
    }

    /** Wall-clock wait: the network here is real, and off the compose clock. */
    private fun awaitUntil(what: String, timeoutMs: Long = 5_000, check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            compose.waitForIdle()
            if (check()) return
            Thread.sleep(10)
        }
        throw AssertionError("timed out waiting for $what. calls=$calls")
    }

    /** Wait for what is being ASSERTED, never for the request that precedes it. */
    private fun awaitText(text: String) =
        awaitUntil("the line reading \"$text\"") { nodes(text) > 0 }

    private fun nodes(text: String) =
        compose.onAllNodesWithText(text).fetchSemanticsNodes().size

    /** The English the catalogue actually holds, so no sentence is retyped here. */
    private fun en(key: String, vars: Map<String, String> = emptyMap()) =
        AppStrings.translate(MessageLocale.EN, "calendarFeed.$key", vars)

    // -- 1. shown once -------------------------------------------------------

    @Test
    fun `the link is shown once, and dismissing it is the end of it`() {
        render()
        awaitText(en("create"))

        compose.onNodeWithText(en("create")).performScrollTo().performClick()
        awaitUntil("the mint") { calls.contains("POST /v1/calendar/feed") }

        // The warning is IN THE WORDS, in front of the link, not implied by the
        // amber block it sits in.
        awaitText(en("shownOnceTitle"))
        compose.onNodeWithText(en("shownOnceDetail")).assertExists()
        compose.onNodeWithText(mintedUrl).assertExists()

        compose.onNodeWithText(en("done")).performScrollTo().performClick()
        compose.waitForIdle()

        assertEquals(
            "the URL is still on screen after it was dismissed — the server " +
                "cannot show it again, and a settings page is not where a live " +
                "credential lives",
            0,
            nodes(mintedUrl),
        )
        assertEquals("the shown-once panel outlived its dismissal", 0, nodes(en("shownOnceTitle")))

        // And what is left behind is the honest state of a feed nobody has
        // polled yet — the fact the card exists to report.
        awaitText(en("neverRead"))
        assertEquals(
            "minting was asked for more than once",
            1,
            calls.count { it == "POST /v1/calendar/feed" },
        )
    }

    // -- 2. the second press -------------------------------------------------

    @Test
    fun `turning it off takes a second press, and that press says what breaks`() {
        status = """{"active":true,"created_at":"2026-08-01T09:00:00Z","last_read_at":null}"""
        render()
        awaitText(en("revoke"))

        compose.onNodeWithText(en("revoke")).performScrollTo().performClick()
        compose.waitForIdle()

        assertEquals(
            "the first press turned the feed off. It has to arm a confirmation " +
                "instead: from the member's side revoking announces nothing — " +
                "their calendar simply stops updating",
            0,
            calls.count { it == "DELETE /v1/calendar/feed" },
        )

        // The consequence, not "are you sure".
        compose.onNodeWithText(en("revokeConfirm")).assertExists()
        compose.onNodeWithText(en("revokeConfirm")).performClick()
        awaitUntil("the revoke") { calls.contains("DELETE /v1/calendar/feed") }

        // Back to the offer, because that is the whole of what happened.
        awaitText(en("create"))
    }

    // -- 3. did this work? ---------------------------------------------------

    @Test
    fun `an active feed says when a calendar last checked it`() {
        val sixMinutesAgo = Instant.now().minusSeconds(6 * 60)
        status =
            """{"active":true,"created_at":"2026-08-01T09:00:00Z","last_read_at":"$sixMinutesAgo"}"""
        render()

        // A feed nothing has polled looks identical to a working one without
        // this line, and the commonest failure is copying the link and never
        // finishing in the calendar app.
        awaitText(en("lastRead", mapOf("when" to "6m")))
        assertEquals("a polled feed was reported as never read", 0, nodes(en("neverRead")))
    }

    // -- 4. the negative -----------------------------------------------------

    @Test
    fun `a bookkeeper is never offered a feed they could not read`() {
        assertTrue(
            "this test's premise: a bookkeeper does not hold conversations.read",
            !MemberRole.has(MemberRole.BOOKKEEPER, Capability.CONVERSATIONS_READ),
        )

        render(MemberRole.BOOKKEEPER)
        compose.waitForIdle()
        Thread.sleep(1_000)
        compose.waitForIdle()

        assertEquals(
            "the calendar feed was offered to a bookkeeper — every route behind " +
                "it answers 403 to that role",
            0,
            nodes(en("create")),
        )
        assertEquals(
            "the card was composed for a bookkeeper — it asked the server for a " +
                "status it may not have",
            emptyList<String>(),
            calls.toList(),
        )
    }

    // -- 5. the words --------------------------------------------------------

    @Test
    fun `both languages are the web catalogue's words, character for character`() {
        /*
         * The one source, read in both halves.
         *
         * This card hands somebody a bearer credential and tells them it will
         * never be shown again. Three clients each phrasing that slightly
         * differently is how a customer on two devices stops being sure they are
         * looking at the same feature — and the French here was carried across
         * rather than re-translated, so a drift in THAT half is the one nobody
         * on this team would notice by reading the screen.
         */
        for ((half, table) in listOf(
            "En" to CalendarFeedStrings.en,
            "Fr" to CalendarFeedStrings.frCA,
        )) {
            val source = webSection(half)
            // A guard that samples nothing reports clean.
            assertTrue("the $half half of calendarFeed.ts is empty", source.length > 200)
            assertTrue("no keys in the $half table", table.isNotEmpty())

            table.forEach { (key, text) ->
                assertTrue(
                    "$key has drifted from the web catalogue's $half half. " +
                        "This app says:\n  $text",
                    source.contains("\"$text\""),
                )
            }

            // And the other direction: a key web has that this client dropped is
            // a sentence that renders its own name here, which `translate`
            // failing open would otherwise hide.
            val webKeys = Regex("""(?m)^ {2}([a-zA-Z][A-Za-z0-9]*):""")
                .findAll(source)
                .map { "calendarFeed." + it.groupValues[1] }
                .toSortedSet()
            assertTrue("no keys parsed out of the $half half", webKeys.isNotEmpty())
            assertEquals(
                "keys the web catalogue's $half half has that this client does not",
                emptySet<String>(),
                webKeys - table.keys,
            )
        }
    }

    /**
     * One language's half of `apps/web/src/i18n/sections/calendarFeed.ts`.
     *
     * Sliced rather than read whole, because a `contains` over the entire file
     * would ask whether a sentence appears in EITHER language — which is exactly
     * the mistake this guard exists to catch.
     *
     * Walked up to from the working directory rather than reached by counting
     * `../`: Gradle runs unit tests from `apps/android/app`, but that is a detail
     * of the runner rather than a promise.
     */
    private fun webSection(half: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "apps/web/src/i18n/sections/calendarFeed.ts")
            if (candidate.exists()) {
                val text = candidate.readText()
                return if (half == "En") {
                    text.substringAfter("export const calendarFeedEn")
                        .substringBefore("export const calendarFeedFr")
                } else {
                    text.substringAfter("export const calendarFeedFr")
                }
            }
            dir = dir.parentFile
        }
        throw AssertionError(
            "apps/web/src/i18n/sections/calendarFeed.ts not found walking up from " +
                File("").absolutePath,
        )
    }
}
