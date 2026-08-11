package com.loonext.android.features.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.JoiningNote
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.theme.BrandColor
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
 * WHAT #521 ADDED, AND WHY IT GOES FIRST. The four screens below explain what
 * the PRODUCT is. They cannot say what this particular crew expects of this
 * particular person, which is the part a new tech asks a colleague about on
 * day one. When the owner wrote that down at invite time it leads the first
 * screen, above the product's own copy, attributed to whoever said it. When
 * they did not, which covers the majority of invites, every membership
 * predating it and every owner who made their own workspace, the flow is
 * exactly the four screens it has always been.
 *
 * Copy hand-ported from apps/web/src/components/onboarding/member-orientation.tsx
 * and held word for word by packages/shared/src/member-orientation-copy.test.ts.
 *
 * #228: the words themselves now live in `core/i18n/ShellStrings.kt`, and the
 * guard above reads that file as the Android half — exactly as it already reads
 * `apps/web/src/i18n/sections/onboarding.ts` as web's. What is left here is the
 * ORDER and the marks beside each screen, which are this file's own decisions.
 */

private data class OrientationScreen(
    val titleKey: String,
    val bodyKey: String,
    val icon: ImageVector,
)

private val SCREENS = listOf(
    OrientationScreen(
        "shell.orientationInboxTitle",
        "shell.orientationInboxBody",
        Icons.Outlined.Inbox,
    ),
    OrientationScreen(
        "shell.orientationNumberTitle",
        "shell.orientationNumberBody",
        Icons.Outlined.Phone,
    ),
    OrientationScreen(
        "shell.orientationNotesTitle",
        "shell.orientationNotesBody",
        Icons.Outlined.StickyNote2,
    ),
    OrientationScreen(
        "shell.orientationNotificationsTitle",
        "shell.orientationNotificationsBody",
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

    // #521: read HERE rather than on the shell, because this is the only
    // screen that shows it: nobody the flow is not for should pay a round
    // trip for a paragraph they will never see. Reached only once the shell's
    // /v1/me/firsts read has already answered, so the network just worked.
    //
    // Null means the answer has not landed; a failure settles to the empty
    // one, so a note we cannot fetch costs the orientation nothing.
    var joining by remember(companyId) { mutableStateOf<JoiningNote?>(null) }
    LaunchedEffect(companyId) {
        joining = runCatching { graph.meRepo.joiningNote(companyId) }
            .getOrDefault(JoiningNote())
    }

    if (closed) return
    // Waited for, not raced. This file already argues that flashing a screen
    // and then changing it is worse than the wait; shoving a colleague's
    // paragraph in above copy somebody has started reading is the same defect
    // with the same fix.
    val joiningNote = joining ?: return

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
        // The mark and the headline are composed below rather than handed to
        // the `icon` and `title` slots, because those slots always render above
        // this one and the note has to be first. Ours interrupting somebody
        // mid-sentence is the exact thing this screen exists not to do, and
        // putting the headline back beside its own paragraph is the other half
        // of it: the two of them are one thought.
        text = {
            // Scrollable because a colleague can write up to 500 characters
            // here and the screens themselves cannot: a note long enough to
            // push the buttons off a short phone must still be readable, and
            // must not push the Skip out of reach.
            Column(Modifier.verticalScroll(rememberScrollState())) {
                // #521: the crew's own words, ahead of the product's, on the
                // first screen and nowhere else. The four screens below explain
                // what this app IS; they cannot say what this crew expects of
                // this person, which is the thing they would otherwise ask a
                // colleague about on day one. Repeating it on every screen
                // would turn a greeting into a banner.
                val said = joiningNoteToShow(joiningNote.note)
                if (index == 0 && said != null) {
                    JoiningNoteQuote(said, joiningNote.from, LocalAppLocale.current)
                    Spacer(Modifier.height(18.dp))
                }
                ProgressRail(index)
                Spacer(Modifier.height(16.dp))
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
                Spacer(Modifier.height(14.dp))
                Text(
                    t(screen.titleKey),
                    style = MaterialTheme.typography.headlineSmall,
                    // A dialog paints its text slot in the secondary colour,
                    // which is right for the paragraph and wrong for the line
                    // above it: a headline the colour of its own body copy
                    // stops being a headline.
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(8.dp))
                Text(t(screen.bodyKey), style = MaterialTheme.typography.bodyLarge)
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
                    Text(
                        if (ask.askable) {
                            t("shell.notificationsTurnOn")
                        } else {
                            t("shell.orientationStartWorking")
                        },
                    )
                }
            } else {
                TextButton(onClick = { index += 1 }) { Text(t("shell.orientationNext")) }
            }
        },
        dismissButton = {
            // Skippable from the very first screen, per the Acceptance line. A
            // flow you must finish to escape is a wall, and this one guards
            // nothing.
            TextButton(onClick = { finish() }) {
                Text(
                    if (last && ask.askable) {
                        t("shell.notificationsNotNow")
                    } else {
                        t("shell.orientationSkip")
                    },
                )
            }
        },
    )
}

/**
 * #521: one person's words, marked as a quotation rather than as more copy.
 *
 * The lime left rule is the same mark the invite email drew around the same
 * sentence, and the attribution is the same phrasing. That is deliberate: this
 * is the second time these words are put in front of this person, minutes
 * apart, and it should read as the same words rather than a new message from
 * somebody else.
 */
@Composable
private fun JoiningNoteQuote(note: String, from: String?, locale: String) {
    Row(
        Modifier.height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(BrandColor.LimeBright, CircleShape),
        )
        Column(Modifier.weight(1f)) {
            Text(
                joiningNoteAttribution(from, locale),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(3.dp))
            Text(
                "“$note”",
                style = MaterialTheme.typography.bodyLarge,
                // The one thing on this screen a person wrote, so it is painted
                // as primary text and the byline over it is not. Inheriting the
                // dialog's secondary colour would rank somebody's words below
                // the product copy underneath them.
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * Whose words these are, in the words the invite email already used.
 *
 * The member read `Dave says: "…"` in the email that brought them here, and
 * this is the same sentence over the same quote a few minutes later. Mirroring
 * it is the point rather than a coincidence: a second phrasing would read as
 * a second message from a second person.
 *
 * `from` is best-effort server-side (a display name can be missing), so the
 * unattributed form is a real case rather than a defensive branch. An
 * unattributed note still reads as a person's words.
 *
 * It lives with the four screens rather than with the flow's logic because it
 * is COPY, and every word this orientation says belongs in the one file the
 * cross-client copy guard reads.
 *
 * #228: [locale] defaults to English rather than being required, because the
 * only caller that cannot supply one is a unit test asserting the RULE — which
 * name goes where, and what an unnamed note reads as — rather than the words.
 */
fun joiningNoteAttribution(from: String?, locale: String = MessageLocale.EN): String {
    val name = from?.trim()
    return if (name.isNullOrEmpty()) {
        AppStrings.translate(locale, "shell.orientationTheySaid")
    } else {
        AppStrings.translate(locale, "shell.orientationSays", mapOf("name" to name))
    }
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

/**
 * Titles and bodies, in order, in English — read by the copy-parity test.
 *
 * English rather than the reader's, deliberately: this is asked by a JVM test
 * with no composition and no member, and the question it answers is "are the
 * four screens still four screens", not "what does this person see".
 */
fun orientationCopy(): List<Pair<String, String>> =
    SCREENS.map {
        AppStrings.translate(MessageLocale.EN, it.titleKey) to
            AppStrings.translate(MessageLocale.EN, it.bodyKey)
    }
