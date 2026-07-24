package com.loonext.android.features.thread

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.TaskAlt
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.loonext.android.core.model.Attachment
import com.loonext.android.core.model.AttachmentSummary
import com.loonext.android.core.model.CARRIER_OPT_OUT_ERROR_CODE
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import com.loonext.android.features.compose.icon
import com.loonext.android.features.compose.mmsKindOf
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.theme.BrandColor
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Paper & Olive bubble grammar (spec 21/30): radius 20 with a 6dp tail-side
// corner — inbound tails bottom-start, outbound bottom-end.
private val INBOUND_SHAPE = RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp)
private val OUTBOUND_SHAPE = RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)
private val NOTE_SHAPE = RoundedCornerShape(18.dp)

private val bubbleTimeFormat = DateTimeFormatter.ofPattern("h:mm a")

fun bubbleTime(iso: String): String =
    runCatching {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).format(bubbleTimeFormat)
    }.getOrDefault("")

/** Human delivery-state line for an outbound bubble. */
fun deliveryLabel(message: Message): String? = when (message.status) {
    MessageStatus.QUEUED -> "Sending…"
    MessageStatus.SENT -> "Sent"
    MessageStatus.DELIVERED -> "Delivered"
    MessageStatus.FAILED ->
        if (message.error_code == CARRIER_OPT_OUT_ERROR_CODE) "This customer opted out"
        else "Not delivered"

    else -> null
}

/** The cream internal-note well fill (dark theme falls back to raised paper). */
@Composable
private fun noteWellColor(): Color =
    if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHigh
    else BrandColor.Cream

/** The lime "delivered" mark — brighter in light so it reads on paper. */
@Composable
private fun limeMark(): Color =
    if (isSystemInDarkTheme()) MaterialTheme.colorScheme.tertiary else BrandColor.LimeBright

