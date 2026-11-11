package com.loonext.android.features.contacts

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.GalleryItem
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.EmptyState
import com.loonext.android.ui.common.EmptyStateSize
import com.loonext.android.ui.common.IconSize
import com.loonext.android.ui.common.LoadError
import com.loonext.android.ui.common.LoadErrorVariant
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.userMessage
import kotlin.coroutines.cancellation.CancellationException

/**
 * #740: the photos and files shared with this contact, from their thread's
 * gallery. First rows only, with "Show all" for the rest; a tap opens the file
 * in whatever app handles it. A contact with no thread has none.
 */
@Composable
internal fun ContactFilesSection(
    graph: AppGraph,
    companyId: String,
    conversationId: String?,
    modifier: Modifier = Modifier,
) {
    if (conversationId == null) {
        FilesEmpty(modifier)
        return
    }
    val repo = remember(graph) { MessagingRepository(graph.api) }
    val locale = LocalAppLocale.current
    val context = LocalContext.current
    var refreshKey by remember(conversationId) { mutableIntStateOf(0) }
    var state by remember(conversationId) {
        mutableStateOf<LoadState<List<GalleryItem>>>(LoadState.Loading)
    }
    var showAll by remember(conversationId) { mutableStateOf(false) }

    // Signed URLs expire, so every visit reads a fresh page rather than the cache.
    LaunchedEffect(companyId, conversationId, refreshKey) {
        state = try {
            LoadState.Ready(repo.gallery(companyId, conversationId).data)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage(locale))
        }
    }

    when (val current = state) {
        is LoadState.Loading -> PaperCard(modifier.fillMaxWidth()) {
            SkeletonList(rows = 2, avatar = false)
        }

        is LoadState.Failed -> LoadError(
            current.message,
            onRetry = { refreshKey++ },
            variant = LoadErrorVariant.Inline,
            modifier = modifier,
        )

        is LoadState.Ready -> if (current.value.isEmpty()) {
            FilesEmpty(modifier)
        } else {
            val shown = cappedRows(current.value, showAll)
            Column(modifier.fillMaxWidth()) {
                PaperCard(Modifier.fillMaxWidth()) {
                    shown.forEachIndexed { index, item ->
                        FileRow(item) {
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, item.url.toUri()))
                            } catch (_: Exception) {
                                // No app handles it; the gallery screen says so.
                            }
                        }
                        if (index < shown.lastIndex) RowDivider()
                    }
                }
                if (shown.size < current.value.size) {
                    TextButton(onClick = { showAll = true }) {
                        Text(t("contactsTasks.showAll", "count" to current.value.size.toString()))
                    }
                }
            }
        }
    }
}

@Composable
private fun FilesEmpty(modifier: Modifier) {
    EmptyState(
        title = t("contactsTasks.noFilesYet"),
        description = t("contactsTasks.noFilesYetDetail"),
        icon = Icons.Outlined.Image,
        size = EmptyStateSize.Panel,
        modifier = modifier,
    )
}

@Composable
private fun FileRow(item: GalleryItem, onOpen: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(onClick = onOpen)
            .padding(horizontal = 15.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Icon(
            if (item.kind == "image") Icons.Outlined.Image else Icons.Outlined.Description,
            contentDescription = null,
            modifier = Modifier.size(IconSize.Default),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            item.file_name?.ifBlank { null } ?: item.content_type.orEmpty(),
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}
