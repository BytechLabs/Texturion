package com.loonext.android.features.calls

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Me
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.telephony.SoftphoneSnapshot
import com.loonext.android.ui.common.IconSize
import kotlinx.coroutines.delay

/**
 * The app-wide calls layer the integrator overlays ABOVE the tab bar (one line
 * in the shell): the persistent call chip (live duration / held count) and the
 * full-screen [InCallScreen] it expands into. The incoming RING is owned by
 * Android Telecom now (#171/§6) — there is no in-app ring surface here.
 * Mounting this is also what registers the softphone on app open, so the member
 * is ring-eligible even before ever visiting the Calls tab.
 *
 * #286: the one-shot POST_NOTIFICATIONS prompt used to fire from here, cold, on
 * first launch. It now belongs to NotificationPrimer (and to the joining
 * orientation's last screen), which say what the alerts are before spending the
 * only prompt Android gives us.
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

    // #168A/D: a softphone error with NO call presenting it (idle line) —
    // e.g. "Couldn't answer — try again." after the ring already ended, or
    // "A call was interrupted when the app closed unexpectedly." on the
    // start after a mid-call crash. One calm dismissible line; in-call and
    // ringing errors render on their own surfaces.
    if (snapshot.error != null && snapshot.liveCalls.isEmpty()) {
        SoftphoneNotice(
            message = snapshot.error!!,
            onDismiss = { manager.clearError() },
            modifier = modifier,
        )
    }

    val inCallScreenShowing = expanded && snapshot.liveCalls.isNotEmpty()

    // #171 (§6.1): the in-app IncomingCallBanner is DELETED — Android Telecom
    // presents the incoming ring on EVERY surface (foreground, background,
    // locked, Bluetooth), so an in-app ring surface would only re-introduce the
    // two-owner double-ring this rearchitecture exists to delete. The post-answer
    // in-call screen (below) stays.

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
                color = callScreenColor(),
            ) {
                Box(Modifier.fillMaxSize()) {
                    // #204: the same living backdrop as the standalone call
                    // surface, behind the expanded in-call screen. This dialog
                    // is also the outbound dialing surface (placing a call sets
                    // the active id while CONNECTING), so the calm dial drift
                    // and the connect pulse both happen right here.
                    CallBackdrop(
                        phase = (
                            snapshot.activeCall
                                ?: snapshot.liveCalls.firstOrNull { it.phase != CallPhase.RINGING }
                                ?: snapshot.liveCalls.firstOrNull()
                            )?.phase,
                    )
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
}

/** One calm dismissible error line above the tab bar (#168A/D). */
@Composable
private fun SoftphoneNotice(
    message: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Row(
            Modifier.padding(start = 14.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text(t("contactsTasks.dismiss")) }
        }
    }
}

@Composable
private fun CallChip(
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
    CallStrip(
        call = call,
        heldCount = snapshot.liveCalls.count { it.phase == CallPhase.HELD },
        onExpand = onExpand,
        onEnd = {
            if (call.phase == CallPhase.ENDED) manager.dismiss(call.id) else manager.hangup(call.id)
        },
        modifier = modifier,
    )
}

@Composable
internal fun CallStrip(
    call: CallSnapshot,
    heldCount: Int,
    onExpand: () -> Unit,
    onEnd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val ended = call.phase == CallPhase.ENDED

    Surface(
        shape = MaterialTheme.shapes.large,
        color = colors.surface,
        border = BorderStroke(1.dp, colors.outlineVariant),
        shadowElevation = 2.dp,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 6.dp),
    ) {
        Row(
            Modifier.padding(start = 10.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier
                    .weight(1f)
                    .clickable(enabled = !ended, role = Role.Button, onClick = onExpand)
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CallPhaseIcon(call.phase)
                Column(Modifier.weight(1f)) {
                    Text(
                        call.peerName,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CallPhaseBadge(call.phase)
                        CallStripTimer(call, heldCount)
                    }
                }
            }
            IconButton(
                onClick = onEnd,
                colors = IconButtonDefaults.iconButtonColors(
                    containerColor = if (ended) colors.surfaceContainer else colors.errorContainer,
                    contentColor = if (ended) colors.onSurfaceVariant else colors.onErrorContainer,
                ),
            ) {
                Icon(
                    if (ended) Icons.Outlined.Close else Icons.Outlined.CallEnd,
                    contentDescription = t(if (ended) "contactsTasks.dismiss" else "contactsTasks.hangUp"),
                    modifier = Modifier.size(IconSize.Default),
                )
            }
        }
    }
}

@Composable
private fun CallStripTimer(call: CallSnapshot, heldCount: Int) {
    val anchor = call.activeSinceMs ?: return
    if (call.phase != CallPhase.ACTIVE) return
    val now by produceState(System.currentTimeMillis(), call.id, anchor) {
        while (true) {
            value = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val elapsed = formatTimer(now - anchor)
    Text(
        if (heldCount > 0) {
            t("contactsTasks.timerOnHold", "timer" to elapsed, "count" to heldCount.toString())
        } else {
            elapsed
        },
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