/** One message bubble: inbound on paper, outbound on ink, note a cream well. */
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
    onOpenAttachment: (AttachmentSummary) -> Unit,
    onOpenTask: ((taskId: String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val outbound = message.direction == MessageDirection.OUTBOUND
    val note = message.direction == MessageDirection.NOTE
    val done = message.done_at != null

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 4.dp),
        horizontalAlignment = when {
            note -> Alignment.CenterHorizontally
            outbound -> Alignment.End
            else -> Alignment.Start
        },
    ) {
        val shape = when {
            note -> NOTE_SHAPE
            outbound -> OUTBOUND_SHAPE
            else -> INBOUND_SHAPE
        }
        val bubbleModifier = Modifier
            .widthIn(max = if (note) 340.dp else 300.dp)
            .clip(shape)
            .background(
                when {
                    note -> noteWellColor()
                    outbound -> MaterialTheme.colorScheme.primary
                    else -> MaterialTheme.colorScheme.surface
                },
            )
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(horizontal = 14.dp, vertical = 11.dp)

        Column(bubbleModifier) {
            if (note) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.Lock,
                        contentDescription = "Internal note",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(13.dp),
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(
                        authorName ?: "Internal note",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(3.dp))
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

            // #189 non-image MMS media: one calm tappable file chip per item.
            message.attachments
                .filterNot { it.content_type.startsWith("image/") }
                .forEach { attachment ->
                    AttachmentFileChip(
                        attachment = attachment,
                        onInk = outbound,
                        onOpen = { onOpenAttachment(attachment) },
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }

            if (message.body.isNotBlank()) {
                Text(
                    message.body,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                    ),
                    color = if (outbound) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.onSurface,
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
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }

        MessageMetaLine(
            message = message,
            doneByName = doneByName,
            onRetry = onRetry,
            onOpenTask = onOpenTask,
        )
    }
}

/** The quiet line under a bubble: time · delivery state · done · pin · task. */
@Composable
private fun MessageMetaLine(
    message: Message,
    doneByName: String?,
    onRetry: () -> Unit,
    onOpenTask: ((taskId: String) -> Unit)? = null,
) {
    val outbound = message.direction == MessageDirection.OUTBOUND
    val failed = message.status == MessageStatus.FAILED
    val optedOut = failed && message.error_code == CARRIER_OPT_OUT_ERROR_CODE
    val delivered = outbound && !failed &&
        (message.status == MessageStatus.SENT || message.status == MessageStatus.DELIVERED)

    Row(
        Modifier.padding(top = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (message.pinned_at != null) {
            Icon(
                Icons.Outlined.PushPin,
                contentDescription = "Pinned",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(12.dp),
            )
        }
        // #217: the task indicator opens that message's task detail. The link
        // id rides promoted_task / task / task_id; when present the icon becomes
        // a tap target (olive-tinted to read as actionable). A has_task with no
        // resolvable id (shouldn't happen) stays a static muted marker.
        val taskId = message.promoted_task?.id ?: message.task?.id ?: message.task_id
        if (message.has_task || message.promoted_task != null || taskId != null) {
            val openTask: (() -> Unit)? =
                if (taskId != null && onOpenTask != null) {
                    { onOpenTask(taskId) }
                } else {
                    null
                }
            Icon(
                Icons.Outlined.TaskAlt,
                contentDescription = if (openTask != null) "Open task" else "Has a task",
                tint = if (openTask != null) MaterialTheme.colorScheme.secondary
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = if (openTask != null) {
                    Modifier
                        .clip(CircleShape)
                        .clickable(onClick = openTask)
                        .padding(4.dp)
                        .size(12.dp)
                } else {
                    Modifier.size(12.dp)
                },
            )
        }

        val quiet = buildList {
            add(bubbleTime(message.created_at))
            if (outbound && !failed) deliveryLabel(message)?.let { add(it) }
        }
        // Delivery-state swaps (Sending… → Sent → Delivered) fade instead of
        // snapping; the initial cached paint renders without animation.
        AnimatedContent(
            targetState = quiet.joinToString(" · "),
            transitionSpec = {
                fadeIn(tween(durationMillis = 180)) togetherWith
                    fadeOut(tween(durationMillis = 120))
            },
            label = "delivery-line",
        ) { line ->
            Text(
                line,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // The lime mark lands with a small spring when delivery confirms.
        AnimatedVisibility(
            visible = delivered,
            enter = scaleIn(
                animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                initialScale = 0.4f,
            ) + fadeIn(),
            exit = fadeOut(),
        ) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = null,
                tint = limeMark(),
                modifier = Modifier.size(11.dp),
            )
        }
        if (failed) {
            Text(
                deliveryLabel(message).orEmpty(),
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = if (optedOut) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.error,
            )
        }
        if (message.retryable) {
            Text(
                "Retry",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.errorContainer)
                    .clickable(onClick = onRetry)
                    .padding(horizontal = 10.dp, vertical = 3.dp),
            )
        }
        if (message.done_at != null) {
            Text(
                "Done" + (doneByName?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
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
            .padding(horizontal = 18.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.End,
    ) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .clip(OUTBOUND_SHAPE)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.85f))
                .padding(horizontal = 14.dp, vertical = 11.dp),
        ) {
            if (pending.mediaCount > 0) {
                Text(
                    if (pending.mediaCount == 1) "1 attachment"
                    else "${pending.mediaCount} attachments",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
            if (pending.body.isNotBlank()) {
                Text(
                    pending.body,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                    ),
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
        }
        Text(
            "Sending…",
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 3.dp),
        )
    }
}

/** Icon for a system/task micro-row, by audit event type. */
private fun eventIcon(type: String?): ImageVector = when {
    type == null -> Icons.Outlined.Info
    type.startsWith("task_") || type == "message_done" || type == "message_undone" ->
        Icons.Outlined.Checklist

    type == "missed_call" || type == "call_completed" -> Icons.Outlined.Call
    type.startsWith("opt") || type == "consent_attested" -> Icons.Outlined.Lock
    else -> Icons.Outlined.Info
}

/**
 * System/task micro-row ("Dana moved this to Closed"): a 22dp icon well and a
 * quiet 12sp line, indented off the bubble rail (spec 21).
 */
@Composable
fun EventLine(
    text: String,
    timeIso: String,
    modifier: Modifier = Modifier,
    eventType: String? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 30.dp, vertical = 5.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .size(22.dp)
                .background(MaterialTheme.colorScheme.surfaceContainer, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                eventIcon(eventType),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(11.dp),
            )
        }
        Spacer(Modifier.width(9.dp))
        Text(
            "$text · ${bubbleTime(timeIso)}",
            style = MaterialTheme.typography.bodySmall.copy(
                fontSize = 12.sp,
                lineHeight = 18.sp,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

/** Centered tracked-uppercase day label ("TODAY") — no hairlines (spec 21). */
@Composable
fun DayDividerLine(label: String, modifier: Modifier = Modifier) {
    Text(
        label.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = 10.5.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.1.em,
        ),
        color = MaterialTheme.colorScheme.outline,
        textAlign = TextAlign.Center,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
    )
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
            "Photo unavailable · tap to retry",
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
                    RoundedCornerShape(14.dp),
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
                .clip(RoundedCornerShape(14.dp)),
        )
    }
}

/**
 * Non-image MMS attachment in a bubble (#189): a calm tappable file chip —
 * kind icon, kind label (MMS media carries no filename), size. Paper chip on
 * the ink bubble, inset chip on paper, so it reads in both directions. Tap
 * mints a signed URL and opens the file.
 */
@Composable
fun AttachmentFileChip(
    attachment: AttachmentSummary,
    onInk: Boolean,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val kind = mmsKindOf(attachment.content_type)
    val chipBg = if (onInk) MaterialTheme.colorScheme.surface
    else MaterialTheme.colorScheme.surfaceContainer
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier
            .pressScale(interaction)
            .clip(RoundedCornerShape(12.dp))
            .background(chipBg)
            .clickable(
                interactionSource = interaction,
                indication = LocalIndication.current,
                onClick = onOpen,
            )
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(30.dp)
                .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                kind.icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(15.dp),
            )
        }
        Spacer(Modifier.width(8.dp))
        Column {
            Text(
                kind.label,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
            )
            gallerySizeLabel(attachment.size_bytes)?.let { size ->
                Text(
                    size,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
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
                            Icons.Outlined.Description,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            file.file_name ?: "File",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.secondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
