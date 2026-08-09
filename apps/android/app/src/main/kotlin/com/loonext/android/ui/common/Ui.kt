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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.loonext.android.core.net.ApiDecodeException
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

/**
 * The sentence a screen shows when a load or a save failed.
 *
 * #555 — "This page shows up in a lot of countless places... Needs a better
 * system or observability or something idk."
 *
 * THE SERVER'S OWN MESSAGE comes first and verbatim, as it always did: those are
 * written to be read.
 *
 * A DECODE FAILURE NOW SAYS SOMETHING DIFFERENT, because it is a different thing.
 * It means we could not read what the server sent — our bug, not the customer's,
 * and one that "try again" cannot fix, because the same response will fail the
 * same way. Telling somebody to retry a permanent failure is the specific
 * dishonesty this replaces. The reason itself is never shown: "Response for
 * /v1/conversations/abc did not match the client model" is a sentence for us, and
 * it is recorded where we can reach it (see ApiClient.decodeBody) rather than
 * printed at a customer.
 *
 * An app update is named because it is the one action that genuinely might help —
 * a server ahead of this build is the commonest cause — and it is named as a
 * possibility rather than a promise. The Diagnostics screen is deliberately NOT
 * mentioned: it is hidden until unlocked, so pointing anybody at it would be
 * directions to a door they cannot see.
 */
fun Throwable.userMessage(): String = when {
    // #555: a 500 carries the server's own reference, and saying it is what makes
    // "something went wrong" a report somebody can act on rather than a shrug.
    // Only on an internal error: a 422 explaining which field is wrong needs no
    // reference, and appending one to every refusal would be noise on the copy
    // that is already doing its job.
    this is ApiException && requestId != null && httpStatus >= 500 ->
        "$message Reference $requestId."
    this is ApiException -> message
    this is ApiDecodeException ->
        "This didn't load. It's a problem on our side, not something you did. " +
            "If there's an app update, that usually fixes it."
    else -> "Something went wrong."
}

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

/**
 * Flat single-tone avatar: avatar-tint fill, SemiBold initials (G11).
 *
 * ## #569 — the initials stop growing before they leave the circle
 *
 * The box is a fixed `Dp` and the glyph is `sp`, which carries the reader's OS font
 * setting. So at large text the letters outgrew the circle and clipped. Measured off
 * the shipped Golos Text face, two initials run about 1.6x the font size wide — and
 * a pair like "WM" about 1.86x — so a 30dp circle held roughly 31dp of ink at the
 * top of the system slider.
 *
 * ## Why the glyph is capped rather than the circle grown
 *
 * Growing the circle was the obvious fix and it is the wrong one, for three measured
 * reasons:
 *
 *  1. The overflow is HORIZONTAL. Vertically there was never a spill — the style's
 *     `lineHeight` stays 20.sp, which is 34dp at the top of the slider and fits
 *     every box from 38dp up. Growing the box treats a width problem with height.
 *  2. It costs room the crowded surfaces do not have. On a 360dp phone the thread
 *     header has 280dp for its children; at the largest text with an urgent badge
 *     showing, the identity column is already squeezed to nothing. Growing the
 *     avatar there takes the overflow menu to zero — trading clipped initials for an
 *     unreachable menu.
 *  3. An avatar is a recognition mark, not text to read. The NAME beside it scales
 *     in full, which is what a reader who asked for large text actually needs; two
 *     letters in a badge are there to be recognised at a glance.
 *
 * So the glyph follows the reader's setting until two wide initials would touch the
 * rim, and then holds. At the default setting nothing moves at all — the cap only
 * begins to bite around 1.4x — and no layout anywhere changes at any setting.
 *
 * `check-native-a11y` passes this, and it is worth being straight about why: that
 * guard checks text is sized in `sp` rather than `dp`, which this still is. It does
 * not and cannot judge whether a layout survives 200%, and it says so in its own
 * header. The bound here is a deliberate exception for a two-character badge, not a
 * mechanism the guard endorses.
 *
 * @param shape defaults to a circle; the square-ish avatars in the lists pass their
 *   own corner radius so one component can serve every surface (#569 found nine
 *   hand-rolled copies of this, each with the same unbounded-glyph bug).
 * @param glyph the size the initials WANT, before the cap. Defaults to the historic
 *   `size / 3` so every existing call renders identically; the converted copies pass
 *   the literal they had, so nothing shifts by a pixel at the default font setting.
 */
@Composable
fun InitialsAvatar(
    name: String?,
    size: Dp = 40.dp,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(percent = 50),
    glyph: TextUnit = (size.value / 3).sp,
) {
    val initials = initialsOf(name)
    val density = LocalDensity.current
    // The largest glyph two wide initials can use and still clear the rim: 1.86x the
    // font size for the widest pair, inside about 92% of the box.
    val ceiling = size.value / 2.1f
    val wanted = with(density) { glyph.toDp().value }
    val rendered = with(density) { minOf(wanted, ceiling).dp.toSp() }
    Box(
        modifier = modifier
            .size(size)
            .background(MaterialTheme.colorScheme.secondaryContainer, shape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials,
            style = MaterialTheme.typography.labelLarge.copy(
                fontSize = rendered,
                // Bounded with the glyph. The inherited 20.sp was the one thing that
                // could still spill out of the smaller avatars (28-32dp) at the top
                // of the slider.
                lineHeight = rendered * 1.25f,
                fontWeight = FontWeight.SemiBold,
            ),
            // Two initials are one word. Without this, Compose broke mid-word once
            // the pair no longer fitted and clipped the second letter — which is how
            // the inbox row failed rather than by overflowing.
            maxLines = 1,
            softWrap = false,
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
