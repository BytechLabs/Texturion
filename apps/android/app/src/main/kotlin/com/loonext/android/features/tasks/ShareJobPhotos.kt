package com.loonext.android.features.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.JobPhotoLink
import com.loonext.android.features.settings.copyToClipboard
import com.loonext.android.ui.common.absoluteTime
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #294 — hand the customer a page with the photos on it.
 *
 * ## Evaluation
 *
 * The issue names a constraint nobody had written down: the best job documentation
 * is structurally internal-only. A full-resolution photo of a serial plate has to
 * travel as a note, because a text is capped at 1 MB per image and three per
 * message. So "here is everything we did" over MMS means picking three and hoping
 * the compression left something readable. A link does not have that problem.
 *
 * ## What binds it
 *
 * *Prioritize Intent* — draws nothing until the job HAS photos. An offer to share an
 * empty set is an offer to look unready.
 *
 * *Ethical Friction, in proportion* — one press, no dialog. This does put a record of
 * the inside of somebody's home on the public internet, so it is audited and it
 * expires; but the tech pressing it is standing in front of the customer saying "I'll
 * send you the pictures", and a confirmation there is friction on the good path. The
 * undo is what matters, and it is one press too.
 *
 * *Zen of Clarity* — the link and one Copy. No share sheet: the crew is about to
 * paste it into the thread they already have open with this customer, which is the
 * whole point of the product.
 *
 * *Loss Aversion, honestly* — the expiry is on screen rather than buried, because a
 * customer opening a dead link months later reflects on the business, not on us.
 */
@Composable
fun ShareJobPhotos(
    taskId: String,
    photoCount: Int,
    mutations: TaskMutations,
    companyId: String,
    onError: (String) -> Unit,
) {
    // Nothing to share, nothing to offer.
    if (photoCount == 0) return

    var link by remember(taskId) { mutableStateOf<JobPhotoLink?>(null) }
    var busy by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val context = LocalContext.current
    // The clipboard label is shown by Android's own paste confirmation, so it
    // is copy — and it is read here, in composition, because the tap that uses
    // it is not.
    val clipboardLabel = t("contactsTasks.jobPhotosClipboardLabel")
    // #228: same reason — the failures the taps below report are read here.
    val locale = LocalAppLocale.current

    val current = link
    if (current == null) {
        OutlinedButton(
            onClick = {
                haptics.tap()
                busy = true
                coroutines.launch {
                    runCatching { mutations.shareJobPhotos(companyId, taskId) }
                        .onSuccess { link = it }
                        .onFailure { onError(it.userMessage(locale)) }
                    busy = false
                }
            },
            enabled = !busy,
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Icon(
                Icons.Outlined.Link,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Text(
                if (busy) {
                    t("contactsTasks.jobPhotosMakingLink")
                } else {
                    t("contactsTasks.jobPhotosShare")
                },
                modifier = Modifier.padding(start = 6.dp),
            )
        }
        return
    }

    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(
                t(
                    "contactsTasks.jobPhotosExpiry",
                    "when" to absoluteTime(current.expires_at),
                ),
                fontSize = 12.5.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    current.url,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(onClick = {
                    haptics.tap()
                    copyToClipboard(context, clipboardLabel, current.url)
                }) {
                    Icon(
                        Icons.Outlined.ContentCopy,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(t("contactsTasks.copy"), modifier = Modifier.padding(start = 6.dp))
                }
            }
            TextButton(
                onClick = {
                    busy = true
                    coroutines.launch {
                        runCatching { mutations.revokeJobPhotos(companyId, taskId) }
                            .onSuccess { link = null }
                            .onFailure { onError(it.userMessage(locale)) }
                        busy = false
                    }
                },
                enabled = !busy,
            ) {
                Text(t("contactsTasks.jobPhotosTurnOff"), fontSize = 12.sp)
            }
        }
    }
}

