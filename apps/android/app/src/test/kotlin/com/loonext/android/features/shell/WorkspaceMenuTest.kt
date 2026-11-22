package com.loonext.android.features.shell

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WorkspaceMenuTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val billing = Membership("books", "Fixture Books", "bookkeeper", "active")

    @Test
    fun `bookkeeper can select another membership from the localized menu`() {
        var selected: String? = null
        val technician = Membership("crew", "Fixture Crew", "member", "active")
        compose.setContent {
            CompositionLocalProvider(LocalAppLocale provides MessageLocale.FR_CA) {
                LoonextTheme {
                    WorkspaceMenu(listOf(billing, technician), billing.company_id) { selected = it }
                }
            }
        }
        compose.onNodeWithContentDescription("Espaces de travail: Fixture Books").performClick()
        compose.onNodeWithText("Fixture Crew").performClick()
        compose.runOnIdle { assertEquals(technician.company_id, selected) }
    }

    @Test
    fun `single workspace has no selector`() {
        compose.setContent {
            LoonextTheme { WorkspaceMenu(listOf(billing), billing.company_id) {} }
        }
        compose.onNodeWithContentDescription("Workspaces", substring = true).assertDoesNotExist()
    }
}
