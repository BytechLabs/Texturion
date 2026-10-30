/**
 * D142 — the partition rule both environments sweep the shared Telnyx account
 * by. Each side must own ONLY its own numbers: production the ungrouped ones,
 * the rig the ones in its group. A rule that owned too much in either mode is
 * one environment flagging, adopting or deleting the other's numbers.
 */
import { describe, expect, it } from "vitest";

import { completeEnv } from "../test/support";
import {
  mismatchSweepAlertDue,
  ownsTelnyxNumber,
  partitionOrderFields,
  TELNYX_PARTITION_CAPABILITY,
} from "./ownership";

const production = completeEnv();
const rig = { ...production, TELNYX_BILLING_GROUP_ID: "bg-nonprod" };

describe("production (TELNYX_BILLING_GROUP_ID unset)", () => {
  it("is what completeEnv describes", () => {
    expect(production.TELNYX_BILLING_GROUP_ID).toBeUndefined();
  });

  it("owns a number with no billing group, however Telnyx spells it", () => {
    expect(ownsTelnyxNumber(production, { billing_group_id: null })).toBe(true);
    expect(ownsTelnyxNumber(production, { billing_group_id: "" })).toBe(true);
    // Every number production has today, as the existing fixtures shape them.
    expect(ownsTelnyxNumber(production, {})).toBe(true);
  });

  it("owns no number that carries ANY billing group", () => {
    expect(ownsTelnyxNumber(production, { billing_group_id: "bg-nonprod" })).toBe(false);
    expect(ownsTelnyxNumber(production, { billing_group_id: "bg-anything" })).toBe(false);
  });

  it("orders exactly as before: no billing group field at all", () => {
    expect(partitionOrderFields(production)).toStrictEqual({});
  });
});

describe("the rig (TELNYX_BILLING_GROUP_ID set)", () => {
  it("owns only numbers in its own group", () => {
    expect(ownsTelnyxNumber(rig, { billing_group_id: "bg-nonprod" })).toBe(true);
    expect(ownsTelnyxNumber(rig, { billing_group_id: "bg-other" })).toBe(false);
  });

  it("owns no ungrouped number — every production number is one", () => {
    expect(ownsTelnyxNumber(rig, { billing_group_id: null })).toBe(false);
    expect(ownsTelnyxNumber(rig, { billing_group_id: "" })).toBe(false);
    expect(ownsTelnyxNumber(rig, {})).toBe(false);
  });

  it("owns NOTHING when the variable is set but empty, rather than falling back to production's rule", () => {
    const blank = { ...production, TELNYX_BILLING_GROUP_ID: "" };
    expect(ownsTelnyxNumber(blank, { billing_group_id: null })).toBe(false);
    expect(ownsTelnyxNumber(blank, {})).toBe(false);
    expect(ownsTelnyxNumber(blank, { billing_group_id: "" })).toBe(false);
  });

  it("orders into its group", () => {
    expect(partitionOrderFields(rig)).toEqual({ billing_group_id: "bg-nonprod" });
  });
});

it("lets exactly one 15-minute sweep in every six hours repeat the mismatch page", () => {
  // The sweep keeps no state and opsAlert emails on every call: paging on
  // every pass would be 96 copies a day of one standing problem.
  const midnight = Date.UTC(2026, 9, 30);
  const due = [...Array(96).keys()]
    .map((quarter) => new Date(midnight + quarter * 15 * 60_000))
    .filter(mismatchSweepAlertDue)
    .map((at) => at.toISOString().slice(11, 16));
  expect(due).toEqual(["00:00", "06:00", "12:00", "18:00"]);
});

it("advertises the rule under the literal the rig's guard waits for", () => {
  // The guard matches this string from outside the codebase, so renaming it is
  // a protocol change, not a refactor.
  expect(TELNYX_PARTITION_CAPABILITY).toBe("telnyx-partition-v1");
});
