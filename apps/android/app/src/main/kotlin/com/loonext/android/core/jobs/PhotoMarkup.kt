package com.loonext.android.core.jobs

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * #294 — an arrow and a circle on a photo.
 *
 * The hand-port of `packages/shared/src/photo-markup.ts`.
 *
 * The issue's own words: "an arrow and a circle on a photo beats a paragraph
 * explaining where to look, and takes three seconds instead of thirty."
 *
 * ## Why it is drawn into the picture rather than stored beside it
 *
 * D28 says attachments enter through exactly two doors and a task's files are a
 * derived view. An overlay stored as its own object would be a third thing to
 * upload, a third thing to keep in step with the photo, and a third thing that can
 * arrive without it. So the marks are burned into the bytes on the phone, and what
 * reaches the server is an ordinary note attachment that happens to have an arrow on
 * it — subject to every existing rule unchanged, because it is not a special file.
 *
 * The original is not destroyed: it is still in the camera roll. What is replaced is
 * the STAGED copy, before it has been sent anywhere.
 *
 * ## Why there is no colour picker
 *
 * One colour, always, with a light halo behind it. A picker is a decision somebody
 * has to make while standing in a customer's kitchen with wet hands, and the reason
 * pickers exist — red vanishing against brick or rust — is solved better by the halo.
 */
object PhotoMarkup {

    const val ARROW = "arrow"
    const val CIRCLE = "circle"

    /** The two marks. Anything more is a drawing app, which this is not. */
    val TOOLS = listOf(ARROW, CIRCLE)

    fun label(tool: String): String = when (tool) {
        ARROW -> "Arrow"
        CIRCLE -> "Circle"
        else -> tool
    }

    /** The one line of instruction, for somebody who has never opened this. */
    const val HINT = "Drag on the photo, or tap twice, to point at something."

    /**
     * What it says once a first tap has landed.
     *
     * The tap-tap path is WCAG 2.5.7's requirement — every dragging movement needs a
     * single-pointer alternative — and it only works if the person can tell the app
     * is waiting for them rather than that their tap did nothing.
     */
    const val HINT_SECOND_TAP = "Now tap where it should point."

    /** Puts the marks on and closes. */
    const val SAVE = "Done"

    /** Takes the last mark off. One step is what a thumb wants. */
    const val UNDO = "Undo"

    /** The mark: a strong red that reads as deliberate rather than decorative. */
    const val INK = 0xFFE23D28.toInt()

    /**
     * The halo drawn under it. White, and wider than the ink — this is what makes
     * one fixed colour work on every photograph a trade takes.
     */
    const val HALO = 0xFFFFFFFF.toInt()

    /** The halo is drawn first, at this multiple of the ink's width. */
    const val HALO_SCALE = 2.2f

    private const val MIN_STROKE = 3
    private const val MAX_STROKE = 18

    /**
     * How thick to draw, for an image of this size.
     *
     * Proportional: a 3-pixel line on a 4000-pixel photo is invisible at the size
     * anybody views it, and a 30-pixel line on a 600-pixel crop covers the thing it
     * points at. Clamped at both ends.
     */
    fun strokeWidth(width: Int, height: Int): Int {
        val shortest = min(abs(width), abs(height))
        if (shortest <= 0) return MIN_STROKE
        return max(MIN_STROKE, min(MAX_STROKE, (shortest * 0.006f).roundToInt()))
    }

    /**
     * The two barbs of an arrowhead at [to], for a shaft coming from [from].
     *
     * The head is a fixed fraction of the shaft with a floor and a ceiling, so a
     * short jab still gets a visible head and a long drag does not grow a comical
     * one.
     */
    fun arrowHead(
        from: MarkupPoint,
        to: MarkupPoint,
        stroke: Float,
    ): Pair<MarkupPoint, MarkupPoint> {
        val dx = to.x - from.x
        val dy = to.y - from.y
        val length = hypot(dx, dy)
        // A zero-length drag has no direction to point in. Returning the tip twice
        // draws nothing rather than dividing by zero and drawing NaN.
        if (length == 0f) return to to to

        val angle = atan2(dy, dx)
        val head = max(stroke * 3f, min(length * 0.32f, stroke * 9f))
        // 28 degrees either side.
        val spread = 0.49f
        return MarkupPoint(
            x = to.x - head * cos(angle - spread),
            y = to.y - head * sin(angle - spread),
        ) to MarkupPoint(
            x = to.x - head * cos(angle + spread),
            y = to.y - head * sin(angle + spread),
        )
    }

    /** The ellipse a circle mark occupies, from the two corners of the drag. */
    fun circleFromDrag(from: MarkupPoint, to: MarkupPoint): MarkupEllipse = MarkupEllipse(
        cx = (from.x + to.x) / 2f,
        cy = (from.y + to.y) / 2f,
        rx = abs(to.x - from.x) / 2f,
        ry = abs(to.y - from.y) / 2f,
    )

    /**
     * Is this drag big enough to have been meant?
     *
     * A tap while looking at a photo should not leave a dot on a customer's job
     * record. Measured against the image rather than in absolute pixels, so the same
     * flick means the same thing on a phone photo and a DSLR one.
     */
    fun isDeliberateDrag(
        from: MarkupPoint,
        to: MarkupPoint,
        width: Int,
        height: Int,
    ): Boolean {
        val shortest = min(abs(width), abs(height))
        if (shortest <= 0) return false
        return hypot(to.x - from.x, to.y - from.y) >= shortest * 0.03f
    }

    /** What the file is called once it has marks on it. */
    fun markedUpFileName(original: String): String {
        val trimmed = original.trim()
        if (trimmed.isEmpty()) return "marked-up.jpg"
        // Always .jpg: the phone re-encodes to JPEG, so keeping a .png extension on
        // JPEG bytes would be a lie the type check downstream would then catch.
        val stem = trimmed.replace(Regex("""\.[^./\\]+$"""), "")
        return if (stem.isEmpty()) "photo-marked.jpg" else "$stem-marked.jpg"
    }
}

/** A point in image pixels, not screen pixels. */
data class MarkupPoint(val x: Float, val y: Float)

/** Centre and radii, which is what every drawing API here actually wants. */
data class MarkupEllipse(val cx: Float, val cy: Float, val rx: Float, val ry: Float)

/** One mark on a photo. */
data class PhotoMark(val tool: String, val from: MarkupPoint, val to: MarkupPoint)
