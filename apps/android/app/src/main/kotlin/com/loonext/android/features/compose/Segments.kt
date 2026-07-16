package com.loonext.android.features.compose

/**
 * SMS segment estimator — an exact Kotlin port of packages/shared/src/segments.ts
 * (SPEC §2, §9, §10). App-side estimate only; Telnyx's finalized `parts` +
 * `encoding` stay authoritative for billing.
 *
 * Encoding rules per ETSI GSM 03.38 / 3GPP TS 23.038 using the Unicode
 * Consortium's GSM0338.TXT mapping:
 * - GSM-7 basic charset: 1 septet per character (0x09 is ç per that mapping).
 * - GSM-7 extension table (form feed, ^ { } \ [ ~ ] | €): ESC + char = 2 septets.
 * - Any character outside both tables switches the WHOLE message to UCS-2,
 *   counted in UTF-16 code units (a surrogate-pair emoji = 2 units).
 * - Limits: single segment 160 septets / 70 UCS-2 units; concatenated segments
 *   carry a UDH, leaving 153 septets / 67 units per segment.
 * - Concatenation never splits an ESC pair or a surrogate pair across a
 *   boundary: a 2-unit character that does not fit starts the next segment
 *   (the stranded unit is wasted padding — reflected in `segments`, not in
 *   `unitsUsed`).
 */

object SmsEncoding {
    const val GSM7 = "GSM-7"
    const val UCS2 = "UCS-2"
}

/** Septets available in a single (non-concatenated) GSM-7 message. */
const val GSM7_SINGLE_SEGMENT_UNITS = 160

/** Septets available per segment of a concatenated GSM-7 message. */
const val GSM7_CONCAT_SEGMENT_UNITS = 153

/** UTF-16 code units available in a single UCS-2 message. */
const val UCS2_SINGLE_SEGMENT_UNITS = 70

/** UTF-16 code units available per segment of a concatenated UCS-2 message. */
const val UCS2_CONCAT_SEGMENT_UNITS = 67

data class SegmentEstimate(
    val encoding: String,
    /** Estimated message parts. 0 for an empty body (nothing to send). */
    val segments: Int,
    /** Content units: GSM-7 septets (extension chars cost 2) or UTF-16 units. */
    val unitsUsed: Int,
    /** Capacity per segment for the chosen encoding: 160, 153, 70, or 67. */
    val unitsPerSegment: Int,
)

/**
 * GSM 03.38 7-bit default alphabet (basic charset), 1 septet each — every
 * single-byte code point 0x00–0x7F from GSM0338.TXT except 0x1B (ESC).
 */
private const val GSM7_BASIC =
    "@£\$¥èéùìòç\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
        "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

/** GSM 03.38 extension table (ESC-prefixed), 2 septets each. */
private const val GSM7_EXTENSION = "\u000C^{}\\[~]|€"

private val GSM7_BASIC_SET: Set<Int> = GSM7_BASIC.map { it.code }.toSet()
private val GSM7_EXTENSION_SET: Set<Int> = GSM7_EXTENSION.map { it.code }.toSet()

/** Whole Unicode code points, mirroring TS `for (const char of text)`. */
private fun codePoints(text: String): Sequence<Int> = sequence {
    var i = 0
    while (i < text.length) {
        val cp = text.codePointAt(i)
        yield(cp)
        i += Character.charCount(cp)
    }
}

/** Total GSM-7 septets for the text, or null if any char is outside GSM-7. */
private fun gsm7Septets(text: String): Int? {
    var septets = 0
    for (cp in codePoints(text)) {
        septets += when {
            cp in GSM7_BASIC_SET -> 1
            cp in GSM7_EXTENSION_SET -> 2
            else -> return null
        }
    }
    return septets
}

/**
 * Greedy segment packing: characters fill segments of `capacity` units in
 * order; a 2-unit character that would straddle a boundary moves entirely
 * into the next segment.
 */
private fun packSegments(costs: Sequence<Int>, capacity: Int): Int {
    var segments = 1
    var used = 0
    for (cost in costs) {
        if (used + cost > capacity) {
            segments += 1
            used = 0
        }
        used += cost
    }
    return segments
}

private fun gsm7Costs(text: String): Sequence<Int> =
    // Non-extension implies basic by construction: only called after
    // gsm7Septets succeeded.
    codePoints(text).map { cp -> if (cp in GSM7_EXTENSION_SET) 2 else 1 }

private fun ucs2Costs(text: String): Sequence<Int> =
    // Astral code points are 2 UTF-16 units and must not split across segments.
    codePoints(text).map { cp -> Character.charCount(cp) }

/**
 * Estimate encoding and segment count for an SMS body. App-side pre-check
 * estimate only — Telnyx's finalized `parts` are authoritative for billing.
 */
fun estimateSegments(text: String): SegmentEstimate {
    val septets = gsm7Septets(text)

    if (septets != null) {
        if (septets == 0) {
            return SegmentEstimate(SmsEncoding.GSM7, 0, 0, GSM7_SINGLE_SEGMENT_UNITS)
        }
        if (septets <= GSM7_SINGLE_SEGMENT_UNITS) {
            return SegmentEstimate(SmsEncoding.GSM7, 1, septets, GSM7_SINGLE_SEGMENT_UNITS)
        }
        return SegmentEstimate(
            encoding = SmsEncoding.GSM7,
            segments = packSegments(gsm7Costs(text), GSM7_CONCAT_SEGMENT_UNITS),
            unitsUsed = septets,
            unitsPerSegment = GSM7_CONCAT_SEGMENT_UNITS,
        )
    }

    val units = text.length // UTF-16 code units
    if (units <= UCS2_SINGLE_SEGMENT_UNITS) {
        return SegmentEstimate(SmsEncoding.UCS2, 1, units, UCS2_SINGLE_SEGMENT_UNITS)
    }
    return SegmentEstimate(
        encoding = SmsEncoding.UCS2,
        segments = packSegments(ucs2Costs(text), UCS2_CONCAT_SEGMENT_UNITS),
        unitsUsed = units,
        unitsPerSegment = UCS2_CONCAT_SEGMENT_UNITS,
    )
}

/** MMS is metered at a flat 3 segments (SPEC §7) regardless of body length. */
const val MMS_SEGMENTS = 3

/** The composer hint turns amber at ≥4 parts (APP-LAYOUT-V2 §3.2). */
const val METER_WARN_AT_SEGMENTS = 4

data class SegmentMeterState(
    val visible: Boolean,
    val segments: Int,
    val encoding: String,
    /** "Sent in 2 parts" — plain language, never the word "segment". */
    val label: String,
    val warn: Boolean,
)

/**
 * Composer segment hint — passive text, not a control. Appears only once a
 * message actually splits into 2+ parts; MMS shows a flat 3-part note.
 */
fun segmentMeter(text: String, hasMedia: Boolean = false): SegmentMeterState {
    if (hasMedia) {
        return SegmentMeterState(
            visible = true,
            segments = MMS_SEGMENTS,
            encoding = SmsEncoding.GSM7,
            label = "MMS · sent in $MMS_SEGMENTS parts",
            warn = false,
        )
    }
    val estimate = estimateSegments(text)
    return SegmentMeterState(
        visible = estimate.segments >= 2,
        segments = estimate.segments,
        encoding = estimate.encoding,
        label = "Sent in ${estimate.segments} part${if (estimate.segments == 1) "" else "s"}",
        warn = estimate.segments >= METER_WARN_AT_SEGMENTS,
    )
}
