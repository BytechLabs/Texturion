package com.loonext.android.features.auth

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.loonext.android.core.auth.AppPrefs
import com.loonext.android.core.auth.AuthManager
import com.loonext.android.core.auth.SessionPreferencesRule
import com.loonext.android.core.auth.SessionStore
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.theme.LoonextTheme
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "en-rUS-w360dp-h1400dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AuthFlowNavigationTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val sessionPreferences = SessionPreferencesRule()

    @Test
    fun `starting signup again opens a fresh form after confirmation`() = withAuthFlow { model, server ->
        server.enqueue(MockResponse(body = "{}"))
        compose.onNodeWithContentDescription("New to Loonext? Create your account").performClick()
        compose.runOnIdle { model.signUp("First owner", "first@example.com", "synthetic-password", "en") }
        awaitText("Check your email")

        compose.onNodeWithContentDescription("Back to sign in").performClick()
        compose.onNodeWithContentDescription("New to Loonext? Create your account").performClick()

        compose.onNodeWithText("Create account").assertIsDisplayed()
        compose.onAllNodesWithText("Check your email").assertCountEquals(0)
        compose.runOnIdle { model.resendConfirmation("en") }
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `reopening password reset clears the previous email banner`() = withAuthFlow { model, server ->
        val resetBanner = "If that email has an account, a reset link is on its way. Didn't get it? Check spam."
        server.enqueue(MockResponse(body = "{}"))
        compose.onNodeWithText("Forgot password?").performClick()
        compose.runOnIdle { model.sendReset("first@example.com", "en") }
        awaitText(resetBanner)

        compose.onNodeWithContentDescription("Back to sign in").performClick()
        compose.onNodeWithText("Forgot password?").performClick()

        compose.onNodeWithText("Send reset link").assertIsDisplayed()
        compose.onAllNodesWithText(resetBanner).assertCountEquals(0)
        assertEquals(1, server.requestCount)
    }

    private fun awaitText(text: String) {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun withAuthFlow(check: (AuthViewModel, MockWebServer) -> Unit) {
        MockWebServer().use { server ->
            server.start()
            val context = compose.activity.applicationContext
            val manager = AuthManager(
                SupabaseAuth(OkHttpClient(), server.url("/").toString().trimEnd('/'), "pk-test"),
                SessionStore(context, preferences = sessionPreferences.dataStore),
                AppPrefs(context),
            )
            val model = ViewModelProvider(
                compose.activity,
                viewModelFactory { initializer { AuthViewModel(manager) } },
            )[AuthViewModel::class]
            compose.setContent {
                CompositionLocalProvider(LocalAppLocale provides MessageLocale.EN) {
                    LoonextTheme { AuthFlow(model) }
                }
            }
            check(model, server)
        }
    }
}
