package com.loonext.android.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t

/**
 * One row in a [SearchablePicker]. [searchText] is what typing matches (the label
 * by default); [description] is a line under the label; [leading] is a slot before
 * it, such as a teammate's avatar.
 */
data class PickerOption<T>(
    val value: T,
    val label: String,
    val description: String? = null,
    val searchText: String = label,
    val leading: (@Composable () -> Unit)? = null,
)

/**
 * #746: the one searchable picker, for a long list somebody finds by typing: time
 * zones, teammates. The closed field is drawn exactly like [SelectField]'s; it
 * opens a bottom sheet with a search field over the list, so the keyboard never
 * covers the rows. The web twin is `apps/web/src/components/ui/searchable-picker.tsx`.
 *
 * `SearchablePickerGuardTest` fails on a second sheet or dropdown with a search
 * field over a list outside this file.
 */
@Composable
fun <T> SearchablePicker(
    options: List<PickerOption<T>>,
    selected: T?,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: String = "",
    label: String? = null,
    title: String? = null,
    searchPlaceholder: String = t("common.pickerSearch"),
    fillWidth: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    val chosen = options.firstOrNull { it.value == selected }
    SelectTrigger(
        text = chosen?.label ?: placeholder,
        label = label,
        enabled = enabled,
        fillWidth = fillWidth,
        onClick = { open = true },
    )
    if (open) {
        SearchablePickerSheet(
            options = options,
            selected = selected,
            title = title,
            searchPlaceholder = searchPlaceholder,
            onPick = {
                open = false
                if (it != selected) onSelect(it)
            },
            onDismiss = { open = false },
        )
    }
}

/** The sheet [SearchablePicker] opens, for a caller that owns when it shows. */
@Composable
fun <T> SearchablePickerSheet(
    options: List<PickerOption<T>>,
    selected: T?,
    onPick: (T) -> Unit,
    onDismiss: () -> Unit,
    title: String? = null,
    searchPlaceholder: String = t("common.pickerSearch"),
) {
    var query by remember { mutableStateOf("") }
    val needle = query.trim()
    val matches = if (needle.isEmpty()) {
        options
    } else {
        options.filter {
            it.searchText.contains(needle, ignoreCase = true) ||
                it.searchText.replace('_', ' ').contains(needle, ignoreCase = true)
        }
    }

    AppSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            if (title != null) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp),
                )
            }
            SearchField(
                value = query,
                onValueChange = { query = it },
                placeholder = searchPlaceholder,
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
            )
            LazyColumn(Modifier.fillMaxWidth()) {
                items(matches, key = { it.value.toString() }) { option ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable { onPick(option.value) }
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (option.leading != null) {
                            option.leading.invoke()
                            Spacer(Modifier.width(12.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(option.label, style = MaterialTheme.typography.bodyLarge)
                            if (option.description != null) {
                                Text(
                                    option.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        if (option.value == selected) {
                            Icon(
                                Icons.Outlined.Check,
                                contentDescription = t("contactsTasks.selected"),
                                tint = MaterialTheme.colorScheme.secondary,
                                modifier = Modifier.size(IconSize.Default),
                            )
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                if (matches.isEmpty()) {
                    item(key = "empty") {
                        Text(
                            t("common.pickerNoMatch"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
                item(key = "bottom-space") { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}
