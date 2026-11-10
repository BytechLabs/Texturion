package com.loonext.android.ui.common

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.t
import com.loonext.android.core.time.TimestampFormat

/**
 * #712: the one renderer for a record's action list, as a menu anchored to the row.
 *
 * It draws exactly what [visible] returns, in that order, with a divider where the
 * group changes and the destructive group last in the error colour. A record with
 * nothing allowed draws nothing at all, so a caller can open it unconditionally.
 *
 * [onSelect] gets the action id and, for an action with choices, the chosen
 * sub-action id. The caller dispatches on the ids in `RecordActions.kt`.
 *
 * [exactTime] is the record's exact time with its zone (#720). A row that opens
 * this menu on long-press cannot also pop the tooltip from the same press, so the
 * time is the menu's first line instead.
 */
@Composable
fun RecordMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    actions: List<RecordAction>,
    onSelect: (actionId: String, subId: String?) -> Unit,
    exactTime: String? = null,
) {
    val shown = actions.visible()
    if (shown.isEmpty()) return
    var choosing by remember { mutableStateOf<RecordAction?>(null) }
    LaunchedEffect(expanded) { if (!expanded) choosing = null }
    val locale = LocalAppLocale.current

    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        val pending = choosing
        if (pending != null) {
            DropdownMenuItem(
                text = { Text(t(pending.labelKey)) },
                leadingIcon = {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null, modifier = Modifier.size(18.dp))
                },
                onClick = { choosing = null },
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            pending.submenu.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(choice.label ?: choice.labelKey?.let { AppStrings.translate(locale, it) } ?: choice.id) },
                    trailingIcon = choice.trailing?.let { trailing ->
                        {
                            Text(
                                trailing,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    },
                    onClick = {
                        onDismiss()
                        onSelect(pending.id, choice.id)
                    },
                )
            }
            return@DropdownMenu
        }

        if (exactTime != null) {
            Text(
                AppStrings.translate(locale, "recordMenu.exactTime", mapOf("time" to exactTime)),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
        shown.forEachIndexed { index, action ->
            if (index > 0 && shown[index - 1].group != action.group) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            if (action.note) {
                Text(
                    t(action.labelKey),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
                return@forEachIndexed
            }
            val tint = if (action.destructive) MaterialTheme.colorScheme.error else Color.Unspecified
            DropdownMenuItem(
                text = { Text(t(action.labelKey), color = tint) },
                enabled = action.enabled,
                modifier = if (action.checked != null) {
                    Modifier.semantics { toggleableState = ToggleableState(action.checked) }
                } else {
                    Modifier
                },
                // #465: a state shows its box in BOTH positions, so an unchecked
                // "Pinned" never reads like a plain verb.
                trailingIcon = action.checked?.let { on ->
                    {
                        Icon(
                            if (on) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
                            contentDescription = null,
                            tint = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                },
                onClick = {
                    if (action.submenu.isNotEmpty()) {
                        choosing = action
                    } else {
                        onDismiss()
                        onSelect(action.id, null)
                    }
                },
            )
        }
    }
}

/** The exact time line a record menu leads with, from the record's own ISO instant. */
@Composable
fun rememberExactTime(iso: String?): String? {
    val locale = LocalAppLocale.current
    return remember(iso, locale) {
        iso?.let { TimestampFormat.exact(it, locale) }?.takeIf { it.isNotBlank() }
    }
}
