package com.loonext.android.ui.common

import android.widget.Toast
import androidx.compose.foundation.combinedClickable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.sp

/**
 * #566 — a voicemail transcript, and a way to get it out.
 *
 * The founder's ask: *"What about other UX like copying the transcription? By
 * holding? Or something?"* Long-press is exactly right, and it is already this
 * app's gesture for lifting text off a screen — `MessageActions` copies a message
 * body from a long-press sheet, and `AttachmentsGalleryScreen` chose long-press
 * for a thumbnail with the reason written down: *"a thumbnail has no room for a
 * menu, and long-press is what a phone user already reaches for on one."* A
 * transcript is the same shape of problem.
 *
 * ## Why a composable rather than a modifier on four Texts
 *
 * The same paragraph was rendered in four places — the call row, the voicemail
 * player, the contact detail's call history, and the thread timeline — each with
 * its own copy of the style block, and they had already drifted (12.5sp in three,
 * 12sp in the fourth). A gesture added to one would have been a gesture missing
 * from three.
 *
 * ## [onRowTap] is not optional decoration — read this before omitting it
 *
 * `combinedClickable` CONSUMES the tap. It installs `detectTapGestures`, which
 * takes the first down with `requireUnconsumed = true` and consumes both the down
 * and the up; Compose's main pass runs child-before-parent, so an ancestor's
 * `Modifier.clickable` never sees the event. The first version of this file passed
 * an empty `onClick = {}` — copied from `MessageBubbles`, where the bubble IS the
 * tap target and there is nothing above it to swallow — and that silently stopped
 * a voicemail row in the call log from opening its conversation when you tapped
 * the words.
 *
 * So: pass the surrounding row's own action whenever an ancestor is clickable.
 * Leaving it null is correct ONLY where nothing above this is tappable, which is
 * true of the contact detail's player row and of a thread event line with no
 * destination.
 *
 * ## Why it confirms itself
 *
 * A `Toast` rather than a caller-supplied snackbar, deliberately. Three of the
 * four sites have no snackbar host in scope — the calls screen has none at all —
 * so a callback would have meant threading a host through three screens to say one
 * word, and the site that could not would have copied in silence. A silent copy is
 * indistinguishable from a missed press. `Toast` needs only a Context and has
 * precedent here (`AttachmentsGalleryScreen`).
 *
 * ## Why no sheet, and no manual haptic
 *
 * `MessageActions` opens a sheet because a message has five other actions. A
 * transcript has one, and a sheet holding a single row is a second tap for
 * nothing. `onLongClickLabel` is what makes the gesture discoverable rather than
 * folklore — TalkBack reads it out as an available action.
 *
 * There is deliberately no `haptics` call in [onLongClick]: `combinedClickable`
 * already performs the long-press feedback, and adding one double-fires. This repo
 * had already written that down at `ThreadScreen.kt` — *"combinedClickable already
 * performs the long-press haptic — no manual heavy() here or it would
 * double-fire"* — and the first version of this file did it anyway.
 */
@Composable
fun VoicemailTranscript(
    text: String,
    /**
     * What the row around this does when tapped. REQUIRED wherever an ancestor is
     * clickable — see the note above; null swallows that ancestor's tap.
     */
    onRowTap: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    Text(
        text,
        style = MaterialTheme.typography.bodySmall.copy(
            fontSize = 12.5.sp,
            lineHeight = 18.sp,
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.combinedClickable(
            onClick = { onRowTap?.invoke() },
            onLongClick = {
                clipboard.setText(AnnotatedString(text))
                Toast.makeText(context, "Transcript copied.", Toast.LENGTH_SHORT).show()
            },
            onLongClickLabel = "Copy transcript",
        ),
    )
}
