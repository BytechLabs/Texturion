/**
 * #366 — telling a crew that a call cannot ring all of them.
 *
 * The assertion that matters most is the silent one. Almost every workspace is
 * far under this ceiling, and a line about a limit nobody is near is noise
 * that teaches people to skip the card it sits on.
 */
import { describe, expect, it } from "vitest";

import { ringCeilingLine } from "./ring-ceiling";
import type { PhoneNumberSummary } from "@/lib/api/types";

const number = (over: Partial<PhoneNumberSummary>) =>
  ({ id: "n1", status: "active", ...over }) as PhoneNumberSummary;

describe("the ring-ceiling line", () => {
  it("says nothing for a crew under the ceiling", () => {
    // D12's ICP is 1-10 field staff, so this is nearly every workspace.
    expect(ringCeilingLine(number({ ring_targets: 6, ring_target_limit: 24 }))).toBeNull();
  });

  it("says nothing at exactly the ceiling", () => {
    // 24 of 24 are all rung. There is no exclusion to explain.
    expect(ringCeilingLine(number({ ring_targets: 24, ring_target_limit: 24 }))).toBeNull();
  });

  it("names both numbers once the crew is over it", () => {
    const line = ringCeilingLine(number({ ring_targets: 26, ring_target_limit: 24 }));
    expect(line).toContain("26");
    expect(line).toContain("24");
  });

  it("says turns are taken, because they now are", () => {
    // Before the rotation this line would have been a lie: the same members
    // were excluded from every call. It is only honest because the fan-out
    // rotates per session.
    expect(ringCeilingLine(number({ ring_targets: 26, ring_target_limit: 24 })))
      .toContain("takes turns");
  });

  it("says nothing when the server could not resolve a count", () => {
    // The count is best-effort on a settings screen. Absent is "nothing to
    // say", never "zero people can be rung".
    expect(ringCeilingLine(number({ ring_targets: null, ring_target_limit: 24 }))).toBeNull();
    expect(ringCeilingLine(number({}))).toBeNull();
  });
});
