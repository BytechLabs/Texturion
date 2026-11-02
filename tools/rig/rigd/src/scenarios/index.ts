import { S22, S27, S28, S29, S31, S32, S33, S34, S35 } from "./account.ts";
import { D01, D07, D08, D09, D13, D14, R00 } from "./android-calls.ts";
import { D02, D02p, D03, D04, D10, D11, D12, E01 } from "./android-wake.ts";
import { S03, S05, S06, S07, S09, S10, S11 } from "./browser-calls.ts";
import { S01, S02, S04 } from "./calls.ts";
import type { ScenarioRunner } from "./context.ts";
import { G01, S12, S13, S14, S15, S16, S17 } from "./gates.ts";
import { S20, S21, S23, S24, S25 } from "./texts.ts";

export * from "./context.ts";
export { S01, S02, S04, VOICEMAIL_PHRASE, MAX_WORD_ERROR } from "./calls.ts";
export { S20, S21, S23, S24, S25, isQuietHour, QUIET_HOURS_START, QUIET_HOURS_END } from "./texts.ts";
export { S03, S05, S06, S07, S08, S09, S10, S11 } from "./browser-calls.ts";
export { G01, S12, S13, S14, S15, S16, S17, S26 } from "./gates.ts";
export { S22, S27, S28, S29, S31, S32, S33, S34, S35 } from "./account.ts";
export { D02, D02p, D03, D04, D10, D11, D12, E01 } from "./android-wake.ts";
export { D01, D07, D08, D09, D13, D14, R00 } from "./android-calls.ts";

/** Every scenario rigd can run; the scheduler times only these. */
export const RUNNERS: Readonly<Record<string, ScenarioRunner>> = Object.fromEntries(
  [
    R00,
    G01,
    S01,
    S02,
    S03,
    S04,
    S05,
    S06,
    S07,
    S09,
    S10,
    S11,
    S12,
    S13,
    S14,
    S15,
    S16,
    S17,
    S20,
    S21,
    S22,
    S23,
    S24,
    S25,
    S27,
    S28,
    S29,
    S31,
    S32,
    S33,
    S34,
    S35,
    D01,
    D02,
    D02p,
    D03,
    D04,
    D07,
    D08,
    D09,
    D10,
    D11,
    D12,
    D13,
    D14,
    E01,
  ].map((runner) => [runner.id, runner]),
);

/**
 * Scenarios in the catalogue that rigd cannot run yet, and why: a runner left
 * out of RUNNERS because every run would report the same missing piece, a
 * standing red that hides a real one, or one that cannot be written yet.
 * `rig run` refuses them with the reason.
 */
export const NOT_RUNNABLE_YET: Readonly<Record<string, string>> = {
  G02: "the Android half needs the nonprod build to place an SDK call to a SIP address, and the app has no entry point for one",
  S08: "the web call bar has no consult transfer control, so every run would report the browser lane",
  K01: "an optional Phase 4 lane with no runner; it never runs by default (docs/RIG.md 2.3)",
  S26: "the API raises the carrier-ceiling warning by email only, never as a Sentry event, so every run would fail carrier_alert_missing",
};
