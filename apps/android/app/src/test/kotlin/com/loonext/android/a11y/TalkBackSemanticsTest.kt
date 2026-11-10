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
import com.loonext.android.core.model.Message
import com.loonext.android.features.inbox.InboxAuditBody
import com.loonext.android.features.auth.AuthFrontDoorPreviewBody
import com.loonext.android.features.auth.AuthScreen
import com.loonext.android.features.calls.ControlCircle
import com.loonext.android.features.tasks.FilterPill
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.features.thread.MessageBubble
import com.loonext.android.ui.common.spokenTime
import com.loonext.android.OverlayTitle
import com.loonext.android.features.onboarding.NotificationPrimer
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

    // --- the second round: order, times, hint and headings ---------------------

    @Composable
    private fun bubble(direction: String, status: String?) {
        MessageBubble(
            message = Message(
                id = "m1",
                conversation_id = "c1",
                direction = direction,
                body = "See you Thursday at 9",
                status = status,
                created_at = "2026-07-15T13:54:00Z",
            ),
            authorName = "Dana",
            doneByName = null,
            noteFilesState = null,
            onLoadNoteFiles = {},
            onLongPress = {},
            onRetry = {},
            mintAttachmentUrl = { "" },
            onOpenFile = {},
            onOpenAttachment = {},
        )
    }

    @Test fun `a message and its time and delivery are one stop`() {
        show { bubble("outbound", "delivered") }
        val stop = compose.onNode(hasText("See you Thursday at 9", substring = true) and hasClickAction())
            .fetchSemanticsNode()
        val spoken = stop.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString(" | ") { it.text }
        assertTrue(spoken, spoken.indexOf("See you") < spoken.indexOf("Delivered") && "Delivered" in spoken)
    }

    @Test fun `a time is spoken as a time in the readers locale`() {
        val now = java.time.Instant.parse("2026-07-15T23:00:00Z")
        val iso = "2026-07-15T21:42:00Z"
        val zone = java.time.ZoneId.systemDefault()
        val en = spokenTime(iso, "en", now)
        val fr = spokenTime(iso, "fr-CA", now)
        assertTrue(en, Regex("""\d{1,2}:\d{2}""").containsMatchIn(en) && !en.endsWith("h"))
        assertTrue(fr, Regex("""\d{1,2}\D+\d{2}""").containsMatchIn(fr))
        assertTrue("a different day carries its date", spokenTime("2026-07-01T21:42:00Z", "en", now).length > en.length)
        assertEquals(zone, java.time.ZoneId.systemDefault())
    }

    @Test fun `an inbox row speaks its time and not the compact form`() {
        show {
            InboxAuditBody(
                listOf(
                    ConversationListItem(
                        id = "c1", company_id = "co", contact_id = "p1", phone_number_id = "n1",
                        status = "open", is_spam = false,
                        last_message_at = java.time.Instant.now().minusSeconds(3 * 3600).toString(),
                        created_at = "2026-07-14T12:00:00Z", updated_at = "2026-07-15T12:00:00Z",
                        contact = ContactSummary(id = "p1", name = "Dana Whitcomb", phone_e164 = "+14155550134"),
                        tags = emptyList(), unread = false,
                        last_message = null,
                    ),
                ),
            )
        }
        val descriptions = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription), useUnmergedTree = true)
            .fetchSemanticsNodes().flatMap { it.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() }
        assertTrue(descriptions.toString(), descriptions.any { Regex("""\d{1,2}:\d{2}""").containsMatchIn(it) })
    }

    @Test fun `the go-to-message hint reads after double-tap to`() {
        for (locale in listOf("en", "fr-CA")) {
            val label = AppStrings.translate(locale, "thread.goToMessage")
            assertTrue(label, label.first().isLowerCase())
        }
    }

    @Test fun `the settings title is a heading`() {
        show { OverlayTitle("Settings") }
        compose.onNodeWithText("Settings").assert(isHeading)
    }

    @Test fun `the notification primer title is a heading`() {
        show { NotificationPrimer() }
        compose.onNode(isHeading).assertExists()
    }
}
