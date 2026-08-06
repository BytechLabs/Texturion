package com.loonext.android.features.settings

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
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
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.net.ApiClient
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.flow.MutableStateFlow
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * #524 — PRESS THE CONTROL, AND ASSERT THE EFFECT HAPPENED.
 *
 * THE PROBLEM WITH EVERY GUARD THIS JOINS. Cancelling must never cost more than
 * one action; that rule has regressed once and been caught twice, and each round
 * of catching it produced a longer list of ways to stand in front of the exit.
 * The lists were real and every entry on them was a real defect — but a list of
 * mechanisms can always be added to, and these three were applied to this exact
 * screen while every test in the module stayed green:
 *
 *  - `if (company.subscriptionActive && pause.isRunning)` at the cancel card's
 *    own call site, so a workspace whose read is in flight has no card at all;
 *  - `if (pause is PauseRead.Loading) return` as the first statement of
 *    `CancelCard`, above `SettingsCard {`, in front of every window the source
 *    lints measure from;
 *  - `modifier = if (pause is PauseRead.Loading) Modifier.height(0.dp) else
 *    Modifier` on the button, which leaves it enabled, present, and invisible.
 *
 * `enabled = false`, an alpha of zero, a covering overlay, a `pointerInput` that
 * swallows the tap, a guard inside the click handler, a `LaunchedEffect` that
 * navigates away: none of those is on any list either, and they are not one
 * family. What they have in common is not the mechanism. It is the OBSERVABLE —
 * press the button, and nothing happens.
 *
 * So this file does not read the screen's source. It renders the real
 * [BillingSection], finds the button by the words on it, presses it, and
 * requires that what pressing it is supposed to do actually happened: the POST
 * that mints the Stripe session arrives at a real server, and the browser intent
 * leaves the activity carrying the URL that route answered with. Every mechanism
 * above produces the same failure here, including the ones nobody has invented
 * yet, and the call-site variant fails hardest of all — a card that never
 * renders has no node to press.
 *
 * IT RUNS OVER THE WHOLE STATE SPACE. [PauseRead] is a sealed interface with
 * four cases — nobody asked, asked and waiting, answered, and the ask failed —
 * so pressing the exit in all four is exhaustive rather than a sample. That is
 * the strength a source scan cannot have: it proves the exit works, not that the
 * source is free of a shape somebody thought of.
 *
 * THE NETWORK IS A REAL SERVER, and in the in-flight case the pause read is
 * genuinely never answered — [SocketEffect.Stall] holds the socket open for the
 * length of the test rather than sleeping for a while. A press that reaches
 * Stripe under those conditions is the property the whole cancel screen exists
 * to protect: a slow billing route may not become a person who cannot cancel.
 *
 * PROVEN BY BREAKING. Each escape above was applied to `BillingSection.kt`, this
 * file was run, and each one failed here before the source was put back. The
 * report on #524 names which assertion caught which.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BillingPressTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    // -- the world the screen is rendered into --------------------------------

    /**
     * The hosted page the portal route answers with. A fixed, recognisable URL,
     * so the last assertion is "the browser was sent THERE" rather than "some
     * intent was fired".
     */
    private val portalUrl = "https://billing.stripe.com/p/session/test-524"

    /** What GET /v1/billing/pause does in the test currently running. */
    private var pauseRead: () -> MockResponse = { stalledForever() }

    /** Every request the screen has actually made, in order. */
    private val calls = CopyOnWriteArrayList<String>()

    /** The bodies POSTed to the cancellation-reason route, in order. */
    private val statements = CopyOnWriteArrayList<String>()

    private lateinit var server: MockWebServer
    private lateinit var graph: AppGraph

    /**
     * A read that is sent and never answered — the socket stays open and the
     * request stays in flight for the rest of the test.
     *
     * This is the state that matters most and the one a hand-written fake models
     * worst: the exit has to work while a Stripe round trip is outstanding, not
     * merely once it has failed fast.
     */
    private fun stalledForever() =
        MockResponse.Builder().onResponseStart(SocketEffect.Stall).build()

    private fun answeredPause(pausedAt: String?) = MockResponse(
        body = "{\"eligible\":false,\"reason\":\"already_paused\",\"paused_at\":" +
            (pausedAt?.let { "\"$it\"" } ?: "null") +
            ",\"monthly_cents\":1275,\"resume_plan\":\"pro\"}",
    )

    private fun router() = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.url.encodedPath
            calls += "${request.method} $path"
            if (path == "/v1/billing/cancellation-reason") {
                statements += request.body?.utf8().orEmpty()
            }
            return when (path) {
                "/v1/billing/pause" -> pauseRead()
                "/v1/billing/portal" -> MockResponse(body = "{\"url\":\"$portalUrl\"}")
                // 204, like the route: the record is fired and never awaited.
                "/v1/billing/cancellation-reason" -> MockResponse(code = 204)
                "/v1/billing/modules" -> MockResponse(body = "{\"modules\":[]}")
                else -> MockResponse(code = 404, body = "{\"error\":\"not in this test\"}")
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
                email = "owner@example.com",
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

    private val plan = "pro"
    private val currency = "usd"

    /** The plan facts the screen itself prints, read from the shipped price book. */
    private val facts = planFacts(plan, currency, "US")!!

    private fun company() = CompanyView(
        id = "c1",
        name = "Northside Plumbing",
        country = "US",
        us_texting_enabled = true,
        requested_area_code = "415",
        timezone = "America/Los_Angeles",
        subscription_status = SubscriptionStatus.ACTIVE,
        plan = plan,
        billing_currency = currency,
        current_period_end = "2026-09-01T00:00:00Z",
        created_at = "2026-01-01T00:00:00Z",
        updated_at = "2026-01-01T00:00:00Z",
    )

    private fun me(role: String) = Me(
        user_id = "user-1",
        display_name = "Sam",
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
     * The billing screen, in the container the host renders it in — a scrolling
     * column, because the exit is below the fold on a phone and a guard that
     * only holds on a tall screen is not testing the screen anybody has.
     */
    private fun render(role: String = MemberRole.OWNER) {
        val scope = SettingsScope(
            graph = graph,
            repo = repository(),
            companyId = "c1",
            me = me(role),
            role = role,
            showMessage = {},
        )
        compose.setContent {
            MaterialTheme {
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                ) {
                    BillingSection(scope, company(), onRefreshCompany = {})
                }
            }
        }
    }

    /** True once the screen has made this exact call. */
    private fun called(what: String) = calls.contains(what)

    /**
     * Wait for something the screen DID, letting composition settle each turn.
     *
     * Not the rule's own `waitUntil`: that advances the frame clock and polls,
     * and a restarted `LaunchedEffect` whose work is a real socket can sit
     * unstarted through the whole window — it did, and the retry below looked
     * like a dead control for it, which is a false failure this file cannot
     * afford. `waitForIdle` is the thing that actually drains composition and
     * its effects, so it is what runs on every turn here. The failure message
     * names the effect that never happened rather than "condition not
     * satisfied", because on this screen the absent effect IS the defect.
     */
    private fun await(what: String, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + TIMEOUT
        while (System.currentTimeMillis() < deadline) {
            compose.waitForIdle()
            if (condition()) return
            Thread.sleep(20)
        }
        throw AssertionError("$what — the screen made these calls: $calls")
    }

    // -- the one press --------------------------------------------------------

    /**
     * Press the exit, and require that it reached Stripe.
     *
     * THE ASSERTION IS THE EFFECT, in two halves that fail for different
     * reasons. The POST proves the handler ran at all; the intent proves the
     * handoff completed with the URL the route answered — a screen that mints a
     * session and then does nothing with it has still stranded somebody on a
     * billing page.
     */
    private fun pressTheExit() {
        compose.onNodeWithText(ExitPath.EXIT_LABEL)
            .performScrollTo()
            // Both fail on a control that is present and unusable: a zero-height
            // or zero-alpha button is not displayed, and a label that is no
            // longer inside a button has no click action.
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()

        await("the press never reached the route that mints the Stripe session") {
            called("POST /v1/billing/portal")
        }
        await("the session was minted and no browser was opened with it") {
            shadowOf(compose.activity).peekNextStartedActivity() != null
        }
        val opened = shadowOf(compose.activity).peekNextStartedActivity()
        assertNotNull(
            "the exit was pressed and no browser was opened. One press from landing " +
                "on this screen has to reach the hosted Stripe page, whatever the " +
                "pause read is doing",
            opened,
        )
        assertEquals(Intent.ACTION_VIEW, opened!!.action)
        assertEquals(
            "the browser was opened somewhere other than the page the portal route " +
                "answered with",
            portalUrl,
            opened.data.toString(),
        )
    }

    /**
     * THE STATE THE EXIT MOST HAS TO SURVIVE: a Stripe round trip that never
     * comes back.
     *
     * The pause read is sent and its socket is held open for the whole test, so
     * `pause` is [PauseRead.Loading] from the first frame to the last. Every
     * escape that walked past this module's source lints was keyed on exactly
     * this state, because it is the one nobody sees on a screenshot.
     */
    @Test
    fun `the exit reaches Stripe while the pause read is still in flight`() {
        pauseRead = { stalledForever() }
        render()
        pressTheExit()
    }

    /** A read that failed is not permission to withhold the way out either. */
    @Test
    fun `the exit reaches Stripe after a pause read that failed`() {
        pauseRead = { MockResponse(code = 500, body = "{\"error\":\"stripe is down\"}") }
        render()
        pressTheExit()
    }

    @Test
    fun `the exit reaches Stripe on a plan that is running`() {
        pauseRead = { answeredPause(pausedAt = null) }
        render()
        pressTheExit()
    }

    @Test
    fun `the exit reaches Stripe on a workspace that is paused`() {
        pauseRead = { answeredPause(pausedAt = "2026-01-15T09:00:00Z") }
        render()
        pressTheExit()
    }

    /**
     * ...AND IT COST NOTHING TO GET THERE.
     *
     * Nothing above the button was touched: no reason, no note. So the record
     * the API stores has to be the empty statement — "they were asked and
     * skipped" — which is what proves answering was optional rather than
     * optional-looking. A body with a reason in it would mean this test pressed
     * something on the way; a missing POST would mean the record is gone.
     */
    @Test
    fun `the exit is reached having answered nothing, and the silence is recorded`() {
        pauseRead = { stalledForever() }
        render()
        pressTheExit()
        await("the statement was never recorded") {
            called("POST /v1/billing/cancellation-reason")
        }
        assertEquals(
            "the statement stored for somebody who answered nothing must be the " +
                "empty one: silence is a measurement, and a body with anything in it " +
                "means a question was answered on the way to the exit",
            listOf("{}"),
            statements.toList(),
        )
    }

    // -- what the plan card may claim, at the render site ---------------------

    /**
     * THE ALLOWANCE LINES ARE A CLAIM ABOUT TODAY, and they are false three
     * ways: for a paused workspace, for one whose read has not landed, and for
     * one whose read failed.
     *
     * The regression this catches is a few characters wide. Replacing
     * `} else if (running || pause is PauseRead.Unasked)` with
     * `} else if (!pause.isPaused)` puts all five lines back during the load
     * window and after a failed read, because a nullable-shaped question ("is it
     * paused?") answers "no" to a read that never happened. Every test in this
     * module passed with that in place — none of them rendered anything.
     */
    @Test
    fun `a plan the screen has not read is never described in its own terms`() {
        pauseRead = { stalledForever() }
        render()
        compose.waitForIdle()
        planAllowanceLines(facts).forEach { line ->
            compose.onNodeWithText("· $line").assertDoesNotExist()
        }
    }

    @Test
    fun `a read that failed says so, and describes no plan`() {
        pauseRead = { MockResponse(code = 500, body = "{\"error\":\"stripe is down\"}") }
        render()
        val note = planStateUnknownNote(PauseRead.Failed)!!
        await("the sentence for a read that failed never appeared") {
            compose.onAllNodesWithText(note).fetchSemanticsNodes().isNotEmpty()
        }
        planAllowanceLines(facts).forEach { line ->
            compose.onNodeWithText("· $line").assertDoesNotExist()
        }
    }

    /**
     * ...AND THAT SENTENCE COMES WITH A WAY TO ASK AGAIN, WHICH WORKS — ALL THE
     * WAY BACK TO A PLAN DESCRIBED.
     *
     * [planStateUnknownNote] is a pure function and has always been tested as
     * one. What was never tested is anything AROUND it: that the control beside
     * it re-asks, and that a screen which said "we couldn't check" recovers when
     * the second ask succeeds. A retry that fires the request but leaves the
     * card stuck on the failure sentence is the same dead end, one step later.
     *
     * This presses it and follows the whole transition — failed, asked again,
     * [PauseRead.Loading], answered, plan described — which is the load window
     * three escapes were keyed on and which no test in this module had ever
     * entered.
     */
    @Test
    fun `Try again re-asks, and the card recovers when the answer lands`() {
        pauseRead = { MockResponse(code = 500, body = "{\"error\":\"stripe is down\"}") }
        render()
        val note = planStateUnknownNote(PauseRead.Failed)!!
        await("the sentence for a read that failed never appeared") {
            compose.onAllNodesWithText(note).fetchSemanticsNodes().isNotEmpty()
        }
        val before = calls.count { it == "GET /v1/billing/pause" }
        assertTrue("the failed read must have happened at all", before >= 1)

        // The route recovers between the two asks, which is the ordinary case:
        // a billing round trip failed once and worked the second time.
        pauseRead = { answeredPause(pausedAt = null) }
        // The label is the control's own words. If it is ever renamed this
        // fails, which is correct: the new control has to prove it re-asks too.
        compose.onNodeWithText("Try again").performScrollTo().performClick()
        await("Try again was pressed and the pause route was never asked again") {
            calls.count { it == "GET /v1/billing/pause" } > before
        }
        await("the second ask answered and the card never came back to life") {
            compose.onAllNodesWithText("· ${planAllowanceLines(facts).first()}")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(note).assertDoesNotExist()
    }

    /**
     * The one carve-out, pinned so it cannot be tidied away.
     *
     * A member cannot ask about the pause at all — GET /v1/billing/pause is
     * behind `billing.manage` — so their read stays [PauseRead.Unasked] for
     * good. Blanking the plan's own terms for them would punish the one reader
     * who has no control on this card to be misled about.
     */
    @Test
    fun `a member, who can never ask, still reads the plan's terms`() {
        pauseRead = { stalledForever() }
        render(role = MemberRole.MEMBER)
        compose.waitForIdle()
        planAllowanceLines(facts).forEach { line ->
            compose.onNodeWithText("· $line").performScrollTo().assertIsDisplayed()
        }
        assertEquals(
            "nobody may ask on a member's behalf: the route is owner-and-admin only",
            emptyList<String>(),
            calls.filter { it.endsWith("/v1/billing/pause") },
        )
    }

    /**
     * A running plan really is described, so the three assertions above are
     * about the read rather than about a branch that never draws anything.
     */
    @Test
    fun `a plan the screen has been told is running is described`() {
        pauseRead = { answeredPause(pausedAt = null) }
        render()
        val first = "· ${planAllowanceLines(facts).first()}"
        await("a plan the API says is running was never described") {
            compose.onAllNodesWithText(first).fetchSemanticsNodes().isNotEmpty()
        }
        planAllowanceLines(facts).forEach { line ->
            compose.onNodeWithText("· $line").performScrollTo().assertIsDisplayed()
        }
    }

    // -- the sentence that was false for a paused reader ----------------------

    /**
     * #524 — "Texting stops at the end of your billing period" was on the cancel
     * card for everybody, including somebody whose texting stopped the day they
     * paused, an inch below a card telling them exactly that.
     *
     * The fix is not a branch above the button: a sentence that reflows when the
     * pause read lands moves the exit out from under a thumb, which is the
     * regression this whole card is built against. The header is now true either
     * way, and the paused reader's own sentence is [pausedCancelNote], rendered
     * BELOW the button — so this asserts both, at the render site, on a workspace
     * the API says is paused.
     */
    @Test
    fun `a paused reader is not promised texting until the period ends`() {
        pauseRead = { answeredPause(pausedAt = "2026-01-15T09:00:00Z") }
        render()
        val note = pausedCancelNote(PauseRead.Answered(PauseState(paused_at = "x")))!!
        await("a paused workspace was never given the sentence its header cannot say") {
            compose.onAllNodesWithText(note).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(note).performScrollTo().assertIsDisplayed()

        val exit = compose.onNodeWithText(ExitPath.EXIT_LABEL)
            .fetchSemanticsNode().positionInRoot.y
        val correction = compose.onNodeWithText(note).fetchSemanticsNode().positionInRoot.y
        assertTrue(
            "the paused reader's sentence renders ABOVE the button that leaves, so " +
                "the exit moves the moment a billing round trip lands",
            correction > exit,
        )
    }

    /**
     * ...and an unpaused reader is told none of it, because for them it is false
     * in the other direction.
     */
    @Test
    fun `a running plan gets no paused correction`() {
        pauseRead = { answeredPause(pausedAt = null) }
        render()
        compose.waitForIdle()
        val note = pausedCancelNote(PauseRead.Answered(PauseState(paused_at = "x")))!!
        compose.onNodeWithText(note).assertDoesNotExist()
    }

    private companion object {
        /**
         * Long enough for a real socket on a loaded CI box, short enough that a
         * press which does nothing fails rather than hangs.
         */
        const val TIMEOUT = 5_000L
    }
}
