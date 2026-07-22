package com.loonext.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.net.ApiException
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** A load-once screen state (first load only — realtime updates patch data). */
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val value: T) : LoadState<T>
    data class Failed(val message: String, val code: String? = null) : LoadState<Nothing>
}

fun Throwable.userMessage(): String =
    (this as? ApiException)?.message ?: "Something went wrong."

/** Centered expressive loading indicator — first load only, never spinners over data. */
@Composable
fun CenteredLoading(modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        LoadingIndicator()
    }
}

/** Calm inline error: one sentence what happened + retry. */
@Composable
fun CenteredError(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
            Button(onClick = onRetry, modifier = Modifier.padding(top = 16.dp)) {
                Text("Try again")
            }
        }
    }
}

/** Flat single-tone avatar: avatar-tint fill, SemiBold initials (G11). */
@Composable
fun InitialsAvatar(name: String?, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    val initials = initialsOf(name)
    Box(
        modifier = modifier
            .size(size)
            .background(
                MaterialTheme.colorScheme.secondaryContainer,
                RoundedCornerShape(percent = 50),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials,
            style = MaterialTheme.typography.labelLarge.copy(
                fontSize = (size.value / 3).sp,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

fun initialsOf(name: String?): String {
    val trimmed = name?.trim().orEmpty()
    if (trimmed.isEmpty()) return "#"
    val parts = trimmed.split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        parts.size >= 2 -> "${parts.first().first()}${parts.last().first()}".uppercase()
        else -> trimmed.take(2).uppercase()
    }
}

/** '(415) 555-0134' for +1 NANP numbers, raw otherwise. */
fun formatPhone(e164: String?): String {
    if (e164 == null) return ""
    val m = Regex("^\\+1(\\d{3})(\\d{3})(\\d{4})$").find(e164) ?: return e164
    val (npa, nxx, line) = m.destructured
    return "($npa) $nxx-$line"
}

private val absoluteFormat = DateTimeFormatter.ofPattern("MMM d, yyyy h:mm a")

/** Relative timestamp mirroring the web ('now', '5m', '3h', 'Jul 8', 'Jul 8 2025'). */
fun relativeTime(iso: String, now: Instant = Instant.now()): String {
    val instant = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
    val duration = Duration.between(instant, now)
    val zoned = instant.atZone(ZoneId.systemDefault())
    return when {
        duration.toMinutes() < 1 -> "now"
        duration.toMinutes() < 60 -> "${duration.toMinutes()}m"
        duration.toHours() < 24 -> "${duration.toHours()}h"
        duration.toDays() < 7 -> "${duration.toDays()}d"
        zoned.year == now.atZone(ZoneId.systemDefault()).year ->
            zoned.format(DateTimeFormatter.ofPattern("MMM d"))

        else -> zoned.format(DateTimeFormatter.ofPattern("MMM d yyyy"))
    }
}

fun absoluteTime(iso: String): String {
    val instant = runCatching { Instant.parse(iso) }.getOrNull() ?: return iso
    return instant.atZone(ZoneId.systemDefault()).format(absoluteFormat)
}
