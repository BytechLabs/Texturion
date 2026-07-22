package com.loonext.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.ui.theme.BrandColor

/**
 * The shared "paper & olive" design-system kit (Loonext Mobile.dc.html).
 * Every surface composes these instead of re-deriving the grammar:
 *  - [PaperCard]      rounded-22 paper card that rows live inside
 *  - [SectionHeader]  tracked uppercase micro-label + olive tabular count
 *  - [ScreenTitle]    the Bricolage display heading ("For you", "Inbox"…)
 *  - [DsChip]         pill status chip (lime by default)
 *  - [RowDivider]     hairline between card rows
 *  - [AttentionDot]   the coral unread/alert dot
 */

@Composable
fun PaperCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
    ) { Column(content = content) }
}

@Composable
fun SectionHeader(
    label: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
) {
    Row(
        modifier = modifier.padding(start = 6.dp, end = 6.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.12.em,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
        )
        if (count != null && count > 0) {
            Text(
                "  $count",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = MaterialTheme.colorScheme.secondary,
            )
        }
    }
}

/** The big screen heading: Bricolage SemiBold 30sp, tight tracking. */
@Composable
fun ScreenTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        style = MaterialTheme.typography.headlineMedium.copy(fontSize = 30.sp),
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** Pill chip. Defaults to the pale-lime "signal" look ("New lead"). */
@Composable
fun DsChip(
    text: String,
    modifier: Modifier = Modifier,
    container: Color = MaterialTheme.colorScheme.primaryContainer,
    content: Color = MaterialTheme.colorScheme.onPrimaryContainer,
) {
    Surface(modifier = modifier, shape = CircleShape, color = container) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
            ),
            color = content,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun RowDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(
        modifier = modifier,
        thickness = 1.dp,
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

/** The coral attention dot — unread marks, live badges. Never an error. */
@Composable
fun AttentionDot(modifier: Modifier = Modifier, size: Dp = 8.dp, dark: Boolean = false) {
    Box(
        modifier
            .size(size)
            .background(if (dark) BrandColor.DarkCoral else BrandColor.Coral, CircleShape),
    )
}
