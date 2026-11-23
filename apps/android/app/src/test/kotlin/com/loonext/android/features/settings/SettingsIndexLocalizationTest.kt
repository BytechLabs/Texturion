package com.loonext.android.features.settings

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SettingsIndexLocalizationTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the identity and phone handover follow the reader language`() {
        val locale = mutableStateOf(MessageLocale.FR_CA)
        val number = "+14165550123"
        val company = CompanyView(
            id = "company",
            name = "Plumbing",
            country = "CA",
            us_texting_enabled = false,
            requested_area_code = "416",
            timezone = "America/Toronto",
            plan = "pro",
            subscription_status = SubscriptionStatus.ACTIVE,
            created_at = "2026-01-01T00:00:00Z",
            updated_at = "2026-01-01T00:00:00Z",
            numbers = listOf(
                PhoneNumberSummary("line", NumberStatus.ACTIVE, "CA", number, created_at = "2026-01-01T00:00:00Z"),
            ),
        )
        compose.setContent {
            CompositionLocalProvider(LocalAppLocale provides locale.value) {
                LoonextTheme {
                    Box(Modifier.width(320.dp)) {
                        SettingsIndex(
                            company = company,
                            me = Me("owner", "Dana", emptyList()),
                            role = MemberRole.OWNER,
                            onHandOver = { error("The reader kept their session") },
                            unsentCount = { 1 },
                            usage = null,
                            onOpen = {},
                        )
                    }
                }
            }
        }

        val role = compose.onNodeWithText("Propriétaire · Plumbing").assertIsDisplayed()
        val numberNode = compose.onNodeWithText("(416) 555-0123").assertIsDisplayed()
        assertTrue(
            "The role needs room above the copy control at 320 dp",
            role.fetchSemanticsNode().boundsInRoot.bottom < numberNode.fetchSemanticsNode().boundsInRoot.top,
        )
        assertEquals(
            "Copier le numéro",
            numberNode.fetchSemanticsNode().config[SemanticsActions.OnLongClick].label,
        )
        compose.onNodeWithText("Confier ce téléphone à quelqu'un d'autre").performClick()
        compose.onNodeWithText("Confier ce téléphone ?").assertIsDisplayed()
        compose.onNodeWithText("Un message n'est pas encore envoyé", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Se déconnecter et tout effacer").assertIsDisplayed()
        compose.onNodeWithText("Rester connecté").performClick()
        compose.onNodeWithText("Confier ce téléphone ?").assertDoesNotExist()

        compose.runOnIdle { locale.value = MessageLocale.EN }
        compose.onNodeWithText("Owner · Plumbing").assertIsDisplayed()
        assertEquals(
            "Copy number",
            compose.onNodeWithText("(416) 555-0123").fetchSemanticsNode().config[SemanticsActions.OnLongClick].label,
        )
        compose.onNodeWithText("Hand this phone to someone else").assertIsDisplayed()
    }
}
