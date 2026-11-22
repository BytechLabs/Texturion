package com.loonext.android.features.tasks

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DragHandle
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.DragAndDropTransferData
import androidx.compose.ui.draganddrop.mimeTypes
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.ui.common.PaperIconButton
import com.loonext.android.ui.common.SectionHeader
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import kotlin.math.roundToLong

private const val DispatchMime = "application/x-loonext-dispatch"
private const val SlotMinutes = 15L
private val SlotWidth = 28.dp

internal fun Modifier.dispatchDrag(payload: String, enabled: Boolean): Modifier =
    if (enabled) dragAndDropSource { _: Offset ->
        DragAndDropTransferData(ClipData("Planner", arrayOf(DispatchMime), ClipData.Item(payload)))
    } else this

@Composable
internal fun DispatchTimeline(
    plan: DispatchPlan,
    day: DispatchDay,
    blocks: List<DispatchBlock>,
    firstWorker: String?,
    editable: Boolean,
    onTask: (String) -> Unit,
    onEdit: (DispatchTask, DispatchBlock) -> Unit,
    onPlace: (String, String, Instant) -> Boolean,
    onResize: (DispatchTask, DispatchBlock, Instant) -> Unit,
) {
    val zone = workspaceZone(plan.timezone)
    val locale = LocalAppLocale.current
    val date = LocalDate.parse(day.date)
    val weekday = (date.dayOfWeek.value % 7).toString()
    val dayStart = Instant.parse(day.start)
    val dayEnd = Instant.parse(day.end)
    val shifts = plan.members.mapNotNull { it.shifts[weekday] }.filter { it.start != null && it.end != null }
    if (day.closed && day.opens_at == null && shifts.isEmpty() && blocks.isEmpty()) {
        Text(t("contactsTasks.dispatchClosedDay"), style = MaterialTheme.typography.bodyMedium)
        return
    }
    if (plan.members.isEmpty()) {
        Text(t("contactsTasks.dispatchNoBookings"), style = MaterialTheme.typography.bodyMedium)
        return
    }
    val opening = day.opens_at?.let(Instant::parse) ?: dayStart.takeIf { shifts.isEmpty() }
    val closing = day.closes_at?.let(Instant::parse) ?: dayEnd.takeIf { shifts.isEmpty() }
    val starts = listOfNotNull(opening) + blocks.map { Instant.parse(it.starts_at) } +
        shifts.map { date.atTime(LocalTime.parse(it.start)).atZone(zone).toInstant() }
    val ends = listOfNotNull(closing) + blocks.map { Instant.parse(it.ends_at) } +
        shifts.map { date.atTime(LocalTime.parse(it.end)).atZone(zone).toInstant() }
    val first = maxOf(dayStart, starts.minOrNull() ?: dayStart)
    val last = minOf(dayEnd, ends.maxOrNull() ?: dayEnd)
    val count = ((Duration.between(first, last).toMinutes() + SlotMinutes - 1) / SlotMinutes).toInt().coerceAtLeast(1)
    val width = SlotWidth * count
    fun x(time: Instant) = SlotWidth * (Duration.between(first, time).seconds.toFloat() / (SlotMinutes * 60))
    fun label(time: Instant) = TimestampFormat.clock(time, zone, locale)
    var highlighted by remember(day.date) { mutableStateOf<Pair<String, Instant>?>(null) }
    SectionHeader(t("contactsTasks.schedule"))
    val scheduleStatus = highlighted?.let { label(it.second) }
        ?: if (blocks.isEmpty()) t("contactsTasks.dispatchNoBookings") else ""
    Text(scheduleStatus, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, minLines = 1)
    Column(Modifier.horizontalScroll(rememberScrollState()).width(width)) {
        Box(Modifier.width(width).height(28.dp)) {
            repeat(count) { index ->
                if (index % 4 == 0) {
                    Text(label(first.plusSeconds(index * SlotMinutes * 60)),
                        Modifier.offset(x = SlotWidth * index).padding(start = 4.dp),
                        style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        for (member in plan.members.sortedBy { it.id != firstWorker }) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TaskAvatar(member.name, size = 22.dp, memberId = member.id)
                SectionHeader(member.name ?: t("contactsTasks.dispatchAssignee"))
            }
            Box(Modifier.width(width).height(78.dp).background(MaterialTheme.colorScheme.surface)) {
                Row {
                    repeat(count) { index ->
                        val start = first.plusSeconds(index * SlotMinutes * 60)
                        DispatchSlotTarget(start, highlighted == (member.id to start), editable,
                            { time -> highlighted = time?.let { member.id to it } }) { payload ->
                            onPlace(payload, member.id, start)
                        }
                    }
                }
                for (block in blocks.filter { it.assignee_id == member.id }) {
                    val task = plan.tasks.find { it.id == block.task_id } ?: continue
                    var resized by remember(block.id, block.ends_at) { mutableStateOf<Instant?>(null) }
                    val start = Instant.parse(block.starts_at)
                    val end = resized ?: Instant.parse(block.ends_at)
                    val left = x(maxOf(start, first))
                    val blockWidth = maxOf(104.dp, x(minOf(end, last)) - left)
                    val movable = editable && !block.locked
                    Row(
                        Modifier.offset(x = minOf(left, maxOf(0.dp, width - blockWidth)), y = 8.dp).width(blockWidth)
                            .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(8.dp))
                            .dispatchDrag("block:${block.id}", movable),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { onTask(task.id) }, modifier = Modifier.weight(1f)) {
                            Column {
                                Text(task.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer)
                                Text("${label(start)} – ${label(end)}", maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer)
                            }
                        }
                        if (editable) {
                            val resize = if (movable) Modifier.pointerInput(block.id, block.ends_at, day.date) {
                                var offset = 0f
                                detectHorizontalDragGestures(
                                    onDragStart = { offset = 0f },
                                    onDragCancel = { resized = null },
                                    onDragEnd = {
                                        val next = resized
                                        resized = null
                                        if (next != null && next.toString() != block.ends_at) onResize(task, block, next)
                                    },
                                ) { change, amount ->
                                    change.consume()
                                    offset += amount
                                    val slots = (offset / SlotWidth.toPx()).roundToLong()
                                    val next = Instant.parse(block.ends_at).plusSeconds(slots * SlotMinutes * 60)
                                    resized = maxOf(start.plusSeconds(5 * 60), minOf(next, dayEnd, start.plusSeconds(12 * 3600)))
                                }
                            } else Modifier
                            PaperIconButton(
                                icon = if (movable) Icons.Outlined.DragHandle else Icons.Outlined.Lock,
                                contentDescription = t(if (movable) "contactsTasks.dispatchResizeBlock" else "contactsTasks.dispatchEditBlock"),
                                modifier = resize,
                                onClick = { onEdit(task, block) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DispatchSlotTarget(
    start: Instant,
    highlighted: Boolean,
    editable: Boolean,
    onHighlight: (Instant?) -> Unit,
    onDrop: (String) -> Boolean,
) {
    val highlight by rememberUpdatedState(onHighlight)
    val drop by rememberUpdatedState(onDrop)
    val target = remember(start) {
        object : DragAndDropTarget {
            override fun onEntered(event: DragAndDropEvent) = highlight(start)
            override fun onExited(event: DragAndDropEvent) = highlight(null)
            override fun onEnded(event: DragAndDropEvent) = highlight(null)
            override fun onDrop(event: DragAndDropEvent): Boolean {
                val text = event.toAndroidDragEvent().clipData.getItemAt(0).text?.toString() ?: return false
                return drop(text)
            }
        }
    }
    Box(
        Modifier.width(SlotWidth).height(78.dp)
            .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant)
            .then(if (highlighted) Modifier.background(MaterialTheme.colorScheme.primaryContainer) else Modifier)
            .then(if (editable) Modifier.dragAndDropTarget(
                shouldStartDragAndDrop = { DispatchMime in it.mimeTypes() }, target = target,
            ) else Modifier),
    )
}
