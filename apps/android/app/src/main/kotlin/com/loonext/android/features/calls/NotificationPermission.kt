package com.loonext.android.features.calls

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.loonext.android.push.PushPrefs

/**
 * #286 — the POST_NOTIFICATIONS ask, with a reason in front of it.
 *
 * This used to fire the system prompt cold at shell-ready (#167): first launch,
 * no explanation, a dialog about a product they had used for four seconds. The
 * Android prompt is one-shot in practice — a refusal sends the recovery path
 * into system settings, where almost nobody goes — so a cold ask spends the
 * only chance the app gets on the worst possible moment.
 *
 * So the ask is now the second thing that happens, not the first: the app says
 * what it will and will not buzz about, and the person taps a button that
 * fires the real prompt.
 *
 * *Applying: Ethical Friction, inverted — the deliberate pause protects the
 * user's attention rather than their data, and it protects our one prompt too.*
 */

/**
 * The system prompt, and whether there is any point offering it.
 *
 * Owns the launcher, which must be created during composition. Both callers —
 * the standalone primer below and the joining orientation's last screen — hold
 * one of these rather than reaching for the permission API themselves, so
 * "asked before" is recorded in exactly one place.
 */
class NotificationAsk internal constructor(
    /** Android 13+, not already granted, and never asked on this install. */
    val askable: Boolean,
    private val launch: () -> Unit,
) {
    /**
     * Fire the OS prompt. A no-op when it cannot help — already granted,
     * already asked, or a platform with no runtime permission — so a caller
     * can wire one button and let this decide.
     */
    fun ask() {
        if (!askable) return
        launch()
    }
}

@Composable
fun rememberNotificationAsk(): NotificationAsk {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* Either way the user decided; settings offers the recovery path. */ }

    // Read once per composition rather than on every recomposition: the answer
    // only changes as a RESULT of the launcher, and the flag below is written
    // at the same moment.
    val askable = remember {
        if (Build.VERSION.SDK_INT < 33) {
            false
        } else {
            val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            !granted && !PushPrefs.permissionRequested(context)
        }
    }

    return remember(askable) {
        NotificationAsk(askable) {
            // Recorded BEFORE the prompt, so a process death mid-dialog cannot
            // produce a second one. The settings notifications card reads the
            // same flag to tell "not asked yet" from "denied → blocked".
            PushPrefs.setPermissionRequested(context)
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

/**
 * The standalone version, for everybody the joining orientation is not for —
 * the owner who just finished setup, and anybody already here when this
 * shipped.
 *
 * One screen rather than four: they are not new to the workspace, only to this
 * question. It says what the alerts are and what they are not, because "allow
 * notifications?" with no object is a question about spam.
 *
 * @param suppressed true while the joining orientation is on screen — that flow
 *   ends on the same ask with three screens of context in front of it, and two
 *   dialogs about the same permission is the cold ask again with extra steps.
 */
@Composable
fun NotificationPrimer(suppressed: Boolean = false) {
    val ask = rememberNotificationAsk()
    var dismissed by remember { mutableStateOf(false) }
    val context = LocalContext.current

    if (suppressed || dismissed || !ask.askable) return

    AlertDialog(
        onDismissRequest = {
            // Closing without answering is not a refusal, so nothing is
            // recorded and the dialog is simply gone for this launch. The next
            // one asks again — unlike the system prompt, this is ours to
            // repeat, and repeating it is cheaper than losing the permission.
            dismissed = true
        },
        icon = { Icon(Icons.Outlined.Notifications, contentDescription = null) },
        title = { Text("Want a nudge when work comes in?") },
        text = {
            Text(
                "We'll buzz you for new customer texts, missed calls and the " +
                    "work assigned to you — nothing else. You can change what " +
                    "reaches you, and when, in Settings.",
                style = MaterialTheme.typography.bodyLarge,
            )
        },
        confirmButton = {
            TextButton(onClick = { dismissed = true; ask.ask() }) {
                Text("Turn on notifications")
            }
        },
        dismissButton = {
            TextButton(onClick = {
                // A deliberate "no" DOES spend the flag: asking somebody who
                // said no on every launch is how an app gets uninstalled. The
                // settings card is the way back.
                PushPrefs.setPermissionRequested(context)
                dismissed = true
            }) {
                Text("Not now")
            }
        },
    )
}
