package com.loonext.android.core.update

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.loonext.android.BuildConfig
import com.loonext.android.core.i18n.t

/**
 * #339 — the two things we can say about an old build, and they are not the
 * same kind of thing.
 *
 * SOFT: a calm card at the bottom, dismissible for the session. An update
 * exists and is worth having; ignoring it costs nothing, so it does not get a
 * dialog and does not steal focus.
 *
 * BLOCK: a full screen nobody can get past. D71 reserves it for security or
 * genuine incompatibility — for a plumber standing in a customer's basement,
 * being locked out is worse than almost any bug it would prevent. It always
 * names WHY and always offers the way out.
 *
 * Ported 1:1 in behaviour from web's `update-prompt.tsx` and iOS's
 * `UpdatePrompt.swift`, because a person with two devices must not be told two
 * different things about the same release.
 */
@Composable
fun UpdatePrompt(state: UpdateState) {
    val context = LocalContext.current
    var dismissedVersion by remember { mutableStateOf<String?>(null) }

    // Dismissal is per RECOMMENDED VERSION: a tap made last week must not
    // swallow the next release's notice.
    LaunchedEffect(state.policy?.recommended_version) {
        if (dismissedVersion != null && dismissedVersion != state.policy?.recommended_version) {
            dismissedVersion = null
        }
    }

    when (state.requirement) {
        UpdateRequirement.BLOCK -> UpdateBlock(state, context)
        UpdateRequirement.SOFT -> {
            if (dismissedVersion != state.policy?.recommended_version) {
                UpdateCard(
                    state = state,
                    onUpdate = { openUpdate(context, state.policy?.update_url) },
                    onDismiss = { dismissedVersion = state.policy?.recommended_version },
                )
            }
        }
        UpdateRequirement.NONE -> Unit
    }
}

@Composable
private fun UpdateCard(state: UpdateState, onUpdate: () -> Unit, onDismiss: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().systemBarsPadding().padding(16.dp),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Card(modifier = Modifier.fillMaxWidth().widthIn(max = 440.dp)) {
            Row(
                modifier = Modifier.padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        t("shell.updateReadyTitle"),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        // The server's reason when it gave one, verbatim and
                        // untranslated here: those words are the API's to write
                        // and to translate, and a client-side copy of somebody
                        // else's sentence is a copy that drifts. Never invented
                        // here either — a demand we cannot explain is one nobody
                        // should trust.
                        state.policy?.message ?: t("shell.updateReadyBody"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(onClick = onUpdate, modifier = Modifier.padding(top = 8.dp)) {
                        Text(t("shell.updateAction"))
                    }
                }
                IconButton(onClick = onDismiss) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = t("shell.updateDismiss"),
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

/**
 * The floor. No dismiss control, on purpose — a block somebody can tap past is
 * not a block. The version is shown because support's first question is "what
 * are you running", and the person is by construction unable to reach the
 * settings screen that would tell them.
 */
@Composable
private fun UpdateBlock(state: UpdateState, context: Context) {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().systemBarsPadding().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                Icons.Outlined.Download,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
            )
            Text(
                t("shell.updateBlockTitle"),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = 24.dp),
            )
            Text(
                state.policy?.message ?: t("shell.updateBlockBody"),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 12.dp),
            )
            Button(
                onClick = { openUpdate(context, state.policy?.update_url) },
                modifier = Modifier.padding(top = 24.dp).fillMaxWidth().widthIn(max = 360.dp),
            ) {
                Text(t("shell.updateBlockAction"))
            }
            // #228: built with `if` rather than `?.let`, so both halves are
            // ordinary composable calls. The floor line only exists when the
            // policy named one.
            val minimumVersion = state.policy?.minimum_version
            Text(
                t("shell.updateVersion", "version" to BuildConfig.VERSION_NAME) +
                    if (minimumVersion != null) {
                        t("shell.updateMinimum", "version" to minimumVersion)
                    } else {
                        ""
                    },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 16.dp),
            )
        }
    }
}

/**
 * Open the store listing.
 *
 * Falls back to this app's own Play listing when the policy carries no URL,
 * and swallows the ActivityNotFoundException a device with no store throws —
 * a crash on the screen somebody is already stuck behind would be the worst
 * possible place for one.
 */
internal fun openUpdate(context: Context, url: String?) {
    val target = url?.takeIf { it.isNotBlank() }
        ?: "https://play.google.com/store/apps/details?id=${context.packageName}"
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(target))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    } catch (_: ActivityNotFoundException) {
        // Nothing to open. The screen stays, which is still the honest state.
    }
}
