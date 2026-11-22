package com.loonext.android.ui.common

import android.content.ClipData
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
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
    Text(label, modifier = modifier.copyPhoneNumberOnHold(number), style = style, color = color, maxLines = maxLines, overflow = overflow)
}

@Composable
fun Modifier.copyPhoneNumberOnHold(number: String?, onClick: (() -> Unit)? = null): Modifier {
    if (number.isNullOrBlank()) return this
    val label = t("contactsTasks.copyNumber")
    val copy by rememberUpdatedState(phoneNumberCopyAction(number, label))
    if (onClick != null) {
        return combinedClickable(onClick = onClick, onLongClickLabel = label, onLongClick = { copy() })
    }
    return touchTarget()
        .pointerInput(number) { detectTapGestures(onLongPress = { copy() }) }
        .semantics {
            onLongClick(label) {
                copy()
                true
            }
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
