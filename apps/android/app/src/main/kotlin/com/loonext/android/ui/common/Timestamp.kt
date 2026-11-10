package com.loonext.android.ui.common

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.time.TimestampFormat
import kotlinx.coroutines.delay

private const val EXACT_TIME_SHOWN_MS = 3_000L

/**
 * #720: a date or time a person reads. The visible label is the short one from
 * [TimestampFormat]; a long-press shows the exact time with its zone, and a
 * screen reader hears the label followed by that exact time.
 *
 * The long-press watches the touch without consuming a tap, so a row that
 * opens on tap still opens when the time is what was touched. It adds no click
 * action to the semantics: TalkBack already reads the exact time from the
 * content description.
 *
 * [relativeTime] stays for a moment woven into a sentence ("Released Sat"),
 * where there is no text of its own to press.
 */
@Composable
fun Timestamp(
    iso: String?,
    modifier: Modifier = Modifier,
    style: TimestampFormat.Style = TimestampFormat.Style.SHORT,
    textStyle: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified,
    maxLines: Int = Int.MAX_VALUE,
    softWrap: Boolean = true,
    overflow: TextOverflow = TextOverflow.Clip,
    /**
     * #712: false where the row around it opens a record menu on long-press. That menu
     * leads with the exact time instead, so one press never means two things.
     */
    pressable: Boolean = true,
) {
    val locale = LocalAppLocale.current
    val label = TimestampFormat.label(iso, style, locale)
    if (label.isEmpty()) return
    val exact = TimestampFormat.exact(iso, locale)
    val spoken = TimestampFormat.spoken(iso, locale)
    ExactTimePress(exact, modifier, pressable = pressable) {
        Text(
            label,
            style = textStyle,
            color = color,
            fontSize = fontSize,
            maxLines = maxLines,
            softWrap = softWrap,
            overflow = overflow,
            modifier = Modifier.clearAndSetSemantics { contentDescription = spoken },
        )
    }
}

/** Shows [exact] in a small popup while the wrapped content is long-pressed. */
@Composable
fun ExactTimePress(
    exact: String,
    modifier: Modifier = Modifier,
    pressable: Boolean = true,
    content: @Composable () -> Unit,
) {
    var shown by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    Box(
        if (!pressable) {
            modifier
        } else {
            modifier.pointerInput(exact) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val pressed = awaitLongPressOrCancellation(down.id)
                    if (pressed != null) {
                        pressed.consume()
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        shown = true
                    }
                }
            }
        },
    ) {
        content()
        if (shown) {
            LaunchedEffect(Unit) {
                delay(EXACT_TIME_SHOWN_MS)
                shown = false
            }
            Popup(alignment = Alignment.TopEnd, onDismissRequest = { shown = false }) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.inverseSurface,
                    contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                    shadowElevation = 4.dp,
                    modifier = Modifier.padding(vertical = 4.dp),
                ) {
                    Text(
                        exact,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }
}
