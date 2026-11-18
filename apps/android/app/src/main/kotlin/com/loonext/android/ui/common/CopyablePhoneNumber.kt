package com.loonext.android.ui.common

import android.content.ClipData
import androidx.compose.foundation.clickable
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import com.loonext.android.core.i18n.t
import kotlinx.coroutines.launch

@Composable
fun CopyablePhoneNumber(
    number: String?,
    modifier: Modifier = Modifier,
    label: String = formatPhone(number),
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
) {
    val clickableModifier = if (number.isNullOrBlank()) {
        modifier
    } else {
        val clipboard = LocalClipboard.current
        val scope = rememberCoroutineScope()
        val action = t("contactsTasks.copyNumber")
        modifier.clickable(role = Role.Button, onClickLabel = action) {
            scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(action, number))) }
        }
    }
    Text(label, modifier = clickableModifier, style = style, color = color, maxLines = maxLines)
}
