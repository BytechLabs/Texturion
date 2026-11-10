package com.loonext.android.features.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider

/** #719: the longest search a person is offered a field for. */
internal const val SETTINGS_SEARCH_MAX = 60

/** The search field at the top of the settings home. */
@Composable
internal fun SettingsSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = query,
        onValueChange = { onQueryChange(it.take(SETTINGS_SEARCH_MAX)) },
        placeholder = {
            Text(
                t("settingsMore.searchPlaceholder"),
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        leadingIcon = {
            Icon(
                Icons.Outlined.Search,
                contentDescription = null,
                modifier = Modifier.padding(start = 2.dp),
            )
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = t("settingsMore.searchClear"),
                    )
                }
            }
        },
        singleLine = true,
        shape = CircleShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedBorderColor = MaterialTheme.colorScheme.outline,
            unfocusedBorderColor = androidx.compose.ui.graphics.Color.Transparent,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * What the search found: each setting with where it lives, "Group › Section".
 * A tap opens the section scrolled to the setting.
 */
@Composable
internal fun SettingsSearchResults(
    query: String,
    role: String?,
    onOpen: (SettingsSection, anchor: String) -> Unit,
) {
    val locale = LocalAppLocale.current
    val results = searchPhoneSettings(query, locale, role)
    if (results.isEmpty()) {
        Text(
            t("settingsMore.searchEmpty", "query" to query.trim()),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
        )
        return
    }
    PaperCard(Modifier.fillMaxWidth()) {
        results.forEachIndexed { index, result ->
            if (index > 0) RowDivider()
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(result.section, result.entry.anchor) }
                    .padding(horizontal = 15.dp, vertical = 11.dp),
            ) {
                Text(
                    result.label,
                    style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.5.sp),
                )
                Text(
                    t(
                        "settingsMore.searchPath",
                        "group" to t(result.group.titleKey),
                        "section" to t(result.section.titleKey),
                    ),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 1.dp),
                )
            }
        }
    }
}
