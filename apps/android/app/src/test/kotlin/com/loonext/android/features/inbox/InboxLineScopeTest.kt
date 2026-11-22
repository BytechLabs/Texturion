package com.loonext.android.features.inbox

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import com.loonext.android.core.model.Me
import java.util.concurrent.CopyOnWriteArrayList
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
class InboxLineScopeTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun clearingOptionalFiltersKeepsMessagesOnTheSelectedPhoneLine() {
        val line = "line-a"
        val requestedLines = CopyOnWriteArrayList<String?>()
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                    "/v1/conversations" -> {
                        requestedLines.add(request.url.queryParameter("phone_number_id"))
                        MockResponse(body = """{"data":[]}""")
                    }
                    "/v1/members", "/v1/tags" -> MockResponse(body = """{"data":[]}""")
                    "/v1/scheduled-messages" -> MockResponse(body = """{"scheduled_messages":[]}""")
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
                            phoneLineId = line,
                        )
                    }
                }
                compose.waitUntil(timeoutMillis = 5000) { requestedLines.size >= 2 }

                compose.onNodeWithContentDescription("Remove Line filter").assertDoesNotExist()
                compose.onNodeWithText("Clear all").assertDoesNotExist()
                waitForEmptyState("Nothing waiting on you.")

                compose.onNodeWithContentDescription("Filter").performClick()
                compose.onNodeWithText("Unread only").performScrollTo().performClick()
                compose.onNodeWithText("Show conversations").performScrollTo().performClick()

                compose.onNodeWithContentDescription("Filters: 1 on").assertIsDisplayed()
                compose.onNodeWithContentDescription("Remove Unread only filter").assertIsDisplayed()
                waitForEmptyState("Nothing matches these filters.")
                compose.onNodeWithText("Clear all").performClick()

                waitForEmptyState("Nothing waiting on you.")
                compose.onNodeWithContentDescription("Filter").assertIsDisplayed()
                compose.onNodeWithText("Clear all").assertDoesNotExist()
                assertEquals(setOf(line), requestedLines.toSet())
            } finally {
                graph.appScope.cancel()
            }
        }
    }

    private fun waitForEmptyState(text: String) {
        compose.waitUntil(timeoutMillis = 5000) {
            compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(text).assertIsDisplayed()
    }
}
