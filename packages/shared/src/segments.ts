/**
 * SMS segment estimator (SPEC §2, §9, §10).
 *
 * This is the APP-SIDE ESTIMATE used for the send-time overage-cap pre-check
 * (§9: "a GSM-7/UCS-2 estimate (160/153, 70/67 chars) of queued-but-unfinalized
 * messages") and the 250-segments/hour rate limit (§10). It is never used for
 * billing: Telnyx's finalized `parts` + `encoding` from the `message.finalized`
 * webhook remain authoritative for metering and invoicing (D6).
 *
 * Encoding rules implemented exactly per ETSI GSM 03.38 / 3GPP TS 23.038,
 * using the Unicode Consortium's authoritative mapping
 * (https://unicode.org/Public/MAPPINGS/ETSI/GSM0338.TXT):
 * - GSM-7 basic charset: 1 septet per character. Note 0x09 is SMALL c-cedilla
 *   (ç) per that mapping's correction of the ETSI table glyph.
 * - GSM-7 extension table (form feed, ^ { } \ [ ~ ] | €): ESC + char =
 *   2 septets per character.
 * - Any character outside both tables switches the WHOLE message to UCS-2,
 *   counted in UTF-16 code units (a surrogate-pair emoji = 2 units).
 * - Limits: single segment 160 septets / 70 UCS-2 units; concatenated
 *   segments carry a UDH, leaving 153 septets / 67 units per segment.
 * - Concatenation never splits an ESC pair or a surrogate pair across a
 *   segment boundary: a 2-unit character that does not fit in the current
 *   segment starts the next one (the stranded unit is wasted padding —
 *   reflected in `segments` but not in `unitsUsed`, which counts content).
 */

export type SmsEncoding = "GSM-7" | "UCS-2";

/** Septets available in a single (non-concatenated) GSM-7 message. */
export const GSM7_SINGLE_SEGMENT_UNITS = 160;
/** Septets available per segment of a concatenated GSM-7 message. */
export const GSM7_CONCAT_SEGMENT_UNITS = 153;
/** UTF-16 code units available in a single UCS-2 message. */
export const UCS2_SINGLE_SEGMENT_UNITS = 70;
/** UTF-16 code units available per segment of a concatenated UCS-2 message. */
export const UCS2_CONCAT_SEGMENT_UNITS = 67;

export interface SegmentEstimate {
  encoding: SmsEncoding;
  /** Estimated message parts. 0 for an empty body (nothing to send). */
  segments: number;
  /** Content units: GSM-7 septets (extension chars cost 2) or UTF-16 code units. */
  unitsUsed: number;
  /** Capacity per segment for the chosen encoding/concatenation: 160, 153, 70, or 67. */
  unitsPerSegment: number;
}

/**
 * GSM 03.38 7-bit default alphabet (basic charset), 1 septet each — every
 * single-byte code point 0x00–0x7F from GSM0338.TXT except 0x1B (ESC, the
 * extension-table shift; its NBSP rendering is a display fallback, not an
 * encodable character).
 */
const GSM7_BASIC =
  "@£$¥èéùìòç\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** GSM 03.38 extension table (ESC-prefixed), 2 septets each. */
const GSM7_EXTENSION = "\f^{}\\[~]|€";

const GSM7_BASIC_SET: ReadonlySet<string> = new Set(GSM7_BASIC);
const GSM7_EXTENSION_SET: ReadonlySet<string> = new Set(GSM7_EXTENSION);

/** GSM-7 septet cost of one code point, or null if it forces UCS-2. */
function gsm7Cost(char: string): 1 | 2 | null {
  if (GSM7_BASIC_SET.has(char)) return 1;
  if (GSM7_EXTENSION_SET.has(char)) return 2;
  return null;
}

/** Total GSM-7 septets for the text, or null if any char is outside GSM-7. */
function gsm7Septets(text: string): number | null {
  let septets = 0;
  for (const char of text) {
    const cost = gsm7Cost(char);
    if (cost === null) return null;
    septets += cost;
  }
  return septets;
}

/**
 * Greedy segment packing: characters fill segments of `capacity` units in
 * order; a 2-unit character that would straddle a boundary moves entirely
 * into the next segment.
 */
function packSegments(costs: Iterable<1 | 2>, capacity: number): number {
  let segments = 1;
  let used = 0;
  for (const cost of costs) {
    if (used + cost > capacity) {
      segments += 1;
      used = 0;
    }
    used += cost;
  }
  return segments;
}

function* gsm7Costs(text: string): Generator<1 | 2> {
  for (const char of text) {
    // Non-null by construction: only called after gsm7Septets succeeded.
    yield GSM7_BASIC_SET.has(char) ? 1 : 2;
  }
}

function* ucs2Costs(text: string): Generator<1 | 2> {
  for (const char of text) {
    // String iteration yields whole code points: astral chars (surrogate
    // pairs) are 2 UTF-16 code units and must not split across segments.
    yield char.length === 2 ? 2 : 1;
  }
}

/**
 * Estimate encoding and segment count for an SMS body. App-side pre-check
 * estimate only — Telnyx's finalized `parts` are authoritative for billing.
 */
export function estimateSegments(text: string): SegmentEstimate {
  const septets = gsm7Septets(text);

  if (septets !== null) {
    if (septets === 0) {
      return { encoding: "GSM-7", segments: 0, unitsUsed: 0, unitsPerSegment: GSM7_SINGLE_SEGMENT_UNITS };
    }
    if (septets <= GSM7_SINGLE_SEGMENT_UNITS) {
      return { encoding: "GSM-7", segments: 1, unitsUsed: septets, unitsPerSegment: GSM7_SINGLE_SEGMENT_UNITS };
    }
    return {
      encoding: "GSM-7",
      segments: packSegments(gsm7Costs(text), GSM7_CONCAT_SEGMENT_UNITS),
      unitsUsed: septets,
      unitsPerSegment: GSM7_CONCAT_SEGMENT_UNITS,
    };
  }

  const units = text.length; // UTF-16 code units
  if (units <= UCS2_SINGLE_SEGMENT_UNITS) {
    return { encoding: "UCS-2", segments: 1, unitsUsed: units, unitsPerSegment: UCS2_SINGLE_SEGMENT_UNITS };
  }
  return {
    encoding: "UCS-2",
    segments: packSegments(ucs2Costs(text), UCS2_CONCAT_SEGMENT_UNITS),
    unitsUsed: units,
    unitsPerSegment: UCS2_CONCAT_SEGMENT_UNITS,
  };
}
