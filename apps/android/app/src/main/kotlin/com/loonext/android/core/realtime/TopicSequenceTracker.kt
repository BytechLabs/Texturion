package com.loonext.android.core.realtime

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.TreeSet

/**
 * Every broadcast carries `seq`, a gapless per-topic counter (D151). A hole in
 * it means a delivery was lost on a healthy socket, and [onGap] runs the same
 * resync a reconnect runs.
 *
 * Two seconds of patience, because Realtime can reorder frames: at the hosted
 * ceiling's edge the slowest emit-to-socket time was 1.4 s (CAPACITY.md 2e), so
 * a frame that is only late still lands inside the window and costs nothing.
 */
internal const val REORDER_WINDOW_MS = 2_000L

internal class TopicSequenceTracker(
    private val scope: CoroutineScope,
    private val windowMs: Long = REORDER_WINDOW_MS,
    private val onGap: (topic: String) -> Unit,
) {
    private class State {
        /** Highest sequence applied in order, or null before the first event. */
        var last: Long? = null

        /** Sequences seen beyond a hole, waiting for the hole to fill. */
        val ahead = TreeSet<Long>()
        var timer: Job? = null
    }

    private val topics = HashMap<String, State>()

    /** Feed the `seq` of one received broadcast; null (no sequence) is ignored. */
    @Synchronized
    fun observe(topic: String, seq: Long?) {
        if (seq == null) return
        val state = topics.getOrPut(topic) { State() }
        val last = state.last
        if (last == null) {
            state.last = seq
            return
        }
        if (seq <= last || seq in state.ahead) return

        state.ahead.add(seq)
        var next = last
        while (state.ahead.remove(next + 1)) next += 1
        state.last = next

        if (state.ahead.isEmpty()) {
            state.timer?.cancel()
            state.timer = null
            return
        }
        if (state.timer != null) return
        state.timer = scope.launch {
            delay(windowMs)
            expire(topic, state)
        }
    }

    @Synchronized
    private fun expire(topic: String, state: State) {
        // A reset in the meantime replaced or removed this state.
        if (topics[topic] !== state) return
        state.timer = null
        if (state.ahead.isEmpty()) return
        // The resync reads everything, so what was skipped no longer matters.
        state.last = state.ahead.last()
        state.ahead.clear()
        onGap(topic)
    }

    /** Forget a topic's baseline; the next event only sets it. */
    @Synchronized
    fun reset(topic: String) {
        topics.remove(topic)?.timer?.cancel()
    }

    @Synchronized
    fun resetAll() {
        for (state in topics.values) state.timer?.cancel()
        topics.clear()
    }
}
