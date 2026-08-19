import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DIAL_BATCH_SIZE, MAX_LEGS_PER_SESSION } from "./calls/transitions";

/**
 * #251 — the rate-limit probe's arithmetic uses the constants it claims to.
 *
 * scripts/ops/telnyx-rate-limits.mjs prints how many concurrent ringing calls
 * it would take to saturate Telnyx's dial bucket. That figure is only worth
 * anything if the leg and batch numbers behind it are the ones the Worker
 * actually dials with — and the script is .mjs, so it cannot import a .ts
 * constant and has to restate them.
 *
 * A restated constant is a copy, and a copy drifts. This is the guard the
 * script's own comment promises: raise MAX_LEGS_PER_SESSION and the printout
 * would otherwise keep quoting the old ceiling to whoever runs it next.
 *
 * The script is NOT executed here — it calls Telnyx and needs a credential.
 * What is checked is the only part that can go quietly wrong.
 */
const SCRIPT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "scripts",
  "ops",
  "telnyx-rate-limits.mjs",
);

describe("#251 the Telnyx rate-limit probe restates the real constants", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("found the script, so a pass means something", () => {
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("MAX_LEGS_PER_SESSION");
    expect(source).toContain("DIAL_BATCH_SIZE");
  });

  it.each([
    ["MAX_LEGS", MAX_LEGS_PER_SESSION, "MAX_LEGS_PER_SESSION"],
    ["BATCH", DIAL_BATCH_SIZE, "DIAL_BATCH_SIZE"],
  ])("%s matches %i", (local, value, named) => {
    // Split rather than match: the declaration is a fixed shape, and a regex
    // literal is one more thing between this guard and what it is checking.
    const marker = "const " + local + " = ";
    const at = source.indexOf(marker);
    expect(
      at,
      "the probe no longer declares '" +
        marker +
        "<n>; // " +
        named +
        "', so this guard cannot see the copy it exists to check",
    ).toBeGreaterThan(-1);

    const tail = source.slice(at + marker.length);
    const line = tail.slice(0, tail.indexOf("\n"));
    const printed = Number(tail.slice(0, tail.indexOf(";")));

    expect(
      line,
      "the probe's " +
        local +
        " line no longer names " +
        named +
        ", so a reader cannot tell which constant it is copying",
    ).toContain(named);

    expect(
      printed,
      "the probe says " +
        named +
        " is " +
        printed +
        "; transitions.ts says " +
        value +
        ". The printed 'concurrent ringing calls to saturate' figure is " +
        "derived from these, so it is now quoting a ceiling we do not have.",
    ).toBe(value);
  });
});
