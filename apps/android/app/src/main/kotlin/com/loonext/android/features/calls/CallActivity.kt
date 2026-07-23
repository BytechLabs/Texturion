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
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CallEnd
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.LoonextApp
import com.loonext.android.telephony.CallNotifier
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.telephony.SoftphoneStatus
import com.loonext.android.ui.common.rememberHaptics
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
            val themePref by graph.prefs.theme
                .collectAsStateWithLifecycle(initialValue = "system")
            val darkTheme = when (themePref) {
                "light" -> false
                "dark" -> true
                else -> isSystemInDarkTheme()
            }
            LoonextTheme(darkTheme = darkTheme) {
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

    // #195 F4: the honest answer-failure state — the up-to-50s silent
    // "Connecting…" is replaced by the truth when the answered call is reaped.
    var answerFailed by remember { mutableStateOf(false) }
    var answeringAtMs by remember { mutableStateOf(0L) }
    var wentLive by remember { mutableStateOf(false) }

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
        answeringAtMs = System.currentTimeMillis()
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
        if (live != null) wentLive = true
    }

    // #195 F4: the core reported the answered call could not connect (the bind
    // deadline / ring window reaped it) — show the truth, not "Connecting…".
    LaunchedEffect(answering, live, snapshot.error) {
        if (answering && live == null && !wentLive &&
            snapshot.error == SoftphoneManager.ANSWER_FAILED_MESSAGE
        ) {
            answerFailed = true
        }
    }

    // #195 F4: the no-materialize backstop — an answer that produced neither a
    // live call nor an explicit failure within 15s IS a failure.
    LaunchedEffect(answering) {
        if (answering) {
            kotlinx.coroutines.delay(15_000)
            if (!wentLive &&
                manager.state.value.liveCalls.none { it.phase != CallPhase.RINGING }
            ) {
                answerFailed = true
            }
        }
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
                if (target != null && gone != target) return
                val noLive =
                    manager.state.value.liveCalls.none { it.phase != CallPhase.RINGING }
                if (!answering && noLive) {
                    onClose()
                } else if (answering && noLive && !wentLive &&
                    System.currentTimeMillis() - answeringAtMs > 2_000
                ) {
                    // #195 F4: the ring was torn down AFTER the user answered and
                    // nothing went live — that is a failed answer; say so. (The 2s
                    // guard skips the cancel our own answer tap fires.)
                    answerFailed = true
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
    Surface(modifier = Modifier.fillMaxSize(), color = callScreenColor()) {
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

            // #195 F4: the answered call never connected — the honest terminal
            // state (auto-closes shortly; the error is cleared so it does not
            // linger on other surfaces).
            answerFailed && live == null -> {
                LaunchedEffect(Unit) {
                    kotlinx.coroutines.delay(3_000)
                    manager.clearError()
                    onClose()
                }
                CallStatus(
                    title = callerName.ifBlank { callerNumber },
                    status = SoftphoneManager.ANSWER_FAILED_MESSAGE,
                    actionLabel = "Close",
                    onAction = {
                        manager.clearError()
                        onClose()
                    },
                )
            }

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
                // #195 F7: honest ring surface — the line is not READY, so an
                // answer may take a beat (or fail); say so quietly.
                reconnecting = snapshot.status != SoftphoneStatus.READY,
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

/** The ring screen (spec 04): halo avatar, Bricolage name, brick/lime discs. */
@Composable
private fun RingingSurface(
    title: String,
    subtitle: String,
    onAnswer: () -> Unit,
    onDecline: () -> Unit,
    reconnecting: Boolean = false,
) {
    val haptics = rememberHaptics()
    val display = title.ifBlank { "Unknown caller" }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(start = 22.dp, end = 22.dp, top = 14.dp, bottom = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.7f),
        ) {
            Text(
                "Incoming call",
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
        Spacer(Modifier.height(24.dp))
        CallerAvatar(display, size = 112.dp, ringing = true)
        Text(
            display,
            style = MaterialTheme.typography.headlineSmall.copy(fontSize = 27.sp),
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 14.dp),
        )
        if (subtitle.isNotBlank() && subtitle != title) {
            Text(
                subtitle,
                fontSize = 12.5.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 5.dp),
            )
        }
        if (reconnecting) {
            // #195 F7: quiet honesty while the socket is not READY.
            Text(
                "Reconnecting your line…",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        Spacer(Modifier.weight(1f))
        Row(
            modifier = Modifier
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
                size = 72.dp,
                onClick = {
                    haptics.reject()
                    onDecline()
                },
            )
            RingActionCircle(
                icon = Icons.Outlined.Call,
                label = "Answer",
                container = MaterialTheme.colorScheme.tertiary,
                content = MaterialTheme.colorScheme.onTertiary,
                labelColor = MaterialTheme.colorScheme.onBackground,
                labelWeight = FontWeight.Bold,
                size = 72.dp,
                onClick = {
                    haptics.confirm()
                    onAnswer()
                },
            )
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
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CallerAvatar(title.ifBlank { "Call" }, size = 96.dp)
            Text(
                text = title.ifBlank { "Call" },
                style = MaterialTheme.typography.headlineSmall.copy(fontSize = 26.sp),
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
            Text(
                text = status,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
            if (actionLabel != null) {
                val haptics = rememberHaptics()
                Spacer(Modifier.height(32.dp))
                EndCallPill(
                    onClick = {
                        haptics.reject()
                        onAction()
                    },
                    label = actionLabel,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
