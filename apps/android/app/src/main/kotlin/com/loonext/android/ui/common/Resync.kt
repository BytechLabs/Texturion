package com.loonext.android.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect

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
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (sawInitialResume) latest() else sawInitialResume = true
    }
}
