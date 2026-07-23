package com.loonext.android.features.calls

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.outlined.Bluetooth
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Dialpad
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PhoneForwarded
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.core.model.Member
import com.loonext.android.telephony.AudioRoute
import com.loonext.android.telephony.CallDirection
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The live-call surface (specs 26/32): identity halo + Bricolage name + big
 * timer, the paper-circle control grid (mute/keypad/hold · transfer/note/
 * speaker), the call-note card, blind transfer with honest busy flags, and
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
            .padding(start = 22.dp, end = 22.dp, top = 10.dp, bottom = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth()) {
            Surface(
                onClick = onClose,
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.onSurface,
                shadowElevation = 1.dp,
                modifier = Modifier.size(44.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.KeyboardArrowDown,
                        contentDescription = "Hide",
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
        }

        if (featured != null) {
            CallerAvatar(
                featured.peerName,
                size = 96.dp,
                badge = featured.phase != CallPhase.RINGING,
                ringing = featured.phase == CallPhase.RINGING,
            )
            Text(
                featured.peerName,
                style = MaterialTheme.typography.headlineSmall.copy(fontSize = 26.sp),
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
            if (featured.peerNumber.isNotBlank() &&
                formatPhone(featured.peerNumber) != featured.peerName
            ) {
                Text(
                    formatPhone(featured.peerNumber),
                    fontSize = 12.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            CallPhaseLine(featured)
        }

        snapshot.error?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
        }

        // Other calls: held lines to swap back to, or a ringing 2nd call.
        val others = live.filter { it.id != featured?.id }
        if (others.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            others.forEach { other ->
                OtherCallRow(other, manager)
                Spacer(Modifier.height(8.dp))
            }
        }

        Spacer(Modifier.weight(1f))

        if (featured != null && featured.phase != CallPhase.RINGING) {
            if (conversationId != null) {
                CallNoteCard(
                    onClick = { conversationId?.let(openConversation) },
                    modifier = Modifier.padding(bottom = 16.dp),
                )
            }
            Row(Modifier.fillMaxWidth()) {
                ControlCircle(
                    icon = if (featured.muted) Icons.Outlined.MicOff else Icons.Outlined.Mic,
                    label = if (featured.muted) "Unmute" else "Mute",
                    contentDescription = if (featured.muted) "Unmute" else "Mute",
                    active = featured.muted,
                    onClick = { manager.setMuted(featured.id, !featured.muted) },
                    modifier = Modifier.weight(1f),
                )
                ControlCircle(
                    icon = Icons.Outlined.Dialpad,
                    label = "Keypad",
                    contentDescription = "Keypad",
                    enabled = featured.phase == CallPhase.ACTIVE,
                    onClick = { dtmfOpen = true },
                    modifier = Modifier.weight(1f),
                )
                ControlCircle(
                    icon = if (featured.phase == CallPhase.HELD) {
                        Icons.Outlined.PlayArrow
                    } else {
                        Icons.Outlined.Pause
                    },
                    label = if (featured.phase == CallPhase.HELD) "Resume" else "Hold",
                    contentDescription = if (featured.phase == CallPhase.HELD) {
                        "Resume"
                    } else {
                        "Hold"
                    },
                    active = featured.phase == CallPhase.HELD,
                    onClick = { manager.toggleHold(featured.id) },
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth()) {
                ControlCircle(
                    icon = Icons.Outlined.PhoneForwarded,
                    label = "Transfer",
                    contentDescription = "Transfer",
                    // Transfer needs the CUSTOMER session — resolved via
                    // by-leg for inbound answers; disabled until it lands.
                    enabled = featured.sessionId != null &&
                        featured.phase == CallPhase.ACTIVE,
                    onClick = { transferOpen = true },
                    modifier = Modifier.weight(1f),
                )
                ControlCircle(
                    icon = Icons.AutoMirrored.Outlined.Message,
                    label = "Note",
                    contentDescription = "Add a note in the conversation",
                    active = true,
                    enabled = conversationId != null,
                    onClick = { conversationId?.let(openConversation) },
                    modifier = Modifier.weight(1f),
                )
                ControlCircle(
                    icon = Icons.Outlined.VolumeUp,
                    label = "Speaker",
                    contentDescription = "Speaker",
                    active = speakerOn,
                    onClick = {
                        val on = !speakerOn
                        speakerOn = on
                        if (on) bluetoothOn = false
                        manager.setAudioRoute(
                            if (on) AudioRoute.SPEAKER else AudioRoute.EARPIECE,
                        )
                    },
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(10.dp))
            ControlCircle(
                icon = Icons.Outlined.Bluetooth,
                label = "Bluetooth",
                contentDescription = "Bluetooth",
                active = bluetoothOn,
                size = 44.dp,
                onClick = {
                    val on = !bluetoothOn
                    bluetoothOn = on
                    if (on) speakerOn = false
                    manager.setAudioRoute(
                        if (on) AudioRoute.BLUETOOTH else AudioRoute.EARPIECE,
                    )
                },
            )
        }

        Spacer(Modifier.height(18.dp))
        if (featured != null && featured.phase == CallPhase.RINGING &&
            featured.direction == CallDirection.INBOUND
        ) {
            // Expanded while still ringing (the banner's tap-to-expand path,
            // #167): full answer/decline controls, mic preflight on answer —
            // a refusal keeps ringing with an inline notice, never a decline.
            var micNotice by remember(featured.id) { mutableStateOf(false) }
            val answerLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission(),
            ) { granted ->
                if (granted) manager.answerRinging(featured) else micNotice = true
            }
            if (micNotice) {
                Text(
                    "Allow microphone access to answer this call.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 26.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RingActionCircle(
                    icon = Icons.Outlined.CallEnd,
                    label = "Decline",
                    container = MaterialTheme.colorScheme.error,
                    content = MaterialTheme.colorScheme.onError,
                    labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    labelWeight = FontWeight.SemiBold,
                    size = 64.dp,
                    onClick = { manager.hangup(featured.id) },
                )
                RingActionCircle(
                    icon = Icons.Outlined.Call,
                    label = "Answer",
                    container = MaterialTheme.colorScheme.tertiary,
                    content = MaterialTheme.colorScheme.onTertiary,
                    labelColor = MaterialTheme.colorScheme.onBackground,
                    labelWeight = FontWeight.Bold,
                    size = 64.dp,
                    onClick = {
                        if (manager.hasMicPermission()) {
                            manager.answerRinging(featured)
                        } else {
                            answerLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                )
            }
        } else {
            EndCallPill(
                onClick = { featured?.let { manager.hangup(it.id) } },
                enabled = featured != null,
                label = "End call",
                modifier = Modifier.fillMaxWidth(),
            )
        }
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

/** A ring-screen action: 64-72dp colored disc + tiny label (spec 04). */
@Composable
internal fun RingActionCircle(
    icon: ImageVector,
    label: String,
    container: Color,
    content: Color,
    labelColor: Color,
    labelWeight: FontWeight,
    size: Dp,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = container,
            contentColor = content,
            modifier = Modifier.size(size),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(26.dp))
            }
        }
        Text(label, fontSize = 11.sp, fontWeight = labelWeight, color = labelColor)
    }
}

/** "Call note · saves to the thread" — tap opens the conversation (spec 26). */
@Composable
private fun CallNoteCard(onClick: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 15.dp, vertical = 12.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.Message,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    "CALL NOTE · SAVES TO THE THREAD",
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.08.em,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
            Text(
                "Add a note in the conversation…",
                fontSize = 13.5.sp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f),
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

/** "Ringing…" / "Connecting…" / the big live timer / "On hold" / "Call ended". */
@Composable
private fun CallPhaseLine(call: CallSnapshot) {
    if (call.phase == CallPhase.ACTIVE) {
        val anchor = call.activeSinceMs
        if (anchor != null) {
            val now by produceState(System.currentTimeMillis(), call.id) {
                while (true) {
                    value = System.currentTimeMillis()
                    delay(1_000)
                }
            }
            Text(
                formatTimer(now - anchor),
                fontSize = 48.sp,
                fontWeight = FontWeight.Normal,
                letterSpacing = (-0.01).em,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        return
    }
    val text = when (call.phase) {
        CallPhase.RINGING -> "Incoming call"
        CallPhase.CONNECTING -> "Calling…"
        CallPhase.HELD -> "On hold"
        CallPhase.ENDED -> "Call ended"
        else -> ""
    }
    if (text.isNotEmpty()) {
        Text(
            text,
            fontSize = 15.sp,
            fontWeight = if (call.phase == CallPhase.HELD) {
                FontWeight.SemiBold
            } else {
                FontWeight.Normal
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

/** A held line to swap to, or a ringing second call (answer holds current). */
@Composable
private fun OtherCallRow(call: CallSnapshot, manager: SoftphoneManager) {
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) manager.answerRinging(call) }

    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(call.peerName, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    when (call.phase) {
                        CallPhase.RINGING -> "Incoming call"
                        CallPhase.HELD -> "On hold"
                        CallPhase.CONNECTING -> "Calling…"
                        else -> ""
                    },
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (call.phase == CallPhase.RINGING) {
                // #171 R1: an in-call second-ring Decline is the universal
                // server signal too (decline-mine + local teardown), not a bare
                // leg hangup that leaves the caller ringing.
                TextButton(onClick = { manager.declineCurrent(call.id) }) {
                    Text(
                        "Decline",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Spacer(Modifier.width(4.dp))
                Surface(
                    onClick = {
                        if (manager.hasMicPermission()) {
                            manager.answerRinging(call)
                        } else {
                            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.tertiary,
                    contentColor = MaterialTheme.colorScheme.onTertiary,
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Outlined.Call,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text("Answer", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            } else if (call.phase == CallPhase.HELD) {
                Surface(
                    onClick = { manager.toggleHold(call.id) },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                ) {
                    Text(
                        "Swap",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 15.dp, vertical = 8.dp),
                    )
                }
            }
        }
    }
}

/** In-call DTMF keypad for IVR navigation — digits send immediately. */
@Composable
private fun DtmfSheet(onDigit: (String) -> Unit, onDismiss: () -> Unit) {
    var sent by remember { mutableStateOf("") }
    val rows = listOf(
        listOf("1" to "", "2" to "ABC", "3" to "DEF"),
        listOf("4" to "GHI", "5" to "JKL", "6" to "MNO"),
        listOf("7" to "PQRS", "8" to "TUV", "9" to "WXYZ"),
        listOf("*" to "", "0" to "+", "#" to ""),
    )
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                sent.ifEmpty { "Keypad" },
                style = MaterialTheme.typography.headlineMedium.copy(fontSize = 26.sp),
                color = if (sent.isEmpty()) {
                    MaterialTheme.colorScheme.outline
                } else {
                    MaterialTheme.colorScheme.onBackground
                },
                maxLines = 1,
                modifier = Modifier.padding(vertical = 12.dp),
            )
            rows.forEach { row ->
                Row(
                    Modifier.padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(22.dp),
                ) {
                    row.forEach { (key, letters) ->
                        KeypadKey(
                            digit = key,
                            letters = letters,
                            size = 64.dp,
                            onClick = {
                                sent += key
                                onDigit(key)
                            },
                        )
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/**
 * Blind-transfer picker (spec 05): eligible teammates with presence dots and
 * honest busy flags. Names come from GET /v1/members (targets are id-only).
 * Decline/timeout recovery is server-side — the customer snaps back to us,
 * never stranded.
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

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            Text(
                "Transfer this call",
                style = MaterialTheme.typography.headlineSmall.copy(fontSize = 21.sp),
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(12.dp))
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

                else -> PaperCard(Modifier.fillMaxWidth()) {
                    rows.forEachIndexed { index, row ->
                        TransferTargetRow(
                            row = row,
                            enabled = !row.busy && !transferring,
                            onTransfer = {
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
                        )
                        if (index < rows.lastIndex) RowDivider()
                    }
                }
            }
            Text(
                "If they decline, the call snaps back to you.",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.outline,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp),
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** One crew row: avatar, presence dot (lime free / muted busy), Transfer pill. */
@Composable
private fun TransferTargetRow(
    row: TransferRow,
    enabled: Boolean,
    onTransfer: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (row.busy) 0.55f else 1f)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        InitialsAvatar(row.name, size = 40.dp)
        Column(Modifier.weight(1f)) {
            Text(row.name, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
            LineStatusRow(
                text = if (row.busy) "On a call" else "Available",
                dot = if (row.busy) {
                    MaterialTheme.colorScheme.outline
                } else {
                    BrandColor.LimeBright
                },
                textColor = if (row.busy) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.secondary
                },
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Surface(
            onClick = onTransfer,
            enabled = enabled,
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.alpha(if (enabled) 1f else 0.5f),
        ) {
            Text(
                "Transfer",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 15.dp, vertical = 8.dp),
            )
        }
    }
}

private data class TransferRow(val userId: String, val name: String, val busy: Boolean)
