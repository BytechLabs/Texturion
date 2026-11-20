package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.ui.common.ConfirmDialog
import com.loonext.android.ui.common.EmptyState
import com.loonext.android.ui.common.EmptyStateSize
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.PaperIconButton
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SelectField
import com.loonext.android.ui.common.SelectOption
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.Segment
import com.loonext.android.ui.common.SegmentedControl
import com.loonext.android.ui.common.userMessage
import java.net.URLEncoder
import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
internal data class DispatchMember(val id: String, val name: String?)

@Serializable
internal data class DispatchWindow(val start: String, val end: String)

@Serializable
internal data class DispatchTask(
    val id: String,
    val title: String,
    val due_on: String? = null,
    val due_at: String? = null,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val dispatch_estimate: Int? = null,
    val assigned_user_id: String? = null,
    val scheduled_count: Int = 0,
    val updated_at: String,
    val done: Boolean = false,
    val windows: List<DispatchWindow> = emptyList(),
)

@Serializable
internal data class DispatchBlock(
    val id: String,
    val task_id: String,
    val assignee_id: String,
    val starts_at: String,
    val ends_at: String,
    val visit: Boolean,
    val locked: Boolean,
    val address_confirmed: Boolean,
)

@Serializable
internal data class DispatchDay(val date: String, val start: String, val end: String, val opens_at: String?)

@Serializable
internal data class DispatchCell(val date: String, val assignee_id: String, val booked: Double, val available: Double?)

@Serializable
internal data class DispatchSkip(val id: String, val reason: String)

@Serializable
internal data class DispatchRoute(
    val before: Int,
    val after: Int,
    val proposal: List<DispatchBlock>,
    val skipped: List<DispatchSkip>,
)

@Serializable
internal data class DispatchPlan(
    val revision: Int,
    val timezone: String,
    val members: List<DispatchMember>,
    val days: List<DispatchDay>,
    val tasks: List<DispatchTask>,
    val blocks: List<DispatchBlock>,
)

@Serializable
internal data class DispatchPayload(
    val plan: DispatchPlan,
    val workload: List<DispatchCell>,
    val slots: List<DispatchBlock> = emptyList(),
    val route: DispatchRoute? = null,
    val conflicts: List<DispatchSkip> = emptyList(),
    val notify: List<String> = emptyList(),
)

@Serializable
private data class DispatchEdit(
    val id: String,
    val task_id: String,
    val updated_at: String,
    val remove: Boolean = false,
    val reschedule: Boolean = false,
    val assignee_id: String? = null,
    val starts_at: String? = null,
    val ends_at: String? = null,
    val locked: Boolean = false,
    val visit: Boolean = false,
    val confirm_address: Boolean = false,
)

@Serializable
private data class DispatchDetail(val task_id: String, val updated_at: String, val estimate: Int?, val windows: List<DispatchWindow>)

@Serializable
private data class DispatchSlot(
    val id: String,
    val task_id: String,
    val duration: Int,
    val visit: Boolean,
    val confirm_address: Boolean,
    val assignee_id: String?,
)

@Serializable
private data class DispatchRouteRequest(val assignee_id: String, val optimize: Boolean = true, val order: List<String>? = null)

@Serializable
private data class DispatchRequest(
    val day: String,
    val revision: Int,
    val focus: String,
    val days: Int = 7,
    val task: String? = null,
    val blocks: List<DispatchEdit> = emptyList(),
    val details: List<DispatchDetail> = emptyList(),
    val slot: DispatchSlot? = null,
    val route: DispatchRouteRequest? = null,
)

private enum class DispatchPane(val label: String) {
    Schedule("contactsTasks.schedule"),
    Workload("contactsTasks.workload"),
    Routes("contactsTasks.routes"),
    MyDay("contactsTasks.myDay"),
}

private fun DispatchBlock.edit(task: DispatchTask, reschedule: Boolean = false) = DispatchEdit(
    id, task_id, task.updated_at, reschedule = reschedule, assignee_id = assignee_id,
    starts_at = starts_at, ends_at = ends_at, locked = locked, visit = visit, confirm_address = address_confirmed,
)

