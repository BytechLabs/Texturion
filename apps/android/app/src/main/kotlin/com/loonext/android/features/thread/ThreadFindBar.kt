package com.loonext.android.features.thread

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.SearchField
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable

@Serializable
internal data class ThreadFindMatch(val id: String)

@Serializable
internal data class ThreadFindResults(val data: List<ThreadFindMatch>, val truncated: Boolean)

@Composable
internal fun ThreadFindBar(
    initialQuery: String,
    initialMessage: String?,
    find: suspend (String) -> ThreadFindResults,
    onJump: (String) -> Unit,
    onClose: () -> Unit,
) {
    var input by remember { mutableStateOf(initialQuery) }
    val query = input.trim()
    var result by remember(query) { mutableStateOf<ThreadFindResults?>(null) }
    var failed by remember(query) { mutableStateOf(false) }
    var selected by remember { mutableStateOf(initialMessage) }

    LaunchedEffect(query) {
        if (query.isEmpty()) return@LaunchedEffect
        delay(250)
        try {
            result = find(query)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }

    val matches = result?.data.orEmpty()
    val index = matches.indexOfFirst { it.id == selected }
    val count = matches.size.toString() + if (result?.truncated == true) "+" else ""
    val status = when {
        query.isEmpty() -> ""
        failed -> t("thread.findError")
        result == null -> t("thread.findSearching")
        index < 0 -> t("thread.findMatches", "count" to count)
        else -> t("thread.findPosition", "position" to (index + 1).toString(), "count" to count)
    }
    fun step(offset: Int) {
        if (matches.isEmpty()) return
        val current = if (index < 0 && offset < 0) 0 else index
        val match = matches[(current + offset + matches.size) % matches.size]
        selected = match.id
        onJump(match.id)
    }

    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SearchField(
            value = input,
            onValueChange = {
                input = it
                selected = null
            },
            placeholder = t("thread.findInThread"),
            modifier = Modifier.weight(1f),
        )
        if (status.isNotEmpty()) {
            Text(status, Modifier.padding(start = 4.dp), style = MaterialTheme.typography.labelSmall)
        }
        IconButton(onClick = { step(-1) }, enabled = matches.isNotEmpty()) {
            Icon(Icons.Outlined.KeyboardArrowUp, contentDescription = t("thread.findPrevious"))
        }
        IconButton(onClick = { step(1) }, enabled = matches.isNotEmpty()) {
            Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = t("thread.findNext"))
        }
        IconButton(onClick = onClose) {
            Icon(Icons.Outlined.Close, contentDescription = t("thread.findClose"))
        }
    }
}
