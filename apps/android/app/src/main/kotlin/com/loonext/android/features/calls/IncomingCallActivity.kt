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
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.LoonextApp
import com.loonext.android.MainActivity
import com.loonext.android.telephony.CallWakePolicy
import com.loonext.android.telephony.IncomingCallPresentation
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.theme.LoonextTheme

/**
 * The dedicated full-screen incoming-call surface (#171 bugs 3+4). It is the
 * `fullScreenIntent` target of the CallStyle ring — NOT MainActivity's tab
 * shell — and carries `setShowWhenLocked`/`setTurnScreenOn` so answer/decline
 * render over the keyguard, plus `requestDismissKeyguard` on answer so the
 * live-call controls in the app become reachable.
 *
 * It presents immediately from the push's caller fields (bug 2, the WhatsApp
 * model) BEFORE the WebRTC INVITE binds, and reconciles as the real leg
 * arrives behind it. Its lifecycle is tied to the call state
 * ([IncomingCallPresentation.reduce]): it `finish()`es on ANY ringing-exit —
 * answered-elsewhere, ended, declined, timeout.
 */
class IncomingCallActivity : ComponentActivity() {
    companion object {
        private const val EXTRA_SESSION = "session"
        private const val EXTRA_CALL_ID = "call_id"
        private const val EXTRA_COMPANY = "company_id"
        private const val EXTRA_CALLER_NAME = "caller_name"
        private const val EXTRA_CALLER_NUMBER = "caller_number"
        private const val EXTRA_AUTO_ANSWER = "auto_answer"

        /**
         * The session this activity is currently presenting (null when none) —
         * so [com.loonext.android.telephony.CallNotifier] does not stack a
         * second ring notification behind a push-launched activity
         * (one-presentation-per-session-per-device, §10.1.4).
         */
        @Volatile
        private var presentingSession: String? = null

        @Volatile
        private var presenting: Boolean = false

        /** True when this activity is the live presentation for [session]. A
         *  null [session] is treated conservatively (any live presentation
         *  suppresses a would-be duplicate). */
        fun isPresenting(session: String?): Boolean {
            if (!presenting) return false
            if (session == null) return true
            return presentingSession == null || presentingSession == session
        }

        fun intent(
            context: Context,
            session: String?,
            callId: String,
            company: String?,
            callerName: String,
            callerNumber: String,
            autoAnswer: Boolean,
        ): Intent = Intent(context, IncomingCallActivity::class.java)
            .putExtra(EXTRA_SESSION, session)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_COMPANY, company)
            .putExtra(EXTRA_CALLER_NAME, callerName)
            .putExtra(EXTRA_CALLER_NUMBER, callerNumber)
            .putExtra(EXTRA_AUTO_ANSWER, autoAnswer)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showWhenLockedAndTurnScreenOn()

        val session = intent?.getStringExtra(EXTRA_SESSION)?.takeIf { it.isNotBlank() }
        val callIdExtra = intent?.getStringExtra(EXTRA_CALL_ID)
        val company = intent?.getStringExtra(EXTRA_COMPANY)?.takeIf { it.isNotBlank() }
        val callerName = intent?.getStringExtra(EXTRA_CALLER_NAME).orEmpty()
        val callerNumber = intent?.getStringExtra(EXTRA_CALLER_NUMBER).orEmpty()
        val autoAnswer = intent?.getBooleanExtra(EXTRA_AUTO_ANSWER, false) ?: false

        presentingSession = session
        presenting = true

        // Cold-process wake (§10.2): a push-launched activity may be the first
        // thing alive in this process — build the softphone (installs the wake
        // handlers) and register the workspace so the INVITE binds behind us.
        val manager = SoftphoneManager.get(applicationContext, appGraphApi())
        (company ?: manager.currentCompanyId())?.let { runCatching { manager.start(it) } }

