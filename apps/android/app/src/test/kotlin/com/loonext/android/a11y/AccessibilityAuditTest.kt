package com.loonext.android.a11y

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Dialpad
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ContactSummary
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ConversationSnippet
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import com.loonext.android.core.model.Tag
import com.loonext.android.features.auth.AuthFrontDoorPreviewBody
import com.loonext.android.features.auth.AuthScreen
import com.loonext.android.features.calls.CallerAvatar
import com.loonext.android.features.calls.ControlCircle
import com.loonext.android.features.calls.EndCallPill
import com.loonext.android.features.calls.RingActionCircle
import com.loonext.android.features.compose.ComposerDrafts
import com.loonext.android.features.compose.ComposerState
import com.loonext.android.features.compose.ThreadComposer
import com.loonext.android.features.inbox.InboxAuditBody
import com.loonext.android.features.settings.SettingsIndex
import com.loonext.android.features.thread.DayDividerLine
import com.loonext.android.features.thread.EventLine
import com.loonext.android.features.thread.MessageBubble
import com.loonext.android.features.thread.PendingBubble
import com.loonext.android.features.thread.PendingSend
import com.loonext.android.features.thread.PickedMention
import com.loonext.android.ui.common.PreviewHarness
import com.loonext.android.ui.common.previewCompany
import com.loonext.android.ui.common.previewMe
import com.loonext.android.ui.common.previewUsage
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The primary flows (sign in, inbox, thread and composer, call controls,
 * settings) through [SemanticsAudit], drawn from the shipping composables with
 * fixture data. Fails on a nameless control, a target under 24dp, or text under
 * WCAG contrast. Not TalkBack: spoken output stays a manual pass.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h1400dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AccessibilityAuditTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun audit(surface: String, content: @Composable () -> Unit) {
        compose.setContent {
            LoonextTheme {
                Box(Modifier.width(360.dp).background(MaterialTheme.colorScheme.background)) { content() }
            }
        }
        report(surface)
    }

    private fun report(surface: String) {
        compose.waitForIdle()
        val report = SemanticsAudit.audit(compose)
        // Advice is printed so it is on the CI log, and fails nothing.
        println("A11Y-AUDIT $surface: ${report.failures.size} failures, ${report.advice.size} advice")
        report.failures.forEach { println("A11Y-AUDIT   FAIL $it") }
        report.advice.forEach { println("A11Y-AUDIT   advice $it") }
        assertTrue("$surface:\n" + report.failures.joinToString("\n"), report.failures.isEmpty())
    }

    // --- sign in -------------------------------------------------------------

    @Test fun `sign in`() = audit("sign-in") { AuthFrontDoorPreviewBody(AuthScreen.Login) }

    @Test fun `sign up`() = audit("sign-up") { AuthFrontDoorPreviewBody(AuthScreen.SignUp) }

    @Test fun `forgot password`() = audit("forgot") { AuthFrontDoorPreviewBody(AuthScreen.Forgot) }

    // --- inbox -----------------------------------------------------------------

    @Test fun `inbox list`() = audit("inbox") {
        InboxAuditBody(
            listOf(
                conversation("c1", "Dana Whitcomb", unread = true, snippet = "Can you come by Tuesday morning?"),
                conversation("c2", null, unread = false, snippet = "Thanks, payment sent.", closed = true),
            ),
        )
    }

    @Test fun `the status filter says which one is on`() {
        compose.setContent {
            LoonextTheme { InboxAuditBody(listOf(conversation("c1", "Dana Whitcomb", true, "Hi"))) }
        }
        // Selected is a colour change in the pill; a screen reader only knows
        // it from the semantics.
        compose.onNode(hasText("Open") and hasClickAction()).assertIsSelected()
        compose.onNode(hasText("Closed") and hasClickAction()).assertIsNotSelected()
    }

    // --- thread and composer ---------------------------------------------------

    @Test fun `thread messages`() = audit("thread") {
        Column(Modifier.fillMaxWidth()) {
            DayDividerLine("Today")
            bubble(message("m1", MessageDirection.INBOUND, "Can you come by Tuesday?"))
            bubble(message("m2", MessageDirection.OUTBOUND, "Yes, 9am works.", MessageStatus.DELIVERED))
            bubble(message("m3", MessageDirection.OUTBOUND, "On my way.", MessageStatus.FAILED))
            bubble(message("m4", MessageDirection.NOTE, "Gate code is 4411."))
            EventLine(text = "Assigned to Dana", timeIso = "2026-07-15T12:00:00Z")
            EventLine(
                text = "Missed call",
                timeIso = "2026-07-15T12:01:00Z",
                onClick = {},
                clickLabel = "Open the call",
            )
            PendingBubble(
                PendingSend("p1", "Sending this", 0, "2026-07-15T12:02:00Z", "k1", queued = true),
            )
        }
    }

    @Test fun composer() = audit("composer") {
        ThreadComposer(
            state = ComposerState("audit", NoDrafts),
            noteOnly = false,
            banner = null,
            contactName = "Dana Whitcomb",
            businessName = "Loonext Fencing",
            loadTemplates = { emptyList() },
            onSendText = { _, _, _, _ -> },
            onSaveNote = { _, _, _, _ -> },
            onNotice = {},
        )
    }

    // --- calls -------------------------------------------------------------------

    @Test fun `answer or decline a ringing call`() = audit("ringing") {
        Column(
            Modifier.fillMaxWidth().padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CallerAvatar("Jordan Lee", size = 96.dp, ringing = true)
            Spacer(Modifier.height(24.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                RingActionCircle(
                    icon = Icons.Outlined.CallEnd,
                    label = t("contactsTasks.decline"),
                    container = MaterialTheme.colorScheme.error,
                    content = MaterialTheme.colorScheme.onError,
                    labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    labelWeight = FontWeight.SemiBold,
                    size = 64.dp,
                    onClick = {},
                )
                RingActionCircle(
                    icon = Icons.Outlined.Call,
                    label = t("contactsTasks.answer"),
                    container = MaterialTheme.colorScheme.tertiary,
                    content = MaterialTheme.colorScheme.onTertiary,
                    labelColor = MaterialTheme.colorScheme.onBackground,
                    labelWeight = FontWeight.Bold,
                    size = 64.dp,
                    onClick = {},
                )
            }
        }
    }

    @Test fun `in-call controls`() = audit("in-call") {
        Column(
            Modifier.fillMaxWidth().padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CallerAvatar("Jordan Lee", size = 96.dp, badge = true)
            Spacer(Modifier.height(24.dp))
            Row(Modifier.fillMaxWidth()) {
                ControlCircle(
                    Icons.Outlined.Mic,
                    t("contactsTasks.mute"),
                    onClick = {},
                    contentDescription = t("contactsTasks.mute"),
                    modifier = Modifier.weight(1f),
                )
                ControlCircle(
                    Icons.Outlined.Dialpad,
                    t("contactsTasks.keypad"),
                    onClick = {},
                    contentDescription = t("contactsTasks.keypad"),
                    modifier = Modifier.weight(1f),
                )
                ControlCircle(
                    Icons.Outlined.Pause,
                    t("contactsTasks.hold"),
                    onClick = {},
                    contentDescription = t("contactsTasks.hold"),
                    active = true,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(18.dp))
            EndCallPill(onClick = {}, label = t("contactsTasks.endCall"), modifier = Modifier.fillMaxWidth())
        }
    }

    // --- settings ----------------------------------------------------------------

    @Test fun `settings index`() {
        compose.setContent {
            PreviewHarness {
                SettingsIndex(
                    company = previewCompany(),
                    me = previewMe(),
                    role = "owner",
                    usage = previewUsage(),
                    onHandOver = {},
                    unsentCount = { 0 },
                    onOpen = {},
                    onCopyNumber = {},
                )
            }
        }
        report("settings")
    }

    // --- fixtures ------------------------------------------------------------------

    private object NoDrafts : ComposerDrafts {
        override suspend fun load(conversationId: String) = ""
        override suspend fun save(conversationId: String, text: String) = Unit
        override suspend fun clear(conversationId: String) = Unit
        override suspend fun loadMentions(conversationId: String) = emptyList<PickedMention>()
        override suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>) = Unit
    }

    private fun message(id: String, direction: String, body: String, status: String? = null) = Message(
        id = id,
        conversation_id = "c1",
        direction = direction,
        body = body,
        status = status,
        created_at = "2026-07-15T12:00:00Z",
    )

    @Composable
    private fun bubble(message: Message) {
        MessageBubble(
            message = message,
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

    private fun conversation(
        id: String,
        name: String?,
        unread: Boolean,
        snippet: String,
        closed: Boolean = false,
    ) = ConversationListItem(
        id = id,
        company_id = "co",
        contact_id = "p-$id",
        phone_number_id = "n1",
        status = if (closed) "closed" else "open",
        is_spam = false,
        last_message_at = "2026-07-15T12:00:00Z",
        created_at = "2026-07-14T12:00:00Z",
        updated_at = "2026-07-15T12:00:00Z",
        contact = ContactSummary(id = "p-$id", name = name, phone_e164 = "+14155550134"),
        tags = if (unread) listOf(Tag(id = "t1", name = "Estimate", color = "#66801F")) else emptyList(),
        unread = unread,
        last_message = ConversationSnippet(
            id = "m-$id",
            direction = "inbound",
            body = snippet,
            created_at = "2026-07-15T12:00:00Z",
            has_attachments = false,
        ),
    )
}
