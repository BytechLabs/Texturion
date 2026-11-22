package com.loonext.android.features.settings

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TeamInviteLayoutTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `bookkeeper invite works at 320 dp in Canadian French with enlarged text`() {
        val locale = MessageLocale.FR_CA
        val graph = AppGraph(ApplicationProvider.getApplicationContext())
        val scope = SettingsScope(
            graph = graph,
            repo = SettingsRepository(graph.api),
            companyId = "company",
            me = Me("owner", "Owner", emptyList()),
            role = MemberRole.OWNER,
            showMessage = {},
        )
        val company = CompanyView(
            id = scope.companyId,
            name = "Plumbing",
            country = "CA",
            us_texting_enabled = false,
            requested_area_code = "416",
            timezone = "America/Toronto",
            plan = "pro",
            subscription_status = SubscriptionStatus.ACTIVE,
            created_at = "2026-01-01T00:00:00Z",
            updated_at = "2026-01-01T00:00:00Z",
        )
        compose.setContent {
            val density = Density(LocalDensity.current.density, fontScale = 1.3f)
            CompositionLocalProvider(LocalAppLocale provides locale, LocalDensity provides density) {
                LoonextTheme {
                    Column(Modifier.width(320.dp).verticalScroll(rememberScrollState())) {
                        InvitesCard(scope, company, emptyList(), emptyList(), onChanged = {})
                    }
                }
            }
        }

        compose.onNodeWithText(AppStrings.translate(locale, "settingsMore.email"))
            .performTextInput("bookkeeper")
        compose.onNodeWithText(AppStrings.translate(locale, "settingsMore.roleMember"))
            .performScrollTo().performClick()
        compose.onNodeWithText(AppStrings.translate(locale, "settingsMore.roleBookkeeper"))
            .performClick()
        val invite = compose.onNodeWithText(AppStrings.translate(locale, "settingsMore.invite"))
            .performScrollTo().assertIsDisplayed()
        val description = compose.onNodeWithText(
            AppStrings.translate(locale, "settingsMore.roleBookkeeperBlurb"),
        )
        val descriptionBottom = description.fetchSemanticsNode().boundsInRoot.bottom
        val inviteTop = invite.fetchSemanticsNode().boundsInRoot.top
        assertTrue(
            "Long role descriptions need their own row above the invite action",
            descriptionBottom <= inviteTop,
        )
        invite.performTouchInput { click() }
        compose.onNodeWithText(AppStrings.translate(locale, "settingsMore.enterTeammateEmail"))
            .performScrollTo().assertIsDisplayed()
    }
}
