package com.loonext.android.features.compose

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.net.ApiClient
import com.loonext.android.features.tasks.ReferenceRepository
import com.loonext.android.features.tasks.ReferenceSource
import com.loonext.android.features.thread.PickedMention
import com.loonext.android.ui.theme.LoonextTheme
import kotlinx.coroutines.CompletableDeferred
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
 * #690: a `#` typed into a text to a customer is a `#`.
 *
 * The composer is handed a live reference source. In Text mode typing
 * "#T-142" must leave the words exactly as typed and must not open the picker,
 * which would show as a search to the server. The same source in Note mode does
 * search, which proves this test can see a picker when there is one.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ComposerReferencesTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private class Sessions : SessionSource {
        val flow = MutableStateFlow<Session?>(
            Session("token-1", "refresh-1", System.currentTimeMillis() / 1000 + 3600, "user-1", "a@b.c"),
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

    private object NoDrafts : ComposerDrafts {
        override suspend fun load(conversationId: String) = ""
        override suspend fun save(conversationId: String, text: String) = Unit
        override suspend fun clear(conversationId: String) = Unit
        override suspend fun loadMentions(conversationId: String) = emptyList<PickedMention>()
        override suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>) = Unit
    }

    private lateinit var server: MockWebServer
    private lateinit var source: ReferenceSource

    @Before
    fun setUp() {
        server = MockWebServer().also {
            it.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    MockResponse(body = """{"data":[],"conversations":[],"contacts":[],"tasks":[]}""")
            }
            it.start()
        }
        val api = ApiClient(
            http = OkHttpClient(),
            baseUrl = server.url("/").toString().trimEnd('/'),
            sessionStore = Sessions(),
            supabaseAuth = SupabaseAuth(OkHttpClient(), server.url("/gotrue").toString(), "pk"),
        )
        source = ReferenceSource(ReferenceRepository(api), "co-1") {}
    }

    @After
    fun tearDown() {
        server.close()
    }

    private fun show(
        state: ComposerState,
        noteOnly: Boolean = false,
        onSend: suspend (String) -> Boolean = { true },
    ) {
        compose.setContent {
            LoonextTheme {
                ThreadComposer(
                    state = state,
                    noteOnly = noteOnly,
                    banner = null,
                    contactName = "Dana Whitcomb",
                    businessName = "Loonext Fencing",
                    loadTemplates = { emptyList() },
                    onSendText = { body, _, _, _ -> onSend(body) },
                    onSaveNote = { _, _, _, _ -> },
                    onNotice = {},
                    references = source,
                )
            }
        }
    }

    @Test
    fun `send clears the composer only after the outbox accepts it`() {
        val state = ComposerState("offline-text", NoDrafts)
        val saved = CompletableDeferred<Boolean>()
        var attempts = 0
        show(state) { body ->
            assertEquals("On my way", body)
            attempts++
            if (attempts == 1) saved.await() else true
        }
        compose.onNode(hasSetTextAction()).performTextInput("On my way")
        compose.onNodeWithContentDescription("Send message").performClick()
        compose.runOnIdle {
            assertEquals(1, attempts)
            assertEquals("On my way", state.text)
            saved.complete(false)
        }
        compose.runOnIdle { assertEquals("On my way", state.text) }
        compose.onNodeWithContentDescription("Send message").performClick()
        compose.runOnIdle {
            assertEquals(2, attempts)
            assertEquals("", state.text)
        }
    }

    @Test
    fun `a hash in a text to a customer stays plain and searches nothing`() {
        val state = ComposerState("customer-text", NoDrafts)
        show(state)
        compose.onNode(hasSetTextAction()).performTextInput("#T-142")
        compose.waitForIdle()
        // Past the picker's debounce, in both clocks, so a search that was going to happen has.
        compose.mainClock.advanceTimeBy(1_000)
        Thread.sleep(500)
        compose.waitForIdle()

        assertEquals("#T-142", state.text)
        assertEquals(ComposerMode.Text, state.mode)
        assertEquals("no reference lookup may run for a customer text", 0, server.requestCount)
        compose.onNode(hasText("Nothing matches.")).assertDoesNotExist()
    }

    @Test
    fun `the same hash in an internal note does open the picker`() {
        val state = ComposerState("internal-note", NoDrafts)
        show(state)
        compose.onNodeWithContentDescription("Add to message").performClick()
        compose.onNodeWithText("Note").performClick()
        compose.onNode(hasSetTextAction()).performTextInput("see #T-1")
        compose.waitForIdle()
        // The picker waits a beat after the last keystroke before it searches.
        compose.mainClock.advanceTimeBy(1_000)
        val deadline = System.currentTimeMillis() + 5_000
        while (server.requestCount == 0 && System.currentTimeMillis() < deadline) {
            Thread.sleep(50)
            compose.mainClock.advanceTimeBy(100)
            compose.waitForIdle()
        }
        assertEquals("see #T-1", state.text)
        assertEquals(ComposerMode.Note, state.mode)
        assertTrue("the picker searched", server.requestCount > 0)
    }

    @Test
    fun `composer menus switch both ways without losing the draft`() {
        val state = ComposerState("mode-switch", NoDrafts)
        show(state)

        compose.onNodeWithText("Note").assertDoesNotExist()
        compose.onNode(hasSetTextAction()).performTextInput("Ready to review")
        compose.onNodeWithContentDescription("Add to message").performClick()
        compose.onNodeWithText("Take photo").assertExists()
        compose.onNodeWithText("Note").performClick()
        compose.onNodeWithText("Note").performClick()
        compose.onNodeWithText("Take photo").assertExists()
        compose.onNodeWithText("Text").performClick()

        assertEquals(ComposerMode.Text, state.mode)
        assertEquals("Ready to review", state.text)
    }

    @Test
    fun `note only keeps attachments and hides the mode switch`() {
        show(ComposerState("note-only", NoDrafts), noteOnly = true)

        compose.onNodeWithContentDescription("Add to message").assertDoesNotExist()
        compose.onNodeWithContentDescription("Attach files to this note").performClick()
        compose.onNodeWithText("Take photo").assertExists()
        compose.onNodeWithText("Text").assertDoesNotExist()
    }
}
