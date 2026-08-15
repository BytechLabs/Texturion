import { estimateSegments, type SmsEncoding } from "@loonext/shared";

/**
 * Composer segment hint (APP-LAYOUT-V2 §3.2): a PASSIVE `stone-400` text line,
 * NOT a control. It appears only once a message will actually be sent in 2+
 * PARTS — that's when it costs an extra segment; a single-part message shows
 * nothing so short texts stay clean. Reads "Sent in N parts" (never the word
 * "segment", never a stepper) and turns amber only at ≥4 parts. Uses the shared
 * estimator (SPEC §9 GSM-7/UCS-2 rules) — the same math the API pre-checks with
 * and the cap counts, so the hint always matches the bill.
 */

export const METER_WARN_AT_SEGMENTS = 4;

/** MMS is metered at a flat 3 segments (SPEC §7) regardless of body length. */
export const MMS_SEGMENTS = 3;

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

/** Every catalogue key this module names. */
export type SegmentMeterKey =
  | "thread.mmsSegments"
  | "thread.sentInOnePart"
  | "thread.sentInParts"
  | "thread.segmentTipOnePart"
  | "thread.segmentTipParts";

/** The reader's resolver. */
export type SaySegmentMeter = (
  key: SegmentMeterKey,
  vars?: Record<string, string>,
) => string;

export function segmentMeter(
  text: string,
  hasMedia: boolean,
  say: SaySegmentMeter,
): SegmentMeterState {
  // Attaching anything makes this an MMS, billed at a flat 3 parts whatever
  // the body says. Counting the text alone told people a photo with "ok" on
  // it cost nothing, which is three times off, so the media case answers
  // first and always shows.
  if (hasMedia) {
    return {
      visible: true,
      segments: MMS_SEGMENTS,
      encoding: "GSM-7",
      label: say("thread.mmsSegments", { count: String(MMS_SEGMENTS) }),
      warn: false,
    };
  }
  const estimate = estimateSegments(text);
  return {
    visible: estimate.segments >= 2,
    segments: estimate.segments,
    encoding: estimate.encoding,
    /*
     * ONE and MANY are separate keys, not one sentence with an "s" appended.
     * French agrees the noun with the count — "1 partie", "2 parties" — and a
     * language that also agreed an article or a verb would have nowhere to
     * put it. Both phones have carried the pair since their own pass.
     */
    label:
      estimate.segments === 1
        ? say("thread.sentInOnePart")
        : say("thread.sentInParts", { count: String(estimate.segments) }),
    warn: estimate.segments >= METER_WARN_AT_SEGMENTS,
  };
}

/**
 * §3.2 plain tooltip copy (inherited from APP-UI-ELEVATION §3.2): explains the
 * "parts" split in plain language, and states the current count. Never the word
 * "segment".
 */
export function segmentTooltip(parts: number, say: SaySegmentMeter): string {
  // Web-only: the phones have no hover, so this pair exists on this client
  // alone. Split the same way as the label above, and for the same reason.
  return parts === 1
    ? say("thread.segmentTipOnePart")
    : say("thread.segmentTipParts", { count: String(parts) });
}
