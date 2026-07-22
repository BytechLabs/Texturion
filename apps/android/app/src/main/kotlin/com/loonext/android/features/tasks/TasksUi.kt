package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.ui.common.initialsOf

/**
 * Tasks-local pieces of the "paper & olive" grammar (screens 22–24, 31):
 * paper icon circles, the derived-done ring, pill filters/views, and the
 * 28dp assignee avatar on the secondaryContainer tint.
 */

/** 44dp paper circle with a 17–18dp stroke icon (screen-corner buttons). */
@Composable
internal fun PaperCircleButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shadowElevation = 1.dp,
        modifier = modifier.size(44.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                contentDescription = contentDescription,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/**
 * The round derived-done toggle: hollow 1.8dp muted ring → lime fill with an
 * ink check. The write behind it is always the source-message PATCH.
 */
@Composable
internal fun DoneCircle(
    done: Boolean,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    ring: Dp = 23.dp,
    checkSize: Dp = 13.dp,
    ringWidth: Dp = 1.8.dp,
    touch: Dp = 36.dp,
) {
    val label = if (done) "Mark not done" else "Mark done"
    Box(
        modifier
            .size(touch)
            .clip(CircleShape)
            .clickable(role = Role.Checkbox) { onToggle(!done) }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        if (done) {
            Box(
                Modifier
                    .size(ring)
                    .background(MaterialTheme.colorScheme.tertiary, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Check,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onTertiary,
                    modifier = Modifier.size(checkSize),
                )
            }
        } else {
            Box(
                Modifier
                    .size(ring)
                    .border(ringWidth, MaterialTheme.colorScheme.outline, CircleShape),
            )
        }
    }
}

/** Small initials avatar on the avatar tint (row assignees, note authors). */
@Composable
internal fun TaskAvatar(
    name: String?,
    size: Dp = 28.dp,
    fontSize: TextUnit = 9.5.sp,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(size)
            .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            fontSize = fontSize,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            maxLines = 1,
        )
    }
}

/** View-switcher pill: ink when active, paper when idle (spec 24). */
@Composable
internal fun ViewPill(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.surface,
        contentColor = if (selected) MaterialTheme.colorScheme.onPrimary
        else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    ) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            maxLines = 1,
        )
    }
}

/** Small filter pill: avatar-tint fill when selected, paper when idle. */
@Composable
internal fun FilterPill(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer
        else MaterialTheme.colorScheme.surface,
        contentColor = if (selected) MaterialTheme.colorScheme.onSecondaryContainer
        else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    ) {
        Row(
            Modifier.padding(horizontal = 11.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text,
                fontSize = 11.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            trailing?.invoke()
        }
    }
}

/**
 * Card-group shape for a lazy list rendered as ONE paper card: the first row
 * rounds the top 22, the last rounds the bottom 22, middles stay square.
 */
internal fun cardGroupShape(index: Int, count: Int): RoundedCornerShape {
    val top = if (index == 0) 22.dp else 0.dp
    val bottom = if (index == count - 1) 22.dp else 0.dp
    return RoundedCornerShape(
        topStart = top,
        topEnd = top,
        bottomEnd = bottom,
        bottomStart = bottom,
    )
}
