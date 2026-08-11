package com.loonext.android.features.compose

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.jobs.MarkupPoint
import com.loonext.android.core.jobs.PhotoMark
import com.loonext.android.core.jobs.PhotoMarkup
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * #294 — draw on a photo before it goes.
 *
 * ## Evaluation
 *
 * "An arrow and a circle on a photo beats a paragraph explaining where to look, and
 * takes three seconds instead of thirty." The whole value is in those three seconds,
 * so every decision here is about not spending them.
 *
 * ## What binds it
 *
 * *Zen of Clarity* — two tools, one colour, one undo. No layers, no freehand, no
 * picker. A drawing app is a different product, and every control here is one more
 * thing to skip past while standing in somebody's kitchen.
 *
 * *Smart Defaults* — Arrow is selected on open, because pointing at something is what
 * nine out of ten of these are. The fixed colour is red with a white halo, legible on
 * brick, on rust and on a white bathroom wall — the problem a picker exists to solve,
 * solved without asking.
 *
 * *WCAG 2.5.7* — a drag is the fast gesture, and tap-then-tap does the same job for
 * anybody whose hand shakes or whose touch never registers as a drag.
 *
 * ## Why it edits the staged copy
 *
 * D28 keeps two doors into the system, so an annotated photo must be an ordinary note
 * attachment rather than a new kind of thing. The marks are burned into the bytes and
 * the staged file is replaced. Nothing is destroyed: the original is still in the
 * camera roll, and this copy has not been sent anywhere.
 */