        setContent {
            LoonextTheme {
                IncomingCallScreen(
                    manager = manager,
                    session = session,
                    company = company ?: manager.currentCompanyId(),
                    initialCallId = callIdExtra,
                    pushCallerName = callerName,
                    pushCallerNumber = callerNumber,
                    autoAnswer = autoAnswer,
                    onAnswered = { handoffSession -> openInCall(handoffSession) },
                    onFinished = { finish() },
                )
            }
        }
    }

    override fun onDestroy() {
        presenting = false
        presentingSession = null
        super.onDestroy()
    }

    /** Dismiss the keyguard so the app's in-call controls are reachable once
     *  the call is answered (the ring surface itself already shows over lock). */
    fun dismissKeyguard() {
        runCatching {
            val keyguard = getSystemService(KeyguardManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                keyguard?.requestDismissKeyguard(this, null)
            }
        }
    }

    private fun showWhenLockedAndTurnScreenOn() {
        runCatching {
            if (Build.VERSION.SDK_INT >= 27) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
            }
        }
    }

    /** Hand off to the live-call controls in the app (never renders here). The
     *  deep link runs the same wake/reconcile the notification tap would. */
    private fun openInCall(session: String?) {
        runCatching {
            val uri = if (session != null) {
                "https://app.loonext.com/calls?call=$session".toUri()
            } else {
                "https://app.loonext.com/calls".toUri()
            }
            startActivity(
                Intent(Intent.ACTION_VIEW, uri, this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        }
        finish()
    }

    private fun appGraphApi() = (application as LoonextApp).graph.api
}

@Composable
private fun IncomingCallScreen(
    manager: SoftphoneManager,
    session: String?,
    company: String?,
    initialCallId: String?,
    pushCallerName: String,
    pushCallerNumber: String,
    autoAnswer: Boolean,
    onAnswered: (String?) -> Unit,
    onFinished: () -> Unit,
) {
    val snapshot by manager.state.collectAsStateWithLifecycle()
    val activity = androidx.compose.ui.platform.LocalContext.current as? IncomingCallActivity

    // A ringing-exit learned out-of-band (call_end push, call.updated, or the
    // one-shot /state read) — the pre-INVITE finish signal (no local leg yet).
    var sessionExited by remember { mutableStateOf(false) }
    var timedOut by remember { mutableStateOf(false) }
    // `pendingAnswer` fires answer() the moment a leg binds; `answerCommitted`
    // is the durable intent (#171 R3) that survives across the leg arriving and
    // drives the Connecting…/couldn't-connect surface. Committing sets both;
    // firing answer() clears only `pendingAnswer`.
    var pendingAnswer by remember { mutableStateOf(autoAnswer) }
    var answerCommitted by remember { mutableStateOf(autoAnswer) }
    var answerBindTimedOut by remember { mutableStateOf(false) }
    var micNotice by remember { mutableStateOf(false) }

    // Correlate the ring to a local INVITE leg once it binds (during ring a leg
    // carries no resolved session — caller identity is the only proxy).
    val hintCaller = pushCallerNumber.takeIf { it.isNotBlank() } ?: manager.pushHintCaller()
    val matchedCallId = initialCallId?.let { id ->
        snapshot.calls.firstOrNull { it.id == id }?.id
    } ?: IncomingCallPresentation.matchLocalRing(snapshot.calls, hintCaller)

    val matchedCall = matchedCallId?.let { id -> snapshot.calls.firstOrNull { it.id == id } }

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            activity?.dismissKeyguard()
            pendingAnswer = true
            answerCommitted = true
        } else {
            micNotice = true
        }
    }

    // A late push may name a session that already resolved — one-shot /state
    // check finishes us straight away rather than ringing a dead call.
    LaunchedEffect(session, company) {
        if (session != null) {
            val state = manager.sessionStateOrNull(session)?.state
            if (state != null && CallWakePolicy.isRingingExit(state)) sessionExited = true
        }
    }

    // Any ringing-exit for our session (call_end / call.updated / state read).
    LaunchedEffect(session) {
        if (session == null) return@LaunchedEffect
        manager.ringingExitSessions.collect { exited ->
            if (exited == session) sessionExited = true
        }
    }

    // The pre-INVITE ring never rings forever — the server ring window is 45s.
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(IncomingCallPresentation.PRESENT_TIMEOUT_MS)
        timedOut = true
    }

    // Auto-answer the moment the leg binds (Answer tapped pre-INVITE, or the
    // shade Answer routed here for the mic preflight). #171 R3: the intent
    // (`answerCommitted`) persists across the leg arriving; only the one-shot
    // `pendingAnswer` trigger clears once answer() fires.
    LaunchedEffect(matchedCallId, pendingAnswer) {
        if (pendingAnswer && matchedCallId != null) {
            activity?.dismissKeyguard()
            manager.answer(matchedCallId)
            pendingAnswer = false
        }
    }

    // #171 R3: a committed answer that never binds a leg within the bounded
    // window surfaces an honest failure — not a dead Answer button, not 45s of
    // silence. The clock starts when the user commits; a bound leg makes the
    // timeout moot (answerPhase stays CONNECTING and reduce() hands off).
    LaunchedEffect(answerCommitted) {
        if (!answerCommitted) return@LaunchedEffect
        kotlinx.coroutines.delay(IncomingCallPresentation.ANSWER_BIND_TIMEOUT_MS)
        answerBindTimedOut = true
    }

    val answerPhase = IncomingCallPresentation.answerPhase(
        answerCommitted = answerCommitted,
        legBound = matchedCallId != null,
        bindTimedOut = answerBindTimedOut,
    )

    val presentation = IncomingCallPresentation.reduce(
        calls = snapshot.calls,
        matchedCallId = matchedCallId,
        sessionExited = sessionExited,
        timedOut = timedOut,
    )

    LaunchedEffect(presentation, session) {
        when (presentation) {
            IncomingCallPresentation.Presentation.ANSWERED -> onAnswered(session ?: matchedCall?.sessionId)
            IncomingCallPresentation.Presentation.FINISH -> {
                session?.let { CallNotifierBridge.cancelIncoming(activity, it) }
                onFinished()
            }
            IncomingCallPresentation.Presentation.PRESENT -> Unit
        }
    }

    val displayName = (matchedCall?.peerName ?: pushCallerName).ifBlank { "Unknown caller" }
    val number = (matchedCall?.peerNumber ?: pushCallerNumber)
        .takeIf { it.isNotBlank() && formatPhone(it) != displayName }

    // #171 R1: the universal member-scoped decline (works pre-INVITE with no
    // knowable session; also tears down a bound leg). Same routing whether the
    // decline comes from the answer surface or the couldn't-connect surface.
    val declineAndFinish: () -> Unit = {
        manager.declineCurrent(matchedCallId, sessionHint = session)
        session?.let { CallNotifierBridge.cancelIncoming(activity, it) }
        onFinished()
    }

    when (answerPhase) {
        // #171 R3: honest failure instead of a dead Answer button — the commit
        // never bound a leg in the window. The user dismisses (server reaps the
        // orphan leg); they are not left staring at a stuck spinner.
        IncomingCallPresentation.AnswerPhase.FAILED -> ConnectFailedContent(
            displayName = displayName,
            onDismiss = {
                session?.let { CallNotifierBridge.cancelIncoming(activity, it) }
                onFinished()
            },
        )

        // #171 R3: Answer committed, leg binding (or bound and handing off) —
        // 'Connecting…' with the caller identity and a way to bail.
        IncomingCallPresentation.AnswerPhase.CONNECTING -> ConnectingContent(
            displayName = displayName,
            subtitle = number?.let { formatPhone(it) },
            error = snapshot.error,
            onDecline = declineAndFinish,
        )

        IncomingCallPresentation.AnswerPhase.IDLE -> IncomingCallContent(
            displayName = displayName,
            subtitle = number?.let { formatPhone(it) },
            micNotice = micNotice,
            error = snapshot.error,
            onAnswer = {
                micNotice = false
                if (manager.hasMicPermission()) {
                    activity?.dismissKeyguard()
                    pendingAnswer = true
                    answerCommitted = true
                } else {
                    micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            },
            onDecline = declineAndFinish,
        )
    }
}

