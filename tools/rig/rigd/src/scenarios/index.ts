import { S01, S02, S04 } from "./calls.ts";
import type { ScenarioRunner } from "./context.ts";
import { S20, S21, S23, S24 } from "./texts.ts";

export * from "./context.ts";
export { S01, S02, S04, VOICEMAIL_PHRASE, MAX_WORD_ERROR } from "./calls.ts";
export { S20, S21, S23, S24, S25, isQuietHour, QUIET_HOURS_START, QUIET_HOURS_END } from "./texts.ts";

/**
 * Every scenario rigd can run; the scheduler times only these. S25 is written
 * but left out: until the app probe can arm its automations every run would
 * only report the probe, a standing red that hides a real one.
 */
export const RUNNERS: Readonly<Record<string, ScenarioRunner>> = Object.fromEntries(
  [S20, S21, S23, S24, S01, S02, S04].map((runner) => [runner.id, runner]),
);

/** Scenarios with a runner that is not in RUNNERS yet, and why. */
export const NOT_RUNNABLE_YET: Readonly<Record<string, string>> = {
  S25: "the app probe cannot arm its automations yet",
};
