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
import androidx.compose.ui.graphics.Color
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
 * @param container the badge fill, and [content] the initials on top of it. They are
 *   a pair — pass both or neither. Most surfaces want the avatar tint, but the
 *   notification row tints by event type, the contact hero sits on a raised surface,
 *   and the two account headers sit on `primary` and inherit their content colour.
 *   Those differences are why nine copies existed; a colour is not a reason to
 *   rewrite the geometry.
 */
@Composable
fun InitialsAvatar(
    name: String?,
    size: Dp = 40.dp,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(percent = 50),
    glyph: TextUnit = (size.value / 3).sp,
    container: Color = MaterialTheme.colorScheme.secondaryContainer,
    content: Color = MaterialTheme.colorScheme.onSecondaryContainer,
) {
    Box(
        modifier = modifier
            .size(size)
            .background(container, shape),
        contentAlignment = Alignment.Center,
    ) {
        val rendered = boundedGlyph(size, glyph)
        Text(
            initialsOf(name),
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
            color = content,
        )
    }
}

/**
 * The #569 bound on its own, for the one avatar that cannot be [InitialsAvatar].
 *
 * `CallerAvatar` paints a pulsing, rotating ring behind its initials with a
 * `drawBehind`, so it owns its own `Box` and cannot delegate to the component. It can
 * still delegate the RULE, which is the part that was wrong in nine places. Anything
 * drawing initials must either call [InitialsAvatar] or size its glyph through here —
 * `scripts/check-avatar-glyph-bounds.mjs` enforces exactly that and nothing else.
 *
 * Returns the smaller of what the caller asked for and what two wide initials can use
 * without touching the rim (1.86x the font size for the widest pair, inside about 92%
 * of the box). `sp` carries the reader's OS font setting and `dp` does not, so the
 * comparison has to happen in `dp` at the current density — which is why this is a
 * `@Composable` and not a pure function.
 */
@Composable
fun boundedGlyph(size: Dp, glyph: TextUnit): TextUnit {
    val density = LocalDensity.current
    val ceiling = size.value / 2.1f
    val wanted = with(density) { glyph.toDp().value }
    return with(density) { minOf(wanted, ceiling).dp.toSp() }
}

/**
 * #582 — the two letters in an avatar. The hand-port of
 * `packages/shared/src/avatar-initials.ts`; `AvatarInitialsParityTest` holds this to
 * that file, so change them together or the test says so.
 *
 * This used to take the first CHARACTER of the first and last word, whatever it was.
 * An unnamed contact displays as its formatted number, so the badge was handed
 * `(415) 555-0134` and wore `(5` — on the contacts list and the thread header, which
 * is the busiest screen in the app.
 *
 * Code points, not code units and not grapheme clusters. See the shared module for
 * why: three implementations each "correct" against a different Unicode table is how
 * this drifts apart again.
 */
fun initialsOf(name: String?): String {
    val trimmed = name?.trim().orEmpty()
    if (trimmed.isEmpty()) return "?"
    // No letter anywhere means this is not a name — it is the number we show instead
    // of one, and `(5` is not initials.
    if (trimmed.codePoints().noneMatch { Character.isLetter(it) }) return "#"

    val words = trimmed.split(Regex("\\s+")).filter { word ->
        word.codePoints().anyMatch { isGlyph(it) }
    }
    if (words.isEmpty()) return "?"
    if (words.size == 1) {
        return words[0].codePoints()
            .filter { isGlyph(it) }
            .limit(2)
            .toArray()
            .let { String(it, 0, it.size) }
            .uppercase()
    }
    return (firstGlyph(words.first()) + firstGlyph(words.last())).uppercase()
}

/** A character worth showing: a letter or a digit, never punctuation. */
private fun isGlyph(codePoint: Int): Boolean =
    Character.isLetter(codePoint) || Character.isDigit(codePoint)

/** The first letter-or-digit in a word, or "" if it has none. */
private fun firstGlyph(word: String): String {
    val found = word.codePoints().filter { isGlyph(it) }.findFirst()
    return if (found.isPresent) String(Character.toChars(found.asInt)) else ""
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
