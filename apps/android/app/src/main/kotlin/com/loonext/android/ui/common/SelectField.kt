package com.loonext.android.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t

/**
 * One choice in a [SelectField]. [description] is one line under the label in the
 * open list only: the closed field shows the label and nothing else.
 */
data class SelectOption<T>(
    val value: T,
    val label: String,
    val description: String? = null,
    val enabled: Boolean = true,
)

/**
 * #746: the one simple select, for a short list of single choices. The closed
 * field is an outline button holding the chosen label and a chevron; the open
 * list is a menu with an optional description under each label and a check on
 * the chosen one. [selected] that is not in [options] shows [placeholder].
 *
 * A long list found by typing (time zones, countries, teammates) is
 * [SearchablePicker]; a few options with consequences each are [ChoiceCards].
 * `SelectFieldGuardTest` fails on a hand-built dropdown elsewhere. The web twin
 * is `apps/web/src/components/ui/simple-select.tsx`.
 *
 * [label] is the question the field answers, spoken with the answer
 * ("Role: Member") for a screen reader.
 */
@Composable
fun <T> SelectField(
    options: List<SelectOption<T>>,
    selected: T?,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: String = "",
    label: String? = null,
    fillWidth: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    val chosen = options.firstOrNull { it.value == selected }
    Box(modifier) {
        SelectTrigger(
            text = chosen?.label ?: placeholder,
            label = label,
            enabled = enabled,
            fillWidth = fillWidth,
            onClick = { open = true },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(option.label)
                            if (option.description != null) {
                                Text(
                                    option.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    },
                    trailingIcon = if (option.value == selected) {
                        {
                            Icon(
                                Icons.Outlined.Check,
                                contentDescription = t("contactsTasks.selected"),
                                modifier = Modifier.size(IconSize.Default),
                            )
                        }
                    } else {
                        null
                    },
                    enabled = option.enabled,
                    modifier = Modifier.heightIn(min = 48.dp),
                    onClick = {
                        open = false
                        if (option.value != selected) onSelect(option.value)
                    },
                )
            }
        }
    }
}

/** The closed field both [SelectField] and [SearchablePicker] draw, so they read as one control. */
@Composable
internal fun SelectTrigger(
    text: String,
    label: String?,
    enabled: Boolean,
    fillWidth: Boolean,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .heightIn(min = 48.dp)
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
            .semantics {
                role = Role.DropdownList
                if (label != null) contentDescription = "$label: $text"
            },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Outlined.ExpandMore,
                contentDescription = null,
                modifier = Modifier.size(IconSize.Default),
            )
        }
    }
}
