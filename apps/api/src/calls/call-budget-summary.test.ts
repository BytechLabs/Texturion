/**
 * The call-journey budget on the Actions job summary: one table per layer,
 * one row per journey, and a moved number visible beside the committed one.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendCallBudgetSummary,
  committedBudget,
  resetCallBudgetSummaryForTest,
  type JourneyBudget,
} from "../../e2e/call-budget";

let scratch: string;
let summary: string;

beforeEach(() => {
  resetCallBudgetSummaryForTest();
  scratch = mkdtempSync(join(tmpdir(), "call-budget-summary-"));
  summary = join(scratch, "summary.md");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the call budget job summary", () => {
  it("writes nothing without a path, even inside Actions", () => {
    // Actions sets this in every step, including the one running this test.
    vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
    expect(appendCallBudgetSummary("voicemail", "e2e", committedBudget("voicemail"), undefined)).toBe(false);
    expect(appendCallBudgetSummary("voicemail", "e2e", committedBudget("voicemail"), "")).toBe(false);
    expect(existsSync(summary)).toBe(false);
  });

  it("starts one table per layer and adds a row per journey", () => {
    for (const journey of ["inbound-answered", "transfer-blind"]) {
      appendCallBudgetSummary(journey, "e2e", committedBudget(journey), summary);
    }
    appendCallBudgetSummary("voicemail", "session", committedBudget("voicemail"), summary);

    const lines = readFileSync(summary, "utf8").split("\n");
    expect(lines.filter((line) => line.startsWith("### "))).toEqual([
      "### Call journey budget (e2e layer)",
      "### Call journey budget (session layer)",
    ]);
    expect(lines).toContain(
      "| Journey | Rig scenario | Dials | Far-end legs | Rig dials | Peak legs | Peak outbound legs | Budget |",
    );
    // transfer-blind: 3 dials, 1 far-end leg, peaks of 3 and 2.
    expect(lines).toContain("| transfer-blind | S07 | 3 | 1 | 4 | 3 | 2 | matches |");
    expect(lines.filter((line) => /^\| [a-z-]+ \| S\d+/.test(line))).toHaveLength(3);
  });

  it("shows a number that moved next to the budget's", () => {
    const measured: JourneyBudget = { ...committedBudget("voicemail"), dials: 2 };
    appendCallBudgetSummary("voicemail", "e2e", measured, summary);

    expect(readFileSync(summary, "utf8")).toContain(
      "| voicemail | S04 | 2 (budget 1) | 1 | 3 (budget 2) | 2 | 1 | differs |",
    );
  });
});
