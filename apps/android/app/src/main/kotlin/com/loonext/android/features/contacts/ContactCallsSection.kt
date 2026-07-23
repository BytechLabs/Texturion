package com.loonext.android.features.contacts

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PhoneCallback
import androidx.compose.material.icons.outlined.PhoneForwarded
import androidx.compose.material.icons.outlined.PhoneMissed
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonListRow
import com.loonext.android.ui.common.SwipeAction
import com.loonext.android.ui.common.SwipeActionRow
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The contact detail's generic section scaffold (#205): a [SectionHeader]
 * over slotted content. Calls is the first tenant; per-contact tasks and
 * activity slot in later with the same shape — build against this, not
 * against the calls instance.
 */
@Composable
internal fun ContactSection(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        SectionHeader(title)
        content()
    }
}

/**
 * The contact's call history (#205): GET /v1/calls?contact_id=X newest-first,
 * day-grouped in the call log's grammar, cache-first (#176) with realtime
 * call.updated revalidation, voicemail playback inline, tap-through to the
 * conversation where one exists, and a quiet "Show more" past the first page.
 */
@Composable
internal fun ContactCallsSection(
    graph: AppGraph,
    mutations: ContactMutations,
    companyId: String,
    contactId: String,
    onCallBack: (() -> Unit)?,
    onOpenConversation: ((conversationId: String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    var refreshKey by remember(contactId) { mutableIntStateOf(0) }
    var loadingMore by remember(contactId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()

    // #176 cache-first: a reopened contact paints its call history instantly
    // from StoreCache while the first page revalidates silently; the skeleton
    // is the true first in-process fetch only. The merge keeps any deeper
    // pages the user already loaded (same semantics as the call log).
    val cacheKey = CacheKeys.contactCalls(companyId, contactId)
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = cacheKey,
        refreshKey = refreshKey,
    ) {
        mergeContactCallsFirstPage(
            graph.storeCache.flowOf<ContactCallsLog>(cacheKey).value,
            mutations.calls(companyId, contactId),
        )
    }
    // Realtime: call.updated broadcasts (ID-only) on every session change —
    // refetch the first page; ditto after a socket re-join.
    LaunchedEffect(contactId) {
        graph.realtime.events.collect { event ->
            if (event.event == "call.updated") refreshKey++
        }
    }
    LaunchedEffect(contactId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }
    // #215: heal a call.updated frame missed while backgrounded/blurred by
    // revalidating on return to the foreground.
    ResyncOnResume(contactId) { refreshKey++ }

    ContactSection("Calls", modifier) {
        when (val current = state) {
            is LoadState.Loading -> PaperCard(Modifier.fillMaxWidth()) {
                SkeletonListRow(avatar = false)
                RowDivider()
                SkeletonListRow(avatar = false)
            }

            is LoadState.Failed -> Column(Modifier.padding(start = 6.dp)) {
                Text(
                    current.message,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(
                    onClick = {
                        haptics.tap()
                        refreshKey++
                    },
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                ) { Text("Try again") }
            }

            is LoadState.Ready -> {
                if (current.value.calls.isEmpty()) {
                    Text(
                        "No calls with this contact yet.",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 6.dp),
                    )
                } else {
                    val groups = remember(current.value.calls) {
                        groupContactCallsByDay(current.value.calls)
                    }
                    groups.forEachIndexed { groupIndex, (label, calls) ->
                        SectionHeader(
                            label,
                            Modifier.padding(top = if (groupIndex == 0) 0.dp else 10.dp),
                            count = calls.size,
                        )
                        PaperCard(Modifier.fillMaxWidth()) {
                            calls.forEachIndexed { index, call ->
                                key(call.id) {
                                    ContactCallRow(
                                        call = call,
                                        mutations = mutations,
                                        companyId = companyId,
                                        onOpen = call.conversation_id
                                            ?.takeIf { onOpenConversation != null }
                                            ?.let { id -> { onOpenConversation?.invoke(id) } },
                                        onCallBack = onCallBack,
                                    )
                                    if (index < calls.lastIndex) RowDivider()
                                }
                            }
                        }
                    }
                    if (current.value.nextCursor != null) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .padding(top = 4.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (loadingMore) {
                                LoadingIndicator(Modifier.size(28.dp))
                            } else {
                                TextButton(onClick = {
                                    val cursor = current.value.nextCursor
                                        ?: return@TextButton
                                    haptics.tap()
                                    loadingMore = true
                                    scope.launch {
                                        try {
                                            val page = mutations.calls(
                                                companyId,
                                                contactId,
                                                cursor = cursor,
                                            )
                                            // Append onto whatever the cache holds
                                            // NOW (a silent revalidate may have
                                            // landed since the tap).
                                            val base = graph.storeCache
                                                .flowOf<ContactCallsLog>(cacheKey).value
                                                ?: current.value
                                            graph.storeCache.put(
                                                cacheKey,
                                                appendContactCallsPage(base, page),
                                            )
                                        } catch (_: Exception) {
                                            // Keep what's loaded; the button stays.
                                        } finally {
                                            loadingMore = false
                                        }
                                    }
                                }) { Text("Show more") }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * One call row in the detail's Calls section. Grammar REPLICATED from the
 * call log's row (features/calls/CallsScreen.kt CallRow) minus the avatar and
 * caller name — the whole screen is this contact, so the outcome line leads.
 * Swipe shortcuts keep the log's action semantics: right = call back
 * (confirm haptic), left = text back (the same conversation the row tap
 * opens); both stay reachable by tap, so the swipe is never the only door.
 */
@Composable
private fun ContactCallRow(
    call: Call,
    mutations: ContactMutations,
    companyId: String,
    onOpen: (() -> Unit)?,
    onCallBack: (() -> Unit)?,
) {
    val haptics = rememberHaptics()
    val coral = if (isSystemInDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral
    val miss = isContactActionableMiss(call)
    Column(Modifier.fillMaxWidth()) {
        SwipeActionRow(
            modifier = Modifier.fillMaxWidth(),
            startAction = onCallBack?.let { back ->
                SwipeAction(
                    icon = Icons.Outlined.Call,
                    label = "Call back",
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    container = MaterialTheme.colorScheme.secondaryContainer,
                    onCommit = {
                        haptics.confirm()
                        back()
                    },
                )
            },
            endAction = onOpen?.let { open ->
                SwipeAction(
                    icon = Icons.AutoMirrored.Outlined.Message,
                    label = "Text back",
                    tint = MaterialTheme.colorScheme.onTertiaryContainer,
                    container = MaterialTheme.colorScheme.tertiaryContainer,
                    onCommit = {
                        haptics.tap()
                        open()
                    },
                )
            },
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .then(
                        if (onOpen != null) {
                            Modifier.clickable {
                                haptics.tap()
                                onOpen()
                            }
                        } else {
                            Modifier
                        },
                    )
                    .padding(start = 15.dp, end = 15.dp, top = 11.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Icon(
                    contactCallDirectionIcon(call),
                    contentDescription = null,
                    tint = if (miss) coral else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    contactCallOutcomeLabel(call),
                    fontSize = 13.sp,
                    // Coral for the actionable inbound miss — the row's one
                    // tinted element; everything else stays quiet.
                    fontWeight = if (miss) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (miss) coral else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    relativeTime(call.started_at),
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.outline,
                )
                if (onCallBack != null) {
                    val callBackInteraction = remember { MutableInteractionSource() }
                    Surface(
                        onClick = {
                            haptics.tap()
                            onCallBack()
                        },
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        interactionSource = callBackInteraction,
                        modifier = Modifier
                            .size(34.dp)
                            .pressScale(callBackInteraction),
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
        }
        if (call.outcome == CallOutcome.VOICEMAIL && (call.voicemail_seconds ?: 0) > 0) {
            ContactVoicemailPlayerRow(
                mutations = mutations,
                companyId = companyId,
                sessionId = call.call_session_id,
                seconds = call.voicemail_seconds ?: 0,
            )
        }
    }
}

/** Source: features/calls/CallsScreen.kt private directionIcon. */
private fun contactCallDirectionIcon(call: Call): ImageVector = when {
    call.direction == "outbound" -> Icons.Outlined.PhoneForwarded
    call.outcome == CallOutcome.MISSED -> Icons.Outlined.PhoneMissed
    else -> Icons.Outlined.PhoneCallback
}

/**
 * Inline voicemail playback pill. Grammar and data path REPLICATED from
 * features/calls/CallsScreen.kt VoicemailPlayerRow (a later consolidation
 * pass may extract a shared component): mints the 1h signed URL on demand
 * via GET /v1/calls/:sessionId/voicemail (never cached), streams through
 * android.media.MediaPlayer with seek + live progress.
 */
@Composable
private fun ContactVoicemailPlayerRow(
    mutations: ContactMutations,
    companyId: String,
    sessionId: String,
    seconds: Int,
) {
    var player by remember(sessionId) { mutableStateOf<MediaPlayer?>(null) }
    var preparing by remember(sessionId) { mutableStateOf(false) }
    var playing by remember(sessionId) { mutableStateOf(false) }
    var positionMs by remember(sessionId) { mutableStateOf(0) }
    var durationMs by remember(sessionId) { mutableStateOf(seconds * 1000) }
    var error by remember(sessionId) { mutableStateOf<String?>(null) }
    var scrubbing by remember(sessionId) { mutableStateOf(false) }
    val haptics = rememberHaptics()
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
                mutations.voicemail(companyId, sessionId).url
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

    Column(Modifier.padding(start = 42.dp, end = 15.dp, bottom = 12.dp)) {
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
                val playInteraction = remember(sessionId) { MutableInteractionSource() }
                Surface(
                    onClick = {
                        val current = player
                        when {
                            preparing -> Unit
                            playing -> {
                                haptics.tap()
                                runCatching { current?.pause() }
                                playing = false
                            }

                            current != null -> {
                                haptics.tap()
                                // Replaying a finished clip restarts from the top.
                                if (positionMs >= durationMs) {
                                    runCatching { current.seekTo(0) }
                                    positionMs = 0
                                }
                                runCatching { current.start() }
                                playing = true
                            }

                            else -> {
                                haptics.tap()
                                beginPlayback()
                            }
                        }
                    },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    interactionSource = playInteraction,
                    modifier = Modifier
                        .size(28.dp)
                        .pressScale(playInteraction),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        if (preparing) {
                            LoadingIndicator(Modifier.size(14.dp))
                        } else {
                            AnimatedContent(
                                targetState = playing,
                                label = "contactVmPlayPause",
                            ) { isPlaying ->
                                Icon(
                                    if (isPlaying) {
                                        Icons.Outlined.Pause
                                    } else {
                                        Icons.Outlined.PlayArrow
                                    },
                                    contentDescription = if (isPlaying) {
                                        "Pause voicemail"
                                    } else {
                                        "Play voicemail"
                                    },
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                        }
                    }
                }
                // The bar waves while audio is audible; paused/idle keeps the
                // scrubber so seek stays one gesture away.
                Box(
                    Modifier
                        .weight(1f)
                        .height(44.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (playing && !scrubbing) {
                        LinearWavyProgressIndicator(
                            progress = {
                                (
                                    positionMs.toFloat() /
                                        durationMs.toFloat().coerceAtLeast(1f)
                                    ).coerceIn(0f, 1f)
                            },
                            color = MaterialTheme.colorScheme.primary,
                            trackColor =
                            MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        Slider(
                            value = positionMs.toFloat()
                                .coerceIn(0f, durationMs.toFloat().coerceAtLeast(1f)),
                            onValueChange = {
                                scrubbing = true
                                positionMs = it.toInt()
                            },
                            onValueChangeFinished = {
                                scrubbing = false
                                haptics.tick()
                                runCatching { player?.seekTo(positionMs) }
                            },
                            valueRange = 0f..durationMs.toFloat().coerceAtLeast(1f),
                            enabled = player != null,
                            colors = SliderDefaults.colors(
                                thumbColor = MaterialTheme.colorScheme.primary,
                                activeTrackColor = MaterialTheme.colorScheme.primary,
                                inactiveTrackColor =
                                MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                                disabledThumbColor = MaterialTheme.colorScheme.outline,
                                disabledActiveTrackColor = MaterialTheme.colorScheme.outline,
                                disabledInactiveTrackColor =
                                MaterialTheme.colorScheme.outline.copy(alpha = 0.4f),
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                Text(
                    "${contactCallTimer(positionMs.toLong())} / " +
                        contactVoicemailLength(seconds),
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
