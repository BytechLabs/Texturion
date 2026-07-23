package com.loonext.android.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.loonext.android.core.data.StoreCache

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
 */
@Composable
fun <T : Any> rememberCacheFirst(
    cache: StoreCache,
    key: String,
    refreshKey: Int = 0,
    fetch: suspend () -> T,
): LoadState<T> {
    val flow = remember(key) { cache.flowOf<T>(key) }
    val cached by flow.collectAsState()
    var firstError by remember(key) { mutableStateOf<String?>(null) }
    LaunchedEffect(key, refreshKey) {
        try {
            flow.value = fetch()
            firstError = null
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
