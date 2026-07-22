package com.loonext.android.features.calls

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Dialpad
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PhoneCallback
import androidx.compose.material.icons.outlined.PhoneForwarded
import androidx.compose.material.icons.outlined.PhoneMissed
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.telephony.SoftphoneStatus
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class CallsFilter(val label: String, val outcome: String?) {
    All("All", null),
    Missed("Missed", CallOutcome.MISSED),
    Voicemail("Voicemail", CallOutcome.VOICEMAIL),
}

/**
 * /calls — softphone status line, All|Missed|Voicemail log (cursor-paged,
 * grouped by day), outcome rows, voicemail playback, realtime call.updated
 * refresh, and the dialer (spec 25). Registering the softphone here (and in
 * [CallsOverlay]) is what makes this member ring-eligible.
 */
@Composable
fun CallsScreen(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    openConversation: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val manager = remember(graph) { SoftphoneManager.get(context, graph.api) }
    val repo = remember(graph) { CallsRepository(graph.api) }
    val softphone by manager.state.collectAsStateWithLifecycle()

    LaunchedEffect(companyId, me.display_name) {
        manager.start(companyId, me.display_name)
    }

    var filter by rememberSaveable { mutableStateOf(CallsFilter.All) }
    var state by remember(companyId) { mutableStateOf<LoadState<List<Call>>>(LoadState.Loading) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var loadingMore by remember { mutableStateOf(false) }
    var refreshKey by remember { mutableStateOf(0) }
    var dialerOpen by rememberSaveable { mutableStateOf(false) }
    var dialerPrefill by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(companyId, filter, refreshKey) {
        if (state !is LoadState.Ready) state = LoadState.Loading
        state = try {
            val page = repo.calls(companyId, outcome = filter.outcome)
            nextCursor = page.next_cursor
            LoadState.Ready(page.data)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }
    // Realtime: the calls table's DB trigger broadcasts call.updated (ID-only)
    // on every session change — refetch the first page; ditto on re-join.
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event == "call.updated") refreshKey++
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 18.dp, end = 18.dp, top = 14.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                ScreenTitle("Calls")
                Spacer(Modifier.width(9.dp))
                SoftphoneStatusLine(
                    status = softphone.status,
                    onRetry = manager::retryNow,
                    modifier = Modifier.padding(bottom = 7.dp),
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                CallsFilter.entries.forEach { item ->
                    FilterPill(
                        label = item.label,
                        selected = filter == item,
                        onClick = { filter = item },
                    )
                }
            }

            when (val current = state) {
                is LoadState.Loading -> CenteredLoading()
                is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
                is LoadState.Ready -> {
                    if (current.value.isEmpty()) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                when (filter) {
                                    CallsFilter.Missed -> "No missed calls."
                                    CallsFilter.Voicemail -> "No voicemails."
                                    CallsFilter.All ->
                                        "No calls yet. When customers call your number, they land here."
                                },
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 32.dp),
                            )
                        }
                    } else {
                        val groups = remember(current.value) { groupByDay(current.value) }
                        LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(
                                start = 18.dp,
                                end = 18.dp,
                                top = 6.dp,
                                bottom = 24.dp,
                            ),
                        ) {
                            groups.forEach { (label, calls) ->
                                item(key = "hdr-$label") {
                                    SectionHeader(
                                        label,
                                        Modifier.padding(top = 10.dp),
                                        count = calls.size,
                                    )
                                }
                                item(key = "card-$label") {
                                    PaperCard(Modifier.fillMaxWidth()) {
                                        calls.forEachIndexed { index, call ->
                                            CallRow(
                                                call = call,
                                                repo = repo,
                                                companyId = companyId,
                                                onOpen = call.conversation_id?.let { id ->
                                                    { openConversation(id) }
                                                },
                                                onDialBack = call.caller_e164
                                                    ?.takeIf { it.isNotBlank() }
                                                    ?.let { number ->
                                                        {
                                                            dialerPrefill =
                                                                number.filter { it.isDigit() }
                                                            dialerOpen = true
                                                        }
                                                    },
                                            )
                                            if (index < calls.lastIndex) RowDivider()
                                        }
                                    }
                                }
                            }
                            if (nextCursor != null) {
                                item(key = "load-more") {
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 8.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        if (loadingMore) {
                                            LoadingIndicator()
                                        } else {
                                            TextButton(onClick = {
                                                val cursor = nextCursor ?: return@TextButton
                                                loadingMore = true
                                                scope.launch {
                                                    try {
                                                        val page = repo.calls(
                                                            companyId,
                                                            outcome = filter.outcome,
                                                            cursor = cursor,
                                                        )
                                                        nextCursor = page.next_cursor
                                                        val existing =
                                                            (state as? LoadState.Ready)?.value
                                                                ?: emptyList()
                                                        val seen =
                                                            existing.map { it.id }.toSet()
                                                        state = LoadState.Ready(
                                                            existing + page.data.filter {
                                                                it.id !in seen
                                                            },
                                                        )
                                                    } catch (_: Exception) {
                                                        // Keep what's loaded; button stays.
                                                    } finally {
                                                        loadingMore = false
                                                    }
                                                }
                                            }) { Text("Load more") }
                                        }
                                    }
                                }
                            }
                            item(key = "auto-text-hint") {
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(top = 14.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Surface(
                                        shape = CircleShape,
                                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                    ) {
                                        Text(
                                            "Missed calls text the customer back automatically",
                                            fontSize = 11.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.padding(
                                                horizontal = 14.dp,
                                                vertical = 7.dp,
                                            ),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // The dialpad FAB — 54dp ink circle above the pill nav (spec 25).
        Surface(
            onClick = {
                dialerPrefill = ""
                dialerOpen = true
            },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 18.dp, bottom = 10.dp)
                .size(54.dp)
                .shadow(14.dp, CircleShape, spotColor = BrandColor.Ink.copy(alpha = 0.3f)),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Outlined.Dialpad,
                    contentDescription = "Dial a number",
                    modifier = Modifier.size(19.dp),
                )
            }
        }
    }

    if (dialerOpen) {
        DialerSheet(
            manager = manager,
            numbers = (me.company?.numbers ?: emptyList()).filter {
                it.status == NumberStatus.ACTIVE && it.number_e164 != null
            },
            onDismiss = { dialerOpen = false },
            initialDigits = dialerPrefill,
        )
    }
}

