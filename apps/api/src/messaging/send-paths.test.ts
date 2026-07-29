/**
 * #331 — the outbound send paths, and proof each one goes through the gate.
 *
 * The opt-out check lives in `runPreSendGates`, and every send path calls it.
 * That was true when it was written and stays true only for as long as each
 * new author knows. Send later (#233), reminders (#237), ratings (#313), the
 * public API (#243) are each written later, by someone reading a different
 * file. A comment saying "every path funnels through here" describes the
 * present; it does not defend the future.
 *
 * The defence is the {@link SendClearance} brand: `dispatchOutbound` demands a
 * value only `runPreSendGates` can produce, so a path that skips the gate does
 * not compile. That is enforced by the type checker, which runs in CI, on
 * every push.
 *
 * What THESE tests add is the part a type cannot express: that nobody
 * fabricates the proof. `{} as SendClearance` type-checks perfectly. So this
 * file enumerates the source and asserts the brand is minted in exactly two
 * places — the gate itself, and the one test-only helper.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * The gate itself, and the test harness's door
 * (`clearedFor`, used by tests that exercise the dispatch tail directly).
 * Anything else casting to the brand is manufacturing a permission slip.
 */
const MAY_MINT_A_CLEARANCE = ["messaging/send.ts", "test/support.ts"];

/** Every .ts file under src/, excluding test files. */
function productionSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts")) continue;
      found.push(full);
    }
  };
  walk(SRC);
  return found;
}

function repoPath(file: string): string {
  return relative(SRC, file).replaceAll("\\", "/");
}

describe("the outbound gate cannot be bypassed (#331)", () => {
  it("mints a send clearance in exactly the two places allowed to", () => {
    // `as SendClearance` is the only way to produce the brand — the symbol is
    // module-private, so an object literal will not satisfy it.
    const minting = productionSources()
      .filter((file) => /as\s+SendClearance/.test(readFileSync(file, "utf8")))
      .map(repoPath)
      .sort();

    expect(minting).toEqual([...MAY_MINT_A_CLEARANCE].sort());
  });

  it("routes every dispatch through a clearance the gate produced", () => {
    // The type checker already rejects a dispatch with no clearance. This
    // catches the other half: a file that dispatches while importing the
    // clearance type from somewhere other than the gate, which is what a
    // work-around would look like.
    const offenders = productionSources()
      .filter((file) => repoPath(file) !== "messaging/send.ts")
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        if (!source.includes("dispatchOutbound(")) return false;
        // Whatever route it takes, the clearance has to have come from the
        // gate module — directly, or threaded in from a caller that did.
        return !/from\s+"[^"]*\/send"|from\s+"\.\/send"/.test(source);
      })
      .map(repoPath);

    expect(offenders).toEqual([]);
  });

  it("names every path that reaches the carrier, so a new one is a visible diff", () => {
    // Not a lint rule — a roll call. Adding a send path changes this list, and
    // changing it is the moment somebody asks whether the new path is gated.
    const dispatchers = productionSources()
      .filter((file) => readFileSync(file, "utf8").includes("dispatchOutbound("))
      .map(repoPath)
      .sort();

    expect(dispatchers).toEqual([
      // Away reply and missed-call text-back both come through here.
      "messaging/auto-send.ts",
      // The missed-call text-back's own dispatch.
      "messaging/missed-call.ts",
      // #411: the stuck-send auto-retry. Reaches the carrier, so it is named
      // here — and it mints its clearance through runPreSendGates like every
      // other path, because the world may have changed since the row was
      // queued.
      "messaging/retry-interrupted.ts",
      // The dispatch tail itself.
      "messaging/send.ts",
      // Compose: the first text to a new number.
      "routes/compose.ts",
      // Thread send, and the retry of a failed one.
      "routes/messages.ts",
    ]);
  });
});
