package com.loonext.android.features.settings

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.Usage
import com.loonext.android.ui.common.previewCompany
import com.loonext.android.ui.common.previewMe
import com.loonext.android.ui.theme.LoonextTheme
import java.time.Duration
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w320dp-h640dp-mdpi")
class UsageStatusCardLayoutTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the French fair use heading fits above the reset caption`() {
        var opened: SettingsSection? = null
        val usage = Usage(
            period_end = Instant.now().plus(Duration.ofDays(8).plusHours(1)).toString(),
            included_segments = 1_000,
        )
        compose.setContent {
            val density = Density(LocalDensity.current.density, fontScale = 1.3f)
            CompositionLocalProvider(
                LocalAppLocale provides MessageLocale.FR_CA,
                LocalDensity provides density,
            ) {
                LoonextTheme {
                    SettingsIndex(
                        company = previewCompany(),
                        me = previewMe(),
                        role = MemberRole.OWNER,
                        onHandOver = {},
                        unsentCount = { 0 },
                        usage = usage,
                        onOpen = { opened = it },
                    )
                }
            }
        }

        val heading = compose.onNodeWithText("USAGE RAISONNABLE", useUnmergedTree = true)
            .performScrollTo().assertIsDisplayed()
        val reset = compose.onNodeWithText("réinitialisation dans 8 jours", useUnmergedTree = true)
            .assertIsDisplayed()
        val layouts = mutableListOf<TextLayoutResult>()
        heading.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertEquals(1, layouts.single().lineCount)
        assertTrue(heading.fetchSemanticsNode().boundsInRoot.bottom <= reset.fetchSemanticsNode().boundsInRoot.top)
        heading.performTouchInput { click() }
        compose.runOnIdle { assertEquals(SettingsSection.Usage, opened) }
    }
}
