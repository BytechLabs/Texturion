package com.loonext.android.features.attachments

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #240 — the numbers this phone generates against and the Worker refuses on.
 *
 * Vectors shared with packages/shared/src/attachment-preview.test.ts and the
 * Swift port. Two sets of numbers for one contract is how a client ends up
 * producing something the server will not take, and the failure would reach the
 * founder as "photos sometimes don't upload".
 *
 * `make()` itself needs a real Bitmap decoder and is not reachable from a JVM
 * unit test — what is testable, and what actually decides correctness, is the
 * arithmetic around it.
 */
class AttachmentPreviewTest {

    @Test
    fun `wants one for a big image`() {
        assertTrue(AttachmentPreview.worthHaving("image/jpeg", 8L * 1024 * 1024))
        assertTrue(AttachmentPreview.worthHaving("image/png", AttachmentPreview.WORTH_IT_BYTES + 1))
    }

    @Test
    fun `leaves a small image alone`() {
        // Inbound MMS is ≤1 MB per item by carrier limit (D28), and below the
        // threshold a derivative saves a fraction of a fraction.
        assertFalse(AttachmentPreview.worthHaving("image/jpeg", AttachmentPreview.WORTH_IT_BYTES))
        assertFalse(AttachmentPreview.worthHaving("image/jpeg", 40L * 1024))
    }

    @Test
    fun `never wants one for a file that is not an image`() {
        // Nothing about a 20 MB PDF gets smaller by making a picture of its
        // first page — the thread renders a file row, not a picture.
        for (type in listOf("application/pdf", "text/csv", "application/zip")) {
            assertFalse(type, AttachmentPreview.worthHaving(type, 20L * 1024 * 1024))
        }
    }

    @Test
    fun `never wants one for an image type this product refuses`() {
        // A preview is a second way into the same bucket, so it must not be a
        // way around the upload allow-list.
        assertFalse(AttachmentPreview.worthHaving("image/svg+xml", 5L * 1024 * 1024))
        assertFalse(AttachmentPreview.worthHaving("image/tiff", 5L * 1024 * 1024))
    }

    @Test
    fun `ignores case and stray whitespace on the type`() {
        assertTrue(AttachmentPreview.worthHaving("  IMAGE/JPEG ", 5L * 1024 * 1024))
    }

    @Test
    fun `scales the longest edge down to the ceiling, keeping the ratio`() {
        assertEquals(1600 to 1200, AttachmentPreview.dimensions(4000, 3000))
        assertEquals(1200 to 1600, AttachmentPreview.dimensions(3000, 4000))
    }

    @Test
    fun `never scales anything up`() {
        assertEquals(800 to 600, AttachmentPreview.dimensions(800, 600))
    }

    @Test
    fun `keeps a panorama's short edge above zero`() {
        // 8000 x 12 scales the short edge to 2.4px, and Bitmap.createScaledBitmap
        // throws on a zero height. This is the shape that reads as "the app
        // crashes on one guy's photos".
        val (width, height) = AttachmentPreview.dimensions(8000, 12)
        assertEquals(1600, width)
        assertTrue("short edge was $height", height >= 1)
    }

    @Test
    fun `answers something usable for a degenerate size`() {
        for ((w, h) in listOf(0 to 100, 100 to 0, -5 to 100)) {
            val (width, height) = AttachmentPreview.dimensions(w, h)
            assertTrue("${w}x$h", width >= 1 && height >= 1)
        }
    }

    @Test
    fun `picks a sample size that leaves both edges at or above the target`() {
        // The decoder's coarse halving is what makes a 25 MB photo resizable on
        // a phone at all: at full size it is ~100 MB of bitmap and an OOM on a
        // cheap device. Under-sampling would put us back there; over-sampling
        // would hand the scaler an image smaller than the target and produce a
        // soft preview.
        assertEquals(1, AttachmentPreview.sampleSize(2000, 1500))
        assertEquals(2, AttachmentPreview.sampleSize(4000, 3000))
        assertEquals(4, AttachmentPreview.sampleSize(8000, 6000))
        for ((w, h) in listOf(4000 to 3000, 8000 to 6000, 12000 to 400)) {
            val sample = AttachmentPreview.sampleSize(w, h)
            val sampledLongEdge = maxOf(w, h) / sample
            assertTrue(
                "${w}x$h sampled to $sampledLongEdge",
                sampledLongEdge >= AttachmentPreview.MAX_EDGE,
            )
        }
    }

    @Test
    fun `accepts a real downscale and drops what the server would refuse`() {
        val original = 8L * 1024 * 1024
        assertTrue(AttachmentPreview.isUseful(180L * 1024, original))
        // An already-optimised JPEG re-encoded at a fixed quality can come out
        // bigger than its source.
        assertFalse(AttachmentPreview.isUseful(400L * 1024, 300L * 1024))
        assertFalse(
            AttachmentPreview.isUseful(AttachmentPreview.MAX_PREVIEW_BYTES + 1, 25L * 1024 * 1024),
        )
        assertTrue(
            AttachmentPreview.isUseful(AttachmentPreview.MAX_PREVIEW_BYTES, 25L * 1024 * 1024),
        )
        assertFalse(AttachmentPreview.isUseful(0, original))
    }

    @Test
    fun `agrees with the server exactly at the fraction`() {
        // The server refuses strictly above the fraction. A client that
        // disagreed by one byte would produce an upload that fails only for
        // photos of a particular size — the worst kind of bug to be told about.
        val small = 300L * 1024
        val half = (small * AttachmentPreview.MAX_PREVIEW_FRACTION).toLong()
        assertTrue(AttachmentPreview.isUseful(half, small))
        assertFalse(AttachmentPreview.isUseful(half + 1, small))
    }

    @Test
    fun `holds the shared numbers`() {
        // Pinned against packages/shared/src/attachment-preview.ts. These are a
        // hand-port, and a hand-port is exactly where a contract drifts.
        assertEquals(1600, AttachmentPreview.MAX_EDGE)
        assertEquals(72, AttachmentPreview.JPEG_QUALITY)
        assertEquals(512L * 1024, AttachmentPreview.WORTH_IT_BYTES)
        assertEquals(400L * 1024, AttachmentPreview.MAX_PREVIEW_BYTES)
        assertEquals(0.5, AttachmentPreview.MAX_PREVIEW_FRACTION, 0.0001)
    }
}
