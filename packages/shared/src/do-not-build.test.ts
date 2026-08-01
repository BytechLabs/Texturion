import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #323 — the "do not build" table is only useful if it MATCHES.
 *
 * `scripts/check-do-not-build.mjs` reads the table in `docs/DECISIONS.md` and
 * warns when an open issue asks for something a decision already refused. The
 * failure it exists to prevent is #229: an issue filed to rebuild schema D32
 * had deliberately deleted, because nothing collected the refusals in one
 * place.
 *
 * The way a guard like this dies is silently — a heading is renamed, the table
 * parses to nothing, and it reports "none matched" forever. So these assert the
 * parse finds real rows AND that a title resembling the issue that started all
 * this would be caught.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const { parseRefusals } = (await import(
  join(REPO, "scripts", "check-do-not-build.mjs")
)) as { parseRefusals: (md: string) => { phrase: string; decidedBy: string }[] };

const DECISIONS = readFileSync(join(REPO, "docs", "DECISIONS.md"), "utf8");

describe("#323 the do-not-build table parses", () => {
  const refusals = parseRefusals(DECISIONS);

  it("finds real rows, so the guard is not silently blind", () => {
    expect(refusals.length).toBeGreaterThanOrEqual(10);
  });

  it("attributes every refusal to a decision", () => {
    // A refusal with no decision behind it is an opinion, and somebody will
    // rightly overrule it.
    for (const { phrase, decidedBy } of refusals) {
      expect(decidedBy, `"${phrase}" names no decision`).toBeTruthy();
    }
  });

  it("throws rather than returning nothing when the heading moves", () => {
    // The whole failure mode: a guard that matches nothing reports success.
    expect(() => parseRefusals("# Just a doc\n\nNo table here.\n")).toThrow();
  });
});

describe("#323 it would have caught the issue that started this", () => {
  const refusals = parseRefusals(DECISIONS);

  const matches = (title: string) =>
    refusals.some((r) => title.toLowerCase().includes(r.phrase));

  it("catches a review-request issue, which is what #229 was", () => {
    expect(matches("Ask for a Google review after a job closes")).toBe(false);
    // The phrase as the table states it — this is the shape the table has to
    // carry for the check to work at all.
    expect(matches("Add review requests to the closing flow")).toBe(true);
  });

  it("catches the other refusals in their natural phrasing", () => {
    expect(matches("Send a broadcast to every contact")).toBe(true);
    expect(matches("Onboard workspaces onto Stripe Connect")).toBe(true);
    expect(matches("Add storage tiers for heavy workspaces")).toBe(true);
  });

  it("does not fire on ordinary work", () => {
    // A guard that flags everything gets ignored, which is the same as not
    // existing. These are real titles from the current backlog.
    for (const title of [
      "Saved views: everyone rebuilds the same filter every morning",
      "Appointment reminders: stop the no-show",
      "Send later: schedule a text for the morning",
    ]) {
      expect(matches(title), title).toBe(false);
    }
  });
});
