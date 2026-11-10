package com.loonext.android.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * #717: the one header every record panel and detail screen draws: who or what
 * this is, what it says about itself, and an action row under it. Navigation to
 * the record's own screen is a labelled link in that row ([RecordOpenLink]),
 * never an icon in a corner, so it cannot be mistaken for editing and is found
 * on first look.
 *
 * Hand-port of `apps/web/src/components/ui/record-header.tsx`.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RecordHeader(
    title: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    /** An avatar, or a task's done circle. */
    leading: (@Composable () -> Unit)? = null,
    /** Quiet lines under the title: a number, an outcome, a relationship. */
    meta: (@Composable () -> Unit)? = null,
    /** Icon toggles and the overflow menu, beside the title. */
    trailing: (@Composable RowScope.() -> Unit)? = null,
    /** The action row: call, copy, open. */
    actions: (@Composable FlowRowScope.() -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            leading?.invoke()
            Column(Modifier.weight(1f)) {
                title()
                meta?.invoke()
            }
            trailing?.let { Row(verticalAlignment = Alignment.CenterVertically, content = it) }
        }
        actions?.let {
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
                content = it,
            )
        }
    }
}

/** The action row's way to the record's own screen: a label and a chevron. */
@Composable
fun RecordOpenLink(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Text(label)
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
        )
    }
}

/** One section of a record panel: a quiet label over its content. */
@Composable
fun RecordSection(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        content()
    }
}
