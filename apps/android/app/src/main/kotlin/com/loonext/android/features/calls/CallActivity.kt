package com.loonext.android.features.calls

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.LoonextApp
import com.loonext.android.telephony.CallNotifier
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.theme.LoonextTheme

/**
 * THE call surface (#171). One screen for the whole call, so there is exactly one
 * visual language instead of the several the founder hit:
 *
 *  - RINGING  → caller + Answer / Decline, over the keyguard.
 *  - IN CALL  → the app's real [InCallScreen] (mute / speaker / hold / transfer /
 *               keypad / notes), the SAME one the in-app overlay shows.
 *
 * It is the single target for every entry point: the ring notification's
 * `fullScreenIntent`, the ring notification's ANSWER action, and a tap on the
 * ongoing-call notification. Answering ALWAYS lands here — previously a
 * notification/lock-screen answer accepted the call silently in the background
 * with no UI at all, and you had to hunt for the ongoing notification.
 *
 * It also PREFLIGHTS the microphone. A `BroadcastReceiver` cannot request a
 * runtime permission, so the old notification-answer path could accept a call
 * with no mic — the caller heard nothing. Here the answer is gated on
 * RECORD_AUDIO and asks for it first.
 */
class CallActivity : ComponentActivity() {

    companion object {
        private const val EXTRA_SESSION = "session"
        private const val EXTRA_CALLER_NAME = "caller_name"
        private const val EXTRA_CALLER_NUMBER = "caller_number"
        private const val EXTRA_ANSWER = "answer"

        fun intent(
            context: Context,
            session: String?,
            callerName: String = "",
            callerNumber: String = "",
            answer: Boolean = false,
        ): Intent = Intent(context, CallActivity::class.java).apply {
            putExtra(EXTRA_SESSION, session)
            putExtra(EXTRA_CALLER_NAME, callerName)
            putExtra(EXTRA_CALLER_NUMBER, callerNumber)
            putExtra(EXTRA_ANSWER, answer)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverKeyguard()
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        render()
    }

    private fun showOverKeyguard() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
    }

