/**
 * #225 ask 5 — the quiet-hours confirmation setting, and the one thing it must
 * never become.
 *
 * `companies.quiet_hours_confirm_enabled` governs exactly one behaviour: whether
 * a person STARTING a new conversation into a destination inside its 8pm–8am
 * local window has to confirm before it sends. #225 is explicit that a human is
 * warned and never blocked, and an admin at a 24-hour emergency trade can turn
 * the warning off because for them it fires on every 2am job and a prompt that
 * is always dismissed is worse than no prompt.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT. #237 (appointment reminders) and
 * #313 (post-job ratings) are queued, and both are texts we ORIGINATE on our own
 * clock to somebody who did not just contact us — the first genuine quiet-hours
 * exposure this product will have. Their author will go looking for the existing
 * quiet-hours machinery, find a company column that reads like a global on/off
 * switch, and gate on it. At that moment a plumber who switched off a
 * confirmation dialog has silently also authorised 3am appointment reminders to
 * their customers, and nobody decided that.
 *
 * A comment cannot stop this; the last four #225 sessions each left one. So the
 * column has exactly one reader, this test enumerates it from the filesystem,
 * and a second reader fails CI with the reason. Same shape as
 * `quiet-hours-surface.test.ts` (who may SEND) and D49/D79 (one resolver, and a
 * test naming who may decide).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * The column name, as it appears in source. Written once so a rename cannot
 * leave this test passing against a column nobody reads any more.
 */
const COLUMN = "quiet_hours_confirm_enabled";

/**
 * Every file allowed to name the column, and why.
 *
 * `routes/compose.ts` is the ONLY consumer — the human-initiating send path, the
 * only one that asks for a confirmation at all. The other two entries transport
 * the value rather than acting on it: one selects it into the company view for
 * the settings screen to render, and one accepts an admin's write.
 */
const ALLOWED: Record<string, string> = {
  "routes/compose.ts":
    "the sole consumer: skips the 409 confirmation for a human starting a " +
    "conversation. Reads it as ON unless explicitly false",
  "routes/core/company-view.ts":
    "transport only — selects the column so the settings screen can render the " +
    "switch. Makes no decision with it",
  "routes/companies.ts":
    "transport only — accepts an admin's PATCH. Makes no send decision",
};

function productionSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      found.push(full);
    }
  };
  walk(API_SRC);
  return found;
}

const repoPath = (file: string) => relative(API_SRC, file).replaceAll("\\", "/");

function readers(): string[] {
  return productionSources()
    .filter((file) => readFileSync(file, "utf8").includes(COLUMN))
    .map(repoPath);
}

describe("#225 — the confirmation setting cannot become an automated-send licence", () => {
  it("is read by exactly the files that declare a reason to", () => {
    const undeclared = readers().filter((file) => !(file in ALLOWED));
    expect(
      undeclared,
      `\n\n${COLUMN} is now read by: ${undeclared.join(", ")}\n\n` +
        `This column means "does a PERSON have to confirm", and nothing else.\n` +
        `If you are writing an automated send that originates contact (#237\n` +
        `reminders, #313 ratings, #233 send-later), you must NOT gate on it —\n` +
        `an admin who switched off a dialog did not authorise a 3am text. Use\n` +
        `resolveDestinationClock + nextSendableInstant and HOLD the message, and\n` +
        `add your path to quiet-hours-surface.test.ts's SEND_SITES.\n\n` +
        `If your file only transports the value, add it to ALLOWED with why.\n`,
    ).toEqual([]);
  });

  it("keeps the allow-list free of files that no longer read it", () => {
    // A stale entry is a slot a real new reader can occupy without failing.
    const live = new Set(readers());
    const stale = Object.keys(ALLOWED).filter((file) => !live.has(file));
    expect(stale, `allowed but no longer reads it: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("still has a consumer at all", () => {
    // If compose stops reading it the switch became decorative: the settings
    // screen would keep offering a toggle that changes nothing, which is worse
    // than not offering it.
    expect(readers()).toContain("routes/compose.ts");
  });

  it("never reaches a reply-exempt or automated send path", () => {
    // The specific files most likely to acquire it by copy-paste, asserted by
    // name so the failure message is unambiguous rather than a list diff.
    for (const file of [
      "messaging/auto-send.ts",
      "messaging/auto-send-missed.ts",
      "messaging/away-reply.ts",
      "messaging/missed-call.ts",
      "messaging/emergency-ack.ts",
      "messaging/retry-interrupted.ts",
      "messaging/send.ts",
      "messaging/destination-clock.ts",
    ]) {
      const source = readFileSync(join(API_SRC, file), "utf8");
      expect(
        source.includes(COLUMN),
        `${file} reads ${COLUMN}. That column is a human's confirmation ` +
          `dialog, not permission to send at 3am — see this file's header`,
      ).toBe(false);
    }
  });

  it("leaves the resolver itself window-only, with no company opinion in it", () => {
    // resolveDestinationClock answers "what time is it there and is that
    // quiet". Threading a company preference into it would make the ONE
    // resolver (D49) return a different answer per company, and every future
    // caller would inherit that without asking for it.
    const resolver = readFileSync(
      join(API_SRC, "messaging/destination-clock.ts"),
      "utf8",
    );
    expect(resolver).not.toContain("confirm");
  });
});
