package com.loonext.android.features.shell

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.loonextWordmark
import com.loonext.android.ui.common.rememberHaptics
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * The 'You' sheet (#100, screen 08): ink identity tile with copyable numbers,
 * theme selector, the Notifications / Contacts / Settings / Sign out rows,
 * and the workspace switcher (multi-membership only).
 */
@Composable
fun AccountSheet(
    graph: AppGraph,
    me: Me,
    companyId: String,
    unreadNotifications: Int,
    onOpenContacts: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenSettings: () -> Unit,
    onSwitchWorkspace: (String) -> Unit,
    onSignOut: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val theme by graph.prefs.theme.collectAsStateWithLifecycle(initialValue = "system")
    val membership = me.memberships.firstOrNull { it.company_id == companyId }
    val company = me.company
    val workspaceName = membership?.name ?: company?.name

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            // #180: rows must stay reachable at ANY viewport height. When the
            // sheet is taller than the screen allows, the content scrolls; on
            // tall screens the scroll never engages and nothing moves.
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // --- Ink identity tile: workspace + who you are + numbers -----
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.fillMaxWidth(),
            ) {
                val activeNumbers = company?.numbers
                    ?.filter { it.status == NumberStatus.ACTIVE && it.number_e164 != null }
                    .orEmpty()
                Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(44.dp)
                                .background(
                                    MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.14f),
                                    RoundedCornerShape(14.dp),
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                initialsOf(workspaceName ?: me.display_name),
                                style = MaterialTheme.typography.labelLarge.copy(
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                ),
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                workspaceName ?: me.display_name.ifBlank { "You" },
                                style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            membership?.let {
                                Text(
                                    "${me.display_name} · ${it.role.replaceFirstChar(Char::uppercase)}",
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.55f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 1.dp),
                                )
                            }
                        }
                        activeNumbers.firstOrNull()?.number_e164?.let { number ->
                            Spacer(Modifier.width(8.dp))
                            NumberChip(number, onCopy = { copy(context, it) })
                        }
                    }
                    // Extra workspace numbers stay copyable (rare, stacked).
                    if (activeNumbers.size > 1) {
                        Row(
                            Modifier.padding(top = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            activeNumbers.drop(1).forEach { number ->
                                NumberChip(
                                    number.number_e164!!,
                                    onCopy = { copy(context, it) },
                                )
                            }
                        }
                    }
                }
            }

            // --- Theme selector -------------------------------------------
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(horizontal = 15.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Theme",
                        style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.sp),
                        modifier = Modifier.weight(1f),
                    )
                    // Segmented track per the design grammar: inset track, INK
                    // pill for the selected segment (paper-on-inset was nearly
                    // invisible), equal-size segments. The ink pill GLIDES to
                    // the picked segment (#194); labels only cross-fade.
                    val segmentBounds =
                        remember { mutableStateMapOf<String, Pair<Float, IntSize>>() }
                    Box(
                        Modifier
                            .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape)
                            .padding(3.dp),
                    ) {
                        segmentBounds[theme]?.let { (segmentX, segmentSize) ->
                            val density = LocalDensity.current
                            val pillX by animateFloatAsState(
                                targetValue = segmentX,
                                animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                                label = "themePillX",
                            )
                            val pillWidth by animateFloatAsState(
                                targetValue = segmentSize.width.toFloat(),
                                animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                                label = "themePillWidth",
                            )
                            Box(
                                Modifier
                                    .align(Alignment.CenterStart)
                                    .offset { IntOffset(pillX.roundToInt(), 0) }
                                    .size(
                                        width = with(density) { pillWidth.toDp() },
                                        height = with(density) { segmentSize.height.toDp() },
                                    )
                                    .background(MaterialTheme.colorScheme.primary, CircleShape),
                            )
                        }
                        Row {
                            listOf("system" to "System", "light" to "Light", "dark" to "Dark")
                                .forEach { (value, label) ->
                                    val selected = theme == value
                                    val labelColor by animateColorAsState(
                                        targetValue = if (selected) {
                                            MaterialTheme.colorScheme.onPrimary
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                        label = "themeLabel",
                                    )
                                    Surface(
                                        onClick = {
                                            if (!selected) haptics.tap()
                                            scope.launch { graph.prefs.setTheme(value) }
                                        },
                                        shape = CircleShape,
                                        color = Color.Transparent,
                                        modifier = Modifier.onGloballyPositioned {
                                            segmentBounds[value] =
                                                it.positionInParent().x to it.size
                                        },
                                    ) {
                                        Text(
                                            label,
                                            style = MaterialTheme.typography.labelSmall.copy(
                                                fontSize = 11.5.sp,
                                                fontWeight = FontWeight.SemiBold,
                                            ),
                                            color = labelColor,
                                            textAlign = TextAlign.Center,
                                            modifier = Modifier
                                                .widthIn(min = 58.dp)
                                                .padding(horizontal = 10.dp, vertical = 7.dp),
                                        )
                                    }
                                }
                        }
                    }
                }
            }

            // --- Notifications / Contacts / Settings / Sign out -----------
            PaperCard(Modifier.fillMaxWidth()) {
                SheetRow(
                    icon = Icons.Outlined.Notifications,
                    label = "Notifications",
                    dot = unreadNotifications > 0,
                    trailing = {
                        if (unreadNotifications > 0) {
                            AnimatedContent(
                                targetState = unreadNotifications,
                                transitionSpec = {
                                    (slideInVertically { it / 2 } + fadeIn()) togetherWith
                                        (slideOutVertically { -it / 2 } + fadeOut())
                                },
                                label = "unreadBadge",
                            ) { count ->
                                Text(
                                    "$count new",
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                    ),
                                    color = MaterialTheme.colorScheme.secondary,
                                )
                            }
                        } else {
                            Chevron()
                        }
                    },
                    onClick = {
                        onOpenNotifications()
                        onDismiss()
                    },
                )
                RowDivider()
                SheetRow(
                    icon = Icons.Outlined.Group,
                    label = "Contacts",
                    onClick = {
                        onOpenContacts()
                        onDismiss()
                    },
                )
                RowDivider()
                SheetRow(
                    icon = Icons.Outlined.Settings,
                    label = "Settings",
                    onClick = {
                        onOpenSettings()
                        onDismiss()
                    },
                )
                RowDivider()
                SheetRow(
                    icon = Icons.AutoMirrored.Outlined.Logout,
                    label = "Sign out",
                    destructive = true,
                    trailing = {},
                    onClick = {
                        haptics.reject()
                        onSignOut()
                        onDismiss()
                    },
                )
            }

            // --- Workspace switcher (multi-membership only) ----------------
            if (me.memberships.size > 1) {
                Column {
                    SectionHeader("Workspaces")
                    PaperCard(Modifier.fillMaxWidth()) {
                        me.memberships.forEachIndexed { index, m ->
                            if (index > 0) RowDivider()
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable(enabled = m.company_id != companyId) {
                                        onSwitchWorkspace(m.company_id)
                                        onDismiss()
                                    }
                                    .padding(horizontal = 15.dp, vertical = 12.dp),
                            ) {
                                Box(
                                    Modifier
                                        .size(30.dp)
                                        .background(
                                            MaterialTheme.colorScheme.secondaryContainer,
                                            CircleShape,
                                        ),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        initialsOf(m.name),
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                        ),
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    )
                                }
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    m.name,
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontSize = 13.5.sp,
                                    ),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                if (m.company_id == companyId) {
                                    DsChip("Current")
                                }
                            }
                        }
                    }
                }
            }

            Text(
                loonextWordmark(
                    suffix = " v${BuildConfig.VERSION_NAME}" +
                        (workspaceName?.let { " · $it workspace" } ?: ""),
                ),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                color = MaterialTheme.colorScheme.outline,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Pill number chip on the ink tile — tap to copy. */
@Composable
private fun NumberChip(numberE164: String, onCopy: (String) -> Unit) {
    val haptics = rememberHaptics()
    Surface(
        onClick = {
            haptics.tap()
            onCopy(numberE164)
        },
        shape = CircleShape,
        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.1f),
        contentColor = MaterialTheme.colorScheme.onPrimary,
    ) {
        Row(
            Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                formatPhone(numberE164),
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            )
            Spacer(Modifier.width(6.dp))
            Icon(
                Icons.Outlined.ContentCopy,
                contentDescription = "Copy number",
                modifier = Modifier.size(11.dp),
            )
        }
    }
}

