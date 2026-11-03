/**
 * D142 — the partition rule both environments sweep the shared Telnyx account
 * by. Each side must own ONLY its own numbers: production the ungrouped ones,
 * the rig the ones in its group. A rule that owned too much in either mode is
 * one environment flagging, adopting or deleting the other's numbers.
 */
import { describe, expect, it } from "vitest";

import { completeEnv } from "../test/support";
import {
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

it("advertises the rule under the literal the rig's guard waits for", () => {
  // The guard matches this string from outside the codebase, so renaming it is
  // a protocol change, not a refactor.
  expect(TELNYX_PARTITION_CAPABILITY).toBe("telnyx-partition-v1");
});
