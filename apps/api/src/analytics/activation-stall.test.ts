/**
 * #281 item 4 — what the stall alert actually says.
 *
 * The SQL suite pins WHICH workspaces are in which state. This pins the part a
 * founder reads at 7am and has to act on: an alert that names three workspaces
 * without saying that one needs a message, one needs its first text read, and
 * one needs a carrier chased is a notification rather than information.
 */
import { describe, expect, it } from "vitest";

import {
  composeStallReport,
  type ActivationStallTransition,
} from "./activation-stall";

function row(
  over: Partial<ActivationStallTransition> = {},
): ActivationStallTransition {
  return {
    company_id: "cccccccc-0000-4000-8000-00000000000c",
    company_name: "Brightside Plumbing",
    was: "ok",
    state: "not_sent",
    days_in_state: 5,
    ...over,
  };
}

describe("composeStallReport", () => {
  it("says nothing when nothing changed", () => {
    // The daily no-op. A job that emails "0 stalls" every morning is a job the
    // reader filters, and then the real one is filtered too.
    expect(composeStallReport([])).toBeNull();
  });

  it("names the workspace and how long it has been stuck", () => {
    const report = composeStallReport([row({ days_in_state: 11 })]);
    expect(report?.subject).toBe("[ops] 1 workspace(s) stalled getting started");
    expect(report?.text).toContain("Brightside Plumbing: 11 day(s)");
  });

  it("falls back to the id when a workspace has no name", () => {
    // Never print "undefined" at somebody who is about to go and look it up.
    const report = composeStallReport([row({ company_name: null })]);
    expect(report?.text).toContain("cccccccc-0000-4000-8000-00000000000c");
    expect(report?.text).not.toContain("undefined");
  });

  it("gives each state its own advice, because the actions differ", () => {
    const report = composeStallReport([
      row({ state: "not_sent" }),
      row({ state: "no_reply", company_name: "Silent Co" }),
      row({ state: "awaiting_carrier", company_name: "Queued Co" }),
    ]);
    const text = report?.text ?? "";
    // not_sent → talk to them.
    expect(text).toContain("ask what they are stuck on");
    // no_reply → read what they sent.
    expect(text).toContain("Worth reading");
    // awaiting_carrier → OUR promise is what is failing, not their effort.
    expect(text).toContain("Not their fault and not a stall");
    expect(text).toContain("3 to 7");
  });

  it("groups by state rather than listing workspaces flat", () => {
    // Two workspaces stuck the same way share one explanation; repeating the
    // advice per row is how a short email becomes a long one nobody finishes.
    const report = composeStallReport([
      row({ company_name: "A" }),
      row({ company_name: "B" }),
    ]);
    const text = report?.text ?? "";
    expect(text).toContain("2 workspace(s) can send and have not");
    expect(text.split("ask what they are stuck on")).toHaveLength(2);
  });

  it("reports recoveries, and says what they recovered from", () => {
    const report = composeStallReport([
      row({ state: "ok", was: "no_reply", company_name: "Unstuck Co" }),
    ]);
    expect(report?.subject).toBe("[ops] 1 workspace(s) got moving again");
    expect(report?.text).toContain("Unstuck Co (was no_reply)");
  });

  it("leads with the stalls when both happened", () => {
    // The subject line has one job: whether this needs opening. A morning with
    // a new stall and a recovery is a morning with a new stall.
    const report = composeStallReport([
      row({ state: "ok", was: "not_sent", company_name: "Unstuck Co" }),
      row({ state: "no_reply", company_name: "Silent Co" }),
    ]);
    expect(report?.subject).toContain("stalled getting started");
    expect(report?.text).toContain("Silent Co");
    expect(report?.text).toContain("Unstuck Co");
  });

  it("never trails blank lines", () => {
    const report = composeStallReport([row()]);
    expect(report?.text).toBe(report?.text.trimEnd());
  });
});
