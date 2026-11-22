package com.loonext.android.features.calls

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.LoonextApp
import com.loonext.android.core.model.MessageLocale
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LoonextApp::class, qualifiers = "w320dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CallActivityLocaleTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun `the standalone call uses the reader language for its title and controls`() {
        val app = ApplicationProvider.getApplicationContext<LoonextApp>()
        val prefs = app.graph.prefs
        val previousLocale = runBlocking { prefs.uiLocale.first() }
        val intent = CallActivity.intent(app, "incoming", callerName = "Sample Caller")
        try {
            runBlocking { prefs.setUiLocale(MessageLocale.FR_CA) }
            ActivityScenario.launch<CallActivity>(intent).use {
                awaitTitle("Appel entrant")
                compose.onNodeWithContentDescription("Répondre").assertIsDisplayed()
                compose.onNodeWithContentDescription("Refuser").assertIsDisplayed()

                runBlocking { prefs.setUiLocale(MessageLocale.EN) }
                awaitTitle("Incoming call")
                compose.onNodeWithContentDescription("Answer").assertIsDisplayed()
                compose.onNodeWithContentDescription("Decline").assertIsDisplayed()
            }
        } finally {
            runBlocking { prefs.setUiLocale(previousLocale) }
        }
    }

    private fun awaitTitle(title: String) {
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()
        }
    }
}
