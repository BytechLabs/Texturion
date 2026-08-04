package com.loonext.android.features.attachments

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.loonext.android.features.compose.isAllowedImageType
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * #240 — the bounded preview this phone generates beside the original.
 *
 * A note attachment is capped at 25 MB and ten per note (D19 §2.4), and the
 * thread re-fetched every one of them on every scroll, for every member of the
 * crew, against a fixed 200 GB egress allowance (D34) — and on the tech's own
 * mobile data (#289). The image on screen is a few hundred pixels wide.
 *
 * The phone that is uploading is the one place in the system where a resize
 * costs nothing: it has just decoded this image to show it in the staging
 * strip. It also shrinks the UPLOAD, which is the half of #289 nothing else was
 * going to fix — a tech sending five job photos over LTE.
 *
 * BEST-EFFORT, ALWAYS. Every failure path returns null and the original uploads
 * alone, which is exactly what happened before this shipped. A corrupt file, a
 * format this build's decoder does not know, an OOM on a 100-megapixel
 * panorama — none of those are worth costing somebody the photo they were
 * trying to send from a job site.
 *
 * Hand-ported from packages/shared/src/attachment-preview.ts and
 * apps/web/src/lib/attachments/preview.ts. The numbers live in shared so this,
 * the other two clients and the Worker that refuses a bad one all agree.
 */
object AttachmentPreview {

    /** Longest edge of a preview, in pixels. Mirrors PREVIEW_MAX_EDGE. */
    const val MAX_EDGE = 1600

    /** JPEG quality, 0..100. Mirrors PREVIEW_JPEG_QUALITY (0.72). */
    const val JPEG_QUALITY = 72

    /** Below this an original is already its own preview. */
    const val WORTH_IT_BYTES = 512L * 1024

    /** Hard ceiling, whatever the original weighs. The server refuses more. */
    const val MAX_PREVIEW_BYTES = 400L * 1024

    /** A preview must be at most this fraction of its original. */
    const val MAX_PREVIEW_FRACTION = 0.5

    /** The file name a generated preview carries. Cosmetic — the server keys it. */
    const val FILE_NAME = "preview.jpg"

    /**
     * Is a derivative worth having for this file at all?
     *
     * Images only, and only images this product accepts: a "preview" is a
     * second way into the same bucket, so it must not be a way around the
     * upload allow-list (`image/svg+xml` is denied there because an SVG is an
     * active document).
     */
    fun worthHaving(contentType: String, sizeBytes: Long): Boolean =
        isAllowedImageType(contentType.trim().lowercase()) && sizeBytes > WORTH_IT_BYTES

    /**
     * The preview's pixel dimensions for an original of [width] x [height].
     *
     * Never scales up, and never rounds an edge to zero — a panorama 8000 x 12
     * would otherwise produce a zero-height bitmap, which throws.
     */
    fun dimensions(width: Int, height: Int): Pair<Int, Int> {
        if (width <= 0 || height <= 0) return 1 to 1
        val scale = minOf(1.0, MAX_EDGE.toDouble() / max(width, height))
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }

    /**
     * The `inSampleSize` to decode with: the largest power of two that still
     * leaves both edges at or above the target.
     *
     * This is the whole reason a 25 MB photo can be resized on a phone at all.
     * Decoding it at full size is ~100 MB of bitmap and an OOM on a cheap
     * device; `inSampleSize` makes the DECODER do the first, coarse reduction
     * so the bitmap that reaches memory is already small. The exact size is
     * then reached by one scale step, because inSampleSize only halves.
     */
    fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        while (width / (sample * 2) >= MAX_EDGE || height / (sample * 2) >= MAX_EDGE) {
            sample *= 2
        }
        return sample
    }

    /**
     * Is a generated preview actually worth sending?
     *
     * The same two rules the server enforces, asked before the upload. A
     * re-encode can genuinely come out bigger than its source — an
     * already-optimised small JPEG re-encoded at a fixed quality is the
     * ordinary case — and the right answer there is to send the original alone
     * rather than earn a 422.
     */
    fun isUseful(previewBytes: Long, originalBytes: Long): Boolean =
        previewBytes > 0 &&
            previewBytes <= MAX_PREVIEW_BYTES &&
            previewBytes <= originalBytes * MAX_PREVIEW_FRACTION

    /**
     * A downscaled JPEG of [bytes], or null when one is not worth making, not
     * possible, or not worth sending.
     *
     * Runs on whatever thread the caller is on — the upload paths are already
     * inside a coroutine on IO, which is where a decode belongs.
     */
    fun make(contentType: String, bytes: ByteArray): ByteArray? {
        if (!worthHaving(contentType, bytes.size.toLong())) return null
        return try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

            val options = BitmapFactory.Options().apply {
                inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
            }
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                ?: return null
            val (targetWidth, targetHeight) = dimensions(decoded.width, decoded.height)
            val scaled = if (decoded.width == targetWidth && decoded.height == targetHeight) {
                decoded
            } else {
                Bitmap.createScaledBitmap(decoded, targetWidth, targetHeight, true)
            }

            val out = ByteArrayOutputStream()
            val ok = scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            if (scaled !== decoded) scaled.recycle()
            decoded.recycle()
            if (!ok) return null

            val preview = out.toByteArray()
            if (!isUseful(preview.size.toLong(), bytes.size.toLong())) null else preview
        } catch (_: OutOfMemoryError) {
            // A 100-megapixel panorama on a cheap phone. The original still
            // uploads; nobody loses the photo over a thumbnail.
            null
        } catch (_: Exception) {
            null
        }
    }
}
