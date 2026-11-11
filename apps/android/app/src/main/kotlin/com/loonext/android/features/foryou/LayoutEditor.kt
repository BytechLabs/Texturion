package com.loonext.android.features.foryou

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.dashboard.DashboardLayouts
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.asButton

/**
 * #736: arranging the For you page, on the phone.
 *
 * ## What binds it
 *
 * *Direct manipulation* - every tap saves and the screen changes under the
 * member's thumb; there is no Save step to forget. The announcement is spoken
 * politely so a TalkBack reader hears what moved without losing their place.
 *
 * *Zen of Clarity* - nothing of this shows until "Edit layout" is pressed. The
 * page is a one-column list on a phone, so "move earlier / later" replaces
 * dragging (a drag cannot be done with a screen reader, and a long list scrolls
 * under the finger) and the width is the stored third / two thirds / full that
 * the laptop draws, cycled by one button.
 *
 * *Chunking* - four controls per panel in two short rows, each at least 48dp.
 *
 * Mirrors apps/web/src/components/for-you/for-you-view.tsx.
 */

/** Hint, the panels that can be added, and the way back to the default. */
@Composable
internal fun LayoutToolbar(
    addable: List<String>,
    onAdd: (String) -> Unit,
    onReset: () -> Unit,
    failed: Boolean,
    modifier: Modifier = Modifier,
) {
    val locale = LocalAppLocale.current
    Column(modifier.padding(top = 14.dp)) {
        Text(
            t("inbox.forYouEditingHintPhone"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 6.dp),
        )
        if (failed) {
            Text(
                t("inbox.forYouLayoutSaveFailed"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(start = 6.dp, end = 6.dp, top = 8.dp),
            )
        }
        Column(Modifier.padding(top = 14.dp)) {
            SectionHeader(t("inbox.forYouAddPanel"))
            PaperCard(Modifier.fillMaxWidth()) {
                if (addable.isEmpty()) {
                    Text(
                        t("inbox.forYouAddPanelNone"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(12.dp),
                    )
                }
                addable.forEachIndexed { index, id ->
                    if (index > 0) RowDivider()
                    val label = DashboardLayouts.label(id, locale)
                    val note = DashboardLayouts.note(id, locale)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 56.dp)
                            .clickable { onAdd(id) }
                            .semantics(mergeDescendants = true) {
                                contentDescription = "$label. $note"
                            }
                            .asButton()
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                label,
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                note,
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Icon(
                            Icons.Outlined.Add,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
        }
        OutlinedButton(
            onClick = onReset,
            modifier = Modifier.padding(top = 12.dp).heightIn(min = 48.dp),
        ) { Text(t("inbox.forYouResetLayout")) }
    }
}

/** The four controls above one panel while the page is being arranged. */
@Composable
internal fun PanelEditBar(
    id: String,
    size: String,
    onMove: (Int) -> Unit,
    onResize: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = LocalAppLocale.current
    val label = DashboardLayouts.label(id, locale)
    val sizeName = DashboardLayouts.sizeLabel(size, locale)
    val earlier = t("inbox.forYouMoveEarlier", "panel" to label)
    val later = t("inbox.forYouMoveLater", "panel" to label)
    val resize = t("inbox.forYouResizePanel", "panel" to label, "size" to sizeName)
    val remove = t("inbox.forYouRemovePanel", "panel" to label)
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier.fillMaxWidth().padding(bottom = 6.dp),
    ) {
        Column(Modifier.padding(start = 12.dp, end = 4.dp, top = 2.dp, bottom = 2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    label,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                IconButton(onClick = onRemove) {
                    Icon(Icons.Outlined.Close, contentDescription = remove)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onMove(-1) }) {
                    Icon(Icons.Outlined.KeyboardArrowUp, contentDescription = earlier)
                }
                IconButton(onClick = { onMove(1) }) {
                    Icon(Icons.Outlined.KeyboardArrowDown, contentDescription = later)
                }
                Spacer(Modifier.weight(1f))
                TextButton(
                    onClick = onResize,
                    modifier = Modifier
                        .heightIn(min = 48.dp)
                        .semantics { contentDescription = resize },
                ) { Text(sizeName) }
            }
        }
    }
}

/** What an empty panel shows while it is being arranged, so it can still be moved. */
@Composable
internal fun PanelEmptyStub() {
    PaperCard(Modifier.fillMaxWidth()) {
        Text(
            t("inbox.forYouPanelEmpty"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(12.dp),
        )
    }
}

/** "Waiting on you: 4 waiting, not on your page" and the way to bring it back. */
@Composable
internal fun OffPageLine(
    panel: String,
    count: Int,
    onShow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth().padding(top = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            t("inbox.forYouHiddenQueue", "panel" to panel, "count" to count.toString()),
            modifier = Modifier.weight(1f).padding(start = 6.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(onClick = onShow, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(t("inbox.forYouShowPanel"))
        }
    }
}

/** Spoken, never seen: the polite announcement of what the last change did. */
@Composable
internal fun LayoutAnnouncement(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier
            .size(1.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = Color.Transparent,
        fontSize = 1.sp,
        maxLines = 1,
    )
}
