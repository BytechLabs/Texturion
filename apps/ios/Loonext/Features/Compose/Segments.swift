import Foundation

/// SMS segment estimator — an exact Swift port of packages/shared/src/segments.ts
/// (SPEC §2, §9, §10), mirroring the Android features/compose/Segments.kt twin.
/// App-side estimate only; Telnyx's finalized `parts` + `encoding` stay
/// authoritative for billing.
///
/// Encoding rules per ETSI GSM 03.38 / 3GPP TS 23.038 using the Unicode
/// Consortium's GSM0338.TXT mapping:
/// - GSM-7 basic charset: 1 septet per character (0x09 is ç per that mapping).
/// - GSM-7 extension table (form feed, ^ { } \ [ ~ ] | €): ESC + char = 2 septets.
/// - Any character outside both tables switches the WHOLE message to UCS-2,
///   counted in UTF-16 code units (a surrogate-pair emoji = 2 units).
/// - Limits: single segment 160 septets / 70 UCS-2 units; concatenated segments
///   carry a UDH, leaving 153 septets / 67 units per segment.
/// - Concatenation never splits an ESC pair or a surrogate pair across a
///   boundary: a 2-unit character that does not fit starts the next segment
///   (the stranded unit is wasted padding — reflected in `segments`, not in
///   `unitsUsed`).

enum SmsEncoding {
    static let gsm7 = "GSM-7"
    static let ucs2 = "UCS-2"
}

/// Septets available in a single (non-concatenated) GSM-7 message.
let gsm7SingleSegmentUnits = 160

/// Septets available per segment of a concatenated GSM-7 message.
let gsm7ConcatSegmentUnits = 153

/// UTF-16 code units available in a single UCS-2 message.
let ucs2SingleSegmentUnits = 70

/// UTF-16 code units available per segment of a concatenated UCS-2 message.
let ucs2ConcatSegmentUnits = 67

struct SegmentEstimate: Equatable, Sendable {
    let encoding: String
    /// Estimated message parts. 0 for an empty body (nothing to send).
    let segments: Int
    /// Content units: GSM-7 septets (extension chars cost 2) or UTF-16 units.
    let unitsUsed: Int
    /// Capacity per segment for the chosen encoding: 160, 153, 70, or 67.
    let unitsPerSegment: Int
}

/// GSM 03.38 7-bit default alphabet (basic charset), 1 septet each — every
/// single-byte code point 0x00–0x7F from GSM0338.TXT except 0x1B (ESC).
private let gsm7Basic =
    "@£$¥èéùìòç\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

/// GSM 03.38 extension table (ESC-prefixed), 2 septets each.
private let gsm7Extension = "\u{0C}^{}\\[~]|€"

private let gsm7BasicSet: Set<UInt32> = Set(gsm7Basic.unicodeScalars.map(\.value))
private let gsm7ExtensionSet: Set<UInt32> = Set(gsm7Extension.unicodeScalars.map(\.value))

/// Total GSM-7 septets for the text, or nil if any char is outside GSM-7.
/// Iterates whole Unicode code points, mirroring TS `for (const char of text)`.
private func gsm7Septets(_ text: String) -> Int? {
    var septets = 0
    for scalar in text.unicodeScalars {
        if gsm7BasicSet.contains(scalar.value) {
            septets += 1
        } else if gsm7ExtensionSet.contains(scalar.value) {
            septets += 2
        } else {
            return nil
        }
    }
    return septets
}

/// Greedy segment packing: characters fill segments of `capacity` units in
/// order; a 2-unit character that would straddle a boundary moves entirely
/// into the next segment.
private func packSegments(_ costs: some Sequence<Int>, capacity: Int) -> Int {
    var segments = 1
    var used = 0
    for cost in costs {
        if used + cost > capacity {
            segments += 1
            used = 0
        }
        used += cost
    }
    return segments
}

private func gsm7Costs(_ text: String) -> [Int] {
    // Non-extension implies basic by construction: only called after
    // gsm7Septets succeeded.
    text.unicodeScalars.map { gsm7ExtensionSet.contains($0.value) ? 2 : 1 }
}

private func ucs2Costs(_ text: String) -> [Int] {
    // Astral code points are 2 UTF-16 units and must not split across segments.
    text.unicodeScalars.map { $0.value > 0xFFFF ? 2 : 1 }
}

/// Estimate encoding and segment count for an SMS body. App-side pre-check
/// estimate only — Telnyx's finalized `parts` are authoritative for billing.
func estimateSegments(_ text: String) -> SegmentEstimate {
    if let septets = gsm7Septets(text) {
        if septets == 0 {
            return SegmentEstimate(
                encoding: SmsEncoding.gsm7,
                segments: 0,
                unitsUsed: 0,
                unitsPerSegment: gsm7SingleSegmentUnits
            )
        }
        if septets <= gsm7SingleSegmentUnits {
            return SegmentEstimate(
                encoding: SmsEncoding.gsm7,
                segments: 1,
                unitsUsed: septets,
                unitsPerSegment: gsm7SingleSegmentUnits
            )
        }
        return SegmentEstimate(
            encoding: SmsEncoding.gsm7,
            segments: packSegments(gsm7Costs(text), capacity: gsm7ConcatSegmentUnits),
            unitsUsed: septets,
            unitsPerSegment: gsm7ConcatSegmentUnits
        )
    }

    let units = text.utf16.count // UTF-16 code units
    if units <= ucs2SingleSegmentUnits {
        return SegmentEstimate(
            encoding: SmsEncoding.ucs2,
            segments: 1,
            unitsUsed: units,
            unitsPerSegment: ucs2SingleSegmentUnits
        )
    }
    return SegmentEstimate(
        encoding: SmsEncoding.ucs2,
        segments: packSegments(ucs2Costs(text), capacity: ucs2ConcatSegmentUnits),
        unitsUsed: units,
        unitsPerSegment: ucs2ConcatSegmentUnits
    )
}

/// MMS is metered at a flat 3 segments (SPEC §7) regardless of body length.
let mmsSegments = 3

/// The composer hint turns amber at ≥4 parts (APP-LAYOUT-V2 §3.2).
let meterWarnAtSegments = 4

struct SegmentMeterState: Equatable, Sendable {
    let visible: Bool
    let segments: Int
    let encoding: String
    /// "Sent in 2 parts" — plain language, never the word "segment".
    let label: String
    let warn: Bool
}

/// Composer segment hint — passive text, not a control. Appears only once a
/// message actually splits into 2+ parts; MMS shows a flat 3-part note.
func segmentMeter(_ text: String, hasMedia: Bool = false) -> SegmentMeterState {
    if hasMedia {
        return SegmentMeterState(
            visible: true,
            segments: mmsSegments,
            encoding: SmsEncoding.gsm7,
            label: "MMS · sent in \(mmsSegments) parts",
            warn: false
        )
    }
    let estimate = estimateSegments(text)
    return SegmentMeterState(
        visible: estimate.segments >= 2,
        segments: estimate.segments,
        encoding: estimate.encoding,
        label: "Sent in \(estimate.segments) part\(estimate.segments == 1 ? "" : "s")",
        warn: estimate.segments >= meterWarnAtSegments
    )
}
