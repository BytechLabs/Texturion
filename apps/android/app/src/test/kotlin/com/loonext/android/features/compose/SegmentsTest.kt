package com.loonext.android.features.compose

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Port of EVERY vector in packages/shared/src/segments.test.ts — the estimator
 * must agree with the server byte-for-byte.
 */
class SegmentsTest {

    private fun assertEstimate(
        text: String,
        encoding: String,
        segments: Int,
        unitsUsed: Int,
        unitsPerSegment: Int,
    ) {
        val actual = estimateSegments(text)
        assertEquals("encoding", encoding, actual.encoding)
        assertEquals("segments", segments, actual.segments)
        assertEquals("unitsUsed", unitsUsed, actual.unitsUsed)
        assertEquals("unitsPerSegment", unitsPerSegment, actual.unitsPerSegment)
    }

    // --- GSM-7 basic ---

    @Test
    fun `empty string is zero segments`() {
        assertEstimate("", SmsEncoding.GSM7, 0, 0, GSM7_SINGLE_SEGMENT_UNITS)
    }

    @Test
    fun `exactly 160 GSM-7 chars fit one segment`() {
        assertEstimate("a".repeat(160), SmsEncoding.GSM7, 1, 160, 160)
    }

    @Test
    fun `161 GSM-7 chars concatenate to 2 segments of 153`() {
        assertEstimate("a".repeat(161), SmsEncoding.GSM7, 2, 161, GSM7_CONCAT_SEGMENT_UNITS)
    }

    @Test
    fun `153-boundary math`() {
        assertEquals(2, estimateSegments("a".repeat(306)).segments)
        assertEquals(3, estimateSegments("a".repeat(307)).segments)
        assertEquals(3, estimateSegments("a".repeat(459)).segments)
        assertEquals(4, estimateSegments("a".repeat(460)).segments)
    }

    @Test
    fun `e-acute is GSM-7 basic (1 septet)`() {
        assertEstimate("é", SmsEncoding.GSM7, 1, 1, 160)
        assertEquals(1, estimateSegments("é".repeat(160)).segments)
    }

    @Test
    fun `c-cedilla is GSM-7 basic (1 septet) per GSM0338 0x09`() {
        assertEstimate("ç", SmsEncoding.GSM7, 1, 1, 160)
    }

    @Test
    fun `newline and other low basic chars are 1 septet`() {
        assertEstimate("a\nb", SmsEncoding.GSM7, 1, 3, 160)
    }

    // --- GSM-7 extension table ---

    @Test
    fun `euro is GSM-7 but costs 2 septets`() {
        assertEstimate("€", SmsEncoding.GSM7, 1, 2, 160)
    }

    @Test
    fun `all extension chars cost 2`() {
        assertEstimate("€".repeat(80), SmsEncoding.GSM7, 1, 160, 160)
        assertEquals(2, estimateSegments("€".repeat(81)).segments)
        assertEstimate("[~]{}\\^|€\u000C", SmsEncoding.GSM7, 1, 20, 160)
    }

    @Test
    fun `mixed basic plus extension counts septets exactly`() {
        val text = "Price: $5 [deal] ~50% off €"
        assertEstimate(text, SmsEncoding.GSM7, 1, text.length + 4, 160)
    }

    @Test
    fun `an ESC pair never straddles a 153-septet boundary`() {
        val text = "a".repeat(152) + "€" + "a".repeat(152)
        assertEstimate(text, SmsEncoding.GSM7, 3, 306, 153)
        assertEquals(
            2,
            estimateSegments("a".repeat(151) + "€" + "a".repeat(153)).segments,
        )
    }

    // --- UCS-2 fallback ---

    @Test
    fun `a single emoji forces UCS-2 and counts 2 UTF-16 units`() {
        assertEstimate("😀", SmsEncoding.UCS2, 1, 2, UCS2_SINGLE_SEGMENT_UNITS)
    }

    @Test
    fun `one non-GSM char switches the whole message to UCS-2`() {
        val text = "a".repeat(159) + "😀"
        assertEstimate(text, SmsEncoding.UCS2, 3, 161, UCS2_CONCAT_SEGMENT_UNITS)
    }

    @Test
    fun `70-71 boundary`() {
        assertEstimate("中".repeat(70), SmsEncoding.UCS2, 1, 70, 70)
        assertEstimate("中".repeat(71), SmsEncoding.UCS2, 2, 71, 67)
    }

    @Test
    fun `67-boundary math`() {
        assertEquals(2, estimateSegments("中".repeat(134)).segments)
        assertEquals(3, estimateSegments("中".repeat(135)).segments)
    }

    @Test
    fun `a surrogate pair never straddles a 67-unit boundary`() {
        val text = "中".repeat(66) + "😀" + "中".repeat(66)
        assertEstimate(text, SmsEncoding.UCS2, 3, 134, 67)
        assertEquals(
            2,
            estimateSegments("中".repeat(65) + "😀" + "中".repeat(67)).segments,
        )
    }

    @Test
    fun `uppercase C-cedilla is outside GSM0338 basic and forces UCS-2`() {
        assertEquals(SmsEncoding.UCS2, estimateSegments("Ça va").encoding)
    }

    @Test
    fun `mixed real-world content with one emoji`() {
        assertEstimate("On our way! ETA 4:30 😀", SmsEncoding.UCS2, 1, 23, 70)
    }

    // --- Composer meter semantics ---

    @Test
    fun `meter hidden at 1 segment, passive at 2, amber at 4`() {
        assertFalse(segmentMeter("hi").visible)
        val two = segmentMeter("a".repeat(200))
        assertTrue(two.visible)
        assertEquals(2, two.segments)
        assertEquals("Sent in 2 parts", two.label)
        assertFalse(two.warn)
        val four = segmentMeter("a".repeat(500))
        assertTrue(four.warn)
    }

    @Test
    fun `MMS meters a flat 3 parts regardless of body`() {
        val meter = segmentMeter("short", hasMedia = true)
        assertTrue(meter.visible)
        assertEquals(MMS_SEGMENTS, meter.segments)
        assertFalse(meter.warn)
    }
}
