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
 * ## Why it confirms itself
 *
 * A `Toast` rather than a caller-supplied snackbar, deliberately. Three of the
 * four sites have no snackbar host in scope — the calls screen has none at all —
 * so a `onCopied` parameter would have meant threading a host through three
 * screens to say one word, and the site that could not would have copied in
 * silence. A silent copy is indistinguishable from a missed press. `Toast` needs
 * only a Context and has precedent here (`AttachmentsGalleryScreen`).
 *
 * ## Why no sheet
 *
 * `MessageActions` opens one because a message has five other actions. A
 * transcript has one, and a sheet holding a single row is a second tap for
 * nothing. `onLongClickLabel` is what makes the gesture discoverable rather than
 * folklore — TalkBack reads it out as an available action.
 */
@Composable
fun VoicemailTranscript(text: String, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val haptics = rememberHaptics()
    Text(
        text,
        style = MaterialTheme.typography.bodySmall.copy(
            fontSize = 12.5.sp,
            lineHeight = 18.sp,
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.combinedClickable(
            // An inert tap: the row underneath owns the tap (it opens the
            // conversation), and consuming it here would break that. Compose
            // requires an onClick, so this is the deliberate no-op — the same
            // shape MessageBubbles uses, for the same reason.
            onClick = {},
            onLongClick = {
                haptics.tap()
                clipboard.setText(AnnotatedString(text))
                Toast.makeText(context, "Transcript copied.", Toast.LENGTH_SHORT).show()
            },
            onLongClickLabel = "Copy transcript",
        ),
    )
}
