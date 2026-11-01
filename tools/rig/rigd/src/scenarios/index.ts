import { S22, S27, S28, S29, S31, S32, S33, S34, S35 } from "./account.ts";
import { D02, D02p, D03, D04, D10, D11, D12, E01 } from "./android-wake.ts";
import { S03, S05, S06, S07, S09, S10, S11 } from "./browser-calls.ts";
import { S01, S02, S04 } from "./calls.ts";
import type { ScenarioRunner } from "./context.ts";
import { G01, S12, S13, S14, S15, S16 } from "./gates.ts";
import { S20, S21, S23, S24, S25 } from "./texts.ts";

export * from "./context.ts";
export { S01, S02, S04, VOICEMAIL_PHRASE, MAX_WORD_ERROR } from "./calls.ts";
export { S20, S21, S23, S24, S25, isQuietHour, QUIET_HOURS_START, QUIET_HOURS_END } from "./texts.ts";
export { S03, S05, S06, S07, S08, S09, S10, S11 } from "./browser-calls.ts";
export { G01, S12, S13, S14, S15, S16, S17, S26 } from "./gates.ts";
export { S22, S27, S28, S29, S31, S32, S33, S34, S35 } from "./account.ts";
export { D02, D02p, D03, D04, D10, D11, D12, E01 } from "./android-wake.ts";

/** Every scenario rigd can run; the scheduler times only these. */
export const RUNNERS: Readonly<Record<string, ScenarioRunner>> = Object.fromEntries(
  [
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
    D02,
    D02p,
    D03,
    D04,
    D10,
    D11,
    D12,
    E01,
  ].map((runner) => [runner.id, runner]),
);

/**
 * Scenarios the rig would time that rigd cannot run yet, and why: a runner
 * left out of RUNNERS because every run would report the same missing piece,
 * a standing red that hides a real one, or one that cannot be written yet.
 */
export const NOT_RUNNABLE_YET: Readonly<Record<string, string>> = {
  G02: "the Android half needs the nonprod build to place an SDK call to a SIP address, and the app has no entry point for one",
  S08: "the web call bar has no consult transfer control, so every run would report the browser lane",
  S17: "the daemon does not hand the armed fault to the webhook forwarder yet, so no call event would answer 503",
  S26: "the API raises the carrier-ceiling warning by email only, never as a Sentry event, so every run would fail carrier_alert_missing",
  D14: "it needs a QA-A voicemail of S04's phrase, which a free run cannot create",
};
