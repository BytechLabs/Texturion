import { describe, expect, it } from "vitest";

import { AI_UNIT_COST_CENTS } from "../billing/costs";
import {
  CALL_WRAPUP_ALERT_THRESHOLD,
  CALL_WRAPUP_FEATURE_SPEC,
  CALL_WRAPUP_MAX_BYTES,
  CALL_WRAPUP_MAX_CHARS,
  CALL_WRAPUP_MAX_SECONDS,
  CALL_WRAPUP_MONTHLY_CAP,
  sanitizeWrapUp,
  shouldTranscribeWrapUp,
} from "./call-wrapup";
import { DEFAULT_AI_SETTINGS } from "./settings";

/**
 * #507 Phase 1 — the pure core of the crew wrap-up.
 *
 * The property that matters most is the one that looks like an omission: this
 * module has no LLM step and no rewriting. A note that exists to settle "what
 * did I quote him?" is worth exactly as much as it is faithful, and a model
 * that paraphrased $2,400 into $2,000 would break the feature silently, months
 * before anybody looked.
 */

describe("shouldTranscribeWrapUp", () => {
  it("takes an ordinary wrap-up", () => {
    expect(shouldTranscribeWrapUp({ seconds: 18, bytes: 120_000 })).toBe(true);
  });

  it("refuses a recording of nothing", () => {
    expect(shouldTranscribeWrapUp({ seconds: 0, bytes: 0 })).toBe(false);
    expect(shouldTranscribeWrapUp({ seconds: 12, bytes: 0 })).toBe(false);
  });

  // A phone left in a pocket is the runaway this exists to stop — it bills per
  // audio minute and nobody is waiting for the answer.
  it("refuses a phone left in a pocket", () => {
    expect(
      shouldTranscribeWrapUp({
        seconds: CALL_WRAPUP_MAX_SECONDS + 1,
        bytes: 200_000,
      }),
    ).toBe(false);
  });

  // `seconds` is what the CLIENT says; bytes are what actually arrived. A
  // client that under-reports the duration must not get past the length gate.
  it("refuses an oversized body even when the claimed duration is short", () => {
    expect(
      shouldTranscribeWrapUp({ seconds: 3, bytes: CALL_WRAPUP_MAX_BYTES + 1 }),
    ).toBe(false);
  });

  it("refuses a negative duration", () => {
    expect(shouldTranscribeWrapUp({ seconds: -5, bytes: 1000 })).toBe(false);
  });
});

describe("sanitizeWrapUp", () => {
  it("keeps the words exactly as spoken", () => {
    const spoken =
      "Quoted him $2,400 for the tank, parts Thursday, he's confirming with his wife.";

    expect(sanitizeWrapUp(spoken)).toBe(spoken);
  });

  // The whole feature in one assertion. If a number, a name or a commitment can
  // change between what was said and what is stored, the note cannot settle the
  // dispute it exists for.
  it("never alters a figure, a name or a date", () => {
    const spoken = "$2,400 to Dana Rivera by Thursday the 14th, 3 units at 15%";

    expect(sanitizeWrapUp(`  ${spoken}  `)).toBe(spoken);
  });

  it("tidies only whitespace, including the runs Whisper leaves at pauses", () => {
    expect(sanitizeWrapUp("quoted   him    $2,400")).toBe("quoted him $2,400");
    expect(sanitizeWrapUp("line one\r\nline two")).toBe("line one\nline two");
  });

  it("reads nothing as nothing", () => {
    expect(sanitizeWrapUp("")).toBeNull();
    expect(sanitizeWrapUp("   \n  ")).toBeNull();
    expect(sanitizeWrapUp(null)).toBeNull();
    expect(sanitizeWrapUp(undefined)).toBeNull();
    expect(sanitizeWrapUp(42 as unknown as string)).toBeNull();
  });

  it("caps a degenerate output rather than putting pages in a note", () => {
    const runaway = "na ".repeat(CALL_WRAPUP_MAX_CHARS);

    const cleaned = sanitizeWrapUp(runaway);
    expect(cleaned).not.toBeNull();
    expect(cleaned!.length).toBeLessThanOrEqual(CALL_WRAPUP_MAX_CHARS);
  });
});

describe("CALL_WRAPUP_FEATURE_SPEC", () => {
  // #380: the spec states its own price beside its own cap so the two are read
  // together, and this is what stops the duplication drifting.
  it("states the same unit cost the cost model prices", () => {
    expect(CALL_WRAPUP_FEATURE_SPEC.unitCostCents).toBe(
      AI_UNIT_COST_CENTS.call_wrapup,
    );
  });

  it("alerts before the cap rather than at it", () => {
    expect(CALL_WRAPUP_ALERT_THRESHOLD).toBeLessThan(CALL_WRAPUP_MONTHLY_CAP);
    expect(CALL_WRAPUP_FEATURE_SPEC.cap).toBe(CALL_WRAPUP_MONTHLY_CAP);
  });

  it("is on by default, and reads the toggle the settings actually carry", () => {
    expect(CALL_WRAPUP_FEATURE_SPEC.enabled(DEFAULT_AI_SETTINGS)).toBe(true);
    expect(
      CALL_WRAPUP_FEATURE_SPEC.enabled({
        ...DEFAULT_AI_SETTINGS,
        call_wrapup: false,
      }),
    ).toBe(false);
  });

  // What the founder loses at the cap has to be true, because it is what the
  // ops alert tells them.
  it("says what stops, and it is not the whole feature", () => {
    expect(CALL_WRAPUP_FEATURE_SPEC.stops).toContain("typed");
  });
});
