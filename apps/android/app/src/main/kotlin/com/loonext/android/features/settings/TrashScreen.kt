package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.TrashRepository
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.TrashItem
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.ui.common.ConfirmDialog
import com.loonext.android.ui.common.EmptyState
import com.loonext.android.ui.common.IconSize
import com.loonext.android.ui.common.LoadError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * #735: the Trash, natively. Everything deleted in the last 30 days, with the
 * two things a person can do to it, the same as web's `trash-list.tsx`.
 *
 * Restore is one tap and is the safe direction; it reports "Restored", or the
 * server's own sentence when it refuses (a message whose conversation is still
 * in the Trash). Delete forever is the quiet opposite, and asks first through
 * [ConfirmDialog] because nothing can bring it back.
 * *Applying: Ethical Friction, Loss Aversion.*
 *
 * The hosting route draws the title and the back button, so this draws neither.
 * Reached from the You sheet's Trash row and from every "View Trash" notice;
 * both are for roles with `records.delete`, which the API enforces as well.
 */
@Composable
fun TrashScreen(
    graph: AppGraph,
    companyId: String,
    meUserId: String,
    modifier: Modifier = Modifier,
) {
    val repo = remember(graph) { TrashRepository(graph.api) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val locale = LocalAppLocale.current
    val say: Say = { key, vars -> AppStrings.translate(locale, key, vars) }

    val key = CacheKeys.trash(companyId)
    val feedFlow = remember(key) { graph.storeCache.flowOf<Page<TrashItem>>(key) }
    val feed by feedFlow.collectAsState()
    var refreshKey by remember(companyId) { mutableStateOf(0) }
    val state = rememberCacheFirst(graph.storeCache, key, refreshKey) { repo.list(companyId) }

    var busy by remember(companyId) { mutableStateOf<String?>(null) }
    var loadingMore by remember(companyId) { mutableStateOf(false) }
    var purging by remember(companyId) { mutableStateOf<TrashItem?>(null) }
    var purgeError by remember(companyId) { mutableStateOf<String?>(null) }

    fun drop(item: TrashItem) {
        feedFlow.value = feedFlow.value?.let { page ->
            page.copy(data = page.data.filterNot { trashKey(it) == trashKey(item) })
        }
    }

    fun restore(item: TrashItem) {
        busy = trashKey(item)
        scope.launch {
            val message = try {
                repo.restore(companyId, item)
                drop(item)
                say("trash.restored", emptyMap())
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                // The server wrote a 409's sentence ("Restore the conversation
                // first"), so the reader gets it, as on web.
                cause.userMessage(locale)
            }
            busy = null
            snackbar.showSnackbar(message)
        }
    }

    fun purge(item: TrashItem) {
        busy = trashKey(item)
        purgeError = null
        scope.launch {
            try {
                repo.purge(companyId, item)
                drop(item)
                purging = null
                busy = null
                snackbar.showSnackbar(say("trash.deletedForever", emptyMap()))
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                busy = null
                purgeError = cause.userMessage(locale)
            }
        }
    }

    fun loadMore(cursor: String) {
        loadingMore = true
        scope.launch {
            try {
                val next = repo.list(companyId, cursor)
                feedFlow.value = feedFlow.value?.let { page ->
                    val have = page.data.map(::trashKey).toSet()
                    Page(
                        data = page.data + next.data.filterNot { trashKey(it) in have },
                        next_cursor = next.next_cursor,
                    )
                }
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                snackbar.showSnackbar(cause.userMessage(locale))
            }
            loadingMore = false
        }
    }

    Box(modifier.fillMaxSize()) {
        when (state) {
            LoadState.Loading -> SkeletonList(
                modifier = Modifier.padding(top = 8.dp),
                rows = 4,
                avatar = false,
            )

            is LoadState.Failed -> LoadError(
                message = say("trash.loadFailed", emptyMap()),
                onRetry = { refreshKey++ },
            )

            is LoadState.Ready -> {
                val page = feed ?: state.value
                if (page.data.isEmpty()) {
                    EmptyState(
                        title = t("trash.emptyTitle"),
                        description = t("trash.emptyBody"),
                        icon = Icons.Outlined.Delete,
                    )
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        item(key = "intro") {
                            Text(
                                t("trash.description"),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp),
                            )
                        }
                        items(page.data, key = ::trashKey) { item ->
                            TrashRow(
                                item = item,
                                meUserId = meUserId,
                                busy = busy == trashKey(item),
                                locked = busy != null,
                                onRestore = { restore(item) },
                                onPurge = {
                                    purgeError = null
                                    purging = item
                                },
                            )
                        }
                        page.next_cursor?.let { cursor ->
                            item(key = "more") {
                                TextButton(
                                    onClick = { loadMore(cursor) },
                                    enabled = !loadingMore,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(if (loadingMore) t("trash.loadingMore") else t("trash.loadMore"))
                                }
                            }
                        }
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    purging?.let { item ->
        ConfirmDialog(
            title = say("trash.deleteForeverTitle", emptyMap()),
            body = say(
                "trash.deleteForeverBody",
                mapOf("what" to "${trashKindLabel(item, say)} · ${trashWhoLabel(item, say)}"),
            ),
            confirmLabel = say("trash.deleteForeverConfirm", emptyMap()),
            dismissLabel = say("trash.keep", emptyMap()),
            destructive = true,
            pending = busy == trashKey(item),
            error = purgeError,
            onConfirm = { purge(item) },
            onDismiss = { purging = null },
        )
    }
}

/** One deleted item: what it is, who it was, how long is left, and the two actions. */
@Composable
private fun TrashRow(
    item: TrashItem,
    meUserId: String,
    busy: Boolean,
    locked: Boolean,
    onRestore: () -> Unit,
    onPurge: () -> Unit,
) {
    val locale = LocalAppLocale.current
    val say: Say = { key, vars -> AppStrings.translate(locale, key, vars) }
    val deletedAt = TimestampFormat.label(item.deleted_at, TimestampFormat.Style.LONG, locale)
    PaperCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.padding(start = 15.dp, end = 15.dp, top = 13.dp, bottom = 6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row {
                Text(
                    trashWhoLabel(item, say),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f, fill = false),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    " · ${trashKindLabel(item, say)}",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            Text(
                trashDetailLabel(item, say),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${trashDeletedLine(item, meUserId, deletedAt, say)} · " +
                    trashDaysLeftLabel(item.purge_after, say),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(onClick = onRestore, enabled = !locked) {
                    Icon(Icons.AutoMirrored.Outlined.Undo, null, Modifier.size(IconSize.Default))
                    Text(
                        if (busy) say("trash.restoring", emptyMap()) else say("trash.restore", emptyMap()),
                        Modifier.padding(start = 6.dp),
                    )
                }
                TextButton(onClick = onPurge, enabled = !locked) {
                    Text(say("trash.deleteForever", emptyMap()), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
