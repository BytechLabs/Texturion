package com.loonext.android

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionPreferencesRule
import com.loonext.android.core.model.MemberRole
import com.loonext.android.features.settings.MfaState
import com.loonext.android.ui.common.previewMe
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LoonextApp::class, qualifiers = "en-rUS-w320dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class BookkeeperSettingsNavigationTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @get:Rule
    val sessionPreferences = SessionPreferencesRule()

    @Test
    fun `billing returns to a stable settings root for a bookkeeper`() {
        val app = ApplicationProvider.getApplicationContext<LoonextApp>()
        val originalGraph = app.graph
        runBlocking { originalGraph.appScope.coroutineContext.job.cancelAndJoin() }
        val seed = previewMe()
        val company = requireNotNull(seed.company)
        val bookkeeper = seed.copy(
            memberships = listOf(seed.memberships.single().copy(role = MemberRole.BOOKKEEPER)),
        )
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                    "/v1/me" -> MockResponse(body = Json.encodeToString(bookkeeper))
                    "/v1/company" -> MockResponse(body = Json.encodeToString(company))
                    "/v1/mfa" -> MockResponse(body = Json.encodeToString(MfaState()))
                    else -> MockResponse(code = 404, body = """{"error":"not in this test"}""")
                }
            }
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val graph = AppGraph(app, origin, origin, sessionPreferences.dataStore)
            ReflectionHelpers.setField(app, "graph", graph)
            try {
                runBlocking {
                    graph.sessionStore.save(
                        Session(
                            accessToken = "bookkeeper-test",
                            refreshToken = "test-refresh",
                            expiresAt = Long.MAX_VALUE,
                            userId = bookkeeper.user_id,
                            email = "test@example.com",
                        ),
                    )
                }
                ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                    awaitHeading("Billing")
                    compose.onNodeWithContentDescription("Back").performClick()
                    awaitHeading("Settings")
                    compose.onAllNodesWithContentDescription("Back").assertCountEquals(0)
                    compose.onAllNodesWithText("Conversations").assertCountEquals(0)

                    scenario.recreate()
                    awaitHeading("Settings")
                    compose.onAllNodesWithContentDescription("Back").assertCountEquals(0)
                }
            } finally {
                runBlocking { graph.appScope.coroutineContext.job.cancelAndJoin() }
                ReflectionHelpers.setField(app, "graph", originalGraph)
            }
        }
    }

    private fun awaitHeading(title: String) {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()
        }
    }
}
