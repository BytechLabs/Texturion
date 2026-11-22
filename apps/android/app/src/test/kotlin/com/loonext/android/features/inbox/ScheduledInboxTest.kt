package com.loonext.android.features.inbox

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import com.loonext.android.core.model.Me
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ScheduledInboxTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun openingScheduledReloadsPendingTextsForTheSelectedLine() {
        val body = "Follow up about the kitchen sink"
        val queued = AtomicReference("""{"scheduled_messages":[]}""")
        val requestedLines = CopyOnWriteArrayList<String>()

        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                    "/v1/scheduled-messages" -> {
                        val response = queued.get()
                        requestedLines.add(request.url.queryParameter("phone_number_id").orEmpty())
                        MockResponse(body = response)
                    }
                    "/v1/conversations", "/v1/members", "/v1/tags" -> MockResponse(body = """{"data":[]}""")
                    else -> MockResponse(code = 404)
                }
            }
            server.start()
            val origin = server.url("/").toString().trimEnd('/')
            val graph = AppGraph(ApplicationProvider.getApplicationContext(), supabaseUrl = origin, apiUrl = origin)
            try {
                runBlocking {
                    graph.sessionStore.save(
                        Session(
                            accessToken = "test-token",
                            refreshToken = "test-refresh",
                            expiresAt = System.currentTimeMillis() / 1000 + 3600,
                            userId = "member",
                            email = "tester@loonext.test",
                        ),
                    )
                }
                compose.setContent {
                    MaterialTheme {
                        InboxTab(
                            graph = graph,
                            companyId = "workspace",
                            me = Me(user_id = "member", display_name = "Dana", memberships = emptyList()),
                            destination = null,
                            onDestinationConsumed = {},
                            onOpenThread = { _, _, _ -> },
                            onOpenTask = {},
                            onComposeNew = {},
                            phoneLineId = "line-a",
                        )
                    }
                }
                compose.waitUntil(timeoutMillis = 5000) { requestedLines.isNotEmpty() }
                val readsBeforeOpen = requestedLines.size
                queued.set(
                    """
                    {"scheduled_messages":[{
                      "id":"scheduled",
                      "conversation_id":"thread",
                      "body":"$body",
                      "send_at":"2030-12-01T16:00:00Z",
                      "clock_timezone":"America/Toronto",
                      "status":"pending"
                    }]}
                    """.trimIndent(),
                )

                compose.onNodeWithContentDescription("Scheduled").performClick()

                compose.waitUntil(timeoutMillis = 5000) {
                    compose.onAllNodesWithText(body).fetchSemanticsNodes().isNotEmpty()
                }
                assertEquals(List(readsBeforeOpen + 1) { "line-a" }, requestedLines.toList())
            } finally {
                graph.appScope.cancel()
            }
        }
    }
}