    /** A locked answer needs device verification before the in-call UI is usable. */
    private fun dismissKeyguard() {
        runCatching {
            (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
                ?.requestDismissKeyguard(this, null)
        }
    }

    private fun render() {
        val session = intent.getStringExtra(EXTRA_SESSION)
        val callerName = intent.getStringExtra(EXTRA_CALLER_NAME).orEmpty()
        val callerNumber = intent.getStringExtra(EXTRA_CALLER_NUMBER).orEmpty()
        val answerOnOpen = intent.getBooleanExtra(EXTRA_ANSWER, false)
        val app = applicationContext as? LoonextApp
        val graph = runCatching { app?.graph }.getOrNull()
        if (graph == null) { finish(); return }
        val manager = runCatching { SoftphoneManager.get(applicationContext, graph.api) }
            .getOrNull() ?: run { finish(); return }

        setContent {
            LoonextTheme {
                CallSurface(
                    manager = manager,
                    repo = remember { CallsRepository(graph.api) },
                    session = session,
                    callerName = callerName,
                    callerNumber = callerNumber,
                    answerOnOpen = answerOnOpen,
                    onDismissKeyguard = ::dismissKeyguard,
                    onClose = { finish() },
                )
            }
        }
    }
}

@Composable
private fun CallSurface(
    manager: SoftphoneManager,
    repo: CallsRepository,
    session: String?,
    callerName: String,
    callerNumber: String,
    answerOnOpen: Boolean,
    onDismissKeyguard: () -> Unit,
    onClose: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val snapshot by manager.state.collectAsStateWithLifecycle()
    var answering by remember { mutableStateOf(false) }
    var everSeen by remember { mutableStateOf(false) }

    val ringing = snapshot.calls.firstOrNull {
        it.phase == CallPhase.RINGING && (session == null || it.sessionId == session || it.id == session)
    }
    val live = snapshot.liveCalls.firstOrNull { it.phase != CallPhase.RINGING }

    // The session we ACT on. The extra can be absent (the ongoing/foreground
    // notification opens this screen with none), in which case Answer/Decline
    // would have been silent no-ops — resolve from the call actually on screen.
    val target = session ?: ringing?.sessionId ?: ringing?.id

    fun answerNow() {
        answering = true
        onDismissKeyguard()
        target?.let { manager.answerIncoming(it) }
        runCatching { target?.let { CallNotifier.cancelIncomingForSession(context, it) } }
    }

    fun declineNow() {
        target?.let { manager.declineIncoming(it) }
        runCatching { target?.let { CallNotifier.cancelIncomingForSession(context, it) } }
        onClose()
    }

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) answerNow() else declineNow() // no mic = silence for the caller
    }

    fun answerWithMic() {
        // Dismiss the keyguard FIRST: the system permission dialog is not
        // showWhenLocked, so on a locked device requesting it behind the keyguard
        // shows nothing and the answer stalls silently.
        onDismissKeyguard()
        val granted = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) answerNow() else micLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    // Answer immediately when we were opened BY the notification's Answer action.
    LaunchedEffect(answerOnOpen) {
        if (answerOnOpen && !answering) answerWithMic()
    }

    // A push-woken ring reaches this screen BEFORE the leg binds, so the snapshot
    // is empty for a while. Only treat "no call" as teardown once we have actually
    // seen one, or the screen would close ~immediately on every push ring/answer.
    LaunchedEffect(ringing, live) {
        if (ringing != null || live != null) everSeen = true
    }

    LaunchedEffect(everSeen, ringing, live) {
        if (everSeen && ringing == null && live == null) {
            kotlinx.coroutines.delay(700)
            if (manager.state.value.calls.none { it.phase != CallPhase.ENDED }) onClose()
        }
    }

    // Nothing ever materialised (leg never bound, ring window elapsed) — don't
    // strand a dead screen over the keyguard forever.
    LaunchedEffect(everSeen) {
        if (!everSeen) {
            kotlinx.coroutines.delay(50_000)
            if (!everSeen && manager.state.value.calls.none { it.phase != CallPhase.ENDED }) onClose()
        }
    }

    // Deterministic teardown: the ring was cancelled for this session by ANY path.
    // Only closes when it did not turn into a live call (cancel also fires on answer).
    DisposableEffect(target) {
        val receiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                val gone = i.getStringExtra(CallNotifier.EXTRA_SESSION)
                if ((target == null || gone == target) && !answering &&
                    manager.state.value.liveCalls.none { it.phase != CallPhase.RINGING }
                ) {
                    onClose()
                }
            }
        }
        val filter = android.content.IntentFilter(CallNotifier.ACTION_INCOMING_GONE)
        runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(receiver, filter)
            }
        }
        onDispose { runCatching { context.unregisterReceiver(receiver) } }
    }

    val companyId = manager.currentCompanyId()
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        when {
            // Only hand over to InCallScreen once a live call EXISTS — it closes
            // itself when liveCalls is empty, which would kill this screen mid-answer.
            live != null && companyId != null -> InCallScreen(
                manager = manager,
                repo = repo,
                companyId = companyId,
                openConversation = { /* notes deep-link belongs to the shell */ },
                onClose = onClose,
            )

            // Answered (or live but no companyId yet): a status surface that always
            // offers a way OUT, so a cold answer is never a controls-free dead end.
            live != null || answering -> CallStatus(
                title = (live?.peerName ?: callerName).ifBlank { callerNumber },
                status = if (live != null) "Connected" else "Connecting…",
                actionLabel = "Hang up",
                onAction = {
                    val id = live?.id
                    if (id != null) manager.hangup(id) else target?.let { manager.declineIncoming(it) }
                    onClose()
                },
            )

            ringing != null || target != null -> RingingSurface(
                title = (ringing?.peerName ?: callerName).ifBlank { callerNumber },
                subtitle = (ringing?.peerNumber ?: callerNumber),
                onAnswer = { answerWithMic() },
                onDecline = { declineNow() },
            )

            else -> CallStatus(
                title = callerName.ifBlank { callerNumber },
                status = "Connecting…",
                actionLabel = null,
                onAction = {},
            )
        }
    }
}

@Composable
private fun RingingSurface(
    title: String,
    subtitle: String,
    onAnswer: () -> Unit,
    onDecline: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = 72.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "Incoming call",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = title.ifBlank { "Unknown caller" },
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
            )
            if (subtitle.isNotBlank() && subtitle != title) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 48.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            Button(
                onClick = onDecline,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                ),
                modifier = Modifier.height(64.dp),
            ) { Text("Decline", style = MaterialTheme.typography.titleMedium) }
            Button(
                onClick = onAnswer,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                modifier = Modifier.height(64.dp),
            ) { Text("Answer", style = MaterialTheme.typography.titleMedium) }
        }
    }
}

@Composable
private fun CallStatus(
    title: String,
    status: String,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = title.ifBlank { "Call" },
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = status,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (actionLabel != null) {
                Spacer(Modifier.height(32.dp))
                Button(
                    onClick = onAction,
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    ),
                    modifier = Modifier.height(56.dp),
                ) { Text(actionLabel, style = MaterialTheme.typography.titleMedium) }
            }
        }
    }
}
