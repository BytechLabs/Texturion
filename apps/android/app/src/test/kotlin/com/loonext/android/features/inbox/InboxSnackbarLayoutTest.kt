package com.loonext.android.features.inbox

import androidx.activity.ComponentActivity
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.auth.Session
import com.loonext.android.core.model.Me
import com.loonext.android.features.shell.MainShell
import com.loonext.android.features.shell.ShellCounts
import com.loonext.android.features.shell.ShellTab
import com.loonext.android.ui.common.MainActionButton
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w320dp-h640dp-mdpi")
class InboxSnackbarLayoutTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun cancellationConfirmationClearsTheNewConversationButton() {
        val text = "Tomorrow's follow-up"
        val canceled = AtomicBoolean()
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    when (request.url.encodedPath) {
                        "/v1/scheduled-messages" -> MockResponse(
                            body = if (canceled.get()) {
                                """{"scheduled_messages":[]}"""
                            } else {
                                """
                                {"scheduled_messages":[{
                                  "id":"pending","conversation_id":"thread","body":"$text",
                                  "send_at":"2030-12-01T16:00:00Z","clock_timezone":"America/Toronto","status":"pending"
                                }]}
                                """.trimIndent()
                            },
                        )
                        "/v1/scheduled-messages/pending" -> {
                            check(request.method == "DELETE")
                            canceled.set(true)
                            MockResponse(code = 204)
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
                val newConversation = "New conversation"
                compose.setContent {
                    MaterialTheme {
                        MainShell(
                            counts = ShellCounts(),
                            unreadNotifications = 0,
                            tab = ShellTab.Inbox,
                            onTabChange = {},
                            onCompose = {},
                            onOpenAccountSheet = {},
                            floatingAction = { MainActionButton(Icons.Outlined.Edit, newConversation, {}) },
                        ) { tab, modifier ->
                            if (tab == ShellTab.Inbox) {
                                InboxTab(
                                    graph = graph,
                                    companyId = "workspace",
                                    me = Me(user_id = "member", display_name = "Dana", memberships = emptyList()),
                                    destination = null,
                                    onDestinationConsumed = {},
                                    onOpenThread = { _, _, _ -> },
                                    onOpenTask = {},
                                    onComposeNew = {},
                                    modifier = modifier,
                                    phoneLineId = "line-a",
                                )
                            }
                        }
                    }
                }
                val scheduledButton = "1 text waiting to send"
                compose.waitUntil(timeoutMillis = 5000) {
                    compose.onAllNodesWithContentDescription(scheduledButton).fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithContentDescription(scheduledButton).performClick()
                compose.waitUntil(timeoutMillis = 5000) {
                    compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithText("Cancel").performClick()

                val confirmation = "Cancelled — that text will not go out."
                compose.waitUntil(timeoutMillis = 5000) {
                    compose.onAllNodesWithText(confirmation).fetchSemanticsNodes().isNotEmpty()
                }
                val notice = compose.onNodeWithText(confirmation).fetchSemanticsNode().boundsInRoot
                val action = compose.onNodeWithContentDescription(newConversation).fetchSemanticsNode().boundsInRoot
                assertTrue("The New conversation button covers the confirmation: $notice / $action", notice.bottom <= action.top)
            } finally {
                graph.appScope.cancel()
            }
        }
    }
}
