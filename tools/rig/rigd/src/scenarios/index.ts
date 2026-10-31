import { S01, S02, S04 } from "./calls.ts";
import type { ScenarioRunner } from "./context.ts";
import { S20, S21, S23, S24, S25 } from "./texts.ts";

export * from "./context.ts";
export { S01, S02, S04, VOICEMAIL_PHRASE, MAX_WORD_ERROR } from "./calls.ts";
export { S20, S21, S23, S24, S25, isQuietHour } from "./texts.ts";

/** Every scenario rigd can run; the scheduler times only these. */
export const RUNNERS: Readonly<Record<string, ScenarioRunner>> = Object.fromEntries(
  [S20, S21, S23, S24, S25, S01, S02, S04].map((runner) => [runner.id, runner]),
);
