package com.loonext.android.a11y

import androidx.activity.ComponentActivity
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.loonext.android.core.model.ContactSummary
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ConversationSnippet
import com.loonext.android.features.inbox.InboxAuditBody
import com.loonext.android.features.auth.AuthFrontDoorPreviewBody
import com.loonext.android.features.auth.AuthScreen
import com.loonext.android.features.calls.ControlCircle
import com.loonext.android.features.tasks.FilterPill
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * What the emulator TalkBack pass heard, pinned as semantics: a control that was read
 * without its role, a choice that did not say which one was on, a title that was not
 * a heading, initials read as a word. Each assertion failed before its fix.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TalkBackSemanticsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun show(content: @Composable () -> Unit) = compose.setContent { LoonextTheme { content() } }

    private fun hasRole(role: Role) =
        SemanticsMatcher("has role $role") { it.config.getOrNull(SemanticsProperties.Role) == role }

    private val isHeading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

    @Test fun `screen titles and section headers are headings`() {
        show {
            ScreenTitle("Inbox")
            SectionHeader("Pinned", count = 1)
        }
        compose.onNodeWithText("Inbox").assert(isHeading)
        compose.onNode(hasText("PINNED", substring = true)).assert(isHeading)
    }

    @Test fun `a section header and its count are one stop`() {
        show { SectionHeader("Pinned", count = 1) }
        val spoken = compose.onNode(isHeading).fetchSemanticsNode().config
            .getOrNull(SemanticsProperties.Text).orEmpty().joinToString(" ") { it.text }
        assertTrue(spoken, "PINNED" in spoken && "1" in spoken)
    }

    @Test fun `initials are not read as a word`() {
        show { InitialsAvatar("Priya Natarajan") }
        val nodes = compose.onAllNodes(hasText("PN"), useUnmergedTree = false).fetchSemanticsNodes()
        assertTrue("initials must not be exposed to a screen reader", nodes.isEmpty())
    }

    @Test fun `a filter pill says it is a button and which one is on`() {
        show {
            FilterPill("Open", selected = true, onClick = {})
            FilterPill("Mine", selected = false, onClick = {})
        }
        compose.onNodeWithText("Open").assert(hasRole(Role.Button))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Selected, true))
        compose.onNodeWithText("Mine")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Selected, false))
    }

    @Test fun `an in-call toggle says whether it is on`() {
        show {
            ControlCircle(Icons.Outlined.Mic, "Mute", onClick = {}, active = true)
        }
        compose.onNode(hasRole(Role.Button))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Selected, true))
    }

    @Test fun `sign in controls are buttons and the headline is a heading`() {
        show { AuthFrontDoorPreviewBody(AuthScreen.Login) }
        compose.onNodeWithText("Sign in").assert(hasRole(Role.Button))
        compose.onNodeWithText("Continue with Google").assert(hasRole(Role.Button))
        compose.onNodeWithText("Forgot password?").assert(hasRole(Role.Button))
        compose.onNode(isHeading).assert(hasText("Your number", substring = true))
    }

    @Test fun `a sign-in field label is not a second stop`() {
        show { AuthFrontDoorPreviewBody(AuthScreen.Login) }
        val label = compose.onNode(hasText("WORK EMAIL")).fetchSemanticsNode().config
        assertTrue(
            "the field carries its own name, so the label must be hidden from the reader",
            label.contains(SemanticsProperties.HideFromAccessibility),
        )
    }

    @Test fun `an inbox row exposes its swipe actions to the reader`() {
        show {
            InboxAuditBody(
                listOf(
                    ConversationListItem(
                        id = "c1", company_id = "co", contact_id = "p1", phone_number_id = "n1",
                        status = "open", is_spam = false,
                        last_message_at = "2026-07-15T12:00:00Z",
                        created_at = "2026-07-14T12:00:00Z", updated_at = "2026-07-15T12:00:00Z",
                        contact = ContactSummary(id = "p1", name = "Dana Whitcomb", phone_e164 = "+14155550134"),
                        tags = emptyList(), unread = true,
                        last_message = ConversationSnippet(
                            id = "m1", direction = "inbound", body = "Can you come by Tuesday?",
                            created_at = "2026-07-15T12:00:00Z", has_attachments = false,
                        ),
                    ),
                ),
            )
        }
        val row = compose.onNode(hasText("Dana Whitcomb", substring = true) and hasClickAction())
            .fetchSemanticsNode()
        val actions = row.config.getOrNull(SemanticsActions.CustomActions).orEmpty()
        assertEquals(actions.map { it.label }.toString(), 2, actions.size)
    }
}