@Composable
fun PhotoMarkupSheet(
    /** The staged photo's bytes, or null when nothing is being marked up. */
    bytes: ByteArray?,
    onCancel: () -> Unit,
    /** JPEG bytes with the marks burned in. */
    onDone: (ByteArray) -> Unit,
) {
    if (bytes == null) return

    val source = remember(bytes) {
        runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
    }
    if (source == null) {
        // A photo the phone cannot decode is a photo it cannot mark up. Saying so
        // and closing beats an empty canvas that looks broken.
        LaunchedEffect(bytes) { onCancel() }
        return
    }

    var tool by remember { mutableStateOf(PhotoMarkup.ARROW) }
    var marks by remember(bytes) { mutableStateOf(listOf<PhotoMark>()) }
    var dragging by remember(bytes) { mutableStateOf<PhotoMark?>(null) }
    /** WCAG 2.5.7: the first of two taps, when a drag is not available. */
    var anchor by remember(bytes) { mutableStateOf<MarkupPoint?>(null) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var saving by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()

    /** Screen point → image pixels. The bitmap is displayed scaled to fit. */
    fun toImage(x: Float, y: Float): MarkupPoint {
        if (canvasSize.width == 0 || canvasSize.height == 0) return MarkupPoint(x, y)
        return MarkupPoint(
            x = x / canvasSize.width * source.width,
            y = y / canvasSize.height * source.height,
        )
    }

    val preview = remember(source, marks, dragging, anchor) {
        val pending = when {
            dragging != null -> listOf(dragging!!)
            anchor != null -> listOf(PhotoMark(tool, anchor!!, anchor!!))
            else -> emptyList()
        }
        renderMarks(source, marks + pending)
    }

    AlertDialog(
        onDismissRequest = { if (!saving) onCancel() },
        title = { Text(t("thread.markupTitle")) },
        text = {
            Column {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .onSizeChanged { canvasSize = it }
                        .pointerInput(bytes, tool) {
                            detectDragGestures(
                                onDragStart = { offset ->
                                    val start = toImage(offset.x, offset.y)
                                    dragging = PhotoMark(tool, start, start)
                                },
                                onDrag = { change, _ ->
                                    val current = dragging ?: return@detectDragGestures
                                    dragging = current.copy(
                                        to = toImage(change.position.x, change.position.y),
                                    )
                                },
                                onDragEnd = {
                                    val current = dragging ?: return@detectDragGestures
                                    dragging = null
                                    if (
                                        PhotoMarkup.isDeliberateDrag(
                                            current.from,
                                            current.to,
                                            source.width,
                                            source.height,
                                        )
                                    ) {
                                        marks = marks + current
                                        anchor = null
                                    }
                                },
                            )
                        }
                        .pointerInput(bytes, tool) {
                            detectTapGestures { offset ->
                                // WCAG 2.5.7 — the single-pointer path. First tap
                                // anchors, second finishes. Nothing is drawn from a
                                // lone tap, so a stray one cannot leave a dot on a
                                // customer's job record.
                                val point = toImage(offset.x, offset.y)
                                val start = anchor
                                if (start == null) {
                                    anchor = point
                                    return@detectTapGestures
                                }
                                if (
                                    PhotoMarkup.isDeliberateDrag(
                                        start,
                                        point,
                                        source.width,
                                        source.height,
                                    )
                                ) {
                                    marks = marks + PhotoMark(tool, start, point)
                                }
                                anchor = null
                            }
                        },
                ) {
                    Image(
                        bitmap = preview.asImageBitmap(),
                        contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PhotoMarkup.TOOLS.forEach { option ->
                        FilterChip(
                            selected = tool == option,
                            onClick = { tool = option },
                            label = { Text(PhotoMarkup.label(option)) },
                        )
                    }
                    TextButton(
                        onClick = { marks = marks.dropLast(1) },
                        enabled = marks.isNotEmpty(),
                    ) {
                        Text(PhotoMarkup.UNDO)
                    }
                }
                Text(
                    if (anchor == null) PhotoMarkup.HINT else PhotoMarkup.HINT_SECOND_TAP,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    saving = true
                    // Off the main thread: encoding a 12-megapixel photo is enough
                    // work to drop frames on a mid-range phone, and this runs while
                    // the dialog is still on screen.
                    coroutines.launch {
                        onDone(encodeJpeg(preview))
                        saving = false
                    }
                },
                enabled = !saving && marks.isNotEmpty(),
            ) {
                Text(if (saving) t("common.saving") else PhotoMarkup.SAVE)
            }
        },
        dismissButton = {
            TextButton(onClick = onCancel, enabled = !saving) { Text(t("common.cancel")) }
        },
    )
}

/**
 * The photo with the marks drawn into it.
 *
 * Halo first, then ink on top — that order is the whole of the "no colour picker"
 * decision, and it is why one fixed red is legible on any photograph.
 */
internal fun renderMarks(source: Bitmap, marks: List<PhotoMark>): Bitmap {
    val out = source.copy(Bitmap.Config.ARGB_8888, true) ?: source
    if (marks.isEmpty()) return out
    val canvas = Canvas(out)
    val stroke = PhotoMarkup.strokeWidth(out.width, out.height).toFloat()
    for (mark in marks) {
        drawMark(canvas, mark, stroke * PhotoMarkup.HALO_SCALE, PhotoMarkup.HALO)
        drawMark(canvas, mark, stroke, PhotoMarkup.INK)
    }
    return out
}

private fun drawMark(canvas: Canvas, mark: PhotoMark, width: Float, colour: Int) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = width
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = colour
    }

    if (mark.tool == PhotoMarkup.CIRCLE) {
        val ellipse = PhotoMarkup.circleFromDrag(mark.from, mark.to)
        canvas.drawOval(
            RectF(
                ellipse.cx - ellipse.rx,
                ellipse.cy - ellipse.ry,
                ellipse.cx + ellipse.rx,
                ellipse.cy + ellipse.ry,
            ),
            paint,
        )
        return
    }

    canvas.drawLine(mark.from.x, mark.from.y, mark.to.x, mark.to.y, paint)
    val (left, right) = PhotoMarkup.arrowHead(mark.from, mark.to, width)
    val path = Path().apply {
        moveTo(left.x, left.y)
        lineTo(mark.to.x, mark.to.y)
        lineTo(right.x, right.y)
    }
    canvas.drawPath(path, paint)
}

/**
 * JPEG at 90.
 *
 * The marks must stay crisp, and this is a photo somebody will look at closely enough
 * to read a serial number off.
 */
internal suspend fun encodeJpeg(bitmap: Bitmap): ByteArray = withContext(Dispatchers.IO) {
    ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        .toByteArray()
}
