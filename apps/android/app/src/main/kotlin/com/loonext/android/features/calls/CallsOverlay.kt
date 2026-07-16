package com.loonext.android.features.calls

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Me
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.telephony.SoftphoneSnapshot
import kotlinx.coroutines.delay

/**
 * The app-wide calls layer the integrator overlays ABOVE the tab bar (one
 * line in the shell): the persistent call chip (live duration / incoming
 * answer-decline / held count) and the full-screen [InCallScreen] it expands
 * into. Mounting this is also what registers the softphone on app open, so
 * the member is ring-eligible even before ever visiting the Calls tab.
 */
@Composable
fun CallsOverlay(
    graph: AppGraph,
    companyId: String,
    me: Me,
    openConversation: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val manager = remember(graph) { SoftphoneManager.get(context, graph.api) }
    val repo = remember(graph) { CallsRepository(graph.api) }
    val snapshot by manager.state.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }

    LaunchedEffect(companyId, me.display_name) {
        manager.start(companyId, me.display_name)
    }
    // Auto-surface the full screen the moment a call connects (answering from
    // the notification shade must land the user on the in-call controls).
    LaunchedEffect(snapshot.activeId) {
        if (snapshot.activeId != null) expanded = true
    }

    CallChip(
        snapshot = snapshot,
        manager = manager,
        onExpand = { expanded = true },
        modifier = modifier,
    )

    if (expanded && snapshot.liveCalls.isNotEmpty()) {
        Dialog(
            onDismissRequest = { expanded = false },
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                dismissOnClickOutside = false,
            ),
        ) {
            Surface(
                Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.surface,
            ) {
                InCallScreen(
                    manager = manager,
                    repo = repo,
                    companyId = companyId,
                    openConversation = { id ->
                        expanded = false
                        openConversation(id)
                    },
                    onClose = { expanded = false },
                )
            }
        }
    }
}

/**
 * The persistent chip above the tab bar. Nothing renders while the line is
 * idle. Ringing (no active call) shows Answer/Decline inline; a live call
 * shows identity + ticking duration + hang up; an ended call flashes
 * "Call ended" briefly, then dismisses itself.
 */
@Composable
fun CallChip(
    snapshot: SoftphoneSnapshot,
    manager: SoftphoneManager,
    onExpand: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ended = snapshot.calls.filter { it.phase == CallPhase.ENDED }
    LaunchedEffect(ended.map { it.id }) {
        if (ended.isNotEmpty()) {
            delay(2_500)
            ended.forEach { manager.dismiss(it.id) }
        }
    }

    val ringing = snapshot.calls.firstOrNull { it.phase == CallPhase.RINGING }
    val featured = snapshot.activeCall
        ?: snapshot.liveCalls.firstOrNull { it.phase != CallPhase.RINGING }
    val endedChip = if (featured == null && ringing == null) ended.lastOrNull() else null
    val call = featured ?: ringing ?: endedChip ?: return

    val isRingingChip = featured == null && ringing != null
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) manager.answer(call.id) }

    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .clickable(enabled = call.phase != CallPhase.ENDED, onClick = onExpand),
    ) {
        Row(
            Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(8.dp)
                    .background(
                        if (call.phase == CallPhase.ENDED) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                        CircleShape,
                    ),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                call.peerName,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                chipStatus(call, heldCount = snapshot.liveCalls.count {
                    it.phase == CallPhase.HELD
                }),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Spacer(Modifier.weight(1f))
            when {
                isRingingChip -> {
                    IconButton(onClick = { manager.hangup(call.id) }) {
                        Icon(
                            Icons.Filled.CallEnd,
                            contentDescription = "Decline",
                            tint = MaterialTheme.colorScheme.error,
                        )
                    }
                    IconButton(onClick = {
                        if (manager.hasMicPermission()) {
                            manager.answer(call.id)
                        } else {
                            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    }) {
                        Icon(
                            Icons.Filled.Call,
                            contentDescription = "Answer",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }

                call.phase == CallPhase.ENDED -> IconButton(
                    onClick = { manager.dismiss(call.id) },
                ) {
                    Icon(
                        Icons.Filled.CallEnd,
                        contentDescription = "Dismiss",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                else -> IconButton(onClick = { manager.hangup(call.id) }) {
                    Icon(
                        Icons.Filled.CallEnd,
                        contentDescription = "Hang up",
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun chipStatus(call: CallSnapshot, heldCount: Int): String = when (call.phase) {
    CallPhase.RINGING -> "Incoming call"
    CallPhase.CONNECTING -> "Calling…"
    CallPhase.HELD -> "On hold"
    CallPhase.ENDED -> "Call ended"
    CallPhase.ACTIVE -> {
        val anchor = call.activeSinceMs
        val timer = if (anchor == null) {
            ""
        } else {
            val now by produceState(System.currentTimeMillis(), call.id) {
                while (true) {
                    value = System.currentTimeMillis()
                    delay(1_000)
                }
            }
            formatTimer(now - anchor)
        }
        if (heldCount > 0 && timer.isNotEmpty()) "$timer · $heldCount on hold" else timer
    }
}
