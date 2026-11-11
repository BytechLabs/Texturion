package com.loonext.android.a11y

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskSourceCall
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.features.contacts.ContactRow
import com.loonext.android.features.tasks.SourceCallCard
import com.loonext.android.features.tasks.TaskListRow
import com.loonext.android.ui.theme.LoonextTheme
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #238: TalkBack read "5m" on the calls, contacts and tasks screens as "5 m". Each row
 * draws the compact label but exposes the spoken time, which ends in the exact moment.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SpokenTimeSemanticsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun show(content: @Composable () -> Unit) = compose.setContent { LoonextTheme { content() } }

    private val fiveMinutesAgo: String = Instant.now().minusSeconds(5 * 60 + 5).toString()
    private val exact: String get() = TimestampFormat.exact(fiveMinutesAgo)

    private fun assertSpokenNotCompact() {
        compose.onAllNodes(hasContentDescription(exact, substring = true)).assertCountEquals(1)
        compose.onAllNodes(hasText("5m", substring = true)).assertCountEquals(0)
    }

    @Test fun `a call card in the tasks list speaks its time, not 5m`() {
        show {
            SourceCallCard(
                call = TaskSourceCall(
                    id = "k1",
                    call_session_id = "s1",
                    caller_name = "Priya",
                    started_at = fiveMinutesAgo,
                    forward_seconds = 90,
                ),
                linkLabel = null,
                onOpenConversation = null,
            )
        }
        assertSpokenNotCompact()
    }

    @Test fun `a contacts row speaks its last activity, not 5m`() {
        show {
            ContactRow(
                contact = Contact(
                    id = "c1",
                    phone_e164 = "+14165550123",
                    name = "Priya",
                    created_at = "2026-01-01T00:00:00Z",
                    updated_at = "2026-01-01T00:00:00Z",
                    last_activity_at = fiveMinutesAgo,
                ),
                onClick = {},
                menu = { _, _ -> },
            )
        }
        assertSpokenNotCompact()
    }

    @Test fun `a task row speaks its due time, not 5m`() {
        show {
            TaskListRow(
                task = Task(
                    id = "t1",
                    company_id = "co",
                    title = "Send the invoice",
                    due_at = fiveMinutesAgo,
                    created_by_user_id = "u1",
                    created_at = "2026-01-01T00:00:00Z",
                    updated_at = "2026-01-01T00:00:00Z",
                ),
                assigneeNames = emptyList(),
                onClick = {},
                onToggleDone = {},
            )
        }
        assertSpokenNotCompact()
    }
}
