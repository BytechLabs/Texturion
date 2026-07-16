package com.loonext.android.features.calls

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Dialpad
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhoneForwarded
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.core.model.Member
import com.loonext.android.telephony.AudioRoute
import com.loonext.android.telephony.CallDirection
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The live-call surface: identity + duration, hold/mute/route/DTMF, blind
 * transfer with honest busy flags, add-note (opens the conversation), and
 * call-waiting (answer the 2nd holds the 1st; the core auto-declines a 3rd).
 * Rendered by [CallsOverlay] in a full-screen dialog above the shell.
 */
@Composable
fun InCallScreen(
    manager: SoftphoneManager,
    repo: CallsRepository,
    companyId: String,
    openConversation: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot by manager.state.collectAsStateWithLifecycle()
    val live = snapshot.liveCalls
    LaunchedEffect(live.isEmpty()) {
        if (live.isEmpty()) {
            // A brief beat so "Call ended" registers, then close.
            delay(400)
            onClose()
        }
    }
    val featured = snapshot.activeCall
        ?: live.firstOrNull { it.phase != CallPhase.RINGING }
        ?: live.firstOrNull()
        ?: snapshot.calls.lastOrNull()

    var dtmfOpen by remember { mutableStateOf(false) }
    var transferOpen by remember { mutableStateOf(false) }
    var speakerOn by remember { mutableStateOf(false) }
    var bluetoothOn by remember { mutableStateOf(false) }

    // The notes deep-link: resolve live facts once the session id is known.
    var conversationId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(featured?.sessionId) {
        conversationId = null
        val session = featured?.sessionId ?: return@LaunchedEffect
        conversationId = runCatching { manager.liveFacts(session).conversation_id }.getOrNull()
    }

    Column(
        modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))

        if (featured != null) {
            InitialsAvatar(featured.peerName, size = 72.dp)
            Spacer(Modifier.height(16.dp))
            Text(
                featured.peerName,
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )
            if (featured.peerNumber.isNotBlank() &&
                formatPhone(featured.peerNumber) != featured.peerName
            ) {
                Text(
                    formatPhone(featured.peerNumber),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(4.dp))
            CallPhaseLine(featured)
        }

        Spacer(Modifier.height(12.dp))
        snapshot.error?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        // Other calls: held lines to swap back to, or a ringing 2nd call.
        val others = live.filter { it.id != featured?.id }
        if (others.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            others.forEach { other ->
                OtherCallRow(other, manager)
                Spacer(Modifier.height(8.dp))
            }
        }

        Spacer(Modifier.weight(1f))

        if (featured != null && featured.phase != CallPhase.RINGING) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledIconToggleButton(
                    checked = featured.muted,
                    onCheckedChange = { manager.setMuted(featured.id, it) },
                ) {
                    Icon(
                        if (featured.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                        contentDescription = if (featured.muted) "Unmute" else "Mute",
                    )
                }
                FilledTonalIconButton(
                    onClick = { dtmfOpen = true },
                    enabled = featured.phase == CallPhase.ACTIVE,
                ) {
                    Icon(Icons.Filled.Dialpad, contentDescription = "Keypad")
                }
                FilledIconToggleButton(
                    checked = speakerOn,
                    onCheckedChange = { on ->
                        speakerOn = on
                        if (on) bluetoothOn = false
                        manager.setAudioRoute(
                            if (on) AudioRoute.SPEAKER else AudioRoute.EARPIECE,
                        )
                    },
                ) {
                    Icon(Icons.Filled.VolumeUp, contentDescription = "Speaker")
                }
                FilledIconToggleButton(
                    checked = bluetoothOn,
                    onCheckedChange = { on ->
                        bluetoothOn = on
                        if (on) speakerOn = false
                        manager.setAudioRoute(
                            if (on) AudioRoute.BLUETOOTH else AudioRoute.EARPIECE,
                        )
                    },
                ) {
                    Icon(Icons.Filled.Bluetooth, contentDescription = "Bluetooth")
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledIconToggleButton(
                    checked = featured.phase == CallPhase.HELD,
                    onCheckedChange = { manager.toggleHold(featured.id) },
                ) {
                    Icon(
                        if (featured.phase == CallPhase.HELD) {
                            Icons.Filled.PlayArrow
                        } else {
                            Icons.Filled.Pause
                        },
                        contentDescription = if (featured.phase == CallPhase.HELD) {
                            "Resume"
                        } else {
                            "Hold"
                        },
                    )
                }
                FilledTonalIconButton(
                    onClick = { transferOpen = true },
                    // Transfer needs the CUSTOMER session — resolved via
                    // by-leg for inbound answers; disabled until it lands.
                    enabled = featured.sessionId != null &&
                        featured.phase == CallPhase.ACTIVE,
                ) {
                    Icon(Icons.Filled.PhoneForwarded, contentDescription = "Transfer")
                }
                FilledTonalIconButton(
                    onClick = { conversationId?.let(openConversation) },
                    enabled = conversationId != null,
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Message,
                        contentDescription = "Add a note in the conversation",
                    )
                }
            }
        }

        Spacer(Modifier.height(24.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onClose) { Text("Hide") }
            FilledIconButton(
                onClick = { featured?.let { manager.hangup(it.id) } },
                enabled = featured != null,
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
                modifier = Modifier.size(64.dp),
            ) {
                Icon(Icons.Filled.CallEnd, contentDescription = "Hang up")
            }
            Spacer(Modifier.width(64.dp))
        }
        Spacer(Modifier.height(16.dp))
    }

    if (dtmfOpen && featured != null) {
        DtmfSheet(
            onDigit = { manager.dtmf(featured.id, it) },
            onDismiss = { dtmfOpen = false },
        )
    }
    if (transferOpen && featured?.sessionId != null) {
        TransferSheet(
            manager = manager,
            repo = repo,
            companyId = companyId,
            sessionId = featured.sessionId!!,
            onDismiss = { transferOpen = false },
        )
    }
}

