package com.loonext.android.features.calls

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dialpad
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhoneCallback
import androidx.compose.material.icons.filled.PhoneForwarded
import androidx.compose.material.icons.filled.PhoneMissed
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
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
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class CallsFilter(val label: String, val outcome: String?) {
    All("All", null),
    Missed("Missed", CallOutcome.MISSED),
}

/**
 * /calls — softphone status pill, All|Missed log (cursor-paged), outcome
 * rows, voicemail playback, realtime call.updated refresh, and the dialer.
 * Registering the softphone here (and in [CallsOverlay]) is what makes this
 * member ring-eligible.
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

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 12.dp, top = 16.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Calls", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "Calls ring here while the app is open.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            SoftphoneStatusPill(
                status = softphone.status,
                onRetry = manager::retryNow,
            )
            IconButton(onClick = { dialerOpen = true }) {
                Icon(Icons.Filled.Dialpad, contentDescription = "Dial a number")
            }
        }

        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            CallsFilter.entries.forEachIndexed { index, item ->
                SegmentedButton(
                    selected = filter == item,
                    onClick = { filter = item },
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = CallsFilter.entries.size,
                    ),
                ) { Text(item.label) }
            }
        }

        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                if (current.value.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            if (filter == CallsFilter.Missed) "No missed calls."
                            else "No calls yet. When customers call your number, they land here.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 32.dp),
                        )
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(current.value, key = { it.id }) { call ->
                            CallRow(
                                call = call,
                                repo = repo,
                                companyId = companyId,
                                onOpen = call.conversation_id?.let { id ->
                                    { openConversation(id) }
                                },
                            )
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
                                                    val seen = existing.map { it.id }.toSet()
                                                    state = LoadState.Ready(
                                                        existing + page.data.filter {
                                                            it.id !in seen
                                                        },
                                                    )
                                                } catch (_: Exception) {
                                                    // Keep what's loaded; the button stays.
                                                } finally {
                                                    loadingMore = false
                                                }
                                            }
                                        }) { Text("Load more") }
                                    }
                                }
                            }
                        }
                    }
                }
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
        )
    }
}

/** Ready / Connecting / Offline — one calm pill, tap retries when down. */
@Composable
private fun SoftphoneStatusPill(status: SoftphoneStatus, onRetry: () -> Unit) {
    val (label, dotColor) = when (status) {
        SoftphoneStatus.READY -> "Ready" to MaterialTheme.colorScheme.primary
        SoftphoneStatus.CONNECTING ->
            "Connecting…" to MaterialTheme.colorScheme.onSurfaceVariant

        SoftphoneStatus.DISCONNECTED ->
            "Offline · retry" to MaterialTheme.colorScheme.tertiary
    }
    Surface(
        shape = RoundedCornerShape(percent = 50),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.clickable(
            enabled = status == SoftphoneStatus.DISCONNECTED,
            onClick = onRetry,
        ),
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .background(dotColor, CircleShape),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CallRow(
    call: Call,
    repo: CallsRepository,
    companyId: String,
    onOpen: (() -> Unit)?,
) {
    val name = callerDisplayName(call)
    Column(
        Modifier
            .fillMaxWidth()
            .then(
                if (onOpen != null) Modifier.clickable(onClick = onOpen) else Modifier,
            )
            .padding(horizontal = 20.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            InitialsAvatar(name)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.bodyLarge)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        directionIcon(call),
                        contentDescription = null,
                        tint = if (isActionableMiss(call)) {
                            MaterialTheme.colorScheme.tertiary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        callOutcomeLabel(call),
                        style = MaterialTheme.typography.labelMedium,
                        // Amber for the actionable inbound miss — the row's
                        // one tinted element; everything else stays quiet.
                        color = if (isActionableMiss(call)) {
                            MaterialTheme.colorScheme.tertiary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    screeningLabel(call.screening_result)?.let { label ->
                        Spacer(Modifier.width(8.dp))
                        Surface(
                            shape = RoundedCornerShape(percent = 50),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        ) {
                            Text(
                                label,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(
                                    horizontal = 8.dp,
                                    vertical = 2.dp,
                                ),
                            )
                        }
                    }
                }
            }
            Text(
                relativeTime(call.started_at),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

private fun directionIcon(call: Call): ImageVector = when {
    call.direction == "outbound" -> Icons.Filled.PhoneForwarded
    call.outcome == CallOutcome.MISSED -> Icons.Filled.PhoneMissed
    else -> Icons.Filled.PhoneCallback
}

/**
 * Inline voicemail playback: mint the 1h signed URL on demand (never cached),
 * stream via android.media.MediaPlayer with seek + live progress.
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

    Column(Modifier.padding(start = 52.dp, top = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FilledTonalIconButton(
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
                modifier = Modifier.size(36.dp),
            ) {
                if (preparing) {
                    LoadingIndicator(Modifier.size(18.dp))
                } else {
                    Icon(
                        if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (playing) "Pause voicemail" else "Play voicemail",
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Slider(
                value = positionMs.toFloat().coerceIn(0f, durationMs.toFloat().coerceAtLeast(1f)),
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
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "${formatTimer(positionMs.toLong())} / ${formatVoicemailLength(seconds)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        error?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
