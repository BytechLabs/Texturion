package com.loonext.android.features.calls

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
 * line in the shell): the top-pinned [IncomingCallBanner] while an inbound
 * call rings (#167 — its Popup floats over every surface), the persistent
 * call chip (live duration / held count), and the full-screen [InCallScreen]
 * both expand into. Mounting this is also what registers the softphone on
 * app open, so the member is ring-eligible even before ever visiting the
 * Calls tab — and what fires the one-shot POST_NOTIFICATIONS prompt.
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

    EnsureNotificationPermission()

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

    val inCallScreenShowing = expanded && snapshot.liveCalls.isNotEmpty()

    // The ringing banner — hidden while the full in-call screen is up (that
    // surface presents the ringing call itself, answer button included).
    IncomingCallBanner(
        call = if (inCallScreenShowing) null else bannerRingingCall(snapshot),
        manager = manager,
        company = me.company,
        onExpand = { expanded = true },
    )

    if (inCallScreenShowing) {
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
 * idle — and nothing while a call only RINGS (the top banner owns ringing
 * presentation, #167). A live call shows identity + ticking duration + hang
 * up; an ended call flashes "Call ended" briefly, then dismisses itself.
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
    val call = featured ?: endedChip ?: return

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
            if (call.phase == CallPhase.ENDED) {
                IconButton(onClick = { manager.dismiss(call.id) }) {
                    Icon(
                        Icons.Filled.CallEnd,
                        contentDescription = "Dismiss",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                IconButton(onClick = { manager.hangup(call.id) }) {
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
