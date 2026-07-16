package com.loonext.android.features.thread

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.loonext.android.core.model.GalleryItem
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * "Photos & files" (#165): the conversation gallery over
 * GET /v1/conversations/:id/attachments — MMS photos + note/task files in one
 * newest-first stream, split by an Images | Files toggle. Every visit
 * refetches, which is the per-view signed-URL mint (item URLs are short-lived
 * by design and never cached). Files open externally via ACTION_VIEW.
 */
@Composable
internal fun AttachmentsGalleryScreen(
    repo: MessagingRepository,
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

    var view by remember { mutableStateOf(GalleryView.Images) }
    var state by remember(conversationId) {
        mutableStateOf<LoadState<List<GalleryItem>>>(LoadState.Loading)
    }
    var nextCursor by remember(conversationId) { mutableStateOf<String?>(null) }
    var loadingMore by remember(conversationId) { mutableStateOf(false) }
    var refreshKey by remember(conversationId) { mutableIntStateOf(0) }

    LaunchedEffect(conversationId, refreshKey) {
        if (state !is LoadState.Ready) state = LoadState.Loading
        state = try {
            val page = repo.gallery(companyId, conversationId)
            nextCursor = page.next_cursor
            LoadState.Ready(page.data)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    fun loadMore() {
        val cursor = nextCursor ?: return
        if (loadingMore) return
        loadingMore = true
        scope.launch {
            try {
                val page = repo.gallery(companyId, conversationId, cursor)
                nextCursor = page.next_cursor
                val existing = (state as? LoadState.Ready)?.value ?: emptyList()
                val seen = existing.mapTo(HashSet()) { it.id }
                state = LoadState.Ready(existing + page.data.filter { it.id !in seen })
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
            onNotice("No app on this device can open that file.")
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
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to conversation")
            }
            Column(Modifier.weight(1f)) {
                Text("Photos & files", style = MaterialTheme.typography.titleMedium)
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
                ) { Text(item.label) }
            }
        }

        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                val rows = galleryItemsFor(view, current.value)
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
                                    "No photos loaded yet."

                                view == GalleryView.Images ->
                                    "No photos in this conversation yet."

                                nextCursor != null -> "No files loaded yet."
                                else -> "No files in this conversation yet."
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
                    )
                } else {
                    FilesList(
                        items = rows,
                        nextCursor = nextCursor,
                        loadingMore = loadingMore,
                        onLoadMore = ::loadMore,
                        onOpen = ::openExternally,
                    )
                }
            }
        }
    }
}

@Composable
private fun ImagesGrid(
    items: List<GalleryItem>,
    nextCursor: String?,
    loadingMore: Boolean,
    onLoadMore: () -> Unit,
    onOpen: (GalleryItem) -> Unit,
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
                contentDescription = item.file_name ?: "Photo",
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onOpen(item) },
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
            TextButton(onClick = onLoadMore) { Text("Load more") }
        }
    }
}
