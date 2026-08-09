package com.loonext.android.features.settings

import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.ownership.HandoverConfirmation
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * [#593] The handover funnel, RUN rather than read.
 *
 * `HandoverGateTest` beside this reads the source text of `attemptHandover` and asserts
 * its shape. That lint was made considerably stronger after review — it now fails if the
 * Supabase helper is present but never called, and if its answer is discarded — but a
 * lint over text still cannot assert the one thing that matters:
 *
 *   **no request our own server receives ever contains the six digits.**
 *
 * That is not a stylistic preference. Sending the digits to us on a reprove demand is a
 * HARD LOCKOUT: the route reads the age of the last factor proof and never reads a code,
 * so a correct code comes back refused, forever, and the owner cannot hand over, close
 * or release anything. The property was wrong on three clients at once, twice, while
 * every suite was green.
 *
 * ## Two servers, deliberately
 *
 * One MockWebServer is OURS and one is GoTrue. A single server routing both by path
 * would make the central assertion meaningless — "our server never saw the digits" only
 * says something if there is a different server that did. So `ours` and `gotrue` are
 * separate, and `AppGraph` is pointed at them by the seam #593 asked for: the two base
 * URLs are constructor parameters defaulting to `BuildConfig`, so nothing shipped
 * changes.
 *
 * ## What is real here
 *
 * The graph, the OkHttp clients, `SupabaseAuth`, `ApiClient`, `SettingsRepository`, the
 * session store, and `attemptHandover` itself. The only doubles are the two HTTP servers
 * and the session source. In particular the `attempt` closure calls the REAL repository,
 * so the request our server records is the request the product would have sent.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HandoverFunnelRunTest {
    /** The digits somebody reads off their authenticator. */
    private val code = "864209"

    private lateinit var ours: MockWebServer
    private lateinit var gotrue: MockWebServer
    private lateinit var graph: AppGraph

    /** Every request each server actually received, with its body. */
    private val oursSaw = CopyOnWriteArrayList<Pair<String, String>>()
    private val gotrueSaw = CopyOnWriteArrayList<Pair<String, String>>()

    /** How many times the action itself was attempted, and with what. */
    private val attempts = CopyOnWriteArrayList<String?>()

    private fun body(request: RecordedRequest): String =
        request.body?.utf8() ?: ""

    /**
     * Our API, refusing on the rule the real route uses: THE AGE OF THE PROOF IN THE
     * TOKEN, not a counter.
     *
     * The first version of this router refused only the first attempt and then succeeded,
     * and that hid the recovery arm entirely — the second post came back 200, so the
     * `catch` never ran and the divert never happened. A "refuse once" server is not the
     * server this funnel talks to. This one refuses every attempt presenting the stale
     * token and accepts any attempt presenting the fresh one, which is what makes both
     * the prevention path and the recovery path reachable — and what makes a retry that
     * re-posted the digits fail instead of quietly passing.
     */
    private fun ourRouter() = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.url.encodedPath
            oursSaw += path to body(request)
            val proved = request.headers["Authorization"] == "Bearer token-2"
            return when {
                path == "/v1/company/ownership/accept" ->
                    if (!proved) {
                        MockResponse(
                            code = 403,
                            body = """{"error":{"code":"mfa_reprove_required",""" +
                                """"message":"Confirm with your authenticator app."}}""",
                        )
                    } else {
                        MockResponse(body = """{"owner_user_id":"user-2"}""")
                    }
                // GET /v1/mfa lists VERIFIED factors only, so the first is a real one.
                path == "/v1/mfa" -> MockResponse(
                    body = """{"enrolled":true,"factors":[{"id":"factor-1",""" +
                        """"friendly_name":"Phone","status":"verified"}]}""",
                )
                else -> MockResponse(code = 404, body = """{"error":"not in this test"}""")
            }
        }
    }

    /** GoTrue. Challenge then verify, and verify hands back a fresh session. */
    private fun gotrueRouter() = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.url.encodedPath
            gotrueSaw += path to body(request)
            return when {
                path.endsWith("/challenge") -> MockResponse(body = """{"id":"chal-1"}""")
                path.endsWith("/verify") -> MockResponse(
                    body = """{"access_token":"token-2","refresh_token":"refresh-2",""" +
                        """"expires_in":3600,"user":{"id":"user-1",""" +
                        """"email":"owner@example.com"}}""",
                )
                else -> MockResponse(code = 404, body = """{"error":"not in this test"}""")
            }
        }
    }

    /**
     * NO fake session source, and that is the point.
     *
     * `proveFactorThenRetry` reads the token through `scope.graph.api.freshSession()` and
     * saves the fresh one through `scope.graph.sessionStore`. A test that handed the
     * REPOSITORY a different store would look signed out to the funnel and fail before
     * reaching Supabase at all — which is exactly what happened on the first run of this
     * file. Production has one store; so does this.
     *
     * The real `SessionStore` is DataStore-backed and works under Robolectric.
     */
    private fun seedSession() = runBlocking {
        graph.sessionStore.save(
            Session(
                accessToken = "token-1",
                refreshToken = "refresh-1",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "user-1",
                email = "owner@example.com",
            ),
        )
    }

    @Before
    fun setUp() {
        ours = MockWebServer()
        ours.dispatcher = ourRouter()
        ours.start()
        gotrue = MockWebServer()
        gotrue.dispatcher = gotrueRouter()
        gotrue.start()
        graph = AppGraph(
            ApplicationProvider.getApplicationContext(),
            supabaseUrl = gotrue.url("/").toString().trimEnd('/'),
            apiUrl = ours.url("/").toString().trimEnd('/'),
        )
        seedSession()
    }

    @After
    fun tearDown() {
        ours.close()
        gotrue.close()
    }

    /** The graph's own client, pointed at `ours` — one of everything, like the app. */
    private fun repository() = SettingsRepository(graph.api)

    private fun scope() = SettingsScope(
        graph = graph,
        repo = repository(),
        companyId = "c1",
        me = Me(
            user_id = "user-1",
            display_name = "Sam",
            memberships = listOf(
                Membership(
                    company_id = "c1",
                    name = "Northside Plumbing",
                    role = MemberRole.OWNER,
                    subscription_status = SubscriptionStatus.ACTIVE,
                ),
            ),
        ),
        role = MemberRole.OWNER,
        showMessage = {},
    )

    /**
     * The real accept, recorded. This is what a screen hands the funnel, so the request
     * our server sees is the request the product sends.
     */
    private fun proof(scope: SettingsScope) = HandoverProof(
        action = "accept",
        label = "You now own this workspace.",
    ) { sent ->
        attempts += sent
        scope.repo.acceptOwnership(scope.companyId, sent)
    }

    /** A proof carrying the kind the server named, which is what every screen does. */
    private fun proofFor(
        scope: SettingsScope,
        kind: HandoverConfirmation.Kind,
    ) = HandoverProof(
        action = "accept",
        label = "You now own this workspace.",
        kind = kind,
    ) { sent ->
        attempts += sent
        scope.repo.acceptOwnership(scope.companyId, sent)
    }

    @Test
    fun `a stale-factor demand is answered at Supabase, and our server never sees the digits`() =
        runTest {
            val scope = scope()

            // First attempt, no code: the server refuses and NAMES the demand.
            val first = attemptHandover(
                scope,
                proofFor(scope, HandoverConfirmation.Kind.EMAIL),
                code = null,
                alreadyOpen = false,
            )
            assertTrue(
                "the refusal should ask for the authenticator again, got $first",
                first is HandoverOutcome.NeedsCode &&
                    first.kind == HandoverConfirmation.Kind.REPROVE,
            )

            // The owner reads six digits off their authenticator and submits them. The
            // screen carries forward the kind the refusal named — which is the property
            // `HandoverGateTest` pins for all three screens by name.
            val second = attemptHandover(
                scope,
                proofFor(scope, HandoverConfirmation.Kind.REPROVE),
                code = code,
                alreadyOpen = true,
            )
            assertEquals(HandoverOutcome.Done, second)

            // THE ASSERTION THIS FILE EXISTS FOR. Every byte our own server received,
            // across every request, and the digits are in none of it.
            val leaked = oursSaw.filter { it.second.contains(code) }
            assertTrue(
                "our server received the authenticator digits in ${leaked.size} request(s): " +
                    leaked.joinToString { it.first } +
                    ". That route reads the AGE of the last factor proof and never reads a " +
                    "code, so this is the forever loop: a correct code refused every time.",
                leaked.isEmpty(),
            )

            // They went to GoTrue instead — challenged, then verified WITH the digits.
            assertTrue(
                "GoTrue was never asked to challenge the factor: $gotrueSaw",
                gotrueSaw.any { it.first.endsWith("/challenge") },
            )
            val verify = gotrueSaw.singleOrNull { it.first.endsWith("/verify") }
            assertTrue("GoTrue was not asked to verify exactly once: $gotrueSaw", verify != null)
            assertTrue(
                "the verify call did not carry the digits: ${verify!!.second}",
                verify.second.contains(code),
            )

            // The fresh session was SAVED. Without this the app keeps presenting the old
            // token, the retry is refused exactly as before, and the loop closes anyway.
            assertEquals("token-2", runBlocking { graph.sessionStore.current() }?.accessToken)

            // And the retry carried NO code — the second thing that makes it terminate.
            assertEquals(listOf(null, null), attempts.toList())
        }

    @Test
    fun `a screen that carries the WRONG kind forward is still recovered, one request late`() =
        runTest {
            /**
             * The Android-only re-check inside the `catch`, run rather than read — and
             * the reason it is a RECOVERY rather than a prevention, stated precisely.
             *
             * A screen that rebuilds its request each attempt arrives still holding the
             * default demand. The up-front question then says "ours to check", the digits
             * are posted, and only the refusal's own named kind reveals the mistake. The
             * person is fine: they are not asked again and not locked out. But those
             * digits DID reach our server once, which is exactly why the test above
             * carries the kind forward instead of relying on this.
             *
             * iOS has no equivalent of this arm yet (#593's parity half). Pinning what
             * Android's is actually worth is what stops the iOS version being written to
             * a standard nobody checked.
             */
            val scope = scope()
            attemptHandover(
                scope,
                proofFor(scope, HandoverConfirmation.Kind.EMAIL),
                code = null,
                alreadyOpen = false,
            )
            val recovered = attemptHandover(
                scope,
                // The wrong kind — the default, not the one the refusal named.
                proofFor(scope, HandoverConfirmation.Kind.EMAIL),
                code = code,
                alreadyOpen = true,
            )

            // It completes. The owner is not asked twice and not locked out.
            assertEquals(HandoverOutcome.Done, recovered)
            // And the digits reached Supabase, which is what actually satisfied the demand.
            assertTrue(
                "the catch-path re-check never diverted to Supabase: $gotrueSaw",
                gotrueSaw.any { it.first.endsWith("/verify") && it.second.contains(code) },
            )
            // Recorded honestly: exactly one request carried them to us before the
            // re-check saw the named kind. Recovery, not prevention.
            assertEquals(
                "the digits should reach our server exactly once on this path — more means " +
                    "the retry re-posted them, which is the forever loop",
                1,
                oursSaw.count { it.second.contains(code) },
            )
        }

    @Test
    fun `an emailed code IS ours to check, and goes to our server`() = runTest {
        // The other arm, so the tests above cannot pass by sending nothing anywhere. A
        // code we emailed is checked by us, and Supabase must not be involved at all.
        val scope = scope()
        val emailed = proofFor(scope, HandoverConfirmation.Kind.EMAIL)

        // One post carrying the code. What is asserted is only WHERE it went — the
        // router refuses it (the token is still the stale one), and that refusal is not
        // this test's subject.
        attemptHandover(scope, emailed, code = code, alreadyOpen = true)

        assertTrue(
            "an emailed code must reach our own server, and did not: $oursSaw",
            oursSaw.any { it.second.contains(code) },
        )
    }
}
