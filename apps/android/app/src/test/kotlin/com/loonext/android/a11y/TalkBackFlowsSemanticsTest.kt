package com.loonext.android.a11y

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.features.auth.AuthFrontDoorPreviewBody
import com.loonext.android.features.auth.AuthScreen
import com.loonext.android.features.inbox.GettingStartedCard
import com.loonext.android.features.inbox.GroupedRow
import com.loonext.android.features.inbox.StartedAudience
import com.loonext.android.features.inbox.StartedStep
import com.loonext.android.features.settings.roleLabelIn
import com.loonext.android.features.tasks.DoneCircle
import com.loonext.android.features.tasks.MetaRow
import com.loonext.android.features.thread.AssigneeChip
import com.loonext.android.features.thread.DueChip
import com.loonext.android.features.thread.NobodyChip
import com.loonext.android.ui.common.ActionGroup
import com.loonext.android.ui.common.ListViewsMenu
import com.loonext.android.ui.common.ListViews
import com.loonext.android.ui.common.RecordAction
import com.loonext.android.ui.common.RecordMenuItems
import com.loonext.android.ui.common.ViewsMenuEntry
import com.loonext.android.ui.common.announcesChanges
import com.loonext.android.ui.common.cappedAtLargeText
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The second emulator TalkBack pass (2026-11-11): sign up and reset, bulk selection, the
 * message menu and the new-task sheet, task detail, French, and text at 200%. Each assertion
 * pins something TalkBack said or a screen drew wrongly; each failed before its fix.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TalkBackFlowsSemanticsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun show(content: @Composable () -> Unit) = compose.setContent { LoonextTheme { content() } }

    private fun hasRole(role: Role) =
        SemanticsMatcher("has role $role") { it.config.getOrNull(SemanticsProperties.Role) == role }

    private fun selectedIs(value: Boolean) = SemanticsMatcher.expectValue(SemanticsProperties.Selected, value)

    private val isHeading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

    private val hasNoSelectedState = SemanticsMatcher("has no selected state") {
        !it.config.contains(SemanticsProperties.Selected)
    }

    /** Runs [content] at the given text scale. */
    @Composable
    private fun AtFontScale(scale: Float, content: @Composable () -> Unit) {
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, scale)) { content() }
    }

    // Sign up and reset

    @Test fun `the sign in footer is one button, not a lead-in and a link`() {
        show { AuthFrontDoorPreviewBody(AuthScreen.Login) }
        compose.onNode(hasContentDescription("New to Loonext? Create your account"))
            .assert(hasRole(Role.Button))
            .assert(hasClickAction())
        compose.onAllNodes(hasText("New to Loonext?")).assertCountEquals(0)
    }

    @Test fun `the sign up footer is one button`() {
        show { AuthFrontDoorPreviewBody(AuthScreen.SignUp) }
        compose.onNode(hasContentDescription("Already have an account? Sign in"))
            .assert(hasRole(Role.Button))
            .assert(hasClickAction())
        compose.onAllNodes(hasText("Already have an account?")).assertCountEquals(0)
    }

    @Test fun `the reset footer is one button`() {
        show { AuthFrontDoorPreviewBody(AuthScreen.Forgot) }
        compose.onNode(hasContentDescription("Remembered it? Back to sign in"))
            .assert(hasRole(Role.Button))
            .assert(hasClickAction())
        compose.onAllNodes(hasText("Remembered it?")).assertCountEquals(0)
    }

    // Bulk selection

    @Test fun `a row says whether it is selected once a selection is open`() {
        show {
            Column {
                GroupedRow(first = true, last = false, onClick = {}, selected = true, selecting = true) {
                    Text("Picked row")
                }
                GroupedRow(first = false, last = true, onClick = {}, selected = false, selecting = true) {
                    Text("Other row")
                }
            }
        }
        compose.onNode(hasText("Picked row")).assert(selectedIs(true))
        compose.onNode(hasText("Other row")).assert(selectedIs(false))
    }

    @Test fun `a row says nothing about selection when none is open`() {
        show {
            GroupedRow(first = true, last = true, onClick = {}, onLongClick = {}) { Text("Plain row") }
        }
        compose.onNode(hasText("Plain row")).assert(hasNoSelectedState)
    }

    @Test fun `the selection count is a live region`() {
        show { Text("2 selected", Modifier.announcesChanges()) }
        val config = compose.onNode(hasText("2 selected")).fetchSemanticsNode().config
        assertTrue(config.contains(SemanticsProperties.LiveRegion))
    }

    @Test fun `a task done box says whether it is checked`() {
        show {
            Column {
                DoneCircle(done = true, onToggle = {}, modifier = Modifier.testTag("done"))
                DoneCircle(done = false, onToggle = {}, modifier = Modifier.testTag("open"))
            }
        }
        compose.onNodeWithTag("done").assert(hasRole(Role.Checkbox))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, ToggleableState.On))
        compose.onNodeWithTag("open")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, ToggleableState.Off))
        // One name for both states: the state says the rest.
        compose.onNodeWithTag("done").assert(hasContentDescription(AppStrings.translate("en", "contactsTasks.markDone")))
    }

    // The message menu

    @Test fun `a menu state is a check box`() {
        show {
            Column {
                RecordMenuItems(
                    actions = listOf(
                        RecordAction("done", "recordMenu.done", ActionGroup.STATE, checked = false),
                        RecordAction("pin", "recordMenu.pin", ActionGroup.STATE, checked = true),
                    ),
                    onDismiss = {},
                    onSelect = { _, _ -> },
                )
            }
        }
        val toggles = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ToggleableState))
            .fetchSemanticsNodes()
        assertEquals(2, toggles.size)
        toggles.forEach { assertEquals(Role.Checkbox, it.config.getOrNull(SemanticsProperties.Role)) }
    }

    // The new-task sheet

    @Test fun `assignee and due choices say they are buttons and which one is on`() {
        show {
            Column {
                AssigneeChip("Dana Brightside", selected = true, onClick = {})
                AssigneeChip("Sam Rivera", selected = false, onClick = {})
                NobodyChip(selected = false, onClick = {})
                DueChip("Today", selected = false, onClick = {})
                DueChip("Tomorrow 9 AM", selected = true, onClick = {})
            }
        }
        for ((name, on) in listOf(
            "Dana Brightside" to true, "Sam Rivera" to false, "Nobody yet" to false,
            "Today" to false, "Tomorrow 9 AM" to true,
        )) {
            compose.onNode(hasText(name) and hasClickAction(), useUnmergedTree = false)
                .assert(hasRole(Role.Button))
                .assert(selectedIs(on))
        }
    }

    @Test fun `a selected choice does not say selected twice`() {
        show { DueChip("Tomorrow 9 AM", selected = true, onClick = {}) }
        val icons = compose.onAllNodes(hasContentDescription("Selected"), useUnmergedTree = true)
        icons.assertCountEquals(0)
    }

    // Task detail

    @Test fun `a task detail row is a button only when it opens something`() {
        show {
            Column {
                MetaRow("Due", onClick = {}) { Text("No due date") }
                MetaRow("Created", onClick = null) { Text("Today") }
            }
        }
        compose.onNode(hasText("No due date") and hasClickAction()).assert(hasRole(Role.Button))
        compose.onAllNodes(hasText("Today") and hasClickAction()).assertCountEquals(0)
    }

    // The views button and the checklist

    @Test fun `the views button does not repeat its own name`() {
        val views = ListViews(
            entries = emptyList(), activeId = null, canSaveCurrent = false, canShare = false,
            onApply = {}, onSaveCurrent = {}, onDefault = {}, onRename = { _, _ -> },
            onShare = { _, _ -> }, onDelete = {},
        )
        show { ListViewsMenu(views) }
        val name = AppStrings.translate("en", "inbox.viewsMenu")
        compose.onNode(hasClickAction()).assert(hasContentDescription(name))
    }

    @Test fun `the views button names the saved view that is on`() {
        val views = ListViews(
            entries = listOf(ViewsMenuEntry("v1", "Mine")), activeId = "v1", canSaveCurrent = false,
            canShare = false, onApply = {}, onSaveCurrent = {}, onDefault = {},
            onRename = { _, _ -> }, onShare = { _, _ -> }, onDelete = {},
        )
        show { ListViewsMenu(views) }
        compose.onNode(hasClickAction()).assert(hasContentDescription("Views: Mine"))
    }

    @Test fun `the getting started card is a heading, a button to dismiss, and one progress line`() {
        show {
            GettingStartedCard(
                title = "Getting started",
                steps = listOf(
                    StartedStep("a", done = true, label = "Set your workspace up"),
                    StartedStep("b", done = false, label = "Send your first reply"),
                ),
                companyId = "co-test",
                kind = StartedAudience.SETUP,
            )
        }
        compose.onNode(hasText("Getting started")).assert(isHeading)
        compose.onNode(hasClickAction() and hasContentDescription("Dismiss", substring = true))
            .assert(hasRole(Role.Button))
        // The "1 of 2 done" line says it; the bar must not say it again.
        val bar = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo))
            .fetchSemanticsNode().config
        assertTrue("the bar must be hidden from the reader", bar.contains(SemanticsProperties.HideFromAccessibility))
    }

    // French

    @Test fun `the account sheet says the role in French`() {
        assertEquals("Propriétaire", roleLabelIn("fr-CA", "owner"))
        assertNotEquals("Owner", roleLabelIn("fr-CA", "owner"))
        assertEquals("Owner", roleLabelIn("en", "owner"))
    }

    // Text at 200%

    @Test fun `a header above a list holds to a share of the screen at 200 percent`() {
        lateinit var limitPx: () -> Float
        show {
            val config = LocalConfiguration.current
            val density = LocalDensity.current
            limitPx = { config.screenHeightDp * 0.3f * density.density }
            AtFontScale(2f) {
                Box(Modifier.testTag("header").fillMaxWidth().cappedAtLargeText()) {
                    Column { repeat(60) { Text("Line $it", Modifier.height(40.dp)) } }
                }
            }
        }
        val height = compose.onNodeWithTag("header").fetchSemanticsNode().size.height
        assertTrue("$height px is over the share", height <= limitPx() + 1f)
    }

    @Test fun `a header is left whole at the default text size`() {
        lateinit var limitPx: () -> Float
        show {
            val config = LocalConfiguration.current
            val density = LocalDensity.current
            limitPx = { config.screenHeightDp * 0.3f * density.density }
            Box(Modifier.testTag("header").fillMaxWidth().cappedAtLargeText()) {
                Column { repeat(6) { Text("Line $it", Modifier.height(60.dp)) } }
            }
        }
        val height = compose.onNodeWithTag("header").fetchSemanticsNode().size.height
        assertTrue("$height px was capped at 100%", height > limitPx())
    }

    @Test fun `no scroll action is added at the default text size`() {
        show { Box(Modifier.testTag("header").cappedAtLargeText()) { Text("Short") } }
        val config = compose.onNodeWithTag("header").fetchSemanticsNode().config
        assertNull(config.getOrNull(SemanticsActions.ScrollBy))
    }
}
