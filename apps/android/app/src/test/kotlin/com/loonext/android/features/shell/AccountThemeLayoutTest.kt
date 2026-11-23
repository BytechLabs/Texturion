package com.loonext.android.features.shell

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.common.previewMe
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w320dp-h640dp-mdpi")
class AccountThemeLayoutTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the French theme heading fits and all three themes can be selected on a narrow screen`() {
        val me = previewMe()
        compose.setContent {
            var theme by remember { mutableStateOf("light") }
            LoonextTheme(darkTheme = theme == "dark") {
                CompositionLocalProvider(LocalAppLocale provides MessageLocale.FR_CA) {
                    AccountSheetContent(
                        me = me,
                        companyId = me.memberships.single().company_id,
                        unreadNotifications = 0,
                        theme = theme,
                        onSelectTheme = { theme = it },
                        onOpenContacts = {},
                        onOpenNotifications = {},
                        onOpenSettings = {},
                        onSwitchWorkspace = {},
                        onSignOut = {},
                        onDismiss = {},
                    )
                }
            }
        }

        val heading = compose.onNodeWithText("Thème").assertIsDisplayed()
        val firstOption = compose.onNodeWithText("Système").assertIsDisplayed()
        val headingBottom = heading.fetchSemanticsNode().boundsInRoot.bottom
        val optionTop = firstOption.fetchSemanticsNode().boundsInRoot.top
        assertTrue(headingBottom <= optionTop)
        val layouts = mutableListOf<TextLayoutResult>()
        heading.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertEquals(1, layouts.single().lineCount)
        compose.onNodeWithText("Clair").assertIsSelected()
        for (label in listOf("Sombre", "Système", "Clair")) {
            compose.onNodeWithText(label).assertIsDisplayed().performClick().assertIsSelected()
        }
    }
}
