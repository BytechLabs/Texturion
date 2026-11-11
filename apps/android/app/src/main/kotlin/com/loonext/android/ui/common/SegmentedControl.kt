package com.loonext.android.ui.common

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One choice in a [SegmentedControl]. [badge] draws a quiet [CountPill] after the label. */
data class Segment<T>(
    val value: T,
    val label: String,
    val icon: ImageVector? = null,
    val badge: Int? = null,
    /** What a screen reader says when it differs from [label] (an icon-only segment). */
    val description: String? = null,
)

/** [Md] is the page-level switcher, [Sm] sits inside a card. */
enum class SegmentedSize { Md, Sm }

/**
 * #733: the one segmented control. A single-choice pill track: an inset track,
 * an ink pill on the chosen segment, equal-height segments. Read as a radio
 * group, so a screen reader says "selected" and "radio button" the way the
 * web's `radiogroup` does. [fill] gives every segment an equal share of the
 * width; [iconOnly] draws the icon and speaks the label. The web twin is
 * `apps/web/src/components/ui/segmented-control.tsx`.
 *
 * Not for a multi-select row of filter chips, or a list of option cards.
 * `SegmentedControlGuardTest` fails on a hand-rolled one elsewhere.
 */
@Composable
fun <T> SegmentedControl(
    segments: List<Segment<T>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    size: SegmentedSize = SegmentedSize.Md,
    fill: Boolean = false,
    iconOnly: Boolean = false,
) {
    val haptics = rememberHaptics()
    Row(
        modifier
            .then(if (fill) Modifier.fillMaxWidth() else Modifier)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape)
            .padding(3.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        segments.forEach { segment ->
            val chosen = segment.value == selected
            val container by animateColorAsState(
                if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh,
                label = "segment-fill",
            )
            val content = if (chosen) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
            val spoken = segment.description ?: segment.label
            Row(
                Modifier
                    .then(if (fill) Modifier.weight(1f) else Modifier)
                    .heightIn(min = if (size == SegmentedSize.Md) 44.dp else 36.dp)
                    .widthIn(min = 44.dp)
                    .clip(CircleShape)
                    .background(container, CircleShape)
                    .selectable(
                        selected = chosen,
                        role = Role.RadioButton,
                        onClick = {
                            if (!chosen) {
                                haptics.tap()
                                onSelect(segment.value)
                            }
                        },
                    )
                    .semantics { if (iconOnly) contentDescription = spoken }
                    .padding(horizontal = if (iconOnly) 16.dp else 11.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (segment.icon != null) {
                    Icon(
                        segment.icon,
                        contentDescription = null,
                        tint = content,
                        modifier = Modifier.size(18.dp),
                    )
                }
                if (!iconOnly) {
                    Text(
                        segment.label,
                        color = content,
                        fontSize = if (size == SegmentedSize.Md) 13.sp else 12.sp,
                        fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    segment.badge?.let { count ->
                        if (count > 0) CountPill(count)
                    }
                }
            }
        }
    }
}
