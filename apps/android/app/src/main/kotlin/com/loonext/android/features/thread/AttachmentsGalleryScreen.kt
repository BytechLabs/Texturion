package com.loonext.android.features.thread

import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import coil3.compose.AsyncImage
import com.loonext.android.core.i18n.t
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.GalleryItem
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * "Photos & files" (#165): the conversation gallery over
 * GET /v1/conversations/:id/attachments — MMS photos + note/task files in one
 * newest-first stream, split by an Images | Files toggle. Cache-first (#176):
 * a revisit paints the last snapshot instantly while page 1 revalidates
 * silently — that refetch is also the per-view signed-URL mint (item URLs are
 * short-lived, so fresh head rows replace stale ones as they land). Files open
 * externally via ACTION_VIEW.
 */
@Composable
internal fun AttachmentsGalleryScreen(
    repo: MessagingRepository,
    cache: StoreCache,
    companyId: String,
    conversationId: String,
    contactName: String,
    onBack: () -> Unit,
    onNotice: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    BackHandler(onBack = onBack)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // Read in composition, used from a plain function and a coroutine below —
    // neither of which is a place a @Composable lookup can go.
    val noAppForFile = t("thread.noAppForFile")
    val reportFailed = t("thread.reportFileFailed")

    var view by remember { mutableStateOf(GalleryView.Images) }
    var loadingMore by remember(conversationId) { mutableStateOf(false) }
    var refreshKey by remember(conversationId) { mutableIntStateOf(0) }
    // #317: the file the crew member is about to report, and whether the call
    // is in flight. Null means no dialog.
    var reporting by remember(conversationId) { mutableStateOf<GalleryItem?>(null) }
    var reportInFlight by remember(conversationId) { mutableStateOf(false) }

    val cacheKey = CacheKeys.gallery(companyId, conversationId)
    val state = rememberCacheFirst(
        cache = cache,
        key = cacheKey,
        refreshKey = refreshKey,
    ) {
        // Fresh page 1, keeping any older pages the user had already loaded so
        // scroll-back survives the return trip (and their resume cursor too).
        val page = repo.gallery(companyId, conversationId)
        val freshIds = page.data.mapTo(HashSet()) { it.id }
        val prior = cache.flowOf<GallerySnapshot>(cacheKey).value
        val older = prior?.items?.filter { it.id !in freshIds }.orEmpty()
        GallerySnapshot(
            items = page.data + older,
            nextCursor = if (older.isEmpty() || prior == null) page.next_cursor
            else prior.nextCursor,
        )
    }

    fun loadMore() {
        val current = (state as? LoadState.Ready)?.value ?: return
        val cursor = current.nextCursor ?: return
        if (loadingMore) return
        loadingMore = true
        scope.launch {
            try {
                val page = repo.gallery(companyId, conversationId, cursor)
                val latest = cache.flowOf<GallerySnapshot>(cacheKey).value ?: current
                val seen = latest.items.mapTo(HashSet()) { it.id }
                cache.put(
                    cacheKey,
                    GallerySnapshot(
                        items = latest.items + page.data.filter { it.id !in seen },
                        nextCursor = page.next_cursor,
                    ),
                )
            } catch (cause: Exception) {
                onNotice(cause.userMessage())
            } finally {
                loadingMore = false
            }
        }
    }

    fun openExternally(item: GalleryItem) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, item.url.toUri()))
        } catch (_: Exception) {
            onNotice(noAppForFile)
        }
    }

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = t("thread.backToConversation"),
                )
            }
            Column(Modifier.weight(1f)) {
                Text(
                    t("thread.photosAndFiles"),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    contactName,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
        ) {
            GalleryView.entries.forEachIndexed { index, item ->
                SegmentedButton(
                    selected = view == item,
                    onClick = { view = item },
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = GalleryView.entries.size,
                    ),
                ) { Text(t(item.labelKey)) }
            }
        }

        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                val nextCursor = current.value.nextCursor
                val rows = galleryItemsFor(view, current.value.items)
                if (rows.isEmpty()) {
                    // Honest empty state; with older pages unloaded the copy
                    // says "yet loaded" and offers the next page.
                    Column(
                        Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            when {
                                view == GalleryView.Images && nextCursor != null ->
                                    t("thread.noPhotosLoaded")

                                view == GalleryView.Images ->
                                    t("thread.noPhotosYet")

                                nextCursor != null -> t("thread.noFilesLoaded")
                                else -> t("thread.noFilesYet")
                            },
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 32.dp),
                        )
                        if (nextCursor != null) LoadMoreRow(loadingMore, ::loadMore)
                    }
                } else if (view == GalleryView.Images) {
                    ImagesGrid(
                        items = rows,
                        nextCursor = nextCursor,
                        loadingMore = loadingMore,
                        onLoadMore = ::loadMore,
                        onOpen = ::openExternally,
                        onReport = { reporting = it },
                    )
                } else {
                    FilesList(
                        items = rows,
                        nextCursor = nextCursor,
                        loadingMore = loadingMore,
                        onLoadMore = ::loadMore,
                        onOpen = ::openExternally,
                        onReport = { reporting = it },
                    )
                }
            }
        }
    }

    // #317 — reporting affects EVERYONE, so it asks first.
    //
    // One beat, not a form. An accidental tap that pulls a customer's photo out
    // of the whole crew's view is worth confirming; anything longer and the
    // person hesitates, and hesitating is how somebody opens the file instead
    // of flagging it.
    reporting?.let { target ->
        AlertDialog(
            onDismissRequest = { reporting = null },
            title = { Text(t("thread.reportFileTitle")) },
            text = {
                Text(
                    t(
                        "thread.reportFileBody",
                        "name" to galleryFileName(target),
                    ),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !reportInFlight,
                    onClick = {
                        reportInFlight = true
                        scope.launch {
                            runCatching { repo.reportAttachment(companyId, target.id) }
                                .onSuccess {
                                    reportInFlight = false
                                    reporting = null
                                    refreshKey++
                                }
                                .onFailure {
                                    reportInFlight = false
                                    reporting = null
                                    Toast.makeText(
                                        context,
                                        reportFailed,
                                        Toast.LENGTH_SHORT,
                                    ).show()
                                }
                        }
                    },
                ) {
                    Text(
                        if (reportInFlight) t("thread.reporting")
                        else t("thread.reportFile"),
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { reporting = null }) { Text(t("common.cancel")) }
            },
        )
    }
}