/** "Ready to ring" beside the title — one calm line, tap retries when down. */
@Composable
private fun SoftphoneStatusLine(
    status: SoftphoneStatus,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val coral = if (isSystemInDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral
    val (label, dot, text) = when (status) {
        SoftphoneStatus.READY -> Triple(
            "Ready to ring",
            BrandColor.LimeBright,
            MaterialTheme.colorScheme.secondary,
        )

        SoftphoneStatus.CONNECTING -> Triple(
            "Connecting…",
            MaterialTheme.colorScheme.outline,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )

        SoftphoneStatus.DISCONNECTED -> Triple(
            "Offline · retry",
            coral,
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    LineStatusRow(
        text = label,
        dot = dot,
        textColor = text,
        modifier = modifier.clickable(
            enabled = status == SoftphoneStatus.DISCONNECTED,
            onClick = onRetry,
        ),
    )
}

/** Segmented pill: avatar-tint fill selected, quiet paper otherwise (spec 25). */
@Composable
private fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) {
            MaterialTheme.colorScheme.secondaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        contentColor = if (selected) {
            MaterialTheme.colorScheme.onSecondaryContainer
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun CallRow(
    call: Call,
    repo: CallsRepository,
    companyId: String,
    onOpen: (() -> Unit)?,
    onDialBack: (() -> Unit)?,
) {
    val name = callerDisplayName(call)
    val coral = if (isSystemInDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral
    Column(
        Modifier
            .fillMaxWidth()
            .then(
                if (onOpen != null) Modifier.clickable(onClick = onOpen) else Modifier,
            ),
    ) {
        Row(
            Modifier.padding(start = 15.dp, end = 15.dp, top = 11.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            InitialsAvatar(name, size = 38.dp)
            Column(Modifier.weight(1f)) {
                Text(
                    name,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(
                    Modifier.padding(top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        directionIcon(call),
                        contentDescription = null,
                        tint = if (isActionableMiss(call)) {
                            coral
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.size(12.dp),
                    )
                    Text(
                        callOutcomeLabel(call),
                        fontSize = 11.5.sp,
                        // Coral for the actionable inbound miss — the row's one
                        // tinted element; everything else stays quiet.
                        fontWeight = if (isActionableMiss(call)) {
                            FontWeight.SemiBold
                        } else {
                            FontWeight.Normal
                        },
                        color = if (isActionableMiss(call)) {
                            coral
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    screeningLabel(call.screening_result)?.let { label ->
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceContainer,
                        ) {
                            Text(
                                label,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }
            Text(
                relativeTime(call.started_at),
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.outline,
            )
            if (onDialBack != null) {
                Surface(
                    onClick = onDialBack,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.size(34.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Outlined.Call,
                            contentDescription = "Call back",
                            modifier = Modifier.size(15.dp),
                        )
                    }
                }
            }
        }
        if (call.outcome == CallOutcome.VOICEMAIL && (call.voicemail_seconds ?: 0) > 0) {
            VoicemailPlayerRow(
                repo = repo,
                companyId = companyId,
                sessionId = call.call_session_id,
                seconds = call.voicemail_seconds ?: 0,
            )
        }
    }
}

private fun directionIcon(call: Call): ImageVector = when {
    call.direction == "outbound" -> Icons.Outlined.PhoneForwarded
    call.outcome == CallOutcome.MISSED -> Icons.Outlined.PhoneMissed
    else -> Icons.Outlined.PhoneCallback
}

/** Newest-first log → ordered day buckets ("Today", "Yesterday", "Jul 8"). */
private fun groupByDay(calls: List<Call>): List<Pair<String, List<Call>>> {
    val today = LocalDate.now()
    val groups = LinkedHashMap<String, MutableList<Call>>()
    calls.forEach { call ->
        groups.getOrPut(dayLabel(call.started_at, today)) { mutableListOf() }.add(call)
    }
    return groups.map { (label, list) -> label to list }
}

private fun dayLabel(iso: String, today: LocalDate): String {
    val date = runCatching {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
    }.getOrNull() ?: return "Earlier"
    return when {
        date == today -> "Today"
        date == today.minusDays(1) -> "Yesterday"
        date.year == today.year -> date.format(DateTimeFormatter.ofPattern("MMM d"))
        else -> date.format(DateTimeFormatter.ofPattern("MMM d yyyy"))
    }
}

/**
 * Inline voicemail playback pill (spec 25): ink play disc, scrubber, tabular
 * length. Mints the 1h signed URL on demand (never cached), streams via
 * android.media.MediaPlayer with seek + live progress.
 */
@Composable
private fun VoicemailPlayerRow(
    repo: CallsRepository,
    companyId: String,
    sessionId: String,
    seconds: Int,
) {
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var preparing by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var positionMs by remember { mutableStateOf(0) }
    var durationMs by remember { mutableStateOf(seconds * 1000) }
    var error by remember { mutableStateOf<String?>(null) }
    var scrubbing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    DisposableEffect(sessionId) {
        onDispose {
            runCatching { player?.release() }
            player = null
        }
    }
    LaunchedEffect(playing, scrubbing) {
        while (playing && !scrubbing) {
            positionMs = runCatching { player?.currentPosition ?: 0 }.getOrDefault(0)
            delay(200)
        }
    }

    fun beginPlayback() {
        error = null
        preparing = true
        scope.launch {
            val url = try {
                repo.voicemail(companyId, sessionId).url
            } catch (cause: Exception) {
                error = cause.userMessage()
                preparing = false
                return@launch
            }
            runCatching { player?.release() }
            val next = MediaPlayer()
            player = next
            try {
                next.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                next.setDataSource(url)
                next.setOnPreparedListener {
                    durationMs = if (it.duration > 0) it.duration else seconds * 1000
                    it.start()
                    preparing = false
                    playing = true
                }
                next.setOnCompletionListener {
                    playing = false
                    positionMs = durationMs
                }
                next.setOnErrorListener { _, _, _ ->
                    error = "Couldn't play this voicemail."
                    playing = false
                    preparing = false
                    true
                }
                next.prepareAsync()
            } catch (_: Exception) {
                error = "Couldn't play this voicemail."
                preparing = false
            }
        }
    }

    Column(Modifier.padding(start = 64.dp, end = 15.dp, bottom = 12.dp)) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Surface(
                    onClick = {
                        val current = player
                        when {
                            preparing -> Unit
                            playing -> {
                                runCatching { current?.pause() }
                                playing = false
                            }

                            current != null -> {
                                // Replaying a finished clip restarts from the top.
                                if (positionMs >= durationMs) {
                                    runCatching { current.seekTo(0) }
                                    positionMs = 0
                                }
                                runCatching { current.start() }
                                playing = true
                            }

                            else -> beginPlayback()
                        }
                    },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(28.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        if (preparing) {
                            LoadingIndicator(Modifier.size(14.dp))
                        } else {
                            Icon(
                                if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                                contentDescription = if (playing) {
                                    "Pause voicemail"
                                } else {
                                    "Play voicemail"
                                },
                                modifier = Modifier.size(14.dp),
                            )
                        }
                    }
                }
                Slider(
                    value = positionMs.toFloat()
                        .coerceIn(0f, durationMs.toFloat().coerceAtLeast(1f)),
                    onValueChange = {
                        scrubbing = true
                        positionMs = it.toInt()
                    },
                    onValueChangeFinished = {
                        scrubbing = false
                        runCatching { player?.seekTo(positionMs) }
                    },
                    valueRange = 0f..durationMs.toFloat().coerceAtLeast(1f),
                    enabled = player != null,
                    colors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.primary,
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                        disabledThumbColor = MaterialTheme.colorScheme.outline,
                        disabledActiveTrackColor = MaterialTheme.colorScheme.outline,
                        disabledInactiveTrackColor =
                        MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                    ),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${formatTimer(positionMs.toLong())} / ${formatVoicemailLength(seconds)}",
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        error?.let {
            Text(
                it,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
