import { estimateSegments, type SmsEncoding } from "@loonext/shared";

/**
 * Composer segment hint (APP-LAYOUT-V2 §3.2): a PASSIVE `stone-400` text line,
 * NOT a control. It appears only past 120 characters, reads "Sent in N parts"
 * (never the word "segment", never a stepper), and turns amber only at ≥4
 * parts. Uses the shared estimator (SPEC §9 GSM-7/UCS-2 rules) — the same math
 * the API pre-checks with, so what the hint says is what the cap counts.
 */

export const METER_VISIBLE_AFTER_CHARS = 120;
export const METER_WARN_AT_SEGMENTS = 4;

export interface SegmentMeterState {
  visible: boolean;
  /** Underlying SMS part count (kept as `segments` for the shared estimator). */
  segments: number;
  encoding: SmsEncoding;
  /** "Sent in 2 parts" — §3.2 plain language, no "segment", no stepper. */
  label: string;
  /** Amber at ≥4 parts (§3.2). */
  warn: boolean;
}

export function segmentMeter(text: string): SegmentMeterState {
  const estimate = estimateSegments(text);
  return {
    visible: text.length > METER_VISIBLE_AFTER_CHARS,
    segments: estimate.segments,
    encoding: estimate.encoding,
    label: `Sent in ${estimate.segments} part${estimate.segments === 1 ? "" : "s"}`,
    warn: estimate.segments >= METER_WARN_AT_SEGMENTS,
  };
}

/**
 * §3.2 plain tooltip copy (inherited from APP-UI-ELEVATION §3.2): explains the
 * "parts" split in plain language, and states the current count. Never the word
 * "segment".
 */
export function segmentTooltip(parts: number): string {
  return `Longer texts are sent in parts. This one's ${parts} part${parts === 1 ? "" : "s"}.`;
}
