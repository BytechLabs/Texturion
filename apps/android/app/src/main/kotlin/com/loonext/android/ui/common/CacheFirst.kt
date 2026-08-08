package com.loonext.android.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.loonext.android.core.data.StoreCache
import kotlin.coroutines.cancellation.CancellationException

/**
 * Cache-first screen state (#176): the ONLY way a screen may load data.
 *
 * Returns the familiar [LoadState], but Loading can only ever occur on the
 * true first fetch of [key] in this process. Once a value exists, callers
 * always get [LoadState.Ready] — a new visit renders the cached value in the
 * same frame while [fetch] revalidates in the background, and a background
 * miss keeps the stale value instead of flashing an error over data.
 *
 * Bump [refreshKey] (realtime tick, pull-to-refresh, mutation) to revalidate;
 * the refresh is always silent when data is on screen.
 *
 * [enabled] holds the read back without moving it out of the composition. Two
 * kinds of caller need that: one whose endpoint is behind a capability this
 * member does not hold, where firing anyway means a 403 on every visit; and one
 * whose data is only wanted after a press, where firing anyway means a request
 * per screen load that nobody asked for (#288 is both). A disabled read reports
 * [LoadState.Loading] and never fetches — the honest state for "we have not
 * asked" — and flipping [enabled] true starts the fetch, because it is one of
 * the effect's keys.
 */
@Composable
fun <T : Any> rememberCacheFirst(
    cache: StoreCache,
    key: String,
    refreshKey: Int = 0,
    enabled: Boolean = true,
    fetch: suspend () -> T,
): LoadState<T> {
    val flow = remember(key) { cache.flowOf<T>(key) }
    val cached by flow.collectAsState()
    var firstError by remember(key) { mutableStateOf<String?>(null) }
    LaunchedEffect(key, refreshKey, enabled) {
        if (!enabled) return@LaunchedEffect
        try {
            flow.value = fetch()
            firstError = null
        } catch (cause: CancellationException) {
            // On the JVM CancellationException IS an Exception, so the generic
            // handler below used to swallow it and paint a load FAILURE. This
            // effect is re-keyed on every refreshKey bump (realtime tick,
            // pull-to-refresh, navigation), so a broadcast arriving during the
            // FIRST load — the one case `flow.value == null` does not guard —
            // replaced the skeleton with a full-screen "Something went wrong."
            // even though the replacement fetch was already on its way.
            throw cause
        } catch (cause: Exception) {
            if (flow.value == null) firstError = cause.userMessage()
        }
    }
    val value = cached
    return when {
        value != null -> LoadState.Ready(value)
        firstError != null -> LoadState.Failed(firstError!!)
        else -> LoadState.Loading
    }
}