/** One sheet row: 36dp icon tile, 13.5sp SemiBold label, trailing slot. */
@Composable
private fun SheetRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    muted: Boolean = false,
    dot: Boolean = false,
    destructive: Boolean = false,
    trailing: @Composable () -> Unit = { Chevron() },
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Box(
                Modifier
                    .size(36.dp)
                    .background(
                        MaterialTheme.colorScheme.surfaceContainer,
                        RoundedCornerShape(12.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = if (destructive) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    modifier = Modifier.size(16.dp),
                )
            }
            if (dot) {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 3.dp, y = (-3).dp)
                        .size(12.dp)
                        .background(MaterialTheme.colorScheme.surface, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    AttentionDot(size = 8.dp)
                }
            }
        }
        Spacer(Modifier.width(12.dp))
        Text(
            label,
            style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.5.sp),
            color = if (destructive) {
                MaterialTheme.colorScheme.error
            } else if (muted) {
                MaterialTheme.colorScheme.onSurfaceVariant
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            modifier = Modifier.weight(1f),
        )
        trailing()
    }
}

@Composable
private fun Chevron() {
    Icon(
        Icons.AutoMirrored.Outlined.KeyboardArrowRight,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.outline,
        modifier = Modifier.size(16.dp),
    )
}

private fun copy(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Phone number", text))
}
