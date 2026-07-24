package com.loonext.android.ui.common

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect

/**
 * How long the app must have been away before a return is worth a resync. A
 * glance away — a permission dialog, the notification shade, a two-second app
 * switch — cannot have missed a frame the socket was connected to receive, so
 * resyncing then is pure request cost on every live screen at once.
 */
private const val RESYNC_MIN_AWAY_MS = 30_000L

/**
 * #215 resync-on-foreground safety net. Every live surface subscribes to the
 * realtime broadcast fire-and-forget and refetches only on a realtime event or
 * a socket re-JOIN; a single frame missed while the app was backgrounded or
 * blurred is otherwise lost until the next re-JOIN or a manual navigation.
 * Wiring this to a screen's existing reconnect refresh lets it self-heal the
 * moment it returns to the foreground — the mobile mirror of the web client's
 * visibilitychange/focus → invalidate-active-queries resync.
 *
 * The FIRST resume is deliberately skipped: [LifecycleEventEffect] replays
 * ON_RESUME to a freshly added observer when the owner is already resumed, so
 * the first fire coincides with the screen's own initial composition — when it
 * has just loaded fresh data. Refetching again there would be a redundant
 * round-trip on every open, and for the thread (whose [onResync] trims to page
 * one) it would drop restored scrollback on open. Only genuine returns to the
 * foreground call [onResync].
 *
 * @param key resets the "initial resume seen" latch when it changes. Pass the
 *   screen's identity (controller, companyId, conversationId, taskId, …) so a
 *   re-keyed screen treats its next resume as the initial one again.
 */
@Composable
fun ResyncOnResume(key: Any? = Unit, onResync: () -> Unit) {
    val latest by rememberUpdatedState(onResync)
    var sawInitialResume by remember(key) { mutableStateOf(false) }
    // Wall-clock of the moment we left the foreground (0 = not away). Only a
    // genuine absence earns a resync — see RESYNC_MIN_AWAY_MS.
    var awaySince by remember(key) { mutableLongStateOf(0L) }
    LifecycleEventEffect(Lifecycle.Event.ON_PAUSE) {
        if (awaySince == 0L) awaySince = SystemClock.elapsedRealtime()
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        val awayFor =
            if (awaySince == 0L) 0L else SystemClock.elapsedRealtime() - awaySince
        awaySince = 0L
        if (!sawInitialResume) {
            sawInitialResume = true
        } else if (awayFor >= RESYNC_MIN_AWAY_MS) {
            latest()
        }
    }
}