/** "Ringing…" / "Connecting…" / live timer / "On hold" / "Call ended". */
@Composable
private fun CallPhaseLine(call: CallSnapshot) {
    val text = when (call.phase) {
        CallPhase.RINGING -> "Incoming call"
        CallPhase.CONNECTING -> "Calling…"
        CallPhase.HELD -> "On hold"
        CallPhase.ENDED -> "Call ended"
        CallPhase.ACTIVE -> {
            val anchor = call.activeSinceMs
            if (anchor == null) {
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
        }
    }
    if (text.isNotEmpty()) {
        Text(
            text,
            style = MaterialTheme.typography.titleMedium,
            color = if (call.phase == CallPhase.ACTIVE) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}

/** A held line to swap to, or a ringing second call (answer holds current). */
@Composable
private fun OtherCallRow(call: CallSnapshot, manager: SoftphoneManager) {
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) manager.answer(call.id) }

    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(call.peerName, style = MaterialTheme.typography.titleSmall)
                Text(
                    when (call.phase) {
                        CallPhase.RINGING -> "Incoming call"
                        CallPhase.HELD -> "On hold"
                        CallPhase.CONNECTING -> "Calling…"
                        else -> ""
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (call.phase == CallPhase.RINGING) {
                TextButton(onClick = { manager.hangup(call.id) }) { Text("Decline") }
                Spacer(Modifier.width(4.dp))
                FilledTonalButton(onClick = {
                    if (manager.hasMicPermission()) {
                        manager.answer(call.id)
                    } else {
                        micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }) {
                    Icon(
                        Icons.Filled.Call,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("Answer")
                }
            } else if (call.phase == CallPhase.HELD) {
                FilledTonalButton(onClick = { manager.toggleHold(call.id) }) {
                    Text("Swap")
                }
            }
        }
    }
}

/** In-call DTMF keypad for IVR navigation — digits send immediately. */
@Composable
private fun DtmfSheet(onDigit: (String) -> Unit, onDismiss: () -> Unit) {
    var sent by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                sent.ifEmpty { "Keypad" },
                style = MaterialTheme.typography.headlineSmall,
                color = if (sent.isEmpty()) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                modifier = Modifier.padding(vertical = 12.dp),
            )
            listOf(
                listOf("1", "2", "3"),
                listOf("4", "5", "6"),
                listOf("7", "8", "9"),
                listOf("*", "0", "#"),
            ).forEach { row ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    row.forEach { key ->
                        TextButton(
                            onClick = {
                                sent += key
                                onDigit(key)
                            },
                            modifier = Modifier
                                .weight(1f)
                                .height(56.dp),
                        ) {
                            Text(key, style = MaterialTheme.typography.headlineSmall)
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/**
 * Blind-transfer picker: eligible teammates with honest busy flags. Names
 * come from GET /v1/members (targets are id-only). Decline/timeout recovery
 * is server-side — the customer snaps back to us, never stranded.
 */
@Composable
private fun TransferSheet(
    manager: SoftphoneManager,
    repo: CallsRepository,
    companyId: String,
    sessionId: String,
    onDismiss: () -> Unit,
) {
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var rows by remember { mutableStateOf<List<TransferRow>>(emptyList()) }
    var transferring by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(sessionId, reloadKey) {
        loading = true
        error = null
        try {
            val targets = manager.transferTargets(sessionId).targets
            val members = repo.members(companyId).data.associateBy(Member::user_id)
            rows = targets.map { target ->
                TransferRow(
                    userId = target.user_id,
                    name = members[target.user_id]?.display_name
                        ?.takeIf { it.isNotBlank() }
                        ?: "Teammate",
                    busy = target.busy,
                )
            }
        } catch (cause: Exception) {
            error = cause.userMessage()
        } finally {
            loading = false
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 24.dp, vertical = 8.dp)) {
            Text("Transfer to", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            when {
                loading -> Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 24.dp),
                    horizontalArrangement = Arrangement.Center,
                ) { LoadingIndicator() }

                error != null -> Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        error ?: "Something went wrong.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    OutlinedButton(
                        onClick = { reloadKey++ },
                        modifier = Modifier.padding(vertical = 12.dp),
                    ) { Text("Try again") }
                }

                rows.isEmpty() -> Text(
                    "No teammates can take this call right now.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 24.dp),
                )

                else -> Column {
                    rows.forEach { row ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            InitialsAvatar(row.name, size = 36.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(row.name, style = MaterialTheme.typography.bodyLarge)
                                if (row.busy) {
                                    Text(
                                        "On a call",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            FilledTonalButton(
                                enabled = !row.busy && !transferring,
                                onClick = {
                                    transferring = true
                                    error = null
                                    scope.launch {
                                        try {
                                            manager.blindTransfer(sessionId, row.userId)
                                            onDismiss()
                                        } catch (cause: Exception) {
                                            error = cause.userMessage()
                                        } finally {
                                            transferring = false
                                        }
                                    }
                                },
                            ) { Text("Transfer") }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private data class TransferRow(val userId: String, val name: String, val busy: Boolean)