@Composable
private fun IncomingCallContent(
    displayName: String,
    subtitle: String?,
    micNotice: Boolean,
    error: String?,
    onAnswer: () -> Unit,
    onDecline: () -> Unit,
) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(horizontal = 28.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))
            Text(
                "Incoming call",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(28.dp))
            Box(
                Modifier
                    .size(112.dp)
                    .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.Call,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(48.dp),
                )
            }
            Spacer(Modifier.height(28.dp))
            Text(
                displayName,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (micNotice) {
                Spacer(Modifier.height(16.dp))
                Text(
                    "Allow microphone access to answer this call.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
            }
            if (error != null && !micNotice) {
                Spacer(Modifier.height(16.dp))
                Text(
                    error,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.weight(1f))

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                CallActionButton(
                    label = "Decline",
                    container = MaterialTheme.colorScheme.error,
                    content = Color.White,
                    icon = Icons.Filled.CallEnd,
                    onClick = onDecline,
                )
                CallActionButton(
                    label = "Answer",
                    container = MaterialTheme.colorScheme.primary,
                    content = MaterialTheme.colorScheme.onPrimary,
                    icon = Icons.Filled.Call,
                    onClick = onAnswer,
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * #171 R3: the 'Connecting…' surface shown after the user commits to Answer,
 * while the WebRTC leg binds (a leg that has bound is already handing off to
 * the in-call UI). It replaces the two-button row with a spinner and a status
 * line so the Answer tap is never a dead button; Decline stays available so the
 * user can bail if the connection stalls.
 */
@Composable
private fun ConnectingContent(
    displayName: String,
    subtitle: String?,
    error: String?,
    onDecline: () -> Unit,
) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(horizontal = 28.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))
            Text(
                "Connecting…",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(28.dp))
            CircularProgressIndicator(Modifier.size(56.dp))
            Spacer(Modifier.height(28.dp))
            Text(
                displayName,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Spacer(Modifier.height(8.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (error != null) {
                Spacer(Modifier.height(16.dp))
                Text(
                    error,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.weight(1f))

            CallActionButton(
                label = "Decline",
                container = MaterialTheme.colorScheme.error,
                content = Color.White,
                icon = Icons.Filled.CallEnd,
                onClick = onDecline,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * #171 R3: the honest 'couldn't connect' surface — shown when a committed
 * Answer never bound a leg within [IncomingCallPresentation.ANSWER_BIND_TIMEOUT_MS]
 * (registration/INVITE never landed over the keyguard). Never a dead spinner:
 * the user gets the truth and a Dismiss; the server reaps the orphan leg.
 */
@Composable
private fun ConnectFailedContent(
    displayName: String,
    onDismiss: () -> Unit,
) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(horizontal = 28.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))
            Text(
                "Couldn't connect the call",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.error,
            )
            Spacer(Modifier.height(28.dp))
            Text(
                displayName,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "The call didn't connect in time. It may have gone to voicemail or another teammate.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.weight(1f))

            Button(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                Text("Dismiss")
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun CallActionButton(
    label: String,
    container: Color,
    content: Color,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Button(
            onClick = onClick,
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = container,
                contentColor = content,
            ),
            modifier = Modifier.size(72.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
        ) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(10.dp))
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

/**
 * A tiny bridge so the Compose surface can cancel the ring notification by
 * session without importing the internal [com.loonext.android.telephony.CallNotifier]
 * (which lives in another package). Cancels the `call:<session>` tray entry.
 */
private object CallNotifierBridge {
    fun cancelIncoming(context: Context?, session: String) {
        val ctx = context ?: return
        com.loonext.android.telephony.CallNotifier.cancelIncomingForSession(ctx, session)
    }
}
