package com.loonext.android.ui.common

import android.content.ClipData
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextOverflow
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
    overflow: TextOverflow = TextOverflow.Clip,
) {
    val clickableModifier = if (number.isNullOrBlank()) {
        modifier
    } else {
        val action = t("contactsTasks.copyNumber")
        modifier.clickable(role = Role.Button, onClickLabel = action, onClick = phoneNumberCopyAction(number, action))
    }
    Text(label, modifier = clickableModifier, style = style, color = color, maxLines = maxLines, overflow = overflow)
}

@Composable
fun CopyPhoneNumberButton(number: String) {
    val label = t("contactsTasks.copyNumber")
    IconButton(onClick = phoneNumberCopyAction(number, label)) {
        Icon(Icons.Outlined.ContentCopy, contentDescription = label)
    }
}

@Composable
fun phoneNumberCopyAction(number: String, label: String): () -> Unit {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    return {
        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(label, number))) }
    }
}
