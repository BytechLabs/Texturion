package com.loonext.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.loonext.android.core.model.Attachment
import com.loonext.android.core.model.AttachmentSummary
import com.loonext.android.core.model.CARRIER_OPT_OUT_ERROR_CODE
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import com.loonext.android.features.compose.NoteAmber
import com.loonext.android.ui.common.LoadState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val BUBBLE_SHAPE = RoundedCornerShape(16.dp)
private val bubbleTimeFormat = DateTimeFormatter.ofPattern("h:mm a")

fun bubbleTime(iso: String): String =
    runCatching {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).format(bubbleTimeFormat)
    }.getOrDefault("")

/** Human delivery-state line for an outbound bubble. */
fun deliveryLabel(message: Message): String? = when (message.status) {
    MessageStatus.QUEUED -> "Sending…"
    MessageStatus.SENT -> "Sent ✓"
    MessageStatus.DELIVERED -> "Delivered ✓✓"
    MessageStatus.FAILED ->
        if (message.error_code == CARRIER_OPT_OUT_ERROR_CODE) "This customer opted out"
        else "Not delivered"

    else -> null
}

/** One message bubble: inbound left, outbound flat petrol right, note amber. */
@Composable
fun MessageBubble(
    message: Message,
    authorName: String?,
    doneByName: String?,
    noteFilesState: LoadState<List<Attachment>>?,
    onLoadNoteFiles: () -> Unit,
    onLongPress: () -> Unit,
    onRetry: () -> Unit,
    mintAttachmentUrl: suspend (String) -> String,
    onOpenFile: (Attachment) -> Unit,
    modifier: Modifier = Modifier,
) {
    val outbound = message.direction == MessageDirection.OUTBOUND
    val note = message.direction == MessageDirection.NOTE
    val done = message.done_at != null

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 3.dp),
        horizontalAlignment = when {
            note -> Alignment.CenterHorizontally
            outbound -> Alignment.End
            else -> Alignment.Start
        },
    ) {
        val bubbleModifier = Modifier
            .widthIn(max = if (note) 340.dp else 300.dp)
            .let { base ->
                when {
                    note -> base
                        .border(1.dp, NoteAmber.line(), BUBBLE_SHAPE)
                        .background(NoteAmber.bg(), BUBBLE_SHAPE)

                    outbound -> base.background(MaterialTheme.colorScheme.primary, BUBBLE_SHAPE)

                    else -> base
                        .border(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant,
                            BUBBLE_SHAPE,
                        )
                        .background(MaterialTheme.colorScheme.surface, BUBBLE_SHAPE)
                }
            }
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(horizontal = 12.dp, vertical = 8.dp)

        Column(bubbleModifier) {
            if (note) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Filled.Lock,
                        contentDescription = "Internal note",
                        tint = NoteAmber.ink(),
                        modifier = Modifier.size(13.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        authorName ?: "Internal note",
                        style = MaterialTheme.typography.labelSmall,
                        color = NoteAmber.ink(),
                    )
                }
                Spacer(Modifier.height(2.dp))
            }

            // Inline MMS images — signed URL minted per view, never cached.
            message.attachments
                .filter { it.content_type.startsWith("image/") }
                .forEach { attachment ->
                    SignedAttachmentImage(
                        attachment = attachment,
                        mintUrl = mintAttachmentUrl,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }

            if (message.body.isNotBlank()) {
                Text(
                    message.body,
                    style = MaterialTheme.typography.bodyLarge,
                    color = when {
                        note -> MaterialTheme.colorScheme.onSurface
                        outbound -> MaterialTheme.colorScheme.onPrimary
                        else -> MaterialTheme.colorScheme.onSurface
                    },
                    textDecoration = if (done) TextDecoration.LineThrough else null,
                )
            }

            if (note) {
                NoteFilesSection(
                    noteId = message.id,
                    state = noteFilesState,
                    onLoad = onLoadNoteFiles,
                    onOpenFile = onOpenFile,
                )
                val taskLink = message.task ?: message.promoted_task
                if (taskLink != null) {
                    Text(
                        "on: ${taskLink.title}",
                        style = MaterialTheme.typography.labelSmall,
                        color = NoteAmber.ink(),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }

        MessageMetaLine(
            message = message,
            doneByName = doneByName,
            onRetry = onRetry,
        )
    }
}

/** The quiet line under a bubble: time · delivery state · done · pin · task. */
@Composable
private fun MessageMetaLine(
    message: Message,
    doneByName: String?,
    onRetry: () -> Unit,
) {
    val outbound = message.direction == MessageDirection.OUTBOUND
    val parts = buildList {
        add(bubbleTime(message.created_at))
        if (outbound) deliveryLabel(message)?.let { add(it) }
    }
    Row(
        Modifier.padding(top = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (message.pinned_at != null) {
            Icon(
                Icons.Filled.PushPin,
                contentDescription = "Pinned",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(12.dp),
            )
        }
        if (message.has_task || message.promoted_task != null) {
            Icon(
                Icons.Filled.TaskAlt,
                contentDescription = "Has a task",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(12.dp),
            )
        }
        val failed = message.status == MessageStatus.FAILED
        val optedOut = failed && message.error_code == CARRIER_OPT_OUT_ERROR_CODE
        Text(
            parts.joinToString(" · "),
            style = MaterialTheme.typography.labelSmall,
            color = when {
                optedOut -> MaterialTheme.colorScheme.onSurfaceVariant
                failed -> MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        if (message.retryable) {
            Text(
                "Retry",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.clickable(onClick = onRetry),
            )
        }
        if (message.done_at != null) {
            Text(
                "Done" + (doneByName?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** A locally-queued send awaiting the server's queued row. */
@Composable
fun PendingBubble(pending: PendingSend, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 3.dp),
        horizontalAlignment = Alignment.End,
    ) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .background(
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.65f),
                    BUBBLE_SHAPE,
                )
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (pending.mediaCount > 0) {
                Text(
                    if (pending.mediaCount == 1) "1 photo"
                    else "${pending.mediaCount} photos",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
            if (pending.body.isNotBlank()) {
                Text(
                    pending.body,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
        }
        Text(
            "Sending…",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

/** Centered system event line ("Dana moved this to Closed"). */
@Composable
fun EventLine(text: String, timeIso: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "$text · ${bubbleTime(timeIso)}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/** Hairline day divider with a centered label. */
@Composable
fun DayDividerLine(label: String, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(
            Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 10.dp),
        )
        HorizontalDivider(
            Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
    }
}

/**
 * Inline MMS image via a short-lived signed URL minted per view (BINDING:
 * never cached). One automatic re-mint on load failure covers expiry races;
 * after that, an honest tap-to-retry chip.
 */
@Composable
fun SignedAttachmentImage(
    attachment: AttachmentSummary,
    mintUrl: suspend (String) -> String,
    modifier: Modifier = Modifier,
) {
    var url by remember(attachment.id) { mutableStateOf<String?>(null) }
    var mintKey by remember(attachment.id) { mutableStateOf(0) }
    var autoRetried by remember(attachment.id) { mutableStateOf(false) }
    var failed by remember(attachment.id) { mutableStateOf(false) }

    LaunchedEffect(attachment.id, mintKey) {
        failed = false
        url = try {
            mintUrl(attachment.id)
        } catch (_: Exception) {
            failed = true
            null
        }
    }

    when {
        failed -> Text(
            "Photo unavailable — tap to retry",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.clickable {
                autoRetried = false
                mintKey++
            },
        )

        url == null -> Box(
            modifier
                .size(width = 220.dp, height = 140.dp)
                .background(
                    MaterialTheme.colorScheme.surfaceContainerHigh,
                    RoundedCornerShape(10.dp),
                ),
            contentAlignment = Alignment.Center,
        ) { LoadingIndicator() }

        else -> AsyncImage(
            model = url,
            contentDescription = "Photo",
            contentScale = ContentScale.Crop,
            onError = {
                if (!autoRetried) {
                    autoRetried = true
                    mintKey++
                } else {
                    failed = true
                }
            },
            modifier = modifier
                .widthIn(max = 240.dp)
                .height(180.dp)
                .clip(RoundedCornerShape(10.dp)),
        )
    }
}

/** The Files section on a note bubble (D19 generic attachments). */
@Composable
private fun NoteFilesSection(
    noteId: String,
    state: LoadState<List<Attachment>>?,
    onLoad: () -> Unit,
    onOpenFile: (Attachment) -> Unit,
) {
    LaunchedEffect(noteId) { onLoad() }
    when (state) {
        null, is LoadState.Loading -> Unit
        is LoadState.Failed -> Unit // quiet: the note body is the content
        is LoadState.Ready -> {
            if (state.value.isEmpty()) return
            Column(Modifier.padding(top = 6.dp)) {
                state.value.forEach { file ->
                    Row(
                        Modifier
                            .clickable { onOpenFile(file) }
                            .padding(vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Filled.Description,
                            contentDescription = null,
                            tint = NoteAmber.ink(),
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            file.file_name ?: "File",
                            style = MaterialTheme.typography.labelMedium,
                            color = NoteAmber.ink(),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