private fun DispatchPlan.blocks(date: LocalDate): List<DispatchBlock> {
    val day = days.firstOrNull { it.date == date.toString() } ?: return emptyList()
    return blocks.filter { Instant.parse(it.starts_at) < Instant.parse(day.end) && Instant.parse(it.ends_at) > Instant.parse(day.start) }
}

@Composable
internal fun DispatchPlanner(
    api: ApiClient,
    companyId: String,
    userId: String,
    timezone: String?,
    editable: Boolean,
    initialTask: String? = null,
    onClose: () -> Unit,
    onTask: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val locale = LocalAppLocale.current
    val zone = workspaceZone(timezone)
    var date by remember(companyId) { mutableStateOf(LocalDate.now(zone)) }
    val week = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    var pane by remember { mutableStateOf(DispatchPane.Schedule) }
    var saved by remember { mutableStateOf<DispatchPayload?>(null) }
    var draft by remember { mutableStateOf<DispatchPayload?>(null) }
    var edits by remember { mutableStateOf(emptyList<DispatchEdit>()) }
    var details by remember { mutableStateOf(emptyList<DispatchDetail>()) }
    var slots by remember { mutableStateOf<List<DispatchBlock>?>(null) }
    var route by remember { mutableStateOf<DispatchRoute?>(null) }
    var person by remember { mutableStateOf<String?>(null) }
    var editor by remember { mutableStateOf<Pair<String, String?>?>(initialTask?.let { it to null }) }
    var busy by remember { mutableStateOf(false) }
    var review by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    val dirty = edits.isNotEmpty() || details.isNotEmpty()

    LaunchedEffect(week, refresh) {
        saved = null
        error = null
        try {
            saved = api.get("/v1/dispatch", mapOf("day" to week.toString(), "task" to initialTask), companyId)
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            error = failure.userMessage(locale)
        }
    }

    fun reset() {
        draft = null
        edits = emptyList()
        details = emptyList()
        editor = null
        slots = null
        route = null
        error = null
    }

    fun request(nextEdits: List<DispatchEdit> = edits, nextDetails: List<DispatchDetail> = details) = DispatchRequest(
        day = week.toString(), focus = date.toString(), revision = saved?.plan?.revision ?: 0,
        task = initialTask, blocks = nextEdits, details = nextDetails,
    )

    fun perform(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                action()
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                error = failure.userMessage(locale)
            } finally {
                busy = false
            }
        }
    }

    fun stage(nextEdits: List<DispatchEdit>, nextDetails: List<DispatchDetail>) = perform {
        val result: DispatchPayload = api.post("/v1/dispatch/preview", request(nextEdits, nextDetails), companyId)
        edits = nextEdits
        details = nextDetails
        draft = result
        route = null
        slots = null
        if (result.conflicts.isEmpty()) editor = null
    }

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(18.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PaperIconButton(Icons.AutoMirrored.Outlined.ArrowBack, t("contactsTasks.tasksTitle"), onClick = onClose)
            ScreenTitle(t("contactsTasks.planner"))
        }
        SegmentedControl(
            segments = listOf(
                Segment(DispatchPane.Schedule, t("contactsTasks.schedule"), Icons.Outlined.CalendarMonth),
                Segment(DispatchPane.Workload, t("contactsTasks.workload"), Icons.Outlined.ViewKanban),
                Segment(DispatchPane.Routes, t("contactsTasks.routes"), Icons.Outlined.Map),
                Segment(DispatchPane.MyDay, t("contactsTasks.myDay"), Icons.Outlined.Person),
            ),
            selected = pane, onSelect = { pane = it }, iconOnly = true,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            PaperIconButton(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, t("contactsTasks.dispatchPreviousDay"),
                enabled = !busy && (!dirty || date > week), onClick = {
                date = date.minusDays(1)
                editor = null
                route = null
            })
            Text(TimestampFormat.calendarDate(date.atStartOfDay(zone).toInstant().toString(), locale, zone),
                Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, textAlign = TextAlign.Center)
            PaperIconButton(Icons.AutoMirrored.Outlined.KeyboardArrowRight, t("contactsTasks.dispatchNextDay"),
                enabled = !busy && (!dirty || date < week.plusDays(6)), onClick = {
                date = date.plusDays(1)
                editor = null
                route = null
            })
        }
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { reset(); refresh++ }) { Text(t("contactsTasks.dispatchReload")) }
        }
        val base = saved
        val response = draft ?: base
        if (base == null || response == null) {
            if (error == null) CircularProgressIndicator()
        } else {
            val plan = response.plan
            val worker = person ?: plan.members.firstOrNull()?.id
            val day = plan.days.firstOrNull { it.date == date.toString() }
            val blocks = plan.blocks(date)
            val proposals = route?.proposal.orEmpty().associateBy { it.id }
            if (dirty) Row {
                TextButton(enabled = !busy, onClick = { reset() }) { Text(t("contactsTasks.dispatchDiscard")) }
                TextButton(enabled = !busy && response.conflicts.isEmpty(), onClick = { review = true }) {
                    Text(t("contactsTasks.dispatchReview"))
                }
            }
            for (conflict in response.conflicts) {
                Text(t(dispatchReason(conflict.reason)), color = MaterialTheme.colorScheme.error)
            }

            when (pane) {
                DispatchPane.Schedule -> {
                    val target = editor?.let { pick -> plan.tasks.firstOrNull { it.id == pick.first } }
                    val booking = plan.blocks.find { it.id == editor?.second }
                    if (target != null && day != null && editable) {
                        androidx.compose.runtime.key(target.id, booking?.id, day.date) {
                            DispatchBlockEditor(plan, day, target, booking, worker, slots, busy,
                                findSlots = { slot, detail, focus -> perform {
                                    val next = details.filterNot { it.task_id == detail.task_id } + detail
                                    val result: DispatchPayload = api.post("/v1/dispatch/preview",
                                        request(nextDetails = next).copy(slot = slot, focus = focus), companyId)
                                    slots = result.slots
                                } },
                                save = { edit, detail ->
                                    stage(edits.filterNot { it.id == edit.id } + edit,
                                        details.filterNot { it.task_id == detail.task_id } + detail)
                                },
                                saveDetails = { detail ->
                                    stage(edits, details.filterNot { it.task_id == detail.task_id } + detail)
                                },
                                remove = {
                                    if (booking != null) {
                                        val remainder = edits.filterNot { it.id == booking.id }
                                        val original = base.plan.blocks.find { it.id == booking.id }
                                        stage(if (original == null) remainder else remainder +
                                            DispatchEdit(booking.id, target.id, target.updated_at, remove = true, reschedule = original.locked),
                                            details)
                                    }
                                },
                            )
                        }
                    }
                    val queue = plan.tasks.filter { !it.done && it.scheduled_count == 0 }
                    SectionHeader(t("contactsTasks.dispatchQueue"), count = queue.size)
                    if (queue.isEmpty()) EmptyState(t("contactsTasks.dispatchQueueEmpty"), size = EmptyStateSize.Panel)
                    queue.take(200).forEach { task ->
                        DispatchTaskRow(task, null, plan.timezone, onTask, editable) {
                            editor = task.id to null
                            slots = null
                        }
                    }
                    val members = plan.members.sortedBy { it.id != worker }
                    for (member in members) {
                        SectionHeader(member.name ?: t("contactsTasks.dispatchAssignee"))
                        val bookings = blocks.filter { it.assignee_id == member.id }
                        if (bookings.isEmpty()) EmptyState(t("contactsTasks.dispatchNoBookings"), size = EmptyStateSize.Panel)
                        for (block in bookings) plan.tasks.find { it.id == block.task_id }?.let { task ->
                            DispatchTaskRow(task, block, plan.timezone, onTask, editable) {
                                editor = task.id to block.id
                                slots = null
                            }
                        }
                    }
                }
                DispatchPane.Workload -> {
                    SectionHeader(t("contactsTasks.dispatchBooked"))
                    for (member in plan.members) {
                        PaperCard(Modifier.fillMaxWidth()) {
                            Text(member.name ?: t("contactsTasks.dispatchAssignee"), Modifier.padding(12.dp), style = MaterialTheme.typography.titleSmall)
                            Row(Modifier.horizontalScroll(rememberScrollState())) {
                                for (cell in response.workload.filter { it.assignee_id == member.id }) {
                                    val overload = cell.available != null && cell.booked > cell.available
                                    TextButton(onClick = {
                                        person = member.id
                                        date = LocalDate.parse(cell.date)
                                        pane = DispatchPane.Schedule
                                    }) {
                                        Column {
                                            Text(cell.date.takeLast(5))
                                            Text(t("contactsTasks.dispatchDurationValue", "minutes" to cell.booked.toInt().toString()))
                                            Text(cell.available?.let { t("contactsTasks.dispatchDurationValue", "minutes" to it.toInt().toString()) }
                                                ?: t("contactsTasks.dispatchAvailabilityUnknown"))
                                            if (overload) Text(t("contactsTasks.dispatchOverload"), color = MaterialTheme.colorScheme.error)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    SectionHeader(t("contactsTasks.unassigned"))
                    val dueRange = week..week.plusDays(6)
                    plan.tasks.filter { task ->
                        val due = task.due_on?.let(LocalDate::parse) ?: task.due_at?.let {
                            Instant.parse(it).atZone(workspaceZone(plan.timezone)).toLocalDate()
                        }
                        !task.done && task.assigned_user_id == null && task.scheduled_count == 0 && due != null && due in dueRange
                    }.forEach { DispatchTaskRow(it, null, plan.timezone, onTask, false) {} }
                }
                DispatchPane.Routes, DispatchPane.MyDay -> {
                    val personal = pane == DispatchPane.MyDay
                    val schedule = if (personal) base.plan.blocks(date).filter { it.assignee_id == userId } else
                        blocks.filter { it.assignee_id == worker }.map { proposals[it.id] ?: it }.sortedBy { Instant.parse(it.starts_at) }
                    val stops = schedule.filter { it.visit && it.address_confirmed }
                    val flexible = stops.filterNot { it.locked }
                    fun optimize(order: List<String>? = null) {
                        if (worker != null) perform {
                            val result: DispatchPayload = api.post("/v1/dispatch/preview",
                                request().copy(route = DispatchRouteRequest(worker, order = order)), companyId)
                            route = result.route
                        }
                    }
                    if (!personal) {
                        DispatchAssignee(plan.members, worker, allowEmpty = false) { person = it; route = null }
                        TextButton(enabled = editable && !busy && flexible.isNotEmpty(), onClick = { optimize() }) {
                            Text(t("contactsTasks.dispatchOptimize"))
                        }
                        route?.let { result ->
                            Text(t("contactsTasks.dispatchDrive", "before" to result.before.toString(), "after" to result.after.toString()))
                            for (skip in result.skipped) {
                                val title = plan.tasks.find { task -> task.id == blocks.find { it.id == skip.id }?.task_id }?.title.orEmpty()
                                Text(title + " · " + t(if (skip.reason == "capacity")
                                    "contactsTasks.dispatchRouteCapacity" else "contactsTasks.dispatchRouteAddress"))
                            }
                            if (proposals.isNotEmpty()) TextButton(enabled = !busy, onClick = {
                                val changes = result.proposal.mapNotNull { block ->
                                    plan.tasks.find { it.id == block.task_id }?.let { block.edit(it) }
                                }
                                stage(edits.filterNot { proposals.containsKey(it.id) } + changes, details)
                            }) { Text(t("contactsTasks.dispatchApplyRoute")) }
                        }
                    }
                    SectionHeader(t(if (personal) "contactsTasks.myDay" else "contactsTasks.routes"))
                    val ordered = if (personal) schedule else stops
                    if (ordered.isEmpty()) EmptyState(
                        t(if (personal) "contactsTasks.dispatchNoBookings" else "contactsTasks.dispatchStopsEmpty"),
                        size = EmptyStateSize.Panel,
                    )
                    if (!personal) DispatchStopMap(stops, plan.tasks, onTask,
                        Modifier.fillMaxWidth().height(216.dp).clip(MaterialTheme.shapes.large))
                    for (block in ordered) plan.tasks.find { it.id == block.task_id }?.let { task ->
                        DispatchTaskRow(task, block, plan.timezone, onTask, false) {}
                        val index = flexible.indexOf(block)
                        if (!personal && editable && index >= 0) Row {
                            for (step in listOf(-1, 1)) TextButton(
                                enabled = !busy && index + step in flexible.indices,
                                onClick = {
                                    val ids = flexible.map { it.id }.toMutableList()
                                    ids[index] = flexible[index + step].id
                                    ids[index + step] = block.id
                                    optimize(ids)
                                },
                            ) { Text(t(if (step < 0) "contactsTasks.dispatchEarlier" else "contactsTasks.dispatchLater")) }
                        }
                    }
                    if (!personal && schedule.any { it !in stops }) {
                        SectionHeader(t("contactsTasks.dispatchOtherWork"))
                        for (block in schedule.filterNot { it in stops }) plan.tasks.find { it.id == block.task_id }?.let { task ->
                            DispatchTaskRow(task, block, plan.timezone, onTask, false) {}
                        }
                    }
                }
            }
            if (review) ConfirmDialog(
                title = t("contactsTasks.dispatchPreview"),
                body = t("contactsTasks.dispatchReview"),
                confirmLabel = t("contactsTasks.dispatchPublish"),
                onDismiss = { review = false },
                pending = busy,
                extraContent = {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        for (edit in edits) {
                            val original = base.plan.blocks.find { it.id == edit.id }
                            val title = plan.tasks.find { it.id == edit.task_id }?.title.orEmpty()
                            val member = plan.members.find { it.id == (edit.assignee_id ?: original?.assignee_id) }?.name.orEmpty()
                            val time = edit.starts_at?.let { clock(it, plan.timezone, locale) }.orEmpty()
                            val key = if (edit.remove) "contactsTasks.dispatchRemoved" else
                                if (original == null) "contactsTasks.dispatchAdded" else "contactsTasks.dispatchMoved"
                            Text(listOf(t(key), title, member, time).filter(String::isNotBlank).joinToString(" · "))
                        }
                        for (detail in details) Text(listOf(
                            t("contactsTasks.dispatchDetails"),
                            plan.tasks.find { it.id == detail.task_id }?.title.orEmpty(),
                        ).joinToString(" · "))
                        val people = plan.members.filter { it.id in response.notify }.mapNotNull { it.name }
                        if (people.isNotEmpty()) Text(t("contactsTasks.dispatchNotify") + " · " + people.joinToString(", "))
                    }
                },
                onConfirm = {
                    review = false
                    perform {
                        saved = api.post("/v1/dispatch/publish", request(), companyId)
                        reset()
                    }
                },
            )
        }
    }
}

private fun dispatchReason(reason: String): String = when (reason) {
    "address" -> "apiRefusals.dispatchAddress"
    "hours" -> "apiRefusals.dispatchHours"
    "overlap" -> "apiRefusals.dispatchOverlap"
    "travel" -> "apiRefusals.dispatchTravel"
    else -> "apiRefusals.dispatchWindow"
}

private fun clock(iso: String, zone: String, locale: String): String =
    TimestampFormat.clock(Instant.parse(iso), workspaceZone(zone), locale)

@Composable
internal fun DispatchTaskRow(
    task: DispatchTask,
    block: DispatchBlock?,
    timezone: String,
    onTask: (String) -> Unit,
    editable: Boolean,
    onEdit: () -> Unit,
) {
    val locale = LocalAppLocale.current
    val uri = LocalUriHandler.current
    PaperCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
            TextButton(onClick = { onTask(task.id) }) { Text(task.title) }
            if (block != null) {
                Text(clock(block.starts_at, timezone, locale) + " – " + clock(block.ends_at, timezone, locale),
                    style = MaterialTheme.typography.bodySmall)
                if (block.locked) Text(t("contactsTasks.dispatchLocked"), style = MaterialTheme.typography.bodySmall)
                if (task.address != null && block.visit && block.address_confirmed) {
                    Text(task.address, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = {
                        uri.openUri("https://www.google.com/maps/dir/?api=1&destination=" + URLEncoder.encode(task.address, Charsets.UTF_8.name()))
                    }) { Text(t("contactsTasks.dispatchInstructions")) }
                }
            } else {
                Text(task.dispatch_estimate?.let { t("contactsTasks.dispatchDurationValue", "minutes" to it.toString()) }
                    ?: t("contactsTasks.dispatchEstimateMissing"), style = MaterialTheme.typography.bodySmall)
            }
            if (editable) TextButton(onClick = onEdit) {
                Text(t(if (block == null) "contactsTasks.dispatchNewBlock" else "contactsTasks.dispatchEditBlock"))
            }
        }
    }
}

@Composable
private fun DispatchAssignee(members: List<DispatchMember>, selected: String?, allowEmpty: Boolean, onPick: (String?) -> Unit) {
    val label = t("contactsTasks.dispatchAssignee")
    val options = buildList<SelectOption<String?>> {
        if (allowEmpty) add(SelectOption(null, t("contactsTasks.unassigned")))
        for (member in members) add(SelectOption(member.id, member.name ?: label))
    }
    SelectField(options, selected, onPick, label = label, fillWidth = true)
}

@Composable
private fun DispatchBlockEditor(
    plan: DispatchPlan,
    day: DispatchDay,
    task: DispatchTask,
    block: DispatchBlock?,
    worker: String?,
    slots: List<DispatchBlock>?,
    busy: Boolean,
    findSlots: (DispatchSlot, DispatchDetail, String) -> Unit,
    save: (DispatchEdit, DispatchDetail) -> Unit,
    saveDetails: (DispatchDetail) -> Unit,
    remove: () -> Unit,
) {
    val zone = workspaceZone(plan.timezone)
    val id = remember { block?.id ?: UUID.randomUUID().toString() }
    fun time(value: String?) = value?.let { Instant.parse(it).atZone(zone).toLocalTime().toString().take(5) }.orEmpty()
    fun local(value: String) = Instant.parse(value).atZone(zone).toLocalDateTime().toString().replace('T', ' ')
    fun fromLocal(value: String): Instant? = runCatching {
        val stamp = LocalDateTime.parse(value.replace(' ', 'T'))
        val offsets = zone.rules.getValidOffsets(stamp)
        offsets.firstOrNull()?.let(stamp::toInstant)
    }.getOrNull()

    var who by remember { mutableStateOf(block?.assignee_id ?: task.assigned_user_id ?: worker) }
    var date by remember { mutableStateOf(day.date) }
    var start by remember { mutableStateOf(time(block?.starts_at ?: day.opens_at)) }
    var duration by remember { mutableStateOf(block?.let {
        Duration.between(Instant.parse(it.starts_at), Instant.parse(it.ends_at)).toMinutes().toString()
    } ?: task.dispatch_estimate?.toString().orEmpty()) }
    var estimate by remember { mutableStateOf(task.dispatch_estimate?.toString().orEmpty()) }
    var windows by remember { mutableStateOf(task.windows.map { local(it.start) to local(it.end) }) }
    var visit by remember { mutableStateOf(block?.visit ?: false) }
    var confirmed by remember { mutableStateOf(block?.address_confirmed ?: false) }
    var locked by remember { mutableStateOf(block?.locked ?: false) }
    val minutes = duration.toIntOrNull()?.takeIf { it in 5..720 }
    val estimated = estimate.toIntOrNull()?.takeIf { it in 5..720 }
    val dateInWeek = plan.days.any { it.date == date }
    val begins = runCatching { LocalTime.parse(start) }.getOrNull()?.let { fromLocal("${date}T$it") }
    val parsed = windows.mapNotNull { (a, b) ->
        val first = fromLocal(a)
        val last = fromLocal(b)
        if (first != null && last != null && last > first) DispatchWindow(first.toString(), last.toString()) else null
    }
    val detail = DispatchDetail(task.id, task.updated_at, estimated, parsed)
    val valid = parsed.size == windows.size && (estimate.isBlank() || estimated != null)

    PaperCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHeader(t(if (block == null) "contactsTasks.dispatchNewBlock" else "contactsTasks.dispatchEditBlock"))
            Text(task.title, style = MaterialTheme.typography.titleMedium)
            DispatchAssignee(plan.members, who, allowEmpty = true) { who = it }
            OutlinedTextField(date, { date = it }, label = { Text(t("contactsTasks.dispatchDate")) }, singleLine = true)
            OutlinedTextField(start, { start = it }, label = { Text(t("contactsTasks.dispatchTimeFormat")) }, singleLine = true)
            OutlinedTextField(duration, { duration = it }, label = { Text(t("contactsTasks.dispatchDuration")) }, singleLine = true)
            OutlinedTextField(estimate, { estimate = it }, label = { Text(t("contactsTasks.dispatchEstimate")) }, singleLine = true)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = visit, onCheckedChange = { visit = it })
                Text(t("contactsTasks.dispatchOnsite"))
            }
            if (visit) {
                if (task.address == null) Text(t("contactsTasks.dispatchNoAddress"))
                else Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = confirmed, onCheckedChange = { confirmed = it })
                    Text(t("contactsTasks.dispatchConfirmAddress") + "\n" + task.address)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = locked, onCheckedChange = { locked = it })
                Text(t("contactsTasks.dispatchLock"))
            }
            SectionHeader(t("contactsTasks.dispatchWindows"))
            if (windows.isNotEmpty()) Text(t("contactsTasks.dispatchWindowFormat"), style = MaterialTheme.typography.bodySmall)
            windows.forEachIndexed { index, (first, last) ->
                OutlinedTextField(first, { text -> windows = windows.mapIndexed { i, value -> if (i == index) text to last else value } },
                    label = { Text(t("contactsTasks.dispatchWindowStart")) }, singleLine = true)
                OutlinedTextField(last, { text -> windows = windows.mapIndexed { i, value -> if (i == index) first to text else value } },
                    label = { Text(t("contactsTasks.dispatchWindowEnd")) }, singleLine = true)
                TextButton(onClick = { windows = windows.filterIndexed { i, _ -> i != index } }) {
                    Text(t("contactsTasks.dispatchWindowRemove"))
                }
            }
            TextButton(enabled = windows.size < 20, onClick = { windows = windows + ("" to "") }) {
                Text(t("contactsTasks.dispatchNewWindow"))
            }
            if (slots != null && slots.isEmpty()) Text(t("contactsTasks.dispatchSlotEmpty"))
            slots.orEmpty().forEach { slot ->
                TextButton(onClick = { start = time(slot.starts_at); who = slot.assignee_id }) {
                    Text((plan.members.find { it.id == slot.assignee_id }?.name.orEmpty()) + " · " + time(slot.starts_at))
                }
            }
            TextButton(enabled = !busy && dateInWeek && valid && minutes != null && (!visit || confirmed), onClick = {
                if (minutes != null) findSlots(DispatchSlot(id, task.id, minutes, visit, confirmed, who), detail, date)
            }) { Text(t("contactsTasks.dispatchFindSlot")) }
            TextButton(enabled = !busy && dateInWeek && valid && who != null && begins != null && minutes != null && (!visit || confirmed), onClick = {
                if (minutes != null && begins != null) save(DispatchEdit(id, task.id, task.updated_at,
                    reschedule = block?.locked == true, assignee_id = who, starts_at = begins.toString(),
                    ends_at = begins.plusSeconds(minutes.toLong() * 60).toString(), locked = locked,
                    visit = visit, confirm_address = visit && confirmed), detail)
            }) { Text(t("contactsTasks.dispatchAddDraft")) }
            TextButton(enabled = !busy && valid, onClick = { saveDetails(detail) }) { Text(t("contactsTasks.dispatchSaveDetails")) }
            if (block != null) TextButton(enabled = !busy, onClick = remove) { Text(t("contactsTasks.dispatchUnscheduled")) }
        }
    }
}
