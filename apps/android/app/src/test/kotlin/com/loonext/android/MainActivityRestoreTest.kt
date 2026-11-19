package com.loonext.android

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionPreferencesRule
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.features.settings.MfaState
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
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
@Config(sdk = [34], application = LoonextApp::class, qualifiers = "w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MainActivityRestoreTest {
    private val viewer = Me(
        user_id = "member",
        display_name = "Sam Rivera",
        memberships = listOf(Membership("workspace", "Northside Plumbing", "owner", SubscriptionStatus.ACTIVE)),
        flags = mapOf("kill:realtime" to false),
    )

    @get:Rule
    val compose = createEmptyComposeRule()

    @get:Rule
    val sessionPreferences = SessionPreferencesRule()

    @Test
    fun `recreation keeps the second task above the original launch link`() {
        val app = ApplicationProvider.getApplicationContext<LoonextApp>()
        val originalGraph = app.graph
        // The default graph would warm the workspace using its configured API.
        runBlocking { originalGraph.appScope.coroutineContext.job.cancelAndJoin() }
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    when (request.url.encodedPath) {
                        "/v1/me" -> MockResponse(body = Json.encodeToString(viewer))
                        "/v1/mfa" -> MockResponse(body = Json.encodeToString(MfaState()))
                        "/v1/tasks/first" -> MockResponse(body = taskBody("first", "Check the service panel"))
                        "/v1/tasks/second" -> MockResponse(body = taskBody("second", "Confirm the site visit"))
                        else -> MockResponse(code = 404, body = """{"error":"not in this test"}""")
                    }
            }
            server.start()
            val graph = AppGraph(
                app = app,
                supabaseUrl = server.url("/gotrue").toString(),
                apiUrl = server.url("/").toString().trimEnd('/'),
                sessionPreferences = sessionPreferences.dataStore,
            )
            ReflectionHelpers.setField(app, "graph", graph)
            try {
                runBlocking {
                    graph.sessionStore.save(Session(
                        accessToken = "test-session",
                        refreshToken = "test-refresh",
                        expiresAt = Long.MAX_VALUE,
                        userId = viewer.user_id,
                        email = "sam@example.com",
                    ))
                }
                ActivityScenario.launch<MainActivity>(taskIntent(app, "first")).use { scenario ->
                    awaitTask("Check the service panel")
                    scenario.onActivity { activity ->
                        ReflectionHelpers.callInstanceMethod<Any?>(
                            activity,
                            "onNewIntent",
                            ReflectionHelpers.ClassParameter.from(Intent::class.java, taskIntent(app, "second")),
                        )
                    }
                    awaitTask("Confirm the site visit")
                    scenario.recreate()
                    awaitTask("Confirm the site visit")
                    compose.onAllNodesWithText("Check the service panel").assertCountEquals(0)
                }
            } finally {
                runBlocking { graph.appScope.coroutineContext.job.cancelAndJoin() }
                ReflectionHelpers.setField(app, "graph", originalGraph)
            }
        }
    }

    private fun awaitTask(title: String) {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun taskIntent(app: LoonextApp, id: String): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("https://app.loonext.com/tasks/$id"), app, MainActivity::class.java)

    private fun taskBody(id: String, title: String): String = Json.encodeToString(TaskDetail(
        id = id,
        company_id = "workspace",
        title = title,
        created_by_user_id = viewer.user_id,
        created_at = "2026-11-10T10:00:00Z",
        updated_at = "2026-11-10T10:00:00Z",
    ))
}
