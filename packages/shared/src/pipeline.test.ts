/**
 * #354 — the pipeline arithmetic, which is the first business number this
 * product would ever show an owner.
 *
 * The cases that matter are the ones where a plausible formula misleads: a win
 * rate that drops when the crew does more work, and a confident percentage
 * computed from two jobs.
 */
import { describe, expect, it } from "vitest";

import {
  PIPELINE_SEED_NAMES,
  PIPELINE_STAGES,
  isPipelineStage,
  pipelineDeleteWarning,
  pipelineInsight,
  pipelineWinRate,
  type PipelineReport,
} from "./pipeline";

const report = (over: Partial<PipelineReport> = {}): PipelineReport => ({
  quoted: 10,
  won: 6,
  lost: 2,
  open: 2,
  median_days_to_win: 3,
  ...over,
});

describe("#354 stages", () => {
  it("names every stage it seeds", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(PIPELINE_SEED_NAMES[stage]).toBeTruthy();
    }
  });

  it("recognises only the four", () => {
    expect(isPipelineStage("quote_sent")).toBe(true);
    expect(isPipelineStage("invoiced")).toBe(false);
    expect(isPipelineStage("")).toBe(false);
  });
});

describe("#354 pipelineWinRate", () => {
  it("divides by DECIDED jobs, not by every quote", () => {
    // The one that matters. Counting an unanswered quote as a loss would make
    // the crew's win rate fall every time they quote more work — a number that
    // punishes the behaviour it exists to encourage.
    expect(pipelineWinRate(report({ won: 6, lost: 2, open: 92 }))).toBe(75);
  });

  it("says nothing rather than zero when nothing has been decided", () => {
    // 0% and "no data yet" are different facts, and the first one reads as a
    // damning verdict on a workspace that has simply just started.
    expect(pipelineWinRate(report({ won: 0, lost: 0, open: 4 }))).toBeNull();
  });

  it("reports a clean sweep and a total loss honestly", () => {
    expect(pipelineWinRate(report({ won: 5, lost: 0 }))).toBe(100);
    expect(pipelineWinRate(report({ won: 0, lost: 5 }))).toBe(0);
  });
});

describe("#354 pipelineInsight", () => {
  it("stays silent below a handful of decided jobs", () => {
    // A 100% win rate off two quotes is noise presented as an achievement, and
    // an owner who acts on it has been misled by us.
    expect(pipelineInsight(report({ won: 2, lost: 0, open: 1 }))).toBeNull();
    expect(pipelineInsight(report({ won: 0, lost: 0, open: 9 }))).toBeNull();
  });

  it("names the outstanding work, which is the actionable half", () => {
    const line = pipelineInsight(report({ won: 6, lost: 2, open: 3 }));
    expect(line).toContain("75%");
    expect(line).toContain("3 quotes are still waiting");
  });

  it("counts one quote in the singular", () => {
    expect(pipelineInsight(report({ won: 6, lost: 2, open: 1 }))).toContain(
      "1 quote is still waiting",
    );
  });

  it("drops the outstanding clause when there is none", () => {
    const line = pipelineInsight(report({ won: 6, lost: 2, open: 0 }));
    expect(line).toBe("You win 75% of the quotes that get an answer.");
  });

  it("renders no em or en dash (Law 6)", () => {
    for (const line of [
      pipelineInsight(report()),
      pipelineDeleteWarning("quote_sent"),
    ]) {
      expect(line ?? "").not.toMatch(/[–—]/);
    }
  });
});

describe("#540 a rate without its sentence", () => {
  it("exists — which is the trap every client fell into", () => {
    // These two functions disagree ON PURPOSE, and the disagreement is the
    // whole point: a rate is arithmetic and an insight is a claim. Two won and
    // nothing lost is a real 100%, and `pipelineInsight` refuses to say it
    // because "a 100% win rate off two quotes is noise presented as an
    // achievement, and an owner who acts on it has been misled by us".
    //
    // All three clients then rendered that number as the LARGEST thing on the
    // card, beside their own words saying it was too early to call. Pinned
    // here, at the source, so the next reader of these two functions meets the
    // trap before the card does.
    const tooEarly = { quoted: 6, won: 2, lost: 0, open: 4, median_days_to_win: null };

    expect(pipelineWinRate(tooEarly)).toBe(100);
    expect(pipelineInsight(tooEarly)).toBeNull();

    // And the pairing a client may show: five decided jobs gets both.
    const callable = { quoted: 12, won: 4, lost: 2, open: 6, median_days_to_win: 3 };
    expect(pipelineWinRate(callable)).not.toBeNull();
    expect(pipelineInsight(callable)).not.toBeNull();
  });
});

describe("#354 pipelineDeleteWarning", () => {
  it("names the consequence and points at the safe alternative", () => {
    // #354 is explicit that a crew should be able to change their stages
    // deliberately. What they should not do is lose their win rate by accident
    // on a Tuesday, so the warning explains rather than forbids.
    const text = pipelineDeleteWarning("won");
    expect(text).toContain("Won");
    expect(text).toContain("stop counting");
    expect(text.toLowerCase()).toContain("renaming it is safe");
  });
});
