package com.loonext.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** How loudly a [CountPill] asks to be noticed. */
enum class CountPillTone { Quiet, Primary }

/** [Medium] sits beside a label; [Small] is the corner badge on an icon. */
enum class CountPillSize { Small, Medium }

/** Past this the pill says "99+" rather than growing. */
const val COUNT_PILL_CEILING = 99

/**
 * #733: the one count pill, a small round token holding a number: a filter's
 * active count, a saved view's queue, a section's size. [CountPillTone.Quiet]
 * is the stone default; [CountPillTone.Primary] is for a count that asks to be
 * noticed (an active filter). Position it with [modifier]. The web twin is
 * `apps/web/src/components/ui/count-pill.tsx`.
 *
 * The fill and the label are a pair from the theme (`primary` over `onPrimary`,
 * `surfaceContainerHigh` over `onSurfaceVariant`), never a hardcoded white.
 *
 * `CountPillGuardTest` fails on a count drawn as bare text elsewhere.
 */
@Composable
fun CountPill(
    count: Int,
    modifier: Modifier = Modifier,
    tone: CountPillTone = CountPillTone.Quiet,
    size: CountPillSize = CountPillSize.Medium,
) {
    val fill = when (tone) {
        CountPillTone.Quiet -> MaterialTheme.colorScheme.surfaceContainerHigh
        CountPillTone.Primary -> MaterialTheme.colorScheme.primary
    }
    val label = when (tone) {
        CountPillTone.Quiet -> MaterialTheme.colorScheme.onSurfaceVariant
        CountPillTone.Primary -> MaterialTheme.colorScheme.onPrimary
    }
    Text(
        if (count > COUNT_PILL_CEILING) "${COUNT_PILL_CEILING}+" else count.toString(),
        modifier = modifier
            .background(fill, CircleShape)
            .defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
            .padding(horizontal = 5.dp),
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = if (size == CountPillSize.Medium) 10.5.sp else 9.sp,
            lineHeight = 16.sp,
            fontWeight = FontWeight.SemiBold,
            fontFeatureSettings = "tnum",
        ),
        color = label,
        textAlign = TextAlign.Center,
        maxLines = 1,
    )
}
