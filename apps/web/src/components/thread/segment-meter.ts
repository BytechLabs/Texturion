import { estimateSegments, type SmsEncoding } from "@jobtext/shared";

/**
 * Composer character/segment meter (G5): appears past 120 characters,
 * reads "2 segments" in 12px, turns amber at ≥4 segments. Uses the shared
 * estimator (SPEC §9 GSM-7/UCS-2 rules) — the same math the API pre-checks
 * with, so what the meter says is what the cap counts.
 */

export const METER_VISIBLE_AFTER_CHARS = 120;
export const METER_WARN_AT_SEGMENTS = 4;

export interface SegmentMeterState {
  visible: boolean;
  segments: number;
  encoding: SmsEncoding;
  /** "1 segment" / "3 segments" — G10 plain language. */
  label: string;
  /** Amber at ≥4 segments (G5). */
  warn: boolean;
}

export function segmentMeter(text: string): SegmentMeterState {
  const estimate = estimateSegments(text);
  return {
    visible: text.length > METER_VISIBLE_AFTER_CHARS,
    segments: estimate.segments,
    encoding: estimate.encoding,
    label: `${estimate.segments} segment${estimate.segments === 1 ? "" : "s"}`,
    warn: estimate.segments >= METER_WARN_AT_SEGMENTS,
  };
}

/** SPEC §2 plain-English tooltip copy. */
export const SEGMENT_TOOLTIP =
  "Long texts and emoji use more than one segment — 160 characters per segment for plain text, 70 with emoji";
