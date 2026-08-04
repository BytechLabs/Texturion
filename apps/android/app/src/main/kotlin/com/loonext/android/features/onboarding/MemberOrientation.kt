package com.loonext.android.features.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.StickyNote2
import com.loonext.android.AppGraph
import com.loonext.android.features.calls.rememberNotificationAsk
import kotlinx.coroutines.launch

/**
 * #286 — what a new tech gets instead of nothing.
 *
 * "An invited member sees a short, skippable, member-specific orientation on
 * first sign-in."
 *
 * WHO THIS IS FOR, AND WHY IT IS NOT THE OWNER'S FLOW. The owner walked a
 * five-step wizard and chose this product. The tech had it chosen for them:
 * they are on a job site, on a phone, mildly annoyed, and their opinion in the
 * first ten minutes decides whether the crew adopts the tool or the owner ends
 * up as its only user.
 *
 * WHY IT ENDS ON NOTIFICATIONS. #286's other Acceptance line is "notification
 * permission is requested with context, not cold", and joining is the moment
 * that context exists — this is somebody walking into a workspace that already
 * has traffic. The system prompt fires from the button on the last screen, and
 * marks the same asked-before flag the standalone primer reads, so nobody is
 * asked twice.
 *
 * Copy hand-ported from apps/web/src/components/onboarding/member-orientation.tsx
 * and held word for word by packages/shared/src/member-orientation-copy.test.ts.
 */

private data class OrientationScreen(
    val title: String,
    val body: String,
    val icon: ImageVector,
)

private val SCREENS = listOf(
    OrientationScreen(
        "One inbox, the whole crew",
        "Every text your customers send lands here, and everyone on the crew " +
            "can see it. Nothing sits unanswered in one person's phone.",
        Icons.Outlined.Inbox,
    ),
    OrientationScreen(
        "You answer as the business",
        "Your replies go out from the workspace's number, so customers never " +
            "get your personal one. If a number isn't shared with you, " +
            "Settings tells you which and why.",
        Icons.Outlined.Phone,
    ),
    OrientationScreen(
        "Notes stay inside",
        "Switch the composer to Note and only the crew sees it — the customer " +
            "never does. Mention a teammate in one and it lands on their For you.",
        Icons.Outlined.StickyNote2,
    ),
    OrientationScreen(
        "You choose when we buzz you",
        "You're joining a workspace that already has traffic. Turn on " +
            "notifications for the work meant for you, and change them any " +
            "time in Settings.",
        Icons.Outlined.Notifications,
    ),
)

/**
 * Mounted on the ready shell, not on a screen: it belongs to the SESSION
 * rather than to whichever tab happened to be selected. Renders nothing at all
 * for everybody who has already been through it, which is almost everybody.
 *
 * @param oriented the server's answer for THIS membership, or null while the
 *   read is still in flight. Null renders nothing — flashing four screens at
 *   somebody who has been here for months, then taking them away, is worse
 *   than the wait.
 */
@Composable
fun MemberOrientation(
    graph: AppGraph,
    companyId: String,
    role: String?,
    oriented: Boolean?,
    onFinished: () -> Unit,
) {
    if (!shouldShowOrientation(role, oriented)) return

    var index by remember { mutableIntStateOf(0) }
    var closed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // Held from the first screen because the launcher must exist before the
    // last one needs it — but never fired until the button on that screen.
    val ask = rememberNotificationAsk()

    if (closed) return

    fun finish() {
        // Closed first, marked behind it. A failed write costs somebody a
        // repeat on their next sign-in; blocking the close on a network call
        // would cost them the app.
        closed = true
        onFinished()
        scope.launch {
            runCatching { graph.meRepo.markOriented(companyId) }
        }
    }

    val screen = SCREENS[index]
    val last = index == SCREENS.lastIndex

    AlertDialog(
        onDismissRequest = { finish() },
        icon = {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    screen.icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        },
        title = { Text(screen.title, style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column {
                ProgressRail(index)
                Spacer(Modifier.height(14.dp))
                Text(screen.body, style = MaterialTheme.typography.bodyLarge)
            }
        },
        confirmButton = {
            if (last) {
                // The one screen that reaches past the app. `ask` fires the
                // system prompt and records that we asked, so the standalone
                // primer never repeats it — and it is a no-op on a phone where
                // the question is already answered, which is what makes the
                // second label honest rather than a lie about what the button
                // does.
                TextButton(onClick = { ask.ask(); finish() }) {
                    Text(if (ask.askable) "Turn on notifications" else "Start working")
                }
            } else {
                TextButton(onClick = { index += 1 }) { Text("Next") }
            }
        },
        dismissButton = {
            // Skippable from the very first screen, per the Acceptance line. A
            // flow you must finish to escape is a wall, and this one guards
            // nothing.
            TextButton(onClick = { finish() }) {
                Text(if (last && ask.askable) "Not now" else "Skip")
            }
        },
    )
}

/**
 * Four segments, the current one filled — and the first is filled the moment
 * this opens. Somebody on screen one accepted an invite, signed in and opened
 * the app; a bar that starts empty says otherwise and makes four screens feel
 * like a form.
 *
 * *Applying: Goal Gradient Effect.*
 */
@Composable
private fun ProgressRail(index: Int) {
    val filled = orientationProgress(index) * SCREENS.size
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        SCREENS.forEachIndexed { position, _ ->
            Box(
                Modifier
                    .weight(1f)
                    .height(4.dp)
                    .clip(CircleShape)
                    .background(
                        if (position < filled) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        },
                    ),
            )
        }
    }
}

/** The number of screens, so a test can assert the flow stayed short. */
val ORIENTATION_SCREEN_COUNT: Int = SCREENS.size

/** Titles and bodies, in order — read by the copy-parity test. */
fun orientationCopy(): List<Pair<String, String>> =
    SCREENS.map { it.title to it.body }
