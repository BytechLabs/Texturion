package com.loonext.android.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.t

/**
 * #733: the one search box. A paper pill with a search icon on the left, a clear
 * button on the right once there is something to clear, an ink ring while it has
 * focus, and focus kept in the field when it is cleared so a keyboard user is
 * not dropped. Every list and settings search draws this. The web twin is
 * `apps/web/src/components/ui/search-field.tsx`.
 *
 * [fieldLabel] is what a screen reader calls the field (the placeholder
 * disappears once there is text). [maxLength] clips what is typed.
 * [focusRequester] lets a screen that opens the field on purpose focus it.
 *
 * `SearchFieldGuardTest` fails on a hand-rolled search pill elsewhere.
 */
@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    fieldLabel: String = placeholder,
    clearLabel: String = t("common.clearSearch"),
    maxLength: Int = 200,
    focusRequester: FocusRequester? = null,
    bold: Boolean = false,
) {
    val own = remember { FocusRequester() }
    val requester = focusRequester ?: own
    var focused by remember { mutableStateOf(false) }
    val hint = MaterialTheme.colorScheme.onSurfaceVariant
    val size = if (bold) 15.sp else 14.sp
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        border = if (focused) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier
                .heightIn(min = 48.dp)
                .padding(start = 16.dp, end = if (value.isEmpty()) 16.dp else 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Icon(
                Icons.Outlined.Search,
                contentDescription = null,
                tint = hint,
                modifier = Modifier.size(IconSize.Default),
            )
            // The field itself is the full 48dp of the pill, so the whole box is the
            // touch target and the placeholder sits centred inside it.
            BasicTextField(
                value = value,
                onValueChange = { onValueChange(it.take(maxLength)) },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = size,
                    fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .focusRequester(requester)
                    .onFocusChanged { focused = it.isFocused }
                    .semantics { contentDescription = fieldLabel },
                decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp), contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) {
                            Text(
                                placeholder,
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = size),
                                color = hint,
                                maxLines = 1,
                            )
                        }
                        inner()
                    }
                },
            )
            if (value.isNotEmpty()) {
                IconButton(
                    onClick = {
                        onValueChange("")
                        requester.requestFocus()
                    },
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = clearLabel,
                        tint = hint,
                        modifier = Modifier.size(IconSize.Default),
                    )
                }
            }
        }
    }
}