/** Cached gallery state (#176): accumulated pages + the resume cursor. */
private data class GallerySnapshot(
    val items: List<GalleryItem>,
    val nextCursor: String?,
)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ImagesGrid(
    items: List<GalleryItem>,
    nextCursor: String?,
    loadingMore: Boolean,
    onLoadMore: () -> Unit,
    onOpen: (GalleryItem) -> Unit,
    onReport: (GalleryItem) -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            horizontal = 12.dp,
            vertical = 8.dp,
        ),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(items, key = { it.id }) { item ->
            AsyncImage(
                model = item.url,
                contentDescription = item.file_name ?: t("thread.photo"),
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(8.dp))
                    // #317: a thumbnail has no room for a menu, and long-press
                    // is what a phone user already reaches for on one.
                    .combinedClickable(
                        onClick = { onOpen(item) },
                        onLongClick = { onReport(item) },
                        onLongClickLabel = t("thread.reportPhotoAction"),
                    ),
            )
        }
        if (nextCursor != null) {
            item(key = "load-more", span = { androidx.compose.foundation.lazy.grid.GridItemSpan(3) }) {
                LoadMoreRow(loadingMore, onLoadMore)
            }
        }
    }
}

@Composable
private fun FilesList(
    items: List<GalleryItem>,
    nextCursor: String?,
    loadingMore: Boolean,
    onLoadMore: () -> Unit,
    onOpen: (GalleryItem) -> Unit,
    onReport: (GalleryItem) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize()) {
        items(items, key = { it.id }) { item ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(item) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.InsertDriveFile,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(22.dp),
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        galleryFileName(item),
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        listOfNotNull(
                            gallerySizeLabel(item.size_bytes),
                            relativeTime(item.created_at).takeIf { it.isNotEmpty() },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // #317: the one secondary action this row has, behind the
                // triple dot so the row keeps a single visual job.
                var menuOpen by rememberSaveable(item.id) { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(
                            Icons.Default.MoreVert,
                            contentDescription = t(
                                "thread.fileActions",
                                "name" to galleryFileName(item),
                            ),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(t("thread.reportThisFile")) },
                            onClick = {
                                menuOpen = false
                                onReport(item)
                            },
                        )
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
        if (nextCursor != null) {
            item(key = "load-more") { LoadMoreRow(loadingMore, onLoadMore) }
        }
    }
}

@Composable
private fun LoadMoreRow(loadingMore: Boolean, onLoadMore: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (loadingMore) {
            LoadingIndicator()
        } else {
            TextButton(onClick = onLoadMore) { Text(t("thread.loadMore")) }
        }
    }
}
