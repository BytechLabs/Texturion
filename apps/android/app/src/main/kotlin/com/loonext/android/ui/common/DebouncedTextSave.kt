package com.loonext.android.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal class DebouncedTextSave(
    private val scope: CoroutineScope,
    initial: String,
    private val save: suspend (String) -> Boolean,
) {
    private var saved = initial.trim()
    private var pending: String? = null
    private var timer: Job? = null
    private var saving = false

    fun schedule(value: String) {
        pending = value.trim()
        timer?.cancel()
        timer = scope.launch {
            delay(800)
            flush()
        }
    }

    fun flush() {
        timer?.cancel()
        timer = null
        if (saving) return
        val value = pending ?: return
        pending = null
        if (value == saved) return

        saving = true
        scope.launch {
            try {
                if (withContext(NonCancellable) { save(value) }) saved = value
            } finally {
                saving = false
                if (timer == null) flush()
            }
        }
    }

    fun acceptServerValue(value: String): Boolean {
        if (saving || pending != null) return false
        saved = value.trim()
        return true
    }
}

@Composable
internal fun rememberDebouncedTextSave(
    fieldKey: String,
    appScope: CoroutineScope,
    initial: String,
    save: suspend (String) -> Boolean,
): DebouncedTextSave = key(fieldKey, appScope) {
    val currentSave = rememberUpdatedState(save)
    val autosave = remember {
        val scope = CoroutineScope(appScope.coroutineContext + Dispatchers.Main.immediate)
        DebouncedTextSave(scope, initial) { currentSave.value(it) }
    }
    DisposableEffect(autosave) {
        onDispose { autosave.flush() }
    }
    autosave
}
