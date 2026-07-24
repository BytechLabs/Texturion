package com.loonext.android.ui.common

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.model.filterCountries

/**
 * #214 — the shared, typable country autocomplete used by BOTH task-address
 * surfaces (the make-task sheet and the task-detail address section). The user
 * types and the menu filters ([filterCountries]); tapping an item sets the
 * value; a freely-typed off-list value (e.g. an enrichment's "CA") is still
 * accepted verbatim. Styled to the address-field grammar (surface fill +
 * hairline outline). ONE component so neither call site re-implements the
 * dropdown.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountryField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    val options = filterCountries(value)

    ExposedDropdownMenuBox(
        expanded = expanded && enabled && options.isNotEmpty(),
        onExpandedChange = { if (enabled) expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it.take(100))
                // Any keystroke reopens the menu so the list re-filters live.
                expanded = true
            },
            enabled = enabled,
            singleLine = true,
            placeholder = {
                Text(
                    "Country",
                    fontSize = 13.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                )
            },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(
                    expanded = expanded && enabled && options.isNotEmpty(),
                )
            },
            textStyle = LocalTextStyle.current.copy(fontSize = 13.5.sp),
            shape = MaterialTheme.shapes.medium,
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surface,
                unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                focusedBorderColor = MaterialTheme.colorScheme.outline,
                unfocusedBorderColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            ),
            modifier = Modifier
                .fillMaxWidth()
                // PrimaryEditable: an editable anchor that keeps the keyboard
                // and lets the menu float beneath the field.
                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable, enabled),
        )
        ExposedDropdownMenu(
            expanded = expanded && enabled && options.isNotEmpty(),
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { country ->
                DropdownMenuItem(
                    text = {
                        Text(
                            country,
                            fontSize = 13.5.sp,
                            fontWeight = if (country.equals(value.trim(), ignoreCase = true)) {
                                FontWeight.SemiBold
                            } else {
                                FontWeight.Normal
                            },
                        )
                    },
                    onClick = {
                        onValueChange(country)
                        expanded = false
                    },
                    contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                )
            }
        }
    }
}
