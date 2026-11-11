package com.loonext.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** [Page] fills a page or a list area; [Panel] sits inside a card, a sheet or a section. */
enum class EmptyStateSize { Page, Panel }

/**
 * #733: the one empty state. A quiet icon in a disc, one warm line, an optional
 * second line, and at most one action, centred with room to breathe. Never "No
 * data", never an illustration. The web twin is
 * `apps/web/src/components/ui/empty-state.tsx`.
 *
 * `EmptyStateGuardTest` fails on a hand-rolled centred empty message elsewhere.
 */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    description: String? = null,
    action: (@Composable () -> Unit)? = null,
    size: EmptyStateSize = EmptyStateSize.Page,
) {
    val page = size == EmptyStateSize.Page
    Column(
        modifier = modifier
            .then(if (page) Modifier.fillMaxSize() else Modifier.fillMaxWidth())
            .padding(
                horizontal = if (page) 32.dp else 16.dp,
                vertical = if (page) 56.dp else 28.dp,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(
            if (page) 12.dp else 8.dp,
            Alignment.CenterVertically,
        ),
    ) {
        if (icon != null) {
            Box(
                Modifier
                    .size(44.dp)
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(IconSize.Large),
                )
            }
        }
        Text(
            title,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
        if (description != null) {
            Text(
                description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 320.dp),
            )
        }
        if (action != null) action()
    }
}
